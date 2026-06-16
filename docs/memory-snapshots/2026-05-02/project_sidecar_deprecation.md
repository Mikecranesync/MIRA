---
name: mira-sidecar deprecation state
description: mira-sidecar is legacy — active VPS chat path is mira-pipeline, not sidecar. OEM migration pending.
type: project
originSessionId: 28fa21ab-2192-460c-9cbc-c3b0b0ca99f0
---
mira-sidecar (ChromaDB RAG backend) is deprecated as of 2026-04-13 (ADR-0008). It still runs on VPS but is no longer in the active user-facing chat path.

**Why:** ADR-0007 introduced mira-pipeline (OpenAI-compat API wrapping GSDEngine). Open WebUI is now configured with `OPENAI_API_BASE_URLS=http://mira-pipeline-saas:9099/v1`. All chat from Mike's phone goes through the pipeline, not the sidecar.

**Current VPS chat path:** User phone → app.factorylm.com → Open WebUI → mira-pipeline (:9099) → GSDEngine → Anthropic API (claude-sonnet-4-6)

**What was done (PR #196, branch chore/sidecar-deprecation):**
- ADR-0008 written
- CLAUDE.md updated (version v0.5.4, sidecar marked legacy)
- nginx `/sidecar/` route removed from factorylm-prod (confirmed zero real callers)
- Old Open WebUI pipe function file removed from repo

**Remaining blockers before sidecar container can be stopped (issue #195):**
- 398 OEM chunks in `shared_oem` ChromaDB → need migration to Open WebUI KB ("OEM Library — MIRA Shared")
  - Script: `tools/migrate_sidecar_oem_to_owui.py` (dry-run safe, idempotent)
  - Runbook: `docs/runbooks/sidecar-oem-migration.md`
  - Run during quiet window with Mike watching
- `mira-web/src/lib/mira-chat.ts` calls sidecar `:5000/rag` — needs rewrite to call pipeline `:9099/v1/chat/completions`
- `mira-pipeline-saas` on VPS has `INFERENCE_BACKEND=cloud` typo (should be `claude`) — fix alongside sidecar cleanup

**How to apply:** Do NOT add new callers to mira-sidecar. Do NOT `docker volume rm mira_mira-chroma` until OEM migration verified. If asked to work on chat path, it's pipeline → GSDEngine, not sidecar.
