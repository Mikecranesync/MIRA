import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { persistedRetryTarget, withoutRetriedFailures, withPersistedRetry } from "./persisted-retry";
import { threadFromPersisted, type HubNotebookMeta } from "./to-interaction";

const AT = "2026-11-19T12:00:00.000Z";
const meta: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "Conveyor CV-101",
  tenantId: "tenant-1",
  identityConfirmed: true,
  capturedAt: AT,
};

function row(over: Partial<PersistedTurn> & { id: string }): PersistedTurn {
  return {
    question: "what should I check first",
    answerStatus: "answered",
    answerText: "Verify the Modbus link.",
    evidence: [],
    basis: "oem_documentation",
    ...over,
  };
}
const failed = (id: string, question = "isolation rating?") =>
  row({ id, question, answerStatus: "error", answerText: null, basis: null });
const stopped = (id: string, question = "isolation rating?") =>
  row({ id, question, answerStatus: "error", answerText: "Verify the", basis: null });

describe("withoutRetriedFailures (#4846: failures don't pile up)", () => {
  it("drops a failed turn the very next turn asks again (case and spacing ignored)", () => {
    const rows = [failed("t1", "isolation rating?"), failed("t2", "Isolation  rating? "), row({ id: "t3", question: "isolation rating?" })];
    expect(withoutRetriedFailures(rows).map((r) => r.id)).toEqual(["t3"]);
  });

  it("keeps a stopped turn even when asked again: its partial text is still shown", () => {
    expect(withoutRetriedFailures([stopped("t1"), row({ id: "t2", question: "isolation rating?" })]).map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("keeps a failure that carries an identity card (it renders on every path)", () => {
    const proposal = { ...failed("t1"), evidence: [{ kind: "identity_proposal", manufacturer: "AutomationDirect", model: "GS11N-20P2" }] } as unknown as PersistedTurn;
    const dispute = { ...failed("t1"), evidence: [{ kind: "identity_dispute" }] } as unknown as PersistedTurn;
    const next = row({ id: "t2", question: "isolation rating?" });
    expect(withoutRetriedFailures([proposal, next]).map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(withoutRetriedFailures([dispute, next]).map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("keeps a failure followed by a DIFFERENT question (never hides a failure behind another topic)", () => {
    const rows = [failed("t1", "isolation rating?"), row({ id: "t2", question: "what voltage" })];
    expect(withoutRetriedFailures(rows).map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("keeps the newest failure (nothing re-asked it yet) and every answered turn", () => {
    const rows = [row({ id: "t1" }), row({ id: "t2" }), failed("t3")];
    expect(withoutRetriedFailures(rows).map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("never drops an answered turn, even when the next question repeats it", () => {
    const rows = [row({ id: "t1", question: "q" }), row({ id: "t2", question: "q" })];
    expect(withoutRetriedFailures(rows).map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("never drops a refusal or an abstention (not stored as an error)", () => {
    const refusal = row({ id: "t1", question: "q", answerStatus: "insufficient_evidence", answerText: "I won't answer from it.", basis: null });
    expect(withoutRetriedFailures([refusal, row({ id: "t2", question: "q" })]).map((r) => r.id)).toEqual(["t1", "t2"]);
  });
});

describe("persistedRetryTarget (#4846/#5463: Retry survives a reload)", () => {
  it("offers the newest turn when it is a provider failure", () => {
    expect(persistedRetryTarget([row({ id: "t1" }), failed("t2", "  isolation rating?  ")], null)).toEqual({ answerId: "t2-a", question: "isolation rating?" });
  });

  it("offers nothing when the newest turn answered", () => {
    expect(persistedRetryTarget([failed("t1"), row({ id: "t2" })], null)).toBeNull();
  });

  it("offers nothing for a stopped turn that kept partial text", () => {
    expect(persistedRetryTarget([stopped("t1")], null)).toBeNull();
  });

  it("offers nothing for a failure that recorded the providers were out (live shows it without Retry, #4356)", () => {
    const exhausted = { ...failed("t1"), evidence: [{ kind: "provider_failure", reason: "no_provider_configured" }] } as unknown as PersistedTurn;
    expect(persistedRetryTarget([exhausted], null)).toBeNull();
    // Control: the same row without the marker is offered.
    expect(persistedRetryTarget([failed("t1")], null)).not.toBeNull();
  });

  it("offers nothing for a failed photo question (a text re-ask would drop the photo)", () => {
    const photo = { ...failed("t1"), evidence: [{ kind: "visual_observation", fileId: "f-1", capturedAt: AT, provenance: "phone_photo" }] } as unknown as PersistedTurn;
    expect(persistedRetryTarget([photo], null)).toBeNull();
  });

  it("offers nothing before the header has been read (the live hold shows 'loading' then too)", () => {
    expect(persistedRetryTarget([failed("t1")], undefined)).toBeNull();
  });

  it("offers Retry only while the header shows what the question was asked about (#5557)", () => {
    const attribution = { kind: "component_attribution", componentId: "c-1", revision: 1, selectionVersion: 3, label: "Main contactor" };
    const underC1 = { ...failed("t1"), evidence: [attribution] } as unknown as PersistedTurn;
    expect(persistedRetryTarget([underC1], "c-1")).not.toBeNull();
    expect(persistedRetryTarget([underC1], "c-2")).toBeNull();
    expect(persistedRetryTarget([underC1], null)).toBeNull();
    // No component on the record: only the whole machine is safe to ask under.
    expect(persistedRetryTarget([failed("t1")], null)).not.toBeNull();
    expect(persistedRetryTarget([failed("t1")], "c-1")).toBeNull();
  });

  it("offers nothing for an empty question or an empty conversation", () => {
    expect(persistedRetryTarget([failed("t1", "   ")], null)).toBeNull();
    expect(persistedRetryTarget([], null)).toBeNull();
  });
});

describe("withPersistedRetry", () => {
  it("makes only the target's provider failure retryable", () => {
    const rows = [failed("t1", "a"), row({ id: "t2", question: "b" }), failed("t3", "c")];
    const turns = threadFromPersisted(rows, meta).turns;
    const out = withPersistedRetry(turns, "t3-a");
    const errorOf = (id: string) => out.find((t) => t.id === id)?.parts.find((p) => p.type === "error");
    expect(errorOf("t3-a")).toMatchObject({ error: { code: "provider_failure", retryable: true } });
    expect(errorOf("t1-a")).toMatchObject({ error: { code: "provider_failure", retryable: false } });
    // Precondition for the control: the mapper itself still says not retryable (#4374 pin).
    expect(turns.find((t) => t.id === "t3-a")?.parts.find((p) => p.type === "error")).toMatchObject({ error: { retryable: false } });
  });

  it("leaves a stopped turn alone even when named", () => {
    const turns = threadFromPersisted([stopped("t1")], meta).turns;
    expect(withPersistedRetry(turns, "t1-a")).toEqual(turns);
  });

  it("changes nothing without a target", () => {
    const turns = threadFromPersisted([failed("t1")], meta).turns;
    expect(withPersistedRetry(turns, null)).toEqual(turns);
  });
});

describe("the reloaded failure meets the shell's Retry condition", () => {
  // The shell (packages/factorylm-ui, another lane) draws Retry on an error part only
  // under this exact condition. Pinned here so a change there is seen here.
  const parts = readFileSync(new URL("../../../packages/factorylm-ui/src/parts.tsx", import.meta.url), "utf8");
  it("the shell's condition is still retryable + failed + an onRetry hook", () => {
    expect(parts).toContain('error.retryable && turn.lifecycle === "failed" && typeof onRetry === "function"');
    expect(parts).toContain("onClick={() => onRetry(turn.id)}");
  });

  it("the targeted turn meets every clause, and its id is the one the host retries", () => {
    const turn = withPersistedRetry(threadFromPersisted([failed("t1")], meta).turns, "t1-a").find((t) => t.id === "t1-a")!;
    const part = turn.parts.find((p) => p.type === "error");
    expect(turn.lifecycle).toBe("failed");
    expect(part).toMatchObject({ error: { retryable: true } });
    expect(turn.id).toBe(persistedRetryTarget([failed("t1")], null)?.answerId);
  });
});
