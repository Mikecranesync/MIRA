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
