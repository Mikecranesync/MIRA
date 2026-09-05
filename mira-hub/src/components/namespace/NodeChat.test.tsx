import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ComposerButton,
  MessageBubble,
  NodeChat,
  RetryChip,
  composerAfterRetry,
  failedAfterEdit,
  isEnterToSend,
  restoreComposer,
  rollbackFailedExchange,
  shouldShowRetry,
} from "./NodeChat";

// Static-markup coverage for NodeChat's own MessageBubble (FLEET-006).
// Same pattern as AssetChat.test.tsx, adapted for NodeChat's real
// ChatMessage shape: `sources` (citation chips), not `nextCheck`/`traceId`
// (NodeChat has no next-check evidence line and no `hasSafetyAlert` marker
// on this branch — see NOTE at the bottom of this file).

describe("NodeChat MessageBubble — sources rendering", () => {
  it("renders a SourceChips citation chip when the assistant message carries sources", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m1",
          role: "assistant",
          content: "The comm fault clears after a power cycle.",
          sources: [
            { index: 1, title: "PowerFlex 525 Manual", url: null, page: 42 },
          ],
        }}
      />,
    );

    expect(html).toContain("[1] PowerFlex 525 Manual");
    expect(html).toContain("p.42");
  });

  it("omits the citation chip row when the message has no sources", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m2", role: "assistant", content: "General answer." }}
      />,
    );

    expect(html).not.toContain("flex-wrap gap-1.5");
  });

  it("omits the citation chip row when sources is an empty array", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m3",
          role: "assistant",
          content: "General answer.",
          sources: [],
        }}
      />,
    );

    expect(html).not.toContain("flex-wrap gap-1.5");
  });

  it("renders a page-less citation chip when the source has no page", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m4",
          role: "assistant",
          content: "See the wiring diagram.",
          sources: [{ index: 2, title: "Wiring Diagram", url: null, page: null }],
        }}
      />,
    );

    expect(html).toContain("[2] Wiring Diagram");
    expect(html).not.toContain("p.null");
  });
});

describe("NodeChat MessageBubble — isSafetyStop rendering", () => {
  it("recolors the bubble red and swaps in the AlertTriangle icon on a safety-stop message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m5",
          role: "assistant",
          content: "SAFETY STOP: this requires LOTO before continuing.",
          isSafetyStop: true,
        }}
      />,
    );

    // Bubble + icon-circle background/border/text hard-coded on the safety path.
    expect(html).toContain("var(--status-red-bg)");
    expect(html).toContain("#FECACA");
    expect(html).toContain("#991B1B");
    expect(html).toContain("var(--status-red)");
  });

  it("does not apply the safety-stop treatment to an ordinary assistant message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m6",
          role: "assistant",
          content: "Ordinary grounded answer.",
        }}
      />,
    );

    expect(html).not.toContain("var(--status-red-bg)");
    expect(html).not.toContain("#FECACA");
    expect(html).not.toContain("#991B1B");
    expect(html).not.toContain("var(--status-red)");
  });

  it("never applies the safety-stop treatment to a user message, even if isSafetyStop were set", () => {
    // isSafetyStop isn't a real field on user turns in practice, but MessageBubble
    // branches on msg.role first — a user bubble must stay the plain blue style.
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m7",
          role: "user",
          content: "What do I do next?",
          isSafetyStop: true,
        }}
      />,
    );

    expect(html).not.toContain("var(--status-red-bg)");
    expect(html).toContain("var(--brand-blue)");
  });
});

// NOTE (FLEET-006): the task background referenced an
// `AssetChat MessageBubble — hasSafetyAlert marker` describe block from
// FLEET-005 (PR #3523). That PR is HELD, not merged to origin/main — as of
// this branch's base, `hasSafetyAlert` does not exist on either
// AssetChat's or NodeChat's `ChatMessage`/`MessageBubble` (verified via
// `grep -rn hasSafetyAlert src/` across mira-hub, and by reading the current
// AssetChat.test.tsx in full: it has no such describe block on this
// branch). Per this slice's hard constraint — "Do not invent new
// ChatMessage fields or change NodeChat's rendering behavior" — no
// hasSafetyAlert tests are added here. Once FLEET-005 lands on main and
// AssetChat gains the field for real, port it here the same way this file
// already ported the sources/isSafetyStop cases.

// STRM-2 client-only Stop control — NodeChat is a structural clone of
// AssetChat on this point (see NodeChat.tsx's own header comment), so this
// file mirrors AssetChat.test.tsx's coverage.

describe("NodeChat MessageBubble — Stopped caption (STRM-2)", () => {
  it("renders the Stopped caption when the message was aborted mid-stream", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m1", role: "assistant", content: "Grounded in this folder's docs, the fault", stopped: true }}
      />,
    );

    expect(html).toContain('data-testid="stopped-caption"');
    expect(html).toContain("Stopped");
    // The partial content that had already streamed in stays visible.
    expect(html).toContain("Grounded in this folder");
  });

  it("omits the Stopped caption on an ordinary (non-stopped) message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble msg={{ id: "m2", role: "assistant", content: "General answer." }} />,
    );

    expect(html).not.toContain('data-testid="stopped-caption"');
    expect(html).not.toContain("Stopped");
  });

  it("omits the Stopped caption on a safety-stop message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble msg={{ id: "m3", role: "assistant", content: "SAFETY STOP", isSafetyStop: true }} />,
    );

    expect(html).not.toContain('data-testid="stopped-caption"');
  });
});

// STRM-2: the composer's submit-button slot swaps to an enabled Stop control
// while streaming — same pattern as NotebookChat's busy ? <Stop> : <Send>.
describe("NodeChat ComposerButton — Stop vs Send (STRM-2)", () => {
  it("renders an enabled Stop control while streaming", () => {
    const html = renderToStaticMarkup(
      <ComposerButton streaming={true} canSend={false} onStop={() => {}} />,
    );

    expect(html).toContain('data-testid="stop-button"');
    expect(html).toContain('aria-label="Stop generating"');
    // A Stop button must never render disabled — it must always be clickable.
    expect(html).not.toContain("disabled=\"\"");
    expect(html).not.toContain('type="submit"');
  });

  it("renders the Send submit button when not streaming", () => {
    const html = renderToStaticMarkup(
      <ComposerButton streaming={false} canSend={true} onStop={() => {}} />,
    );

    expect(html).toContain('type="submit"');
    expect(html).not.toContain('data-testid="stop-button"');
  });

  it("disables the Send button when there's nothing to send", () => {
    const html = renderToStaticMarkup(
      <ComposerButton streaming={false} canSend={false} onStop={() => {}} />,
    );

    expect(html).toContain('type="submit"');
    expect(html).toMatch(/disabled(=""|)/);
  });
});


// FLEET-011 — composer correctness: Enter fires send, but never mid-IME-composition
// (Japanese/Chinese/Korean/Vietnamese candidate confirmation). Local guard, same
// shape as equipment/notebook-chat-utils.ts's isEnterToSend but intentionally not
// imported from there (Notebook-specific module; see NodeChat.tsx's comment).
// Mirrors AssetChat.test.tsx — the two composers are structurally identical here.
describe("isEnterToSend (composer IME guard)", () => {
  it("sends on a bare Enter with no composition in progress", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false } })).toBe(true);
  });

  it("never sends while an IME composition is in progress", () => {
    expect(
      isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } }),
    ).toBe(false);
    // Some browsers/IMEs don't set nativeEvent.isComposing reliably; keyCode 229
    // is the historical fallback signal for "this Enter confirmed an IME candidate".
    expect(isEnterToSend({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  });

  it("never sends on Shift+Enter (newline), composing or not", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: true })).toBe(false);
    expect(
      isEnterToSend({ key: "Enter", shiftKey: true, nativeEvent: { isComposing: true } }),
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(isEnterToSend({ key: "a", shiftKey: false })).toBe(false);
  });
});

describe("NodeChat composer accessibility", () => {
  it("gives the textarea and the Send button an accessible name", () => {
    const html = renderToStaticMarkup(
      <NodeChat nodeId="n1" nodeName="Line 3" unsPath="enterprise.garage.line3" />,
    );

    expect(html).toContain('aria-label="Ask about this folder"');
    expect(html).toContain('aria-label="Send"');
  });
});


// FLEET-012: on a real send failure the technician's question goes back into
// the composer (mirrors Notebook chat's CMPS-2 restoreComposer). Pure-function
// coverage only — no rendering needed for this part.
describe("NodeChat restoreComposer", () => {
  it("restores the failed message when the composer is empty", () => {
    expect(restoreComposer("", "What does fault F005 mean?")).toBe("What does fault F005 mean?");
  });

  it("does not clobber a new draft the technician already started typing", () => {
    expect(restoreComposer("something else entirely", "What does fault F005 mean?")).toBe(
      "something else entirely",
    );
  });

  it("treats whitespace-only composer content as empty and restores the failed message", () => {
    expect(restoreComposer("   \n\t  ", "What does fault F005 mean?")).toBe("What does fault F005 mean?");
  });
});

// FLEET-013: a real Retry button that re-posts the exact failed text via the
// existing sendMessage() — completes the CMPS-2 contract FLEET-012 started.
describe("NodeChat shouldShowRetry", () => {
  it("shows the Retry chip after a failure while idle", () => {
    expect(shouldShowRetry("What does fault F005 mean?", false)).toBe(true);
  });

  it("hides the Retry chip when there is no failed send", () => {
    expect(shouldShowRetry(null, false)).toBe(false);
  });

  it("hides the Retry chip while a new attempt is streaming", () => {
    expect(shouldShowRetry("What does fault F005 mean?", true)).toBe(false);
  });

  it("hides the Retry chip when both there is no failure and it is streaming", () => {
    expect(shouldShowRetry(null, true)).toBe(false);
  });
});

describe("NodeChat composerAfterRetry", () => {
  it("clears the composer when it still shows exactly the failed text", () => {
    expect(composerAfterRetry("What does fault F005 mean?", "What does fault F005 mean?")).toBe("");
  });

  it("leaves a manually-started different draft untouched", () => {
    expect(composerAfterRetry("actually, a different question", "What does fault F005 mean?")).toBe(
      "actually, a different question",
    );
  });
});

describe("NodeChat failedAfterEdit", () => {
  it("withdraws the Retry offer once the composer no longer matches the failed text", () => {
    expect(failedAfterEdit("What does fault F005 mean?", "something else")).toBe(null);
  });

  it("keeps the Retry offer while the composer still matches the failed text", () => {
    expect(failedAfterEdit("What does fault F005 mean?", "What does fault F005 mean?")).toBe(
      "What does fault F005 mean?",
    );
  });

  it("is a no-op when there is no failed send to withdraw", () => {
    expect(failedAfterEdit(null, "anything")).toBe(null);
  });
});

describe("NodeChat RetryChip", () => {
  it("renders the Retry affordance with its testid, icon, and label", () => {
    const html = renderToStaticMarkup(<RetryChip onClick={() => {}} />);

    expect(html).toContain('data-testid="retry-button"');
    expect(html).toContain("Retry");
    expect(html).toContain("<svg"); // RotateCcw icon
  });
});

// FLEET-013 defect (found during the overnight prep of #3531): a failed send
// used to pop only the empty assistant bubble, orphaning the user turn in the
// transcript. Retry then appended a SECOND copy of the same question — a
// duplicate user turn, and the same question twice in the API payload.
// NotebookChat (the reference) rolls back the whole optimistic exchange.
describe("NodeChat rollbackFailedExchange — a failed send leaves no orphan turn", () => {
  const exchange = () => [
    { id: "u0", role: "user", content: "earlier question" },
    { id: "a0", role: "assistant", content: "earlier answer" },
    { id: "u1", role: "user", content: "What does fault F005 mean?" },
    { id: "a1", role: "assistant", content: "" },
  ];

  it("removes BOTH the user turn and the empty assistant bubble", () => {
    expect(rollbackFailedExchange(exchange(), "u1", "a1")).toEqual([
      { id: "u0", role: "user", content: "earlier question" },
      { id: "a0", role: "assistant", content: "earlier answer" },
    ]);
  });

  it("leaves earlier history untouched", () => {
    const out = rollbackFailedExchange(exchange(), "u1", "a1");
    expect(out.map((m) => m.id)).toEqual(["u0", "a0"]);
  });

  it("a Retry after rollback cannot produce a duplicate user turn", () => {
    // failure rolls the exchange back...
    const afterFailure = rollbackFailedExchange(exchange(), "u1", "a1");
    // ...then Retry re-sends, appending the question exactly once.
    const afterRetry = [
      ...afterFailure,
      { id: "u2", role: "user", content: "What does fault F005 mean?" },
      { id: "a2", role: "assistant", content: "" },
    ];
    const asked = afterRetry.filter((m) => m.content === "What does fault F005 mean?");
    expect(asked).toHaveLength(1);
  });

  it("is a no-op when the ids are not present", () => {
    expect(rollbackFailedExchange(exchange(), "nope", "alsonope")).toHaveLength(4);
  });
});
