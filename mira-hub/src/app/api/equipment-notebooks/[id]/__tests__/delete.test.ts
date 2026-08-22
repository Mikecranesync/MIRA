// DELETE /api/equipment-notebooks/[id] — authorization, tenant isolation,
// dependency cleanup, and the failure shapes.
//
// The dependency-cleanup assertions are the important ones: NONE of the
// dependent tables declare a foreign key to equipment_notebooks (073 has no FK
// on notebook_id; 075 workspace_file_links is polymorphic and cannot have one),
// so nothing in the database forces the cleanup. Only these tests do.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(),
  getNotebook: vi.fn(),
  listSources: vi.fn(),
  listTurns: vi.fn(),
  updateNotebook: vi.fn(),
}));

import { DELETE } from "../route";
import { sessionOr401 } from "@/lib/session";
import { deleteNotebook } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000d2";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
  role: "owner",
};

const req = {} as unknown as NextRequest;
const params = (id: string = NB) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
});

describe("DELETE /api/equipment-notebooks/[id] — authorization", () => {
  it("401s when there is no session, without touching the database", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await DELETE(req, params());
    expect(res.status).toBe(401);
    expect(deleteNotebook).not.toHaveBeenCalled();
  });

  it("scopes the delete to the SESSION tenant, never a client-supplied one", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({
      deleted: true,
      sources: 0,
      turns: 0,
      fileLinks: 0,
    } as never);
    await DELETE(req, params());
    expect(deleteNotebook).toHaveBeenCalledWith(TENANT, NB);
    expect(deleteNotebook).not.toHaveBeenCalledWith(OTHER_TENANT, expect.anything());
  });
});

describe("DELETE /api/equipment-notebooks/[id] — tenant isolation", () => {
  it("404s for another tenant's notebook and reports the SAME shape as a missing one", async () => {
    // A distinct response (403) would confirm that another tenant's notebook
    // exists — an enumeration oracle. Both cases must be indistinguishable.
    vi.mocked(deleteNotebook).mockResolvedValue({
      deleted: false,
      sources: 0,
      turns: 0,
      fileLinks: 0,
    } as never);

    const foreign = await DELETE(req, params());
    const missing = await DELETE(req, params("22222222-3333-4444-5555-666666666666"));

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("404s a malformed id instead of letting Postgres raise 22P02 as a 500", async () => {
    const res = await DELETE(req, params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(deleteNotebook).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/equipment-notebooks/[id] — success + dependency cleanup", () => {
  it("returns the per-table cleanup counts so orphans are observable", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({
      deleted: true,
      sources: 3,
      turns: 7,
      fileLinks: 2,
    } as never);
    const res = await DELETE(req, params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: NB,
      deleted: { sources: 3, turns: 7, fileLinks: 2 },
    });
  });

  it("succeeds for a notebook with no dependants (all-zero counts, still ok)", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({
      deleted: true,
      sources: 0,
      turns: 0,
      fileLinks: 0,
    } as never);
    const res = await DELETE(req, params());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("DELETE /api/equipment-notebooks/[id] — failure shapes", () => {
  it("409s on a foreign-key conflict rather than reporting a half-delete", async () => {
    vi.mocked(deleteNotebook).mockRejectedValue(
      Object.assign(new Error("update or delete violates foreign key"), { code: "23503" }),
    );
    const res = await DELETE(req, params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("conflict");
  });

  it("500s on an unexpected database error and does not claim success", async () => {
    vi.mocked(deleteNotebook).mockRejectedValue(new Error("connection terminated"));
    const res = await DELETE(req, params());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("delete_failed");
    expect(body.ok).toBeUndefined();
  });

  it("is idempotent-safe: a repeat delete 404s instead of 500ing", async () => {
    vi.mocked(deleteNotebook)
      .mockResolvedValueOnce({ deleted: true, sources: 1, turns: 0, fileLinks: 0 } as never)
      .mockResolvedValueOnce({ deleted: false, sources: 0, turns: 0, fileLinks: 0 } as never);
    expect((await DELETE(req, params())).status).toBe(200);
    expect((await DELETE(req, params())).status).toBe(404);
  });
});
