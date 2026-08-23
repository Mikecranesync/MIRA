/**
 * POST /api/assets/[id]/notebook — open-or-create-and-bind (plan slice I4).
 *
 * Run: npx vitest run src/app/api/assets
 *
 * The behaviour that matters is idempotence at a machine. A technician taps
 * twice because the first tap felt slow; two notebooks on one conveyor would
 * have disjoint document sets and split turn history, and the duplicate is
 * invisible in a list because the natural key forces it to carry a different
 * display name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  createAndBindNotebookTx: vi.fn(),
  ASSET_SELECTION_METHODS: ["asset_picker", "qr", "nfc", "work_order", "nameplate", "manual_entry"],
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

import { POST } from "../[id]/notebook/route";

const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const NOTEBOOK = { id: "22222222-2222-4222-8222-222222222222", displayName: "Discharge Conveyor" };

function req(body?: unknown): NextRequest {
  return new NextRequest("http://test/api/assets/x/notebook", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: ASSET }) };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
});

describe("open the asset's notebook", () => {
  it("creates and binds on the first scan (201, created:true)", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: true, created: true, notebook: NOTEBOOK });
    const res = await POST(req({ selectedVia: "qr" }), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.notebook.id).toBe(NOTEBOOK.id);
    expect(domainMock.createAndBindNotebookTx).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      ASSET,
      expect.objectContaining({ selectedVia: "qr", createdBy: "u1" }),
    );
  });

  it("returns the SAME notebook on a second scan and creates nothing (200, created:false)", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: true, created: false, notebook: NOTEBOOK });
    const res = await POST(req({ selectedVia: "qr" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(body.notebook.id).toBe(NOTEBOOK.id);
  });

  it("a bare POST works — a scan carries no body", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: true, created: true, notebook: NOTEBOOK });
    const res = await POST(req(), params);
    expect(res.status).toBe(201);
    // Defaults to the asset list rather than claiming a scan happened.
    expect(domainMock.createAndBindNotebookTx.mock.calls[0][2].selectedVia).toBe("asset_picker");
  });

  it("409s the losing side of a double-tap without leaving anything behind", async () => {
    domainMock.createAndBindNotebookTx.mockRejectedValue(
      Object.assign(new Error("notebook_race"), { code: "NOTEBOOK_RACE" }),
    );
    const res = await POST(req({ selectedVia: "qr" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("notebook_race");
  });

  it("404s a foreign-tenant asset and creates nothing", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: false, error: "asset_not_found" });
    const res = await POST(req({ selectedVia: "qr" }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("asset_not_found");
  });

  it("422s an area — a notebook belongs to a machine, not a line", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: false, error: "asset_not_equipment" });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("asset_not_equipment");
  });

  it("422s an unapproved asset", async () => {
    domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: false, error: "asset_not_verified" });
    expect((await POST(req(), params)).status).toBe(422);
  });

  it("rejects an unlisted selection method before touching the database", async () => {
    const res = await POST(req({ selectedVia: "gps" }), params);
    expect(res.status).toBe(400);
    expect(domainMock.createAndBindNotebookTx).not.toHaveBeenCalled();
  });

  it("every error is a readable sentence, not a bare token", async () => {
    for (const error of ["asset_not_found", "asset_not_equipment", "asset_not_verified"]) {
      domainMock.createAndBindNotebookTx.mockResolvedValue({ ok: false, error });
      const body = await (await POST(req(), params)).json();
      expect(body.error).not.toMatch(/_/);
      expect(body.code).toBe(error);
    }
  });

  it("does not leak an internal error message on an unexpected failure", async () => {
    domainMock.createAndBindNotebookTx.mockRejectedValue(new Error("relation kg_entities does not exist"));
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("kg_entities");
  });
});
