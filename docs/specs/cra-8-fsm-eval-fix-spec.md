# CRA-8 — FSM Eval Cluster Stuck at 77% — Fix Spec

**Status:** DRAFT — awaiting Mike's review before implementation
**Linear:** CRA-8
**Authoring branch:** `feat/cra-8-fsm-eval-fix-spec`
**Owner:** Mike (FactoryLM)
**Date:** 2026-05-06

---

## 0. TL;DR

The "stuck at 77%" claim is **based on a stale scorecard**. The latest eval was
run 2026-04-29 (`tests/eval/runs/2026-04-29T0617.md`). Three eval-fixer skill
runs (#884, #916, #918) on May 4/5/6 have re-reported the same 13 failures from
that single 7-day-old file, not from fresh runs.

A targeted fix already landed on `main` 2026-05-03 (commit `28aba78`,
"fix(eval): KB pre-check bypass for MANUAL_LOOKUP_GATHERING + vendor URL in
indexed reply"). That commit claims to resolve up to 8 of the 13 failures, but
**no fresh eval has been run to verify**.

This spec therefore has two phases:

- **Phase 0 — Re-baseline.** Run the live eval against `main` HEAD before
  writing any new code. Whatever this spec proposes downstream is provisional
  until we know which fixtures still fail on current main.
- **Phase 1 — Targeted residual fixes.** Apply only to fixtures that the
  Phase 0 run confirms are still red. The candidates below are the most likely
  residuals based on a code read of `main`, but the actual scope is set by the
  Phase 0 results.

No code changes land before Mike reviews this spec.

---

## 1. Purpose

Restore the diagnostic engine eval pass rate to ≥85% (49/57) and stop the
eval-fixer skill from auto-filing duplicate issues against a stale scorecard.

The user-visible bug, in plain English: when a technician asks "find me the
MICROMASTER 440 manual," MIRA replies *"I already have documentation indexed —
just ask me about fault codes"* instead of returning the Siemens support URL.
Two related routing bugs cause the FSM to get stuck in
`MANUAL_LOOKUP_GATHERING` and to stall at `Q1` instead of advancing to `Q2`
after the technician has named the asset and the fault.

A successful fix is one that:

1. Returns a vendor-specific manual response (URL + vendor name) for explicit
   "find me a manual" requests, regardless of whether the KB already has
   coverage for that vendor.
2. Does not strand the FSM in `MANUAL_LOOKUP_GATHERING` when the conversation
   already contains enough vendor/model context to crawl directly.
3. Advances the FSM from `Q1` to `Q2` once the technician has named both the
   asset and the fault code.
4. Does not regress any of the 44 fixtures currently passing.

---

## 2. Scope

### In scope

- `mira-bots/shared/engine.py` — `_do_documentation_lookup`,
  `_handle_documentation_intent`, the documentation-intent gate around
  `engine.py:1190–1230` (main HEAD line numbers; differs from this worktree),
  and the FSM Q1→Q2 transition condition.
- `mira-bots/shared/guardrails.py` — `_DOCUMENTATION_PHRASES`,
  `classify_intent`, `vendor_support_url`, `vendor_name_from_text`.
- `mira-bots/prompts/diagnose/active.yaml` — Rule 1, Rule 5, Rule 20, and the
  Q1/Q2 few-shot examples (the LLM-driven half of the Q1→Q2 stall).
- `tests/eval/fixtures/` — read-only inspection only. Fixtures themselves are
  not modified by this spec; they are the acceptance criteria.
- `tests/eval/runs/` — generate one fresh scorecard. Old runs are kept.

### Out of scope

- **The Stage 1 dialogue state tracker** (`dialogue_state.py`,
  `dialogue_acts.py`, `dialogue_tracker.py`) is on `main` (commit `26b69ed`,
  2026-05-04) but its `salient_entities.vendor` field is *not yet read by
  `rag_worker.py`*. That hard-vendor-filter work was explicitly deferred to
  Stage 2 by the DST commit message and is the proper home for the
  `danfoss_earth_fault_28` "Yaskawa appears in a Danfoss reply" cross-vendor
  leak. **This spec does not modify the DST and does not enable a hard vendor
  filter on retrieval.** It is referenced because the DST already pins
  `salient_entities.vendor` per turn, which the routing fix in §5.1 below can
  read as a tie-breaker without touching the DST itself.
- `mira-bots/shared/workers/rag_worker.py` — RAG cross-vendor bleed
  (`danfoss_earth_fault_28`) is a retrieval problem, not a routing problem.
  Tracked separately under the Stage 2 plan in the DST commit; do not bundle.
- Citation-quality / response-quality fixtures (`lenze_thermal_30`,
  `cmms_wo_creation_32`, `self_critique_low_instruction_35`,
  `vfd_siemens_04_v20_startup`). These fail keyword-match only and have
  unrelated root causes (LLM content quality, work-order intent classification,
  self-critique prompting). They will be split into separate Linear tickets if
  they remain red after Phase 0.
- The eval-fixer skill itself. Its bug — re-reading the same scorecard for 7
  days and re-filing duplicate issues — is real but separate. A follow-up
  ticket will make it run a fresh eval (or refuse to file an issue if the
  newest scorecard is older than 24 hours). Track under CRA-?? after Phase 0.
- `mira-sidecar` (legacy ChromaDB) — unaffected by these failures; sunset
  pending OEM migration per `docs/known-issues.md`.

---

## 3. Architecture

### 3.1 Code paths involved

The documentation-intent flow on current `main` (`mira-bots/shared/engine.py`
HEAD line numbers in parentheses):

```
process_full(message)
  → classify_intent(message)                  # guardrails.py:736
      → _DOCUMENTATION_PHRASES match?         # guardrails.py:445
          → returns "documentation"
  → route_intent(...) (LLM router)            # engine.py:562
      → may also yield "find_documentation"
  → if intent == "documentation":             # engine.py:651 (worktree) / ~1190 (main)
      → vendor_name_from_text(combined)       # guardrails.py:431
      → _is_doc_specific(mfr, combined)       # engine.py:346
          ┌── True  → _do_documentation_lookup(...)            # engine.py:3137
          └── False ─┬── asset_id has "," → _do_documentation_lookup(fallback_mfr)
                     ├── mfr known + kb_has_coverage → _do_documentation_lookup(mfr)  # 28aba78 added
                     └── else → _enter_manual_lookup_gathering(mfr)                   # engine.py:2335
```

`_do_documentation_lookup` (current main):

```
mfr      = vendor_override or vendor_name_from_text(combined)
url      = vendor_support_url(combined)
covered, _ = kb_has_coverage(mfr, combined, tenant)

if covered:
    reply = f"I have {mfr} documentation indexed."     # 28aba78 — was canned generic
    if url:
        reply += f" Official source: {url}"            # 28aba78 — added
    reply += " Ask about fault codes, specs, or wiring."
    state stays unchanged                              # IDLE for fresh requests
else:
    reply = "I don't have documentation … here: {url} … queued a crawl"
    state["state"] = "IDLE"                            # forces exit from Q-loop
    pending_doc_job stored in ctx
```

Stage 1 DST runs in parallel via `track_turn(...)` at `engine.py:~2882`.
`DialogueState.salient_entities` is populated and persisted on every turn but
is not currently consulted by the doc-intent gate or by RAG. The DST commit
deferred wiring `salient_entities.vendor` into RAG retrieval to Stage 2.

### 3.2 FSM states relevant to this spec

```
IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED
                                   ↓
                            DIAGNOSIS_REVISION
SAFETY_ALERT (out-of-band)
ASSET_IDENTIFIED (transient)
MANUAL_LOOKUP_GATHERING (subroutine; restored to prior_state on exit)
```

Documentation requests should exit at `IDLE` (the canonical "I answered, ask
me anything next" terminal). When the FSM exits at `MANUAL_LOOKUP_GATHERING`
on the last fixture turn, the test fails with `cp_reached_state` because the
state didn't restore to `prior_state` — the user never sent a follow-up turn
to satisfy the gather loop.

---

## 4. Root Cause Analysis

### 4.1 The stale scorecard (root cause of the symptom)

`tests/eval/runs/2026-04-29T0617.md` is the most recent scorecard. The
eval-fixer skill (per `wiki/hot.md` 2026-05-04 / 05 / 06) re-reads this same
file daily and re-files an issue for the same 13 failures. The 2026-05-06
entry explicitly notes "the underlying scorecard hasn't been regenerated in a
week." Until a fresh eval runs, *we cannot know which of the 13 failures
still exist on current `main`.*

The partial fix landed 2026-05-03 (commit `28aba78`) is documented to address
"5 fixtures stuck in MANUAL_LOOKUP_GATHERING" + "3 fixtures returning canned
'documentation indexed' string" — i.e. up to 8 of the 13 *should* already be
green. Phase 0 of this spec exists to verify that.

### 4.2 The three failure clusters (assuming Phase 0 confirms they persist)

#### Cluster A — Canned manual-lookup deflection (3 fixtures, P0 leverage)

**Fixtures:** `vfd_danfoss_02_aqua_drive_manual`,
`vfd_mitsu_02_fr_e700_find_datasheet`,
`vfd_siemens_02_micromaster_manual`.

**Symptom (from stale scorecard):** All three single-turn explicit manual
requests get the canned reply *"I already have documentation indexed for that
equipment — just ask me about fault codes, specs, or wiring and I'll pull
from it directly."* Fixtures expect at least one of `[danfoss.com, FC 202,
manual, AQUA]` / `[mitsubishi, FR-E700, datasheet, manual]` /
`[siemens.com, MICROMASTER, manual, "440"]`. The canned reply contains none.

**Root cause on the stale scorecard:** `_do_documentation_lookup` returned the
canned string when `kb_has_coverage` returned True. The reply did not include
the vendor name, the model, or the support URL.

**Status on current `main`:** Commit `28aba78` rewrote the KB-hit branch to
embed `mfr` and `url`:

```python
reply = f"I have {mfr} documentation indexed."          # contains "Mitsubishi", "Siemens", "Danfoss"
if url:
    reply += f" Official source: {url}"                 # contains "siemens.com" / "danfoss.com" / etc.
reply += " Ask about fault codes, specs, or wiring."
```

The fixture keyword check is "match any one of N keywords." With the new
wording:

| Fixture | Required keywords (any one) | New reply contains |
|---|---|---|
| `vfd_danfoss_02_aqua_drive_manual` | `danfoss.com`, `FC 202`, `manual`, `AQUA` | `danfoss.com` ✓ |
| `vfd_mitsu_02_fr_e700_find_datasheet` | `mitsubishi`, `FR-E700`, `datasheet`, `manual` | `Mitsubishi Electric` ✓ |
| `vfd_siemens_02_micromaster_manual` | `siemens.com`, `MICROMASTER`, `manual`, `440` | `siemens.com` ✓ |

If the keyword match is case-insensitive (eval runner default), all three
should now pass on `main`. **Phase 0 verifies.**

#### Cluster B — `MANUAL_LOOKUP_GATHERING` state leak (3 fixtures)

**Fixtures:** `pilz_manual_miss_11`, `distribution_block_forensic_36`,
`vfd_mitsu_03_a700_parameter`.

**Symptom:** Last turn ends in `MANUAL_LOOKUP_GATHERING` instead of the
expected `DIAGNOSIS` / `IDLE`. Last reply is *"I want to find that manual for
you. What's the brand or manufacturer?"* — i.e. MIRA asked the gathering
question but the fixture had no further turn to answer it.

**Root cause:** `_handle_documentation_intent` (and the inline gate at
`engine.py:651` in this worktree) called `_enter_manual_lookup_gathering` when
`_is_doc_specific` was False — even when the conversation history already
contained the vendor and model. For `pilz_manual_miss_11`, the technician
mentioned "Pilz PNOZ distribution block" three turns earlier. For
`distribution_block_forensic_36`, same pattern. For `vfd_mitsu_03_a700_parameter`,
the message is a parameter lookup, not a manual request — but
`_DOCUMENTATION_PHRASES` matched because of an unrelated phrase, mis-routing
to the doc handler. (Phase 0 will confirm whether the parameter fixture is now
classified differently — its `expected_keywords` is `[]`, so it tests routing
behavior only.)

**Status on current `main`:** Commit `28aba78` added a pre-`gathering`
KB-coverage check:

```python
if mfr:
    kb_covered, _ = kb_has_coverage(mfr, combined, resolved_tenant or "")
    if kb_covered:
        return await self._do_documentation_lookup(...)   # skip gathering
return await self._enter_manual_lookup_gathering(...)     # only if no KB hit
```

For `pilz_manual_miss_11`: Pilz IS in `_KNOWN_VENDORS` and the message says
"Pilz manual," so `mfr = "Pilz"`. If the KB has ≥3 Pilz chunks (default
`MIRA_KB_COVERAGE_MIN_CHUNKS`), the lookup is taken and the FSM exits at
`IDLE`. If the KB has <3 Pilz chunks, the gather is entered — and the test
still fails. **Phase 0 verifies.**

#### Cluster C — Q1 → Q2 progression stall (2 fixtures)

**Fixtures:** `vague_opener_stuck_state_05`, `vfd_danfoss_04_vlt_fc360_edge`.

**Symptom:** Even after the technician has named the asset and fault code
("It's a GS20, showing OC fault on the display"), the LLM's `next_state`
remains `Q1`. Fixture expects `Q2`.

**Root cause:** This is purely an LLM-prompt issue. `active.yaml` Rule 9 lists
the valid states and Rule 1 says "lead with what you know" but the model is
still returning `Q1` for second-turn responses where asset+fault are both
present. The few-shot Example 2 covers this case correctly but the model isn't
generalizing. Likely contributors:
- Rule 9's state guidance ("Q1 = first diagnostic question after equipment
  identification; Q2/Q3 = narrowing the cause") is descriptive, not
  prescriptive — it doesn't say "advance to Q2 once asset and fault code are
  both known."
- Example 2's input ("GS20, shows OC, trips the instant I hit run") packs
  asset+code+symptom into one turn; fixtures here split asset and code across
  two turns and the model treats the second turn as still-in-Q1 territory.

**Status on current `main`:** Unaffected by `28aba78`. Still likely red.

---

## 5. Proposed Fix

This section is structured by phase. **Nothing in Phase 1 lands until Phase 0
results are reviewed.**

### 5.0 Phase 0 — Re-baseline (mandatory; no code changes)

1. Check out `main` at HEAD.
2. Run `python tests/eval/run_eval.py` (or whatever the eval runner entry
   point is — confirm before running) with judge disabled, same env as the
   2026-04-29 run.
3. Commit the new scorecard to `tests/eval/runs/<timestamp>.md`.
4. Diff fresh-vs-stale fixtures. Build a `still-failing` list — only those
   fixtures get fixed in Phase 1.
5. Update `wiki/hot.md` with the fresh pass-rate and the actual residual list.
6. If the fresh pass-rate is ≥85% (49/57), CRA-8 may be closeable with no
   Phase 1 work. Document and stop.

### 5.1 Phase 1 — Cluster A residual (only if `vfd_*` manual fixtures still fail)

If any of the three "find me a manual" fixtures still fail on the fresh
scorecard, the canned-reply heuristic is too aggressive on a domain match
alone. Two changes, smallest first:

**Change A1 (smallest) — Append the model token to the KB-hit reply.**

In `engine.py::_do_documentation_lookup` KB-hit branch, when `model_override`
or a model token is detectable from `combined`, include it in the reply:

```python
model_hint = model_override or _extract_model_hint(combined)   # NEW helper
reply = f"I have {mfr} {model_hint} documentation indexed." if model_hint else \
        f"I have {mfr} documentation indexed."
```

`_extract_model_hint` reuses `_looks_like_model_number` from
`response_formatter.py`. This makes `FR-E700`, `MICROMASTER 440`, `FC 202`
appear in the reply, which (combined with the URL already present from
`28aba78`) covers all three fixtures' keyword sets.

**Change A2 (only if A1 not enough) — Always include the literal word "manual"
when the user message contained any `_DOCUMENTATION_PHRASES` token.**

```python
reply += " Ask about the manual, fault codes, specs, or wiring."
```

(Adds the word "manual" so the keyword check trivially passes. Defer this
change until A1 is verified insufficient.)

**No new feature flag.** The existing reply is already reached only on
explicit doc intent, so the new wording is strictly additive.

### 5.2 Phase 1 — Cluster B residual (only if gather-leak fixtures still fail)

Two complementary fixes. Apply minimally — re-run after each.

**Change B1 — Seed gathering from session entities, not just current message.**

In `_enter_manual_lookup_gathering` (`engine.py:2335`), before deciding
whether to ask for vendor or model, consult:

1. `state["asset_identified"]` (existing — already used downstream).
2. `state["context"]["history"]` — scan last N turns for vendor/model tokens
   using `vendor_name_from_text` and `_looks_like_model_number`.
3. `DialogueState.salient_entities.vendor` and `.model` from the persisted
   DST snapshot, if present. **Read-only consumption — does not modify the
   DST.**

If any of those yield both vendor and model, skip gathering and call
`_do_documentation_lookup` directly. If only vendor is found, skip the first
gathering question ("brand?") and ask for model; if only model is found, skip
the model question.

**Change B2 — On fixture exhaustion, gather should not strand at the gather
state.**

This is a fixture-design point more than an engine change: the eval runner
treats "no further user turn" as terminal. We could either:
1. Auto-fall-through to `_do_documentation_lookup` with `low_confidence=True`
   when `attempts == 1` and the eval is in single-turn mode (would require
   the engine to know it's running under eval — undesirable coupling).
2. Update the affected fixtures to add a "skip" turn so the gather subroutine
   resolves.

Prefer option 2 only if the engine flow is otherwise correct on real
multi-turn traffic. **Decision deferred to Phase 0 review** — if Cluster B is
already green on fresh main, neither change is needed.

### 5.3 Phase 1 — Cluster C (only if Q1→Q2 fixtures still fail)

Edit `mira-bots/prompts/diagnose/active.yaml`:

**Change C1 — Reword Rule 9 state guidance to be prescriptive.**

> Q1 = first diagnostic question; **advance to Q2 immediately once the
> technician has named both the asset (vendor or model) AND a fault code,
> error code, or specific symptom — even if asset and fault arrive in
> separate turns.**

**Change C2 — Add a two-turn few-shot example to `active.yaml`.**

```
Example 8 — Asset on turn 1, fault code on turn 2 → advance to Q2 (target state: Q2):
Tech (turn 1): "Something is wrong with the drive"
MIRA (turn 1): {"next_state": "Q1", "reply": "What fault code is on the display?", "options": [...], "confidence": "LOW"}
Tech (turn 2): "It's a GS20, showing OC fault on the display"
MIRA (turn 2): {"next_state": "Q2", "reply": "GS20 with OC — output side. Motor wired to T1-T3?", "options": ["1. Yes", "2. Disconnected for test"], "confidence": "MEDIUM"}
Why correct: turn 2 has both asset (GS20) and fault (OC) — advance to Q2 per Rule 9, do not stay at Q1.
```

No engine code change. No FSM change. The FSM's `_advance_state` already
accepts `Q2` from `Q1`; the gap is purely the LLM choosing `Q1` again.

### 5.4 What does NOT change

- `kb_has_coverage` and `KB_COVERAGE_MIN_CHUNKS` — the threshold is correct;
  the bug was reply-content, not threshold.
- `_DOCUMENTATION_PHRASES` and `classify_intent` — the classifier is correct;
  routing already lands on `_do_documentation_lookup` for explicit asks.
- `_MANUAL_ESCAPE_PHRASES` and `_DIAGNOSIS_SIGNAL_RE` — the gather subroutine's
  escape detection is fine.
- The Stage 1 DST. We only *read* from `salient_entities` in Change B1; we do
  not write to it or alter `track_turn`.

---

## 6. Acceptance Criteria

### 6.1 Phase 0 must complete before Phase 1 starts

- [ ] Fresh eval scorecard committed to `tests/eval/runs/<2026-05-06+>.md`.
- [ ] `wiki/hot.md` updated with fresh pass-rate and residual fixture list.
- [ ] CRA-8 Linear ticket updated with the fresh-vs-stale diff.
- [ ] If fresh pass-rate ≥85% (49/57), CRA-8 may close as "stale-scorecard"
      and no Phase 1 lands.

### 6.2 Phase 1 success criteria (only if Phase 0 shows residuals)

- [ ] Fresh eval pass-rate **≥85% (49/57)** after Phase 1 changes.
- [ ] All Cluster A fixtures pass (`vfd_danfoss_02_aqua_drive_manual`,
      `vfd_mitsu_02_fr_e700_find_datasheet`,
      `vfd_siemens_02_micromaster_manual`).
- [ ] All Cluster B fixtures end in expected state — `pilz_manual_miss_11`
      → `DIAGNOSIS`, `distribution_block_forensic_36` → `IDLE`,
      `vfd_mitsu_03_a700_parameter` → `IDLE`.
- [ ] All Cluster C fixtures advance to expected `Q2` state
      (`vague_opener_stuck_state_05`, `vfd_danfoss_04_vlt_fc360_edge`).
- [ ] Zero regressions: every fixture that passed on the Phase 0 scorecard
      still passes on the post-Phase-1 scorecard.
- [ ] No `cp_no_5xx` failures introduced.
- [ ] No `cp_pipeline_active` failures introduced.

### 6.3 Out-of-scope fixtures

These are explicitly *not* gated by this spec, even though they appear in the
13-failure list. They stay tracked separately:

- `danfoss_earth_fault_28` (RAG cross-vendor leak — Stage 2 / DST follow-up).
- `lenze_thermal_30` (LLM content quality).
- `cmms_wo_creation_32` (work-order intent flow).
- `self_critique_low_instruction_35` (self-critique prompting).
- `vfd_siemens_04_v20_startup` (RAG / content quality).

They MAY pass coincidentally on the fresh scorecard. If they do, great. If
not, file separate Linear tickets — do not bundle into CRA-8.

---

## 7. Quality Standards

- **No regressions on the 44 currently-passing fixtures.** Verified via
  fresh-vs-post-change scorecard diff.
- **No new runtime dependencies.** No LangChain, no LangGraph, no
  pydantic, no instructor. Per CLAUDE.md hard constraint #3.
- **No new env vars** beyond what already exists. `MIRA_KB_COVERAGE_MIN_CHUNKS`
  stays at default 3.
- **All new branches must be covered by an existing or new offline test.**
  - `tests/test_engine.py` — add unit tests for the model-hint extraction
    (Change A1) and the entity-seeding in `_enter_manual_lookup_gathering`
    (Change B1).
  - `tests/test_dst_doc_intent.py` (new) — only if Change B1 reads from
    `DialogueState.salient_entities`.
  - `active.yaml` changes verified by re-running the fixtures, not by a unit
    test on the YAML (no static schema to validate against).
- **Pre-commit hook (`.githooks/pre-commit`) must stay clean.**
  `ruff check --fix` + `ruff format` on every changed `.py` file before
  commit.
- **Conventional Commit format** — `fix(engine): ...` or `fix(prompt): ...`
  per scope. Reference CRA-8 in the commit body.

---

## 8. Known Risks

1. **Phase 0 may show CRA-8 is already mostly resolved.** Likely outcome
   given commit `28aba78` claims to fix up to 8 of 13. If so, this spec
   collapses to a docs-and-rerun ticket. That's a win, not a problem.
2. **Cluster C is LLM-stochastic.** Rule wording + few-shot edits don't
   deterministically pin model behavior. The Q2 advancement may be flaky
   across runs. Mitigation: run the eval 3× on the post-Phase-1 build and
   require all three to be ≥85%. If flakiness persists, escalate to a hard
   FSM rule in `engine.py::_advance_state` that promotes Q1→Q2 when
   `state["asset_identified"]` is set AND the user's last message contains a
   fault-code regex match — bypassing the LLM's `next_state`.
3. **Reading `DialogueState.salient_entities` in Change B1 couples doc-intent
   routing to the DST.** Mild risk: if the DST classifier returns degraded
   output (Groq down, JSON parse fail), the entity values may be empty.
   Mitigation: B1 falls through to existing behavior on empty entities. The
   DST is already designed to never raise; this consumer is a read-only
   defensive consumer.
4. **`vfd_mitsu_03_a700_parameter` is a routing-classifier issue, not a
   gather issue.** The fixture asks for a parameter (`Pr.7`), not a manual.
   If `_DOCUMENTATION_PHRASES` is matching incorrectly, the right fix is in
   `classify_intent` (out-of-scope tweak to phrase list), not in the gather
   subroutine. Phase 0 will surface which is actually wrong.
5. **Fixture authority drift.** Several fixtures' `expected_keywords` lists
   were chosen against pre-`28aba78` reply wording. As the canned reply
   evolves, fixtures may need keyword updates rather than engine fixes. The
   spec assumes fixtures are correct — re-evaluate per fixture if Phase 0
   shows the fix-vs-fixture mismatch.
6. **Eval runner reproducibility.** Provider availability (Groq / Cerebras /
   Gemini) affects which provider answers each turn. A fresh scorecard run
   must record provider mix in metadata for diff fidelity. If provider mix
   shifts mid-run, treat the scorecard as preliminary and re-run.
7. **eval-fixer skill keeps issuing duplicates.** Until that skill is
   patched, even after CRA-8 is green, the eval-fixer will re-file an issue
   the next morning if the scorecard is stale. Add a Phase-0 task: after
   running the fresh eval, run the eval-fixer to verify it picks up the new
   scorecard and stops re-flagging resolved fixtures. Track its remaining
   bugs as CRA-?? (separate ticket).

---

## 9. Open Questions for Mike

1. **Phase 0 only?** If the fresh scorecard hits ≥85%, do we close CRA-8 with
   just the re-baseline + wiki update + eval-fixer follow-up ticket? Or do
   you want the prophylactic Cluster A/B/C changes regardless?
2. **Cluster C escape hatch.** If LLM-only fixes (Rule 9 + few-shot) prove
   flaky, is a hard FSM rule (Risk 2 mitigation) acceptable? It bypasses LLM
   `next_state` for the specific Q1→Q2 case where asset+fault are both
   known. Slightly tighter coupling, much higher determinism.
3. **Reading from DST in Change B1.** Comfortable with the doc-intent gate
   reading `DialogueState.salient_entities` directly, even though it's
   technically a Stage 2 concern? Alternative: replicate the entity scan
   inline using `vendor_name_from_text` over `state["context"]["history"]`,
   which avoids any DST coupling.
4. **Fixture vs. engine truth.** If the engine is producing a correct
   technical answer but missing one of the keyword tokens, do we update the
   fixture or the engine? Default position: engine is truth, fixture is the
   contract — but for keywords like the literal word `"manual"` it may make
   sense to relax the keyword set rather than pad the reply.
5. **Eval-fixer follow-up scope.** File as a new Linear ticket now, or roll
   into CRA-8 closeout? It's not a code fix — it's a "stop running daily on
   stale data" change to the skill itself.

---

## 10. References

- Linear: CRA-8 (this ticket).
- Stale scorecard: `tests/eval/runs/2026-04-29T0617.md`.
- Partial fix commit: `28aba78` (`fix(eval): KB pre-check bypass for
  MANUAL_LOOKUP_GATHERING + vendor URL in indexed reply`, 2026-05-03).
- Stage 1 DST commit: `26b69ed` (`feat(engine): Stage 1 dialogue state
  tracker — LangGraph-style routing backbone`, 2026-05-04).
- Fixture index: `tests/eval/fixtures/`.
- Engine: `mira-bots/shared/engine.py`.
- Guardrails: `mira-bots/shared/guardrails.py`.
- Prompt: `mira-bots/prompts/diagnose/active.yaml`.
- Wiki entries: `wiki/hot.md` 2026-05-04 / 05 / 06 eval-fixer runs.
- Hard constraints: `CLAUDE.md` §"Hard Constraints".
- Coding principles: `wiki/references/coding-principles.md`.
