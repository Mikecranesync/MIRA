/**
 * The checklist state one conversation reads: every component with an honest
 * status, answered and refused kept apart (a refusal is never coverage), and
 * the numbers the attached documents declare as the only look-alike source.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/bench-state.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  listComponents: vi.fn(async (): Promise<unknown[]> => []),
  getSelection: vi.fn(async (): Promise<unknown> => null),
  listSelectionTurns: vi.fn(async (): Promise<unknown[]> => []),
  readDocumentHeadings: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("../store", () => storeMock);

import { benchState } from "../http";

const NB = "22222222-2222-4222-8222-222222222222";
const VFD = "44444444-4444-4444-8444-444444444444";
const PS1 = "77777777-7777-4777-8777-777777777777";
const rev = (componentId: string, over: Record<string, unknown>) => ({
  componentId, revision: 1, rawLabel: null, inputKind: "typed", manufacturer: null, family: null, catalogNumber: null,
  serialNumber: null, hardwareRevision: null, localTag: null, identityStatus: "user_confirmed", unresolved: [],
  confirmedAt: "2026-11-14T03:00:00.000Z", createdAt: "2026-11-14T03:00:00.000Z", ...over,
});
const turn = (id: string, componentId: string | null, answerStatus: string, basis: string | null) => ({
  id, question: "q", answerStatus, basis, createdAt: "2026-11-14T04:01:00.000Z", componentId, componentRevision: componentId ? 1 : null, clientRequestId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.listComponents.mockResolvedValue([
    { id: VFD, notebookId: NB, position: 1, kind: "VFD", origin: "device_schedule", createdAt: "x", retiredAt: null,
      current: rev(VFD, { manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P2", localTag: "VFD1" }) },
    // Seeded from the schedule with nothing confirmed: listed, never "ready".
    { id: PS1, notebookId: NB, position: 7, kind: "power_supply", origin: "inventory", createdAt: "x", retiredAt: null,
      current: rev(PS1, { localTag: "PS1", identityStatus: "unknown", confirmedAt: null, inputKind: "schedule", evidenceNote: "Old device schedule (devices.yaml rev A) says model \"Mean Well DIN-rail supply\"." }) },
  ]);
  storeMock.listSelectionTurns.mockResolvedValue([
    turn("t1", VFD, "answered", "workspace_evidence"),
    turn("t2", VFD, "insufficient_evidence", null),
    turn("t3", VFD, "insufficient_evidence", null),
    // A safety stop is stored "answered" with no basis: not coverage.
    turn("t4", VFD, "answered", null),
    turn("t5", null, "answered", "workspace_evidence"),
  ]);
  storeMock.readDocumentHeadings.mockResolvedValue(new Map([["d1", "GS10 Series AC Drive\nModels: GS11N-20P2, GS13N-20P2\nUser Manual"]]));
});

describe("benchState", () => {
  it("keeps answered and refused apart, and a stop or an unlabelled turn counts as neither", async () => {
    const state = await benchState("t", NB, "u1", "legacy", [{ docId: "d1", filename: "gs10usermanual.pdf" } as never]);
    expect(state.tallies).toEqual({ [VFD]: { answered: 1, refused: 2 } });
    expect(Object.keys(state.turnComponents).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("an unconfirmed schedule row is listed with a not-ready status", async () => {
    const state = await benchState("t", NB, "u1", "legacy", []);
    const ps1 = state.components.find((c) => c.id === PS1)!;
    expect(ps1.status).toBe("not_confirmed");
    expect(ps1.statusLabel).toBe("identity not confirmed");
    expect(ps1.hasOwnDocument).toBe(false);
    expect(state.components.map((c) => c.id)).toEqual([VFD, PS1]);
  });

  it("every row says what it rests on: a confirmation, a schedule note, or plainly nothing", async () => {
    const state = await benchState("t", NB, "u1", "legacy", []);
    const byId = new Map(state.components.map((c) => [c.id, c]));
    expect(byId.get(PS1)!.evidence).toBe('Old device schedule (devices.yaml rev A) says model "Mean Well DIN-rail supply".');
    // The note is evidence only: it never becomes the label or an identity.
    expect(byId.get(PS1)!.label).toBe("PS1");
    expect(byId.get(VFD)!.evidence).toBe("Confirmed by a technician.");
    storeMock.listComponents.mockResolvedValueOnce([
      { id: PS1, notebookId: NB, position: 0, kind: "power_supply", origin: "technician", createdAt: "x", retiredAt: null,
        current: rev(PS1, { localTag: "PS1", identityStatus: "unknown", confirmedAt: null }) },
    ]);
    expect((await benchState("t", NB, "u1", "legacy", [])).components[0].evidence).toBe("Nothing recorded yet.");
  });

  it("look-alike candidates come only from what an attached document's opening text writes", async () => {
    const state = await benchState("t", NB, "u1", "legacy", [{ docId: "d1", filename: "gs10usermanual.pdf" } as never]);
    expect(state.documentNumbers.map((n) => n.label)).toEqual(expect.arrayContaining(["GS11N-20P2", "GS13N-20P2"]));
    expect(new Set(state.documentNumbers.map((n) => n.from))).toEqual(new Set(["gs10usermanual.pdf"]));
    // Control: no attached document, no candidates (a component's own number is never one).
    expect((await benchState("t", NB, "u1", "legacy", [])).documentNumbers).toEqual([]);
  });
});
