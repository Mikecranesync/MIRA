# MIRA Scan — monday.com marketplace app

A **monday.com marketplace app** (item-view iframe panel) that turns a phone
camera into a maintenance flywheel:

1. Scan an industrial nameplate → GPT-4o Vision extracts make / model / serial /
   electrical specs.
2. Lookup against the MIRA knowledge base — live `kb_chunks` query (NeonDB).
3. **Hit** → grounded chat with the OEM manual via `mira-pipeline`.
4. **Miss** → real-time Serper search for the OEM PDF, validated via HEAD,
   handed to the existing `mira-crawler` queues. Next scan of the same
   equipment hits.
5. Save extracted specs straight to the monday.com item via GraphQL.

Live deployment: <https://app.factorylm.com/scan/>
(also accessible standalone for phone testing — does not require monday.com).

See `PRD.md` for the full product spec.

## Stack
- **Backend:** FastAPI on Python 3.12 (`httpx`, `pydantic`, `psycopg`, `ruff`)
- **Vision:** GPT-4o `chat/completions` with `image_url`
- **RAG:** mira-pipeline OpenAI-compat endpoint (model `mira-diagnostic`)
- **KB lookup:** live `kb_chunks` ILIKE query on NeonDB, with curated allowlist fallback
- **Manual discovery:** Serper (Google Search wrapper) — multi-pass query, OEM-domain ranking, SEO-spam deny list, HEAD validation
- **Crawler bridge:** writes discovered PDFs to NeonDB `manual_cache` AND `mira-crawler/cron/manual_queue.json` so the existing `kb_growth_cron` ingests them
- **Frontend:** React 18 + Vite + monday Vibe (`@vibe/core`)
- **Auth:** monday seamless auth — `monday.get("context")` + `sessionToken` for the iframe path; standalone path bypasses

## Quick start

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, SERPER_API_KEY, MIRA_KB_BASE_URL, NEON_DATABASE_URL,
# and (optionally) MONDAY_API_TOKEN for the marketplace app integration.
docker compose up -d --build
```

- Backend: <http://localhost:8000>  (`/healthz` returns `{"status":"ok"}`)
- Frontend (built): <http://localhost:5173>
- Dev frontend: `cd frontend && npm install && npm run dev`

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/healthz` | liveness |
| POST | `/scan/extract` | base64 image → `AssetPlate` (GPT-4o Vision) |
| GET  | `/kb/lookup` | `?make=&model=` → `KBResult`; auto-enqueues + fires search on miss |
| POST | `/chat/message` | grounded chat reply with source tags |
| POST | `/queue/search-now` | synchronous: enqueue + Serper + HEAD validate inline |
| GET  | `/queue/status` | queue summary, or `?make=&model=` for a single-row poll target |
| POST | `/queue/manual-request` | explicit enqueue (no auto-search) |
| POST | `/monday/update-item` | write extracted specs to a monday.com item via GraphQL |

## monday.com marketplace app integration

In your monday app's "Item view" feature, set the iframe URL to your deployed
frontend (e.g. `https://app.factorylm.com/scan/`). Inside the iframe, the
monday SDK supplies `boardId`, `itemId`, and a short-lived `sessionToken`.

Column id mapping defaults to `make` / `model` / `serial` / `voltage` / `hp` /
`rpm` / `hz` / `frame`. Override per-board with `MONDAY_COL_*` env vars.

## Manual-discovery flywheel

When a scan misses the KB, the backend fires a real-time search:

```
scan miss
  → BackgroundTasks → manual_search.run_search_and_update
      pass 1:  site:{oem_domain} "{model}" manual filetype:pdf
      pass 2:  {make} {model} manual filetype:pdf
      pass 3:  {make} {model} manual pdf
  → score (OEM hosts +120, deny SEO spam, partial-model match)
  → HEAD validate (Content-Type / %PDF- magic bytes)
  → crawler_bridge.record_scan_discovery
      1. NeonDB manual_cache (UNIQUE on manufacturer, model)
      2. /opt/mira/mira-crawler/cron/manual_queue.json
  → next 06:00 UTC: kb_growth_cron drains the JSON queue
      → full_ingest_pipeline → docling → chunk → embed → kb_chunks
  → next scan of the same equipment hits the KB → MiraChat with sources
```

OEM domains, deny list, scorer weights, and HEAD timeout are all in
`backend/manual_search.py`.

## Constraints (per repo CLAUDE.md)
- `httpx` only (no `requests`/`urllib`)
- `ruff` for linting (`ruff check backend/`)
- No LangChain, no TensorFlow
- All secrets in `.env` (never committed) or Doppler in production
- Conventional commits

## Status

Production scaffold. End-to-end paths verified live on the VPS:
- Vision extraction (Mike's actual Siemens / Beckhoff scans)
- Live `kb_chunks` lookup with curated allowlist fallback
- Grounded chat through mira-pipeline with source tags
- Real-time OEM manual discovery (Serper + HEAD validation)
- Hand-off into existing `manual_cache` + `manual_queue.json` queues
- monday.com GraphQL writes (per-tenant column-id mapping)

All flows are best-effort — a scan never fails because a downstream
queue is offline.
