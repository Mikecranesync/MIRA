# PLAN — UNS Message Resolver (single extraction point)

**Status:** Active (2026-05-13)
**Branch:** `claude/elated-margulis-ac0926`
**Scope:** `mira-bots/shared/uns_resolver.py` (new), `mira-bots/shared/engine.py`,
`mira-bots/shared/workers/rag_worker.py`, `mira-bots/shared/dialogue_state.py`,
`mira-bots/shared/dialogue_acts.py`, `tests/test_uns_resolver.py` (new),
`docs/specs/uns-message-resolver-spec.md` (new), `.claude/rules/uns-compliance.md` (new)
**Out-of-scope:** FSM, DST, LLM cascade, response formatting, any UI; the DST plan
in `PLAN.dst.md` is a separate concern — do not modify those files except where
they import from `guardrails.vendor_name_from_text` or call `_looks_like_model_number`.
**Constraints:** No new dependencies, Python 3.12, ruff clean, reuse
`mira-crawler/ingest/uns.py` path builders. Net-negative LOC target.

---

## Why

`mira-bots/shared/engine.py` has 14 separate extraction sites that call
`vendor_name_from_text()` and `_looks_like_model_number()` on `message`,
`combined`, or `asset_id`. They don't share results, they disagree on edge
cases (numeric-only models, fault codes captured as models), and they re-run
the same regex work several times per turn. Mike's exact regression case
*"I have a powerflex 525 and it has it called f0004"* fails because:

- `vendor_name_from_text` picks up `"powerflex"` → `"Rockwell Automation"` ✓
- `_looks_like_model_number` returns `"f0004"` because it ranges left-to-right
  and accepts the first letter+digit token — the *fault code is captured as
  the model*
- `"525"` (the real model) is rejected — letters-only check fails

One UNS-aware resolver, called once at the top of `process()`, produces one
canonical `UNSContext` for the turn. All 14 sites read from it.

## Numbered tasks

1. **Spec + rule docs** — `docs/specs/uns-message-resolver-spec.md` and
   `.claude/rules/uns-compliance.md`. Both short, both reference the resolver
   module as the single extraction point.
2. **`uns_resolver.py`** — `UNSContext` dataclass, `resolve_uns_path()`
   function, `VENDOR_ALIASES` table, `FAULT_PATTERNS` list. Must work offline
   (no NeonDB) — alias table is the floor.
3. **`tests/test_uns_resolver.py`** — 30+ cases, must include Mike's exact
   regression case and the pure-digit-model case. Run with
   `python -m pytest tests/test_uns_resolver.py -v`.
4. **Wire into `Supervisor.process()`** — one call near the top. Merge with
   prior `state["uns_context"]` to preserve carry-over.
5. **Replace extraction sites** — 14 in `engine.py`, 1 each in `rag_worker.py`,
   `dialogue_state.py`, `dialogue_acts.py`. Batch by region, commit each batch.
6. **`rag_worker` KB scoping** — use `uns_context.manufacturer` for the
   cross-vendor filter, and `uns_path` for entity-scoped knowledge_entries
   queries when available.
7. **Run gates** — `ruff check`, `pytest tests/test_uns_resolver.py`, the
   existing `tests/eval/bot_regression.py` cases, and Mike's exact regression
   message must resolve to `mfr="Rockwell Automation", model="525",
   fault="F0004"`.
8. **Commit, push, PR, merge**.

## Success criteria

- All 14 `engine.py` extraction sites reduced to `state["uns_context"]` reads.
- `vendor_name_from_text` and `_looks_like_model_number` no longer imported in
  `engine.py`, `rag_worker.py`, `dialogue_state.py`, `dialogue_acts.py`.
- `tests/test_uns_resolver.py` ≥ 30 cases, all pass.
- Mike's exact regression case resolves correctly (see test 1 in the suite).
- `ruff check` passes.
- `tests/eval/bot_regression.py` does not regress vs main baseline.
- Net diff is negative LOC.

## Hard stops

- A reviewer-style data-integrity issue surfaces → stop, fix, re-gate.
- 5 consecutive failing test runs on the same case → stop, write HANDOFF.
- Out-of-scope file modified accidentally → revert that file, do not "while
  I'm here".
