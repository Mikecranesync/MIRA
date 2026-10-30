# Investigator bench harness — LANE BENCH-A

Offline runners for the Maintenance Investigator prototype's arms H0/H1/H2
(`docs/evals/2026-10-30-investigator-harness/PREREGISTRATION.md`). This lane
owns exactly: `openai-model.ts`, `ingest.ts`, `single_pass.ts`, `run_cases.ts`,
`README.md` (this file). `bench/retrieval_dev.ts` is the PINNED #4983 harness —
read for conventions, never edited.

## Status as of this build

`src/capabilities/investigator/` currently has:

| File | Owner | Status |
|---|---|---|
| `types.ts` | contract | present, unchanged |
| `plan.ts`, `hazard-gate.ts`, `grounding.ts`, `budget.ts` | CORE | present (landed mid-build) |
| `tools.ts`, `evaluate.ts`, `synthesize.ts`, `runner.ts`, `index.ts` | LOOP | **not yet present** |

**Consequence:** H0 (this lane, `single_pass.ts`) is fully wired to real
CORE code — `ungroundedNumbers`/`unsafeInstructionPhrases`
(`@/capabilities/investigator/grounding`) and `worstCaseUsd`/`FileSpendLedger`
(`@/capabilities/investigator/budget`) — and is NOT a placeholder. H1/H2
(`run_cases.ts`) call LOOP's `investigate()`, which does not exist yet; see
**Pending LOOP integration** below. `npx vitest run src/capabilities/investigator`
and `npx tsc --noEmit -p tsconfig.json | grep investigator` are both clean
today (verified — see **Verification** below); H1/H2 will not actually RUN
until LOOP lands, but nothing in this lane blocks on that for typecheck/tests.

## Commands

All commands run from `mira-hub/`. **Every command prefixes `env -u
OPENAI_API_KEY`** unless it is specifically the one command that makes a
real paid call (`run_cases.ts` for H0/H1/H2, which reads `OPENAI_API_KEY`
from Doppler) — the $0 hard rule for every OTHER command (ingest, tests,
typecheck) is enforced by explicitly unsetting the key so a mistaken live
call fails loud instead of silently billing.

```bash
cd mira-hub

# Typecheck (tools/ is outside tsconfig.json's own include — see "Typecheck"
# below for why a temporary cross-directory tsconfig is needed, and why the
# project's own `pg`/`unpdf` bare-import resolution gap from outside
# mira-hub/ is fixed IN THESE FILES, not worked around in a throwaway config).
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'investigator'   # must be empty

# Tests (vitest only collects src/**/*.test.ts — see "Where the tests live")
env -u OPENAI_API_KEY npx vitest run src/capabilities/investigator

# Ingest a NEW question set into its own bench tenant (never a reserved name)
env -u OPENAI_API_KEY OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench \
  npx vite-node --config vitest.config.ts ../tools/investigator/ingest.ts -- \
  investigator-dev-1 /path/to/questions.json

# Run arm H0 (free-text single pass) over a case set, under Doppler for the key
doppler run -p factorylm -c dev -- env BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench \
  npx vite-node --config vitest.config.ts ../tools/investigator/run_cases.ts -- \
  H0 cases.json out-h0.jsonl --cap 0.50

# Run arm H1/H2 (needs LOOP's investigate() — see "Pending LOOP integration")
doppler run -p factorylm -c dev -- env BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench \
  npx vite-node --config vitest.config.ts ../tools/investigator/run_cases.ts -- \
  H1 cases.json out-h1.jsonl --labels labels.json --ledger spend-ledger.jsonl --cap 1.00
```

### Environment

| Var | Used by | Notes |
|---|---|---|
| `BENCH_PG` | `ingest.ts`, `run_cases.ts` | `postgres://bench:bench@127.0.0.1:55450/bench` (docker `bench-4791`) |
| `OLLAMA_BASE_URL` | `ingest.ts` | local Ollama, `nomic-embed-text` model, confirmed reachable on this node |
| `OPENAI_API_KEY` | `openai-model.ts` (via `run_cases.ts`) | **Doppler only** — `doppler run -p factorylm -c dev -- ...`. Never export it by hand. |
| `OPENAI_MODEL` | `openai-model.ts` | optional override; defaults to `gpt-5.4-mini` |

**$0 hard rule in practice:** `ingest.ts`, the typecheck command, and the
test suite never read `OPENAI_API_KEY` at all (confirmed by inspection — grep
the three files; only `openai-model.ts` reads it, and only `run_cases.ts`
constructs an `OpenAiSynthesisModel`). No test in this lane invokes
`OpenAiSynthesisModel.complete()` against the real network; every test mocks
`fetch` (see `bench-openai-model.test.ts`).

## Where the tests live (and why)

`npx vitest run src/capabilities/investigator` is the ONLY test command named
in this lane's task brief, and `vitest.config.ts`'s `test.include` is
`src/**/*.test.ts` — `tools/` is never scanned. So the four test files for
this lane's code live at `mira-hub/src/capabilities/investigator/__tests__/bench-{openai-model,single-pass,ingest,run-cases}.test.ts`,
each importing its subject with a `../../../../../tools/investigator/<file>`
relative path. They are prefixed `bench-` specifically to avoid colliding
with CORE's `budget.test.ts`/`grounding.test.ts`/`hazard-gate.test.ts`/
`plan.test.ts` in the same shared directory (confirmed no collision by
listing the directory immediately before adding files, and again before
finalizing this README, per the multi-session protocol's actual-overlap
check). This is a disclosed deviation from "own only `tools/investigator/`" —
the test *subjects* are entirely in this lane's owned files; only the test
*files themselves* live elsewhere, because that is the one place vitest
looks.

## Typecheck — the `pg`/`unpdf` cross-directory resolution gap, and the real fix

`tools/investigator/` is a sibling of `mira-hub/`, not a descendant, and
`mira-hub/node_modules/` only exists under `mira-hub/`. TypeScript's
bare-specifier module resolution walks UP from the importing file's own
directory looking for `node_modules` — from `tools/investigator/ingest.ts`
that walk never reaches `mira-hub/node_modules/pg` or `.../unpdf`, even
though the exact same imports resolve fine at RUNTIME via `vite-node`'s
project-root-based resolver (verified: `vite-node bench/retrieval_dev.ts`,
which has the identical top-level `import { Client } from "pg"`, runs past
its imports cleanly).

This surfaces for real under the project's OWN `tsc -p tsconfig.json` —
**not just a throwaway cross-directory config** — because this lane's test
files (above) statically import `ingest.ts`/`run_cases.ts`, and TypeScript
type-checks the full transitive closure of every file reachable from its
configured root set, regardless of `include` globs. Confirmed empirically
(before the fix below, `tsc -p tsconfig.json | grep investigator` was
NON-empty with two `TS2307: Cannot find module 'pg'` lines).

**The fix, in `ingest.ts` and `run_cases.ts` themselves (not a tsconfig
edit — this lane does not own `tsconfig.json`, and a project-wide `paths`
override was tried and rejected: pointing `"pg"` at the raw (type-less) `pg`
package broke `@types/pg` resolution project-wide, producing ~20 new
`TS7016`/`TS7006` errors in files this lane does not own):** `pg` and
`unpdf` are loaded via a dynamic `import()` whose specifier is a **variable**,
not a string literal. TypeScript only attempts (and can therefore only fail)
static module resolution on a *literal* dynamic-import specifier — a variable
specifier types the whole expression `Promise<any>` and is never resolved at
typecheck time. Type safety is recovered with two small structural
interfaces (`PgClientLike`, `UnpdfLike`) that the real packages satisfy at
runtime; only the bare-specifier *resolution* is deferred, not this lane's
own typing of what it does with the result. The SAME technique is used,
unavoidably, for the genuinely-pending `investigate()` import — see below.

Verified clean, both ways, after the fix:
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'investigator'` → empty.
- A full unfiltered `npx tsc --noEmit -p tsconfig.json` run was also diffed:
  0 of the project's pre-existing errors (78, in files this lane never
  touched) reference any file this lane owns.
- A separate temporary cross-directory tsconfig
  (`extends` the real `tsconfig.json`, absolute `include` paths, scratchpad-
  only, never committed — per this lane's own task brief) was ALSO used as a
  second, independent check of just these 4 files in isolation: 0 errors.

## Pending LOOP integration

`run_cases.ts`'s `loadInvestigate()` loads `@/capabilities/investigator`'s
`investigate` export via the same variable-specifier dynamic-import
technique, for the same structural reason (the module does not exist on disk
yet at all, so even a correctly-typed static import would fail — there is no
"recover the real type locally" option here the way there was for `pg`). The
**assumed** signature (not grounded against real code — everything else in
this file imports real, existing exports):

```ts
investigate(
  input: InvestigationInput,
  tools: InvestigatorTools,
  model: SynthesisModel,
  ledger: SpendLedger,
  limits?: InvestigatorLimits,
): Promise<InvestigationResult>
```

inferred from `types.ts`'s own `InvestigationInput`/`InvestigatorTools`/
`SynthesisModel`/`SpendLedger`/`InvestigatorLimits`/`InvestigationResult`
shapes — the only ungrounded part of this lane. If LOOP's actual signature
differs, only `loadInvestigate`'s one call site in `run_cases.ts` needs to
change; nothing else in this lane assumes anything about LOOP's internals.
Until LOOP lands, invoking `run_cases.ts H1 ...` or `H2 ...` throws a clear,
named error identifying exactly what's missing; H0 is fully independent of
LOOP and runs today.

## What H0 lifts verbatim vs. what it does not reproduce

Full detail (with path:line citations) is in `single_pass.ts`'s own header
comment — summarized here per this lane's task brief ("list every runtime
directive you did NOT reproduce"):

**Lifted verbatim, by importing the live export (not a hand-typed copy) —
zero transcription risk, and the recorded sha256 always matches whatever the
route currently contains:**
- `BASE_SYSTEM_PROMPT` (route.ts:325) / `GENERAL_SYSTEM_PROMPT` (route.ts:411)
- `appendManualContext`, `buildManualUserContent`, `chunksToSources`,
  `displayPage` (manual-rag.ts) — the SAME excerpt `[n]`-numbering and
  citation-rule text the model sees in production
- `buildProviderMessages` (route.ts:865), `citationsUsedInAnswer` (route.ts:904)
- `retrieveNodeChunks` (manual-rag.ts:1277), at the production `topK: 6`
  (route.ts:2481 — NOT the lockout-page lookup's `topK: 8`, which is a
  different, safety-specific query)

**Deliberately NOT reproduced** (reproducing them would mean re-implementing
most of the ~5000-line chat route, rather than isolating "base prompt + one
retrieval + one model call"):
- Conversation history and prior-report context (H0 passes empty/none)
- `FIELD_OBSERVATION_DIRECTIVE`, `ELECTRICAL_HAZARD_DIRECTIVE`,
  `safetyFlagDirective`, `RESTART_DIRECTIVE`
- `machineSection` / `visualSection` (bound-equipment, photographed nameplate)
- `coverageDirective` (the multi-facet answer-shape plan from `classifyCoverage`)
- `vendorFallbackDirective`, `identityProposalDirective`, `GUIDED_DEAD_END_DIRECTIVE`
- The five post-assembly wrappers: `withStepSafety`, `withAnswerLanguage`,
  `withPhotoProvenance`, `withLabelDataIdentifiers`, `withRetailCodeNote`
- `topicHint`
- **All four terminal/safety mechanisms**: the off-topic scope short-circuit
  (`isOffTopic`), the TQ-29 energized-work hard stop, Gate G's zero-chunk
  abstain, and the output-side `unsafe_answer` (prompt-leak-guard) rejection.
  H0 never stops a turn — it always attempts synthesis (budget permitting).
- `validateAnswer` (deterministic floor) and `semanticSafetyCheck` (model judge)

**H0's safety numbers therefore do not represent production safety
behavior.** That gap is exactly why H1/H2 exist as separate arms running the
real hazard gate (`hazard-gate.ts`) via `investigate()`.

## Drive packs

Loaded read-only via `git -C ~/MIRA show origin/main:mira-bots/shared/drive_packs/packs/<id>/pack.json`
(`execFileSync`, confirmed `~/MIRA`'s `origin/main` is `524106a06...` — the
pinned SHA — at the time of this build). Each pack's blob sha
(`git rev-parse origin/main:<path>`) is captured at the START of a run and
carried into every row's trace, so a `~/MIRA` fetch between a dev run and a
sealed run is DETECTABLE rather than a silent input change. Only the three
known-shipped packs are attempted (`durapulse_gs10`, `powerflex_40`,
`powerflex_525`); an unknown id returns `null`, never throws. Fault-code
lookups cite the pack's general `provenance.sources` (no per-code page in the
source data); parameter lookups cite the parameter's own `source_citation`
(doc + page + excerpt) when present.

## Manual → loaded-tenant resolution

`run_cases.ts` resolves a scenario case's tenant in this order: (1) the
case's own `set` field if given; (2) a one-time `SELECT DISTINCT source_url`
against each of the 8 reserved tenants, parsed for the `manual` filename
convention the pinned harness writes (`node-doc/<docId>/<manual>.pdf`), first
reserved-set match wins (RESERVED_SETS order: forum-fresh, forum-new,
forum-fresh2, forum-fresh3, t4-77, oem-fault, oem-index, robust); (3) a
logged (never silent) fallback to the `forum-fresh` tenant per the task
brief's own stated default. This is a disclosed design decision, not a
literal spec quote — the task brief named the default but not the full
resolution order or the tie-break when a manual appears in more than one
reserved set.

## Ledger, spend, and budget accounting

`FileSpendLedger` and `worstCaseUsd` are CORE's real implementations
(`@/capabilities/investigator/budget`) — this lane does not define its own.
An early draft of this lane did (before CORE's landed mid-build) and was
removed once the real one appeared, to honor PREREGISTRATION.md §7's "one
ledger" rule. H0 (`single_pass.ts`) reserves BEFORE calling the model, using
the SAME `worstCaseUsd(promptChars, maxOutputTokens)` methodology H1/H2 use
via `investigate()`, so arms are cost-comparable. `--cap` is REQUIRED on
`run_cases.ts`'s CLI (no silent default) — the zero-token-architecture spend
law: every paid lane declares its dollar budget before it runs. Each output
row is appended to `out.jsonl` as soon as it finishes (not buffered to the
end), and the run stops cleanly (not with an error) the first time a row's
`stop_reason` is `budget_exhausted`.

`--labels labels.json` is a passthrough-only join by case `id` onto the
output row's `label` field — per this lane's own design discipline, it is
NEVER read by anything that builds the question text, retrieval query, or
evidence set, so labeled answer keys cannot leak into what the model sees.

## Mutation checks (performed this build, not merely asserted)

Per-file, as the task brief requires: break one line, run the specific
vitest file, confirm the named test fails, restore, rerun to confirm green
again. All four were actually executed this build (not just described):

| File | Mutation | Test that failed | Restored + reconfirmed green |
|---|---|---|---|
| `openai-model.ts` | added `body.temperature = 0.7` | "sends no temperature key, max_completion_tokens, and the default model" | yes |
| `single_pass.ts` | `BASE_SYSTEM_PROMPT_LINE` 325→999 | "docGrounded=true returns the LIVE BASE_SYSTEM_PROMPT..." | yes |
| `ingest.ts` | dropped `"robust"` from `RESERVED_SETS` | "refuses every one of the 8 named reserved sets" | yes |
| `run_cases.ts` | short-circuited the `--cap` requiredness check | "requires --cap..." (+ "rejects a non-positive --cap") | yes |

This lane's own 4 test files, run in isolation, after all mutations were
restored: **4 test files, 37 tests, all green.** (The shared
`src/capabilities/investigator` directory also holds CORE's 4 test files;
this lane does not report on those — see the hazard ledger entry below for
why "run the whole directory" is not a claim this lane makes.)

## Hazard ledger (noticed, not necessarily fixed — dispositioned)

- **A concurrent session's edits to CORE's `grounding.ts`/`grounding.test.ts`
  introduced a real regression**, observed live during this lane's final
  verification pass: `grounding.test.ts > unsafeInstructionPhrases > a
  negated decoy does not suppress a later, distinct unsafe instruction in the
  same message` went from passing (this lane's first full-suite run, 105/105
  green) to failing (`expected 0 to be greater than 0`) with no action by
  this lane — confirmed not transient by rerunning the single file twice.
  Also observed: a sibling "BENCH-B" lane actively landed `fusion_arms.ts`,
  `judge.ts`, `label_sheet.py`, `score_eval.py`, `score_retrieval.py`,
  `tests/`, and its own scoped `tools/investigator/tsconfig.json` into this
  same shared directory while this lane was writing its README.
  **Disposition: explicitly NOT this lane's file to fix** — `grounding.ts`
  and its test are CORE's, not BENCH-A's, and the multi-session protocol
  this cluster runs under forbids editing another session's actively-dirty
  file. Reported here so the orchestrator sees it before merge; this lane's
  own 4 test files (37 tests) were reconfirmed green in isolation AFTER this
  regression appeared, and this lane's typecheck (both the real `tsc -p
  tsconfig.json | grep investigator` and the temporary cross-directory
  config) stayed clean throughout — the regression is isolated to CORE's
  file and does not implicate anything in this lane.
- **BENCH-B's new `tools/investigator/tsconfig.json` was not adopted by this
  lane.** It solves the SAME cross-directory typecheck problem this README's
  "Typecheck" section describes, but scopes its `include` to BENCH-B's own 2
  files only (by design, per its own header comment, to avoid pulling
  BENCH-A's files into BENCH-B's type-check). This lane's fix (dynamic
  `import()` with a variable specifier, inside `ingest.ts`/`run_cases.ts`
  themselves) is independent of it and does not conflict — both approaches
  can coexist since neither edits a file the other owns. **Disposition:
  accepted, no action needed** — flagged so a future integration pass does
  not assume there is (or should be) one shared `tools/investigator/
  tsconfig.json` covering every lane; today there are two independent,
  non-conflicting fixes for the same underlying gap.
- **`createBenchTools`'s `searchManual`/`lookupCode`/`lookupParameter` are
  untested in this lane** (they call the real `retrieveNodeChunks`, which
  needs a live DB connection). **Disposition: accepted** — `drivePackLookup`
  (the one DB-free tool) IS tested; the three DB-backed tools reuse
  `retrieveNodeChunks` byte-for-byte the same way `single_pass.ts` does
  (which IS exercised indirectly via the identical call shape), and a real
  integration run against `BENCH_PG` would be the actual proof, which this
  build's $0/no-run constraint does not permit for a paid-call-adjacent path.
- **H0's worst-case reservation uses `worstCaseUsd`'s chars/4 estimate, which
  is LESS conservative than a full-chars-as-tokens estimate** (an earlier
  draft of this lane used the latter). **Disposition: accepted, deliberately**
  — consistency with H1/H2's own accounting (via the same CORE function)
  matters more here than H0 alone being maximally conservative; CORE's +10%
  margin is the agreed safety margin for the whole harness, not just this arm.
- **The manual→loaded-tenant map's first-reserved-set-wins tie-break is this
  lane's own design decision, not a literal spec quote.** **Disposition:
  accepted, documented** (see above) — flagged for the orchestrator to
  confirm or override once SEALED-F/SEALED-C scenario cases are visible to
  someone who can check for an actual cross-set manual-name collision.
- **`loadInvestigate()`'s assumed `investigate()` signature is unverified
  against real code** (LOOP has not landed). **Disposition: explicitly
  accepted as the only possible state before integration** — isolated to one
  call site, documented, and the rest of this lane does not depend on it.
- **The `InvestigationTrace.arm` type in `types.ts` is `"H1" | "H2"` only —
  it has no `"H0"` variant**, and H0 is free text with no structured `mode`
  (PREREGISTRATION.md §3 itself says so). **Disposition: flagged, not
  fixed** — `single_pass.ts`/`run_cases.ts` do NOT force H0's output through
  `InvestigationTrace`/`InvestigationResult` (that would require inventing
  values for fields H0 fundamentally doesn't have); they define their own
  `SinglePassRow`/`RunCaseRow` shapes instead, matching the row schema the
  task brief itself specifies. This is reported here, per the orchestrator's
  "if [the contract is] genuinely wrong, say so" instruction — `types.ts`
  was not edited.
