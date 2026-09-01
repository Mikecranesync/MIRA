/**
 * Adversarial SSE soak — FULL TIER.
 *
 * Excluded from the default vitest run (see vitest.config.ts) so it never slows
 * the PR path. Run by .github/workflows/stream-soak-nightly.yml, or on demand:
 *
 *     bun run vitest run --config vitest.soak.config.ts
 *     SOAK_SEEDS=256 SOAK_RUNS=4000 bun run vitest run --config vitest.soak.config.ts
 *
 * Defaults to 64 seeds x 2,000 runs = 128,000 streams. SOAK_SEEDS / SOAK_RUNS
 * scale it for a longer adversarial hunt; seeds stay deterministic, so any
 * violation reported here reproduces exactly from the seed in its message.
 */
import { describe, expect, it } from "vitest";

import { readNotebookStream } from "../notebook-chat-utils";
import { runTier } from "./stream-soak-harness";

const SEED_COUNT = Number(process.env.SOAK_SEEDS ?? 64);
const RUNS_PER_SEED = Number(process.env.SOAK_RUNS ?? 2000);
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => 1 + i * 7919);

describe("adversarial SSE soak (full tier — nightly)", () => {
  it(
    `holds every conversation-state invariant across ${SEED_COUNT * RUNS_PER_SEED} randomized streams`,
    async () => {
      const violations = await runTier(SEEDS, RUNS_PER_SEED, readNotebookStream);
      expect(violations, violations.slice(0, 20).join("\n")).toEqual([]);
    },
    { timeout: 600_000 },
  );
});
