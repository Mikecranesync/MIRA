---
name: MIRA Anthropic API removal — historical record
description: Anthropic/Claude was removed from MIRA permanently across 2026-04-25 → 2026-04-26 (PRs #610, #649). Documents what changed, what survived, and why never to reintroduce.
type: project
originSessionId: 7df2ffc4-7046-4fe4-a8f0-4f871d51c5ed
---
**Fact:** As of 2026-04-26, the `anthropic` Python SDK and direct Anthropic Messages API calls have been removed from every active runtime path in MIRA. The cloud LLM cascade is now **Groq → Cerebras → Gemini**, all OpenAI-compatible, all free-tier.

**Why:** On 2026-04-25 Anthropic credits ran out (#590). The Claude AI Code Review CI check went red and a docs-only PR (#609) was blocked because of an unrelated AI billing failure. Mike's directive: *"remove the anthropic dependancy FOREVER. find other intelligence."* Single-vendor billing/auth/rate-limit failures should never be able to block PRs or production again.

**How to apply:**

- Whenever you wire a new LLM call, route it through the cascade — never `anthropic.Anthropic(...)`, never `https://api.anthropic.com/v1/messages`, never `claude-*` model strings.
- Reference implementation lives in `mira-bots/shared/inference/router.py` (`InferenceRouter` class, ~519 lines). Production env vars: `INFERENCE_BACKEND=cloud`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` — all in Doppler `factorylm/prd`.
- See sister memory `feedback_llm_cascade_default.md` for the per-call "how to apply" rule.

**What was removed (the receipts):**

| PR | Date | Scope |
|---|---|---|
| **#610** *"refactor: remove Anthropic from runtime LLM cascade"* | 2026-04-25 | Runtime cascade. Dropped `_call_anthropic`, `_convert_images_for_claude`, `ANTHROPIC_*` constants, `claude` provider entry, daily-spend monitor, `claude` backend alias from `router.py`. Removed `anthropic>=0.40` from `mira-pipeline/requirements.txt`. Cleaned `engine.py`, `route_fallback.py`, `mira-pipeline/main.py`. Updated `docker-compose.saas.yml` to drop dead `ANTHROPIC_API_KEY` env wiring. Updated `.env.template`. Rewrote 4 test files. **+82 / -367 lines, 50 tests pass.** |
| **#649** *"chore(docs+scripts): finish Anthropic removal"* | 2026-04-26 | Doc + tooling cleanup. Flipped `CLAUDE.md` Hard Constraint #2 to *"Cloud LLMs: Groq + Cerebras + Gemini cascade. No Anthropic — never reintroduce."* Struck through `ANTHROPIC_API_KEY` + `CLAUDE_MODEL` rows in `docs/env-vars.md`. Replaced `apply_claude_fixes` with `apply_cascade_fixes` in `scripts/pr_self_fix.sh` (urllib stdlib only, no anthropic SDK). Archived `mira-web/server.js` (366 → 25 lines, throws on accidental import — entry point has been `src/server.ts` since the Bun/Hono migration). **+110 / -416 lines.** |

Closed in the same window: #272 (feature freeze policy), #104, #105 (Loom video tasks — superseded by comic-book format), #590 (Anthropic credits — moot).

**What survived intentionally:**

- `mira-sidecar/` and `docker-compose.pathb.yml` (Path B sidecar deployment): both still reference `LLM_PROVIDER=anthropic`. **Sunset-pending** — will go with the OEM-doc migration / mira-web cutover (issue #195). Do not migrate this; let it die.
- The runtime still accepts `ANTHROPIC_API_KEY` in env without crashing — it's silently ignored by the new router. This is intentional (graceful) but adding it back to a service config signals a regression.

**Verification commands (use these before claiming "Anthropic is gone"):**

```bash
# Should return zero matches outside legacy mira-sidecar:
rg -l 'anthropic\.Anthropic\(|api\.anthropic\.com|anthropic-version' \
   --glob '!mira-sidecar/**' --glob '!docker-compose.pathb.yml' \
   --glob '!.claude/worktrees/**'

# Production cascade should be groq → cerebras → gemini (no claude):
PYTHONPATH=mira-bots/shared INFERENCE_BACKEND=cloud GROQ_API_KEY=x \
  CEREBRAS_API_KEY=x GEMINI_API_KEY=x \
  python3 -c "from inference.router import InferenceRouter; \
              print([p.name for p in InferenceRouter().providers])"
```

**Don't:**

- Reintroduce `pip install anthropic` or `npm install @anthropic-ai/sdk` to any active service.
- Re-add `ANTHROPIC_API_KEY` env wiring to any non-legacy compose file.
- Suggest "fall back to Claude" as a fix for cascade failures — the right answer is "fix the failing free-tier provider" or "let it fall through to Open WebUI/Ollama" (the existing local fallback).
