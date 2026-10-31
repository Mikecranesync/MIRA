/**
 * Usage evidence survives teardown (#4460). Teardown deletes the walk tenant's ledger rows, so the
 * walk reads each turn's row at the turn, books it on the meter, keeps a copy on the observation,
 * and writes observations.json after every turn. The 2026-10-31 partial run lost its Jev and judge
 * rows because nothing was copied before teardown. Source-order checks on walk.spec, which a unit
 * test cannot otherwise reach without a live staging run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const code = readFileSync(path.join(__dirname, "walk.spec.ts"), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
const at = (re: RegExp) => {
  const m = re.exec(code);
  expect(m, String(re)).not.toBeNull();
  return m!.index;
};

describe("usage accounting through teardown", () => {
  it("reads the turn's ledger row and books it on the meter inside the turn", () => {
    const read = at(/const ledger = .*await ledgerVerdictFor\(tenantId, sse/);
    const verify = at(/meter\.verify\(q\.id, sse, ledger\?\.verdict\)/);
    const askEnd = at(/^test\("stranger walk"/m);
    expect(read).toBeLessThan(verify);
    expect(verify).toBeLessThan(askEnd);
  });

  it("keeps the ledger copy on served and never-settled observations", () => {
    at(/return \{ \.\.\.broken\("answer never settled"\), sse, ledger \}/);
    at(/return \{ id: q\.id, broken: null,[^\n]*\bledger,[^\n]*\}/);
  });

  it("keeps the ledger copy when the walker throws after the read", () => {
    const keep = at(/const ledger = .*await ledgerVerdictFor[^\n]*\n\s*ledgerById\.set\(q\.id, ledger\)/);
    const reattach = at(/brokenObs\(q\.id, `walker: [^\n]*ledger: ledgerById\.get\(q\.id\) \?\? null \}\)/);
    expect(keep).toBeLessThan(reattach);
  });

  it("writes observations.json after every turn, before teardown runs", () => {
    const turn = at(/obs\.push\(o\);/);
    const firstWrite = at(/writeFileSync\(path\.join\(OUT, "observations\.json"\)/);
    const loopExit = at(/notes\.push\(`run aborted: /);
    const teardown = at(/teardownTenant\(tenantId\)/);
    expect(turn).toBeLessThan(firstWrite);
    expect(firstWrite).toBeLessThan(loopExit);
    expect(loopExit).toBeLessThan(teardown);
  });
});
