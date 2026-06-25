---
name: factorylm-context-bridge
description: >
  Use when Codex, Claude Code, or another coding agent needs to query, extend,
  review, test, or wrap FactoryLM's External AI Context Skill or related
  read-only factory context access. Trigger on requests about FactoryLM external
  AI tools, MCP/API wrappers, approved asset context, UNS/tag context, evidence
  citations, SimLab scenario lookup, live-read gating, or preventing external
  agents from hallucinating factory data. Also use when coding against
  mira-hub/src/lib/external-ai/context-skill.ts.
---

# FactoryLM Context Bridge

FactoryLM is the governed industrial context layer. MIRA is one native client.
External AI clients must get context through structured, read-only calls, not by
inventing facts or duplicating MIRA chat behavior.

## Core Rule

Do not build a chatbot, raw SQL endpoint, or parallel context system. Use or
extend `mira-hub/src/lib/external-ai/context-skill.ts` first.

## Workflow

1. **Inspect existing context surfaces** before editing:
   - `mira-hub/src/lib/external-ai/context-skill.ts`
   - `mira-hub/src/app/api/factorylm/context/route.ts`
   - `mira-hub/src/lib/i3x/data-access.ts`
   - `mira-hub/src/lib/i3x/index.ts`
   - `mira-hub/src/lib/manual-rag.ts`
   - `mira-hub/src/lib/tenant-context.ts`
   - `tests/simlab/scenarios/`
2. **Choose the narrowest tool** for the question. See
   `references/tool-selection.md`.
3. **Preserve the response envelope**:
   - `ok`
   - `found`
   - `tool`
   - `data`
   - `evidence`
   - `confidence`
   - `approvalState`
   - `notFoundReason` or `refusedReason` when applicable
4. **Keep reads gated**:
   - KG rows exposed to agents require `approval_state = 'verified'`.
   - live values require `approved_tags.enabled = true` before reading cache.
   - documents default to verified/approved evidence only.
   - draft/internal context must be explicitly labeled.
5. **Return structured facts only**. Do not synthesize troubleshooting prose in
   this layer.
6. **Refuse unsafe tools** before DB access. Unknown tool names, write-like
   names, PLC writes, tag writes, and raw SQL requests must return `ok: false`
   with `refusedReason`.
7. **Test with injectable dependencies**. Do not require Neon, a dev server, or
   live credentials for unit tests.

## When Coding

- Add functions inside the existing skill module unless a route/MCP wrapper is
  explicitly in scope.
- For API work, use `POST /api/factorylm/context` and delegate to the skill
  dispatcher. Resolve tenancy with existing i3X bearer keys first, then Hub
  session fallback. Do not create a new API-key system in this layer.
- Prefer pure helpers plus an injectable `runWithTenant` dependency.
- Use `withTenantContext` for the default runtime path.
- Reuse i3X projection helpers for related objects and live values.
- Keep SimLab lookup file-backed and deterministic unless the caller asks for
  simulator execution.
- Add tests for both success and fail-closed behavior.

## Verification

Run from `mira-hub/`:

```bash
npx tsc --noEmit
npx vitest run src/lib/external-ai/context-skill.test.ts src/app/api/factorylm/context/__tests__/route.test.ts
npx eslint src/lib/external-ai/context-skill.ts src/lib/external-ai/context-skill.test.ts src/app/api/factorylm/context/route.ts src/app/api/factorylm/context/__tests__/route.test.ts
```

If adding API or MCP wrappers, also test auth boundaries and refusal of writes.

## Cross-References

- `mira-platform` for MIRA product and environment doctrine.
- `mira-uns-architecture` for UNS path and confirmation-gate rules.
- `retrieval-diagnostics` when evidence retrieval misses or cites the wrong
  vendor.
- `mira-industrial-safety` when a user asks for safety-critical advice.
