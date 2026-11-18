import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

afterEach(() => vi.unstubAllEnvs());

describe("Mission Control release identity (#5629)", () => {
  it("reports the same build and generation while a real feature toggle changes its digest", async () => {
    vi.stubEnv("MIRA_GIT_SHA", "a".repeat(40));
    vi.stubEnv("MIRA_EQUIPMENT_NAV", "1");
    const on = await GET().json();
    vi.stubEnv("MIRA_EQUIPMENT_NAV", "true");
    const alsoOn = await GET().json();
    vi.stubEnv("MIRA_EQUIPMENT_NAV", "0");
    const off = await GET().json();
    expect(on.gitSha).toBe(off.gitSha);
    expect(on.runtimeGeneration).toBe(off.runtimeGeneration);
    expect(on.runtimeGeneration).toBeTruthy();
    expect(on.configurationSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(alsoOn.configurationSha256).toBe(on.configurationSha256);
    expect(off.configurationSha256).not.toBe(on.configurationSha256);
  });
});
