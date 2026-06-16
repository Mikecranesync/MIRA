# MIRA Scan — monday.com Iframe Panel App

**Version:** 0.1.0
**Owner:** Mike Harper
**Status:** MVP scaffold

## One-liner
A monday.com item-view panel that scans an asset nameplate (camera or upload), extracts equipment specs via GPT-4o Vision, looks them up in the MIRA knowledge base, and either chats with the matched manuals or upsells the user into FactoryLM.

## Goals
1. Reduce time-to-data-entry for industrial assets in monday.com from minutes to seconds.
2. Convert monday.com users into MIRA / FactoryLM leads when an asset isn't already covered.
3. Provide an in-context chat assistant grounded in OEM manuals for matched assets.

## Users
- **Maintenance planners** logging new equipment into monday boards.
- **Reliability engineers** asking quick spec/troubleshooting questions in-app.

## User flow
1. User opens an item in monday.com → MIRA Scan panel loads in iframe.
2. User taps **Scan plate** (camera capture) or **Upload photo**.
3. Backend `POST /scan/extract` returns structured `AssetPlate` (make/model/serial/voltage/hp/rpm/hz/frame/confidence).
4. Frontend renders `AssetCard`.
5. Backend `GET /kb/lookup?make=...&model=...` returns `KBResult`.
   - **Match** → render `MiraChat` (grounded chat with source tags).
   - **No match** → render `UpsellCTA` with "Add to FactoryLM" button.
6. User can press **Save to monday item** → `POST /monday/update-item` writes columns.

## API (backend)
| Method | Path | Purpose |
|---|---|---|
| POST | `/scan/extract` | base64 image → `AssetPlate` |
| GET  | `/kb/lookup` | `make`, `model` query → `KBResult` |
| POST | `/chat/message` | `{asset_id, message}` → assistant reply with sources |
| POST | `/monday/update-item` | `{item_id, board_id, columns}` → monday GraphQL update |

## Data models
```
AssetPlate {
  make: str
  model: str
  serial: str | None
  voltage: str | None
  hp: str | None
  rpm: str | None
  hz: str | None
  frame: str | None
  confidence: float
}

KBResult {
  matched: bool
  asset_id: str | None
  doc_count: int
}
```

## Auth
- monday seamless auth: frontend reads `monday.get("context")` inside iframe; sends `sessionToken` to backend on every request.
- Backend uses `MONDAY_API_TOKEN` (server-side) for GraphQL writes.

## Constraints
- Python 3.12 / `uv` / `ruff` / `httpx` (per repo CLAUDE.md).
- No LangChain. No TensorFlow.
- All secrets via env vars (no `.env` committed).
- Conventional commits.
- One container per service, healthchecked, pinned version.

## Out of scope (MVP)
- Multi-page manuals UI (just chat for now).
- Fine-grained ACL beyond monday session auth.
- PLC tag bridge (deferred to Config 4).
