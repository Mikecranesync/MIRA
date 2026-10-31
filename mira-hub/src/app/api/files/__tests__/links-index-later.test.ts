// POST /api/files/:fileId/links — attach-later indexing (#4367).
//
// A file parked without a destination is stored, never indexed. The contract
// this test pins: when the file is later attached to a namespace node or to a
// notebook that has a backing node, a PDF or text file that is not yet indexed
// is ingested into that node and linked, so it becomes citable. A file that is
// already indexed, is a photo, has no node, or fails to ingest must not break
// the attach itself.
//
// Run: cd mira-hub && npx vitest run src/app/api/files/__tests__/links-index-later.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestPdfToNode: vi.fn(),
  ingestTextToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-files")>();
  return {
    ...actual, // isLinkTargetType stays real
    attachFileToTargets: vi.fn(),
    claimIngest: vi.fn(),
    releaseIngestClaim: vi.fn(),
    linkFileToUpload: vi.fn(),
    syncNotebookSourcesForFile: vi.fn(async () => 0),
  };
});

import { POST } from "../[fileId]/links/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode, deleteOrphanNodeIngest } from "@/lib/node-knowledge-ingest";
import {
  attachFileToTargets,
  claimIngest,
  releaseIngestClaim,
  linkFileToUpload,
  syncNotebookSourcesForFile,
} from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "99999999-9999-9999-9999-999999999999";
const FILE_ID = "22222222-2222-2222-2222-222222222222";
const NODE_ID = "77777777-7777-7777-7777-777777777777";
const NOTEBOOK_ID = "33333333-3333-3333-3333-333333333333";
const UPLOAD_ID = "55555555-5555-5555-5555-555555555555";

type FileRow = { content: Buffer; filename: string; mime_type: string; size_bytes: number; upload_id: string | null };

// Fake tenant client. `file` answers the namespace_direct_uploads read;
// `notebookNode` answers the equipment_notebooks.node_id lookup; `uns` answers
// the kg_entities uns_path lookup.
let file: FileRow | null;
let notebookNode: string | null;
function fakeClient() {
  return {
    query: vi.fn(async (sql: string) => {
      if (/FROM namespace_direct_uploads/.test(sql)) return { rows: file ? [file] : [] };
      if (/FROM equipment_notebooks/.test(sql)) return { rows: notebookNode ? [{ node_id: notebookNode }] : [] };
      if (/FROM kg_entities/.test(sql)) return { rows: [{ uns_path: "/plant/line1" }] };
      return { rows: [] };
    }),
  };
}

function req(targets: unknown) {
  return new Request(`http://x/api/files/${FILE_ID}/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targets }),
  });
}
const params = { params: Promise.resolve({ fileId: FILE_ID }) };
const NODE_TARGET = [{ targetType: "namespace_node", targetId: NODE_ID }];
const NOTEBOOK_TARGET = [{ targetType: "equipment_notebook", targetId: NOTEBOOK_ID }];
const PDF_ROW: FileRow = {
  content: Buffer.from("%PDF-1.4 test"),
  filename: "pump-manual.pdf",
  mime_type: "application/pdf",
  size_bytes: 13,
  upload_id: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  file = { ...PDF_ROW };
  notebookNode = NODE_ID;
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId: TENANT, userId: USER } as never);
  vi.mocked(withTenantContext).mockImplementation(((_t: string, fn: (c: never) => unknown) =>
    fn(fakeClient() as never)) as never);
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "namespace_node", targetId: NODE_ID }],
  } as never);
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" } as never);
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 12 } as never);
  vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 3 } as never);
});

describe("POST /api/files/:fileId/links — index on attach-later (#4367)", () => {
  it("indexes an unassigned PDF when it is attached to a namespace node", async () => {
    const res = await POST(req(NODE_TARGET), params);
    expect(res.status).toBe(200);
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ingestPdfToNode).mock.calls[0][0]).toMatchObject({ nodeId: NODE_ID, unsPath: "/plant/line1" });
    expect(linkFileToUpload).toHaveBeenCalledWith(TENANT, FILE_ID, UPLOAD_ID, "tok-1");
    const body = await res.json();
    expect(body.indexing).toBe("indexed");
    expect(body.uploadId).toBe(UPLOAD_ID);
    expect(body.links).toHaveLength(1);
  });

  it("resolves the notebook's backing node and indexes into it", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: true,
      links: [{ linkId: "link-2", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
    } as never);
    const res = await POST(req(NOTEBOOK_TARGET), params);
    expect(ingestPdfToNode).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ingestPdfToNode).mock.calls[0][0]).toMatchObject({ nodeId: NODE_ID });
    expect(syncNotebookSourcesForFile).toHaveBeenCalledWith(TENANT, FILE_ID, UPLOAD_ID, USER);
    expect((await res.json()).indexing).toBe("indexed");
  });

  it("indexes a text file with the text writer", async () => {
    file = { ...PDF_ROW, filename: "notes.txt", mime_type: "text/plain", content: Buffer.from("hello") };
    const res = await POST(req(NODE_TARGET), params);
    expect(ingestTextToNode).toHaveBeenCalledTimes(1);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect((await res.json()).indexing).toBe("indexed");
  });

  it("does not re-ingest a file that is already indexed", async () => {
    file = { ...PDF_ROW, upload_id: UPLOAD_ID };
    const res = await POST(req(NODE_TARGET), params);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(claimIngest).not.toHaveBeenCalled();
    expect((await res.json()).indexing).toBe("already_indexed");
  });

  it("leaves a photo unindexed and still returns the links", async () => {
    file = { ...PDF_ROW, filename: "pump.jpg", mime_type: "image/jpeg" };
    const res = await POST(req(NODE_TARGET), params);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.indexing).toBe("not_indexable");
    expect(body.links).toHaveLength(1);
  });

  it("does not index when the attach has no node to stamp chunks with", async () => {
    notebookNode = null;
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: true,
      links: [{ linkId: "link-3", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
    } as never);
    const res = await POST(req(NOTEBOOK_TARGET), params);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect((await res.json()).indexing).toBe("no_node");
  });

  it("keeps the attach and releases the claim when ingest fails", async () => {
    vi.mocked(ingestPdfToNode).mockRejectedValue(new Error("boom"));
    const res = await POST(req(NODE_TARGET), params);
    expect(res.status).toBe(200);
    expect(releaseIngestClaim).toHaveBeenCalledWith(TENANT, FILE_ID, "tok-1");
    const body = await res.json();
    expect(body.indexing).toBe("failed");
    expect(body.links).toHaveLength(1);
  });

  it("removes its orphan chunks when another request wins the link race", async () => {
    vi.mocked(linkFileToUpload).mockResolvedValue(false);
    const res = await POST(req(NODE_TARGET), params);
    expect(deleteOrphanNodeIngest).toHaveBeenCalledWith(TENANT, UPLOAD_ID);
    expect((await res.json()).indexing).toBe("in_progress");
  });

  it("does not index when the attach itself is refused", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({ ok: false, error: "target_not_found" } as never);
    const res = await POST(req(NODE_TARGET), params);
    expect(res.status).toBe(404);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    expect((await POST(req(NODE_TARGET), params)).status).toBe(401);
  });
});
