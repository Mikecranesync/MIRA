# ADR-0008: Deprecate mira-sidecar — Migration to mira-pipeline + Open WebUI KB

## Status
Accepted — in progress

**Supersedes:** The implicit design in which mira-sidecar was the primary LLM/RAG backend.
**Follows:** ADR-0007 (Notebook Intelligence Layer — Open WebUI + MIRA Pipeline)

---

## Context

`mira-sidecar` was the original RAG backend for MIRA. It exposed a FastAPI service on
`:5000` with a three-brain retrieval pipeline:

- **Brain 1** — ChromaDB `shared_oem` collection: 398 OEM manual chunks (pdfplumber-extracted)
- **Brain 2** — ChromaDB `mira_docs` collection: 11 tenant-specific document chunks
- **Brain 3** — NeonDB pgvector (optional): cloud-hosted cross-session knowledge

The sidecar owned the full LLM inference stack (Anthropic / OpenAI / Ollama), semantic
chunking, safety keyword detection, and an optional Path B tier-routing system for
local-first inference.

### Why it was built

At the time, MIRA had no native knowledge layer. The sidecar filled that gap with
a purpose-built FastAPI service that any caller (Telegram bot, Ignition HMI, Open WebUI
via Pipe Function) could POST `/rag` to and receive a structured diagnostic answer.

### Why it is now legacy

ADR-0007 (Notebook Intelligence Layer, Apr 2026) introduced two components that
collectively replace the sidecar's role in the active user-facing architecture:

1. **`mira-pipeline`** — An OpenAI-compatible FastAPI service wrapping `GSDEngine`
   (from `mira-bots/shared/`). Open WebUI is configured with
   `OPENAI_API_BASE_URLS=http://mira-pipeline-saas:9099/v1` — every chat message
   from a user's phone now goes through the pipeline, not the sidecar.

2. **Open WebUI native knowledge collections** — Documents are ingested through the
   Open WebUI UI (with Docling for PDF/table extraction). The pipeline queries these
   collections via the Open WebUI `/api/retrieval/` endpoints. The sidecar's ChromaDB
   is bypassed entirely on this path.

---

## Current State (as of 2026-04-13)

### What is still running

The sidecar (`mira-sidecar` container) remains deployed on `factorylm-prod` and is
healthy. It was kept because:

1. **`mira-web`** — A Next.js PLG web frontend (`mira-web/` container on port 3200)
   calls `POST http://mira-sidecar:5000/rag` for all chat. However, `mira-web` has no
   public nginx route and is not currently accessible to end users. This dependency is
   internal-only.

2. **Ignition HMI integration** (`ignition/webdev/FactoryLM/api/chat/doPost.py`) calls
   `http://localhost:5000/rag`. Ignition is not yet deployed — this is future work.

3. **398 OEM docs in Brain1 ChromaDB** have not yet been migrated to Open WebUI
   knowledge collections. Until this migration runs, removing the sidecar container
   would lose this data.

### What has zero active callers

- `nginx /sidecar/` reverse proxy route — confirmed zero legitimate traffic in full
  access log history (3 hits total: all from this investigation session + 1 scanner
  probe for `config.js`)
- `mira-sidecar/openwebui/mira_diagnostic_pipe.py` — the old Open WebUI Pipe Function
  that routed through the sidecar; superseded by `mira-pipeline` (OpenAI-compat API)
- `/route` endpoint (Path B tier routing) — feature-flagged off on VPS

---

## Decision

Deprecate `mira-sidecar` in three phases:

### Phase 1 — Documentation (this ADR + CLAUDE.md updates)
Mark the sidecar as legacy in all project docs. No callers should be added.

### Phase 2 — Remove dead code paths (zero runtime impact)
1. Remove the `nginx /sidecar/` location block from `factorylm-prod` — no legitimate
   callers, confusing to keep.
2. Remove `mira-sidecar/openwebui/mira_diagnostic_pipe.py` from the repo — this file
   predates the pipeline architecture and is no longer the integration point. If it was
   ever manually installed as a Function in Open WebUI, it should be unregistered via
   Settings > Functions.

### Phase 3 — OEM doc migration (requires production window)
Migrate 398 OEM chunks from sidecar's ChromaDB `shared_oem` collection into an Open
WebUI knowledge collection named **"OEM Library — MIRA Shared"**. After migration,
verify RAG quality parity (same embedding model: `nomic-embed-text` / Ollama on both
sides), then stop and remove the sidecar container.

See: `docs/runbooks/sidecar-oem-migration.md` for the step-by-step plan.
See: `tools/migrate_sidecar_oem_to_owui.py` for the migration script.

### Phase 4 — mira-web cutover (separate ticket)
`mira-web` must be rewritten to call `mira-pipeline` (OpenAI-compat endpoint at
`:9099`) instead of `mira-sidecar:5000`. This is tracked separately — it's a
non-trivial change to `mira-web/src/lib/mira-chat.ts` and the server-side SSE
streaming logic.

---

## Migration Blockers Checklist

| Blocker | Owner | Status |
|---------|-------|--------|
| 398 OEM docs in ChromaDB → Open WebUI KB | Charlie / Mike | Pending (runbook written, not executed) |
| mira-web chat → mira-pipeline cutover | mira-web ticket | Not started |
| Ignition /rag target update | Config 4 work | Deferred with Config 4 |
| Verify nomic-embed-text parity (sidecar vs Open WebUI Ollama) | Charlie | Pending |

---

## Consequences

### Positive
- Removes a parallel LLM/RAG stack that diverged from the production path
- Eliminates the ChromaDB volume dependency (once migration completes)
- All chat intelligence consolidates into one path: Open WebUI → mira-pipeline → GSDEngine
- `GSDEngine` improvements (FSM, guardrails, prompt tuning) automatically benefit all
  surfaces — phone, Telegram, Slack — without maintaining two inference stacks

### Negative
- The sidecar's `POST /build_fsm` endpoint (statistical FSM learning from tag history)
  has no equivalent in mira-pipeline. This feature was unused in production but may
  be wanted for future Ignition integration. **It should be extracted as a standalone
  utility or microservice before the sidecar container is removed.**
- The sidecar's Path B tier-routing (`/route`, `TIER_ROUTING_ENABLED`) is not yet
  replicated. This is acceptable — tier routing was feature-flagged off on VPS and
  is now served by `docker-compose.pathb.yml` on Charlie.

### Risks
- ChromaDB volume on VPS (`mira-chroma`) contains the 398 OEM docs and 11 tenant docs.
  Do NOT `docker volume rm` before the migration is verified complete and signed off.
- The `mira-web` container depends on the sidecar. Removing the sidecar before
  mira-web is cutover will break mira-web chat silently (container stays up, chat
  returns 503).

---

## Related ADRs
- ADR-0003: Edge Inference Strategy — local fallback path context
- ADR-0007: Notebook Intelligence Layer — the replacement architecture this deprecation
  follows from
