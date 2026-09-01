import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageBubble } from "./AssetChat";

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
    expect(bothHtml).toContain("#FEF2F2"); // isSafetyStop's whole-bubble recolor still applies

    const alertOnlyHtml = renderToStaticMarkup(
      <MessageBubble
        msg={{ id: "m7", role: "assistant", content: "alert only", hasSafetyAlert: true }}
      />,
    );
    expect(alertOnlyHtml).toContain("Safety alert included above");
    // hasSafetyAlert alone must NOT trigger the hard-stop whole-bubble recolor.
    expect(alertOnlyHtml).not.toContain("#FEF2F2");
  });
});
