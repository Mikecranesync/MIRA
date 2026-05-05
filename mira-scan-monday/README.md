# MIRA Scan — monday.com Iframe Panel

AI-powered nameplate scanner + RAG chat that lives inside a monday.com item view.
Snap a photo of an industrial asset's nameplate, get structured specs, look it
up in the MIRA knowledge base, and either chat with the manual or upsell the
user into FactoryLM.

See `PRD.md` for the full spec.

## Stack
- **Backend:** FastAPI (Python 3.12, `httpx`, `pydantic`, `ruff`)
- **Vision:** GPT-4o (`/v1/chat/completions`, `image_url`)
- **RAG:** existing MIRA knowledge base (configurable via `MIRA_KB_BASE_URL`)
- **Frontend:** React 18 + Vite + monday Vibe (`@mondaydotcomorg/vibe`)
- **Auth:** monday seamless auth — `monday.get("context")` + `sessionToken`

## Quick start

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, MONDAY_API_TOKEN, MIRA_KB_BASE_URL
docker compose up -d --build
```

- Backend: http://localhost:8000  (`/healthz` returns `{"status":"ok"}`)
- Frontend (built): http://localhost:5173
- Dev frontend: `cd frontend && npm install && npm run dev`

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/healthz` | liveness |
| POST | `/scan/extract` | base64 image → `AssetPlate` |
| GET  | `/kb/lookup` | `?make=&model=` → `KBResult` |
| POST | `/chat/message` | grounded chat reply with sources |
| POST | `/monday/update-item` | write columns to a monday item |

## monday integration

Configure the iframe URL in your monday app's "Item view" feature to point at
the deployed frontend (e.g. `https://scan.factorylm.com/`). Inside the iframe,
the SDK supplies `boardId`, `itemId`, and a short-lived `sessionToken`.

Column ids default to `make`/`model`/`serial`/etc. — override per-board with
`MONDAY_COL_*` env vars.

## Constraints (per repo CLAUDE.md)
- `httpx` only (no `requests`/`urllib`)
- `ruff` for linting (`ruff check backend/`)
- No LangChain, no TensorFlow
- All secrets in `.env` (never committed) or Doppler in production
- Conventional commits

## Status
MVP scaffold. Vision extraction + monday writes are wired. RAG chat falls back
to a friendly stub if `MIRA_KB_BASE_URL` is unset, so the upsell flow is
testable without the KB online.
