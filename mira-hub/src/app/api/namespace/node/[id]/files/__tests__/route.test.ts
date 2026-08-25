// Vitest coverage for /api/namespace/node/[id]/files.
//
// GET — the #1900 merge (indexed hub_uploads docs appear in the list) plus the
// filing-cabinet dedupe: a hub_uploads row whose original is parked in
// namespace_direct_uploads (upload_id link) must NOT appear twice.
//
// POST — the filing-cabinet guarantee: the original bytes are parked BEFORE
// ingest, so a PDF whose text extraction fails is KEPT (201, indexed:false,
// warning) instead of lost with a 500.
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node/[id]/files
//
// Mocks the session helper, the tenant-context wrapper (direct uploads), and the
// owner pool (the v2 hub_uploads read). Issues: #1900, filing cabinet.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestPdfToNode: vi.fn(),
  ingestTextToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/lib/uploads", () => ({ findDuplicateUpload: vi.fn(async () => null) }));
// Parking/linking now goes through the canonical Files service (075). The pure
// capability helper stays real — it is the thing the "stored, not indexed"
// assertion is about.
vi.mock("@/lib/workspace-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-files")>();
  return {
    ...actual,
    parkOrReuseFile: vi.fn(),
    linkFileToUpload: vi.fn(),
    attachFileToTargets: vi.fn(),
    claimIngest: vi.fn(),
    releaseIngestClaim: vi.fn(),
  };
});

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { findDuplicateUpload } from "@/lib/uploads";
import { parkOrReuseFile, linkFileToUpload, attachFileToTargets, claimIngest, releaseIngestClaim } from "@/lib/workspace-files";
import pool from "@/lib/db";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = () =>
  new Request(`https://hub.test/api/namespace/node/${VALID_UUID}/files`, { method: "GET" });
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  // resetAllMocks clears the factory default — restore "no duplicate found".
  vi.mocked(findDuplicateUpload).mockResolvedValue(null);
  // Default: fresh bytes parked as a new canonical file, not yet indexed.
  vi.mocked(parkOrReuseFile).mockResolvedValue({
    fileId: "direct-parked-default",
    reused: false,
    uploadId: null,
  });
  vi.mocked(attachFileToTargets).mockResolvedValue({ ok: true, links: [] });
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" });
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
});

describe("GET /api/namespace/node/[id]/files — merge + filing-cabinet dedupe", () => {
  it("merges hub_uploads v2 docs as read-only 'upload' entries ahead of direct files", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // Node exists, one direct (raw) file attached — no parked upload link.
    vi.mocked(withTenantContext).mockResolvedValue([
      {
        id: "direct-1",
        filename: "wiring.png",
        mime_type: "image/png",
        size_bytes: 2048,
        source: "direct",
        created_at: "2026-06-12T00:00:00Z",
        verified: false,
        indexed: false,
        upload_id: null,
      },
    ]);
    // One legacy indexed PDF attached via hub_uploads.kg_entity_id (no parked original).
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          id: "upload-1",
          filename: "pump-manual.pdf",
          mime_type: "application/pdf",
          size_bytes: "51200",
          created_at: "2026-06-12T01:00:00Z",
        },
      ],
    } as never);

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Array<Record<string, unknown>> };
    expect(body.files).toHaveLength(2);
    // Indexed entries lead, tagged source 'upload' (no download/delete on the client).
    expect(body.files[0]).toMatchObject({
      filename: "pump-manual.pdf",
      source: "upload",
      size_bytes: 51200,
      indexed: true,
    });
    expect(body.files[1]).toMatchObject({
      filename: "wiring.png",
      source: "direct",
      verified: false,
    });
    // The join key never leaves the server.
    expect(body.files[1]).not.toHaveProperty("upload_id");
    // The v2 read is scoped to tenant + this node id.
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM hub_uploads"),
      [TENANT_ID, VALID_UUID],
    );
  });

  it("does NOT list a hub_uploads doc twice when its original is parked (upload_id link)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // Parked original of the SAME document (upload_id = upload-1), verified.
    vi.mocked(withTenantContext).mockResolvedValue([
      {
        id: "direct-2",
        filename: "pump-manual.pdf",
        mime_type: "application/pdf",
        size_bytes: 51200,
        source: "direct",
        created_at: "2026-06-12T01:00:00Z",
        verified: true,
        indexed: true,
        upload_id: "upload-1",
      },
    ]);
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          id: "upload-1",
          filename: "pump-manual.pdf",
          mime_type: "application/pdf",
          size_bytes: "51200",
          created_at: "2026-06-12T01:00:00Z",
        },
      ],
    } as never);

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Array<Record<string, unknown>> };
    // ONE row per document: the parked original (downloadable, verified, indexed).
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      id: "direct-2",
      source: "direct",
      verified: true,
      indexed: true,
    });
  });

  it("degrades to direct files alone when the hub_uploads read fails (never 500s)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue([]);
    vi.mocked(pool.query).mockRejectedValue(new Error("relation hub_uploads does not exist"));

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files).toEqual([]);
  });

  it("returns 404 when the node does not belong to the tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue(null);
    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/namespace/node/[id]/files — originals are parked, never lost", () => {
  const makePostReq = (filename: string, type: string) => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3])], filename, { type }));
    return new Request(`https://hub.test/api/namespace/node/${VALID_UUID}/files`, {
      method: "POST",
      body: fd,
    });
  };

  it("keeps the parked file and returns 201 + warning when PDF ingest fails", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // The only tenant-context round-trip left in POST is the node lookup;
    // parking moved into the canonical Files service.
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-1",
      reused: false,
      uploadId: null,
    });
    vi.mocked(ingestPdfToNode).mockRejectedValue(
      new Error("extractText: Invalid PDF structure"),
    );

    const res = await POST(makePostReq("scan.pdf", "application/pdf"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: false });
    expect(body.warning).toMatch(/couldn't read this PDF/i);
    expect((body.file as Record<string, unknown>).id).toBe("direct-parked-1");
  });

  it("names the scanned/no-text cause in the warning (ARPK 1c honest failure)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-scan",
      reused: false,
      uploadId: null,
    });
    // The real writePdfChunksForNode throws NoExtractableTextError when every
    // page yields zero chunks (scanned/image-only PDF); the route must map it
    // to a warning that names the cause instead of a generic "couldn't read".
    vi.mocked(ingestPdfToNode).mockRejectedValue(
      new Error("no extractable text — the PDF appears to be scanned or image-only"),
    );

    const res = await POST(makePostReq("scanned.pdf", "application/pdf"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: false });
    expect(body.warning).toMatch(/scanned or image-only/i);
    expect(body.warning).toMatch(/kept/i);
  });

  it("links the parked original to the ingest upload on success", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-2",
      reused: false,
      uploadId: null,
    });
    vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: "upload-9", chunkCount: 12 });

    const res = await POST(makePostReq("manual.pdf", "application/pdf"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      indexed: true,
      uploadId: "upload-9",
      chunkCount: 12,
      fileId: "direct-parked-2",
    });
    // Parked once through the service, linked to its parsed document once.
    expect(parkOrReuseFile).toHaveBeenCalledTimes(1);
    expect(linkFileToUpload).toHaveBeenCalledWith(TENANT_ID, "direct-parked-2", "upload-9", "tok-1");
    // …and filed at this node.
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT_ID,
      "direct-parked-2",
      [{ targetType: "namespace_node", targetId: VALID_UUID, isPrimary: false }],
      { createdBy: "u_1" },
    );
    // Only the node lookup still needs a tenant-context round-trip here.
    expect(withTenantContext).toHaveBeenCalledTimes(1);
  });

  it("reuses an already-parsed canonical file without re-ingesting (exact-byte reuse)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "file-canonical",
      reused: true,
      uploadId: "upload-existing",
    });

    // A .bin so the PDF pre-check (findDuplicateUpload) is not what answers.
    const res = await POST(
      makePostReq("trend.bin", "application/octet-stream"),
      makeParams(VALID_UUID),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      indexed: true,
      duplicate: true,
      uploadId: "upload-existing",
      fileId: "file-canonical",
    });
    // No re-parse / re-chunk / re-embed…
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
    // …but the reuse still files the file in the new location.
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT_ID,
      "file-canonical",
      [{ targetType: "namespace_node", targetId: VALID_UUID, isPrimary: false }],
      { createdBy: "u_1" },
    );
  });

  it("stores an unknown binary type as a downloadable 'stored' file, never indexed", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-bin",
      reused: false,
      uploadId: null,
    });

    const res = await POST(
      makePostReq("plc-backup.acd", "application/x-rockwell-acd"),
      makeParams(VALID_UUID),
    );
    // Behavior change: an unrecognized type is retained (was 415).
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: false, fileId: "direct-parked-bin" });
    expect((body.file as Record<string, unknown>).capability).toBe("stored");
    // Parked under a neutral type — never executed, never indexed.
    expect(vi.mocked(parkOrReuseFile).mock.calls[0][0]).toMatchObject({
      filename: "plc-backup.acd",
      mimeType: "application/octet-stream",
    });
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("returns the existing document on a same-node re-upload without re-chunking (ARPK 1b)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // node lookup only — no park, no ingest for a duplicate.
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(findDuplicateUpload).mockResolvedValue({
      id: "up-original",
      kbChunkCount: 42,
      filename: "manual.pdf",
    } as never);

    const res = await POST(makePostReq("manual.pdf", "application/pdf"), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      indexed: true,
      duplicate: true,
      uploadId: "up-original",
      chunkCount: 42,
    });
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    // No second parked copy either — the original upload already parked it.
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("parks non-PDF files without touching the ingest pipeline", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-3",
      reused: false,
      uploadId: null,
    });

    const res = await POST(makePostReq("photo.png", "image/png"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: false });
    expect(body.warning).toBeUndefined();
    expect(ingestPdfToNode).not.toHaveBeenCalled();
  });
});

describe("POST — plain text is indexable (copied-text source door)", () => {
  const makePostReq = (filename: string, type: string) => {
    const fd = new FormData();
    fd.append("file", new File(["torque the lugs to 1.4 N-m"], filename, { type }));
    return new Request(`https://hub.test/api/namespace/node/${VALID_UUID}/files`, {
      method: "POST",
      body: fd,
    });
  };

  it("routes text/plain through ingestTextToNode and returns indexed:true", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-txt",
      reused: false,
      uploadId: null,
    });
    vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: "up-txt-1", chunkCount: 1 });

    const res = await POST(makePostReq("bench-note.txt", "text/plain"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: true, uploadId: "up-txt-1" });
    expect(ingestTextToNode).toHaveBeenCalledTimes(1);
    expect(ingestPdfToNode).not.toHaveBeenCalled();
  });

  it("markdown (text/markdown) indexes as text too", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValueOnce({
      id: VALID_UUID,
      uns_path: "enterprise.site",
    });
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: "direct-parked-md",
      reused: false,
      uploadId: null,
    });
    vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: "up-md-1", chunkCount: 1 });

    const res = await POST(makePostReq("notes.md", "text/markdown"), makeParams(VALID_UUID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ indexed: true });
  });
});

// ── #3396 — filing lives in workspace_file_links, not just node_id ───────────
//
// The rest of this file mocks withTenantContext straight to a finished array,
// so the GET's real SQL never runs. That is exactly how #3396 shipped and stayed
// live for six days behind a green suite. This block drives the callback with a
// stub client instead, so a regression to a node_id-only listing is caught in
// CI (which does not run the vitest integration suite). The real proof, against
// Postgres with RLS, is node-files-links.integration.test.ts.
describe("GET — a file filed only through workspace_file_links (#3396)", () => {
  /** Answers the two statements GET issues, keyed on what the SQL asks for. */
  function stubClient(opts: { linkFiledRow: Record<string, unknown> }) {
    return {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM kg_entities")) return { rows: [{ id: VALID_UUID }] };
        // The link-filed file has no node_id pointing here. It is reachable ONLY
        // if the listing consults workspace_file_links.
        if (sql.includes("workspace_file_links")) return { rows: [opts.linkFiledRow] };
        return { rows: [] };
      }),
    };
  }

  const linkFiledRow = {
    id: "file-linked-1",
    filename: "shared-manual.pdf",
    mime_type: "application/pdf",
    size_bytes: "4096",
    source: "direct",
    created_at: "2026-08-24T00:00:00Z",
    upload_id: null,
    verified: false,
  };

  it("lists it — a node_id-only listing would return nothing", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const client = stubClient({ linkFiledRow });
    vi.mocked(withTenantContext).mockImplementation(
      async (_tenantId: string, fn: (c: never) => Promise<unknown>) => fn(client as never),
    );
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Array<{ filename: string }> };
    expect(body.files.map((f) => f.filename)).toContain("shared-manual.pdf");
  });

  it("scopes the link lookup to namespace_node targets and this tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const client = stubClient({ linkFiledRow });
    vi.mocked(withTenantContext).mockImplementation(
      async (_tenantId: string, fn: (c: never) => Promise<unknown>) => fn(client as never),
    );
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);

    await GET(makeReq(), makeParams(VALID_UUID));

    const listingSql = client.query.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes("workspace_file_links"));
    expect(listingSql).toBeDefined();
    // A link table with no FK on target_id must never be read unscoped.
    expect(listingSql).toContain("target_type = 'namespace_node'");
    expect(listingSql).toContain("l.tenant_id = u.tenant_id");
    expect(listingSql).toContain("u.tenant_id = $2");
    // Bound to the requested node + tenant, not interpolated.
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("workspace_file_links"),
      [VALID_UUID, TENANT_ID],
    );
  });
});
