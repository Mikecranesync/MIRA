import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { test, identity, reserveWalkSpend, launch } = vi.hoisted(() => ({
  test: Object.assign(vi.fn(), { setTimeout: vi.fn() }),
  identity: vi.fn(),
  reserveWalkSpend: vi.fn(),
  launch: vi.fn(),
}));

vi.mock("@playwright/test", () => ({ test, chromium: { launch } }));
vi.mock("./staging", async (importOriginal) => ({
  ...await importOriginal<typeof import("./staging")>(),
  identity,
  assertOpenRouterCeiling: vi.fn(),
}));
vi.mock("./journey-guard", async (importOriginal) => ({
  ...await importOriginal<typeof import("./journey-guard")>(),
  requireDeployedPricing: () => "test-pricing",
}));
vi.mock("./required-fixes", () => ({ githubToken: () => "test-token" }));
vi.mock("./spend-ledger", () => ({ reserveWalkSpend }));

describe("CV-101 journey budget", () => {
  let out: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    out = mkdtempSync(path.join(tmpdir(), "cv101-budget-"));
    vi.stubEnv("CV_OUT", out);
    vi.stubEnv("CV_TARGET", "desktop");
    vi.stubEnv("CV_PAID", "1");
    vi.stubEnv("STRANGER_WALK_BASE", undefined);
    identity.mockResolvedValue({ gitSha: "test-build", builtAt: "test-time", deploymentGeneration: "test-gen" });
    // Observe the actual reservation request, then stop the run before any browser or account is started.
    reserveWalkSpend.mockResolvedValue({ ok: false, reason: "unit test stop" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(out, { recursive: true, force: true });
  });

  async function runJourney(rawBudget: string | undefined) {
    vi.stubEnv("STRANGER_WALK_BUDGET_USD", rawBudget);
    await import("./cv101-journey.spec");
    expect(test).toHaveBeenCalledOnce();
    await test.mock.calls[0][1]();
  }

  it.each([["0.50", 0.5], [undefined, 1], ["1.00", 1], ["0", 0]])("uses %s for both reservation and meter", async (raw, expected) => {
    await expect(runJourney(raw)).rejects.toThrow(/unit test stop/);
    expect(reserveWalkSpend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usd: expected }));
    const receipt = JSON.parse(readFileSync(path.join(out, "run.json"), "utf8"));
    expect(receipt.budgetUsd).toBe(expected);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each(["1.01", "2", "abc", "-0.01", "Infinity"])("rejects %s before preflight or paid work", async (raw) => {
    await expect(runJourney(raw)).rejects.toThrow(/outside the \$0–\$1 budget/);
    expect(identity).not.toHaveBeenCalled();
    expect(reserveWalkSpend).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
});
