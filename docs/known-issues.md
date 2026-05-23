# MIRA Known Issues, Deferred Features, and Abandoned Approaches

Extracted from CLAUDE.md to keep the build-state file lean.
Updated: 2026-05-23

## Known Broken / Incomplete

- **Gemini key blocked** — `GEMINI_API_KEY` in Doppler returns 403 "Your project has been denied access". Get fresh key from aistudio.google.com and update Doppler `factorylm/prd`. Cascade falls through to Groq/Cerebras in the meantime (smoke-tested OK).
- **Teams + WhatsApp** — Code-complete, pending cloud setup (Azure Bot Service, WhatsApp Business API). WhatsApp adapter shared-deps fixed 2026-05-22 (#1482) but webhook wiring still TODO.
- **PLC at 192.168.1.100** — Unreachable from PLC laptop; needs physical check (power/switch/cable).
- **Charlie Doppler keychain** — Same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`.
- **Charlie HUD** — Needs local terminal session to start (keychain blocks SSH start of Doppler).
- **Reddit benchmark** — 15/16 questions hit intent guard canned responses, not real inference. No recent work on `mira-bots/reddit/`.
- **NVIDIA NIM / Nemotron** — API key in Doppler but Regime 5 eval tests blocked on it.
- **VPS deploy uses `main` HEAD, not version tags** — Customer-facing components are tagged (`mira-hub/v*`, etc.) but `deploy-vps.yml` checks out `main`, so the namespaced tags are documentation only — they don't enforce reproducible deploys or give us a real rollback target. See `feedback_versioning_discipline_global.md`.
- **DOPPLER_TOKEN drift between Doppler config and saas compose** — Secrets set in Doppler `factorylm/prd` don't reach a container unless also listed in the `env:` block of `docker-compose.saas.yml`. Edit both in the same PR.
- **Default `deploy-vps.yml` TARGETS excludes mira-web** — Marketing-site PRs do not auto-deploy. Manual: `gh workflow run deploy-vps.yml -f services=mira-web`.

## Deferred Features

| Feature                      | Deferred To | Reason                      |
|------------------------------|-------------|-----------------------------|
| Modbus / PLC / VFD           | Config 4    | Out of scope for Config 1 MVP |
| NVIDIA Nemotron reranker     | **Active**  | Enabled when NVIDIA_API_KEY set (feature-flagged) |
| Kokoro TTS                   | Post-MVP    | Nice-to-have                |
| CMMS integration             | **Active**  | Atlas CMMS (mira-cmms/)     |

## Abandoned Approaches

| Approach | Replaced With | Why It Failed |
|----------|--------------|---------------|
| NemoClaw / NeMo Guardrails | Custom supervisor/worker | Not production-ready (Mar 17) |
| PRAW OAuth for Reddit | No-auth public JSON endpoints | Too heavy — credentials, app registration, rate limits |
| zhangzhengfu nameplate dataset | Own golden set from Google Photos | Empty repo, dead Baidu Pan links, no license |
| Google Photos API direct | rclone + Ollama triage | OAuth consent screen "Testing" mode returned empty results |
| GWS CLI for Gmail | IMAP with Doppler app passwords | Scope registration issues on Windows |
| glm-ocr model (as primary) | qwen2.5vl handles vision | Consistent 400 errors — retained as optional fallback in vision_worker.py |
| Anthropic / Claude as cloud LLM provider | Groq → Cerebras → Gemini cascade | Removed PR #610. Do not reintroduce. |

## Resolved (kept for context)

- **mira-sidecar (ChromaDB RAG backend)** — Removed from `docker-compose.saas.yml` 2026-05-20 per ADR-0014. Replaced by mira-pipeline + Open WebUI native KB. OEM chunks no longer block sunset.
- **mira-web → mira-pipeline cutover** — Done. `mira-web/src/lib/mira-chat.ts` now calls mira-pipeline `:9099/v1/chat/completions` (ADR-0008).
- **No CD pipeline** — Resolved. `deploy-vps.yml` gates on `smoke-test.yml` success and deploys to VPS automatically on push to `main`. Manual fallback: `gh workflow run deploy-vps.yml -f services=<svc>`.
