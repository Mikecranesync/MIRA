// #6085: "Use its manuals" with the order number ticked hands the number to the identity confirm,
// which decides it in its own locked transaction (#6104 r2 F3/F4, proven on real Postgres in
// confirmed-numbers.integration.test.ts). The identity write is unchanged: same catalog number,
// same lookup key, same search. The response reports only what the confirm says it saved.
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
  acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true, numberSaved: true });
});
const TICK = { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0" };
const tickArg = () => (acqMock.confirmNotebookIdentity.mock.calls[0] as unknown[] | undefined)?.[3];

describe("POST identity/confirm with a ticked number (#6085)", () => {
  it("hands exactly the ticked number to the identity confirm and reports it saved", async () => {
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect(acqMock.confirmNotebookIdentity).toHaveBeenCalledTimes(1);
    expect(tickArg()).toEqual(TICK);
    expect((await res.json()).numberSaved).toBe(true);
  });

  it("the identity write is unchanged: no catalog number, same fields as an unticked confirm", async () => {
    await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(acqMock.confirmNotebookIdentity).toHaveBeenCalledWith(TENANT, NB, { manufacturer: "Siemens", model: "TP700", catalogNumber: "" }, TICK);
  });

  // Round-3 pre-screen 3: a value the database cannot store reaches the confirm from a direct API
  // call (the card only sends what it offered), so the confirm's own write is what refuses it
  // (confirmed-numbers.integration.test.ts proves that refusal leaves no number).
  it("a number carrying a NUL byte reaches the confirm as typed", async () => {
    await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0\u0000" }), params);
    expect(tickArg()).toEqual({ number: "6AV2124-0GC01-0AX0\u0000", code: "6AV21240GC010AX0" });
  });

  // A confirm whose number write cannot settle fails as a whole: the route never reports it as a
  // success (Next.js answers 500, and the Hub and mobile cards show their retryable failure).
  it("a confirm that fails is never reported as a success", async () => {
    acqMock.confirmNotebookIdentity.mockRejectedValue(new Error("injected confirmed_numbers failure"));
    await expect(POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params)).rejects.toThrow("injected confirmed_numbers failure");
  });

  it("an unticked confirm hands no number and adds no numberSaved", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true });
    const res = await POST(req(CARD), params);
    expect(acqMock.confirmNotebookIdentity.mock.calls[0]).toHaveLength(3); // exactly main's call
    expect(await res.json()).not.toHaveProperty("numberSaved");
  });

  // #6104 r1 F1/F4: only a value that is exactly one order number is saved, the same rule the
  // scope reads with; a joined or hyphenless value is ignored rather than saved unusable.
  it.each([
    ["blank", "   "], ["no digit", "TPCOMFORT"], ["whitespace", "6AV2124 0GC01"], ["too long", `6AV2124-0GC01-0AX0-${"9".repeat(46)}`], ["not a string", 6],
    ["two numbers joined", "6AV2124-0GC01-0AX0|S7-1200"], ["a number joined to a model", "6AV2124-0GC01-0AX0/TP900"], ["no hyphens", "6AV21240GC010AX0"],
    // #6104 r3 F6: another machine's model or order number is never saved for this card.
    ["PLC model", "S7-1200"], ["PLC model with a typographic hyphen", "S7\u20111200"], ["CPU order", "6ES7214-1AG40-0XB0"],
  ])(
    "ignores a %s number and still confirms",
    async (_label, confirmedNumber) => {
      const res = await POST(req({ ...CARD, confirmedNumber }), params);
      expect(res.status).toBe(200);
      expect(acqMock.confirmNotebookIdentity).toHaveBeenCalled();
      expect(acqMock.confirmNotebookIdentity.mock.calls[0]).toHaveLength(3); // exactly main's call
    },
  );

  it("control: a number that starts with the card's model is handed to the confirm", async () => {
    await POST(req({ manufacturer: "ABB", model: "ACS355", confirmedNumber: "ACS355-03E-07A3-4" }), params);
    expect(tickArg()).toEqual({ number: "ACS355-03E-07A3-4", code: "ACS35503E07A34" });
  });

  it("ignores another model's number that only shares the card's digits (Micro850 card, ACS850 number)", async () => {
    const res = await POST(req({ manufacturer: "Allen-Bradley", model: "Micro850", confirmedNumber: "ACS850-04-03A0-5" }), params);
    expect(res.status).toBe(200);
    expect(acqMock.confirmNotebookIdentity.mock.calls[0]).toHaveLength(3); // exactly main's call
  });

  it("control: a 64-character order number is accepted", async () => {
    await POST(req({ ...CARD, confirmedNumber: `6AV2124-0GC01-0AX0-${"9".repeat(45)}` }), params);
    expect(tickArg()).toMatchObject({ number: `6AV2124-0GC01-0AX0-${"9".repeat(45)}` });
  });

  // #6104 r1 F3 / r2 F3: the confirm refuses a second number, or any number once the identity was
  // already settled; the response says so and the confirm still succeeds.
  it("a refused number reports numberSaved false and the confirm still succeeds", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true, numberSaved: false });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).numberSaved).toBe(false);
  });

  // Review Focus 3: a stale card's 409 saves nothing.
  it("a refused confirm (409) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "identity_already_confirmed", manufacturer: "Siemens", model: "TP900" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).not.toHaveProperty("numberSaved");
  });

  it("a failed confirm (500) saves nothing", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: false, error: "confirm_failed" });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("numberSaved");
  });

  // The route never reports a number saved that the confirm did not say it saved. (A settling
  // confirm whose number write fails rejects instead, above, #6116.)
  it("reports numberSaved false, never true, when the confirm does not say it saved the number", async () => {
    acqMock.confirmNotebookIdentity.mockResolvedValue({ ok: true });
    const res = await POST(req({ ...CARD, confirmedNumber: "6AV2124-0GC01-0AX0" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).numberSaved).toBe(false);
  });
});
