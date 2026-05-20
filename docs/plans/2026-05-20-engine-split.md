# Plan: Split `mira-bots/shared/engine.py` god-class

**Status:** Draft (planning only — no code changes in this PR)
**Created:** 2026-05-20
**Tracks:** #1464
**Owner:** TBD
**Effort:** ~1 week (5 working days, single contributor)

---

## 1. Why now

`mira-bots/shared/engine.py` is 4,626 lines, ~62 methods, all rooted in one `Supervisor` class. It is the load-bearing surface for:

- Telegram + Slack adapter entry points (via `Supervisor.process()` / `process_full()` / `process_multi_photo()`)
- mira-pipeline's OpenAI-compat shim (the production VPS chat path)
- The 5-regime test suite + golden cases (`tests/golden_*.csv`)
- The GS11 grounding regression suite (post-2026-05-18 embed-sidecar incident)

Symptoms that this matters now:

- **Onboarding cost.** New contributors take days to map the file; `mira-trace-technician-flow` exists primarily because engine.py is too dense to read straight.
- **Test surface drift.** Coverage focuses on `process()` outcomes; internal-method tests are rare because the surface is too tangled to mock cleanly.
- **Merge friction.** PRs touching engine.py routinely collide. The 2026-04-25 overnight run produced 14 branches; many were engine.py-adjacent.
- **State-transition reasoning is hard.** The FSM is `fsm.py` but the *transitions* are scattered across `_handle_*` methods. Reviewers can't see the flow without a debugger.

This is tech debt. No new feature unlocks the split — but every future engine PR pays the tax.

---

## 2. Constraints (non-negotiable)

1. **5-regime test suite stays green.** `pytest tests/ -q` at the head of each commit.
2. **Golden cases pass.** `tests/golden_factorylm.csv`, `tests/golden_hybrid.csv` — diagnostic engine truth set.
3. **GS11 grounding regression net passes.** Per `.claude/skills/bot-grounding-tests/` — mandatory pre-push for retrieval-layer edits.
4. **No behavior change.** This is a refactor, not a feature. Each commit must be byte-for-byte identical on response output for the existing golden corpus.
5. **One file move per commit.** Re-exports preserve import paths during the transition.
6. **The public Supervisor API (`process`, `process_full`, `process_multi_photo`, `reset`, `log_feedback`) keeps its name and signature.** Adapters in `mira-bots/{telegram,slack,email}/` and `mira-pipeline/main.py` must not need changes.

---

## 3. Target structure

```
mira-bots/shared/engine/
├── __init__.py          # re-exports Supervisor (preserves `from shared.engine import Supervisor`)
├── core.py              # Supervisor class skeleton, __init__, process(), process_full(),
│                        # process_multi_photo(), reset(), log_feedback() — the run-loop + lifecycle
├── fsm_handlers.py      # FSM transition handlers (_handle_cmms_pending, _handle_pm_suggestion_pending,
│                        # _handle_nameplate, _handle_session_followup, _handle_manual_lookup_*)
├── grounding.py         # _is_grounded(), _apply_quality_gate(), _self_critique_diagnosis(),
│                        # _call_with_correction(), groundedness scoring helpers
├── recall.py            # KB recall path — coordinates with neon_recall.py and rag_worker
├── cmms.py              # Work-order / CMMS bridge — _build_wo_draft(), _post_cmms_work_order(),
│                        # _handle_wo_request(), _handle_cmms_pending(), _handle_check_equipment_history()
├── uns_gate.py          # UNS namespace-confirmation gate — _should_fire_uns_gate(),
│                        # the confirmation message builder, the wait-for-confirmation handler
├── photos.py            # Photo / vision / schematic handling — _save_session_photo(),
│                        # _load_session_photo(), _extract_schematic(), _summarize_schematic(),
│                        # _build_print_reply()
├── replies.py           # Reply formatting — _format_simple_response(), _greeting_response(),
│                        # _format_reply(), _make_result(), _parse_response()
├── routing.py           # Intent routing — _handle_general_question(), _handle_multi_vendor_question(),
│                        # _handle_asset_switch(), _handle_documentation_intent(), etc.
├── persistence.py       # State persistence — _ensure_table(), _load_state(), _save_state(),
│                        # _record_exchange(), _log_interaction()
└── helpers.py           # Module-level helpers — _is_fresh_question_during_wo(),
                         # _clean_option_list(), _clean_asset_name(), _strip_memory_block(),
                         # _infer_confidence(), _is_doc_specific(), _message_is_specific_question()
```

`engine.py` itself becomes a 1-line shim:

```python
# mira-bots/shared/engine.py
from .engine import Supervisor  # noqa: F401  re-export for backwards-compat
```

Or, equivalently, delete `engine.py` and rely on `engine/__init__.py`. The shim variant minimizes import-path churn during the rollout; the `__init__.py`-only variant is the post-rollout end state.

---

## 4. Method-to-file mapping (from current engine.py)

Line numbers refer to `engine.py` at commit `6802b9d8` (this branch's HEAD).

### → `core.py` (Supervisor lifecycle + public API)

| Line | Method |
|------|--------|
| 465 | `class Supervisor` |
| 468 | `__init__` |
| 538 | `_background_state_for` (used by `process` to suppress diagnostic carryover) |
| 542 | `_clear_diagnostic_carryover` |
| 582 | `_load_recent_session_photo` |
| 708 | `_make_result` |
| 734 | `process` |
| 855 | `process_multi_photo` |
| 999 | `process_full` |
| 2222 | `reset` |
| 2250 | `log_feedback` |

### → `fsm_handlers.py`

| Line | Method |
|------|--------|
| 2049 | `_handle_cmms_pending` |
| 2180 | `_handle_pm_suggestion_pending` |
| 2270 | `_handle_nameplate` |
| 2523 | `_handle_session_followup` |
| 2649 | `_enter_manual_lookup_gathering` |
| 2722 | `_handle_manual_lookup_gathering` |
| 3418 | `_handle_dont_know_followup` |
| 3467 | `_maybe_dispatch_via_dst` |

### → `grounding.py`

| Line | Method |
|------|--------|
| 799 | `_apply_quality_gate` |
| 2429 | `_self_critique_diagnosis` |
| 2475 | `_call_with_correction` |
| 4285 | `_is_grounded` |

### → `recall.py`

| Line | Method |
|------|--------|
| 3922 | `_do_documentation_lookup` |
| 4059 | `_check_pending_doc_job` |
| 4140 | `_fire_scrape_trigger` |

(Note: pure recall is already in `neon_recall.py` + `workers/rag_worker.py`; `engine/recall.py` is the *coordinator* layer.)

### → `cmms.py`

| Line | Method |
|------|--------|
| 1973 | `_build_wo_draft` |
| 2005 | `_post_cmms_work_order` |
| 3382 | `_handle_wo_request` |
| 3622 | `_handle_check_equipment_history` |

(Plus the relevant parts of `_handle_cmms_pending` — judgement call whether that lives in `fsm_handlers.py` or `cmms.py`. Recommended: `fsm_handlers.py` since the dominant axis is FSM transition.)

### → `uns_gate.py`

| Line | Method |
|------|--------|
| 4400 | `_should_fire_uns_gate` |

(Plus the inline confirmation-message logic in `process_full()` — needs extraction into a `build_confirmation_message()` function.)

### → `photos.py`

| Line | Method |
|------|--------|
| 525 | `_save_session_photo` |
| 529 | `_load_session_photo` |
| 533 | `_clear_session_photo` |
| 606 | `_build_print_reply` |
| 609 | `_extract_schematic` |
| 649 | `_summarize_schematic` |

### → `replies.py`

| Line | Method |
|------|--------|
| 689 | `_infer_confidence` |
| 2933 | `_format_simple_response` |
| 2940 | `_greeting_response` |
| 4372 | `_parse_response` |
| 4386 | `_format_reply` |

### → `routing.py`

| Line | Method |
|------|--------|
| 3029 | `_handle_general_question` |
| 3214 | `_handle_multi_vendor_question` |
| 3302 | `_handle_asset_switch` |
| 3691 | `_handle_store_documentation` |
| 3816 | `_handle_documentation_intent` |
| 3846 | `_handle_instructional_question` |
| 3894 | `_call_llm_direct` |

### → `persistence.py`

| Line | Method |
|------|--------|
| 4311 | `_ensure_table` |
| 4315 | `_load_state` |
| 4319 | `_save_state` |
| 4335 | `_record_exchange` |
| 4339 | `_log_interaction` |
| 4382 | `_advance_state` |

### → `helpers.py` (module-level)

| Line | Method |
|------|--------|
| (top) | `_is_fresh_question_during_wo` |
| (top) | `_clean_option_list` |
| (top) | `_clean_asset_name` |
| 677 | `_is_doc_specific` |
| 3014 | `_message_is_specific_question` |
| 3354 | `_parse_asset_fault_from_message` |
| 4324 | `_strip_memory_block` |

---

## 5. Sequencing (5-day plan)

Each day ends with green CI on the worktree branch. No file move ships without the tests passing.

### Day 1 — Mechanical extraction (zero behavior change)

Order matters: smallest-blast-radius modules first, so failure modes show up in cheap commits.

1. **`helpers.py`** — module-level pure functions. No `self` references. Lowest blast radius. Commit, push, verify CI.
2. **`persistence.py`** — `_ensure_table`, `_load_state`, `_save_state`, `_record_exchange`, `_log_interaction`. All self-contained sqlite work. Commit, push, verify.
3. **`replies.py`** — formatting helpers. No external I/O. Commit, push, verify.
4. **`photos.py`** — session-photo helpers, schematic extraction. Some external I/O (`workers/vision_worker.py`). Commit, push, verify.

### Day 2 — Mid-blast-radius extractions

5. **`grounding.py`** — quality-gate + self-critique. Calls into `citation_compliance.py`. Run GS11 regression suite after this commit. Commit, verify.
6. **`uns_gate.py`** — the namespace-confirmation gate. Pulls from `uns_resolver.py`. **Hand-test the gate flow on staging Telegram** before committing — UNS gate failure is a production bug per `.claude/CLAUDE.md`. Commit, verify.

### Day 3 — High-blast-radius extractions

7. **`cmms.py`** — work-order flow. Touches `integrations/atlas_cmms.py`, `integrations/hub_neon.py`, `integrations/pm_suggestions.py`. Run a CMMS smoke pass (`tests/regime5_*` if present). Commit, verify.
8. **`routing.py`** — general/multi-vendor/asset-switch/documentation handlers. Touches `conversation_router.py`. Run the golden cases here. Commit, verify.

### Day 4 — FSM extraction

9. **`fsm_handlers.py`** — all `_handle_*` methods for pending states. Touches `dialogue_state.py`, `dialogue_tracker.py`, `fsm.py`. This is the highest-blast-radius commit. Run the full 5-regime suite + GS11 + golden cases before push. Commit, verify.
10. **`recall.py`** — recall-coordinator layer. Touches `neon_recall.py`, `workers/rag_worker.py`. Run GS11 again. Commit, verify.

### Day 5 — Wrap-up

11. **`core.py`** — what's left becomes `Supervisor`'s skeleton. Move `__init__`, public-API methods, and the run-loop here. Update `engine.py` to be a 1-line re-export shim.
12. **Sweep:** `ruff check mira-bots/shared/engine/` + `ruff format`. Verify import graph is clean (no cycles).
13. **Smoke:** staging deploy + full pre-merge gate (`smoke-test.yml`, `staging-gate`, GS11, golden cases). PR review + merge.

---

## 6. Verification gates (per-commit)

Every commit between Day 1 and Day 5 must satisfy:

1. `ruff check mira-bots/` exits 0.
2. `pytest tests/ -q -m 'not slow'` exits 0.
3. `pytest tests/golden_factorylm.csv tests/golden_hybrid.csv -q` no regressions vs baseline.
4. The bot-grounding-tests skill suite passes (GS11 regression net).
5. `grep -rn 'from .engine import' mira-bots/` — no caller has changed (refactor is internal).

Day 5 adds:

6. Staging deploy succeeds.
7. `bash install/smoke_test.sh` against staging-VPS — green.
8. Telegram + Slack smoke pass on staging bot accounts.

---

## 7. Rollback strategy

- Each commit is a single file move with re-exports. Reverting any one commit returns to the prior working state without cascading.
- If Day 4 (FSM handlers) regresses GS11 or the UNS gate, revert that commit and re-plan the split (the FSM is the highest-risk axis).
- If the full Day-5 PR is reverted, the engine continues to work from the old `engine.py` location (the per-commit re-exports keep all import paths alive throughout the migration).

---

## 8. Out of scope

This plan is **refactor only**. It explicitly does NOT include:

- Behavior changes — no new groundedness scoring, no new FSM states, no new handlers.
- Test additions or coverage improvements (those are follow-up; they're easier *after* the split).
- Performance changes — async loop, retries, timeouts all stay as-is.
- New abstractions — no plugin systems, no dependency injection, no service locators. Just file moves.
- `mira-bots/shared/workers/` reshuffling — workers are already separated; not touching them.

If reviewers want any of the above, file separate issues. The whole point of this refactor is *reducing* the variables in flight; piling on dilutes that.

---

## 9. References

- Issue #1464 — original tech-debt ticket
- `mira-bots/shared/engine.py` — current source (4,626 lines)
- `mira-bots/shared/CLAUDE.md` — local context
- `mira-bots/shared/fsm.py`, `dialogue_state.py`, `dialogue_tracker.py` — existing FSM modules (already split out)
- `mira-bots/shared/workers/` — worker layer (already split out)
- `.claude/skills/bot-grounding-tests/SKILL.md` — GS11 regression contract
- `tests/golden_factorylm.csv`, `tests/golden_hybrid.csv` — golden corpus
- ADR-0014 — product-led wedge (the strategic context that makes this debt worth paying down now)
