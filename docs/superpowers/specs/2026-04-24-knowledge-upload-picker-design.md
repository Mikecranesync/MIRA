# Knowledge tab upload picker — design

**Status:** Approved 2026-04-24 (brainstorming pass, Mike test-client scope).
**Target:** `mira-hub` ≥ v1.2.0.
**Ships:** Knowledge tab's Upload button goes from no-op to a working pick-from-anywhere → pipe-into-KB flow.

## Problem

`/hub/knowledge` has an Upload button with no `onClick` handler. The OAuth connections shipped in `v1.1.0` (`hub_channel_bindings`) hold encrypted tokens for Google Drive, Dropbox, etc., but nothing in the product actually uses those tokens. Result: the Hub looks complete but can't ingest a single document. Unit 3 (magic email inbox) overlaps but doesn't cover the common case — "I have this PDF on my laptop / in Drive / in Dropbox and I want MIRA to know about it."

## Principle (locked in global `CLAUDE.md`)

Copy the trust signals users already recognize. Use **vendor-hosted pickers** (Google Picker API, Dropbox Chooser) and the **native browser file input** — do not build a hand-rolled "browse your cloud drive" UI. Familiar chrome is a trust signal.

## Scope

### In v1.2.0
- Upload button on `/hub/knowledge` opens a single modal offering three inputs:
  1. **Drop zone / native file picker** for local files (desktop + mobile — mobile browsers surface camera/photos/files automatically).
  2. **From Google Drive** button — opens Google Picker overlay, user picks, we ingest.
  3. **From Dropbox** button — opens Dropbox Chooser, user picks, we ingest.
- PDF-only (matches `mira-ingest/ingest/document-kb` validation; no pipeline change).
- Each queued file renders as an **upload block** above the indexed-docs list with: filename · source platform · file size · original created date · status.
- Status lifecycle: `queued → fetching → parsing → parsed` (greyed + strikethrough) · or `failed` (red) · or `cancelled`.
- Delete X available while non-terminal; on `parsed`, delete removes from KB via stored `kb_file_id`.
- UI polls `/hub/api/uploads` every 2s while any row is non-terminal; stops when all rows are terminal.

### Out of v1.2.0
- Confluence picker (Atlassian has no drop-in chooser widget; Mike isn't connected to a Confluence site anyway).
- OneDrive / SharePoint picker (Microsoft card is disabled in the Hub — no creds, no account).
- Folder navigation, multi-select, search within picker (Picker / Chooser already provide those natively — we don't add custom ones).
- Non-PDF types (would require expanding `mira-ingest/ingest/document-kb`; separate scope).
- Slack / Telegram message attachments.
- Re-parse button on failed rows (user can Delete + retry the pick).

## UX

Modal, opened from the Knowledge tab Upload button. Matches the Gmail / Slack / Notion "attach" pattern:

```
┌─ Add to Knowledge ────────────────────────────────┐
│                                                   │
│   ┌─────────────────────────────────────────┐    │
│   │   📄 Drop PDFs here or click to browse  │    │
│   │                                         │    │
│   │       (native OS / mobile picker)        │    │
│   └─────────────────────────────────────────┘    │
│                                                   │
│   — or pick from a connected source —             │
│                                                   │
│   [ 📁 From Google Drive ]  [ 📦 From Dropbox ]   │
│                                                   │
│   Connected sources only show when available;     │
│   disabled with tooltip if the provider isn't      │
│   connected or is missing creds.                  │
│                                                   │
└───────────────────────────────────────────────────┘
```

After the user picks a file, the modal closes and an upload block appears above the indexed-docs list:

```
┌──────────────────────────────────────────────────────┐
│ 📄 PumpManual-Rev3.pdf                               │
│ Google Drive · 2.3 MB · Apr 18, 2026                  │
│ ⏳ Fetching from Google…                         [X] │
└──────────────────────────────────────────────────────┘
```

Status transitions render in the same slot (in place):

- `queued` → `⏳ Queued`
- `fetching` → `⏳ Fetching from <provider>…`
- `parsing` → `⏳ Parsing to KB…`
- `parsed` → `✓ Parsed · 52 chunks` — row greyed, filename strikethrough, X icon stays for delete
- `failed` → `✗ Failed: <reason>` — row red, X icon for dismiss-and-retry
- `cancelled` → row removed on next poll

## Architecture

### New DB table (lazy `CREATE IF NOT EXISTS` via the same pattern as `hub_channel_bindings`)

```sql
CREATE TABLE hub_uploads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL DEFAULT 'mike',
  provider             TEXT NOT NULL,          -- 'google' | 'dropbox' | 'local'
  external_file_id     TEXT,                   -- Drive fileId, Dropbox path, null for local
  external_download_url TEXT,                  -- Dropbox direct link (short-lived), null otherwise
  filename             TEXT NOT NULL,
  mime_type            TEXT,
  size_bytes           BIGINT,
  external_created_at  TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'queued',
  status_detail        TEXT,
  kb_file_id           TEXT,                   -- Open WebUI file_id once parsed (for delete-from-KB)
  kb_chunk_count       INTEGER,                -- populated after parse completes
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hub_uploads_tenant_status ON hub_uploads (tenant_id, status);
```

### Endpoints (all under `mira-hub/src/app/api/`)

| Method & path | Purpose |
|---|---|
| `GET /picker/google/token` | Decrypts stored Google access token from `hub_channel_bindings` (refreshes via `refresh_token` if expired), returns `{accessToken, apiKey, clientId, appId}` for client-side Google Picker init. `apiKey` is `GOOGLE_PICKER_API_KEY` (new Doppler var). `appId` is the numeric project number. |
| `GET /picker/dropbox/key` | Returns `{appKey}` — just `DROPBOX_APP_KEY` (already in Doppler, Chooser only needs the public key). |
| `POST /uploads` | Body: `{source: 'google'\|'dropbox', fileRef: {id?, directUrl?}, filename, size, mime, externalCreatedAt}`. Inserts row status=`queued`, triggers `scheduleFetch(uploadId)` via Next.js `after()`. Returns created row. |
| `POST /uploads/local` | Multipart. Writes row status=`fetching`, streams file directly to `http://mira-ingest-saas:8001/ingest/document-kb`, updates row on response. |
| `GET /uploads` | Returns current tenant's rows (terminal + non-terminal). UI polls this every 2s while non-terminal rows exist. |
| `DELETE /uploads/:id` | Two behaviours depending on current status:<br>• non-terminal → marks `cancelled`, aborts any in-flight fetch (via `AbortController` keyed by upload id)<br>• `parsed` → calls Open WebUI's `DELETE /api/v1/files/{file_id}` with `kb_file_id`, then deletes the row |

### Background fetch flow (used by non-local sources)

```
POST /uploads (sync, <200ms)
  └── INSERT hub_uploads row status='queued'
  └── after(() => scheduleFetch(uploadId))  [Next.js 16 after()]

scheduleFetch(uploadId):
  try:
    UPDATE status='fetching'
    bytes = fetchFromProvider(row)           // uses stored token or short-lived URL
    UPDATE status='parsing'
    result = POST multipart to mira-ingest   // /ingest/document-kb
    UPDATE status='parsed',
           kb_file_id=result.file_id,
           kb_chunk_count=result.chunk_count
  catch err:
    UPDATE status='failed', status_detail=err.message
```

### Per-provider fetch detail

**Google Drive:**
1. Client calls Picker with `oauthToken` from `/picker/google/token` (browser-scoped, expires in ~1h).
2. Picker returns selected file: `{id, name, mimeType, sizeBytes}`.
3. Client POSTs `{source:'google', fileRef:{id}, ...}` to `/uploads`.
4. Server decrypts stored Google token (refreshes if needed), fetches `https://www.googleapis.com/drive/v3/files/{id}?alt=media` with `Authorization: Bearer ...`, pipes response body to mira-ingest.

**Dropbox:**
1. Client calls `Dropbox.choose()` with `linkType: 'direct'` and `extensions: ['.pdf']`.
2. Chooser returns selected file: `{link, name, bytes, icon}` — `link` is a pre-signed direct download URL valid ~4 hours.
3. Client POSTs `{source:'dropbox', fileRef:{directUrl: link}, ...}` to `/uploads`.
4. Server fetches `directUrl` (no auth needed — Dropbox signed the URL), pipes to mira-ingest.

**Local:**
1. User drags file or picks via native input.
2. Browser POSTs multipart to `/uploads/local`.
3. Server pipes stream directly to mira-ingest.

### Frontend components

Two new files, everything else is a light touch on the existing `knowledge/page.tsx`:

- `mira-hub/src/components/UploadPicker.tsx` — the modal. Loads Google Picker SDK and Dropbox Chooser SDK lazily via `next/script`. Shows disabled state for providers that aren't connected (reads `/hub/api/connections` on open).
- `mira-hub/src/components/UploadBlock.tsx` — a single upload row, takes a row from `/uploads`, renders the status variants, handles the X click.
- `mira-hub/src/app/(hub)/knowledge/page.tsx` — wire Upload button onClick, add `<UploadPicker />` mounted-when-open, fetch `/uploads` on mount and poll every 2s while non-terminal rows exist, render `<UploadBlock />`s above the existing filtered-docs list.

### Vendor SDK loading

Google Picker needs three things loaded:
1. `https://apis.google.com/js/api.js` — base client
2. `gapi.load('picker')` — picker module
3. Picker token from our `/picker/google/token`

Dropbox Chooser needs one `<script>` with `id="dropboxjs"` and `data-app-key`:
```html
<script id="dropboxjs" src="https://www.dropbox.com/static/api/2/dropins.js"
        data-app-key={appKey}></script>
```

Both loaded via `next/script` with `strategy="lazyOnload"` so they only pull on the Knowledge page.

### Secrets added to Doppler (`factorylm/prd`)

| Var | Purpose |
|---|---|
| `GOOGLE_PICKER_API_KEY` | API key for Google Picker (separate from OAuth secret). Created in Google Cloud Console → Credentials → Create credentials → API key → restrict to Google Picker API. |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | Numeric project number used as Picker `appId`. First segment of the OAuth client ID — e.g. `246891599587`. |

Existing `DROPBOX_APP_KEY` already covers Chooser.

## Reusing existing code

- `mira-hub/src/lib/bindings.ts` → `getAccessToken(provider, tenantId)` already decrypts stored tokens. Add a tiny `refreshIfExpired(provider)` helper beside it that uses stored `refresh_token` when expiry is within 5 min.
- `mira-core/mira-ingest/main.py` → `POST /ingest/document-kb` (line 687) is the exact target for all three sources. No backend changes in mira-ingest.
- `mira-hub/src/app/api/knowledge/route.ts` query already groups `kb_chunks` rows by source — if we set `source = 'hub-upload:<upload_id>'` on ingest, the Knowledge tab will show each upload as its own row once parsed (alternative: leave the default grouping and just count chunks).

## Error handling

| Failure | Detection | User sees |
|---|---|---|
| Provider token expired + no refresh | 401 from Drive API | `Failed: Google token expired — reconnect Google in Channels` |
| Provider file deleted between pick and fetch | 404 from Drive / Dropbox | `Failed: file no longer available` |
| File exceeds mira-ingest 20MB limit | pre-check `size_bytes`, set `failed` before scheduling fetch | `Failed: PDF too large (25 MB > 20 MB limit)` |
| Non-PDF MIME | pre-check, set `failed` | `Failed: Only PDF files are supported` |
| mira-ingest returns error | parse error from `/ingest/document-kb` | `Failed: <ingest error string>` (e.g. password-protected PDF) |
| Network timeout on provider fetch | 30s timeout via `AbortSignal` | `Failed: timeout fetching from <provider>` |
| User cancels | DELETE while non-terminal | row removed on next poll |

## Testing

- Unit: `bindings.ts` `refreshIfExpired` logic with mocked clock.
- Route tests (Playwright already set up in `mira-hub/tests`):
  - POST `/uploads/local` with a real small PDF → expect status reaches `parsed`, `kb_chunk_count > 0`.
  - GET `/picker/google/token` returns expected shape when bindings row exists; 503 when it doesn't.
  - DELETE `/uploads/:id` on `parsed` row → verify Open WebUI file is gone (mock the OW client).
- E2E (manual, by Mike as test client):
  - Drop a local PDF → block appears → parses → KB chunks show in Knowledge list.
  - Pick from Drive via Google Picker → same outcome.
  - Pick from Dropbox via Chooser → same outcome.
  - Mid-fetch X → row disappears, no KB pollution.
  - Parsed row X → KB row disappears.

## Time estimate

~8 hours focused work:
- 1 hr: DB schema + `hub_uploads` helpers in a new `lib/uploads.ts`.
- 1 hr: `/picker/google/token` + token refresh helper.
- 1 hr: `/uploads` + `/uploads/local` + `/uploads/:id` routes.
- 1 hr: `scheduleFetch` logic and per-provider fetch adapters.
- 2 hrs: `<UploadPicker />` component with both SDK integrations.
- 1 hr: `<UploadBlock />` + Knowledge page wiring + polling.
- 1 hr: E2E test pass + Doppler secrets + Google Picker API enablement in Google Cloud Console.

## Deliverables

- `mira-hub/v1.2.0` released (minor bump: new feature, new schema) with namespaced tag `mira-hub/v1.2.0`.
- Repo tag `v3.15.0` (or bundled into a larger release if other work lands concurrently).
- CHANGELOG entry under `docs/CHANGELOG.md` (if that file tracks per-release notes) or a GitHub Release on the new tag.

## Open questions (to resolve during implementation — do not block spec approval)

- Do we want a "upload history" panel showing completed-and-removed rows for audit? Default: no; terminal rows older than 24h get hidden from `/uploads` response. Add if Mike asks.
- Should local uploads be stored anywhere for re-ingestion if the KB is wiped? Default: no — rely on mira-ingest's existing ingest copy. User can re-upload.
