/** #5456: a manual saved switched off is shown on the v3 project screen with its one next step. Fake fetch only; no DOM. */
import { describe, expect, it, vi } from "vitest";
import type { SetupDeps } from "./new-project-setup-logic";
import { confirmedOn, parkedRows, turnOnParkedSource, USE_FAILED, USE_GONE, USE_SIGNED_OUT, type ParkedSource } from "./parked-sources";

const src = (patch: Partial<ParkedSource>): ParkedSource => ({
  docId: "d-1", filename: "manual.pdf", fileId: "f-1", matchState: "candidate",
  searchable: false, searchableLabel: "Not searchable: not turned on", searchableFix: "use", ...patch,
});

function harness(status: number | "throw") {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: String(init?.method), path: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (status === "throw") throw new Error("offline");
    return { status, ok: status >= 200 && status < 300, json: async () => (status === 200 ? { ok: true } : { error: "not_found" }) } as Response;
  });
  const deps: SetupDeps = { fetch: fetchFn as unknown as typeof fetch, apiBase: "/hub", createNotebook: async () => null, sleep: async () => {} };
  return { calls, deps };
}

describe("parkedRows: which sources the box lists", () => {
  it("lists a switched-off suggestion with the server's label and step", () => {
    expect(parkedRows([src({})])).toEqual([{ docId: "d-1", name: "manual.pdf", fileId: "f-1", label: "Not searchable: not turned on", fix: "use", needsApproval: true }]);
  });
  it("never lists a source that answers already use, even a partial one with a warning", () => {
    expect(parkedRows([src({ searchable: true, searchableFix: null, searchableLabel: "Ready to ask — partial manual", matchState: "user_confirmed" })])).toEqual([]);
  });
  it("a source the server says IS searchable is never listed, whatever step rides along", () => {
    expect(parkedRows([src({ searchable: true, searchableFix: "use" })])).toEqual([]);
  });
  it("never lists a rejected match", () => {
    expect(parkedRows([src({ matchState: "rejected", searchableFix: null }), src({ matchState: "rejected", searchableFix: "use" })])).toEqual([]);
  });
  it("a response without the projection lists nothing: unknown is not 'not in use'", () => {
    const old = { docId: "d-1", filename: "manual.pdf", fileId: "f-1", matchState: "candidate" } as unknown as ParkedSource;
    expect(parkedRows([old])).toEqual([]);
    expect(parkedRows([src({ searchableFix: undefined as unknown as null })])).toEqual([]);
  });
  it("carries the partial-manual and not-readable steps through unchanged", () => {
    const rows = parkedRows([src({ docId: "p", searchableFix: "full_manual" }), src({ docId: "w", searchableFix: "wait" })]);
    expect(rows.map((r) => [r.docId, r.fix])).toEqual([["p", "full_manual"], ["w", "wait"]]);
  });
  it("only a suggestion needs approving; a verified or confirmed source keeps its state", () => {
    expect(parkedRows([src({ matchState: "verified" }), src({ matchState: "user_confirmed" })]).map((r) => r.needsApproval)).toEqual([false, false]);
  });
  it("a nameless document still gets a row", () => {
    expect(parkedRows([src({ filename: null, fileId: null })])[0]).toMatchObject({ name: "Document", fileId: null });
  });
});

describe("turnOnParkedSource: one write", () => {
  it("approves and switches on a suggestion in the same request", async () => {
    const h = harness(200);
    expect(await turnOnParkedSource("nb 1", { docId: "d/1", fix: "use", needsApproval: true }, h.deps)).toEqual({ ok: true });
    expect(h.calls).toEqual([{ method: "PATCH", path: "/hub/api/equipment-notebooks/nb%201/sources/d%2F1/", body: { enabledByDefault: true, matchState: "user_confirmed" } }]);
  });
  it("does not rewrite the trust state of a source the server already verified", async () => {
    const h = harness(200);
    await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: false }, h.deps);
    expect(h.calls[0]!.body).toEqual({ enabledByDefault: true });
  });
  it("sends nothing for a partial manual or an unreadable document", async () => {
    for (const fix of ["full_manual", "wait"] as const) {
      const h = harness(200);
      expect((await turnOnParkedSource("nb", { docId: "d", fix, needsApproval: true }, h.deps)).ok).toBe(false);
      expect(h.calls).toEqual([]);
    }
  });
  it("says what happened in words, never a server error code", async () => {
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(404).deps)).toEqual({ ok: false, message: USE_GONE });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(401).deps)).toEqual({ ok: false, message: USE_SIGNED_OUT });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(500).deps)).toEqual({ ok: false, message: USE_FAILED });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness("throw").deps)).toEqual({ ok: false, message: USE_FAILED });
  });
});

describe("confirmedOn: 'now used' is said only once the server's list agrees", () => {
  const on = [{ docId: "a", name: "a.pdf" }, { docId: "b", name: "b.pdf" }];
  it("confirms a source that is no longer listed as not in use", () => {
    expect(confirmedOn(on, [])).toEqual(["a.pdf", "b.pdf"]);
  });
  it("drops the confirmation for a source that is listed again", () => {
    expect(confirmedOn(on, [{ docId: "a" }])).toEqual(["b.pdf"]);
  });
});
