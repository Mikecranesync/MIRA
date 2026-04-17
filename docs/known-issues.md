# MIRA Known Issues, Deferred Features, and Abandoned Approaches

Extracted from CLAUDE.md to keep the build-state file lean.
Updated: 2026-04-17

## Known Broken / Incomplete

- **Gemini key blocked** — `GEMINI_API_KEY` in Doppler returns 403 "Your project has been denied access". Get fresh key from aistudio.google.com and update Doppler `factorylm/prd`. Cascade falls through to Groq/Claude in the meantime (smoke-tested OK).
- **Teams + WhatsApp** — Code-complete, pending cloud setup (Azure Bot Service, WhatsApp Business API)
- **PLC at 192.168.1.100** — Unreachable from PLC laptop; needs physical check (power/switch/cable)
- **Charlie Doppler keychain** — Same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`
- **Charlie HUD** — Needs local terminal session to start (keychain blocks SSH start of Doppler)
- **Reddit benchmark** — 15/16 questions hit intent guard canned responses, not real inference
- **No CD pipeline** — CI validates but deploy to Bravo is manual (docker cp or SSH)
- **NVIDIA NIM / Nemotron** — API key in Doppler but Regime 5 eval tests blocked on it
- **mira-sidecar OEM migration pending** — 398 OEM chunks in `shared_oem` ChromaDB must move to Open WebUI KB before sidecar can be stopped. Script: `tools/migrate_sidecar_oem_to_owui.py`. Runbook: `docs/runbooks/sidecar-oem-migration.md`.
- **mira-web → mira-pipeline cutover pending** — `mira-web/src/lib/mira-chat.ts` calls sidecar `:5000/rag`; must be rewritten to call pipeline `:9099/v1/chat/completions` before mira-web is publicly routed.

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
| mira-sidecar (ChromaDB RAG backend) | mira-pipeline + Open WebUI KB | ADR-0008 (Apr 2026): pipeline wraps GSDEngine directly; Open WebUI native KB (Docling) replaces ChromaDB. Sidecar still running pending OEM doc migration (398 chunks). |
