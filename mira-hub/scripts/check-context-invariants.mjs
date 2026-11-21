import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = "src/capabilities/__tests__/retrieval-context-invariants.test.ts";
const expected = ["input-current", "input-supply", "controller-supply"].flatMap((fact) =>
  ["baseline", "neutral-rename", "unrelated-document", "document-order", "wrong-model"]
    .map((context) => `[context-invariant:${fact}] ${context}`));

function requireProof(condition, message) {
  if (!condition) throw new Error(`Context invariants: ${message}`);
}

/** Validate the focused Vitest JSON report, not the full Hub suite report. */
export function verifyReport(report) {
  requireProof(report?.success === true, "run was not successful");
  for (const [key, value] of Object.entries({
    numTotalTests: 15, numPassedTests: 15, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  })) requireProof(report[key] === value, `${key} must equal ${value}`);
  requireProof(Array.isArray(report.testResults) && report.testResults.length === 1, "expected one test file");
  const file = report.testResults[0];
  const name = typeof file?.name === "string" ? file.name.replaceAll("\\", "/") : "";
  requireProof(name === target || name.endsWith(`/${target}`), "expected the context invariant test file");
  requireProof(file.status === "passed", "test file did not pass");
  requireProof(Array.isArray(file.assertionResults) && file.assertionResults.length === 15, "expected 15 executed cases");
  const remaining = new Set(expected);
  for (const assertion of file.assertionResults) {
    requireProof(remaining.delete(assertion?.title), "missing, duplicate or unknown case ID");
    requireProof(assertion.status === "passed", "a required case did not pass");
    requireProof(Array.isArray(assertion.failureMessages) && assertion.failureMessages.length === 0, "a required case has failures");
  }
  requireProof(remaining.size === 0, "required cases were not executed");
  return expected.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireProof(process.argv.length === 3, "provide one report path");
    let report;
    try { report = JSON.parse(readFileSync(process.argv[2], "utf8")); }
    catch { throw new Error("Context invariants: report is missing or invalid JSON"); }
    console.log(`Context invariants: ${verifyReport(report)}/15 required cases passed`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
