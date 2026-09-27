// GET/POST /api/equipment-notebooks/[id]/fixes — "plant memory" (095 +
// capabilities/fix-records.ts): a technician records what fixed this
// machine; the next technician on the same machine sees it as a grounding
// source. Append-only.
//
// Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/[id]/__tests__/fixes
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn() }));
vi.mock("@/capabilities/fix-records", () => ({
  insertFixRecord: vi.fn(),
  listFixRecords: vi.fn(),
  validateFixInput: vi.fn(),
}));

import { GET, POST } from "../fixes/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { insertFixRecord, listFixRecords, validateFixInput } from "@/capabilities/fix-records";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";

function req(body?: unknown): NextRequest {
  return {
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u_1",
    tenantId: TENANT,
    email: "tech@example.com",
    status: "trial",
    trialExpiresAt: null,
    role: "owner",
  } as never);
});

describe("GET /api/equipment-notebooks/[id]/fixes", () => {
  it("401s without a session", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(401);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s notebook_not_found when the notebook isn't the caller's", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(listFixRecords).not.toHaveBeenCalled();
  });

  it("lists up to 10 fixes for the notebook", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const fixes = [{ id: "f1", notebookId: NB, symptom: "s", fix: "f" }];
    vi.mocked(listFixRecords).mockResolvedValue(fixes as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fixes, assetConfirmed: null });
    expect(listFixRecords).toHaveBeenCalledWith(TENANT, NB, null, 10);
  });

  it("lists a confirmed machine's fixes, scoped to that machine", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: "u1", confirmedAt: "2026-09-01T00:00:00Z" };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(listFixRecords).mockResolvedValue([] as never);
    const res = await GET(req(), params);
    expect(await res.json()).toEqual({ fixes: [], assetConfirmed: true });
    expect(listFixRecords).toHaveBeenCalledWith(TENANT, NB, "e1", 10);
  });

  it("exposes no repair history for a selected-but-unconfirmed machine (QR)", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: null, confirmedAt: null };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(listFixRecords).mockClear();
    const res = await GET(req(), params);
    expect(await res.json()).toEqual({ fixes: [], assetConfirmed: false });
    expect(listFixRecords).not.toHaveBeenCalled();
  });
});

describe("POST /api/equipment-notebooks/[id]/fixes", () => {
  it("409s a machine-scoped fix while the machine is only selected, not confirmed", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: null, confirmedAt: null };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(insertFixRecord).mockClear();
    const res = await POST(req({ symptom: "trips oC", fix: "raised accel" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("asset_not_confirmed");
    expect(insertFixRecord).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(401);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s notebook_not_found when the notebook isn't the caller's", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(validateFixInput).not.toHaveBeenCalled();
  });

  it("400s invalid_json on unparsable body", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const res = await POST(req(undefined), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(validateFixInput).not.toHaveBeenCalled();
  });

  it("400s with the validator's error when the body is invalid", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: false, error: "symptom_required" });
    const res = await POST(req({ fix: "f" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "symptom_required" });
    expect(insertFixRecord).not.toHaveBeenCalled();
  });

  it("201s and inserts using the notebook's bound asset entity id", async () => {
    vi.mocked(getNotebook).mockResolvedValue({
      id: NB,
      asset: { entityId: "asset-123", name: "Conveyor 1", confirmedAt: "2026-09-01T00:00:00Z" },
    } as never);
    vi.mocked(validateFixInput).mockReturnValue({
      ok: true,
      value: { symptom: "s", fix: "f", faultCode: null, sourceTurnId: null },
    });
    const created = { id: "f1", notebookId: NB, equipmentEntityId: "asset-123", symptom: "s", fix: "f" };
    vi.mocked(insertFixRecord).mockResolvedValue(created as never);

    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fix: created });
    expect(insertFixRecord).toHaveBeenCalledWith(
      TENANT,
      { id: NB, equipmentEntityId: "asset-123" },
      { symptom: "s", fix: "f", faultCode: null, sourceTurnId: null },
      "u_1",
    );
  });

  it("passes equipmentEntityId: null when the notebook has no asset binding", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    vi.mocked(validateFixInput).mockReturnValue({
      ok: true,
      value: { symptom: "s", fix: "f", faultCode: null, sourceTurnId: null },
    });
    vi.mocked(insertFixRecord).mockResolvedValue({ id: "f1" } as never);

    await POST(req({ symptom: "s", fix: "f" }), params);
    expect(insertFixRecord).toHaveBeenCalledWith(
      TENANT,
      { id: NB, equipmentEntityId: null },
      { symptom: "s", fix: "f", faultCode: null, sourceTurnId: null },
      "u_1",
    );
  });
});
