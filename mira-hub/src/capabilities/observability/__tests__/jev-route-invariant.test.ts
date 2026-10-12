/**
 * Pins the one structural fact that keeps a shadow vendor call out of the
 * delivery path.
 *
 * `finishAndPersist` is called from five places in the chat route and they are
 * NOT all after the stream closes — the safety-stop path awaits it and only
 * then returns its Response. What makes the Jev call safe is that
 * `decisionState` is populated at exactly one place, late, so the early call
 * sites pass null and never reach the network.
 *
 * A future edit that assigns `decisionState` earlier would put a ~280 ms
 * metered call in front of a hazard stop, and nothing else in the codebase
 * would notice. Hence a source-level assertion: unusual, and warranted, because
 * the property is about WHERE code sits rather than what it returns.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(process.cwd(), "src/app/api/equipment-notebooks/[id]/chat/route.ts");
const src = readFileSync(ROUTE, "utf8");
const lines = src.split("\n");
const linesOf = (re: RegExp) =>
  lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter((n) => n > 0);

describe("the Jev shadow cannot reach the delivery path", () => {
  const assigns = linesOf(/decisionState = buildTurnDecisionState/);
  const closes = linesOf(/controller\.close\(\)/);
  const persists = linesOf(/await finishAndPersist\(/);

  it("assigns decisionState in exactly one place", () => {
    // Two assignment sites would make the reasoning below unsound.
    expect(assigns).toHaveLength(1);
  });

  it("every call site downstream of that assignment is preceded by a stream close", () => {
    const assign = assigns[0];
    const downstream = persists.filter((p) => p > assign);
    expect(downstream.length).toBeGreaterThan(0);
    for (const p of downstream) {
      const closedBefore = closes.some((c) => c < p);
      expect(closedBefore, `finishAndPersist at line ${p} has no controller.close() before it`).toBe(true);
    }
  });

  it("the early call sites are upstream of the assignment, so they pass null", () => {
    const assign = assigns[0];
    // These are the safety-stop / abstain / client-stop paths. If this count
    // ever drops to zero, someone moved the assignment up — see the file header.
    expect(persists.filter((p) => p < assign).length).toBeGreaterThan(0);
  });

  it("the evaluator is invoked behind a decisionState null-check and nowhere else", () => {
    expect(linesOf(/evaluateTurnDecision\(/)).toHaveLength(1);
    expect(src).toContain("if (decisionState) {");
  });

  // sufficiency-v2 (2026-10-12): the shadow is handed the SAME observation text
  // the decision lane sends — no second renderer, no second privacy surface.
  it("the sufficiency shadow receives the turn's photo observation, the same `lookContext` the decision lane sends", () => {
    const call = src.indexOf("judgeEvidenceSufficiencyShadow(");
    expect(call).toBeGreaterThan(-1);
    const window = src.slice(call, src.indexOf(").catch(", call));
    expect(window).toMatch(/\{ observations: \[lookContext\] \}/);
    const decision = src.slice(src.indexOf("buildTurnDecisionState({"));
    expect(decision.slice(0, decision.indexOf("evidence:"))).toMatch(/observations: \[lookContext\]/);
  });

  // The two v2 fields ride on the packet from the SAME awaited result as the
  // score, so a v1 photo blind spot and a v2 judgment are distinguishable in the
  // ledger. (This file is where the route's Jev contract is pinned: the
  // flight-recorder test under src/app/** is a lifecycle-guarded path.)
  it("the packet records jev_observation_count and jev_instructions_version beside jev_sufficient", () => {
    const gate = src.indexOf("jev_sufficient: jev.noul,");
    expect(gate).toBeGreaterThan(-1);
    const block = src.slice(gate, gate + 400);
    expect(block).toMatch(/jev_observation_count: jev\.observation_count,/);
    expect(block).toMatch(/jev_instructions_version: jev\.instructions_version,/);
  });
});
