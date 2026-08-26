// CONV-3: the phone sends the recent thread, so a follow-up has memory —
// same contract the web client ships (last 12 role/content lines; the server
// sanitizes and caps again).
//
// Run: cd mira-mobile && npx vitest run src/lib/__tests__/chat-history

import { describe, it, expect } from "vitest";
import { buildChatHistory } from "../../api/resources";

const served = (q: string, a: string) => ({ question: q, answerText: a });
const refused = (q: string) => ({ question: q, answerText: null });
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
});
