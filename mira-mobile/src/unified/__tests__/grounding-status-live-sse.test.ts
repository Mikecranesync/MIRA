// F004 M2 (#4303): live = saved on the phone. The server's frames for a refused
// manual-based turn — in the exact order the chat route sends them — go
// through the phone's REAL stream parser (lib/sse.ts, unchanged) and adapter
// (turns-to-parts.ts, unchanged); the same entry saved on the turn goes
// through the saved-row path. Both must land on the same shared part.
// Run: cd mira-mobile && npx vitest run src/unified/__tests__/grounding-status-live-sse
import { describe, expect, it } from "vitest";
import { createChatSseParser } from "../../lib/sse";
import { threadMessages } from "../../chat-adapter/turns-to-parts";
import { toThread, type UnifiedNotebookMeta } from "../to-interaction";

const META: UnifiedNotebookMeta = {
  notebookId: "nb-1",
  title: "PowerFlex 525 Line 1",
  tenantId: "t-1",
  asset: null,
  identityConfirmed: false,
  capturedAt: "2026-10-07T00:00:00.000Z",
};

const ENTRY = {
  kind: "grounding_status",
  v: 1,
  outcome: "refused_with_passages",
  retrieval: { status: "passages_found", scopeDocIds: ["doc-a"], passageCount: 2, returnedDocIds: ["doc-a"], returnedSourceRefs: [] },
  citation: { status: "refused", linkedDocIds: [], linkedSourceRefs: [], unresolvedMarkerCount: 0 },
  manualCited: false,
  droppedRefCount: 0,
  fallback: { offered: true },
};

const sse = (frame: unknown) => `data: ${JSON.stringify(frame)}\n\n`;

describe("grounding_status: live stream and saved row agree on the phone", () => {
  it("the live entry (sent just before status) and the saved entry map to the same part", () => {
    const parser = createChatSseParser();
    parser.push(sse({ kind: "sources", count: 2 }));
    parser.push(sse({ kind: "content", text: "I couldn't answer that from the selected sources." }));
    parser.push(sse({ kind: "evidence", basis: "general_reasoning", label: "General guidance — not grounded in your documents" }));
    parser.push(sse(ENTRY));
    parser.push(sse({ kind: "status", status: "insufficient_evidence", message: "I couldn't answer that from the selected sources." }));
    const live = parser.turn();
    // Precondition: the unchanged parser kept the entry as an inspectable frame.
    expect(live.unknownFrames).toEqual([ENTRY]);

    const liveThread = toThread(threadMessages([], [{ q: "What does F004 mean", a: live }], null), META);
    const savedThread = toThread(
      threadMessages(
        [{
          id: "11111111-1111-4111-8111-111111111111",
          question: "What does F004 mean",
          answerStatus: "insufficient_evidence",
          answerText: "I couldn't answer that from the selected sources.",
          evidence: [ENTRY],
          basis: "general_reasoning",
        }],
        [],
        null,
      ),
      META,
    );
    const statusOf = (t: { turns: readonly { role: string; parts: readonly { type: string }[] }[] }) =>
      t.turns.find((x) => x.role === "assistant")!.parts.find((p) => p.type === "grounding_status");
    expect(statusOf(liveThread)).toEqual({
      type: "grounding_status",
      outcome: "refused_with_passages",
      manualSearched: true,
      searchScope: "selected_manual",
      passagesFrom: "selected_manual",
      fallbackOffered: true,
      isGeneralFallback: false,
    });
    expect(statusOf(savedThread)).toEqual(statusOf(liveThread));
    for (const t of [liveThread, savedThread]) {
      const answer = t.turns.find((x) => x.role === "assistant")!;
      expect(answer.parts.some((p) => p.type === "unknown")).toBe(false);
      expect(answer.parts.some((p) => p.type === "evidence_basis")).toBe(false);
    }
  });
});
