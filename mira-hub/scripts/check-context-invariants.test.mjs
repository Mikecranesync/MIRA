import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyReport } from "./check-context-invariants.mjs";

// Deliberately independent of the implementation's list: removing a required
// case from either side must not silently reduce the coverage contract.
const facts = ["input-current", "input-supply", "controller-supply"];
const contexts = ["baseline", "neutral-rename", "unrelated-document", "document-order", "wrong-model"];
function passingReport() {
  return {
    success: true, numTotalTests: 15, numPassedTests: 15,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{
      name: "/checkout/mira-hub/src/capabilities/__tests__/retrieval-context-invariants.test.ts",
      status: "passed",
      assertionResults: facts.flatMap((fact) => contexts.map((context) => ({
        title: `[context-invariant:${fact}] ${context}`,
        fullName: `candidate admission: '${fact}' [context-invariant:${fact}] ${context}`,
        status: "passed", failureMessages: [],
      }))),
    }],
  };
}

test("accepts all 15 distinct executed cases, including Windows report paths", () => {
  assert.equal(verifyReport(passingReport()), 15);
  const report = passingReport();
  report.testResults[0].name = report.testResults[0].name.replaceAll("/", "\\");
  assert.equal(verifyReport(report), 15);
});

const invalid = [
  ["missing report", () => undefined],
  ["zero tests", (r) => { r.numTotalTests = 0; }],
  ["missing test file", (r) => { r.testResults = []; }],
  ["wrong test file", (r) => { r.testResults[0].name = "/different.test.ts"; }],
  ["duplicate test file", (r) => { r.testResults.push(structuredClone(r.testResults[0])); }],
  ["failed test file", (r) => { r.testResults[0].status = "failed"; }],
  ["missing case", (r) => { r.testResults[0].assertionResults.pop(); }],
  ["duplicate case", (r) => { r.testResults[0].assertionResults[0] = r.testResults[0].assertionResults[1]; }],
  ["unknown case", (r) => { r.testResults[0].assertionResults[0].title = "unexpected"; }],
  ...["pending", "skipped", "todo", "failed"].map((status) => [status, (r) => { r.testResults[0].assertionResults[0].status = status; }]),
  ["assertion failures", (r) => { r.testResults[0].assertionResults[0].failureMessages = ["failure"]; }],
  ["unsuccessful run", (r) => { r.success = false; }],
  ...["numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"].map((key) => [key, (r) => { r[key] = 1; }]),
];
for (const [name, mutate] of invalid) {
  test(`rejects ${name}`, () => {
    const report = passingReport();
    assert.throws(() => verifyReport(name === "missing report" ? undefined : (mutate(report), report)), /Context invariants:/);
  });
}

test("CLI rejects missing/malformed reports and accepts a valid report", () => {
  const scratch = mkdtempSync(join(tmpdir(), "context-invariants-"));
  const path = join(scratch, "report.json");
  const cli = new URL("./check-context-invariants.mjs", import.meta.url);
  const run = (args) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8" });
  try {
    for (const args of [[], [path]]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Context invariants:/);
    }
    writeFileSync(path, '{"success":');
    assert.equal(run([path]).status, 1);
    writeFileSync(path, JSON.stringify(passingReport()));
    const result = run([path]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /15\/15/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
