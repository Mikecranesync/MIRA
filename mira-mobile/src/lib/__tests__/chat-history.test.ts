// CONV-3: the phone sends the recent thread, so a follow-up has memory —
// same contract the web client ships (last 12 role/content lines; the server
// sanitizes and caps again).
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/chat-history

import { describe, it, expect } from "vitest";
import { buildChatHistory, isStoppedTurn } from "../../api/resources";

const served = (q: string, a: string) => ({ question: q, answerText: a, answerStatus: "answered" });
const refused = (q: string) => ({ question: q, answerText: null, answerStatus: "insufficient_evidence" });
// STRM-2 stopped-turn contract: a client-stopped turn is persisted as
// answer_status='error' WITH the partial text; a provider failure is 'error'
// with answer_text NULL.
const stopped = (q: string, partial: string) => ({ question: q, answerText: partial, answerStatus: "error" });
const failed = (q: string) => ({ question: q, answerText: null, answerStatus: "error" });
const live = (q: string, a: string) => ({ q, a: { answer: a } });

describe("buildChatHistory", () => {
  it("interleaves persisted then live turns, chronologically, as role/content", () => {
    const h = buildChatHistory([served("q1", "a1")], [live("q2", "a2")]);
    expect(h).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("a refusal contributes its question but never a fabricated answer line", () => {
    const h = buildChatHistory([refused("is there an overload device?")], []);
    expect(h).toEqual([{ role: "user", content: "is there an overload device?" }]);
  });

  it("keeps only the most recent 12 lines — the tail, not the head", () => {
    const turns = Array.from({ length: 10 }, (_, i) => served(`q${i}`, `a${i}`));
    const h = buildChatHistory(turns, []);
    expect(h).toHaveLength(12);
    expect(h[0]).toEqual({ role: "user", content: "q4" });
    expect(h.at(-1)).toEqual({ role: "assistant", content: "a9" });
  });

  it("drops empty/whitespace content instead of sending blank lines", () => {
    const h = buildChatHistory([served("  ", "")], [live("real?", "  ")]);
    expect(h).toEqual([{ role: "user", content: "real?" }]);
  });

  it("STRM-2: a persisted STOPPED turn (error + partial text) is excluded entirely — question and partial", () => {
    const h = buildChatHistory(
      [served("q1", "a1"), stopped("explain F004", "F004 is an under-vol"), served("q3", "a3")],
      [],
    );
    expect(h).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ]);
    expect(JSON.stringify(h)).not.toContain("F004");
  });

  it("STRM-2: a persisted provider-failure turn (error + null text) keeps its question, no answer line (existing behavior)", () => {
    const h = buildChatHistory([failed("what tripped?")], []);
    expect(h).toEqual([{ role: "user", content: "what tripped?" }]);
  });

  it("isStoppedTurn: error+text is stopped; error+null, answered, whitespace are not", () => {
    expect(isStoppedTurn(stopped("q", "partial"))).toBe(true);
    expect(isStoppedTurn(failed("q"))).toBe(false);
    expect(isStoppedTurn(served("q", "a"))).toBe(false);
    expect(isStoppedTurn({ answerStatus: "error", answerText: "   " })).toBe(false);
  });
});
