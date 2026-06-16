---
name: MIRA/FactoryLM LLM cascade default
description: Always use multi-provider LLM cascade (Groq → Cerebras → Gemini) for any new LLM call in MIRA/FactoryLM. Never single-provider. Anthropic removed permanently 2026-04-25.
type: feedback
originSessionId: 1b80c5dd-c1ba-4ec1-8c4f-23b78f8db490
---
When wiring any LLM call — in CI workflows, scripts, services, sidecars, one-shot tools — default to a multi-provider cascade in this order: **Groq → Cerebras → Gemini**. Never a single-provider call. Never reach for Anthropic/Claude — that dependency was removed permanently on 2026-04-25 (PR #610).

**Why:** Single-provider integrations turn billing/auth/rate-limit failures into hours-long PR-blocking outages. PR #635 (2026-04-25) was the original trigger — Anthropic credits ran out, Claude AI Code Review check went red, and PR #609 (a docs PR with zero relation to LLM code) was blocked. Mike then directed: *"remove the anthropic dependancy FOREVER. find other intelligence."* Both runtime and CI now reflect that:
- **PR #610** ("refactor: remove Anthropic from runtime LLM cascade — PR A") **MERGED 2026-04-25 21:44** — stripped Claude/Anthropic from `mira-bots/shared/inference/router.py` and `mira-pipeline/requirements.txt`.
- **PR #641** ("refactor(ci): drop Anthropic tier from code-review cascade") **MERGED 2026-04-25 22:22** — dropped the Anthropic tier from `.github/workflows/code-review.yml` so the CI matches the runtime. Validation: Groq (`llama-3.3-70b-versatile`) served the AI Code Review comment on the PR's own CI run. All 12 checks green.

The directive is now load-bearing in code, not just memory: new code goes Groq → Cerebras → Gemini only. Adding Anthropic anywhere is a regression.

**How to apply:**
- Order: **Groq → Cerebras → Gemini**. Groq leads (fastest, most reliable per 2026-04-21 latency audit). Gemini last because of persistent 503s and a known-blocked key path (Doppler returns 403 — see Mike's CLAUDE.md gotchas section).
- Models: Groq `llama-3.3-70b-versatile`, Cerebras `llama3.1-8b`, Gemini `gemini-2.5-flash`.
- Transport: all three providers expose OpenAI-compatible `/chat/completions` — single `httpx` call, swap the URL/key/model. No Anthropic SDK, no `anthropic` Python dependency.
- Fallthrough: any error (auth, billing, rate-limit, network, server) → next tier. **Soft-skip on all-tiers-failed** (write a "skipped — all providers failed" comment and exit 0). Never let infra fail block PRs.
- Required env vars: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` — Doppler `factorylm/prd` for runtime; GitHub repo secrets for CI workflows. **Do NOT add `ANTHROPIC_API_KEY`** — the runtime now silently ignores it, and adding it back signals a regression.
- Reference implementation: `mira-bots/shared/inference/router.py` (production code) — 519 lines, no Anthropic refs.

**Triggers this rule:**
- Any new GitHub Actions workflow that calls an LLM
- New Python/TS service that needs LLM inference
- Any cron job, sidecar, or script doing analysis/classification/summarization
- When migrating existing single-provider code to be more reliable
- When the user mentions "LLM call", "AI review", "summarize", "classify via X", etc.

**Don't apply when:** the call is intentionally model-specific (e.g., a vision-only flow that requires `qwen2.5vl:7b`, or a benchmark comparing providers head-to-head). Match the user's intent, not the rule blindly.
