## Why
Factory AI's asset-scoped chat ("Factory Chat") requires an admin to email their support for every manual. It's RAG over a hand-curated index. GET-only API, no streaming, no BYO-LLM disclosed.

**Our angle:** Ship asset-scoped chat on the hub, backed by GSDEngine (`mira-pipeline`) with streaming, multi-LLM cascade (Gemini→Groq→Cerebras→Claude), and self-serve manual upload via `mira-crawler`.

## Source
- https://docs.f7i.ai/docs/predict/user-guides/factory-chat
- https://docs.f7i.ai/docs/api/asset-resources-chat
- `docs/competitors/factory-ai.md` → `/asset-resources-chat` row
- `docs/competitors/factory-ai-leapfrog-plan.md` #4

## Acceptance criteria
- [ ] `POST /api/assets/{id}/chat` — streaming (SSE) — body: `{messages, model?}`
- [ ] Scope: retrieves asset manual chunks from Qdrant/CHARLIE, injects asset metadata into system prompt
- [ ] BYO-model: tenant setting selects Claude / GPT / Gemini / on-prem Ollama
- [ ] Safety gate: `SAFETY_KEYWORDS` triggers STOP escalation (from `mira-bots/shared/guardrails.py`)
- [ ] UI: chat panel on asset detail page + global `/chat` page scoped to any asset
- [ ] **Self-serve manual upload:** drop-zone on asset page → `mira-crawler` ingest → Qdrant → chat uses it within 5 min. **No emailing Tim.**
- [ ] "Asked MIRA" counter per asset for analytics

## Files
- `mira-hub/src/app/api/assets/[id]/chat/route.ts` (proxy to mira-pipeline :9099)
- `mira-hub/src/components/AssetChat.tsx`
- `mira-hub/src/app/(hub)/assets/[id]/page.tsx` (embed chat)
