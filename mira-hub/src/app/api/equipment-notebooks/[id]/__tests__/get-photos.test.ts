// GET /api/equipment-notebooks/[id] — S5 D1 (hub half): linked LOOK photos
// (workspace_file_links role "photo") are exposed as a SEPARATE additive
// `photos` array. `sources` and `turns` are passed through untouched — the
// photo list never enters the sources semantics or the trust gate — and a
// failure listing files never hides the notebook.
//
// Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/[id]/__tests__/get-photos
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(),
  getNotebook: vi.fn(),
  listSources: vi.fn(),
  listTurns: vi.fn(),
  updateNotebook: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";
import { listFilesForTarget } from "@/lib/workspace-files";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const req = {} as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };

function file(id: string, role: string | null, filename = `${id}.jpg`) {
  return {
    id,
    filename,
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    contentSha256: null,
    uploadId: null,
    verified: false,
    createdAt: "2026-08-27T23:14:21.000Z",
    capability: "viewable",
    indexed: false,
    linkCount: 1,
    link: { id: `l-${id}`, fileId: id, targetType: "equipment_notebook", targetId: NB, role, displayLabel: null, isPrimary: false, createdAt: "2026-08-27T23:14:22.000Z" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue({ id: NB, displayName: "Conveyor 1" } as never);
  vi.mocked(listSources).mockResolvedValue([{ docId: "d1", filename: "manual.pdf" }] as never);
  vi.mocked(listTurns).mockResolvedValue([{ id: "t1" }] as never);
});

describe("GET /api/equipment-notebooks/[id] — photos (S5 D1)", () => {
  it("lists only role='photo' links as `photos`; sources and turns are untouched", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([file("p1", "photo"), file("m1", "source", "manual.pdf"), file("x1", null)] as never);
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toEqual([{ docId: "d1", filename: "manual.pdf" }]);
    expect(body.turns).toEqual([{ id: "t1" }]);
    expect(body.photos).toEqual([
      { fileId: "p1", filename: "p1.jpg", mimeType: "image/jpeg", sizeBytes: 1234, createdAt: "2026-08-27T23:14:21.000Z", linkedAt: "2026-08-27T23:14:22.000Z" },
    ]);
    expect(vi.mocked(listFilesForTarget)).toHaveBeenCalledWith(TENANT, "equipment_notebook", NB);
  });

  it("no linked files → photos: [] (additive, never absent)", async () => {
    vi.mocked(listFilesForTarget).mockResolvedValue([] as never);
    const body = await (await GET(req, params)).json();
    expect(body.photos).toEqual([]);
  });

  it("a file-listing failure never hides the notebook: photos: [] and the rest is served", async () => {
    vi.mocked(listFilesForTarget).mockRejectedValue(new Error("075 not applied"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual([]);
    expect(body.sources).toHaveLength(1);
    spy.mockRestore();
  });
});
