import { describe, expect, it } from "vitest";
import { liveTurnsSignature, mapLiveAnswersToServerIds, unmappedLiveAnswers } from "../live-turn-ids";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const live = (q: string, status = "answered") => ({ q, a: { status } });
const row = (id: string, question: string, over: Record<string, string> = {}) => ({
  id,
  question,
  answerStatus: "answered",
  ...over,
});

describe("mapLiveAnswersToServerIds — the answer just received gets its server id (#4061)", () => {
  it("maps a finished live answer to its newly persisted row", () => {
    const m = mapLiveAnswersToServerIds([live("GS10 trips oC")], [row(A, "GS10 trips oC")], { alreadyRendered: new Set() });
    expect(m.get("live-0-a")).toBe(A);
  });

  it("never maps to a row the shell already renders from the server", () => {
    const m = mapLiveAnswersToServerIds([live("GS10 trips oC")], [row(A, "GS10 trips oC")], {
      alreadyRendered: new Set([A]),
    });
    expect(m.size).toBe(0);
  });

  it("pairs repeated questions oldest-first, one row each", () => {
    const m = mapLiveAnswersToServerIds(
      [live("why"), live("why")],
      [row(B, "why", { createdAt: "2026-09-27T20:02:00Z" }), row(A, "why", { createdAt: "2026-09-27T20:01:00Z" })],
      { alreadyRendered: new Set() },
    );
    expect([m.get("live-0-a"), m.get("live-1-a")]).toEqual([A, B]);
  });

  it("leaves unanswered / stopped live turns and non-answered rows unmapped", () => {
    const m = mapLiveAnswersToServerIds(
      [live("q1", "stopped"), live("q2")],
      [row(A, "q1"), row(B, "q2", { answerStatus: "insufficient_evidence" })],
      { alreadyRendered: new Set() },
    );
    expect(m.size).toBe(0);
  });

  it("ignores rows from another thread when the thread is known", () => {
    const m = mapLiveAnswersToServerIds([live("q")], [row(A, "q", { threadId: "other" }), row(C, "q", { threadId: "t1" })], {
      alreadyRendered: new Set(),
      threadId: "t1",
    });
    expect(m.get("live-0-a")).toBe(C);
  });

  it("does not guess when the question text differs", () => {
    const m = mapLiveAnswersToServerIds([live("GS10 trips oC")], [row(A, "GS10 trips oV")], { alreadyRendered: new Set() });
    expect(m.size).toBe(0);
  });

  it("unmappedLiveAnswers lists only answered live turns without an id", () => {
    const mapped = new Map([["live-0-a", A]]);
    expect(unmappedLiveAnswers([live("a"), live("b"), live("c", "error")], mapped)).toEqual(["live-1-a"]);
  });

  it("a mapping is invalidated by a thread switch even when live indexes collide", () => {
    const before = liveTurnsSignature("nb", "t1", [live("q")]);
    expect(liveTurnsSignature("nb", "t2", [live("q")])).not.toBe(before);
    expect(liveTurnsSignature("nb", "t1", [live("other")])).not.toBe(before);
    expect(liveTurnsSignature("nb", "t1", [live("q")])).toBe(before);
  });
});
