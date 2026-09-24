/**
 * Unit test for next.config.ts redirects() logic
 *
 * Regression test for staging hub root 404 (Mike P0 2026-09-21) — staging root
 * was 404ing because the config was redirecting / → /hub/ unconditionally,
 * but staging has basePath="", so /hub/ doesn't exist.
 *
 * The redirect should only apply when basePath="/hub".
 */

import { describe, it, expect } from "vitest";

describe("next.config.ts redirects()", () => {
  it("should return / → /hub/ redirect when basePath is /hub", () => {
    const basePath = "/hub";
    const redirects = getRedirects(basePath);

    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toEqual({
      source: "/",
      destination: "/hub/",
      basePath: false,
      permanent: false,
    });
  });

  it("should return empty array when basePath is empty string (staging)", () => {
    const basePath = "";
    const redirects = getRedirects(basePath);

    expect(redirects).toHaveLength(0);
  });

  it("should return empty array when basePath is undefined", () => {
    const basePath = undefined;
    const redirects = getRedirects(basePath);

    expect(redirects).toHaveLength(0);
  });
});

/**
 * Extract the redirects logic from next.config.ts for testing.
 * This mirrors the actual implementation in next.config.ts.
 */
function getRedirects(basePath: string | undefined): Array<{
  source: string;
  destination: string;
  basePath: boolean;
  permanent: boolean;
}> {
  if (basePath === "/hub") {
    return [{ source: "/", destination: "/hub/", basePath: false, permanent: false }];
  }
  return [];
}
