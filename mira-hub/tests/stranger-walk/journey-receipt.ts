/**
 * Per-step receipt for the CV-101 / Level-3 technician journey (cv101-journey.spec.ts).
 * Pure: no browser, no network, so the pass rule is unit-tested on its own.
 */
export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "NOT TESTED";
export type Step = { id: string; verdict: Verdict; expected: string; actual: string; trace: string[]; shots: string[]; at: string };

/**
 * The per-step receipt a person reads: build, target, every step's verdict and evidence.
 * The run passes only when every expected step ran and passed: NOT TESTED, BLOCKED or a
 * missing step is never counted as a pass.
 */
export function receiptOf(run: { build: string; target: string; paid: boolean; runId: string }, done: Step[], expected: readonly string[]): { overall: "PASS" | "FAIL" | "INCOMPLETE"; md: string } {
  const byId = new Map(done.map((x) => [x.id, x]));
  const missing = expected.filter((id) => !byId.has(id));
  const count = (v: Verdict) => done.filter((x) => x.verdict === v).length;
  const overall = count("FAIL") > 0 ? "FAIL" : missing.length || count("NOT TESTED") || count("BLOCKED") ? "INCOMPLETE" : "PASS";
  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 400);
  const rows = expected.map((id) => {
    const x = byId.get(id);
    return x ? `| ${id} | ${x.verdict} | ${cell(x.expected)} | ${cell(x.actual)} | ${x.shots.join(", ")} |` : `| ${id} | NOT RUN | | run stopped before this step | |`;
  });
  const md = [
    `# Journey receipt: ${overall}`,
    "",
    `Build ${run.build} · target ${run.target} · ${run.paid ? "paid run" : "$0 run (no question sent)"} · run ${run.runId}`,
    "",
    `PASS ${count("PASS")} · FAIL ${count("FAIL")} · NOT TESTED ${count("NOT TESTED")} · BLOCKED ${count("BLOCKED")} · NOT RUN ${missing.length} of ${expected.length}`,
    "",
    "| Step | Verdict | Expected | Actual | Screenshots |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  return { overall, md };
}

/**
 * Whether the run's process should exit 0 once the receipt is written. A FAIL never does. A paid
 * run exists to answer every step, so it exits 0 only on PASS; a $0 run's INCOMPLETE (the
 * question steps it cannot ask) is its expected result.
 */
export function exitOk(overall: "PASS" | "FAIL" | "INCOMPLETE", paid: boolean): boolean {
  if (overall === "FAIL") return false;
  if (paid && overall !== "PASS") return false;
  return true;
}
