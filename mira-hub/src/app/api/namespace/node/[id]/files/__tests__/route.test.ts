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
vi.mock("@/lib/node-knowledge-ingest", () => ({ ingestPdfToNode: vi.fn() }));

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
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
    // call 1: node lookup → node exists; call 2: park insert → direct id.
    vi.mocked(withTenantContext)
      .mockResolvedValueOnce({ id: VALID_UUID, uns_path: "enterprise.site" })
      .mockResolvedValueOnce("direct-parked-1");
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

  it("links the parked original to the ingest upload on success", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // call 1: node lookup; call 2: park insert; call 3: upload_id link UPDATE.
    vi.mocked(withTenantContext)
      .mockResolvedValueOnce({ id: VALID_UUID, uns_path: "enterprise.site" })
      .mockResolvedValueOnce("direct-parked-2")
      .mockResolvedValueOnce(undefined);
    vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: "upload-9", chunkCount: 12 });

    const res = await POST(makePostReq("manual.pdf", "application/pdf"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: true, uploadId: "upload-9", chunkCount: 12 });
    // node check + park + link = 3 tenant-context round-trips.
    expect(withTenantContext).toHaveBeenCalledTimes(3);
  });

  it("parks non-PDF files without touching the ingest pipeline", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext)
      .mockResolvedValueOnce({ id: VALID_UUID, uns_path: "enterprise.site" })
      .mockResolvedValueOnce("direct-parked-3");

    const res = await POST(makePostReq("photo.png", "image/png"), makeParams(VALID_UUID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, indexed: false });
    expect(body.warning).toBeUndefined();
    expect(ingestPdfToNode).not.toHaveBeenCalled();
  });
});
