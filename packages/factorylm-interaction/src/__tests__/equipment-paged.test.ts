import { describe, expect, it } from "bun:test";
import {
  askabilityOf,
  branchesReducer,
  itemKey,
  parentKey,
  repeatedLabelKeys,
  resolveFailureText,
  resolveRequestOf,
  targetKeyOf,
  type BrowserItem,
  type BrowserPage,
  type Branches,
  type ResolveFailureReason,
} from "../equipment-paged";

const item = (kind: BrowserItem["kind"], id: string, label: string, extra: Partial<BrowserItem> = {}): BrowserItem =>
  ({ kind, id, label, parent: null, childCount: 0, ...extra });

const page = (items: BrowserItem[], more: string | null, total = items.length): BrowserPage =>
  ({ items, total, hasMore: more !== null, nextCursor: more });

describe("askability", () => {
  const bench = { kind: "notebook", id: "n1" } as const;
  it("offers Ask about on active components inside a notebook; notebooks only when the source resolves them", () => {
    expect(askabilityOf(item("notebook", "n1", "GS10 bench"))).toBe("browse_only");
    expect(askabilityOf(item("notebook", "n1", "GS10 bench"), { notebooks: true })).toBe("askable");
    expect(askabilityOf(item("notebook_component", "c1", "VFD1", { retiredAt: null, parent: bench }))).toBe("askable");
    expect(askabilityOf(item("notebook_component", "c1", "VFD1", { retiredAt: null }))).toBe("browse_only");
    expect(askabilityOf(item("notebook_component", "c2", "K0", { retiredAt: "2026-11-01T00:00:00Z", parent: bench }))).toBe("retired");
    expect(askabilityOf(item("installed_instance", "i1", "VFD1", { resolution: { status: "unmapped", reason: "no_link" } }))).toBe("no_link");
    expect(askabilityOf(item("namespace", "s1", "Garage"))).toBe("browse_only");
    expect(askabilityOf(item("asset", "a1", "Conveyor 2"))).toBe("browse_only");
  });
});

describe("resolve request", () => {
  const bench = { kind: "notebook", id: "n1" } as const;
  it("carries the notebook, component and the revision on screen", () => {
    expect(resolveRequestOf(item("notebook_component", "c1", "VFD1", { parent: bench, revision: 5 }), null))
      .toEqual({ kind: "notebook_component", notebookId: "n1", componentId: "c1", expectedRevision: 5 });
  });
  it("sends revision 0 as 0, and omits an unknown revision instead of asserting 0", () => {
    expect(resolveRequestOf(item("notebook_component", "c1", "VFD1", { parent: bench, revision: 0 }), null)).toMatchObject({ expectedRevision: 0 });
    expect(resolveRequestOf(item("notebook_component", "c1", "VFD1", { parent: bench }), null)).not.toHaveProperty("expectedRevision");
  });
  it("adds the host's selection precondition when there is one", () => {
    expect(resolveRequestOf(item("notebook_component", "c1", "VFD1", { parent: bench, revision: 1 }), { threadKey: "t", version: null }))
      .toMatchObject({ selection: { threadKey: "t", version: null } });
  });
  it("has no request for rows that cannot be asked about", () => {
    expect(resolveRequestOf(item("notebook", "n1", "GS10 bench"), null)).toBeNull();
    expect(resolveRequestOf(item("notebook", "n1", "GS10 bench"), null, { notebooks: true })).toEqual({ kind: "notebook", notebookId: "n1" });
    expect(resolveRequestOf(item("installed_instance", "i1", "VFD1"), null)).toBeNull();
    expect(resolveRequestOf(item("notebook_component", "c2", "K0", { parent: bench, retiredAt: "2026-11-01T00:00:00Z" }), null)).toBeNull();
  });
});

describe("branches clear", () => {
  it("drops every loaded branch", () => {
    const state = branchesReducer(new Map(), { type: "start", key: "root", request: 1, append: false });
    expect(branchesReducer(state, { type: "clear" }).size).toBe(0);
  });
});

describe("refusal text", () => {
  const reasons: ResolveFailureReason[] = ["stale_revision", "selection_changed", "retired", "no_link", "not_found", "error"];
  it("always says the target did not change, and never invites a retry", () => {
    for (const reason of reasons) {
      const text = resolveFailureText(reason, "Contactor K2");
      expect(text).toContain("did not change");
      expect(text.toLowerCase()).not.toContain("try again");
    }
  });
});

describe("keys", () => {
  it("keys rows by kind and id, so equal labels and equal ids of different kinds stay apart", () => {
    expect(itemKey({ kind: "notebook", id: "x" })).not.toBe(itemKey({ kind: "notebook_component", id: "x" }));
    expect(parentKey(null)).toBe("root");
  });
  it("names the target row: the component, else the machine notebook", () => {
    const whole = { machineId: "n1", machineLabel: "Bench", componentId: null, componentLabel: null, location: "" };
    expect(targetKeyOf(whole)).toBe("notebook:n1");
    expect(targetKeyOf({ ...whole, componentId: "c1", componentLabel: "VFD1" })).toBe("notebook_component:c1");
    expect(targetKeyOf(null)).toBeNull();
  });
});

describe("branches reducer", () => {
  const empty: Branches = new Map();

  it("appends a cursor page without doubling a row that moved between pages", () => {
    let state = branchesReducer(empty, { type: "start", key: "root", request: 1, append: false });
    state = branchesReducer(state, { type: "page", key: "root", request: 1, append: false, page: page([item("namespace", "a", "A"), item("namespace", "b", "B")], "c1", 3) });
    expect(state.get("root")?.hasMore).toBe(true);
    state = branchesReducer(state, { type: "start", key: "root", request: 2, append: true });
    expect(state.get("root")?.items.map((i) => i.id)).toEqual(["a", "b"]);
    state = branchesReducer(state, { type: "page", key: "root", request: 2, append: true, page: page([item("namespace", "b", "B"), item("namespace", "c", "C")], null, 3) });
    const branch = state.get("root")!;
    expect(branch.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(branch.hasMore).toBe(false);
    expect(branch.nextCursor).toBeNull();
  });

  it("keeps a same-label row from a later page: rows are told apart by kind + id, never by label", () => {
    let state = branchesReducer(empty, { type: "start", key: "search", request: 1, append: false });
    state = branchesReducer(state, { type: "page", key: "search", request: 1, append: false, page: page([item("notebook_component", "c1", "VFD1")], "c1", 2) });
    state = branchesReducer(state, { type: "start", key: "search", request: 2, append: true });
    state = branchesReducer(state, { type: "page", key: "search", request: 2, append: true, page: page([item("notebook_component", "c2", "VFD1")], null, 2) });
    expect(state.get("search")?.items.map(itemKey)).toEqual(["notebook_component:c1", "notebook_component:c2"]);
  });

  it("drops a late response to an older request", () => {
    let state = branchesReducer(empty, { type: "start", key: "search", request: 1, append: false });
    state = branchesReducer(state, { type: "start", key: "search", request: 2, append: false });
    const stale = branchesReducer(state, { type: "page", key: "search", request: 1, append: false, page: page([item("notebook", "old", "Old")], null) });
    expect(stale).toBe(state);
    const fresh = branchesReducer(state, { type: "page", key: "search", request: 2, append: false, page: page([item("notebook", "new", "New")], null) });
    expect(fresh.get("search")?.items.map((i) => i.id)).toEqual(["new"]);
  });

  it("keeps loaded rows and the failed cursor when a Show more request fails", () => {
    let state = branchesReducer(empty, { type: "start", key: "root", request: 1, append: false });
    state = branchesReducer(state, { type: "page", key: "root", request: 1, append: false, page: page([item("namespace", "a", "A")], "c1", 2) });
    state = branchesReducer(state, { type: "start", key: "root", request: 2, append: true });
    state = branchesReducer(state, { type: "fail", key: "root", request: 2 });
    const branch = state.get("root")!;
    expect(branch.status).toBe("error");
    expect(branch.items.map((i) => i.id)).toEqual(["a"]);
    expect(branch.nextCursor).toBe("c1");
  });

  it("treats hasMore without a cursor as the end of the list", () => {
    const state = branchesReducer(branchesReducer(empty, { type: "start", key: "root", request: 1, append: false }),
      { type: "page", key: "root", request: 1, append: false, page: { items: [], total: 0, hasMore: true, nextCursor: null } });
    expect(state.get("root")?.hasMore).toBe(false);
  });

  it("reset forgets a branch (cleared search)", () => {
    const state = branchesReducer(branchesReducer(empty, { type: "start", key: "search", request: 1, append: false }), { type: "reset", key: "search" });
    expect(state.has("search")).toBe(false);
  });
});

describe("repeated labels", () => {
  it("marks every loaded row whose tag repeats, by key, including across kinds", () => {
    const rows = [
      item("notebook_component", "c1", "VFD1"),
      item("notebook_component", "c2", "VFD1"),
      item("installed_instance", "i1", "VFD1"),
      item("notebook_component", "c3", "MLC", { tag: "Q1" }),
    ];
    const repeated = repeatedLabelKeys(rows);
    expect([...repeated].sort()).toEqual(["installed_instance:i1", "notebook_component:c1", "notebook_component:c2"]);
  });
});
