import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerButton, MessageBubble } from "./NodeChat";

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
