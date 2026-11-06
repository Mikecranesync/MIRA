import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { packetFixture } from "./packet-fixture";
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), notebook: vi.fn(), asset: vi.fn(), intake: vi.fn(), closeout: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionOr401: mocks.session }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: mocks.notebook, resolveBoundAsset: mocks.asset }));
vi.mock("../flag", () => ({ livingSheetEnabled: mocks.enabled }));
vi.mock("../intake-closeout-store", () => ({ intakePacket: mocks.intake, recordCloseout: mocks.closeout }));
import { POST as intake } from "@/app/api/equipment-notebooks/[id]/sheets/intake/route";
import { POST as closeout } from "@/app/api/equipment-notebooks/[id]/sheets/[jobId]/closeout/route";
const id = "11111111-1111-4111-8111-111111111111"; const jobId = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown) => new NextRequest("http://localhost/api/test", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id, jobId }) };
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ tenantId: "tenant", userId: "server-user", email: "server@email" }); mocks.enabled.mockReturnValue(true); mocks.notebook.mockResolvedValue({ id }); mocks.asset.mockResolvedValue({ state: "resolved", entityId: "asset", name: "Fixture", unsPath: "example/fixture", confirmedAt: "now" }); mocks.intake.mockResolvedValue({ status: "created", jobId, view: {} }); mocks.closeout.mockResolvedValue({ status: "created", candidate: {} }); });
describe("packet intake/QC HTTP boundary", () => {
  it("uses only server session identity and confirmed asset", async () => {
    const raw = { clientRequestId: jobId, packet: packetFixture(id), record: null };
    expect((await intake(request(raw), params)).status).toBe(201);
    expect(mocks.intake).toHaveBeenCalledWith("tenant", id, { entityId: "asset", name: "Fixture", unsPath: "example/fixture" }, raw, { userId: "server-user", label: "server@email" });
    expect((await intake(request({ ...raw, importedBy: "forged" }), params)).status).toBe(400);
  });
  it("fails closed for auth, flag, foreign notebook and unconfirmed binding", async () => {
    mocks.session.mockResolvedValueOnce(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await intake(request({}), params)).status).toBe(401);
    mocks.enabled.mockReturnValueOnce(false); expect((await intake(request({}), params)).status).toBe(404);
    mocks.notebook.mockResolvedValueOnce(null); expect((await intake(request({}), params)).status).toBe(404);
    mocks.asset.mockResolvedValueOnce({ state: "unbound" }); expect((await intake(request({}), params)).status).toBe(409);
    expect(mocks.intake).not.toHaveBeenCalled();
  });
  it("bounds streamed input before parsing", async () => {
    const req = new NextRequest("http://localhost/api/test", { method: "POST", body: "x".repeat(8 * 1024 * 1024 + 1) });
    expect((await intake(req, params)).status).toBe(413);
    expect(mocks.intake).not.toHaveBeenCalled();
  });
  it("maps exact-snapshot and finishing-user refusals and refuses client reviewer fields", async () => {
    const raw = { clientRequestId: jobId, seq: 2, snapshotId: `sha256:${"a".repeat(64)}`, baseCandidateId: null, decisions: [] };
    mocks.closeout.mockResolvedValueOnce({ status: "wrong_technician" }); expect((await closeout(request(raw), params)).status).toBe(403);
    mocks.closeout.mockResolvedValueOnce({ status: "snapshot_conflict" }); expect((await closeout(request(raw), params)).status).toBe(409);
    mocks.closeout.mockResolvedValueOnce({ status: "candidate_conflict" }); expect((await closeout(request({ ...raw, baseCandidateId: id }), params)).status).toBe(409);
    expect((await closeout(request({ ...raw, userId: "forged" }), params)).status).toBe(400);
    expect(mocks.closeout).toHaveBeenCalledWith("tenant", id, jobId, raw, { userId: "server-user", label: "server@email" });
  });
});
