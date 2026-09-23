/**
 * Which `TurnOutcome` values can the code actually produce?
 *
 * This exists because the answer was not what the type said. `"timeout"` is
 * declared in the union and written by nothing: the cascade has no timeout
 * concept at all (`GenerationAttempt.outcome` is served | http_error |
 * exception | client_stop), so a slow provider surfaces as an exception and the
 * turn closes `error`.
 *
 * That matters more than it looks. An outcome a schema advertises and the code
 * cannot produce reads, in a dashboard, as "this never happened" — so an empty
 * `timeout` bucket would be taken as evidence of no timeouts, which is the
 * opposite of the truth. A comment saying so rots; this fails.
 *
 * If you wire a real provider timeout, move `"timeout"` into REACHABLE and this
 * test becomes the thing that proves you did.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TurnOutcome } from "../turn-lifecycle";

const SRC = path.resolve(__dirname, "../../..");

/** Outcomes some code path assigns today. */
const REACHABLE: TurnOutcome[] = [
  "answered",
  "refused",
  "abstained",
  "safety_stop",
  "error",
  "cancelled",
  "superseded",
  "abandoned",
];

/** Declared, and produced by nothing. */
const UNREACHABLE: TurnOutcome[] = ["timeout"];

const FILES = [
  "app/api/equipment-notebooks/[id]/chat/route.ts",
  "app/api/equipment-notebooks/[id]/look/route.ts",
  "lib/inference/persist-usage.ts",
  "capabilities/observability/turn-lifecycle.ts",
];

function productionSource(): string {
  return FILES.map((f) => readFileSync(path.join(SRC, f), "utf8")).join("\n");
}

/** Strip the union declaration itself and comments, so only real writes count. */
function assignmentsOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return false;
      if (/^\|\s*"/.test(t)) return false; // the union members
      return true;
    })
    .join("\n");
}

describe("TurnOutcome reachability is pinned, because the union over-promises", () => {
  const body = assignmentsOnly(productionSource());

  // `abandoned` is written inside a SQL string ('abandoned'), the rest in TS
  // string literals — so both quote styles count as a write.
  const writes = (o: string) => body.includes(`"${o}"`) || body.includes(`'${o}'`);

  it.each(REACHABLE)("%s is produced by production code", (outcome) => {
    expect(writes(outcome)).toBe(true);
  });

  it.each(UNREACHABLE)(
    "%s is NOT produced — an empty bucket for it is not evidence of absence",
    (outcome) => {
      expect(writes(outcome)).toBe(false);
    },
  );

  it("every union member is classified, so a new outcome cannot arrive unnoticed", () => {
    const union = readFileSync(
      path.join(SRC, "capabilities/observability/turn-lifecycle.ts"),
      "utf8",
    );
    const declared = [...union.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set([...REACHABLE, ...UNREACHABLE]));
  });
});
