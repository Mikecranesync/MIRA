# Deploy: Multi-Provider Inference Router

**Date:** 2026-04-11
**Commit:** `dd58d0a` on `staging`
**Previous commit:** `3ccdcc1` (last known-good)
**Deployed to:** BRAVO (100.86.236.11)
**Containers rebuilt:** mira-bot-telegram, mira-bot-slack

---

## What Changed

### 1. `mira-bots/shared/inference/router.py` (core change)
- **Before:** Single-provider Claude-only router. If Anthropic credits depleted → empty response → Open WebUI fallback → "MIRA error"
- **After:** Multi-provider cascade: Groq → Cerebras → Claude → (caller falls back to Open WebUI)
- Provider enablement is key-based: set `GROQ_API_KEY` env var → Groq added to cascade
- Image requests skip Groq/Cerebras (no vision) → route directly to Claude
- HTTP 400 now classified as "billing" (enables proper cascade instead of silent failure)
- New classes: `_Provider` dataclass, `_ProviderSkip` exception
- New functions: `_build_providers()`, `_call_openai_compat()`, `_call_anthropic()`, `_has_image()`, `_convert_images_for_claude()`

### 2. `mira-bots/docker-compose.yml`
- Added to all 5 bot services (telegram, slack, teams, whatsapp, reddit):
  ```yaml
  INFERENCE_BACKEND=${INFERENCE_BACKEND:-cloud}
  GROQ_API_KEY=${GROQ_API_KEY:-}
  GROQ_MODEL=${GROQ_MODEL:-llama-3.3-70b-versatile}
  CEREBRAS_API_KEY=${CEREBRAS_API_KEY:-}
  CEREBRAS_MODEL=${CEREBRAS_MODEL:-llama3.1-8b}
  ```
- Default `INFERENCE_BACKEND` changed from `local` to `cloud`

### 3. `mira-bots/shared/workers/rag_worker.py`
- Docstring update only — no logic change

### 4. `CLAUDE.md` (root)
- Updated env var table with Groq/Cerebras entries
- Updated inference one-liner to show cascade

### 5. `mira-bots/shared/CLAUDE.md`
- Updated InferenceRouter docs from single-provider to cascade

### 6. `tests/test_inference_router.py` (new file)
- 22 unit tests covering cascade, sanitization, image routing

### 7. `tests/mira_eval.py`
- Added `--groq` and `--cerebras` CLI flags for benchmarking

---

## Doppler Secrets Added (factorylm/prd)

| Key | Value (type) | Purpose |
|-----|-------------|---------|
| `GROQ_API_KEY` | `gsk_...` | Groq free tier (primary) |
| `CEREBRAS_API_KEY` | `csk_...` | Cerebras free tier (secondary) |
| `INFERENCE_BACKEND` | `cloud` | Master switch for cascade |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model selection |
| `CEREBRAS_MODEL` | `llama3.1-8b` | Cerebras model selection |

---

## Benchmark Results

| Provider | Model | Score | Avg Latency |
|----------|-------|-------|-------------|
| Groq | llama-3.3-70b-versatile | 94/100 (94%) | ~300ms |
| Claude | claude-sonnet-4-6 | 97/100 (97%) | ~5s |

---

## How to Revert

### Option A: Git revert + rebuild (cleanest)
```bash
# On BRAVO
cd ~/Mira
git revert dd58d0a --no-edit
cd mira-bots
docker compose build telegram-bot slack-bot
docker stop mira-bot-telegram mira-bot-slack
docker rm mira-bot-telegram mira-bot-slack
DOPPLER_TOKEN=<service-token> doppler run -- docker compose up -d telegram-bot slack-bot
```

### Option B: Checkout previous commit + rebuild (fastest)
```bash
# On BRAVO
cd ~/Mira
git checkout 3ccdcc1 -- mira-bots/shared/inference/router.py mira-bots/shared/workers/rag_worker.py mira-bots/docker-compose.yml
cd mira-bots
docker compose build telegram-bot slack-bot
docker stop mira-bot-telegram mira-bot-slack
docker rm mira-bot-telegram mira-bot-slack
DOPPLER_TOKEN=<service-token> doppler run -- docker compose up -d telegram-bot slack-bot
```

### Option C: Just switch backend to local (emergency, no rebuild)
```bash
# Bypass cascade entirely — falls through to Open WebUI
docker stop mira-bot-telegram mira-bot-slack
docker rm mira-bot-telegram mira-bot-slack
# Re-run with INFERENCE_BACKEND=local override
INFERENCE_BACKEND=local DOPPLER_TOKEN=<token> doppler run -- docker compose up -d telegram-bot slack-bot
```

### Doppler revert
Remove these keys from `factorylm/prd` if reverting fully:
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `CEREBRAS_MODEL`
- Change `INFERENCE_BACKEND` back to `claude` (or delete it)

---

## Container State at Deploy Time

| Container | Image ID | Created | Status |
|-----------|----------|---------|--------|
| mira-bot-telegram | `1679b5f5c121` | 2026-04-11 14:52 EDT | healthy |
| mira-bot-slack | `a640e851ecb7` | 2026-04-11 14:52 EDT | healthy |

Previous containers (now removed):
- mira-bot-telegram: `74628df44b20` (had `INFERENCE_BACKEND=claude`, no Groq/Cerebras)
- mira-bot-slack: `4f1c4f1f2f95` (same)

---

## Verification

After deploy, confirm cascade is active:
```bash
docker logs mira-bot-telegram --tail 20 2>&1 | grep "InferenceRouter"
# Expected: "InferenceRouter enabled — cascade: groq → cerebras → claude"
```

Send a test message on Telegram and check logs for provider used:
```bash
docker logs mira-bot-telegram --tail 50 2>&1 | grep -E "CLOUD_CALL|provider"
```
