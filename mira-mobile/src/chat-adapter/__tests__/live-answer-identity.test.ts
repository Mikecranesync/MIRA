// #4074 — a live answer is identified by the persisted row id the Hub returns
// on its `turn_saved` frame, not by the session-only `live-<i>-a` id and never
// by the question text. Two devices asking the same question each keep their
// own row id, so a Record-fix button on one live answer cannot reach the other.
//
// Run: cd mira-mobile && bunx vitest run src/chat-adapter/__tests__/live-answer-identity
import { describe, expect, it } from "vitest";
import { parseChatSse } from "../../lib/sse";
import { liveTurnMessages } from "../turns-to-parts";

const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;
const DONE = "data: [DONE]\n\n";
const ROW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const answered = (rowId: string | null) =>
  [
    frame({ kind: "trace", traceId: "t1", turnId: CID }),
    frame({ kind: "content", content: "Check the DC bus." }),
    frame({ kind: "sources", citations: [], sourceSnapshot: [] }),
    ...(rowId ? [frame({ kind: "turn_saved", turnRowId: rowId })] : []),
    frame({ kind: "status", status: "answered" }),
    DONE,
  ].join("");

const answerIdOf = (msgs: ReturnType<typeof liveTurnMessages>) => msgs.find((m) => m.role === "assistant")?.id;

describe("#4074 — parser reads the persisted row id", () => {
  it("exposes turn_saved as persistedTurnId and keeps it out of unknownFrames", () => {
    const t = parseChatSse(answered(ROW_A));
    expect(t.persistedTurnId).toBe(ROW_A);
    expect((t.unknownFrames ?? []).some((f) => (f as { kind?: string }).kind === "turn_saved")).toBe(false);
  });

  it("is absent when no row was saved", () => {
    expect(parseChatSse(answered(null)).persistedTurnId).toBeUndefined();
  });

  it("ignores a malformed row id rather than trusting it", () => {
    const t = parseChatSse(answered("not-a-uuid"));
    expect(t.persistedTurnId).toBeUndefined();
  });

  it("never mistakes the trace turnId (request id) for the row id", () => {
    const t = parseChatSse(answered(null));
    expect(t.persistedTurnId).toBeUndefined();
  });
});

describe("#4074 — the live answer carries its row id into the unified adapter", () => {
  it("a saved live answer is identified as <row id>-a", () => {
    expect(answerIdOf(liveTurnMessages("drive trips", parseChatSse(answered(ROW_A)), 0))).toBe(`${ROW_A}-a`);
  });

  it("two devices asking the same question each map to their own row", () => {
    const first = answerIdOf(liveTurnMessages("drive trips", parseChatSse(answered(ROW_A)), 0));
    const second = answerIdOf(liveTurnMessages("drive trips", parseChatSse(answered(ROW_B)), 1));
    expect(first).toBe(`${ROW_A}-a`);
    expect(second).toBe(`${ROW_B}-a`);
    expect(first).not.toBe(second);
  });

  it("without the frame the live id stays session-only (no fabricated server id)", () => {
    expect(answerIdOf(liveTurnMessages("drive trips", parseChatSse(answered(null)), 3))).toBe("live-3-a");
  });
});
