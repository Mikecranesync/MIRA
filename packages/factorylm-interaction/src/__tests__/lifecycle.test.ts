import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import { LIFECYCLES, isLifecycle, isSafetyStop, parseLifecycle, type Lifecycle } from "../types";

/**
 * The Lifecycle contract, with `safety_stop` as a first-class member.
 *
 * Owned here rather than in whichever feature PR happens to encounter it: a
 * safety state must be defined where the type lives, parsed exhaustively at the
 * boundary, and never inferred at a render gate from an adjacent lifecycle.
 */
describe("Lifecycle contract", () => {
  it("carries safety_stop as its own member", () => {
    // The Hub's enum (ADR-0040) has had one since it shipped; this union did
    // not, so a safety turn had no representation here at all.
    expect(LIFECYCLES).toContain("safety_stop");
  });

  it("parses every declared member", () => {
    // Exhaustive by construction: iterating LIFECYCLES rather than a
    // hand-written list means a member added to the union and to LIFECYCLES
    // is covered here automatically, and one added to only the union fails
    // the `satisfies` check at compile time.
    for (const l of LIFECYCLES) expect(parseLifecycle(l)).toBe(l);
  });

  it("keeps the compile-time exhaustiveness check that runtime cannot express", () => {
    // A runtime test CANNOT verify that every union member is in LIFECYCLES —
    // the union is erased before this file runs. The original version of this
    // test asserted `LIFECYCLES.length > 9`, which peer review correctly
    // called out as no check at all: 10 still passes while the union has 11.
    //
    // The real guard is `_LIFECYCLES_ARE_EXHAUSTIVE` in types.ts, verified by
    // mutation — adding `| "paused"` to the union without adding it to
    // LIFECYCLES errors at types.ts(133,7). This asserts the guard is still
    // THERE, since deleting it would restore the silent drift with every
    // runtime test still green.
    const source = readFileSync(new URL("../types.ts", import.meta.url), "utf8");
    expect(source).toContain("_LIFECYCLES_ARE_EXHAUSTIVE");
    expect(source).toMatch(/\[Exclude<Lifecycle, \(typeof LIFECYCLES\)\[number\]>\] extends \[never\]/);
  });

  it("refuses unknown input instead of coercing it to a neighbour", () => {
    // This is the whole point of the parser. A fallback would let an
    // unrecognised safety state become "completed" (reads as: there is an
    // answer) or "stopped" (reads as: you stopped it).
    for (const bad of ["safety-stop", "SAFETY_STOP", "safetyStop", "halted", "", null, undefined, 7, {}]) {
      expect(parseLifecycle(bad)).toBeNull();
      expect(isLifecycle(bad)).toBe(false);
    }
  });

  it("never collapses safety_stop into stopped, failed or cancelled", () => {
    // The substitution that must never happen silently.
    expect(isSafetyStop("safety_stop")).toBe(true);
    for (const other of ["stopped", "failed", "cancelled", "completed"] as Lifecycle[]) {
      expect(isSafetyStop(other)).toBe(false);
    }
  });

  it("has no two members that differ only by case or separator", () => {
    // A near-duplicate would make a boundary bug undetectable: `safety_stop`
    // vs `safetyStop` would both look plausible in a payload.
    const normalised = LIFECYCLES.map((l) => l.toLowerCase().replace(/[-_]/g, ""));
    expect(new Set(normalised).size).toBe(LIFECYCLES.length);
  });
});
