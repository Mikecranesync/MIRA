/**
 * Adversarial review of the Retry control (#3531).
 *
 * This repo's vitest runs without jsdom, so the component's stateful loop is
 * not directly drivable. Instead each scenario below is a state machine driven
 * by the REAL exported decision functions the component calls
 * (`rollbackFailedExchange`, `restoreComposer`, `shouldShowRetry`,
 * `composerAfterRetry`, `failedAfterEdit`) plus the component's own literal
 * `apiMessages` construction, transcribed once in `buildApiMessages` below and
 * pinned by a test against the source line it mirrors.
 *
 * Where a scenario cannot be proven this way, it says so rather than asserting
 * something weaker and calling it proof.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  composerAfterRetry,
  failedAfterEdit,
  restoreComposer,
  rollbackFailedExchange,
  shouldShowRetry,
} from "../AssetChat";

type Msg = { id: string; role: "user" | "assistant"; content: string; stopped?: boolean };

let seq = 0;
const uid = () => `m${++seq}`;

/** Mirrors AssetChat.tsx's apiMessages line exactly:
 *    [...messages, userMsg].filter((m) => !m.stopped).map(...)  */
function buildApiMessages(messages: Msg[], userMsg: Msg) {
  return [...messages, userMsg]
    .filter((m) => !m.stopped)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** The component's observable state, as the real handlers mutate it. */
type S = {
  messages: Msg[];
  input: string;
  failed: string | null;
  streaming: boolean;
  sentPayloads: { role: string; content: string }[][];
};

const fresh = (): S => ({ messages: [], input: "", failed: null, streaming: false, sentPayloads: [] });

/** sendMessage() up to the point the request goes out. Returns the ids it
 *  optimistically appended, which the failure path needs to roll back. */
function beginSend(s: S, text: string): { userId: string; assistantId: string } | null {
  if (!text.trim() || s.streaming) return null; // the real guard
  s.failed = null; // setFailed(null) at the top of sendMessage
  const userMsg: Msg = { id: uid(), role: "user", content: text.trim() };
  const assistantMsg: Msg = { id: uid(), role: "assistant", content: "" };
  s.sentPayloads.push(buildApiMessages(s.messages, userMsg));
  s.messages = [...s.messages, userMsg, assistantMsg];
  s.streaming = true;
  return { userId: userMsg.id, assistantId: assistantMsg.id };
}

/** The real-failure catch branch. */
function failSend(s: S, ids: { userId: string; assistantId: string }, text: string) {
  s.messages = rollbackFailedExchange(s.messages, ids.userId, ids.assistantId);
  s.input = restoreComposer(s.input, text);
  s.failed = text;
  s.streaming = false;
}

/** The AbortError branch — Stop. Note it returns BEFORE setFailed. */
function stopSend(s: S, ids: { userId: string; assistantId: string }, partial: string) {
  s.messages = s.messages.map((m) =>
    m.id === ids.assistantId ? { ...m, content: partial, stopped: true } : m,
  );
  s.streaming = false;
  // deliberately NOT setting s.failed — mirrors the early return
}

function succeed(s: S, ids: { userId: string; assistantId: string }, answer: string) {
  s.messages = s.messages.map((m) => (m.id === ids.assistantId ? { ...m, content: answer } : m));
  s.streaming = false;
}

/** The retry callback. */
function clickRetry(s: S): { userId: string; assistantId: string } | null {
  if (!s.failed || s.streaming) return null; // the real guard
  const retryText = s.failed;
  s.input = composerAfterRetry(s.input, retryText);
  return beginSend(s, retryText);
}

/** What the user actually sees: the chip renders only when this is true. */
const retryVisible = (s: S) => shouldShowRetry(s.failed, s.streaming);

/** Count how many times a given question appears as a user turn in a payload. */
const askedCount = (payload: { role: string; content: string }[], q: string) =>
  payload.filter((m) => m.role === "user" && m.content === q).length;

const Q = "What does fault F005 mean?";

describe("#3531 Retry — adversarial", () => {
  describe("the model never receives a duplicate user message", () => {
    it("fail → Retry sends the question exactly once", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      const b = clickRetry(s)!;
      succeed(s, b, "Overvoltage.");

      expect(s.sentPayloads).toHaveLength(2);
      for (const p of s.sentPayloads) expect(askedCount(p, Q)).toBe(1);
    });

    it("survives three consecutive failures without accumulating the question", () => {
      const s = fresh();
      let ids = beginSend(s, Q)!;
      for (let i = 0; i < 3; i++) {
        failSend(s, ids, Q);
        ids = clickRetry(s)!;
      }
      succeed(s, ids, "Overvoltage.");

      expect(s.sentPayloads).toHaveLength(4);
      for (const p of s.sentPayloads) expect(askedCount(p, Q)).toBe(1);
      // and the transcript holds exactly one copy of the question
      expect(s.messages.filter((m) => m.role === "user" && m.content === Q)).toHaveLength(1);
    });

    it("preserves earlier history across a failure + Retry", () => {
      const s = fresh();
      const a = beginSend(s, "earlier")!;
      succeed(s, a, "earlier answer");
      const b = beginSend(s, Q)!;
      failSend(s, b, Q);
      const c = clickRetry(s)!;

      const last = s.sentPayloads[s.sentPayloads.length - 1];
      expect(last.map((m) => m.content)).toEqual(["earlier", "earlier answer", Q]);
      expect(askedCount(last, Q)).toBe(1);
      succeed(s, c, "ok");
    });
  });

  describe("double-tap", () => {
    it("a second Retry in the same tick is refused (streaming guard)", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);

      const first = clickRetry(s);
      const second = clickRetry(s); // before anything settles

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(s.sentPayloads).toHaveLength(2); // original + one retry, not two retries
    });

    it("the chip is not even rendered once a retry is in flight", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      expect(retryVisible(s)).toBe(true);
      clickRetry(s);
      expect(retryVisible(s)).toBe(false); // streaming true AND failed cleared
    });
  });

  describe("Stop never offers Retry (ADR-0040 §5 — a stopped turn is not retryable)", () => {
    it("Stop leaves no Retry offer", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      stopSend(s, a, "Partial ans");
      expect(s.failed).toBeNull();
      expect(retryVisible(s)).toBe(false);
      expect(clickRetry(s)).toBeNull();
    });

    it("a stopped turn is excluded from what the model sees next", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      stopSend(s, a, "Partial ans");
      const b = beginSend(s, "next question")!;
      const last = s.sentPayloads[s.sentPayloads.length - 1];
      expect(last.some((m) => m.content === "Partial ans")).toBe(false);
      succeed(s, b, "ok");
    });

    it("Stop then a failed send offers Retry for the FAILED text only", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      stopSend(s, a, "Partial");
      const b = beginSend(s, "second question")!;
      failSend(s, b, "second question");
      expect(s.failed).toBe("second question");
      expect(retryVisible(s)).toBe(true);
    });
  });

  describe("failure at different stream stages", () => {
    const stages: [string, string][] = [
      ["before any content", ""],
      ["mid-content", "Check the dr"],
      ["after substantial content", "Check the drive for an overvoltage trip on the DC bus"],
    ];
    for (const [label, partial] of stages) {
      it(`rolls back cleanly when the stream dies ${label}`, () => {
        const s = fresh();
        const a = beginSend(s, Q)!;
        // whatever had streamed in is on the assistant bubble at failure time
        s.messages = s.messages.map((m) => (m.id === a.assistantId ? { ...m, content: partial } : m));
        failSend(s, a, Q);

        // no orphan of either turn, regardless of how much had arrived
        expect(s.messages).toHaveLength(0);
        expect(s.input).toBe(Q); // question recoverable from the composer
        expect(retryVisible(s)).toBe(true);

        const b = clickRetry(s)!;
        expect(askedCount(s.sentPayloads[s.sentPayloads.length - 1], Q)).toBe(1);
        succeed(s, b, "ok");
      });
    }
  });

  describe("composer interaction", () => {
    it("Retry clears the composer only when it still holds the failed text", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      expect(s.input).toBe(Q);
      clickRetry(s);
      expect(s.input).toBe("");
    });

    it("a manually-typed draft is never clobbered by Retry", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      s.input = "a different question"; // technician retypes
      s.failed = failedAfterEdit(s.failed, s.input); // onChange handler
      expect(s.failed).toBeNull(); // offer withdrawn
      expect(retryVisible(s)).toBe(false);
      expect(s.input).toBe("a different question");
    });

    it("a failure while a new draft is in progress does not overwrite the draft", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      s.input = "meanwhile I typed this";
      failSend(s, a, Q);
      expect(s.input).toBe("meanwhile I typed this"); // restoreComposer defers
      expect(s.failed).toBe(Q); // but Retry still offered
    });
  });

  describe("reload after failure", () => {
    /** Only `messages` is persisted (localStorage). `failed` and `input` are
     *  component state and do not survive a reload. */
    const persist = (s: S) => JSON.parse(JSON.stringify(s.messages.slice(-40))) as Msg[];

    it("no orphaned question is persisted after a failed send", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      expect(persist(s)).toEqual([]);
    });

    it("a reload after failure loses the Retry offer — documented limitation", () => {
      const s = fresh();
      const a = beginSend(s, Q)!;
      failSend(s, a, Q);
      // reload: messages rehydrate, failed/input do not
      const after: S = { ...fresh(), messages: persist(s) };
      expect(retryVisible(after)).toBe(false);
      // The question is recoverable in-session via the composer, but NOT across
      // a reload. This is the same trade-off NotebookChat makes. Pinned here so
      // a future change to persist `failed` is a deliberate decision, not drift.
    });

    it("an earlier successful exchange still survives the reload", () => {
      const s = fresh();
      const a = beginSend(s, "earlier")!;
      succeed(s, a, "earlier answer");
      const b = beginSend(s, Q)!;
      failSend(s, b, Q);
      expect(persist(s).map((m) => m.content)).toEqual(["earlier", "earlier answer"]);
    });
  });
});

/**
 * The scenarios above drive `beginSend` / `clickRetry` / `stopSend`, which
 * TRANSCRIBE three decisions that live inline in the component and cannot be
 * imported (no jsdom). A transcription that silently drifts from the source
 * would turn every scenario above into a test of this file rather than of the
 * component — so pin each one against the real source text.
 */
describe("source pins — the transcribed guards must still match the component", () => {
  const read = (f: string) =>
    fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\s+/g, " ");

  for (const file of ["AssetChat.tsx", "namespace/NodeChat.tsx"]) {
    const src = () => read(file);

    it(`${file}: sendMessage still guards on !text.trim() || streaming`, () => {
      expect(src()).toContain("if (!text.trim() || streaming) return;");
    });

    it(`${file}: sendMessage still clears failed before sending`, () => {
      expect(src()).toContain("setError(null); setFailed(null);");
    });

    it(`${file}: retry still guards on !failed || streaming`, () => {
      expect(src()).toContain("if (!failed || streaming) return;");
    });

    it(`${file}: the AbortError branch still returns BEFORE offering Retry`, () => {
      const t = src();
      const abortAt = t.indexOf('if ((err as Error).name === "AbortError")');
      const setFailedAt = t.indexOf("setFailed(text);");
      const returnAt = t.indexOf("return; }", abortAt);
      expect(abortAt).toBeGreaterThan(-1);
      expect(setFailedAt).toBeGreaterThan(-1);
      // the abort branch's early return precedes the only setFailed(text) call
      expect(returnAt).toBeGreaterThan(abortAt);
      expect(returnAt).toBeLessThan(setFailedAt);
    });

    it(`${file}: apiMessages is still [...messages, userMsg] filtered on !stopped`, () => {
      expect(src()).toContain("const apiMessages = [...messages, userMsg].filter((m) => !m.stopped)");
    });

    it(`${file}: the failure path still rolls back the whole exchange`, () => {
      expect(src()).toContain("rollbackFailedExchange(prev, userMsg.id, assistantMsg.id)");
    });

    it(`${file}: only messages are persisted (failed/input are not)`, () => {
      const t = src();
      expect(t).toContain("localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)))");
      expect(t).not.toContain("JSON.stringify(failed)");
    });
  }
});
