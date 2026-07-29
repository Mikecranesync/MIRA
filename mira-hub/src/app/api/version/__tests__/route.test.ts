import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

describe("GET /api/version (#2226)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the baked deploy identity from env", async () => {
    vi.stubEnv("MIRA_APP_VERSION", "3.39.14");
    vi.stubEnv("MIRA_GIT_SHA", "abc1234");
    vi.stubEnv("MIRA_BUILD_TIME", "2026-06-22T00:00:00Z");
    const res = GET();
    const body = await res.json();
    expect(body.service).toBe("mira-hub");
    expect(body.version).toBe("3.39.14");
    expect(body.gitSha).toBe("abc1234");
    expect(body.builtAt).toBe("2026-06-22T00:00:00Z");
    expect(typeof body.ts).toBe("number");
  });

  it("falls back to 'unknown' when the build-args were not injected", async () => {
    vi.stubEnv("MIRA_APP_VERSION", "");
    vi.stubEnv("MIRA_GIT_SHA", "");
    vi.stubEnv("MIRA_BUILD_TIME", "");
    const body = await GET().json();
    expect(body.version).toBe("unknown");
    expect(body.gitSha).toBe("unknown");
    expect(body.builtAt).toBe("unknown");
  });
});
