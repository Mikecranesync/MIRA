import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetChat, ComposerButton, MessageBubble, isEnterToSend, restoreComposer } from "./AssetChat";

// Static-markup coverage for the machine-memory "Next check" evidence line
// (T2 Task 4) — same pattern as MachineMemoryCard.test.tsx.

describe("AssetChat MessageBubble", () => {
  it("renders a Next check line when the assistant message carries one", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m1",
          role: "assistant",
          content: "The VFD comm link went stale during the last run.",
          nextCheck: "verify VFD comm cable",
          traceId: "t1",
        }}
      />,
    );

    expect(html).toContain("Next check: verify VFD comm cable");
    // The trace panel toggle still renders alongside it.
    expect(html).toContain("Why MIRA thinks this");
  });

  it("omits the Next check line when the message has none", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m2", role: "assistant", content: "General answer." }}
      />,
    );

    expect(html).not.toContain("Next check:");
  });

  it("omits the Next check line on a safety-stop message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m3",
          role: "assistant",
          content: "SAFETY STOP",
          isSafetyStop: true,
          nextCheck: "verify VFD comm cable",
        }}
      />,
    );

    expect(html).not.toContain("Next check:");
  });
});

// FLEET-005 — H4 gap-admission safety alert (#2542) distinct render.
// `hasSafetyAlert` is a separate flag from the hard-stop `isSafetyStop`: it
// marks an alert *appended to* a real answer, never a refusal replacing one.
describe("AssetChat MessageBubble — hasSafetyAlert marker", () => {
  it("renders the inline safety-alert marker when hasSafetyAlert is true", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m4",
          role: "assistant",
          content: "Isolate power before servicing.\n\n---\n⛔ SAFETY ALERT — LOTO\nFollow lockout/tagout.",
          hasSafetyAlert: true,
        }}
      />,
    );

    expect(html).toContain("Safety alert included above");
  });

  it("does not render the marker for an ordinary content-only message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m5", role: "assistant", content: "General answer, no alert." }}
      />,
    );

    expect(html).not.toContain("Safety alert included above");
  });

  it("keeps the marker and the hard-stop bubble recolor genuinely independent", () => {
    // Not how the two flags are triggered in practice (a hard stop never
    // reaches the model, so a real message never carries both) — this proves
    // the render paths don't share state: hasSafetyAlert draws its own inline
    // marker without touching the isSafetyStop bubble recolor, and vice versa.
    const bothHtml = renderToStaticMarkup(
      <MessageBubble
        msg={{
          id: "m6",
          role: "assistant",
          content: "hybrid",
          isSafetyStop: true,
          hasSafetyAlert: true,
        }}
      />,
    );
    expect(bothHtml).toContain("Safety alert included above");
    expect(bothHtml).toContain("var(--status-red-bg)"); // isSafetyStop's whole-bubble recolor still applies

    const alertOnlyHtml = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m7", role: "assistant", content: "alert only", hasSafetyAlert: true }}
      />,
    );
    expect(alertOnlyHtml).toContain("Safety alert included above");
    // hasSafetyAlert alone must NOT trigger the hard-stop whole-bubble recolor.
    expect(alertOnlyHtml).not.toContain("var(--status-red-bg)");
  });
});

// STRM-2 client-only Stop control — same contract as NotebookChat's Bubble
// "Stopped" caption test.
describe("AssetChat MessageBubble — Stopped caption (STRM-2)", () => {
  it("renders the Stopped caption when the message was aborted mid-stream", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m4", role: "assistant", content: "The VFD comm link went", stopped: true }}
      />,
    );

    expect(html).toContain('data-testid="stopped-caption"');
    expect(html).toContain("Stopped");
    // The partial content that had already streamed in stays visible.
    expect(html).toContain("The VFD comm link went");
  });

  it("omits the Stopped caption on an ordinary (non-stopped) message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble msg={{ id: "m5", role: "assistant", content: "General answer." }} />,
    );

    expect(html).not.toContain('data-testid="stopped-caption"');
    expect(html).not.toContain("Stopped");
  });
});

// STRM-2: the composer's submit-button slot swaps to an enabled Stop control
// while streaming — same pattern as NotebookChat's busy ? <Stop> : <Send>.
describe("AssetChat ComposerButton — Stop vs Send (STRM-2)", () => {
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
// imported from there (Notebook-specific module; see AssetChat.tsx's comment).
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

describe("AssetChat composer accessibility", () => {
  it("gives the textarea and the Send button an accessible name", () => {
    const html = renderToStaticMarkup(
      <AssetChat assetId="a1" assetName="Conveyor CV-101" assetTag="CV-101" />,
    );

    expect(html).toContain('aria-label="Ask about this asset"');
    expect(html).toContain('aria-label="Send"');
  });
});

// FLEET-012: on a real send failure the technician's question goes back into
// the composer (mirrors Notebook chat's CMPS-2 restoreComposer).
describe("AssetChat restoreComposer", () => {
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
