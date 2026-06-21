import { describe, it, expect } from "vitest";
import { config } from "./middleware";

// The i3X API (/api/i3x/v1/*) has its OWN bearer-key auth (resolveI3xTenant) and
// MUST bypass the Hub's session-cookie middleware — otherwise the middleware
// 401s every request (including the spec-mandated-public GET /info) before the
// route handler runs. This guards that the matcher excludes the i3X surface.
const matcherRe = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher — i3X API bypasses Hub session auth", () => {
  it("does NOT match /api/i3x/* (so middleware is skipped and bearer auth applies)", () => {
    expect(matcherRe.test("/api/i3x/v1/info")).toBe(false);
    expect(matcherRe.test("/api/i3x/v1/info/")).toBe(false);
    expect(matcherRe.test("/api/i3x/v1/objects/value")).toBe(false);
    expect(matcherRe.test("/api/i3x/v1/namespaces")).toBe(false);
  });

  it("still protects other /api routes (no over-broad exclusion)", () => {
    expect(matcherRe.test("/api/work-orders")).toBe(true);
    expect(matcherRe.test("/api/cmms/assets")).toBe(true);
  });

  it("does not accidentally exclude lookalike paths", () => {
    // a route that merely starts with the same letters must still be gated
    expect(matcherRe.test("/api/i3xtra")).toBe(true);
  });
});
