/**
 * Offline replay of the #4372 Phase 1 number verifier (safety-policy) against the current floors.
 * Zero tokens, no network, no DB. Reads only in-repo fixtures plus optional local files:
 *
 *   cd mira-hub && npx vite-node --config vitest.config.ts scripts/safety-policy-replay.ts -- \
 *     --out <report.json> [--imib <safety-gate-cases.json>] [--floor4929 <dir with answer-validation.ts>]
 *
 * Sets:
 *  - dev    : safety-policy/dev-replay-cases.ts (30 implementer-authored, OEM-chunk-backed, labelled)
 *  - step   : the #4122 step-energy labelled answers (140; no retrieved chunks recorded)
 *  - regr   : tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl (answer candidates)
 *  - p3902  : the #3902 paraphrase strings, read from the test file as data (not executed)
 *  - imib   : IMIB v0.1 safety-gate questions (questions only — no answers to verify)
 * Floors compared on the same input: `validateAnswer` on this checkout (main) and, when given,
 * #4929's `unsupportedDischargeWait` (sourceTexts = non-vendor_fallback chunk text, as its route
 * wiring passes them).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAnswer } from "@/capabilities/answer-validation";
import { extractNumbers, verifyNumbers, type BoundAsset, type EvidenceChunk } from "@/capabilities/safety-policy";
import { DEV_REPLAY_CASES } from "@/capabilities/safety-policy/dev-replay-cases";
import { loadLabeledSet } from "@/capabilities/step-energy-labeled-set";

const args = process.argv.slice(2).filter((a) => a !== "--");
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = opt("--out") ?? "safety-policy-replay.json";
const REPO = join(__dirname, "..", "..");

interface Row {
  set: string;
  id: string;
  label?: "block" | "allow";
  verifier: { cited: string; anyApplicable: string; enforcedCodes: string[]; deferredCodes: string[]; enforced: number; deferred: number };
  floorMain: string;
  floor4929: string | null;
  /** Same rule with each source's whitespace collapsed (ingest may store chunks unwrapped). */
  floor4929Flat: string | null;
}

type DischargeRule = (answer: string, question: string, sources: string[]) => string | null;

async function main() {
  const f4929Dir = opt("--floor4929");
  const rule4929: DischargeRule | null = f4929Dir
    ? ((await import(pathToFileURL(join(f4929Dir, "answer-validation.ts")).href)) as { unsupportedDischargeWait: DischargeRule }).unsupportedDischargeWait
    : null;

  const inputs: Array<{ set: string; id: string; question: string; answer: string; chunks: EvidenceChunk[]; bound: BoundAsset | null; general: boolean; label?: "block" | "allow" }> = [];
  for (const c of DEV_REPLAY_CASES) inputs.push({ set: "dev", id: c.id, question: c.question, answer: c.answer, chunks: c.chunks, bound: c.bound, general: false, label: c.label });
  for (const a of loadLabeledSet()) inputs.push({ set: "step", id: `${a.set}/${a.id}`, question: a.question, answer: a.answer, chunks: [], bound: null, general: false });
  for (const line of readFileSync(join(REPO, "tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { id: string; candidate?: string; question?: string; lane?: string };
    if (!r.candidate) continue;
    inputs.push({ set: "regr", id: r.id, question: r.question ?? "", answer: r.candidate, chunks: [], bound: null, general: r.lane === "general" });
  }
  const t3902 = readFileSync(join(REPO, "mira-hub/src/capabilities/answer-validation-3902-paraphrases.test.ts"), "utf8");
  const q3902 = JSON.parse(/const Q = ("(?:[^"\\]|\\.)*");/.exec(t3902)![1]) as string;
  for (const m of t3902.matchAll(/^\s+([A-Z0-9_]+):\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)) {
    inputs.push({ set: "p3902", id: m[1], question: q3902, answer: JSON.parse(m[2]) as string, chunks: [], bound: null, general: false });
  }
  const imibPath = opt("--imib");
  const imibQuestions = imibPath ? (JSON.parse(readFileSync(imibPath, "utf8")) as Array<{ id: string; question: string }>) : [];

  const rows: Row[] = inputs.map((x) => {
    const base = { answerText: x.answer, question: x.question, chunks: x.chunks, bound: x.bound };
    const run = (attribution: "cited" | "any-applicable") => {
      const ex = extractNumbers({ ...base, attribution });
      return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks: x.chunks, bound: x.bound, question: x.question });
    };
    const cited = run("cited");
    const any = run("any-applicable");
    const codes = (enf: boolean) => [...new Set(cited.checks.filter((c) => c.enforced === enf).map((c) => c.verdict))].sort();
    const v = validateAnswer({ answerText: x.answer, question: x.question, general: x.general, served: true, refused: false });
    const sources = [...x.chunks.filter((c) => c.retrievalScope !== "vendor_fallback" && c.origin !== "technician").map((c) => c.content)];
    return {
      set: x.set,
      id: x.id,
      label: x.label,
      verifier: {
        cited: cited.verdict,
        anyApplicable: any.verdict,
        enforcedCodes: codes(true),
        deferredCodes: codes(false),
        enforced: cited.checks.filter((c) => c.enforced).length,
        deferred: cited.checks.filter((c) => !c.enforced).length,
      },
      floorMain: v.ok ? "ok" : `${v.kind}:${v.violation}`,
      floor4929: rule4929 ? (rule4929(x.answer, x.question, sources) === null ? "ok" : "unsupported-discharge-wait") : null,
      floor4929Flat: rule4929
        ? rule4929(x.answer, x.question, sources.map((t) => t.replace(/\s+/g, " "))) === null
          ? "ok"
          : "unsupported-discharge-wait"
        : null,
    };
  });

  // Summaries
  const sets = [...new Set(rows.map((r) => r.set))];
  const summary = sets.map((s) => {
    const rs = rows.filter((r) => r.set === s);
    const nb = rs.filter((r) => r.verifier.enforced > 0);
    return {
      set: s,
      answers: rs.length,
      numberBearingEnforced: nb.length,
      numberBearingDeferredOnly: rs.filter((r) => r.verifier.enforced === 0 && r.verifier.deferred > 0).length,
      verifierBlock: rs.filter((r) => r.verifier.cited === "block").length,
      verifierBlockAnyApplicable: rs.filter((r) => r.verifier.anyApplicable === "block").length,
      floor4929Block: rule4929 ? rs.filter((r) => r.floor4929 !== "ok").length : null,
      floorMainNotOk: rs.filter((r) => r.floorMain !== "ok").length,
      floorMainSpecificityOrUnsafe: rs.filter((r) => /^(unsupported_specificity|unsafe_answer)/.test(r.floorMain)).length,
    };
  });
  const dev = rows.filter((r) => r.set === "dev");
  const score = (pred: (r: Row) => boolean) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const r of dev) {
      const b = pred(r);
      if (r.label === "block" && b) tp++;
      else if (r.label === "block") fn++;
      else if (b) fp++;
      else tn++;
    }
    return { tp, fp, fn, tn, leaks: fn, overBlocks: fp };
  };
  const devScore = {
    verifierCited: score((r) => r.verifier.cited === "block"),
    verifierAnyApplicable: score((r) => r.verifier.anyApplicable === "block"),
    floor4929: rule4929 ? score((r) => r.floor4929 !== "ok") : null,
    floor4929Flat: rule4929 ? score((r) => r.floor4929Flat !== "ok") : null,
    floorMain: score((r) => /^(unsupported_specificity|unsafe_answer)/.test(r.floorMain)),
  };
  const disagreements = rows
    .filter((r) => r.floor4929 !== null && (r.verifier.cited === "block") !== (r.floor4929 !== "ok"))
    .map((r) => ({ set: r.set, id: r.id, label: r.label, verifier: r.verifier.cited, codes: r.verifier.enforcedCodes, floor4929: r.floor4929, floor4929Flat: r.floor4929Flat }));
  const report = {
    generated: new Date().toISOString(),
    floor4929: f4929Dir ? "loaded" : "not loaded",
    imib: { questions: imibQuestions.length, answers: 0, note: "IMIB safety-gate cases are questions only; the number verifier needs an answer" },
    unavailable: ["decision_traces staging turns (staging on HOLD; no DB access)", "model-generated typed plans (paid gpt-5.4-mini batch not authorised)"],
    summary,
    devScore,
    disagreementsVs4929: disagreements,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ summary, devScore, disagreementsVs4929: disagreements.length }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
