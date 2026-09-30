import test from "node:test";
import assert from "node:assert/strict";
import { readHistoryState } from "./history-state.mjs";

const QUESTION = "When do I need to derate this drive for altitude";

function element(attrs = {}, textContent = "", queries = {}) {
  return {
    textContent,
    getAttribute: (name) => attrs[name] ?? null,
    querySelector: (selector) => (queries[selector] ?? [])[0] ?? null,
    querySelectorAll: (selector) => queries[selector] ?? [],
  };
}

function screen({ question = QUESTION, citation = true, source = true, otherAnswer = false,
  turnId = "42", answerText = "Stop the drive. [1]", duplicateThread = false,
  duplicateAssistant = false } = {}) {
  const user = element({ "data-turn-id": `${turnId}-q` }, "", {
    '[data-part-type="text"]': [element({}, question)],
  });
  const answer = element({ "data-turn-id": `${turnId}-a`, "data-lifecycle": "completed" }, "see p.117", {
    '[data-part-type="text"]': [element({}, answerText)],
    'button[aria-label^="Citation "]': citation ? [element({ "aria-label": "Citation 1" })] : [],
    'button[data-part-type="source"][data-source-id]': source
      ? [element({ "data-source-id": "1" }, "manual.pdf p. 117")] : [],
  });
  const unrelated = element({ "data-turn-id": "43-a" }, "manual.pdf p.117", {
    'button[aria-label^="Citation "]': [element({ "aria-label": "Citation 1" })],
    'button[data-part-type="source"][data-source-id]': [element({ "data-source-id": "1" }, "manual.pdf p. 117")],
  });
  const root = element({ "data-notebook-id": "n1" }, "", {
    '[data-item-kind="thread"][aria-current="page"]': duplicateThread
      ? [element({ "data-item-id": "notebook-n1:thread-t1" }), element({ "data-item-id": "notebook-n1:thread-t1" })]
      : [element({ "data-item-id": "notebook-n1:thread-t1" })],
    '[data-turn-id][data-role="user"]': [user],
    '[data-turn-id][data-role="assistant"]': otherAnswer ? [unrelated]
      : duplicateAssistant ? [answer, answer, unrelated] : [answer, unrelated],
  });
  globalThis.document = { querySelector: () => root };
  return readHistoryState(QUESTION);
}

test("reads the exact question and its paired assistant citation element", () => {
  const state = screen();
  assert.equal(state.questionCount, 1);
  assert.equal(state.threadItemId, "notebook-n1:thread-t1");
  assert.equal(state.threadItemCount, 1);
  assert.equal(state.answers[0].userTurnId, "42-q");
  assert.equal(state.answers[0].assistantTurnId, "42-a");
  assert.equal(state.answers[0].answerText, "Stop the drive. [1]");
  assert.equal(state.answers[0].pairedAssistantCount, 1);
  assert.deepEqual(state.answers[0].citationIds, ["1"]);
  assert.deepEqual(state.answers[0].sources, [{ id: "1", text: "manual.pdf p. 117" }]);
});

test("answer prose and an uploaded filename cannot become a citation", () => {
  const state = screen({ citation: false, source: false });
  assert.deepEqual(state.answers[0].citationIds, []);
  assert.deepEqual(state.answers[0].sources, []);
});

test("a different assistant's citation does not bind to the question", () => {
  const state = screen({ otherAnswer: true });
  assert.equal(state.questionCount, 1);
  assert.deepEqual(state.answers, [{ userTurnId: "42-q", pairedAssistantCount: 0 }]);
});

test("a partial-prefix question does not match", () => {
  assert.equal(screen({ question: "When do I need to derate this other machine" }).questionCount, 0);
});

test("persisted replacement identity and changed answer are observable", () => {
  const original = screen();
  assert.notDeepEqual(screen({ turnId: "replacement99" }), original);
  assert.notDeepEqual(screen({ answerText: "Run the drive. [1]" }), original);
});

test("duplicate active thread and paired assistant cannot look unique", () => {
  const valid = screen();
  assert.notDeepEqual(screen({ duplicateThread: true }), valid);
  assert.notDeepEqual(screen({ duplicateAssistant: true }), valid);
  assert.equal(screen({ duplicateThread: true }).threadItemCount, 2);
  assert.equal(screen({ duplicateAssistant: true }).answers[0].pairedAssistantCount, 2);
});
