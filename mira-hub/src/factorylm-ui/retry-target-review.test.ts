import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heldQuestionForSend, retryTargetCheck, targetReviewMessage, withoutScope, scopedChatBody, recordBenchScope, type BenchScopes, type BenchState } from "./bench-components-logic";

/**
 * Tablet semantic-retry gap: a question asked about "the selected component" was refused
 * (selection_changed) because another screen cleared the selection. Retry re-scoped it from
 * what the header showed now — the whole machine — and sent it with no review, so the
 * technician got a whole-machine answer to a component question. The retry must be held:
 * both targets named, the question kept, and only a fresh Send asks it about the new one.
 *
 * Run: npx vitest run src/factorylm-ui/retry-target-review.test.ts
 */
const SEL = { notebookId: "nb-1", threadId: "th-1" };
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const COMPONENTS = [
  { id: A, label: "VFD1 · AutomationDirect GS10" },
  { id: B, label: "PLC1 · Allen-Bradley Micro820" },
];
const selected = (componentId: string, version: number) =>
  ({ selection: { componentId, revision: 1, selectedAt: "2026-11-15T04:00:00.000Z", version }, selectionVersion: version, components: COMPONENTS }) as unknown as BenchState;
const cleared = (version: number) => ({ selection: null, selectionVersion: version, components: COMPONENTS }) as unknown as BenchState;

/** The scope the refused question carried: VFD1 at version 4. */
const REFUSED = { threadId: "th-1", componentId: A, selectionVersion: 4 };

describe("retry after the question's target moved (tablet semantic-retry gap)", () => {
  it("another screen cleared the selection: no silent whole-machine retry; both targets are named", () => {
    const check = retryTargetCheck(REFUSED, cleared(5));
    expect(check.kind).toBe("review");
    if (check.kind !== "review") return;
    expect(check.review).toEqual({ from: "VFD1 · AutomationDirect GS10", to: "the whole machine" });
    expect(targetReviewMessage(check.review)).toBe(
      "This question was asked about VFD1 · AutomationDirect GS10. The question target is now the whole machine. Check the target, then press Send to ask about the whole machine.",
    );
  });

  it("another screen picked a different component: held for review too", () => {
    const check = retryTargetCheck(REFUSED, selected(B, 5));
    expect(check).toEqual({ kind: "review", review: { from: "VFD1 · AutomationDirect GS10", to: "PLC1 · Allen-Bradley Micro820" } });
  });

  it("control: same component, only the version moved — retry is allowed", () => {
    expect(retryTargetCheck(REFUSED, selected(A, 5))).toEqual({ kind: "retry" });
  });

  it("control: a failure that was not a target refusal retries as before", () => {
    expect(retryTargetCheck(undefined, cleared(5))).toEqual({ kind: "retry" });
  });

  it("before the panel has re-read the selection, neither retry nor review is offered", () => {
    expect(retryTargetCheck(REFUSED, undefined)).toEqual({ kind: "loading" });
  });

  it("a whole-machine question whose target became a component is held for review", () => {
    const check = retryTargetCheck({ threadId: "th-1", componentId: null, selectionVersion: 4 }, selected(A, 5));
    expect(check).toEqual({ kind: "review", review: { from: "the whole machine", to: "VFD1 · AutomationDirect GS10" } });
  });

  it("checklist unavailable (404/503) counts as the whole machine", () => {
    expect(retryTargetCheck(REFUSED, null)).toEqual({ kind: "review", review: { from: "the component it was asked about", to: "the whole machine" } });
  });

  it("the fresh Send after review carries the new scope, the new version, and the held attachment", () => {
    // The held body is the original question without its refused scope (hub-host keeps withoutScope(body)).
    const held = withoutScope({ message: "what fuse does the selected component take?", visualEvidence: { fileId: "f-1", capturedAt: "2026-11-15T04:00:00.000Z" }, componentSelection: REFUSED });
    const scopes: BenchScopes = new Map();
    recordBenchScope(scopes, SEL, cleared(5));
    const out = scopedChatBody(held, SEL, scopes);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.body).toEqual({
      message: "what fuse does the selected component take?",
      visualEvidence: { fileId: "f-1", capturedAt: "2026-11-15T04:00:00.000Z" },
      componentSelection: { threadId: "th-1", componentId: null, selectionVersion: 5 },
    });
  });
});

describe("the fresh Send after review", () => {
  const failed = { body: { message: "what fuse does the selected component take?", visualEvidence: { fileId: "f-1", capturedAt: "t" } }, question: "what fuse does the selected component take?", refusedScope: REFUSED };
  const review = retryTargetCheck(REFUSED, cleared(5));

  it("asks the held question, attachment rider included", () => {
    expect(heldQuestionForSend(failed, review, "what fuse does the selected component take?", 0)).toBe(failed.body);
  });
  it("control: an edited question is a new question (ordinary send)", () => {
    expect(heldQuestionForSend(failed, review, "what fuse does VFD1 take?", 0)).toBeNull();
  });
  it("control: a new attachment makes it a new send", () => {
    expect(heldQuestionForSend(failed, review, failed.question, 1)).toBeNull();
  });
  it("control: no review pending (same target) — not intercepted", () => {
    expect(heldQuestionForSend(failed, retryTargetCheck(REFUSED, selected(A, 5)), failed.question, 0)).toBeNull();
  });
});

describe("the host is wired to the hold (source shape, like hub-host-restore-retry)", () => {
  const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
  it("Retry is offered only when the target did not move", () => {
    expect(host).toMatch(/\.\.\.\(failedBody && retryCheck\?\.kind === "retry" \? \{ onRetry \} : \{\}\)/);
    expect(host).not.toMatch(/\.\.\.\(failedBody \? \{ onRetry \} : \{\}\)/);
  });
  it("a target refusal keeps the refused scope and the review message is shown", () => {
    expect(host).toMatch(/refusedScope \? \{ refusedScope \} : \{\}/);
    expect(host).toMatch(/targetReviewMessage\(retryCheck\.review\)/);
  });
  it("Send routes the held question through heldQuestionForSend", () => {
    expect(host).toMatch(/const held = heldQuestionForSend\(failedBody, retryCheck, q, files\.length\);/);
  });
});
