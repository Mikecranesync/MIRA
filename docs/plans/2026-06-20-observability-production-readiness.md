# Plan — Make the Observability + Eval Layer Production-Ready

**Date:** 2026-06-20
**Status:** Phases 0–3 **SHIPPED** (uncommitted) 2026-06-20 — verified via
`tools/verify_phase1_trace.py` (real `process()` turn emits a trace; with checks on,
governance warnings fire) + 74 tests (48 observe + 26 router). Phase 2 model attribution is
wired + unit-tested but can't positively light up on a provider-less dev box. Phases 4–7 pending.
**Scope (user-chosen):** take `simlab/observe/` from "traces the eval/ask harness only"
to "every real MIRA answer emits a local trace, governed and judgeable."
**Constraints (unchanged):** additive, observational, **read-only** (no PLC writes, no
reply-path behavior change), **fail-open** (a trace failure never touches a reply),
JSON-first, no external observability vendor.

---

## The key finding (why this is small, not a rebuild)

Every real answer adapter — Telegram, Slack, mira-pipeline (Open WebUI / phone chat),
and Ignition (`mira-pipeline/ignition_chat.py`) — routes through **`Supervisor.process()`**
(`mira-bots/shared/engine.py`). `process()` already calls **`_schedule_decision_trace()`**
(engine.py:1252) after every turn, where the engine has *already assembled* the trace
evidence: `uns_context`, `tag_evidence`, `manual_sources` (from the #1704-safe
`result["_citation_evidence"]`), `reply`, `outcome`, `latency_ms`, `platform`, `tenant_id`.

So there is **one production anchor**, not five adapter edits. We emit the local
`AnswerTrace` (and run governance/incident checks) at that same site, alongside the
existing NeonDB `decision_traces` write. Today that site has the data; it just doesn't
emit our local JSON trace and doesn't run the checks.

**Known exception:** the AskMira `/ask` kiosk fast-path (`mira-bots/ask_api/`) bypasses the
full `process()` flow for latency. It needs its own (smaller) hook — Phase 5.

---

## Gaps this plan closes (from the layer's own "Remaining production gaps")

1. Only the eval/ask harness emits a local trace → **adapters don't.**
2. `model_used` is null in live (per-call model not on the result dict).
3. `documents_retrieved` / tags come from the harness, not the engine's real evidence.
4. Governance + incident checks only run in the eval harness, never on a live turn.
5. Approval source is a JSON placeholder, not the real `asset_agent_status` / `ai_suggestions`.
6. Grading is keyword-containment only (no nuanced answer-quality judge).
7. Two trace schemas exist (NeonDB `decision_traces` row vs local `AnswerTrace`).

---

## Phase 0 — Relocate the dependency-light core so the engine can import it ✅ DONE

**Problem:** `trace.py` / `checks.py` / `approval_registry.py` live under `simlab/observe/`.
The bot containers don't put `simlab` on `sys.path`, so the engine cannot
`import simlab.observe.trace`. They are already simlab-free; only the *location* blocks reuse.

**Do:** move the three dependency-light modules to `mira-bots/shared/observe/`
(importable as `shared.observe.trace` etc. — the same path the engine uses for
`shared.decision_trace`). Leave the simlab-dependent pieces (harness/eval_runner/ask/
viewer/evalpacks) in `simlab/observe/`, importing the core from `shared.observe`.

- `mira-bots/shared/observe/{__init__,trace,checks,approval_registry}.py` ← moved
- `simlab/observe/` keeps `harness.py`, `run_eval.py`, `ask.py`, `viewer.py`, `evalpacks/`,
  re-exporting the core from `shared.observe` for back-compat.
- Add the repo-root `mira-bots` to `sys.path` in the simlab pieces (already the pattern in
  `simlab/approval.py` / `tests/simlab/runner.py`).

**Risk:** import paths. **Verify:** `tests/observe/` (30 tests) green after updating imports;
`python -c "import sys; sys.path.insert(0,'mira-bots'); from shared.observe.trace import AnswerTrace"`.

**Effort:** S.

---

## Phase 1 — Emit a local AnswerTrace at the production trace site ✅ DONE

**Do:** in `_schedule_decision_trace` (engine.py), after scheduling the NeonDB write, also
build and write a local `AnswerTrace` JSONL — using the evidence already in scope. Gate it
behind `MIRA_LOCAL_TRACE=1` (default off in prod containers, on for debug/dev) and a
configurable `MIRA_TRACE_DIR` so it never surprises a prod disk.

- New helper `shared/observe/from_engine.py: build_answer_trace(...)` — pure, takes the
  same kwargs already assembled (message, reply, uns_context, tag_evidence, manual_sources,
  platform, tenant_id, latency_ms, confidence, model). Maps engine evidence → the 7 steps
  + the `AnswerTrace` fields. **No new data gathering** — reuse what's there.
- Fire-and-forget, same `try/except` + background-task pattern as the NeonDB write. A
  failure logs at debug and is dropped.

**Covers:** Telegram, Slack, pipeline (phone chat + Open WebUI), Ignition — all via `process()`.

**Risk:** must stay zero-latency + fail-open. **Verify:** unit-test `build_answer_trace`
against a synthetic engine-turn dict; manual: set `MIRA_LOCAL_TRACE=1`, run one
`mira-pipeline` turn locally, confirm a JSONL line lands and `viewer` renders it; confirm
reply path unchanged when the trace write is forced to throw.

**Effort:** M.

---

## Phase 2 — Close the `model_used` gap (thread the answering provider out) ✅ DONE

**Problem:** `_make_result` returns `{reply, confidence, trace_id, next_state, dispatch_kind,
_citation_evidence}` — no model/provider. `InferenceRouter.write_api_usage()` already knows
the provider+model that answered.

**Do:** thread the last provider/model out of the cascade onto the result dict (e.g.
`result["_model"] = {"provider": ..., "model": ...}`) — a small, additive engine change, no
behavior change. Both the NeonDB row (`model_used` column, already accepted by
`build_trace_row`) and the local `AnswerTrace.model_used` then populate.

**Risk:** touches `engine.py` / `router.py` — run `codegraph_impact` first (per repo rule)
and keep it additive. **Verify:** `tests/test_inference_router.py` green; a live trace shows
`model_used` non-null when a cloud provider answers.

**Effort:** S–M.

---

## Phase 3 — Run governance + incident checks on the live turn (observational) ✅ DONE (cached-registry source; live asset_agent_status refresh deferred)

**Do:** in `build_answer_trace`, after assembling the trace, run `run_governance` +
`run_incidents` and attach the warnings (exactly as the harness does). **Warnings only** —
they live in the trace, never alter or block the reply (read-only doctrine).

**Approval source for production:** replace the JSON placeholder read with a real source:
- asset approval ← `asset_agent_status.state == 'approved'` (Hub migration 046) via
  `ApprovalRegistry.with_agent_store(...)` — the hook already exists.
- document / mapping approval ← `ai_suggestions` / `relationship_proposals` (ADR-0017) or a
  cached read; fail-open to "proposed/unknown" when the DB is unreachable (never govern-open
  in a way that *blocks* — these are observational warnings).

**Risk:** a DB read in the trace path — must be cached + timeout-bounded + fail-open, like
`decision_trace._insert` (2s executor timeout). **Verify:** unit tests for the live-turn
governance assembly; confirm a turn with an unapproved asset emits `unapproved_asset` in the
trace and the reply is unchanged.

**Effort:** M.

---

## Phase 4 — Unify the two trace schemas (one builder, two sinks)

**Problem:** `decision_trace.build_trace_row` (NeonDB shape) and `AnswerTrace` (local JSON)
shape the same evidence twice and can drift.

**Do:** make `AnswerTrace` the single in-memory record; derive the NeonDB `decision_traces`
row from it (`AnswerTrace.to_decision_row()`), so `build_trace_row` becomes a thin adapter
over the unified object. One evidence-shaping path, two sinks (NeonDB row + local JSONL).

**Risk:** `decision_traces` column contract (Hub migration 032) must not change — this is a
pure refactor behind the same SQL. **Verify:** existing `decision_trace` unit tests green;
round-trip test `AnswerTrace → to_decision_row → INSERT params` matches the current shape.

**Effort:** M.

---

## Phase 5 — AskMira `/ask` fast-path hook + live-eval grounding

Two loose ends:

**5a. AskMira fast-path trace.** `mira-bots/ask_api/` bypasses `process()`. Add the same
`build_answer_trace` call at its answer site so kiosk/Ignition "Ask MIRA" turns also trace.
(Smaller surface; reuses Phase 1's builder.)

**5b. Live-eval grounding.** `run_eval --live` only cites real docs if the SimLab corpus is
seeded under the demo tenant (`tools/seeds/seed-simlab-docs.py`). Add a `--seed-check` preflight
that fails loudly with the seed command if the corpus is missing, so a live eval can't silently
score retrieval=0 because the KB was never seeded.

**Verify:** an AskMira turn emits a trace; `run_eval conveyor_demo --live` against a seeded
staging tenant returns non-zero retrieval/citation coverage.

**Effort:** M.

---

## Phase 6 — LLM-judge grading layer (optional, quality)

**Do:** add an optional `--judge` mode to `run_eval` that, after the keyword grade, runs the
existing `tests/eval/judge.py` (cascade LLM judge) on each answer for nuanced quality
(groundedness, relevance) and folds a `judge_score` into the report. Keyword grade stays the
fast CI default; judge is the deeper, opt-in pass.

**Risk:** judge needs provider keys → opt-in only, never the CI default. **Verify:** judged
run produces a `judge_score` per item; CI default run unchanged.

**Effort:** M.

---

## Phase 7 — (Optional) Hub admin/debug trace surface

The goal asked for "viewable in app/admin/debug if one exists." A minimal Hub route
(`/admin/traces`, admin-gated, `dynamic`) that reads the latest `decision_traces` rows (or a
mounted JSONL) and renders the same fields the CLI `viewer` shows. Defer unless Mike wants the
in-app surface — the CLI viewer already satisfies "developer-facing trace viewer."

**Effort:** M–L (Next.js route + auth gate + Screenshot Rule).

---

## Sequence & dependencies

```
Phase 0 (relocate core)  ──►  Phase 1 (live trace emit)  ──►  Phase 3 (live checks)
                                      │                              │
                              Phase 2 (model id)           Phase 4 (unify schema)
                                      └──────────────►  Phase 5 (askmira + seed)  ──►  Phase 6 (judge)
                                                                                          Phase 7 (Hub UI, optional)
```

Phases 0→1 are the spine (after them, every adapter traces). 2/3/4 harden it. 5/6/7 extend.

## Definition of done

- A real Telegram/Slack/Ignition/phone turn (with `MIRA_LOCAL_TRACE=1`) drops a local
  `AnswerTrace` JSONL, viewable with `python -m simlab.observe.viewer`.
- That trace shows the real model, real tags/evidence, real citations, confidence, and any
  governance/incident warnings — with the reply path provably unchanged and fail-open.
- `run_eval --live --seed-check` grounds against a seeded tenant; `--judge` adds quality scores.
- One evidence-shaping path feeds both the NeonDB row and the local JSON.
- Docs updated; `tests/observe/` + `decision_trace` tests green.

## Guardrails for every phase

- Read-only; no reply-path behavior change; fail-open (debug-log + drop on any trace error).
- `codegraph_impact` before any `engine.py` / `router.py` edit (repo rule).
- Conventional commits, scoped (`feat(observe):`), one PR per phase, no auto-merge.
- No new external observability vendor; JSON + NeonDB only.
