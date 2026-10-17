#!/usr/bin/env node
/**
 * AC8 seeded-defect proof (ADR-0038, #4439): mutate the CLONE's code (never
 * the fixture), run the harness, and check that exactly the predicted checks
 * turn red. M6/M7 deliberately also touch the reference or a module both
 * surfaces share: they prove the checks that must hold ABSOLUTELY (not just as
 * parity) cannot pass when both surfaces regress together. Every mutated file is
 * restored with `git checkout` on every exit path.
 *
 *   node tests/fidelity/mutations.mjs            # control + M1..M4
 *   node tests/fidelity/mutations.mjs M2         # one
 *
 * Expected red sets are written BEFORE the run (prove-the-test-fails.md); the
 * control (unchanged clone) must be fully green.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TI = "src/factorylm-ui/to-interaction.ts";
const LOGIC = "src/factorylm-ui/hub-host-logic.ts";
const CLASSIC = "src/components/equipment/NotebookChat.tsx";
const SHARED_UTILS = "src/components/equipment/notebook-chat-utils.ts";
const ANSWER_BODY = `      <div className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }} data-testid="answer-body">
        <AnswerMarkdown content={turn.content} citations={cites} onCite={onCite} />
      </div>
`;
const BASELINE = [];

const MUTATIONS = {
  control: { what: "unchanged clone", edits: [], red: [] },
  M1: {
    what: "drop citations (no source parts, so no chips) in both mappers",
    edits: [
      { file: TI, find: 'parts.push({ type: "source", source: sourceFor(c, opts.turnId) });', replace: "void c;", count: 1 },
      { file: TI, find: 'parts.push({ type: "source", source: sourceFor(c, answerId) });', replace: "void c;", count: 1 },
    ],
    red: ["rendered turn: grounded answer (AC4, G)", "citation inspectable: opens the cited doc + page (AC5)"],
  },
  M2: {
    what: "suppress every safety part (stream + persisted)",
    edits: [{ file: TI, find: "parts.push(safetyNoticePart(", replace: "void (safetyNoticePart(", count: 4 }],
    // An absent notice cannot be first either. (First predicted as present-only;
    // the cascade was masked while "first" was a standing red — corrected 2026-10-15.)
    red: ["rendered turn: safety notice present (AC4, S)", "rendered turn: safety notice first (AC4, S)"],
  },
  M3: {
    what: "hydrated turns lose the evidence label (persisted mapper only)",
    edits: [{
      file: TI, find: "if (row.basis) parts.push(basisPart(row.basis, citations, meta.notebookDocIds));",
      replace: "void basisPart;", count: 1,
    }],
    red: ["live ≡ hydrated: G (AC6)", "live ≡ hydrated: S (AC6)"],
  },
  M4: {
    what: "omit sourceDocIds from the chat request",
    edits: [{
      file: LOGIC, find: "const base = buildChatBody(question, [...docIds], history);",
      replace: "const { sourceDocIds: _m4, ...base } = buildChatBody(question, [...docIds], history);", count: 1,
    }],
    red: ["request: G — normalized chat body equal (AC3)", "request: S — normalized chat body equal (AC3)"],
  },
  M5: {
    what: "safety notice back after the answer (the order #4439 fixed)",
    edits: [{
      file: TI,
      find: '  return [...parts.filter((p) => p.type === "safety_notice"), ...parts.filter((p) => p.type !== "safety_notice")];',
      replace: "  return parts;", count: 1,
    }],
    red: ["rendered turn: safety notice first (AC4, S)"],
  },
  // Codex #4441 F1: both surfaces regress to answer-then-notice together.
  M6: {
    what: "BOTH surfaces put the safety notice after the answer",
    edits: [
      {
        file: TI,
        find: '  return [...parts.filter((p) => p.type === "safety_notice"), ...parts.filter((p) => p.type !== "safety_notice")];',
        replace: "  return parts;", count: 1,
      },
      { file: CLASSIC, find: ANSWER_BODY, replace: "", count: 1 },
      { file: CLASSIC, find: '    <div className="w-full">\n', replace: `    <div className="w-full">\n${ANSWER_BODY}`, count: 1 },
    ],
    red: ["rendered turn: safety notice first (AC4, S)"],
  },
  // Codex #4441 F2: one constant idempotency key on every send (shared builder).
  M7: {
    what: "every send reuses one fixed clientRequestId",
    edits: [{
      file: SHARED_UTILS, find: "  clientRequestId = crypto.randomUUID(),",
      replace: '  clientRequestId = "00000000-0000-4000-8000-000000000000",', count: 1,
    }],
    red: ["request: clientRequestId is unique per send (AC3)"],
  },
  // Codex #4441 F2: the clone stops sending threadId.
  M8: {
    what: "clone omits threadId from the chat request",
    edits: [{ file: LOGIC, find: "    threadId: sel.threadId === LEGACY_THREAD_ID ? null : sel.threadId,\n", replace: "", count: 1 }],
    red: ["request: G — normalized chat body equal (AC3)", "request: S — normalized chat body equal (AC3)"],
  },
  // Codex #4441 round 2 F1: one Enter, two POSTs (the second fire-and-forget).
  M9: {
    what: "clone fires a second chat POST per send",
    edits: [{
      file: "src/factorylm-ui/hub-host.tsx",
      find: "      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, {",
      replace: "      void fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, { method: \"POST\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ ...body, clientRequestId: crypto.randomUUID() }) }).catch(() => undefined);\n      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, {",
      count: 1,
    }],
    red: ["request: exactly one chat POST per send (AC3)"],
  },
  // #4454: the host stops keeping the finished answer's follow-ups, so the
  // chips vanish when the persisted row replaces the live turn.
  M10: {
    what: "clone drops follow-ups when the persisted row replaces the live turn",
    edits: [{
      file: "src/factorylm-ui/hub-host.tsx",
      find: '      const finished = partsFromStream(result, { turnId: `${id}-a` }).find((p) => p.type === "followups");',
      replace: '      const finished = undefined as { type: "followups"; suggestions: string[] } | undefined;',
      count: 1,
    }],
    red: ["settle: follow-ups survive the post-turn refetch (clone, #4454)"],
  },
};

function apply(edits) {
  for (const f of new Set(edits.map((e) => e.file))) {
    if (execFileSync("git", ["status", "--porcelain", "--", f], { encoding: "utf8" }).trim()) {
      throw new Error(`${f} is dirty — refusing to mutate`);
    }
  }
  for (const e of edits) {
    const src = readFileSync(e.file, "utf8");
    const n = src.split(e.find).length - 1;
    if (n !== e.count) throw new Error(`${e.file}: expected ${e.count} match(es) of ${JSON.stringify(e.find)}, found ${n}`);
    writeFileSync(e.file, src.split(e.find).join(e.replace));
  }
}

function restore(edits) {
  const files = [...new Set(edits.map((e) => e.file))];
  if (files.length) execFileSync("git", ["checkout", "--", ...files]);
}

function run() {
  const r = spawnSync("npx", ["playwright", "test", "--config", "tests/fidelity/playwright.fidelity.config.ts", "--reporter=json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const report = JSON.parse(r.stdout);
  const results = [];
  const walk = (suite) => {
    for (const s of suite.specs ?? []) for (const t of s.tests) results.push({ title: s.title, status: t.results.at(-1)?.status });
    for (const c of suite.suites ?? []) walk(c);
  };
  for (const s of report.suites) walk(s);
  return results;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTATIONS);
let ok = true;
for (const id of ids) {
  const m = MUTATIONS[id];
  let results;
  try { apply(m.edits); results = run(); } finally { restore(m.edits); }
  const red = results.filter((r) => r.status !== "passed").map((r) => r.title).sort();
  const expected = [...BASELINE, ...m.red].sort();
  const exact = JSON.stringify(red) === JSON.stringify(expected);
  ok &&= exact;
  console.log(`${id} (${m.what}): ${results.length - red.length} passed, ${red.length} red — ${exact ? "EXACT" : "MISMATCH"}`);
  for (const t of red) console.log(`    red: ${t}`);
  if (!exact) console.log(`    expected red: ${JSON.stringify(expected)}`);
}
process.exit(ok ? 0 : 1);
