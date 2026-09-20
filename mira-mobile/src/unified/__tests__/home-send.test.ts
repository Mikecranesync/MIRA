import { describe, expect, it } from "vitest";
import type { Notebook } from "../../api/resources";
import { homeSendPlan, isUnboundNotebook } from "../home-send";

const nb = (id: string, over: Partial<Notebook> = {}): Notebook =>
  ({ id, displayName: id, manufacturer: null, model: null, asset: null, threads: [], ...over } as unknown as Notebook);
const bound = (id: string): Notebook => nb(id, { manufacturer: "Siemens", model: "G120", asset: { entityId: "e1" } as never });

describe("homeSendPlan — a HOME question never lands in the last-opened machine notebook (#3877)", () => {
  it("picks an UNBOUND notebook even when the machine notebook is first (last-opened order)", () => {
    expect(homeSendPlan([bound("drive-a"), nb("notes")])).toEqual({ kind: "existing", notebookId: "notes" });
  });
  it("prefers the unbound notebook named General — a name is machine context too", () => {
    expect(homeSendPlan([bound("drive-a"), nb("conveyor-4"), nb("g", { displayName: "General" })])).toEqual({ kind: "existing", notebookId: "g" });
  });
  it("with only machine notebooks, or none at all, creates General with the create-project body", () => {
    const body = { displayName: "General", identitySourceType: "user" };
    expect(homeSendPlan([bound("a"), bound("b")])).toEqual({ kind: "create", body });
    expect(homeSendPlan([])).toEqual({ kind: "create", body });
  });
  it("does nothing before the list is known", () => {
    expect(homeSendPlan(null)).toEqual({ kind: "loading" });
  });
  it("isUnboundNotebook: a binding OR a manufacturer/model makes a notebook machine-scoped", () => {
    expect(isUnboundNotebook({ asset: null, manufacturer: null, model: null })).toBe(true);
    expect(isUnboundNotebook({ asset: null, manufacturer: " ", model: null })).toBe(true);
    expect(isUnboundNotebook({ asset: null, manufacturer: "Siemens", model: null })).toBe(false);
    expect(isUnboundNotebook({ asset: null, manufacturer: null, model: "G120" })).toBe(false);
    expect(isUnboundNotebook({ asset: { entityId: "e" } as never, manufacturer: null, model: null })).toBe(false);
  });
});
