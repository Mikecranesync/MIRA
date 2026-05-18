# PLAN — feat/answer-quality-may21 (MIRA Answer Quality Standard + Demo Benchmark)

**Status:** Active (2026-05-18)
**Branch:** `claude/agitated-kowalevski-17c2c5` (worktree, reset to `origin/main` HEAD `a8ee1e2b`)
**Worktree:** `.claude/worktrees/agitated-kowalevski-17c2c5/`
**Demo target:** May 21, 2026

> Supersedes the prior PLAN.md (demo-may21-finish scope). That work was either
> merged or abandoned; the branch was 86 commits behind origin/main and reset.
>
> This PLAN follows the autonomous-run skill contract: numbered scope,
> explicit OUT-of-scope, per-task verify steps, stop conditions.

## North-star reuse

- `tests/eval/judge.py` — already implements a 5-dim Likert 1-5 judge
  (`groundedness, helpfulness, tone, instruction_following, conversational_flow`)
  with cross-model routing. This IS the auto-grader for Phase 4 — don't write a parallel one.
- `tests/conversation_suite/` — engine-direct harness with mock + live mode,
  fixtures, checkpoints (`cp_asset_confirmed`, `cp_hard_fail_safety`, citation
  check). Phase 2/4 build INTO this suite, not next to it.
- `mira-bots/shared/citation_compliance.py` — `[Source:]` tag enforcer.
- `mira-bots/shared/engine.py` lines 274-278, 2432-2463 — embedded judge
  prompt and `_judge_response` already score 1-5 internally.
- 7-8 of Mike's 10 demo questions ALREADY exist as fixtures in
  `tests/conversation_suite/fixtures/cases/grounded_troubleshooting/`.

## In-scope (this session)

1. **Phase 1: Standard doc** — write `docs/specs/mira-answer-quality-standard.md`
   that codifies the existing rubric (groundedness, helpfulness, tone,
   instruction_following, conversational_flow + citation-compliance + safety
   hard-fail). Map Mike's 6 criteria (Grounded, Accurate, Contextual,
   Actionable, Concise, Safe) onto existing dimensions. Add `accuracy` only
   if needed as a distinct axis. Reference existing modules; do NOT invent
   parallel scoring.

2. **Phase 2: Benchmark fixture set** — define the demo-benchmark suite as
   the 10 questions from Mike's prompt. Most exist; the gaps:
   - GS11 wiring (existing is GS10)
   - MSG_MODBUS error 255
   - "What should I check if the proximity sensor doesn't change state?"
   - "Is the PLC seeing the sensor?"
   Tag each of the 10 fixtures `benchmark: demo_may21` so the harness can
   filter to them. Add 4 new fixtures only as needed; reuse where possible.

3. **Phase 3: Run live benchmark + grade** — execute
   `doppler run -p factorylm -c prd -- python -m tests.conversation_suite.harness
    --mode=live --filter=benchmark:demo_may21 --report=md --out=docs/benchmarks/`
   Record results in `docs/benchmarks/2026-05-18_demo_may21_baseline.md`.

4. **Phase 4: Diagnose failures** — for each fixture scoring avg < 4 on the
   five dimensions OR failing citation/safety checkpoints, write a
   one-paragraph diagnosis in the same benchmark doc: root cause (KB gap,
   prompt issue, intent miss, retrieval gap), proposed fix, owner.
   **In-scope fixes:** prompt-template tweaks, fixture corrections,
   `expected_keywords` calibration. **Out-of-scope fixes:** new KB
   ingestion (defer), engine refactors (defer), retrieval-tuning runs
   (defer).

5. **Phase 5: Re-test fixed cases** — re-run live benchmark on any fixture
   that received an in-scope fix; verify scores improved. Append new
   results section to the benchmark doc.

6. **Phase 6: Wire into pytest** — add `tests/conversation_suite/test_demo_benchmark.py`
   that loads the 10 fixtures, runs in `live` mode (gated by
   `RUN_LIVE_BENCHMARK=1` env so CI doesn't auto-burn quota), asserts
   avg score >= 3.5 across the suite. Add a `pytest -m "live_benchmark"`
   marker. Document the run command in
   `tests/conversation_suite/README.md`.

7. **Phase 7: HANDOFF + PR** — open PR for the spec doc, fixtures, test
   file, README updates, and benchmark results. Write
   `HANDOFF_2026-05-18-evening.md` per autonomous-run template.

## Out-of-scope (DEFER to operator — Mike). Editing these = STOP.

| Item | Why deferred |
|---|---|
| SSH to VPS to send Telegram messages | `prod-guard.sh` blocks; autonomous-run forbids. Phase 2 uses engine-direct live mode instead. |
| Ingest new KB documents (manuals, PDFs) | Adds risk surface, slow, separate workstream |
| Touch `mira-bots/shared/engine.py` core flow | Engine refactor is a STOP — surface as a diagnosed-failure recommendation only |
| Change provider cascade | Out of scope; the cascade is already Groq→Cerebras→Gemini |
| Modify `tests/eval/judge.py` rubric | Existing 5-dim rubric is the standard — codify, don't redefine |
| Reintroduce Anthropic | Forbidden per PR #610 + project memory |
| Atlas CMMS, mira-web, mira-relay touches | Different surfaces, not the bot/engine path |

## Stop conditions

- All 7 in-scope items complete → write HANDOFF, stop
- Token usage > 70% OR turn count > 200 → stop, HANDOFF
- Edit would touch an OUT-of-scope path → STOP
- 5 consecutive turns failing the same fixture → stop
- Live benchmark suite-wide avg < 2.0 → STOP (reveals systemic issue, not per-fixture fix)
- Doppler/Groq quota exhausted → stop, document partial results in HANDOFF

## Verification gates

| Step | Gate |
|---|---|
| 1 | Spec doc references existing modules by file:line; rubric matches `judge.py` dimensions |
| 2 | `python -m tests.conversation_suite.harness --mode=mock --filter=benchmark:demo_may21` lists 10 fixtures |
| 3 | Benchmark md file exists in `docs/benchmarks/`; contains per-fixture scores |
| 4 | Each <4 fixture has a diagnosis paragraph |
| 5 | Re-test scores recorded (or "no in-scope fix possible" noted) |
| 6 | `pytest tests/conversation_suite/test_demo_benchmark.py -m live_benchmark --collect-only` shows 10 items; env-gate respected |
| 7 | `ruff check $(git diff --name-only origin/main..HEAD \| grep '\.py$')` passes; PR open; HANDOFF committed |

## Coordination check

- `docs/plans/2026-04-19-mira-90-day-mvp.md` "Currently in-flight" — no
  conflict; this work is grounded-by-default verification for the May 21 demo.
- `docs/plans/2026-05-14-demo-backend-plan.md` — demo backend is shipped
  (P5/P7/P8 done per prior HANDOFFs). This benchmark validates the
  shipped surface.
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` — UNS gate
  shipped; this benchmark exercises it (`uns_gate` + `grounded_troubleshooting`
  categories).
