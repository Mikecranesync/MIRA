import { describe, expect, it } from "vitest";

import { assetAnswerCopyPayload } from "./AssetChat";

/**
 * B-8 on the asset chat — the third and last surface.
 *
 * This payload is deliberately thinner than the notebook chat's, and the tests
 * record WHY so the difference is not read as an oversight: `ChatMessage` on
 * this surface carries no citations, so there are no sources to attach. That is
 * an E-1/E-2 gap in the surface itself, not something a copy control can fix.
 *
 * What it can do is refuse to misrepresent the answer it copies.
 */

describe("assetAnswerCopyPayload", () => {
  it("carries the answer", () => {
    expect(assetAnswerCopyPayload({ content: "Check the supply voltage first." })).toBe(
      "Check the supply voltage first.",
    );
  });

  it("says so when the answer was cut short", () => {
    // The technician pressed Stop mid-stream, so `content` is whatever arrived.
    // Pasting that into a work order unlabelled presents a truncated answer as
    // a complete one — the reader has no way to know.
    const out = assetAnswerCopyPayload({ content: "Check the supply", stopped: true });
    expect(out).toContain("Check the supply");
    expect(out).toContain("Stopped");
    expect(out).toContain("cut short");
  });

  it("carries the fact that a safety alert accompanied the answer", () => {
    const out = assetAnswerCopyPayload({ content: "Isolate before testing.", hasSafetyAlert: true });
    expect(out).toContain("safety alert");
  });

  it("adds nothing to a complete, alert-free answer", () => {
    // No decoration on the ordinary case: the paste is the answer.
    const out = assetAnswerCopyPayload({ content: "Torque to 4.5 Nm." });
    expect(out).toBe("Torque to 4.5 Nm.");
    expect(out).not.toContain("Stopped");
    expect(out).not.toContain("safety");
  });

  it("a stopped answer and a complete one are distinguishable after pasting", () => {
    const complete = assetAnswerCopyPayload({ content: "Same text." });
    const stopped = assetAnswerCopyPayload({ content: "Same text.", stopped: true });
    expect(complete).not.toEqual(stopped);
  });
});
