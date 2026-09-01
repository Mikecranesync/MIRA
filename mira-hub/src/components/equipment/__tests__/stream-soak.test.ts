/**
 * Adversarial SSE soak — FAST TIER.
 *
 * Runs on every PR as part of the normal hub vitest suite. Small, deterministic
 * and seeded: 8 fixed seeds x 250 streams = 2,000 randomized streams in well
 * under a second, so it costs nothing on the PR path while still catching the
 * regressions that matter (ADR-0038 rule 6, sticky safety, no fabricated
 * content or citations).
 *
 * The full 128k+ tier lives in stream-soak.soak.test.ts and runs nightly.
 * Both tiers share one harness, so the invariants cannot drift apart.
 */
import { describe, expect, it } from "vitest";

import { readNotebookStream } from "../notebook-chat-utils";
import { chunkedReader, frame, rng, runTier } from "./stream-soak-harness";

const SEEDS = [1, 7, 42, 99, 777, 4242, 31337, 2026];
const RUNS_PER_SEED = 250;

describe("adversarial SSE soak (fast tier — every PR)", () => {
  it(`holds every conversation-state invariant across ${SEEDS.length * RUNS_PER_SEED} randomized streams`, async () => {
    const violations = await runTier(SEEDS, RUNS_PER_SEED, readNotebookStream);
    expect(violations, violations.slice(0, 10).join("\n")).toEqual([]);
  });

  // Targeted regression pins for the specific shapes the orders call out.
  it("a stream cut immediately after citations never presents as a cited answer", async () => {
    const wire =
      frame({ kind: "sources", citations: [{ index: 1, title: "Manual", url: null, page: 12 }] }) +
      frame({ kind: "content", content: "Partial answer" });
    const out = await readNotebookStream(chunkedReader(wire, rng(5)), () => {});
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
    expect(out.citations.length).toBe(1); // reader keeps them; the consumer must drop them
  });

  it("safety survives a truncated tail", async () => {
    const wire = frame({ kind: "safety", trigger: "loto" }) + frame({ kind: "content", content: "Stop work." });
    const out = await readNotebookStream(chunkedReader(wire, rng(6)), () => {});
    expect(out.safetyNotice).toEqual({ kind: "safety_notice", trigger: "loto" });
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
  });

  it("[DONE] alone is not a terminal marker", async () => {
    const wire = frame({ kind: "content", content: "hi" }) + "data: [DONE]\n\n";
    const out = await readNotebookStream(chunkedReader(wire, rng(7)), () => {});
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
  });

  it("a duplicate late status frame is server-authoritative (last wins), not ignored", async () => {
    const wire =
      frame({ kind: "status", status: "answered" }) + frame({ kind: "status", status: "error" });
    const out = await readNotebookStream(chunkedReader(wire, rng(8)), () => {});
    expect(out.sawStatus).toBe(true);
    expect(out.status).toBe("error");
  });
});
