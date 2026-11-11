import { describe, expect, it } from "vitest";
import { notebookManualIdentity } from "../notebook-manual-identity";

const blank = { manufacturer: null, model: null, catalogNumber: null, identityStatus: "unknown" as const };
const boundPlc = { state: "resolved" as const, confirmedAt: "2026-11-10T07:40:00.000Z", manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" };

describe("which machine a notebook's manuals have to be for", () => {
  it("a machine-first notebook takes the confirmed bound machine's maker and model", () => {
    expect(notebookManualIdentity(blank, boundPlc)).toEqual({
      identity: { manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" },
      catalogNumber: null,
      identityStatus: "user_confirmed",
    });
  });

  it("the notebook's own confirmed identity wins over the bound machine", () => {
    const own = { manufacturer: "AutomationDirect", model: "GS11N", catalogNumber: "GS11N-20P2", identityStatus: "user_confirmed" as const };
    expect(notebookManualIdentity(own, boundPlc)).toEqual({
      identity: { manufacturer: "AutomationDirect", model: "GS11N" },
      catalogNumber: "GS11N-20P2",
      identityStatus: "user_confirmed",
    });
  });

  it("a notebook identity nobody confirmed does not win; the confirmed machine does", () => {
    const guess = { manufacturer: "AutomationDirect", model: "GS11N", catalogNumber: null, identityStatus: "candidate" as const };
    expect(notebookManualIdentity(guess, boundPlc).identity.model).toBe("2080-LC20-20QBB");
  });

  it.each([
    ["a binding nobody confirmed", { ...boundPlc, confirmedAt: null }],
    ["a machine with no model on record (made in the namespace)", { ...boundPlc, manufacturer: null, model: null }],
    ["a machine whose model is blank", { ...boundPlc, model: "  " }],
    ["no machine", { state: "unbound" as const }],
    ["a machine that no longer resolves", { state: "unresolvable" as const }],
  ])("%s scopes nothing: the notebook's own fields pass through unchanged", (_what, bound) => {
    expect(notebookManualIdentity(blank, bound)).toEqual({
      identity: { manufacturer: null, model: null }, catalogNumber: null, identityStatus: "unknown",
    });
  });

  it("a binding the technician's device disputes this turn is not used", () => {
    expect(notebookManualIdentity(blank, boundPlc, true).identityStatus).toBe("unknown");
  });

  it("no notebook row passes nulls through", () => {
    expect(notebookManualIdentity(null, { state: "unbound" })).toEqual({
      identity: { manufacturer: null, model: null }, catalogNumber: null, identityStatus: null,
    });
  });
});
