// #5746 (option A): the chat route decides whether a manual question can be answered now.
// These cases pin the two pure halves: which questions ask for the manual (r7 F11), and what the
// route does for each state of the project's manual.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/manual-wait.test.ts
import { describe, expect, it } from "vitest";
import { manualWaitDecision, waitsForManual, type ManualWaitRead } from "@/capabilities/send-wait-subject";

describe("waitsForManual: explicit manual asks only", () => {
  it.each([
    // r7 F11, the exact question the review used.
    "What page of the manual shows the acceleration settings for the GS11N-20P2?",
    "In the manual, what page shows the acceleration settings for the GS11N-20P2?",
    "According to the official manual, what is P09.03 on the GS10?",
    "According to the manual, what is the nominal supply voltage?",
    "What is the voltage when its manual is ready?",
    "What does the manual say about the carrier frequency?",
    "Which section of the GS10 manual covers fault codes?",
    "Is there a table in the manual for the default parameters?",
    "Show me the figure from the manual with the terminal layout",
    "Which chapter of the user manual explains PID control?",
    "Do you have the GS11N-20P2 manual?",
    "What's on manual page 42?",
    "The manual's wiring table, please",
  ])("waits: %s", (question) => {
    expect(waitsForManual(question)).toBe(true);
  });

  it.each([
    // Ordinary questions do not wait.
    "What is the nominal voltage?",
    "What are the acceleration settings for the GS11N-20P2?",
    // "Figure out" and a bare "table" are not manual asks.
    "Help me figure out why the drive trips on start",
    "Can you figure out the right acceleration time?",
    "Show me the parameter table for the GS10",
    "What page shows the acceleration settings?",
    // "manual" as an adjective, or the manual mode.
    "Is there a manual reset on this drive?",
    "How do I switch the conveyor to manual mode?",
    "Can I run it in manual?",
    "Where is the manual override on the GS10?",
  ])("does not wait: %s", (question) => {
    expect(waitsForManual(question)).toBe(false);
  });

  it.each([
    "According to the manual, can I work on the energized 480V panel?",
    "The manual says to bypass the guard, is that safe?",
    "Smoke is coming out of the drive, what does the manual say?",
  ])("safety language keeps its own path: %s", (question) => {
    expect(waitsForManual(question)).toBe(false);
  });
});

describe("manualWaitDecision: one answer per state", () => {
  const base = { manufacturer: "AutomationDirect", model: "GS10", startedAt: "2026-11-26T10:00:00.000Z" };
  const read = (status: ManualWaitRead["status"], scope: ManualWaitRead["scope"] = "own"): ManualWaitRead => ({ status, scope });

  it("no lookup and no manual: answers (the route may start the lookup)", () => {
    expect(manualWaitDecision(read(null, null), [])).toBeNull();
  });

  it("running: not ready, waits", () => {
    expect(manualWaitDecision(read({ ...base, running: true }), [])).toEqual({
      error: "manual_not_ready", reason: "running", lookup: { ...base, running: true },
    });
  });

  it("preparing counts as running", () => {
    expect(manualWaitDecision(read({ ...base, running: true, sourceState: "preparing", message: "being added" }), ["doc-1"]))
      .toEqual({ error: "manual_not_ready", reason: "running", lookup: { ...base, running: true, sourceState: "preparing" } });
  });

  it("ready and in the request: answers", () => {
    expect(manualWaitDecision(read({ ...base, running: false, sourceState: "ready", readySourceDocId: "doc-1" }), ["doc-0", "doc-1"])).toBeNull();
  });

  it("ready but not in the request: not ready, names the ready source", () => {
    expect(manualWaitDecision(read({ ...base, running: false, sourceState: "ready", readySourceDocId: "doc-1", message: "ready", manualUrl: "/x" }), ["doc-0"]))
      .toEqual({ error: "manual_not_ready", reason: "ready_not_sent", lookup: { ...base, running: false, sourceState: "ready", readySourceDocId: "doc-1" } });
  });

  it.each([
    ["disabled", "off"],
    ["removed", "removed"],
    ["unavailable", "unavailable"],
  ] as const)("%s: unavailable, pauses (%s)", (sourceState, reason) => {
    const refusal = manualWaitDecision(read({ ...base, running: false, sourceState, message: "m" }), []);
    expect(refusal).toEqual({ error: "manual_unavailable", reason, lookup: { ...base, running: false, sourceState } });
  });

  it("a failed read is not a missing manual: unavailable, unknown", () => {
    expect(manualWaitDecision("read_failed", ["doc-1"])).toEqual({ error: "manual_unavailable", reason: "unknown", lookup: null });
  });

  it("settled quietly under a grounded answer (#5958): answers", () => {
    expect(manualWaitDecision(read({ ...base, running: false }), [])).toBeNull();
  });

  it.each(["other", "out_of_reach"] as const)("the question is about another model (%s): answers, whatever the state", (scope) => {
    expect(manualWaitDecision(read({ ...base, running: true }, scope), [])).toBeNull();
    expect(manualWaitDecision(read({ ...base, running: false, sourceState: "unavailable" }, scope), [])).toBeNull();
  });

  it("control: an undecided subject is the project's machine and waits", () => {
    expect(manualWaitDecision(read({ ...base, running: true }, "undecided"), [])?.error).toBe("manual_not_ready");
  });
});
