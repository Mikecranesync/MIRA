// Vitest coverage for GET /api/namespace/node/[id]/files — specifically the
// #1900 change: a PDF indexed into a node (hub_uploads.kg_entity_id, chunked into
// knowledge_entries) must appear in the node's file list as a read-only "indexed"
// entry, so a folder holding a citable manual no longer reads "0 files".
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node/[id]/files
//
// Mocks the session helper, the tenant-context wrapper (direct uploads), and the
// owner pool (the v2 hub_uploads read). Issue: #1900

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
// Pull node-knowledge-ingest in as a no-op — GET never touches it, but importing
// the route module loads it, and it must not hit a real DB at import time.
vi.mock("@/lib/node-knowledge-ingest", () => ({ ingestPdfToNode: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
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

describe("GET /api/namespace/node/[id]/files — v2 indexed uploads (#1900)", () => {
  it("merges hub_uploads v2 docs as read-only 'upload' entries ahead of direct files", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // Node exists, one direct (raw) file attached.
    vi.mocked(withTenantContext).mockResolvedValue([
      {
        id: "direct-1",
        filename: "wiring.png",
        mime_type: "image/png",
        size_bytes: 2048,
        source: "direct",
        created_at: "2026-06-12T00:00:00Z",
      },
    ]);
    // One indexed PDF attached to this node via hub_uploads.kg_entity_id.
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
    });
    expect(body.files[1]).toMatchObject({ filename: "wiring.png", source: "direct" });
    // The v2 read is scoped to tenant + this node id.
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM hub_uploads"),
      [TENANT_ID, VALID_UUID],
    );
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
