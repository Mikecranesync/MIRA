// POST /api/files — the target-agnostic upload door.
//
// Run: cd mira-hub && npx vitest run src/app/api/files
//
// This door exists because the node door can only file at a namespace node, so
// "Add file" from an asset or work order had nowhere to post. The contract it
// must honor: the bytes are parked FIRST and never lost, unknown types are
// retained but never indexed, exact-byte reuse never re-parses, and indexing
// only happens when a destination resolves to a node (chunks need a node id).

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
    ...actual, // isLinkTargetType + fileCapability stay real
    listFiles: vi.fn(),
    parkOrReuseFile: vi.fn(),
    linkFileToUpload: vi.fn(),
    attachFileToTargets: vi.fn(),
    claimIngest: vi.fn(),
    releaseIngestClaim: vi.fn(),
    syncNotebookSourcesForFile: vi.fn(async () => 0),
  };
});

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { parkOrReuseFile, linkFileToUpload, attachFileToTargets, claimIngest, releaseIngestClaim, syncNotebookSourcesForFile } from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "99999999-9999-9999-9999-999999999999";
const FILE_ID = "22222222-2222-2222-2222-222222222222";
const NODE_ID = "77777777-7777-7777-7777-777777777777";
const NOTEBOOK_ID = "33333333-3333-3333-3333-333333333333";
const ASSET_ID = "44444444-4444-4444-4444-444444444444";
const UPLOAD_ID = "55555555-5555-5555-5555-555555555555";

function upload(name: string, type: string, body = "hello", targets?: unknown) {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type }));
  if (targets !== undefined) fd.append("targets", JSON.stringify(targets));
  return new Request("http://x/api/files", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId: TENANT, userId: USER } as never);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({ ok: true, links: [] } as never);
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" });
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
});

describe("POST /api/files", () => {
  it("401s without a session", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    expect((await POST(upload("a.pdf", "application/pdf"))).status).toBe(401);
  });

  it("422s when the file field is missing", async () => {
    const fd = new FormData();
    fd.append("targets", "[]");
    const res = await POST(new Request("http://x/api/files", { method: "POST", body: fd }));
    expect(res.status).toBe(422);
    expect(vi.mocked(parkOrReuseFile)).not.toHaveBeenCalled();
  });

  it("422s on a malformed or non-allowlisted target", async () => {
    const fd = new FormData();
    fd.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    fd.append("targets", "{not json");
    const bad = await POST(new Request("http://x/api/files", { method: "POST", body: fd }));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "invalid_targets" });

    const wrongType = await POST(
      upload("a.pdf", "application/pdf", "x", [{ targetType: "kg_entity", targetId: NODE_ID }]),
    );
    expect(wrongType.status).toBe(422);
    expect(await wrongType.json()).toEqual({ error: "invalid_target_type" });
    // Nothing was parked for an invalid request.
    expect(vi.mocked(parkOrReuseFile)).not.toHaveBeenCalled();
  });

  it("parks an unknown binary, retains it, and never indexes it", async () => {
    const res = await POST(
      upload("program.ccwsln", "application/x-weird", "PLCBACKUP", [
        { targetType: "cmms_asset", targetId: ASSET_ID },
      ]),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, indexed: false, fileId: FILE_ID });
    expect(body.file.capability).toBe("stored");
    // Unknown MIME is normalized, never trusted.
    expect(vi.mocked(parkOrReuseFile).mock.calls[0][0].mimeType).toBe("application/octet-stream");
    expect(vi.mocked(ingestPdfToNode)).not.toHaveBeenCalled();
    expect(vi.mocked(ingestTextToNode)).not.toHaveBeenCalled();
  });

  it("attaches to a CMMS asset without indexing (an asset has no node to stamp)", async () => {
    const res = await POST(
      upload("manual.pdf", "application/pdf", "%PDF-1.7", [
        { targetType: "cmms_asset", targetId: ASSET_ID },
      ]),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, indexed: false });
    expect(vi.mocked(attachFileToTargets).mock.calls[0][2]).toEqual([
      { targetType: "cmms_asset", targetId: ASSET_ID, role: null, displayLabel: null, isPrimary: false },
    ]);
    expect(vi.mocked(ingestPdfToNode)).not.toHaveBeenCalled();
  });

  it("indexes a PDF when a namespace node is the destination", async () => {
    vi.mocked(withTenantContext).mockResolvedValue("enterprise.site.line" as never);
    vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 12 });
    const res = await POST(
      upload("manual.pdf", "application/pdf", "%PDF-1.7", [
        { targetType: "namespace_node", targetId: NODE_ID },
      ]),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ indexed: true, uploadId: UPLOAD_ID, chunkCount: 12 });
    expect(vi.mocked(ingestPdfToNode).mock.calls[0][0]).toMatchObject({ nodeId: NODE_ID });
    expect(vi.mocked(linkFileToUpload)).toHaveBeenCalledWith(TENANT, FILE_ID, UPLOAD_ID, "tok-1");
  });

  it("resolves a notebook target to its backing node for indexing", async () => {
    // First withTenantContext call resolves the notebook's node, second the uns_path.
    vi.mocked(withTenantContext)
      .mockResolvedValueOnce(NODE_ID as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 1 });
    const res = await POST(
      upload("note.txt", "text/plain", "torque spec 42Nm", [
        { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
      ]),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(ingestTextToNode).mock.calls[0][0]).toMatchObject({ nodeId: NODE_ID });
    // Review F1: targets were attached BEFORE ingestion (uploadId null), so the
    // route must reconcile notebook source membership AFTER the fenced link —
    // otherwise the doc is indexed but never citable in notebook chat.
    expect(syncNotebookSourcesForFile).toHaveBeenCalledWith(TENANT, FILE_ID, UPLOAD_ID, USER);
  });

  it("reuses an already-parsed file without re-parsing", async () => {
    vi.mocked(parkOrReuseFile).mockResolvedValue({
      fileId: FILE_ID,
      reused: true,
      uploadId: UPLOAD_ID,
    });
    const res = await POST(
      upload("manual.pdf", "application/pdf", "%PDF-1.7", [
        { targetType: "namespace_node", targetId: NODE_ID },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, indexed: true, uploadId: UPLOAD_ID });
    expect(vi.mocked(ingestPdfToNode)).not.toHaveBeenCalled();
    // ...but it IS filed at the new destination.
    expect(vi.mocked(attachFileToTargets)).toHaveBeenCalledTimes(1);
  });

  it("keeps the parked file when indexing fails, and says so honestly", async () => {
    vi.mocked(withTenantContext).mockResolvedValue(null as never);
    vi.mocked(ingestPdfToNode).mockRejectedValue(
      new Error("no extractable text in scan.pdf — the file appears to be scanned"),
    );
    const res = await POST(
      upload("scan.pdf", "application/pdf", "%PDF-1.7", [
        { targetType: "namespace_node", targetId: NODE_ID },
      ]),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, indexed: false, fileId: FILE_ID });
    expect(body.warning).toMatch(/scanned or image-only/i);
  });

  it("reports a bad destination without losing the bytes", async () => {
    vi.mocked(attachFileToTargets).mockResolvedValue({
      ok: false,
      error: "target_not_found",
    } as never);
    const res = await POST(
      upload("a.pdf", "application/pdf", "%PDF-", [
        { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
      ]),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, fileId: FILE_ID, error: "target_not_found" });
    // Parked before the attach was attempted — the file is recoverable.
    expect(vi.mocked(parkOrReuseFile)).toHaveBeenCalledTimes(1);
  });

  it("accepts an upload with no targets at all (lands Unfiled)", async () => {
    const res = await POST(upload("loose.bin", "application/octet-stream", "x"));
    expect(res.status).toBe(201);
    expect(vi.mocked(attachFileToTargets)).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ ok: true, indexed: false, fileId: FILE_ID });
  });
});
