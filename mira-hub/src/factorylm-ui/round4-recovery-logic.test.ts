/** Native round4 F9/F10/F11 — the pure decisions the Hub host makes, pinned without a DOM. */
import { describe, expect, it } from "vitest";
import type { InteractionTurn } from "../../../packages/factorylm-interaction/src";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { mergeTurnRows, pinsAfterDetailLoad, reconcileLiveRows, recoveryRetryList, rowConfirmsStreamOutcome, rowSignature, withStoppedExchangeRetry } from "./hub-host-logic";
import { citationIndex, answerTurnId, sourceIdFor } from "./to-interaction";
import { withPersistedRetry } from "./persisted-retry";

type Row = PersistedTurn & { clientRequestId: string | null; createdAt: string };
const row = (id: string, at: number, extra: Partial<Row> = {}): Row => ({
  id, question: `q-${id}`, answerStatus: "answered", answerText: `a-${id}`, equipmentEntityId: "A", evidence: [],
  clientRequestId: `req-${id}`, createdAt: new Date(Date.UTC(2026, 10, 20, 0, at)).toISOString(), ...extra,
} as Row);
const cited = (id: string) => ({ citationId: "1", docId: "doc", sourceTitle: "GS10 manual", page: 41, fileId: `file-${id}` });

describe("F9 a retry's old record never hides or retires the live answer", () => {
  const oldFailure = row("t1", 1, { answerStatus: "error", answerText: null });
  it("hides only the STALE matching row while the live exchange owns the request id", () => {
    const rows = [row("t0", 0), oldFailure, row("t2", 2)];
    const live = { requestId: "req-t1", baseline: rowSignature(oldFailure) };
    expect(reconcileLiveRows(rows, live)).toMatchObject({ hideLive: false });
    expect(reconcileLiveRows(rows, live).rows.map(r => r.id)).toEqual(["t0", "t2"]);
    expect(reconcileLiveRows(rows, null)).toMatchObject({ hideLive: false });
    expect(reconcileLiveRows(rows, null).rows).toHaveLength(3);
    expect(reconcileLiveRows(rows, { requestId: "req-unrelated", baseline: null }).rows).toHaveLength(3);
  });
  it("a row committed AFTER the send began (a late worker commit included) wins over the live exchange", () => {
    const live = { requestId: "req-t1", baseline: rowSignature(oldFailure) };
    const committed = row("t1", 1);                       // answered: differs from the failure the send began with
    expect(reconcileLiveRows([row("t0", 0), committed], live)).toMatchObject({ hideLive: true });
    expect(reconcileLiveRows([row("t0", 0), committed], live).rows.map(r => r.id)).toEqual(["t0", "t1"]);
    // a first send (no earlier row): any row for its id is a commit
    expect(reconcileLiveRows([committed], { requestId: "req-t1", baseline: null })).toMatchObject({ hideLive: true });
    // the same failure read again is still the old record
    expect(reconcileLiveRows([oldFailure], live)).toMatchObject({ hideLive: false });
  });
  it("an old failure does NOT confirm a successful stream; a matching outcome does", () => {
    expect(rowConfirmsStreamOutcome(oldFailure, { error: false })).toBe(false);
    expect(rowConfirmsStreamOutcome(row("t1", 1), { error: false })).toBe(true);
    expect(rowConfirmsStreamOutcome(oldFailure, { error: true })).toBe(true);
    expect(rowConfirmsStreamOutcome(row("t1", 1), { error: true })).toBe(false);
    expect(rowConfirmsStreamOutcome(oldFailure, undefined)).toBe(true); // the status follower is its own authority
  });
  it("a fresh pinned row outranks a stale loaded copy until a successful load returns it", () => {
    const fresh = row("t1", 1);
    const merged = mergeTurnRows([fresh], [oldFailure, row("t2", 2)]);
    expect(merged.map(r => [r.id, r.answerStatus])).toEqual([["t1", "answered"], ["t2", "answered"]]);
    expect(pinsAfterDetailLoad([fresh], [{ id: "t1" }])).toEqual([]);
    expect(pinsAfterDetailLoad([fresh], [{ id: "t9" }])).toEqual([fresh]);
  });
});

describe("F10 a stopped exchange offers Retry in place", () => {
  const turn = (extra: Partial<InteractionTurn> = {}): InteractionTurn => ({
    id: "live-1-a", threadId: "t", role: "assistant", lifecycle: "stopped", context: {} as never,
    parts: [{ type: "text", text: "Partial answer so far" }, { type: "error", error: { code: "stopped", message: "Stopped", retryable: false } }],
    createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z", ...extra,
  } as InteractionTurn);
  it("keeps the partial text, replaces (never doubles) the stop notice, and exposes Retry", () => {
    const [out] = withPersistedRetry(withStoppedExchangeRetry([turn()], "live-1-a"), "live-1-a");
    expect(out!.lifecycle).toBe("failed");
    expect(out!.parts.filter(p => p.type === "text")).toEqual([{ type: "text", text: "Partial answer so far" }]);
    const errors = out!.parts.filter(p => p.type === "error") as { type: "error"; error: { retryable: boolean } }[];
    expect(errors).toHaveLength(1); expect(errors[0]!.error.retryable).toBe(true);
  });
  it("leaves every other exchange untouched", () => {
    const other = turn({ id: "live-2-a" });
    expect(withStoppedExchangeRetry([other], "live-1-a")).toEqual([other]);
    expect(withStoppedExchangeRetry([other], null)).toEqual([other]);
  });
});

describe("F11 citations index the rows that are rendered", () => {
  it("an exact-recovered old answer outside the 50-row window keeps its citation", () => {
    const old = row("old", 0, { evidence: [cited("old")] as never });
    const window = Array.from({ length: 55 }, (_, i) => row(`n${i}`, i + 1));
    const rendered = mergeTurnRows([old], window);
    const key = sourceIdFor(answerTurnId("old"), "1");
    expect(citationIndex(window).has(key)).toBe(false);          // the pre-repair index (detail.turns only)
    expect(citationIndex(rendered).get(key)?.fileId).toBe("file-old"); // the rendered rows
  });
});

describe("F10 which observed recoveries may offer Retry", () => {
  const identity = { version: 1 as const, manufacturer: "AutomationDirect", model: "GS10", catalogNumber: null, serialNumber: null, equipmentType: "vfd", identityStatus: "user_confirmed" };
  const notebook = { manufacturer: "AutomationDirect", model: "GS10", catalogNumber: null, serialNumber: null, equipmentType: "vfd", identityStatus: "user_confirmed" } as never;
  const value = (requestId: string, extra: Record<string, unknown> = {}) => ({
    requestId, turnId: `turn-${requestId}`, threadId: "t", question: `q-${requestId}`, state: "interrupted", answerStatus: null, canRetry: true,
    target: { kind: "known", equipmentEntityId: "A" }, currentEquipmentEntityId: "A", originalNotebookIdentity: identity, component: null,
    componentSelection: { threadId: "t", componentId: null, selectionVersion: null }, sourceDocIds: [], visualEvidence: null, pollAfterMs: null, createdAt: "x", ...extra,
  });
  const observed = (requestId: string, extra: Record<string, unknown> = {}) => ({ pointer: { notebookId: "n", threadId: "t", requestId, question: `q-${requestId}` }, value: value(requestId, extra) as never });
  const here = { equipmentEntityId: "A", componentId: null as string | null, notebook };
  const stopped = { id: "live-1", requestId: "REQ", question: "q-REQ", stopped: true };

  it("offers the stopped exchange its own interrupted request, on the live exchange", () => {
    expect(recoveryRetryList([observed("REQ")], stopped, here)).toEqual([{ answerId: "live-1-a", question: "q-REQ", requestId: "REQ" }]);
  });
  it("ignores another request's observation while a live exchange exists", () => {
    expect(recoveryRetryList([observed("OTHER")], stopped, here)).toEqual([]);
    expect(recoveryRetryList([observed("OTHER"), observed("REQ")], stopped, here).map(r => r.requestId)).toEqual(["REQ"]);
  });
  it("offers nothing for a live exchange that was not stopped, or whose request is not interrupted", () => {
    expect(recoveryRetryList([observed("REQ")], { ...stopped, stopped: false }, here)).toEqual([]);
    expect(recoveryRetryList([observed("REQ", { state: "pending" })], stopped, here)).toEqual([]);
  });
  it("offers nothing when the machine, component, identity or retryability no longer matches", () => {
    expect(recoveryRetryList([observed("REQ", { target: { kind: "known", equipmentEntityId: "B" } })], stopped, here)).toEqual([]);
    expect(recoveryRetryList([observed("REQ")], stopped, { ...here, equipmentEntityId: "B" })).toEqual([]);
    expect(recoveryRetryList([observed("REQ", { component: { componentId: "C", revision: 1 } })], stopped, here)).toEqual([]);
    expect(recoveryRetryList([observed("REQ", { originalNotebookIdentity: { ...identity, model: "OTHER" } })], stopped, here)).toEqual([]);
    expect(recoveryRetryList([observed("REQ", { canRetry: false })], stopped, here)).toEqual([]);
    expect(recoveryRetryList([observed("REQ")], stopped, { ...here, componentId: undefined })).toEqual([]); // header not read yet
  });
  it("with no live exchange keeps the existing per-request offers", () => {
    expect(recoveryRetryList([observed("A"), observed("B", { target: { kind: "known", equipmentEntityId: "B" } })], null, here).map(r => r.requestId)).toEqual(["A"]);
  });
});

describe("one logical request = ONE visible question/answer (placeholder precedence)", () => {
  it("a saved row, the live exchange and a retained exchange each stand in for the request; an unrelated pointer does not", async () => {
    const { placeholderRequestIds } = await import("./hub-host-logic");
    const ids = placeholderRequestIds([{ clientRequestId: "saved" }, { clientRequestId: null }, {}], { clientRequestId: "live" }, [{ clientRequestId: "retained" }]);
    expect([...ids].sort()).toEqual(["live", "retained", "saved"]);
    expect(ids.has("unrelated-pointer")).toBe(false);
    expect([...placeholderRequestIds([], null, undefined)]).toEqual([]);
  });
  it("Retry moves onto the representing exchange ONLY when it was explicitly stopped; a confirmed/failed exchange drops a stale retry; unrelated requests keep theirs", async () => {
    const { retriesOnRepresentingExchange } = await import("./hub-host-logic");
    const retries = [{ answerId: "turn-A-a", requestId: "A", question: "qa" }, { answerId: "turn-B-a", requestId: "B", question: "qb" }, { answerId: "turn-C-a", requestId: "C", question: "qc" }, { answerId: "turn-D-a", requestId: "D", question: "qd" }];
    const out = retriesOnRepresentingExchange(retries, { id: "live-1", clientRequestId: "A", stopped: true },
      [{ id: "live-9", clientRequestId: "B", stopped: false }, { id: "live-7", clientRequestId: "D", stopped: true }]);
    expect(out.map(r => [r.requestId, r.answerId])).toEqual([["A", "live-1-a"], ["C", "turn-C-a"], ["D", "live-7-a"]]);   // B (confirmed/failed, not stopped) dropped
    expect(retriesOnRepresentingExchange(retries, null, undefined)).toEqual(retries);
    expect(retriesOnRepresentingExchange([retries[0]!], { id: "live-2", clientRequestId: "A", stopped: false }, [])).toEqual([]);
  });
});
