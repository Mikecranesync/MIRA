// mira-hub/src/lib/__tests__/onboarding-flow.test.ts
import { describe, it, expect } from "vitest";
import { isManualReady, shouldRedirectToOnboarding } from "@/lib/onboarding-flow";

describe("isManualReady", () => {
  it("true only when parsed AND chunks > 0", () => {
    expect(isManualReady({ status: "parsed", knowledge_chunks_count: 3 })).toBe(true);
  });
  it("false while parsed but no chunks yet", () => {
    expect(isManualReady({ status: "parsed", knowledge_chunks_count: 0 })).toBe(false);
  });
  it("false for in-flight statuses", () => {
    expect(isManualReady({ status: "uploaded", knowledge_chunks_count: 0 })).toBe(false);
    expect(isManualReady({ status: "processing", knowledge_chunks_count: 0 })).toBe(false);
  });
  it("false for error status even with stale counts", () => {
    expect(isManualReady({ status: "error", knowledge_chunks_count: 5 })).toBe(false);
  });
});

describe("shouldRedirectToOnboarding", () => {
  it("redirects when wizard not started or in progress", () => {
    expect(shouldRedirectToOnboarding("not_started")).toBe(true);
    expect(shouldRedirectToOnboarding("in_progress")).toBe(true);
  });
  it("does NOT redirect a completed tenant", () => {
    expect(shouldRedirectToOnboarding("completed")).toBe(false);
  });
  it("does NOT redirect on unknown/empty status (fail safe: stay on feed)", () => {
    expect(shouldRedirectToOnboarding("")).toBe(false);
    expect(shouldRedirectToOnboarding("weird")).toBe(false);
  });
});
