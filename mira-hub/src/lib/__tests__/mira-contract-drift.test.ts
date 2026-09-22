/**
 * Drift guard: no route may invent a second primary MIRA persona.
 *
 * Default-DENY over every Hub API route. A `You are MIRA` literal outside the
 * canonical module (`src/lib/mira-contract.ts`) fails unless its exact path is on
 * the allowlist below. The allowlist is the audit's remaining-forks list made
 * executable: each migration deletes one line, and the list can only shrink.
 *
 * This is what stops the 2026-09-22 finding from recurring — fourteen live
 * personas that accumulated one route at a time, each individually reasonable.
 *
 * Audit: `docs/audits/2026-09-22-mira-persona-inventory.md`
 * Spec: `docs/specs/mira-intelligence-contract.md` §8
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const HUB_SRC = join(__dirname, "..", "..");
const API_ROOT = join(HUB_SRC, "app", "api");
const PERSONA_LITERAL = "You are MIRA";

/**
 * Routes that still carry their own persona, with the audit's reason. Migrating
 * one means DELETING its line here — never editing the matcher.
 *
 * Paths are POSIX-style and matched EXACTLY, so a new sibling route cannot
 * inherit a neighbour's exemption.
 */
const REMAINING_FORKS: ReadonlySet<string> = new Set([
  // Migrated but retaining the legacy constants as the flag-off fallback until
  // MIRA_PERSONA_CONTRACT=1 is the proven default. These two DO call the
  // canonical builder; the literals below them are the rollback path.
  "app/api/equipment-notebooks/[id]/chat/route.ts",
  "app/api/hub/ask/route.ts",
  // Not yet migrated — recommended order in the audit §8.
  "app/api/assets/[id]/chat/route.ts",
  "app/api/namespace/node/[id]/chat/route.ts",
  "app/api/mira/ask/route.ts",
  "app/api/quickstart/ask/route.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Route files under app/api, excluding tests. */
export function personaBearingRoutes(apiRoot: string = API_ROOT): string[] {
  return walk(apiRoot)
    .filter((f) => !f.includes(`${sep}__tests__${sep}`) && !f.includes(".test."))
    .filter((f) => readFileSync(f, "utf8").includes(PERSONA_LITERAL))
    .map((f) => relative(join(apiRoot, "..", ".."), f).split(sep).join("/"));
}

describe("MIRA persona drift guard", () => {
  it("no Hub API route defines a persona outside the canonical module", () => {
    const undeclared = personaBearingRoutes().filter((p) => !REMAINING_FORKS.has(p));
    expect(
      undeclared,
      `These routes define their own "${PERSONA_LITERAL}" persona. Use ` +
        `buildMiraSystemPrompt() from @/lib/mira-contract, or — if this is a ` +
        `deliberate, documented fork — add the exact path to REMAINING_FORKS ` +
        `with its reason.`,
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    // A fork that was migrated must lose its line, or the list stops shrinking
    // and the guard quietly weakens as routes are cleaned up.
    const live = new Set(personaBearingRoutes());
    expect([...REMAINING_FORKS].filter((p) => !live.has(p))).toEqual([]);
  });

  it("the guard actually catches a planted violation", () => {
    // A drift test that has never gone red is a reading, not a gate. This runs
    // the real matcher against a fixture tree containing one unlisted persona.
    const root = mkdtempSync(join(tmpdir(), "mira-drift-"));
    const fake = join(root, "src", "app", "api", "rogue");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "route.ts"), `const P = "${PERSONA_LITERAL}, a rogue persona.";\n`);

    const found = personaBearingRoutes(join(root, "src", "app", "api"));
    expect(found).toContain("app/api/rogue/route.ts");
    expect(found.filter((p) => !REMAINING_FORKS.has(p))).not.toEqual([]);
  });

  it("the canonical module is the one place the persona literal is defined", () => {
    const canonical = readFileSync(join(HUB_SRC, "lib", "mira-contract.ts"), "utf8");
    expect(canonical).toContain(PERSONA_LITERAL);
  });
});
