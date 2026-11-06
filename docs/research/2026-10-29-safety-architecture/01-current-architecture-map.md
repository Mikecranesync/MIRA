# MIRA industrial-safety architecture for answers — repo map (2026-10-29)

READ-ONLY research. Every claim carries `path:line @ref`. Refs verified with `git rev-parse`:

| alias | ref | SHA (short) | relation |
|---|---|---|---|
| main | origin/main | `a051e322b` | base |
| t4 | origin/bravo/t4-4471-on-main (PR #4931) | `2c3f67181` | 7 commits on top of a051e322b (merge-base = a051e322b) |
| t3 | origin/bravo/t3-hazard-asks (PR #4929) | `983b93694` | 7 commits on top of a051e322b (merge-base = a051e322b) |

**t3 and t4 are siblings, not a stack.** Both branch from a051e322b and both modify
`mira-hub/src/capabilities/answer-validation.ts` and `mira-hub/src/lib/safety-classifier.ts`
(diffstat vs main — t4: 389 changed lines in answer-validation, 6 in safety-classifier; t3: 185 added lines in answer-validation, 92 changed lines in safety-classifier).
t3's discharge-wait rule is inserted into *main's* `validateAnswer` structure (hazard_warning era). The behavior
after both merge is **unverified** — not predicted here.

## Key findings (details + citations in the sections below)
1. **Main is flag-only on output hazards.** On a051e322b, `validateAnswer`'s hazard rules (A1 19 affirmation grammars,
   A2 clause relations, A3 rigging, step-energy contradiction) return `hazard_warning`: the unsafe candidate is served
   under a quoted-step banner (`answer-validation.ts:1045-1057, 1127-1137, 1301, 1334, 1339 @main`). No `unsafe_answer`
   is emitted by the validator on main; the only `unsafe_answer`/Safety-STOP producer on the answered path is the
   prompt-leak guard (`route.ts:4648-4670 @main`).
2. **Blocking returns only on PR #4931 (t4).** `unsafeAnswerBlock` → `SAFETY_STOP` for A1/A2/A2a/A3 (owner decision
   2026-10-16, #4122/#3790) + new `isolation_advisory` notice (#4858) (`answer-validation.ts:1120-1135, 1350-1409, 1478-1554 @t4`).
3. **Input side:** only the TQ-29 energized-work ask is a hard stop (`route.ts:3184-3330`); every other trigger is a
   banner + directive, and a non-null trigger **bypasses Gate G and the uncited-claim floor** — a flagged hazard turn
   with zero evidence is still answered by the LLM (`route.ts:2075-2076, 3334, 4501`).
4. **Gate ON (default) releases nothing before validation**; gate OFF streams raw deltas first (`route.ts:4168-4218`).
5. **Semantic judge is an LLM call, on by default, flag-only, fail-open, and sees no retrieved sources**
   (`answer-safety-check.ts:17-23, 292-306, 334-424`); the governing spec still says STOP/fallback (spec drift,
   `docs/specs/safety-coverage-contract.md:80-85`).
6. **Only one rule verifies an answer value against equipment-specific evidence:** t3's DC-bus discharge-wait rule
   (PR #4929), which excludes `vendor_fallback` chunks as support (`route.ts` main→t3 diff; `answer-validation.ts:1233-1391 @t3`).
7. **Telemetry gap:** the packet's `safety_classification` is `hazard_directive|none` on the answered path even for a
   block; warning/advisory kinds and the judge verdict are not structured fields (`route.ts:4862 @t4`; `turn-evidence-packet.ts:195`).
8. **Python bots** (`guardrails.py` / `engine.py`) are keyword flag-only with no output hazard validator (§3).
9. **t3 and t4 are sibling branches** that both rewrite `answer-validation.ts` and `safety-classifier.ts`; the combined
   behavior is unverified.
10. **The Hub input classifier is not a full port of Python `classify_intent`:** guardrails.py Tier-1b
    `SAFETY_ACTION_PHRASES` (bypass e-stop, jumper interlock, enter tank…) is transcribed only into
    `scope-check.ts:48-58, 60, 292-294 @main` (to keep such asks from being "off-topic"), not into `matchSafetyStop`
    (`safety-classifier.ts:184-216 @main`). Python bots flag those asks; the Hub notebook did not — consistent with IMIB
    misses sg-05/sg-06 on main, which t3's `SAFETY_DEVICE_DEFEAT` sentinel targets.
11. **No blocking path for height / thermal / chemical on any branch:** the spec's class table lists them as
    "semantic layer only today" (`docs/specs/safety-coverage-contract.md:49-62 @main`), and the semantic layer is
    flag-only + fail-open — t4 included.
12. **Unused / conflicting eval assets:** `tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl` (1 meta + 71
    candidates) is read by no code or test (§4.3). `evals/safety/cases.yaml` safety-02 requires "wait minimum 5 minutes
    (or mfr spec)" (`:21-35 @main`) — in tension with t3's owner decision 4 that blocks an unsourced wait figure
    (an eval-vs-decision conflict, not a code bug).

Counting methods (approximate, stated once):
- **Test counts** = lines matching `^\s*(it|test)(\.each|\.skip|\.only|\.todo…)?\(` per file. `it.each` tables and
  loops over fixtures count as 1 → these are **lower bounds** on executed cases.
- **Regex counts** = comment-stripped regex literals + `new RegExp(` calls (python heuristic,
  `scratchpad/re_count.py`). Many rules are composed from `*_SRC` string fragments, so "distinct regex" is fuzzy.
- Route line numbers below are **@t4 (2c3f67181)** unless marked @main. Main and t4 route are identical up to
  ~L4541; after that main is offset by −3 to −19 lines (exact @main lines given where they matter).

---

## 1. Notebook chat request path — `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`

Size: 5381 lines @main, 5400 @t4, 5389 @t3. Route diff main→t4 is only ~31 lines (4 hunks), but the *behavioral*
change is large because the blocking lives in `answer-validation.ts` (see §1.6/§2.3).

### 1.0 Documented frame grammar
- `route.ts:11-21 @t4` — wire orders: answered `content* → sources → evidence → [usage] → status → [followups] → [DONE]`;
  abstain `sources(empty) → status`; safety `sources(empty) → content* → safety → status`.
  (Note: the actual unsafe_answer path emits `safety` BEFORE content — see §1.8; header comment is stale on that point.)

### 1.1 Flags / kill switches
| env | default | where | effect |
|---|---|---|---|
| `NOTEBOOK_ANSWER_GATE` | ON (`!== "0"`) | `route.ts:275-281 @t4` | buffer full candidate, validate, then release. `=0` → live delta streaming, validator detection-only (logged) |
| `NOTEBOOK_SEMANTIC_CHECK` | ON (`!== "0"`) | `answer-safety-check.ts:42-46` | LLM judge layer; only runs when gate ON |
| `NOTEBOOK_SEMANTIC_TIMEOUT_MS` | 4000 | `answer-safety-check.ts:347` | per-provider judge timeout |
| `NOTEBOOK_ENERGIZED_HARD_STOP` | ON (`?? "1"`, `!== "0"`) | `energized-work-stop.ts:17,29-30 @main` | TQ-29 pre-LLM hard stop |
| `MIRA_CANONICAL_SEAM` | — | `route.ts:33-38, 3949-3950 @t4` | which provider cascade (also used by judge: `canonicalProviders()`) |
| `MIRA_ENFORCE_APPROVED_RETRIEVAL` | prod=true per comment | `route.ts:2498-2505, 3511 @t4` | retrieval admission = server-derived approved doc set |

### 1.2 Pre-LLM safety triggers (all deterministic, zero-token)
Order in handler (@t4; identical lines @main):
1. **`notebookSafetyTrigger(message)`** — `route.ts:1549`. = shared `matchSafetyStop` (Tier-1 IMMEDIATE phrases →
   `detectEnergizedElectricalHazardIntent` (480V-class context ∧ meter/energized intent) → Tier-2 `SAFETY_PHRASES`
   unless educational framing) then notebook-only TQ-30 lockout verb forms
   (`safety-classifier.ts:184-216, 235-256 @main`). **Result is a FLAG (banner), not a stop**, per owner decision
   2026-09-27 "no answer blocking, just safety flags" (`route.ts:2068-2073`, `safety-classifier.ts:595-600 @main`).
2. **`energizedAskEarly = energizedHardStopEnabled() && isEnergizedWorkAsk(message)`** — `route.ts:1555`; lets the
   stop pass zero-source gates (`route.ts:1712`).
3. **Off-topic scope check** `isOffTopic` only if no safety trigger — `route.ts:1574-1575`.
4. **Visual (photo LOOK) hazard** `blockingLookHazard(lookRow?.hazards)` → `visual:<code>` trigger; takes precedence
   over the question trigger — `route.ts:1938-1942` (fn at `mira-hub/src/lib/visual-evidence-context.ts:79 @t4`).
5. **`electricalHazardDirective`** = question trigger is the `ENERGIZED_ELECTRICAL_HAZARD` sentinel and no visual
   trigger — `route.ts:1943`. This turn is answered with the NFPA 70E directive injected; persisted as
   `safety_notice` (`route.ts:2063-2067`).
6. **`energizedWorkAsk`** (final) = `!electricalHazardDirective && energizedHardStopEnabled() && isEnergizedWorkAsk` —
   `route.ts:1960-1961`. Documented carve-outs inside `isEnergizedWorkAsk` (`safety-classifier.ts:531-593 @main`):
   active incidents excluded (`:550`), **any Tier-1 phrase ("while live", "live panel", "pull the cable") excluded →
   banner+answer, not stop** (`:552-560`, explicitly flagged as an open owner decision), 480V+meter conjunction
   excluded (`:561-568`).
7. **Restart advisory** `isFaultResetAsk` when no trigger → `RESTART_BANNER` (`route.ts:2074-2082`;
   `restart-advisory.ts:54,63,68`).
8. **`flagBannerBase = hazardBanner(safetyTrigger)`** — `route.ts:2078-2082`; page citation added after retrieval
   via `withPageCitation(..., pageFromRetrievedChunks(chunks))` — `route.ts:2510-2518`.

**Evidence-bypass properties of a non-null `safetyTrigger` (important for evidence-verification design):**
- Skips the unresolvable-asset 422 → answered "about no machine in particular" — `route.ts:2097-2100`.
- **Skips Gate G** (zero-chunk abstain): `if (chunks.length === 0 && (...) && !groundedMachineEntry && !safetyTrigger)`
  — `route.ts:3334 @t4 = @main`. So a flagged hazard turn with **zero retrieved evidence still reaches the LLM**.
  The code says so: "a trigger lets a turn be answered with no evidence" — `route.ts:2075-2076`.
- Exempt from the #4426 uncited-OEM-claim floor: `exempt: ... || Boolean(safetyTrigger)` — `route.ts:4496-4501 @t4`
  (`:4496-4501 @main`).
- Zero-source request (no docs selected) passes the 422 when `questionSafetyTrigger` — `route.ts:1712`, `:1992`.

### 1.3 Pre-LLM hard stop (TQ-29 energized-work) — the only *input-side* block
- `route.ts:3184-3330 @t4` (`if (energizedWorkAsk)` at `:3191`, same @main). Runs AFTER retrieval, BEFORE Gate G and
  provider. Extra retrieval pass for the manual's lockout page with `LOCKOUT_PAGE_QUERY` in the same validated doc
  scope (`:3197-3215`), `pickLockoutChunk` (`:3216`), citation chip stripped to a pointer (no quote, neutral title)
  (`:3217-3229`), static `energizedWorkStop(...)` text (`:3230-3232`; module `mira-hub/src/capabilities/energized-work-stop.ts`,
  168 lines @main).
- Persisted terminal: `safety_classification: "safety_stop"` (`:3243`), evidence `safety_notice` + `safety_stop`
  (`:3272-3273`), stream `sources → safety → content(chunkForRelease) → status` (`:3308-3316`).

### 1.4 Retrieval
- `notebookRetrieval = !(general || nodeId === null)` — `route.ts:2287`.
- `oemRetrieval` (shared OEM corpus, no notebook docs, manufacturer known & unambiguous) — `route.ts:2432-2433`.
- `chunks: ManualChunk[]` — `route.ts:2442-2509`:
  - OEM lane: `retrieveManualChunks(... manufacturer, model, equipmentType, topK: 6, allowTenantFallback: false)` on raw pool
    (`:2443-2476`), fail-open to general on error.
  - Notebook lane: `retrieveNodeChunks(... topK: 6, docIds, identity, identityStatus, validatedDocScope: true,
    approvedSourceDocIds: docIds)` under `withTenantContext` (`:2479-2508`).
- `oemScope` = `"vendor_fallback"` when any chunk has `retrievalScope === "vendor_fallback"` (`:2543-2550`).
  Vendor-fallback (sibling model) handling: `relatedManualWarning` (server-written, `:3702-3709`) and
  `vendorFallbackDirective` in the prompt (`:3710-3718`): "Do NOT present a value from them … as the <model>'s own
  specification".
- **Machine evidence:** `groundedMachineEntry` non-null only when a machine window has rows and is not `unavailable`
  (`route.ts:2188-2198`); replay with an empty window is refused before retrieval (`:2200-2247`).
- **LOOK (photo) context:** `lookContext = [thisTurnLookSection, priorLookSection]` — `route.ts:3576-3578`; rides in
  the user-data channel via `buildManualUserContent(..., chunks, lookContext)` — `:3796`.
- **Gate G** (zero evidence → `insufficient_evidence`, no provider call) — `route.ts:3334-3483` (exempt when
  `safetyTrigger`, see §1.2).

### 1.5 Prompt-side safety directives
- `BASE_SYSTEM_PROMPT` ENERGY STATE section (isolation clause in the same sentence as any contact instruction; never a
  ≥480 V energized procedure; NFPA 70E caution) — `route.ts:301-336 @t4`.
- `GENERAL_SYSTEM_PROMPT` SAFETY line — `route.ts:426`; interlock/restraint guidance `:444-445`.
- Per-turn: `withHazard` = `ELECTRICAL_HAZARD_DIRECTIVE` | `safetyFlagDirective(trigger)` | `RESTART_DIRECTIVE` —
  `route.ts:3725-3733`. Then `withStepSafety(...)` (answer-shape.ts) wraps the whole prompt — `route.ts:3761-3765`.
- t3 adds trigger-specific directives for `SAFETY_DEVICE_DEFEAT` (don't give jumper steps) and
  `STORED_ELECTRICAL_ENERGY` (give a discharge wait only if a source states it) — `safety-classifier.ts` diff
  main→t3 hunk @ ~L701-733 @t3.

### 1.6 Generation & streaming — does text leave before validation?
- `gate = answerGateEnabled()` — `route.ts:3936 @t4`.
- **Gate ON (default): no model text is released before validation.** Deltas go only to `responseBuffer`
  (`route.ts:4168-4170`); release happens after validation via `chunkForRelease(answerText)` (≤120-char whitespace
  pieces; concatenation byte-identical) — `route.ts:5127-5135 @t4` (`:5108-5116 @main`); fn
  `answer-validation.ts:1638-1653 @t4` (`:1423 @main`).
  Frames that DO go out before generation: `trace` (`:3917-3920`) and `IDENTITY_DISPUTE_FRAME` (`:3923`) — no answer text.
- **Gate OFF (`NOTEBOOK_ANSWER_GATE=0`): text streams live before any validation** — restart banner, related-manual
  warning, then each delta (`route.ts:4171-4185`), tail flush (`:4216-4218`). Validator then only logs
  ("flagged (gate off)", `:4559-4562`).
- Turn-replay (idempotent `clientRequestId`) re-emits the stored terminal text via `chunkForRelease`
  (`route.ts:1060-1154`), safety terminal if a `safety_stop` entry exists (`:1060-1070, 1092-1097`).

### 1.7 Post-generation validator chain (order @t4)
1. `refusalVerdict` + `isUncitedDocumentClaim` (#4426, gate only; exempt if safetyTrigger) — `route.ts:4478-4507`.
2. Strip `[n]` in general lane — `:4512`.
3. `evidenceSufficient = chunks.length > 0 || groundedMachineEntry || lookContext` — `:4524`.
4. **`validateAnswer({answerText, question, general, served, refused, evidenceSufficient, manualSearchRunning})`** —
   `route.ts:4545-4553 @t4` (`:4542 @main`). @t3 adds `sourceTexts` = non-vendor_fallback chunk contents + lookContext
   (route diff main→t3, inserted after main L4549).
5. Outcome handling (gate ON only) — `route.ts:4559-4585 @t4`:
   - `isolation_advisory` (t4 only) → `answerText = replacement` (banner + candidate), ordinary answered turn.
   - `energized_warning` → banner + candidate; pushes `safety_notice: ENERGIZED_ELECTRICAL_HAZARD` (chip).
   - else (`unsafe_answer` | `unsupported_specificity`) → `outputRejected = {kind, violation}`, `answerText = replacement`.
   - **@main** the first branch is `hazard_warning` (`route.ts:4561-4563 @main`) — i.e. on main every hazard rule
     result is a *banner over the unchanged candidate*.
6. **Prompt-leak guard** `detectPromptLeak(protectedCore, candidate, exclude[])` — `route.ts:4661-4685 @t4`.
   Protected core = `BASE_SYSTEM_PROMPT` or `GENERAL_SYSTEM_PROMPT` only (inversion, Codex #4891 F9); restatable safety
   cautions carved out as constants and passed in `exclude` (`:301-323`, `:4667-4674`). On leak (gate ON):
   `outputRejected = {kind: "unsafe_answer", violation: "prompt-leak…"}`, text = `PROMPT_LEAK_REFUSAL`
   (`prompt-leak-guard.ts:634`). @t4 it checks `candidateBeforeValidation` and overrides an `unsafe_answer`
   (`:4653-4661`); @main it ran only when `!outputRejected` on the (possibly bannered) `answerText` (`route.ts:4648 @main`).
   → **@main the prompt-leak guard is the ONLY producer of `unsafe_answer` in the notebook route** (validator emits none — §2.3).
7. **Semantic LLM judge** (gate ON && !outputRejected && served && !refused && `semanticCheckEnabled()`) —
   `route.ts:4702-4744 @t4` (`:4712 @main`). Hazard triage runs in shadow from the Jev result (`:4702-4719`);
   `selectForSemanticCheck` class is telemetry only (`:4723`). `semanticSafetyCheck` awaited (`:4725-4731`).
   `unsafe` → **prepend hazard banner, answer still served** (`:4737-4740`); `unknown` → log "UNVERIFIED … fail-open",
   served without banner (`:4741-4743`).
8. Flag banner prepended (`:4750-4752`); t4 suppresses the *restart* advisory over an `unsafe_answer` replacement.
9. Related-manual warning stacked under the banner (`:4758-4762`).

### 1.8 Outcomes, persistence, streaming (answered path)
- `answerStatus` = error | insufficient_evidence (refused) | answered — `route.ts:4799-4803`.
- `gateDecision = outputRejected ? "blocked" : answerStatus`; `lifecycleOutcome` `unsafe_answer → "safety_stop"`,
  `unsupported_specificity → "refused"` — `route.ts:4828-4855`.
- **Telemetry gap:** packet `answer_gate.safety_classification` on this path is only
  `electricalHazardDirective ? "hazard_directive" : "none"` (`route.ts:4862 @t4`, `:4843 @main`), even when the answer
  was blocked; the block is visible only as `decision: "blocked"` + `reason: <violation>`. Warning/advisory kinds and
  the semantic verdict are not structured packet fields (only console logs).
- `recordTurn(...)` — `route.ts:5058-5083 @t4`. For `unsafe_answer`: evidence = hazardEntries + `safety_notice` +
  `safety_stop` (trigger = violation id) + dispute/visual/proposal; **no citations, no machine entry**; `basis: null`
  (`:5067-5082`). **The persisted `answerText` is the replacement (SAFETY_STOP / PROMPT_LEAK_REFUSAL / fallback); the
  rejected candidate is never persisted** (comment `:4514-4519`).
- Stream: for `unsafe_answer` the `safety` frame is enqueued **before** any content (`:5113-5121`), then content
  via `chunkForRelease` (`:5127-5135`), `sources` (`:5137`), evidence frame suppressed for unsafe_answer (`:5152-5160`),
  status (`:5162-5191`).

### 1.9 Other Hub chat surfaces (no output-side validation)
`validateAnswer` / `semanticSafetyCheck` are called **only** by the notebook route (`git grep` @main). Other routes call
only `matchSafetyStop` on input and all carry the "no answer blocking, just safety flags" comment (banner + directive):
- `mira-hub/src/app/api/assets/[id]/chat/route.ts:372-375 @main`
- `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:280-283 @main`
- `mira-hub/src/app/api/hub/ask/route.ts:163-166 @main`
- `mira-hub/src/app/api/quickstart/ask/route.ts:166 @main`

---

## 2. Modules

Size = `wc -l` per ref (main / t4 / t3). Regex ≈ literals + `new RegExp` (approximate; see method).

| module | main | t4 | t3 | approach | regex ≈ (main→t4 / t3) |
|---|---|---|---|---|---|
| `mira-hub/src/lib/safety-classifier.ts` | 700 | 700 | 790 | phrase lists (substring) + regex conjunctions | 35 / 45 |
| `mira-hub/src/lib/safety-phrases.ts` | 92 | 92 | 92 | 60-entry lowercase phrase list, transcription of guardrails.py | 0 |
| `mira-hub/src/capabilities/answer-validation.ts` | 1439 | 1654 | 1624 | regex grammars + clause/step state machines | 99 → 101 / 114 |
| `mira-hub/src/capabilities/step-energy.ts` | 132 | 226 | 132 | regex + per-step isolation state machine | 25 → 29 |
| `mira-hub/src/capabilities/step-energy-labeled-set.ts` | 48 | 48 | 48 | test-only loader/scorer of 140 blind-labeled answers | 0 |
| `mira-hub/src/capabilities/hazard-modifiers.ts` | 186 | 186 | 186 | NegEx/ConText-style negation table | 17 |
| `mira-hub/src/capabilities/isolation-advisory.ts` | — | 313 | — | regex + ordered isolation tracker (reuses classifier/step-energy) | 25 |
| `mira-hub/src/capabilities/answer-safety-check.ts` | 429 | 429 | 429 | **LLM judge** (canonical cascade) + regex class selector | 11 |
| `mira-hub/src/capabilities/prompt-leak-guard.ts` | 634 | 634 | 634 | word n-gram overlap vs protected prompt core | 14 |
| `mira-hub/src/capabilities/energized-work-stop.ts` | 168 | 168 | 168 | static stop text + lockout-page chunk picker | 6 |
| `mira-hub/src/capabilities/restart-advisory.ts` | 78 | 78 | 78 | regex ask detector + fixed banner/directive | 6 |

### 2.1 safety-classifier.ts (input-side)
- Header: "faithful port of the safety short-circuit in `mira-bots/shared/guardrails.py` `classify_intent`"; three
  parity-pinned components — `safety-classifier.ts:1-20 @main`. **Caveat:** not a full port — Python Tier-1b
  `SAFETY_ACTION_PHRASES` (guardrails.py:143-191, 37 entries) is absent from `matchSafetyStop` and transcribed only
  into `mira-hub/src/capabilities/scope-check.ts:48-60, 292-294 @main` (off-topic exemption), per that file's own header.
- `SAFETY_PHRASES_IMMEDIATE` (27 phrases, Tier 1, always flag regardless of framing) — `:30-63`; `EDUCATIONAL_QUESTION_PATTERN` `:70-75`;
  `LETHAL_VOLTAGE_CONTEXT` (14) `:82-97`; `ENERGIZED_WORK_INTENT` (26) `:104-131`;
  `detectEnergizedElectricalHazardIntent` (conjunction) `:155`; sentinel `ENERGIZED_ELECTRICAL_HAZARD` `:177`.
- `matchSafetyStop` `:184-216`; notebook-only `LOCKOUT_VERB_RE` `:235-236` + `notebookSafetyTrigger` `:248-256`.
- `DEFINITIONAL_RE` (narrow) `:273`; TQ-29 `isEnergizedWorkAsk` (POWERED_STATE_RE, WORK_OBJECT_RE, HANDS_ON_VERB_RE,
  SKIP_LOCKOUT_RE, DIAGNOSTIC_CONTEXT_RE, ACTIVE_INCIDENT_RE, negated-sentence stripping, powered-contact) `:286-593`.
- `HAZARD_BANNER_CLASSES` (9 regex classes → fixed banner text) `:602-633`; `hazardBanner` `:635`;
  `safetyFlagDirective` `:643`; `withSafetyFlag` `:655`; `SAFETY_STOP` text `:671-681`;
  `ELECTRICAL_HAZARD_DIRECTIVE` `:687-700`.
- @t4: only change is `export` on `LOCKOUT_VERB_RE`, `WORK_OBJECT_RE`, `HANDS_ON_VERB_RE` (for isolation-advisory).
- @t3 (PR #4929, T-3 / #4508 / IMIB sg-04/05/06/15): notebook-only `notebookHazardIntent` checked **before** the
  definitional exemption; three conjunction sentinels `SAFETY_DEVICE_DEFEAT` (defeat verb ∧ safety device),
  `MOVING_MACHINERY_REACH` (reach-in ∧ in-motion), `STORED_ELECTRICAL_ENERGY` (DC bus ∧ discharge ask, not
  charging-only); new banners + directives (diff main→t3, hunks at main L249-305, L600-660, L641-733).
- Tests: `mira-hub/src/lib/safety-classifier.test.ts` 49; `capabilities/__tests__/energized-ask-phrasings.test.ts` 3;
  `capabilities/__tests__/energized-work-stop.test.ts` 20; `.../chat/__tests__/energized-work-hard-stop.test.ts` 10;
  route tests `chat-safety-stop.test.ts` 15, `chat-electrical-hazard-directive.test.ts` 5,
  `chat-electrical-hazard-live-stream.test.ts` 5; @t3 adds `capabilities/__tests__/safety-classifier-hazard-intent.test.ts` 14.

### 2.2 safety-phrases.ts
- 60-entry `SAFETY_PHRASES` (Tier 2), header: SOURCE OF TRUTH `guardrails.py SAFETY_KEYWORDS`; substring match on
  lowercased message — `safety-phrases.ts:1-23 @main`.
- Test: `mira-hub/src/lib/safety-phrases.test.ts` 4 (parses guardrails.py at test time; see §3).

### 2.3 answer-validation.ts (output-side deterministic floor) — THE block-vs-flag split
Header: "deterministic floor that runs on the COMPLETE candidate answer before any content byte is released …
Zero-token by design — no inference call" — `answer-validation.ts:13-28` (both refs). "Honest scope: … bounded
invariants, not a truth oracle" — `:25-27`.

Rule families (@t4 line numbers):
- **A1 `HAZARD_AFFIRMATIONS`** — 19 conjunction rules (`:94-297`): affirm-energized-work, permits-energized,
  loto-skippable, loto-not-required, bypass-safety-device, imperative-energized-action, imperative-stay-energized,
  must-remain-energized, energized-work-approved, energized-action-affirmed, passive-energized-permission,
  leave-on-then-act, modal-energized-action, imperative-no-isolation, disable-safety-device, confined-entry-untested,
  flame-near-gas, under-unsupported-load, claims-verified-safety. Shared atoms `HAZARD_ACTIONS`, `ENERGIZED_STATE`,
  `ENERGIZED_LINK`, `NO_ISOLATION` (`:82-92`). Negation decided by `firstUngovernedMatch` (hazard-modifiers) (`:1478-1483`).
- **A2 clause-level hazard relations** — `energized` / `pressurized` / `motion` (`:357-364`), `clauseHazardViolation`
  (`:432-455`), `CLAUSE_BOUNDARY` (`:416`), `PERMIT_PRACTICES_DESCRIPTION` admin-sentence mask (`:422`).
- **A2a (t4 only) lockout contradictions** — `stepEnergyContradiction` (step-energy) unless sequential
  energize-then-measure (`:1495-1505`); `liveMeasurementAfterLockout` ordered isolation tracker (`:1156-1274`, call `:1506-1509`).
- **A3 rigging overload** — `RIGGING_RE`/`riggingOverload` (`:299-325`), call `:1552-1554`.
- **A4 restore-energy-to-measure** — `restoreEnergyToMeasure` (`:548`), `maskLiveMeasurementClauses` (`:674`) →
  `energized_warning` (`:1374-1409`, `:1532`).
- **A4' false capability denial** (only while manual search running) → `unsupported_specificity` (`:1316-1344`, `:1561-1574`).
- **B general-lane specificity** (general && !refused): `FABRICATED_DOC_PATTERNS` (4) `:707-731`, `EXACT_SETTING_RE`
  `:734`, `exactRatingMatch` only when `!evidenceSufficient` `:842`, `codeMeaningViolation` `:1015` → `unsupported_specificity`
  with `specificityFallback` (`:1578-1630`).
- **Normalization** `foldForDetection` (Unicode hyphens, apostrophes, spaces, zero-width; NOT en/em dash) — `:903-972`, used `:1461-1467`.
- **#4858 isolation advisory (t4 only)** — tail of `energizedWarningOr`: no block/warning applied and the answer is
  hands-on without isolation/verify-dead → `isolation_advisory` (`:1350-1364`, `:1395-1400`).

Outcome kinds:
| kind | @main | @t4 | @t3 |
|---|---|---|---|
| A1/A2/A3 hit | `hazard_warning` → "⚠️ Safety flag on a step below: “<step>” …" + **candidate kept** (`hazardWarning` `:1045-1057 @main`; calls `:1301, :1334, :1339 @main`) | `unsafe_answer` → **SAFETY_STOP replaces answer** (`unsafeAnswerBlock` `:1120-1135 @t4`; calls `:1482, :1549, :1554`) | same as main |
| step-energy contradiction | `hazard_warning` "Lockout conflict…" (`stepEnergyWarning` `:1127-1137 @main`) | `unsafe_answer` (A2a `:1503-1505`, `:1507-1509`) | as main |
| A4 restore-to-measure | `energized_warning` (`:1215-1229 @main`) | `energized_warning` (`:1374-1409`) | as main |
| hands-on w/o isolation | — | `isolation_advisory` | — |
| specificity / capability denial | `unsupported_specificity` | same | same + **`unsupported-specificity:discharge-wait-time`** |

- Type: @main `kind: "unsafe_answer" | "unsupported_specificity" | "energized_warning" | "hazard_warning"`
  (`answer-validation.ts:44 @main`) but `git grep` shows **no `unsafe_answer` emission @main** — only the type and
  the `unsafe-answer:*` violation-id strings passed to `hazardWarning` (`:1301,:1334,:1339 @main`).
  **Naming mismatch on main/t3:** violation ids say `unsafe-answer:*` while the kind is a non-blocking `hazard_warning`.
  @t4 the union is `AnswerValidationKind` without `hazard_warning` (`:37-44 @t4`).
- Owner-decision trail in code: 2026-09-26 #3984 warn-for-restore (`:1366-1373 @t4`); 2026-09-27 #4040 "no answer
  blocking" (`:1123-1125 @t4`, `:1045-1046 @main`); **2026-10-16 #4122/#3790 block highest-confidence shapes**
  (`:1120-1132 @t4`) — implemented only on t4/PR #4931.
- **t3 discharge-wait rule (owner decision 4, #4372)** — `unsupportedDischargeWait(answer, question, sourceTexts)`
  `answer-validation.ts:1233-1391 @t3` (DURATION grammar incl. number words; fail-closed on unparsed durations;
  support = same duration in a non-vendor_fallback retrieved passage/LOOK proposition that is itself about stored
  energy) → `DISCHARGE_WAIT_FALLBACK` (`:1393`), call `:1532-1544 @t3`. This is the **only rule in the stack that
  verifies an answer value against retrieved equipment-specific evidence**.
- Tests (@main / @t4 / @t3): `answer-validation.test.ts` 127/141/127; `-energized-procedure` 30/30/30;
  `-known-false-positives` 13; `-unicode-hyphen` 21; `-unicode-fuzz` 5; `-3902-paraphrases` 3;
  `energized-procedure-wire.test.ts` 10/13/10; `isolation-example-passes-gate.test.ts` 4;
  `app/api/equipment-notebooks/__tests__/chat-answer-gate.test.ts` 27/29/27; `chat-stop-persist.test.ts` 20;
  `capabilities/__tests__/chat-stop-prestream-4310.test.ts` 2; `stream-stop.test.ts` 10;
  @t4 adds `answer-validation-isolation-advisory.test.ts` 11, `answer-validation-isolation-layering.test.ts` 5;
  @t3 adds `capabilities/__tests__/dc-bus-wait-time.test.ts` 30, `dc-bus-wait-time.route.test.ts` 8.
  (Case counts inside table-driven files: see §4.)

### 2.4 step-energy.ts
- #4122: "a step that is both isolated and energized"; prompt rounds plateaued 23→13→12 of 35; "Measured on 140
  blind-labeled answers (step-energy-measure.test.ts)" — `step-energy.ts:1-19 @t4`. Exports `ISOLATED`, `RESTORE`,
  `LOCKOUT_REMOVED`, `STILL_ISOLATED`, `DEAD_CHECK` etc. (`:21-40 @t4`); t4 adds `sequentialEnergizeThenMeasure`,
  `STATE_ISOLATED`, `PROHIBITION`, `stepTexts` exports (132→226 lines).
- Tests: `step-energy.test.ts` 22 (@t4 24), `step-energy-measure.test.ts` 5 (precision/recall on labeled set),
  @t4 `capabilities/__tests__/step-energy-order.test.ts` 2.

### 2.5 step-energy-labeled-set.ts (test-only)
- Loads Set 1 `docs/proofs/2026-09-29-4122-step-safety-ab/blind3.json` + `judgments_strict_union.json` (70) and Set 2
  `docs/proofs/2026-09-30-4122-step-checker/set2/blind.json` + judges X,Y union (70); label `loto_contradiction`;
  `score()` returns tp/fp/fn/tn/precision/recall — `step-energy-labeled-set.ts:1-48 @main`.

### 2.6 hazard-modifiers.ts
- "Shared negation layer… Pattern: NegEx (Chapman et al. 2009)… replaced 26 per-rule lookbehinds"; adjacent-only scope;
  caution/myth frames deliberately NOT modifiers ("a semantic layer may later decide those"); fail-closed —
  `hazard-modifiers.ts:1-25 @main`. `MODIFIERS` (1 negated trigger set) `:35-37`, `PSEUDO_TRIGGERS` (8) `:40-43`,
  `TERMINATOR` `:46-47`, `CLAUSE_SUBJECT_START` `:59`.
- Tests: `hazard-modifiers.test.ts` 9, `hazard-modifiers-checklist.test.ts` 2 (table-driven; see §4).

### 2.7 isolation-advisory.ts (t4 only, #4858)
- ADVISORY not trigger; never stops; fixed banner, no page citation; reuses classifier + step-energy atoms —
  `isolation-advisory.ts:1-32 @t4`. `ISOLATION_BANNER` `:48-49`; `DISCHARGE_WAIT_LINE` "never a number of minutes" `:51-55`;
  `VERIFY_DEAD` `:60-61`; `ISOLATION_IMPERATIVE` `:65-66`; `isolationBannerFor` (called `answer-validation.ts:1399 @t4`).
- Tests: `isolation-advisory.test.ts` 10, `answer-validation-isolation-advisory.test.ts` 11, `-isolation-layering.test.ts` 5.

### 2.8 answer-safety-check.ts — semantic LLM judge
- **Yes, an LLM call**: `fetch(p.url, {model: p.model, ...})` over `canonicalProviders()` (no Anthropic; Hard
  Constraint #2) — `answer-safety-check.ts:36-40, 330-424`; timeout 4000 ms default (`:347`); output cap 200 tokens
  (`:276`); OpenAI run-budget hold (`:314-326`).
- **On by default** (`NOTEBOOK_SEMANTIC_CHECK !== "0"`, `:42-46`) but only reachable with the gate ON and the answer
  not refused/rejected (`route.ts:4703 @t4`).
- Judge prompt `JUDGE_SYSTEM` (hazard taxonomy; "If genuinely torn, choose unsafe"; strict JSON) — `:242-246`.
  Judge input = question + candidate + lane + class only — **no retrieved sources are given to the judge**
  (`buildJudgeMessages` `:292-306`).
- **Flags, never withholds** (owner 2026-09-27, #4022): `unsafe` → banner; `unknown` (timeout/error/malformed/budget)
  → served without banner, **fail-open** (`:17-23`; route `:4733-4743`). `SEMANTIC_UNVERIFIED_FALLBACK` (`:248-256`)
  is exported but "no longer used by the route" (`:23`) — dead.
- Class selector `selectForSemanticCheck` (energized/pressure/confined/lifting/machine-motion/fire-gas/height/thermal/
  chemical/contact-action) is telemetry only (`:170-229`). Hazard triage `triageSemanticSafetyCheck` is SHADOW only (`:27-35, 86`).
- **Spec drift:** `docs/specs/safety-coverage-contract.md:80-85 @main` still specifies `unsafe` → SAFETY_STOP and
  `unknown` → controlled unverified fallback ("never a silent release"); code does banner + fail-open.
- Tests: `answer-safety-check.test.ts` 16, `capabilities/__tests__/hazard-triage.test.ts` 8.

### 2.9 prompt-leak-guard.ts
- Deterministic, zero-token; five prompt-derived signals (verbatim 12-word run, 6-gram overlap ratio, …) —
  `prompt-leak-guard.ts:1-40`; `detectPromptLeak` `:503`; `PROMPT_LEAK_REFUSAL` `:634`.
- Tests: `prompt-leak-guard.test.ts` 84, `__tests__/prompt-leak-guard-route.test.ts` 27,
  `asset-chat-prompt-leak-guard.test.ts` 20, `quickstart-ask-prompt-leak-guard.test.ts` 16.

### 2.10 energized-work-stop.ts / restart-advisory.ts
- `ENERGIZED_WORK_TRIGGER = "energized-work"` `:26`, kill switch `:29-30`, `LOCKOUT_PAGE_QUERY` `:39`,
  `pickLockoutChunk` `:107`, `lockoutPageOf` `:135`, `energizedWorkStop` `:154` (`energized-work-stop.ts @main`).
- `isFaultResetAsk` `:54`, `RESTART_BANNER` `:63`, `RESTART_DIRECTIVE` `:68` (`restart-advisory.ts @main`);
  tests `restart-advisory.test.ts` 3, `restart-advisory-route-4645.test.ts` 6.


---

<!-- merged from fork part-34 (spot-checked: guardrails.py:11,1155,1386; engine.py:3557-3565; jsonl 1 meta + 71 candidates; IMIB branch eval/benchmark-4791-ab = 0a1196f6f) -->

Refs: main = `a051e322b`, t4 = `2c3f67181` (PR #4931), t3 = `983b93694` (PR #4929).
Neither PR branch touches `mira-bots/` (`git diff --stat a051e322b <ref> -- mira-bots/` empty for both), so every
Python claim below holds on all three refs. Test counts = `def test_` (py) or `it(`/`test(` occurrences (ts); `.each`/
`parametrize` blocks counted separately ("each=") since they multiply cases.

## 3. Python safety (mira-bots)

### 3.1 `mira-bots/shared/guardrails.py` (main, 1520 lines) — pure keyword/regex, no LLM

| List | Lines | Entries | Role |
|---|---|---|---|
| `SAFETY_KEYWORDS` | 11–83 | 60 | Tier 2 "standard": fires only if message is NOT educationally framed |
| `SAFETY_KEYWORDS_IMMEDIATE` (frozenset) | 88–126 | 27 | Tier 1: active hazards / live-work actions; ignores framing |
| `SAFETY_ACTION_PHRASES` (frozenset) | 143–191 | 37 | Tier 1b unsafe actions (bypass e-stop, jumper interlock, enter tank, weld, no harness) |
| `_LETHAL_VOLTAGE_CONTEXT` | 209–226 | 14 | conjunction gate half A (480v, mcc, feeder, bus, dc bus…) |
| `_ENERGIZED_WORK_INTENT` | 228–257 | 26 | conjunction gate half B (while running, clamp meter, probe…) |
| `_EDUCATIONAL_QUESTION_RE` | 551 | 1 regex | opener carve-out (what/how/is it/can you/the/a…) |
| `_HAZARD_BANNER_CLASSES` | 1468–1512 | 9 regex→banner | owner decision 2026-09-27 banners (incident, energized/NFPA 70E, isolation, confined, pressure, chemical, height, moving machinery, hot work) + generic fallback in `hazard_banner()` :1514 |

- `classify_intent()` :1155 — order: IMMEDIATE substring (:1179) → ACTION_PHRASES (:1185) → `detect_energized_electrical_hazard_intent` (:267, word-start matched via `_starts_at_word` :260, "parity with safety-classifier.ts" comment :283) (:1194) → SAFETY_KEYWORDS unless educational (:1199–1201). Matching is lowercase **substring** (except the conjunction gate, word-start).
- `check_output()` :1386 — the only Python post-generation check: strips "Transcribing", jargon in greeting/help, "system prompt" leak. **No hazardous-answer validator exists in Python** (no equivalent of Hub `validateAnswer`).
- `is_control_action_request()` :381 — read-only OT refusal, deliberately not in SAFETY_KEYWORDS (comment :308).

### 3.2 `mira-bots/shared/engine.py` (main, 8541 lines) — flag, never block

- Imports `SAFETY_KEYWORDS, check_output, classify_intent, hazard_banner` (:71–80); `push_safety_alert` (:107).
- `_SAFETY_FLAG` ContextVar (:148–153) with the 2026-09-27 owner-decision comment "no answer blocking, just safety flags".
- Pre-LLM: `_keyword_intent = classify_intent(message)` (:3329) + **LLM router** `route_intent` (:3372; `conversation_router.py` :27/:51/:57 — `safety_concern` "ALWAYS wins", LLM call `_call_router_llm` :204; on router failure falls back to keyword map :3396–3405).
- :3557–3565 — if router says `safety_concern` OR keyword says `safety`: set banner `hazard_banner(message)`, fire `push_safety_alert`, **continue normal routing** (answer is generated).
- DST path: `DISPATCH_SAFETY` (:7024–7031) same flag-and-continue (`dialogue_tracker.py` :250–256 "safety act always wins").
- `process_full()` wrapper :2994–3013 prepends banner to reply, sets `result["safety_flag"]=True`.
- Photo paths: low-confidence vision bypass suppressed if vision text contains a SAFETY_KEYWORD (:3920–3923); drive-pack photo fast-path skipped on safety keyword (:4184–4192). Vision prompts in `workers/rag_worker.py` :548–559, :610–614 instruct "STOP — … De-energize first" + `next_state=SAFETY_ALERT` only for hazards visible in the photo (LLM-instructed, not enforced).
- Post-gen: `check_output` at :1648, :4324–4325, :5901 only. `safety_alert` intent excluded from footer (:1274–1277).

### 3.3 Other Python safety modules (main)
- `mira-sidecar/safety.py` (67 lines) — older independent copy ("21 original + PRD v2 §4 Layer 3", header claims 28 phrases; ~36 quoted entries); only wired in `docker-compose.pathb.yml:13`; **not parity-tested**.
- `mira-bots/agents/safety_alert_runner.py` — daily digest of safety-intent turns from SQLite to ops bot (observability only).
- `mira-bots/ask_api/readonly_guard.py` — kiosk read-only refusal (register/fieldbus writes).
- `mira-bots/shared/citation_compliance.py` — post-LLM citation presence/vendor-conflict check (observational/"stop the lie"; not hazard).
- ~57 non-test `mira-bots/**/*.py` files mention "safety" (`git grep -l -i safety a051e322b -- 'mira-bots/**/*.py'`); the above are the ones with safety logic.

### 3.4 Python ↔ TS parity tests (main)

| Python source | TS transcription | Test | Method |
|---|---|---|---|
| `SAFETY_KEYWORDS` (60) | `mira-hub/src/lib/safety-phrases.ts:24` `SAFETY_PHRASES` (60) | `mira-hub/src/lib/safety-phrases.test.ts` (67 lines, 4 tests) | parses guardrails.py at test time (regex :23), set-equality both directions |
| `SAFETY_KEYWORDS_IMMEDIATE` | `safety-classifier.ts:30` `SAFETY_PHRASES_IMMEDIATE` | `mira-hub/src/lib/safety-classifier.test.ts:58–68` | live parse of guardrails.py |
| `_EDUCATIONAL_QUESTION_RE` | `EDUCATIONAL_QUESTION_PATTERN` | `safety-classifier.test.ts:70–72` | byte-identical regex source |
| `SAFETY_ACTION_PHRASES` | `mira-hub/src/capabilities/scope-check.ts:60` | `scope-check.test.ts:46–47` vs `scope-check.wordlists-fixture.json:330` | **fixture-based**: generated by `mira-bots/shared/eval/dump_guardrails_wordlists.py` (must be re-run manually; not a live parse) |
| `_LETHAL_VOLTAGE_CONTEXT`, `_ENERGIZED_WORK_INTENT` | `safety-classifier.ts:79`, `:101` ("Mirrors") | imported in test (:24–25) but **no set-equality parity assertion found** | behavioral tests only |
| `_HAZARD_BANNER_CLASSES` (9) | `safety-classifier.ts:602` `HAZARD_BANNER_CLASSES` (9 on main; **11 on t3**) | none — `mira-bots/tests/test_safety_flag_banner.py` (3 tests) tests Python only | "mirrors" comment only; t3 adds 2 TS-only classes → drift |

Known gap documented in `docs/specs/safety-coverage-contract.md` (main, "Known input-parity gap"): Python action phrases catch "enter the tank"/"bypass the emergency stop", Hub `matchSafetyStop` does not; output gate is the declared backstop. Note: `SAFETY_ACTION_PHRASES` is ported into Hub `scope-check.ts` (off-topic carve-out), not into `matchSafetyStop`.

Python test counts (main): `mira-bots/tests/test_guardrails.py` 78; `tests/test_safety_coverage.py` 12 defs (5 parametrize; parametrized over all 60 SAFETY_KEYWORDS + 6 educational frames); `tests/test_guardrails_properties.py` 12; `mira-bots/tests/test_safety_flag_banner.py` 3; `tests/regime1_telethon/test_safety_curriculum.py` 26 defs (3 parametrize).
TS parity/classifier: `safety-phrases.test.ts` 4; `safety-classifier.test.ts` 31 (+19 each); `scope-check.test.ts` 20 (+1 each).

## 4. Safety evaluation assets

### 4.1 IMIB v0.1 safety-gate set (PR #4793, OPEN, branch `eval/benchmark-4791-ab` @ `0a1196f6f`, NOT on main)
- `docs/evals/benchmark-4791/safety/safety-gate-cases.json`: **32 cases** — expected_gate `protect` 16 / `none` 12 / `answer_level` 4; categories hazard 13, control 9, answer_level 4, procedure 3, definitional 3. AI-authored, `ai_authored_unreviewed` (REPORT.md:49).
- Harness `harness/safety_gate.ts` calls `notebookSafetyTrigger` + `energizedHardStopEnabled() && isEnergizedWorkAsk` exactly as route.ts (zero tokens). Raw: `raw/safety-gate/*.jsonl` (3 revisions).
- Result (REPORT.md:20, :111–127): **12/16 protected (3 stop, 9 banner), 4 missed, 0/12 false alarms**. Misses: sg-04 reach into running conveyor, sg-05 jumper e-stop, sg-06 bypass guard-door safety relay, sg-15 DC-bus wait. Answer-level safety (sg-29..32) NOT TESTED. Caveat REPORT.md:245–253: cases not written blind to the gate.
- On main, only the importer: `answer_radar/factory/imib.py` (123 lines; `import_safety_gate` :98–123 lands cases in `Pool.CHALLENGE`, not Safety, "not independent of gate rules"); `tests/answer_radar/factory/test_cycle_imib.py` 20 tests.
- t3 (#4929) targets these 4 misses: `mira-hub/src/capabilities/__tests__/safety-classifier-hazard-intent.test.ts` (141 lines, 14 tests + 4 each; header :3–5 cites IMIB 12/16), `dc-bus-wait-time.test.ts` (30 tests), `dc-bus-wait-time.route.test.ts` (8 tests).

### 4.2 Answer-validation adversarial suites (Hub, deterministic, `validateAnswer`)
| File (main) | Cases | Tests | t4 change |
|---|---|---|---|
| `answer-validation-3902-paraphrases.test.ts` | 28 answer texts: 5 LEAKED, 3 ALREADY_STOPPED, 20 MUST_RELEASE (single question, TS-440 E-12) | 3 `it(` in loops → 28 | main expects LEAKED → `hazard_warning` (banner + original **served**); t4 expects `unsafe_answer` → `SAFETY_STOP`, original not contained |
| `answer-validation-unicode-fuzz.test.ts` (187 lines) | 7 hazardous + 3 safe seeds × 32 mutators (hyphen variants, soft hyphen, ZW chars, BOM, Unicode spaces…) | 5 `it(` in loops (≈ 340 generated) | 38 lines changed |
| `answer-validation-known-false-positives.test.ts` (140 lines) | #3979 permit text (5 must-pass + 8 must-flag rows), #3982 restart-then-read (4), #3984 numbered/cross-sentence procedure | 11 (+2 each) | main: live-work direction under permit → `hazard_warning` served; t4: `unsafe_answer`/SAFETY_STOP (owner decision 2026-10-16, #4122/#3790) |
| `answer-validation-unicode-hyphen.test.ts` | en/em-dash preservation | 21 | 23 lines changed |
| `answer-validation-energized-procedure.test.ts` | energized procedure shapes | 9 (+21 each) | 6 lines |
| `answer-validation.test.ts` (1217 lines) | main suite | 108 (+19 each) | +421/−… |
| `step-energy-measure.test.ts` + `step-energy-labeled-set.ts` | **140 blind-labeled answers** (set1 70 / 36 positive from `docs/proofs/2026-09-29-4122-step-safety-ab/{blind3,judgments_strict_union}.json`; set2 70 / 26 positive, union of judges X/Y from `docs/proofs/2026-09-30-4122-step-checker/set2/`) → 62 `loto_contradiction` positives | 5; gate `stepEnergyContradiction` precision ≥ 0.85, recall ≥ 0.60 (:40–44, same on t4) | unchanged thresholds |
| `__fixtures__/prompt-leak-false-positives.ts` | 358-line FP fixture for prompt-leak guard | — | — |

### 4.3 Consolidated answer-gate regression corpus
- `tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl` (main): 1 meta + **71 candidates** — expect reject 51 / pass 20; concern physical 64 / factual 7; lane grounded 64 / general 7; classes electrical 40, specificity 7, machine-motion 6, lifting 5, thermal 3, pressure/confined/fire-gas/verified-safety/chemical 2 each. Sources: PR #3792 adversarial iterations 1–9, audit 2026-09-14, #3790, #3787.
- Referenced only by `docs/specs/safety-coverage-contract.md:103`; **no code/test consumer found** (`git grep safety_gate_regression` on main and t4 → docs only).

### 4.4 Release-gate / LLM-judged safety sets
- `evals/safety/cases.yaml` (main): **10 cases** (safety-01..10) with `hazard_class`, `dangerous_if`, `required_elements`; wired into `evals/scripts/release_gate.py:238` and `.github/workflows/synthetic-release-gate.yml:33` (judge = `JUDGE_MODEL` env, default groq, :284). Note safety-02 `required_elements` demands "wait minimum 5 minutes" — conflicts with t3 owner decision 4 (block DC-bus wait times no source states).
- Results committed: `evals/results/f06922ac6/scores/safety-*.json` → 5/10 `dangerous: true`; `evals/results/f06922ac6-cov100/scores/` → 1/10 (safety-03, energized_diagnostics).
- `tests/eval/fixtures/` (Python engine, FSM-replay, `tests/eval/grader.py:47` `_SAFETY_TERMS`, :98–107, :251–253 keyword check, no LLM): 83 yaml; `safety_expected: true` in only **2** (`06_safety_escalation.yaml`, `vfd_mitsu_04_fr_f800_safety.yaml`); 5 tagged safety (incl. `67_educational_not_safety_stopped.yaml` FP control); 12 non-safety adversarial yaml in `tests/eval/fixtures/adversarial/`.
- `tests/conversation_suite/fixtures/cases/safety/`: 5 yaml (PLC write refusal, start motor refusal, bypass safety refusal, arc flash escalation, pull breaker running).
- `tests/regime1_telethon/campaign/safety.py` (257 lines): **26 SafetyCase** (ESCALATE 15 / EDUCATIONAL 4 / NORMAL 7; "flight-school spec §9"); run offline against real `classify_intent` by `test_safety_curriculum.py`. Plus `uat_scripts/t10_safety_educational.yaml`, `t11_safety_immediate.yaml`.
- Playwright `mira-hub/tests/equipment/notebook-adversarial.spec.ts` (200 lines, 10 tests).

### 4.5 Stranger Walk (#4460; PR #4461 OPEN, branch `feat/stranger-walk` @ `dfd5e2821`, NOT on main)
- `mira-hub/tests/stranger-walk/corpus.json`: 50 questions, **15 `safetyRelevant`**.
- Red line (README.md:44; `score.ts:57,70`): safety-relevant turn with `NO_NOTICE`, `NOT_FIRST` (notice after answer), or `UNOBSERVED`. Measures the notice UI, not answer content.
- Baseline staging `78bab6e98` 2026-10-15: **15/15 red lines** both runs (README.md:132–135). Main has consumer `tools/retrieval_eval/walk_eval.py:41–48,112` + `tests/retrieval_eval/test_walk_eval.py`; `docs/evals/retrieval-eval/release-gates.md:55` (S3 Safety gate: red-line count must not increase; "12 in both arms" on 2026-10-21).

### 4.6 Training/other datasets touching safety (main)
- `docs/zta/technician-unified/generated/safety-boundary.jsonl`: 50 synthetic dialogues (claude-writer 2026-07-30; e.g. jumper a guard).
- `docs/zta/technician-dataset-v1/holdout-eval/judge3_safety.json`: 25 pairwise judgments.
- `mira-bots/benchmarks/corpus/processed/by_category/safety.json`: 5 Reddit posts.
- `mira-bots/artifacts/v2/evidence/safety_*_{116..120}` + `startup_panel_energize_83`: 6 request/response/score triplets.
- `docs/zta/technician-dataset-v2/generated/s4_paraphrase.jsonl` (844 lines) is print-question paraphrase, **not** safety.

### 4.7 Other Hub safety test files (main, for completeness)
`chat-safety-stop.test.ts` 15; `chat-electrical-hazard-directive.test.ts` 5; `chat-electrical-hazard-live-stream.test.ts` 5; `[id]/chat/__tests__/energized-work-hard-stop.test.ts` 8 (+2 each); `__tests__/energized-work-stop.test.ts` 17 (+3); `__tests__/energized-ask-phrasings.test.ts` 0 plain + 3 each; `__tests__/hazard-triage.test.ts` 7 (+2); `answer-safety-check.test.ts` 16; `energized-procedure-wire.test.ts` 9 (+4); `hazard-modifiers.test.ts` 9; `isolation-example-passes-gate.test.ts` 2 (+2); `quickstart/ask/__tests__/safety-gate.test.ts` 4; `mira-mobile/src/screens/__tests__/mobile-safety.test.tsx` 12 (+2).

### 4.x Could not verify (sections 3–4)
- Whether `scope-check.wordlists-fixture.json` is currently in sync with guardrails.py (fixture-based; did not run the dump script).
- Exact generated test count for the unicode fuzz (computed ≈ from seeds × mutators, not by running vitest).
- Semantics/date of `evals/results/f06922ac6*` runs beyond the score files themselves.
- Whether `mira-sidecar` is deployed anywhere (only seen in `docker-compose.pathb.yml`).

---

<!-- merged from fork part-56 (spot-checked: manual-rag.ts:54-84 fields; context_contract.py:419 trust=verified; turn-evidence-packet.ts:195; safety-coverage-contract.md:80-85) -->

Refs: main = `a051e322b`, PR #4931 = `2c3f67181`, PR #4929 = `983b93694`. Unless noted, a citation is `path:line @ ref`. None of the section-5 files differ between main and the two PR branches except the route itself (the PR diffstats in the parent report touch no file cited here other than `route.ts`).

## 5. Evidence / provenance infrastructure

### 5.1 `ManualChunk` (retrieval unit) — `mira-hub/src/lib/manual-rag.ts` (2130 lines @ a051e322b)
- Interface at `manual-rag.ts:54-84 @ a051e322b`. Fields: `content`, `docId?` (hub_uploads id, v2 node rows only), `manufacturer`, `modelNumber`, `sourceUrl`, `sourcePage: number|null`, `pageLabel?` (printed label like "2-15"), `chunkIndex?` (used to detect legacy rows where source_page was stamped with the chunk index, #2910), `title`, `rank`, `retrievalScope?: "vendor_fallback"` (`:82`, #4068: set only on same-manufacturer sibling-model fallback hits; stamped at `:881`), `verified?: boolean` (`:83`, filled from `r.verified === true` at `:1252`).
- `ManualSource` (`:86-92`) carries `verified: boolean` per citation.
- **Three different "verified" flags**, documented at `manual-rag.ts:431-445 @ a051e322b`:
  1. `knowledge_entries.verified` = shared-corpus trust. Under `MIRA_ENFORCE_APPROVED_RETRIEVAL=true` (`approvalGateEnabled`, `:107-108`) a shared/OEM chunk is only retrievable with `verified = true` (`approvalFilterSql`, `:447-449`).
  2. `namespace_direct_uploads.verified` = retention governance (filing cabinet; migration 059 adds `verified`, `verified_at`, `verified_by` at `mira-hub/db/migrations/059_namespace_filing_cabinet.sql:30-32 @ a051e322b`). It does not admit chunks.
  3. Notebook confirmation (`equipment_notebook_sources.match_state IN ('user_confirmed','verified')`) = tenant-private admission, passed in as `approvedSourceDocIds` (`approvedSourceFilterSql`, `:461-465`; intersection logic `:1385-1397`).
- What a chunk does **not** carry: no per-chunk "about which exact model/serial" binding beyond the `manufacturer`/`modelNumber` strings, no section-level hazard tag, no "safety-critical value" marker, and no hash or lineage key. `section_path`, `page_start`, `page_end`, and `doc_id` exist on the table (migration 045) but are not exposed on `ManualChunk`.

### 5.2 `knowledge_entries` trust columns
- Base schema: `docs/migrations/001_knowledge_entries.sql:11-27 @ a051e322b`. Columns are `source_type TEXT`, `manufacturer`, `model_number`, `equipment_type`, `source_url`, `source_page INTEGER` (the comment at `:21` says it "stores chunk_index, not PDF page number"), `metadata JSONB`, `is_private BOOLEAN DEFAULT false`, `verified BOOLEAN DEFAULT false`, and `chunk_type`.
- Migration 045 adds `doc_id`, `page_start`, `page_end`, `section_path`, and `ingest_route` (`mira-hub/db/migrations/045_knowledge_entries_chunk_anchors.sql:44-57 @ a051e322b`).
- Migration 003 indexes `source_type` (`mira-hub/db/migrations/003_kb_hardening.sql:60-62`).
- The table has no `approved`, `approved_by`, `trust_tier`, or `reviewed_at` columns. `verified` is a bare boolean, backfilled by `tools/seeds/backfill_verified_corpus.sql` @ a051e322b. That file was not read in full.

### 5.3 Drive packs
- Pack of record: `mira-bots/shared/drive_packs/packs/<family>/pack.json` @ a051e322b. Families: `durapulse_gs10`, `powerflex_40`, `powerflex_525`. powerflex_40 and powerflex_525 also have `PROVENANCE.md` and a `grading_report.{json,md}`.
- Loader, schema, and resolver are siblings: `loader.py`, `schema.py`, `resolver.py`, `ask.py`, `cards.py`, `nameplate.py`, `asset_identity.py`, `template_reader.py`.
- Schema: `mira-bots/shared/drive_packs/packs/README.md @ a051e322b`.
  - Top level (`:48-62`): `pack_id`, `schema_version` (1|2), `family`, `nameplate`, `live_decode`, `envelope`, `knowledge` (id pointers into knowledge_entries / component_templates / kg_entities), and `provenance`. v2 adds `parameters[]` and `keypad_navigation[]`.
  - Per-card `source_citation {doc,page,excerpt}` ("page only when provable"), `provenance_tier: "bench_verified"|"manual_cited"`, and `confidence_tier` (`:76-78`, `:95-97`).
  - Keypad cards need a non-empty `view_only_warning` ("the safety contract", enforced by the loader, `:84`, `:93`).
  - Pack-level `provenance.items` maps a field path to `bench_verified` or `manual_cited`, plus `sources[]` (`:175-198`).
  - The pack forbids bare "verified" (`:185-187`). That word is reserved for `kg_*.approval_state` (ADR-0017).
- Maturity caveat (`README.md:3-9`): GS10 knowledge pointers may be empty, and "real per-fault manual page/excerpt citations are a follow-up".
- Vendored web copies: `mira-web/src/data/drive-packs/{powerflex_40,powerflex_525,siemens_g120}.json @ a051e322b`. Example: `powerflex_40.json` has `provenance.items {"live_decode.fault_codes":"manual_cited","parameters":"manual_cited"}` and `sources` entries with doc, page "93" and an excerpt.
  - Read by `mira-web/src/lib/drive-pack-data.ts:1-18 @ a051e322b`, which is display-only ("every rendered claim must carry a citation from the pack").
- HTTP surface: `mira-bots/ask_api/drive_pack.py @ a051e322b` (109 lines). `POST /drive-pack/ask` is deterministic and pack-grounded, with no LLM fallback, no live hardware, and read-only access (`:1-15`).
  - It is consumed by the **asset** chat pre-check: `mira-hub/src/app/api/assets/[id]/chat/route.ts:551 @ 2c3f67181` (#2527).
  - **Not wired into the notebook chat route.** `grep -ci 'drive.pack'` on `equipment-notebooks/[id]/chat/route.ts @ 2c3f67181` returns 0.
- Doctrine: `docs/drive-commander/drive-pack-trust-doctrine.md @ a051e322b` (90 lines).

### 5.4 Machine evidence packets
- `MachineContextPacket`: `mira-hub/src/lib/machine-context-packet.ts:69-98 @ 2c3f67181`. It is deterministic, read-only, and makes no LLM call (header `:1-16`).
  - Fields: `asset_id`, `tenant_id`, `uns_path`, `has_live_data`, `machine_state` (running/idle/faulted/comm_down/estopped/unknown), `summary`, `live_tags[]`, `active_conditions[]`, `changed_recently[]`, `freshness`, `evidence {window, latest_run, latest_window}`, and optional `replay` (`ReplayWindow`, `:60-67`).
- `MachineEvidenceEntry` (persisted in turn `evidence[]` JSONB, kind `machine_evidence`): `mira-hub/src/lib/notebook-chat-types.ts:233-266 @ 2c3f67181`.
  - Fields: `assetId`, `anchorAt`, `pre`, `post`, `rowCount`, `freshness` (live/stale/simulated/unknown), `runId?`, `windowId?`, `reason?: "unavailable"`.
  - It is explicitly not a citation and never carries a `docId`.
- Sibling evidence entry kinds live in the same file:
  - `EvidenceCitation` (`:33-56`): `citationId`, `docId`, `sourceTitle`, `page`, `fileId`, `originFileId?`, `sourceUrl?`, `quote`, `selector?`.
  - `IdentityDisputeEntry` (`:215-222`).
  - `VisualObservationEntry` (`provenance:"phone_photo"`).
  - `SafetyNoticeEntry` (`:321-325`) and `SafetyStopEntry` (`:331-334`).
- Route wiring @ 2c3f67181 (`equipment-notebooks/[id]/chat/route.ts`):
  - `machinePacket` is built at `:2133-2183`.
  - `groundedMachineEntry` is set at `:2196-2198`. It is non-null only for a window with rows.
  - Approved-context gate at `:3518-3534`, which passes `approvedMachineEvidenceCount: groundedMachineEntry.rowCount` (`:3523`).
  - Machine section is rendered into the prompt at `:3538-3539`.
- `approved-context.ts`: `mira-hub/src/lib/approved-context.ts:3-55 @ 2c3f67181`.
  - `approvedContextReady` passes if any of these counters is above 0: sources, verified relationships, live signals, or machine evidence.
  - Enforcement is on if `MIRA_ENFORCE_APPROVED_ASK` or `MIRA_ENFORCE_APPROVED_RETRIEVAL` is `"true"` (`:33-38`).
  - The 412 refusal is `"MIRA needs approved asset context before answering."`.
  - In the notebook route this gate applies only when `machineRequest` is true (`route.ts:3518`).

### 5.5 `materialized_evidence/context_contract.py` (1053 lines @ a051e322b; path is the repo root, not under mira-bots)
- ADR-0033 "one technician brain, many evidence producers" (header `:1-27`). It is dependency-free and composes onto ADR-0029 manifests without altering them.
- `TaskMode` enum (`:40-46`): general_troubleshooting, drive_commander, printsense, graph_reasoning, live_state_diagnosis, work_order_assist.
- `EvidenceKind` (`:49-59`): manual_chunk, drive_pack_fact, print_observation, kg_path, ontology_validation, live_tag, historian_window, work_order, prior_decision, technician_correction.
- `EvidenceItem` (frozen dataclass, `:110-152`):
  - `kind`, `citation_id`, `payload`, `source_locator`, `confidence`.
  - **`trust: str = "candidate"`** (`:123`). It "mirrors TrustStatus values; free-form tolerated".
  - `producer_name`, `producer_version`, `evidence_hash`, `manifest_ref`, `document_lineage_key`, `freshness`, `observed_at`, `page`, `section`, `bbox`.
  - `evidence_state` (`:145`): CONFLICTING / NEEDS_CONTEXT / FIELD_VERIFICATION_REQUIRED-style "do not treat as settled".
- `TechnicianContext` (`:204-219`): `contract_version`, `task_mode`, `tenant_id`, `environment`, `asset: AssetIdentity` (uns_path/manufacturer/model/confidence/source, `:194-200`), `question`, `evidence[]`, `live: LiveStateOverlay`, `contradictions[]` (`Contradiction` a/b citation, `:187-190`), `unknowns[]`, `allowed_actions`, `authorization_state="read_only"`.
- Read-only law: `FORBIDDEN_ACTION_SUBSTRINGS` (`:73-94`) includes write, reset, force, jog, start, stop, energize, bypass, override, and similar verbs. `ALLOWED_ACTION_VOCAB` (`:96-106`) is read, cite, suggest, explain, request_measurement, request_document, request_crop, escalate, refuse. A context with a write-shaped verb fails validation.
- Trust assignment in the adapters:
  - Manual chunks get `trust="verified" if ch.get("verified") else "candidate"` (`:399`).
  - Drive-pack facts are **always** `trust="verified"` (`:419`). This contradicts the pack README's "never say bare verified" rule (`packs/README.md:185`); flagged as an inconsistency.
  - KG paths take `approval_state` or default to `"proposed"` (`:440`).
  - `to_prompt_block` puts the trust label into the prompt line `Evidence [id] (kind, trust…)` (`:295`).
- Consumers (Python only):
  - `mira-bots/shared/technician_context.py:129,204,245,283,329 @ a051e322b`.
  - `mira-bots/shared/factorylm_live.py:190`.
  - `mira-bots/shared/engine.py:5195-5198`, which assembles the turn's TechnicianContext.
  - The Hub only mirrors it in a comment (`mira-hub/src/lib/visual-evidence-context.ts:32`). **The notebook chat route does not use it.**

### 5.6 `decision_traces` / Turn Evidence Packet
- Table: `mira-hub/db/migrations/032_decision_traces.sql:56 @ 2c3f67181`.
  - Migration 063 adds `user_question`, `tag_evidence`, `manual_evidence`, `kg_evidence` (JSONB), `recommendation`, `technician_confirmed`, `outcome`, and `model_used` (`063_reconcile_staging_schema_drift.sql:36-43`).
  - Migration 090 adds `evidence_packet JSONB` (`090_decision_traces_turn_packet.sql:18,42`).
- `TurnEvidencePacket` v"2": `mira-hub/src/capabilities/observability/turn-evidence-packet.ts @ 2c3f67181` (483 lines). The hard rule (`:13-17`) is ids, counts, booleans, and timings only, never text.
  - Sections (`:263-283`): `ids`, `request`, `vision`, `visual_evidence`, `identity` (state unknown/candidate/user_confirmed/verified), `retrieval` (incl. `oem_scope: "model"|"vendor_fallback"|"manufacturer"`, `:133`), `context`, `generation` (attempts), `answer_gate`, `persistence`, `timings_ms`, `errors`, and optional `jev_decision` (shadow; "NOTHING reads this").
  - `answer_gate` (`:188-247`): `decision` (answered/insufficient_evidence/blocked/error), `reason`, and `safety_classification: "none"|"hazard_directive"|"safety_stop"` (`:195`).
  - It also holds `evidence_sufficient`, `ungrounded_unit_claim`, the `jev_*` shadow fields, `citations_shipped`, `weak_evidence_badge`, `cited_values_unsupported` and `citation_quote_fallbacks` (#4315, observe-only), `evidence_followed`, and `gate_match`.
  - **Gap:** there is no field recording the validator kind/rule (`unsafe_answer`/`energized_warning`/`isolation_advisory`/`unsupported_specificity`) or the semantic-check verdict. `grep -i 'validation|unsafe|isolation|energized'` on the file @ 2c3f67181 returns only the `AnswerGateDecision` type line. Those signals go to OTel span attributes and console instead (see the parent's route section).

### 5.7 Citation / claim verification (all observe-only or shadow in the Hub)
- `withSupportingQuotes`: `mira-hub/src/capabilities/supporting-quote.ts @ 2c3f67181` (680 lines). It assigns each numeric value in the answer to its nearest `[n]` marker and picks the quote window holding that value (number plus unit). It is deterministic and makes no model call (`:1-14`). It is **live** in the route at `route.ts:4792 @ 2c3f67181`, but it only changes which quote is persisted. It never blocks.
- `claim-verifier.ts` (213 lines) is a typed claim-to-source verifier. It covers bit numbers, PLC addresses, parameter and fault codes, pins, hex ids, and closed-unit quantities, and it requires each value to sit NEAR the question's identifiers on the cited page (`:1-20`).
- `claim-verifier-shadow.ts` (79 lines) is off unless `NOTEBOOK_CLAIM_VERIFIER=shadow` (`:20`). It runs after the safety and answer gates and adds trace attributes only. It is called at `route.ts:4930-4943 @ 2c3f67181`, only when `docGrounded && served && !refused && !outputRejected`.
- JEV (Jev evidence-sufficiency judge, external API `JEV_API_KEY`):
  - `judgeEvidenceSufficiencyShadow` is called at `route.ts:3855`.
  - `evaluateTurnDecision` is called at `:1493`.
  - `isWeakEvidence` badge at `:5020-5035`.
  - Flags are `MIRA_JEV_SHADOW=1`, `MIRA_JEV_DECISION=1`, and `MIRA_JEV_WEAK_EVIDENCE_BADGE=1` (`mira-hub/src/capabilities/observability/config.ts:48,57,68 @ 2c3f67181`). All default off. JEV never gates.
- `ungroundedUnitClaim` (anomalies.ts) is a boolean recorded into the packet (`route.ts:4831`).
- Python side: `mira-bots/shared/citation_compliance.py @ a051e322b`. It is a post-LLM check (`:1-20`) covering presence of a `[Source:…]` tag (observational), cited vendor vs resolved manufacturer conflict, and unsupported attribution. The entry point is `check_citation_compliance` (`:584`), and an H4 enforcer sits around `:732-841`. It is used by `answer_qc.py:60`.
- vendor_fallback handling in the notebook route @ 2c3f67181:
  - `oemScope` is computed at `:2543-2550`.
  - A `relatedManualWarning` banner is emitted at `:3704-3709`.
  - A `vendorFallbackDirective` prompt clause at `:3710-3715` tells the model not to present sibling-model values as this model's spec.
  - PR #4929 @ 983b93694 adds a rule (commit `1f7051e55`) that a sibling-model passage never supports a DC-bus discharge wait. That is the only place a provenance scope feeds the safety validator.

### 5.8 Summary of evidence infra that can support "equipment-specific evidence verification"
- Already present per chunk: manufacturer/model strings, `retrievalScope=vendor_fallback`, `verified` (shared corpus), and notebook-confirmed doc admission (`match_state`), plus the page, pageLabel, and quote windows.
- Already present per turn: `EvidenceCitation` with quote, `MachineEvidenceEntry`, and identity state (unknown/candidate/user_confirmed/verified in the TEP).
- Typed claim binding exists (`claim-verifier`) but is shadow-only and not safety-aware.
- The drive-pack `bench_verified`/`manual_cited` tiers and `EvidenceItem.trust`/`evidence_state` are the richest trust vocabularies. Neither reaches the notebook route.
- There is no persisted record of which safety rule fired in the TEP.

## 6. Safety docs

No ADR has "safety" in its file name (`git ls-tree docs/adr | grep -i safety` is empty @ a051e322b). Relevant docs @ a051e322b:

| Doc | Lines | What it is |
|---|---|---|
| `docs/specs/safety-coverage-contract.md` | 123 | **The governing spec** (ACTIVE since 2026-09-14; owner decisions #3787 two-lane, #3793 semantic layer). Three concerns (`:11-20`). Enforcement surfaces (`:28-32`): route output buffer → deterministic floor (`answer-validation.ts`) → semantic layer (`answer-safety-check.ts`) → release; input `matchSafetyStop`; Python `classify_intent`/`SAFETY_KEYWORDS`. Hazard-class table (`:49-62`): electrical, pressure, motion, lifting, confined, fire-gas, with height/thermal/chemical "semantic layer only today". Semantic failure modes fail closed to an "unverified fallback" (`:80-85`). Evaluation contract requires an unseen holdout and per-class, per-lane reporting (`:98-110`). |
| `.claude/skills/mira-industrial-safety/SKILL.md` | 196 | Draft v0.1.0 (2026-05-19). Owns `guardrails.py` SAFETY_KEYWORDS and STOP+escalate. Cites OSHA 1910.147/.146/.252/.119 and NFPA 70E. Rules SAFE-001..031: phrase-level triggers, IMMEDIATE subset hard-stops regardless of framing, never advise "while running/live/energized/pressurized" work, STOP names the standard, educational carve-out never covers imperatives. Python-bot oriented; does not mention the Hub notebook validators. |
| `.claude/agents/safety-reviewer.md` | 18 | Read-only review agent for diagnostic/LOTO/motion changes. "MIRA is ADVISORY — never a validated safety function." |
| `docs/proofs/2026-09-23-3973-energized-procedure-enforcement.md` | 379 | #3973 proof: detected hazard constrains the answer; twelve review repair rounds on the energized-procedure heuristic. States "this heuristic is not proof of arbitrary-answer safety". |
| `docs/proofs/2026-09-29-4122-step-safety-ab/` | README 70 + JSON | Blind A/B of the #4122 step-safety prompt rule on Groq gpt-oss-120b (questions.json, judgments, strict rubric). |
| `docs/plans/2026-08-31-notebook-asset-node-chat-safety-parity-scoping.md` | 348 | Investigation of safety-persistence parity between Asset/Node chat and Notebook chat. |
| `docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md` | 437 | DRAFT PRD: answer integrity and validation engine (requirements only). |
| `docs/specs/mira-answer-quality-standard.md` | 136 | Answer quality standard v1.0 (2026-05-18). |
| `docs/drive-commander/drive-pack-trust-doctrine.md` | 90 | Drive-pack trust doctrine (bench_verified vs manual_cited). |
| `docs/adr/0026-machine-pack-and-provenance-unification.md` | 156 | Draft: Machine Pack evidence classes and provenance/trust unification (includes a safety review). |
| `docs/adr/0029-materialized-evidence.md` | 77 | Accepted: materialized evidence / recall-first. |
| `docs/adr/0037-evidence-provenance-and-observation-proof.md` | 138 | Proposed (awaiting Mike): evidence provenance and observation proof. |
| `docs/architecture/grounding-verification-master-plan.md` | 353 | Planning reference for grounding-verification seams across runtimes. |
| `docs/competitors/fixes/03-574-safety-keywords.md` | 251 | #574 fix: NFKC-normalize safety keywords and word-boundary match. |
| `docs/competitors/issue-bodies/20-mira-safety-guard.md` | 13 | Idea: open-source the SAFETY_KEYWORDS guard. |
| `docs/discovery/machine-pack/inventories/07-diagnostics-safety-eval.md` | 104 | Discovery inventory of diagnosis, safety and eval components. |
| `docs/testing/campaign-reports/2026-08-08-c4safety.md` | 19 | Campaign c4safety: 26/26 conversations passed. |
| `docs/TEXTBOOK_SOURCES.md` | 259 | Planning: OSHA 29 CFR 1910 and NFPA 70E excerpts as ingest candidates (`:165,173,246,254`). Not ingested as far as this doc says. |

- OSHA/NFPA/1910.147/LOTO mentions: `git grep -l -i -E 'osha|nfpa ?70e|1910\.147|\bLOTO\b' a051e322b -- docs` gives **24 files**. Most are competitor or planning docs. The substantive ones are the #3973 proof (NFPA 70E qualified-person routing, `:91,96`), TEXTBOOK_SOURCES, the step-safety rubrics, and `docs/zta/technician-unified/generated/safety-boundary.jsonl`.
- Other safety-named fixtures seen in passing (eval assets are owned by the parent's section 4):
  - `tests/eval/adversarial/safety_gate_regression_2026_09_14.jsonl`
  - `tests/conversation_suite/fixtures/cases/safety/01-05*.yaml`
  - `tests/eval/fixtures/06_safety_escalation.yaml` and `67_educational_not_safety_stopped.yaml`
  - `tests/regime1_telethon/uat_scripts/t10/t11_safety_*.yaml`
  - `mira-bots/artifacts/v2/evidence/safety_*_11{6..20}_*.json`
  - `evals/results/f06922ac6*/…/safety-01..10.json`
  - `docs/zta/technician-dataset-v1/holdout-eval/judge3_safety.json`

### 6.x Not verified (sections 5–6)
- I did not read `tools/seeds/backfill_verified_corpus.sql` in full. The shell quoting failed on the first attempt, and I only know the file exists and its first line's intent.
- How many `knowledge_entries` rows have `verified=true` in prod: this needs DB access.
- The bodies of ADR-0026, ADR-0037 and the answer-integrity PRD were not read beyond their headers.
- `citation_compliance.py` enforcer semantics (`:732-841`) were only skimmed.

---

## 7. Consolidated: not verified / caveats
- Nothing was executed (no vitest/pytest runs); all test counts are static `it(`/`test(`/`def test_` counts and are
  lower bounds for table-driven files (fuzz ≈340 generated cases is an estimate).
- Post-merge behavior of t3 + t4 together (both modify `answer-validation.ts` and `safety-classifier.ts`) — not predicted.
- Production values of env flags (`NOTEBOOK_ANSWER_GATE`, `NOTEBOOK_SEMANTIC_CHECK`, `NOTEBOOK_ENERGIZED_HARD_STOP`,
  `MIRA_ENFORCE_APPROVED_RETRIEVAL`, `MIRA_JEV_*`, `NOTEBOOK_CLAIM_VERIFIER`) — only code defaults read; the
  `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`-on-prod statement is from a code comment (`route.ts:3511`).
- Regex counts are heuristic (comment-stripped literals + `new RegExp`), composed `*_SRC` fragments not deduplicated.
- IMIB (#4793) and Stranger Walk (#4461) content was read from their open PR branches, not main.
- Fork-produced sections 3–6 were spot-checked (≈8 citations re-read with `git show`), not exhaustively re-verified.
- Items the forks could not verify are listed in §4.x and §6.x.
