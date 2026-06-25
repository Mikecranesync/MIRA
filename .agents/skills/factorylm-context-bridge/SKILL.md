---
name: factorylm-context-bridge
description: >
  Use when Codex needs to query, extend, review, test, or package
  FactoryLM's read-only external AI context bridge. Trigger on FactoryLM
  Codex plugin work, MCP wrappers, ChatGPT connectors, approved asset context,
  UNS/tag context, evidence citations, SimLab scenario lookup, live-read gating,
  or mira-hub/src/lib/external-ai/context-skill.ts.
---

# FactoryLM Context Bridge

FactoryLM is the governed industrial context layer. MIRA is one native client.
External AI clients must use structured, read-only calls instead of guessing or
duplicating MIRA chat behavior.

## Start Here

Read the full developer docs when the task is more than a one-line lookup:

- `docs/external-ai/factorylm-codex-plugin-research.md`
- `docs/external-ai/factorylm-external-ai-architecture.md`
- `mira-hub/docs/developer/factorylm-external-ai-skill.md`

## Rules

- Do not build a chatbot.
- Do not expose raw SQL.
- Do not create PLC/tag/control writes.
- Do not add hidden LLM fallback.
- Use `mira-hub/src/lib/external-ai/context-skill.ts` first.
- Use `POST /api/factorylm/context` for API access.
- Keep live values gated by `approved_tags.enabled = true`.
- Keep asset/entity/evidence reads verified or explicitly labeled draft/internal.
- Return JSON with `evidence`, `confidence`, `approvalState`, and clear not-found behavior.

## Tool Map

- `find_asset`: fuzzy asset lookup
- `get_asset_context`: asset, components, approved tags
- `search_approved_evidence`: citations and approved evidence
- `get_tag_context`: tag/UNS allowlist metadata
- `list_related_assets`: verified upstream/downstream/related assets
- `get_diagnostic_context`: verified fault/diagnostic context
- `search_simlab_scenarios`: deterministic SimLab scenario matches
- `get_live_value`: approved live cache value only

## Verify

Run from `mira-hub/`:

```bash
npx tsc --noEmit
npx vitest run src/lib/external-ai/context-skill.test.ts src/app/api/factorylm/context/__tests__/route.test.ts
npx eslint src/lib/external-ai/context-skill.ts src/lib/external-ai/context-skill.test.ts src/app/api/factorylm/context/route.ts src/app/api/factorylm/context/__tests__/route.test.ts
```
