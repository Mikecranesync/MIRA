/**
 * D6 — the provider health cache, clock-driven.
 *
 * Run: npx vitest run src/capabilities/__tests__/provider-health.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_PROVIDERS_FAILED_MESSAGE,
  DEFAULT_UNHEALTHY_S,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  ProviderHealth,
  providerExhaustionStatus,
  providerHealth,
  resetProviderHealthForTests,
  unhealthyWindowMs,
} from "@/capabilities/provider-health";

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.MIRA_PROVIDER_UNHEALTHY_S;
  resetProviderHealthForTests();
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("ProviderHealth", () => {
  it("quarantines on 401/402/403 for the window, then forgets", () => {
    let now = 1_000_000;
    const h = new ProviderHealth(() => now);
    for (const status of [401, 402, 403]) {
      expect(h.markFailed("P", status)).toBe(true);
      expect(h.isUnhealthy("P")).toBe(true);
      now += DEFAULT_UNHEALTHY_S * 1000 - 1;
      expect(h.isUnhealthy("P")).toBe(true);
      now += 1;
      expect(h.isUnhealthy("P")).toBe(false);
    }
  });

  it("control: 429, 500, 503 and a thrown error (null status) never quarantine", () => {
    const h = new ProviderHealth(() => 0);
    for (const status of [429, 500, 503, 400, null]) {
      expect(h.markFailed("P", status)).toBe(false);
      expect(h.isUnhealthy("P")).toBe(false);
    }
  });

  it("a provider that serves is healthy again at once, inside the window", () => {
    const h = new ProviderHealth(() => 5);
    h.markFailed("P", 402);
    expect(h.isUnhealthy("P")).toBe(true);
    h.markHealthy("P");
    expect(h.isUnhealthy("P")).toBe(false);
  });

  it("is per provider name", () => {
    const h = new ProviderHealth(() => 5);
    h.markFailed("OpenAI", 402);
    expect(h.isUnhealthy("OpenAI")).toBe(true);
    expect(h.isUnhealthy("Groq")).toBe(false);
  });

  it("the singleton is one object per process and resettable for tests", () => {
    const a = providerHealth();
    expect(providerHealth()).toBe(a);
    a.markFailed("P", 402);
    resetProviderHealthForTests();
    expect(providerHealth()).not.toBe(a);
    expect(providerHealth().isUnhealthy("P")).toBe(false);
  });
});

describe("unhealthyWindowMs", () => {
  it("defaults to 300 s; honours the env var; an EMPTY string (compose's ${VAR:-}) is the default, not 0", () => {
    expect(unhealthyWindowMs()).toBe(300_000);
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "45";
    expect(unhealthyWindowMs()).toBe(45_000);
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "";
    expect(unhealthyWindowMs()).toBe(300_000);
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "0";
    expect(unhealthyWindowMs()).toBe(0);
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "nonsense";
    expect(unhealthyWindowMs()).toBe(300_000);
    process.env.MIRA_PROVIDER_UNHEALTHY_S = "-5";
    expect(unhealthyWindowMs()).toBe(300_000);
  });
});

describe("providerExhaustionStatus", () => {
  it("an empty record is no_provider_configured; a non-empty one is all_providers_failed with the record intact", () => {
    expect(providerExhaustionStatus([])).toEqual({
      message: NO_PROVIDER_CONFIGURED_MESSAGE,
      reason: "no_provider_configured",
      providers: [],
    });
    const failures = [{ provider: "OpenAI", httpStatus: 402, reason: "http_error" }];
    expect(providerExhaustionStatus(failures)).toEqual({
      message: ALL_PROVIDERS_FAILED_MESSAGE,
      reason: "all_providers_failed",
      providers: failures,
    });
  });
});
