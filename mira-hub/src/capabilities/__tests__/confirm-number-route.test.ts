// #6085: "Use its manuals" with the order number ticked saves the number for the status scope.
// The identity confirm itself is unchanged: same catalog number, same lookup key, same search.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirm-number-route
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn(), listSources: vi.fn() }));

const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => true),
  startManualAcquisition: vi.fn(async () => true),
  readAcquisition: vi.fn(async () => null as unknown),
  confirmNotebookIdentity: vi.fn(async () => ({ ok: true }) as unknown),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()),
  ...acqMock,
}));
const numbersMock = vi.hoisted(() => ({ saveConfirmedNumber: vi.fn(async () => true) }));
vi.mock("@/capabilities/confirmed-numbers", () => numbersMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/identity/confirm/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const params = { params: Promise.resolve({ id: NB }) };
const req = (body: unknown) => ({ url: `http://test/api/equipment-notebooks/${NB}/identity/confirm/`, json: async () => body }) as unknown as NextRequest;
const CARD = { manufacturer: "Siemens", model: "TP700" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "tech@example.com", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue({ id: NB, nodeId: "node-1", asset: null } as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true });
  numbersMock.saveConfirmedNumber.mockResolvedValue(true);
});

describe("POST identity/confirm with a ticked number (#6085)", () => {
  it("saves the ticked number for the confirmed maker and model", async () => {
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect(numbersMock.saveConfirmedNumber).toHaveBeenCalledWith(TENANT, NB, { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700" });
    expect((await res.json()).numberSaved).toBe(true);
  });

  it("the identity write is unchanged: no catalog number, same fields as an unticked confirm", async () => {
    await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(acqMock.confirmNotebookIdentity).toHaveBeenCalledWith(TENANT, NB, { manufacturer: "Siemens", model: "TP700", catalogNumber: "" });
  });

  it("an unticked confirm saves nothing and adds no numberSaved", async () => {
    const res = await POST(req(CARD), params);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
    expect(await res.json()).not.toHaveProperty("numberSaved");
  });

  // #6104 r1 F1/F4: only a value that is exactly one order number is saved, the same rule the
  // scope reads with; a joined or hyphenless value is ignored rather than saved unusable.
  it.each([
    ["blank", "   "], ["no digit", "TPCOMFORT"], ["whitespace", "6AV2124 0GC01"], ["too long", `6AV2124-0GC01-0AX0-${"9".repeat(46)}`], ["not a string", 6],
    ["two numbers joined", "6AV2124-0GC01-0AX0|S7-1200"], ["a number joined to a model", "6AV2124-0GC01-0AX0/TP900"], ["no hyphens", "6AV21240GC010AX0"],
  ])(
    "ignores a %s number and still confirms",
    async (_label, confirmedNumber) => {
      const res = await POST(req({ ...CARD, confirmedNumber }), params);
      expect(res.status).toBe(200);
      expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
      expect(acqMock.confirmNotebookIdentity).toHaveBeenCalled();
    },
  );

  it("control: a 64-character order number is accepted", async () => {
    await POST(req({ ...CARD, confirmedNumber: `6AV2124-0GC01-0AX0-${"9".repeat(45)}` }), params);
    expect(numbersMock.saveConfirmedNumber).toHaveBeenCalled();
  });

  // #6104 r1 F3: the store refuses a second, different number for the same machine.
  it("a refused second number reports numberSaved false and the confirm still succeeds", async () => {
    numbersMock.saveConfirmedNumber.mockResolvedValue(false);
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).numberSaved).toBe(false);
  });

  // Review Focus 3: a stale card's 409 saves nothing.
  it("a refused confirm (409) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "identity_already_confirmed", manufacturer: "Siemens", model: "TP900" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(409);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
  });

  it("a failed confirm (500) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "confirm_failed" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(500);
    expect(numbersMock.saveConfirmedNumber).not.toHaveBeenCalled();
  });

  it("a failed save is logged and the confirm still succeeds", async () => {
    numbersMock.saveConfirmedNumber.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).numberSaved).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});
