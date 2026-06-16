---
name: MIRA Current Build State
description: Branch, eval, and project management state as of 2026-05-02 session
type: project
originSessionId: 36a07d89-95d7-487f-aef0-a08965ff479a
---
**Main branch:** `main` at `3ede8ef` (2026-05-02) — youtube-transcript skill + promo screenshots
**Last known eval score:** 44/57 passing (77%) — stale scorecard from 2026-04-29; same 13-failure FSM cluster reported 4 days running (GitHub issues #884, #916, #918). Needs human triage (CRA-8).
**In-flight branches:** `feat/mvp-unit-4-exports`, `feat/mvp-unit-9a-landing`

**Why:** 90-day MVP window (2026-04-19 → 2026-07-19), target 10 paying logos at $97/mo.

**How to apply:** Check CRA board (linear.app/cranesync) at session start. All work maps to one of 3 projects: MVP Build (Units 2–8), Sales & GTM, Ops & Infra.

## What's Deployed (VPS prod)

| Container | State | Notes |
|-----------|-------|-------|
| mira-bot-telegram | main @ eeb9a4b | Rebuilt 2026-04-28 |
| mira-hub | be3887f | Not updated this session |
| atlas-api | live | Not updated |

## Benchmark History

### benchmark_suite.py (programmatic scoring)
| Version | Overall | Technical | Conversational | WO Quality | FSM | Response |
|---------|---------|-----------|---------------|-----------|-----|---------|
| v1.0.0 | 63.5% D | 44.2% | 84.4% | 48.7% | 66.7% | 96.7% |
| v1.0.1 | 68.2% D | 49.6% | 87.9% | 53.3% | 73.3% | 96.7% |
| **v1.1.0** | **73.3% C** | **60.9%** | **87.7%** | **52.0%** | **86.7%** | **96.7%** |

### deepeval_suite.py (LLM-judged semantic scoring — offline baseline v1.0)
| Category | Score | Notes |
|---|---|---|
| fault_diagnosis | 5/5 (100%) | |
| instructional | 5/5 (100%) | |
| safety | 5/5 (100%) | |
| wo_creation | 4/5 (80%) | de-wo-02 WO Completeness=0.60 (needs urgency capture fix) |
| **Overall** | **19/20 (95%)** | |

| Metric | Avg |
|---|---|
| AnswerRelevancy | 0.988 |
| ConversationCompleteness | 1.000 |
| Safety Compliance | 1.000 |
| Technical Accuracy | 0.960 |
| WO Completeness | 0.920 |

**Judge:** groq/llama-3.3-70b-versatile via GroqJudge(DeepEvalBaseLLM) custom class
**Mode note:** Offline mode scores expert reference responses (CI target). Live mode needs PIPELINE_API_KEY in mira-bot-telegram env (not yet wired) + FSM-aware evaluation approach.

## Open Issues

- Intermittent 409 Conflict on Telegram poller — pre-existing, bot recovers automatically
- LANGFUSE keys not set on VPS — tracing disabled (not blocking)
- tech-08 error case: `[argument of type 'NoneType' is not iterable]` — needs investigation
- WO quality still at 52% (benchmark_suite) — next target for improvement
- fsm-01, fsm-11: state mismatch cases — DIAGNOSIS vs Q1, Q1 vs IDLE
- de-wo-02 DeepEval WO Completeness 0.60 — urgency/escalation not captured in reference
- DeepEval live mode: PIPELINE_API_KEY not in mira-bot-telegram container env (cross-container auth gap)

## Next Priorities

1. Fix WO quality cases (wo-02, wo-13 both 0% — no WO created)
2. Investigate tech-08 NoneType error
3. Fix fsm-01/fsm-11 state mismatches
4. Merge PR #767 → feat/hub-741-login-gate → main → tag mira-hub/v1.5.0
5. Resend domain verification (email blocker)
6. Wire PIPELINE_API_KEY into mira-bot-telegram Doppler secrets for live DeepEval mode
