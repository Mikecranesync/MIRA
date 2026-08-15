// Vitest coverage for GET /api/assets/[id]/documents.
//
// Run: cd mira-hub && npx vitest run "src/app/api/assets"
//
// The contract: EXPLICITLY attached files (workspace_file_links, migration 075)
// and manufacturer/model SUGGESTIONS are two separate keys, and the same
// document never appears in both.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { listFilesForTarget } from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ASSET_ID = "22222222-2222-2222-2222-222222222222";
const DOC_ID = "33333333-3333-3333-3333-333333333333";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const params = { params: Promise.resolve({ id: ASSET_ID }) };
const req = () => new Request(`https://hub.test/api/assets/${ASSET_ID}/documents`);

function attachedFile(over: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    filename: "GS10-manual.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    contentSha256: null,
    uploadId: DOC_ID,
    verified: false,
    createdAt: "2026-08-13T00:00:00Z",
    capability: "indexable",
    indexed: true,
    linkCount: 1,
    link: {
      id: "link-1",
      fileId: "file-1",
      targetType: "cmms_asset",
      targetId: ASSET_ID,
      role: "manual",
      displayLabel: null,
      isPrimary: true,
      createdAt: "2026-08-13T00:00:00Z",
    },
    ...over,
  };
}

/** asset lookup first, then the suggestion rollup. */
function scriptTenantCtx(asset: Record<string, unknown> | null, rows: Record<string, unknown>[]) {
  vi.mocked(withTenantContext)
    .mockImplementationOnce((async (_t: string, fn: (c: unknown) => unknown) =>
      fn({ query: async () => ({ rows: asset ? [asset] : [] }) })) as never)
    .mockImplementationOnce((async (_t: string, fn: (c: unknown) => unknown) =>
      fn({ query: async () => ({ rows }) })) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue(goodSession);
  vi.mocked(listFilesForTarget).mockResolvedValue([]);
});

describe("GET /api/assets/[id]/documents", () => {
  it("returns attached and suggested under separate keys", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([attachedFile()] as never);
    scriptTenantCtx({ manufacturer: "Durapulse", model_number: "GS10" }, [
      {
        source_url: "https://oem.test/gs10-userguide.pdf",
        equipment_type: "vfd",
        model_number: "GS10",
        chunk_count: 12,
        last_indexed: "2026-08-01T00:00:00Z",
        verified: true,
      },
    ]);

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attached: Array<Record<string, unknown>>;
      suggested: Array<Record<string, unknown>>;
    };
    expect(body.attached).toHaveLength(1);
    expect(body.attached[0]).toMatchObject({
      fileId: "file-1",
      linkId: "link-1",
      filename: "GS10-manual.pdf",
      indexed: true,
      capability: "indexable",
      docId: DOC_ID,
      role: "manual",
    });
    expect(body.suggested).toHaveLength(1);
    expect(body.suggested[0]).toMatchObject({ title: "gs10-userguide.pdf", chunkCount: 12 });
    expect(listFilesForTarget).toHaveBeenCalledWith(TENANT, "cmms_asset", ASSET_ID);
  });

  it("puts indexed attachments first", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([
      attachedFile({
        id: "file-stored",
        filename: "panel-photo.heic",
        capability: "stored",
        indexed: false,
        uploadId: null,
        link: { ...attachedFile().link, id: "link-stored", fileId: "file-stored" },
      }),
      attachedFile(),
    ] as never);
    scriptTenantCtx({ manufacturer: "Durapulse", model_number: "GS10" }, []);

    const res = await GET(req(), params);
    const body = (await res.json()) as { attached: Array<Record<string, unknown>> };
    expect(body.attached.map((a) => a.fileId)).toEqual(["file-1", "file-stored"]);
  });

  it("does not double-count a suggestion that is already attached", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([attachedFile()] as never);
    scriptTenantCtx({ manufacturer: "Durapulse", model_number: "GS10" }, [
      // same document, reached through the corpus rollup (v2 source_url carries the doc id)
      { source_url: `node-doc/${DOC_ID}/GS10-manual.pdf`, chunk_count: 9 },
      // and the same file by name from a different path
      { source_url: "https://oem.test/GS10-manual.pdf", chunk_count: 9 },
      { source_url: "https://oem.test/other.pdf", chunk_count: 3 },
    ]);

    const res = await GET(req(), params);
    const body = (await res.json()) as {
      attached: unknown[];
      suggested: Array<{ title: string }>;
    };
    expect(body.attached).toHaveLength(1);
    expect(body.suggested.map((s) => s.title)).toEqual(["other.pdf"]);
  });

  it("still returns attachments when the asset has no manufacturer to infer from", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([attachedFile()] as never);
    scriptTenantCtx({ manufacturer: null, model_number: null }, []);

    const res = await GET(req(), params);
    const body = (await res.json()) as { attached: unknown[]; suggested: unknown[] };
    expect(body.attached).toHaveLength(1);
    expect(body.suggested).toEqual([]);
    // The suggestion rollup never ran.
    expect(withTenantContext).toHaveBeenCalledTimes(1);
  });

  it("404s an asset that is not the caller's", async () => {
    scriptTenantCtx(null, []);
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
    expect(listFilesForTarget).not.toHaveBeenCalled();
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(req(), params);
    expect(res.status).toBe(401);
  });
});
