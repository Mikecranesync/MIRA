/**
 * Plain-assert test script for fusion_arms.ts's pure functions (no DB, no
 * Ollama, no hub route). NOT a vitest suite: `mira-hub/vitest.config.ts`
 * only includes `src/**`, so a test under `tools/investigator/tests/` is
 * invisible to `npx vitest run` from mira-hub, and a sibling vitest.config
 * here can't `require("vitest/config")` — node_modules lives only under
 * mira-hub, which is not an ancestor of this directory. `vite-node` has no
 * such requirement (it just transpiles+runs a module with mira-hub's own
 * config/node_modules), so this file is a small hand-rolled runner using
 * node:assert/strict, executed the same way retrieval_dev.ts is:
 *
 *   cd mira-hub && env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts \
 *     ../tools/investigator/tests/fusion_arms.test.ts
 *
 * Exits non-zero (and prints which named test failed) on any failure.
 */
import assert from "node:assert/strict";
import {
  codePrecedenceOrder,
  dedupeFirstOccurrence,
  makeUuidOf,
  pagesWithCodeMatch,
  vectorPoolDepth,
  weightedRrfPages,
} from "../fusion_arms";

type Test = { name: string; fn: () => void };
const tests: Test[] = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test("dedupeFirstOccurrence: collapses a per-chunk page list to first-occurrence page order", () => {
  // Shaped like a real B0 row (baseline/forum-fresh2-off-k10.jsonl): [93,93,151,95,48,152,...]
  assert.deepEqual(dedupeFirstOccurrence([93, 93, 151, 95, 48, 152]), [93, 151, 95, 48, 152]);
});

test("dedupeFirstOccurrence: drops null pages without breaking order", () => {
  assert.deepEqual(dedupeFirstOccurrence([5, null, 5, 7, null]), [5, 7]);
});

test("dedupeFirstOccurrence: empty input -> empty output", () => {
  assert.deepEqual(dedupeFirstOccurrence([]), []);
});

test("weightedRrfPages: empty vector list -> output IS the lexical list", () => {
  assert.deepEqual(weightedRrfPages([10, 20, 30], []), [10, 20, 30]);
});

test("weightedRrfPages: a vector-only page is appended after the fused lexical pages", () => {
  const out = weightedRrfPages([10, 20], [99]);
  assert.ok(out.includes(99));
  assert.ok(out.indexOf(99) > out.indexOf(10));
});

test("weightedRrfPages: lexical weight 3x beats an equal-rank vector-only hit for a different page", () => {
  // score(1) = 3/61 ~= 0.04918 (lexical rank1 only); score(2) = 1/61 ~= 0.01639 (vector rank1 only)
  assert.deepEqual(weightedRrfPages([1], [2], { wLex: 3, wVec: 1, k: 60 }), [1, 2]);
});

test("weightedRrfPages: a page in BOTH lists outranks one in only the lexical list", () => {
  // 5: lexical rank1 only -> 3/61 ~= 0.04918. 6: lexical rank2 (3/62~=0.04839) + vector rank1 (1/61~=0.01639) ~= 0.06478
  const out = weightedRrfPages([5, 6], [6], { wLex: 3, wVec: 1, k: 60 });
  assert.equal(out[0], 6);
});

test("weightedRrfPages: equal score ties break toward lexical order (custom weights/k)", () => {
  assert.deepEqual(weightedRrfPages([1], [2], { wLex: 1, wVec: 1, k: 0 }), [1, 2]);
});

test("pagesWithCodeMatch: no matchers -> empty set (B4 contributes nothing with no codes)", () => {
  const matched = pagesWithCodeMatch(new Map([[1, ["F005 fault present"]]]), []);
  assert.equal(matched.size, 0);
});

test("codePrecedenceOrder: empty code-page set leaves restOrder (B2) unchanged -> B4 === B2", () => {
  const b2Order = [3, 1, 2];
  assert.deepEqual(codePrecedenceOrder([1, 2, 3], new Set(), b2Order), b2Order);
});

test("pagesWithCodeMatch + codePrecedenceOrder: a page with an exact code match stays first, in B0p order", () => {
  const chunksByPage = new Map<number, string[]>([
    [1, ["General intro, no codes here."]],
    [2, ["Fault F005: bus overvoltage. See A051."]],
    [3, ["Nothing relevant."]],
  ]);
  const re = /(?<![A-Za-z0-9])F005(?![A-Za-z0-9])/i;
  const matched = pagesWithCodeMatch(chunksByPage, [re]);
  assert.deepEqual(matched, new Set([2]));
  // B0p order = [1,2,3]; B2 (fused) order = [3,1,2] -> page 2 must come first, rest keep B2 order.
  assert.deepEqual(codePrecedenceOrder([1, 2, 3], matched, [3, 1, 2]), [2, 3, 1]);
});

test("pagesWithCodeMatch: a substring that is not a whole token does not match (word-boundary matcher)", () => {
  const chunksByPage = new Map<number, string[]>([[1, ["AF0051 is unrelated"]]]);
  const re = /(?<![A-Za-z0-9])F005(?![A-Za-z0-9])/i;
  assert.equal(pagesWithCodeMatch(chunksByPage, [re]).size, 0);
});

test("vectorPoolDepth: matches the hub's own vector-lane pool formula (manual-rag.ts:1415, max(topK*4,24))", () => {
  assert.equal(vectorPoolDepth(10), 40);
  assert.equal(vectorPoolDepth(2), 24);
});

test("makeUuidOf: deterministic and shaped like a v4-ish uuid", () => {
  const uuid = makeUuidOf((_s) => "0123456789abcdef0123456789abcdef01234567".padEnd(64, "0"));
  const id = uuid("hyb-tenant-forum-fresh");
  assert.equal(uuid("hyb-tenant-forum-fresh"), id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok   - ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${t.name}`);
    console.error(`       ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exitCode = 1;
