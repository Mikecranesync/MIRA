# Scope: mira-web → mira-pipeline Cutover

**ADR:** ADR-0008 Phase 4 (final blocker before sidecar removal)  
**Issue:** #195  
**Status:** Pending — DO NOT start until OEM doc migration (task 2b) is complete  
**Risk:** Low — mira-web is not publicly routed; 503 on sidecar stop is acceptable

---

## Current State

`mira-web/src/lib/mira-chat.ts` proxies AI chat through the sidecar's `/rag` endpoint.

**Call site:** `mira-web/src/server.ts:887` → `queryMira()` → `POST http://mira-sidecar:5000/rag`

**Current request:**
```typescript
// POST http://mira-sidecar:5000/rag
{
  query: string,       // user's question
  asset_id: string,    // empty string if no asset context
  tag_snapshot: {},    // always empty in current code
  context: ""          // always empty in current code
}
```

**Current response:**
```typescript
{
  answer: string,      // LLM-generated answer
  sources: [           // RAG citations
    { file: string, page: string, excerpt: string, brain: string }
  ]
}
```

**Affected files** (3):
- `mira-web/src/lib/mira-chat.ts` — all sidecar logic lives here
- `mira-web/src/server.ts:887` — calls `queryMira()`, processes WO recommendation from `response.answer`
- `mira-web/docker-compose.yml` / `docker-compose.saas.yml` — `SIDECAR_URL` env var

---

## Target State

Replace the sidecar `/rag` call with an OpenAI-compat call to mira-pipeline.

**New request:**
```typescript
// POST http://mira-pipeline:9099/v1/chat/completions
// Authorization: Bearer ${PIPELINE_API_KEY}
{
  model: "mira-diagnostic",
  messages: [
    { role: "user", content: query }
  ],
  user: tenantId        // maps to GSD chat_id for FSM state isolation
}
```

**New response:**
```typescript
// Standard OpenAI chat completion
{
  choices: [
    { message: { role: "assistant", content: string } }
  ]
}
```

---

## Key Differences and Implications

### 1. Sources / Citations
The sidecar returned `sources[]` with explicit file/page citations.  
The pipeline returns **only the answer text** — citations are embedded inline if the LLM includes them.

**Impact:** `mira-web/public/mira-chat.js` renders source chips using `response.sources`.  
**Fix:** Remove source rendering from the UI, or parse inline citations from answer text.  
Check `mira-web/public/mira-chat.js` for the rendering code before deciding.

### 2. Session State (FSM)
The sidecar was stateless per request — each call was independent.  
The pipeline maintains FSM state keyed on `chat_id` (mapped from the `user` field).

**Impact:** Each mira-web user will now have a persistent diagnostic conversation state.  
**Benefit:** Multi-turn diagnostic sessions work properly.  
**Concern:** The `reset()` endpoint (`DELETE /v1/sessions/{chat_id}`) should be wired to the "New Chat" button.  
**Fix needed:** Add session reset logic in mira-web when user starts a new chat.

### 3. Authentication
The pipeline requires `Authorization: Bearer ${PIPELINE_API_KEY}`.  
The sidecar had no bearer auth on the `/rag` endpoint (network-isolated only).

**Fix:** Add `PIPELINE_API_KEY` to:
- Doppler `factorylm/prd`
- `mira-web/docker-compose.yml` environment block
- `docker-compose.saas.yml` mira-web environment block (already has `MCP_REST_API_KEY` pattern to follow)

### 4. Tenant Isolation
The sidecar's `/rag` endpoint had no tenant scoping.  
The pipeline's GSDEngine uses `MIRA_TENANT_ID` env var for NeonDB knowledge scoping.

**Current state:** `mira-pipeline-saas` uses a single `MIRA_TENANT_ID` for all users.  
**Concern:** All mira-web tenants currently share the same pipeline knowledge scope.  
**Short-term fix (acceptable for beta):** Single tenant ID is fine — all beta users see the same OEM knowledge base.  
**Long-term:** The pipeline's `user` field should eventually map to per-tenant `MIRA_TENANT_ID`. This requires refactoring `chat_tenant.py` in the shared engine (out of scope for this PR).

### 5. WO Recommendation Parsing
`mira-web/src/server.ts` calls `parseWORecommendation(response.answer)` looking for `"WO RECOMMENDED:"` in the answer.  
The pipeline answer goes through the same GSD engine prompts, so this format should be preserved.  
**Verify:** Check `mira-bots/prompts/diagnose/active.yaml` — confirm the WO recommendation format is still `WO RECOMMENDED: <title> | Priority: <level>`.

---

## Effort Estimate

| File | Change | Effort |
|------|--------|--------|
| `mira-web/src/lib/mira-chat.ts` | Rewrite `queryMira()` to call `/v1/chat/completions`; remove `MiraSource[]` type | 2h |
| `mira-web/src/server.ts` | Update imports; add session reset endpoint | 1h |
| `mira-web/public/mira-chat.js` | Remove source chip rendering (or adapt) | 1h |
| `mira-web/docker-compose.yml` | Add `PIPELINE_API_KEY` env var; remove `SIDECAR_URL` | 15m |
| `docker-compose.saas.yml` | Update mira-web env block (`PIPELINE_API_KEY`, remove `SIDECAR_URL`) | 15m |
| `mira-web/CLAUDE.md` | Update "AI Chat" section to reflect pipeline | 15m |
| Tests | Update `mira-web/src/seed/__tests__/knowledge-seed.test.ts` if it mocks sidecar | 30m |
| **Total** | | **~5h** |

---

## Pre-conditions (must be true before starting)

- [ ] OEM doc migration complete (task 2b — 398 chunks in Open WebUI KB)
- [ ] `PIPELINE_API_KEY` exists in Doppler `factorylm/prd`  
  (`doppler secrets get PIPELINE_API_KEY --project factorylm --config prd`)
- [ ] mira-pipeline-saas healthy on VPS: `curl -s https://app.factorylm.com/health` (via nginx proxy if routed, or SSH)

---

## Acceptance Criteria

1. `mira-web/src/lib/mira-chat.ts` has zero references to `SIDECAR_URL` or `/rag`
2. `queryMira()` returns `{ answer: string }` (sources removed or sourced inline)
3. `POST /api/mira/chat` returns 200 with answer from pipeline when sidecar is stopped
4. WO recommendation parsing still works (`parseWORecommendation()` returns non-null on valid pipeline answer)
5. `docker-compose.saas.yml` mira-web block has `PIPELINE_API_KEY` and no `SIDECAR_URL`
6. `docker compose logs mira-web | grep "sidecar"` returns nothing

---

## What This PR Does NOT Include

- Per-tenant knowledge scoping (requires `chat_tenant.py` refactor — separate issue)
- mira-sidecar container removal (happens after this lands + volume migration verified)
- nginx route changes (mira-web is not publicly routed yet)
