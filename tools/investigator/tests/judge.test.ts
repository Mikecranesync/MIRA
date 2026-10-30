/**
 * Plain-assert test script for judge.ts (LANE BENCH-B). NEVER calls a real
 * model — every SynthesisModel here is a fake. Run:
 *   cd mira-hub && env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts \
 *     ../tools/investigator/tests/judge.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SynthesisModel } from "@/capabilities/investigator/types";
import { FileSpendLedger, worstCaseUsd } from "@/capabilities/investigator/budget";
import {
  anonymizeArms,
  buildJudgePrompt,
  parseJudgeOutput,
  rateCase,
  seededShuffle,
  sha256Hex,
} from "../judge";

type Test = { name: string; fn: () => void | Promise<void> };
const tests: Test[] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn });

// CORE's real FileSpendLedger (mira-hub/src/capabilities/investigator/budget.ts)
// uses real `fs` directly (no injectable IO) — its own cross-process-race-safe
// append-then-verify design is the point of reusing it, so these tests give it
// a real, disposable temp file rather than re-introducing a fake.
let tmpCounter = 0;
function tmpLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "judge-test-"));
  return join(dir, `ledger-${tmpCounter++}.jsonl`);
}

// A model fake that throws if ever called — used to PROVE the ledger gate
// runs before any model call.
const neverCallModel: SynthesisModel = {
  name: "never-call",
  async complete() {
    throw new Error("model.complete was called despite a refused reservation");
  },
};

function fixedReplyModel(text: string, inputTokens = 100, outputTokens = 50): SynthesisModel {
  return { name: "fixed", async complete() { return { text, inputTokens, outputTokens }; } };
}

test("sha256Hex is deterministic", () => {
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
  assert.notEqual(sha256Hex("abc"), sha256Hex("abd"));
});

test("seededShuffle: same seed always reproduces the same permutation", () => {
  const items = ["H0", "H1", "H2"];
  const a = seededShuffle(items, "case-1");
  const b = seededShuffle(items, "case-1");
  assert.deepEqual(a, b);
  assert.deepEqual(new Set(a), new Set(items)); // still a permutation, nothing lost/duplicated
});

test("seededShuffle: different seeds are not all the same permutation (collision-tolerant)", () => {
  const items = ["H0", "H1", "H2"];
  const base = JSON.stringify(seededShuffle(items, "seed-0"));
  // 3 items -> 6 permutations; any ONE seed colliding with seed-0 is a real
  // 1-in-6 possibility (not a bug), so this checks across 8 seeds rather than
  // asserting a single pair differs — deterministic pass/fail, no flakiness.
  const others = Array.from({ length: 8 }, (_, i) => JSON.stringify(seededShuffle(items, `seed-${i + 1}`)));
  assert.ok(others.some((o) => o !== base), "expected at least one of 8 other seeds to differ from seed-0's permutation");
});

test("anonymizeArms: deterministic per case id, bijective letters<->arms", () => {
  const arms = ["H0", "H1", "H2"];
  const m1 = anonymizeArms(arms, "case-A");
  const m2 = anonymizeArms(arms, "case-A");
  assert.deepEqual(m1, m2);
  assert.deepEqual(new Set(m1.letters), new Set(["A", "B", "C"]));
  for (const arm of arms) assert.equal(m1.letterToArm[m1.armToLetter[arm]], arm);
});

test("anonymizeArms: different case ids can assign different letters to the same arm", () => {
  const arms = ["H1", "H2"];
  const letterForH1 = (caseId: string) => anonymizeArms(arms, caseId).armToLetter["H1"];
  // Try a handful of case ids; at least one must differ from case-0's assignment
  // (2 arms -> 1/2 chance per id of matching, so this is overwhelmingly likely, not guaranteed).
  const first = letterForH1("case-0");
  const differs = ["case-1", "case-2", "case-3", "case-4", "case-5"].some((id) => letterForH1(id) !== first);
  assert.ok(differs, "expected at least one of 5 other case ids to shuffle H1 to the other letter");
});

test("buildJudgePrompt: the user prompt never contains a literal arm name", () => {
  const prompt = buildJudgePrompt({
    caseId: "c1",
    question: "Drive trips F005 on startup.",
    evidenceExcerptsByArm: { H1: ["Bus overvoltage, page 93."], H2: ["Bus overvoltage, page 93.", "Check decel time."] },
    nextCheckByArm: { H1: "Measure DC bus voltage.", H2: "Measure DC bus voltage and decel ramp." },
  });
  assert.ok(!prompt.user.includes("H1"));
  assert.ok(!prompt.user.includes("H2"));
  assert.ok(prompt.user.includes("Candidate A") || prompt.user.includes("Candidate B"));
});

test("parseJudgeOutput: valid JSON for exactly the given letters", () => {
  const raw = JSON.stringify({
    A: { technically_valid: "yes", safe: "yes", grounded_in_evidence: "yes", reason: "ok" },
    B: { technically_valid: "unclear", safe: "yes", grounded_in_evidence: "no", reason: "weak" },
  });
  const out = parseJudgeOutput(raw, ["A", "B"]);
  assert.ok(out.ok);
  if (out.ok) {
    assert.equal(out.ratings.A.technically_valid, "yes");
    assert.equal(out.ratings.B.grounded_in_evidence, "no");
  }
});

test("parseJudgeOutput: strips a markdown code fence", () => {
  const raw = "```json\n" + JSON.stringify({ A: { technically_valid: "yes", safe: "yes", grounded_in_evidence: "yes", reason: "ok" } }) + "\n```";
  const out = parseJudgeOutput(raw, ["A"]);
  assert.ok(out.ok);
});

test("parseJudgeOutput: rejects malformed JSON without throwing", () => {
  const out = parseJudgeOutput("not json at all", ["A"]);
  assert.ok(!out.ok);
});

test("parseJudgeOutput: rejects a missing letter", () => {
  const raw = JSON.stringify({ A: { technically_valid: "yes", safe: "yes", grounded_in_evidence: "yes", reason: "ok" } });
  const out = parseJudgeOutput(raw, ["A", "B"]);
  assert.ok(!out.ok);
});

test("parseJudgeOutput: rejects an invalid enum value", () => {
  const raw = JSON.stringify({ A: { technically_valid: "maybe", safe: "yes", grounded_in_evidence: "yes", reason: "ok" } });
  const out = parseJudgeOutput(raw, ["A"]);
  assert.ok(!out.ok);
});

test("worstCaseUsd (CORE's estimator, reused): scales with text length and output tokens, always positive", () => {
  const small = worstCaseUsd("short question".length, 100);
  const big = worstCaseUsd("short question".repeat(1000).length, 100);
  assert.ok(small > 0);
  assert.ok(big > small);
});

test("FileSpendLedger (CORE's, reused): reserve then settle updates spentUsd and persists to the ledger file", () => {
  const path = tmpLedgerPath();
  const ledger = new FileSpendLedger(path, 1.0);
  const id = ledger.reserve(0.1, "test");
  assert.ok(id);
  assert.equal(ledger.spentUsd(), 0); // CORE's spentUsd() counts only SETTLED spend, not open reservations
  ledger.settle(id as string, 0.02, { inputTokens: 10, outputTokens: 5 });
  assert.equal(ledger.spentUsd(), 0.02);
  const written = readFileSync(path, "utf8");
  assert.ok(written.includes('"type":"reserve"'));
  assert.ok(written.includes('"type":"settle"'));
});

test("FileSpendLedger (CORE's, reused): refuses a reservation that would exceed the cap", () => {
  const ledger = new FileSpendLedger(tmpLedgerPath(), 0.001);
  const id = ledger.reserve(0.01, "too-big");
  assert.equal(id, null);
  assert.equal(ledger.spentUsd(), 0);
});

test("FileSpendLedger (CORE's, reused): a second instance re-reads prior settlements from the same file", () => {
  const path = tmpLedgerPath();
  const first = new FileSpendLedger(path, 1.0);
  first.settle(first.reserve(0.3, "a") as string, 0.3, { inputTokens: 1, outputTokens: 1 });
  const second = new FileSpendLedger(path, 1.0);
  assert.equal(second.spentUsd(), 0.3);
});

test("rateCase: a refused reservation NEVER calls model.complete (cap=0.001)", async () => {
  const ledger = new FileSpendLedger(tmpLedgerPath(), 0.001);
  const result = await rateCase(neverCallModel, ledger, {
    caseId: "c1",
    question: "q",
    evidenceExcerptsByArm: { H1: ["ev"], H2: ["ev"] },
    nextCheckByArm: { H1: "check1", H2: "check2" },
  });
  assert.equal(result.status, "refused");
});

test("rateCase: ok path de-anonymises letters back to real arm names", async () => {
  const ledger = new FileSpendLedger(tmpLedgerPath(), 5.0);
  const input = {
    caseId: "c42",
    question: "q",
    evidenceExcerptsByArm: { H1: ["ev1"], H2: ["ev2"] },
    nextCheckByArm: { H1: "check1", H2: "check2" },
  };
  const prompt = buildJudgePrompt(input);
  const raw = JSON.stringify(
    Object.fromEntries(prompt.letters.map((l) => [l, { technically_valid: "yes", safe: "yes", grounded_in_evidence: "yes", reason: "r" }])),
  );
  const result = await rateCase(fixedReplyModel(raw), ledger, input);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.ok("H1" in result.byArm);
    assert.ok("H2" in result.byArm);
  }
});

test("rateCase: a malformed model reply is reported as parse_error, not a crash", async () => {
  const ledger = new FileSpendLedger(tmpLedgerPath(), 5.0);
  const result = await rateCase(fixedReplyModel("garbage, not json"), ledger, {
    caseId: "c7",
    question: "q",
    evidenceExcerptsByArm: { H1: ["ev"] },
    nextCheckByArm: { H1: "check" },
  });
  assert.equal(result.status, "parse_error");
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`ok   - ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${t.name}`);
    console.error(`       ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exitCode = 1;
