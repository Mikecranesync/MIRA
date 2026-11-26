// #5746 (option A): the chat route decides whether a manual question can be answered now.
// These cases pin the two pure halves: which questions ask for the manual (r7 F11, r8 F11), and
// what the route does for each state of the project's manual (r8 F13).
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/manual-wait.test.ts
import { describe, expect, it } from "vitest";
import { MANUAL_MACHINE_WORDS, manualWaitDecision, waitsForManual, type ManualWaitRead } from "@/capabilities/send-wait-subject";
import { manualWaitSourceStatus } from "@/capabilities/notebook-manual-acquisition";

describe("waitsForManual: any mention of the manual, except the machine's manual parts and modes", () => {
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
    // A possessive is the document: nothing after "manual's" reads as a part or a mode, even after "in".
    "Is the jog speed listed in manual's parameter table?",
    "Is the auto mode speed in manual's table?",
    // r8 F11: no article before "manual".
    "Which manual covers the GS11N-20P2 acceleration settings?",
    "Do you have manuals for the GS11N-20P2?",
    "According to manual, what is P01.01?",
    "Check manual for the P09.03 default",
    "Refer to manual section 4",
    "Is there a manual?",
    "manual says what for the carrier frequency",
    // A manual part or mode named beside the document still waits on the document.
    "Which section of the manual covers manual mode?",
    "What does the manual say about the manual reset?",
    // Safety words do not make a question about the manual stop asking for it: the chat route's
    // own safety, energized-work and bypass stops decide which questions keep their own path.
    "What does the manual say about the bypass contactor?",
    "Is the live terminal voltage in the manual?",
    "Where does the manual show the guard interlock wiring?",
    // A preposition or "to" before a bare "manual" is the document unless a mode is named (r8).
    "Based on manual, what is the accel time?",
    "Which page in manual shows P09.03?",
    "Look in manual for the default",
    "From manual, what is P01.01?",
    "Set the drive according to manual",
    "Refer back to manual for the wiring",
    "Is this covered in manual?",
    "Is P09.03 in manual?",
    "What's in manual for auto mode?",
    "Go to manual for the wiring diagram",
    "Check the manual/datasheet for P01.01",
  ])("waits: %s", (question) => {
    expect(waitsForManual(question)).toBe(true);
  });

  it.each([
    // Ordinary questions do not wait.
    "What is the nominal voltage?",
    "What are the acceleration settings for the GS11N-20P2?",
    // "Figure out", "manually" and a bare "table" are not the manual.
    "Help me figure out why the drive trips on start",
    "Can you figure out the right acceleration time?",
    "Show me the parameter table for the GS10",
    "What page shows the acceleration settings?",
    "Can I reset it manually?",
    // "manual" as the machine's part or mode.
    "Is there a manual reset on this drive?",
    "How do I switch the conveyor to manual mode?",
    "Can I run it in manual?",
    "Where is the manual override on the GS10?",
    "Switch the conveyor to manual",
    "Set the drive back to manual before you jog it",
    "Is the selector on manual?",
    "Go from auto to manual on the HMI",
    "It runs fine from manual but not from auto",
    "Is the valve manual or automatic?",
    "Does it support auto and manual?",
    "Put the HOA in hand/manual",
    "The switch reads manual/auto",
    "Turn the selector to auto-manual",
    "Put the HOA in manual",
    "Switch it to manual and jog it",
    "Is the selector in manual, or auto?",
  ])("does not wait: %s", (question) => {
    expect(waitsForManual(question)).toBe(false);
  });

  // Every word that makes "manual" the machine's part or mode is tested both ways: on its own it
  // does not wait, and beside the document it does. A miss answers without the manual.
  it.each(MANUAL_MACHINE_WORDS.map((word) => [word]))("the manual %s: a part or mode, the document beside it still waits", (word) => {
    expect(waitsForManual(`Where is the manual ${word} on the GS10?`)).toBe(false);
    expect(waitsForManual(`What does the manual say about the manual ${word}?`)).toBe(true);
    expect(waitsForManual(`Is the manual ${word} covered in the GS10 manual?`)).toBe(true);
  });

  // No list of safety words here (r8): a hazard report or a safety topic that mentions the manual
  // waits like any other manual question. The chat route's own safety, energized-work and bypass
  // stops decide which questions keep their own path (pinned in the route's tests).
  it.each([
    "Smoke is coming out of the drive, what does the manual say?",
    "The GS10 is sparking, what does the manual say to do?",
    "According to the manual, can I work on the energized 480V panel?",
    "What does the manual say about fire override?",
    "What does the manual say about the smoke purge?",
    "What does the manual say about the flame sensor?",
    "What does the manual say about the spark arrestor?",
    "What does the manual say about contact arcing?",
    "What does the manual say about injury warnings?",
  ])("a safety word does not stop the wait here: %s", (question) => {
    expect(waitsForManual(question)).toBe(true);
  });

  it("an entry or a setting in the manual is the document (r8 F11)", () => {
    expect(waitsForManual("What is the manual entry for P09.03?")).toBe(true);
    expect(waitsForManual("What's the manual setting for P01.01?")).toBe(true);
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

  // r8 F13: a settled status with no state says nothing about the manual (the detail read settles
  // a failed lookup quietly under a grounded answer, #5958). It is not a usable manual: it pauses.
  it("settled with no state: unavailable, unknown, never an answer without the manual", () => {
    expect(manualWaitDecision(read({ ...base, running: false }), [])).toEqual({
      error: "manual_unavailable", reason: "unknown", lookup: { ...base, running: false },
    });
  });

  it("the question is about another model: answers, whatever the state", () => {
    expect(manualWaitDecision(read({ ...base, running: true }, "other"), [])).toBeNull();
    expect(manualWaitDecision(read({ ...base, running: false, sourceState: "unavailable" }, "other"), [])).toBeNull();
  });

  it.each(["undecided", "out_of_reach"] as const)("a subject that is not another model (%s) is the project's machine and waits", (scope) => {
    expect(manualWaitDecision(read({ ...base, running: true }, scope), [])?.error).toBe("manual_not_ready");
    expect(manualWaitDecision(read({ ...base, running: false, sourceState: "unavailable" }, scope), [])?.error).toBe("manual_unavailable");
  });
});

// What the wait reads of the project's own Sources when the lookup status is null.
describe("manualWaitSourceStatus", () => {
  const GS10 = { identityStatus: "user_confirmed", manufacturer: "AutomationDirect", model: "GS10", catalogNumber: "" };
  const linked = (extra: Record<string, unknown>) => ({
    docId: "d1", sourceRole: "manual", matchState: "verified", matchEvidence: { autoAcquisitionKey: "AUTOMATIONDIRECT|GS10|" },
    enabledByDefault: true, readiness: { state: "chat_ready_basic", canChat: true }, ...extra,
  });
  const of = (sources: unknown[], identity: Record<string, unknown> = GS10) => manualWaitSourceStatus(sources as never, identity as never);

  it("a turned-off linked manual reads as off", () => {
    expect(of([linked({ enabledByDefault: false })])).toEqual({ manufacturer: "AutomationDirect", model: "GS10", running: false, sourceState: "disabled" });
  });

  it("a linked manual still being prepared, or unreadable, is not answered without", () => {
    expect(of([linked({ readiness: { state: "stored", canChat: false } })])).toMatchObject({ running: true, sourceState: "preparing" });
    expect(of([linked({ readiness: { state: "failed", canChat: false } })])).toMatchObject({ running: false, sourceState: "unavailable" });
  });

  it("a ready linked manual names its source", () => {
    expect(of([linked({})])).toMatchObject({ running: false, sourceState: "ready", readySourceDocId: "d1" });
  });

  it("control: no confirmed identity, another model's manual, or no manual, reads nothing", () => {
    const off = linked({ enabledByDefault: false });
    expect(of([off], { ...GS10, identityStatus: "proposed" })).toBeNull();
    const catalogOnly = linked({ enabledByDefault: false, matchEvidence: { autoAcquisitionKey: "AUTOMATIONDIRECT||GS1021P0" } });
    expect(of([catalogOnly], { ...GS10, model: "", catalogNumber: "GS10-21P0" })).toBeNull();
    expect(of([linked({ enabledByDefault: false, matchEvidence: { autoAcquisitionKey: "AUTOMATIONDIRECT|GS20|" } })])).toBeNull();
    expect(of([{ docId: "d2", filename: "notes.pdf" }])).toBeNull();
  });
});
