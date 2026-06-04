# Connected Storage — Drive as Live Document Store

**Date:** 2026-06-01  
**Status:** Approved  
**Author:** Mike Harper / FactoryLM

---

## Problem

Plant maintenance teams organize OEM manuals, wiring diagrams, and datasheets in Google Drive, SharePoint, or Dropbox — not in MIRA. Asking them to upload those files again creates friction and doubles storage. The ICP pain: "Our manuals are in two SharePoints and one tech's truck."

## Solution

MIRA reads documents where they already live, indexes them for RAG search, and lets technicians associate files to equipment namespace nodes by dragging them onto the tree. Files never leave the provider — only the extracted text index lives in NeonDB.

## Providers at Launch

Google Drive, Microsoft SharePoint/OneDrive, Dropbox

## User Flow

1. Admin goes to `/settings/storage` → connects Google Drive (existing OAuth flow)
2. Selects a root folder to crawl
3. Clicks "Sync now" → MIRA walks the folder, indexes all PDFs and images
4. On the `/namespace` page, a "Connected Files" tab shows all indexed files
5. Tech drags a file onto a namespace node → file is associated to that equipment
6. When MIRA answers a question about that node, it cites the Drive document with an "Open in Drive" link

## Architecture

### Data Model (migration 030)

Three new tables in `mira-hub/db/migrations/030_connected_storage.sql`:

- **`connected_storage_providers`** — one row per OAuth connection per tenant (provider, root_path, display_name, sync_status)
- **`storage_file_index`** — one row per indexed file (external_file_id, external_url, filename, mime_type, index_status, kb_entry_count)
- **`storage_file_nodes`** — many-to-many bridge: file ↔ namespace node (created by drag-drop)

All three have RLS policies keyed on `tenant_id`.

`knowledge_entries` requires no migration — `source_type = 'connected_storage'` is a new text value (no enum constraint).

### Storage Client Layer (`mira-hub/src/lib/storage/`)

```
storage/
  types.ts           — StorageFile interface, StorageProvider interface
  providers/
    google-drive.ts  — Drive API v3 (list files, download content)
    sharepoint.ts    — Microsoft Graph API (list driveItems, download)
    dropbox.ts       — Dropbox API v2 (list_folder, download)
  index.ts           — getProviderClient(provider, token) → StorageProvider
  sync.ts            — storageSyncJob() orchestrator
```

Tokens come from `getBindingRow(provider, tenantId)` + `ensureFreshAccessToken()` (both exist in `bindings.ts` / `token-refresh.ts`).

### API Routes (`mira-hub/src/app/api/storage/`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/storage/providers` | List connected providers |
| POST | `/api/storage/providers` | Connect new provider |
| DELETE | `/api/storage/providers/[id]` | Disconnect + cascade delete |
| GET | `/api/storage/providers/[id]/files` | List indexed files with node associations |
| POST | `/api/storage/providers/[id]/sync` | Trigger sync job |
| POST | `/api/storage/files/[id]/associate` | Associate file to node (drag-drop) |
| DELETE | `/api/storage/files/[fileId]/associate/[nodeId]` | Remove association |

### Sync Job (`src/lib/storage/sync.ts`)

1. Set `provider.sync_status = 'syncing'`
2. Fetch fresh OAuth token via `ensureFreshAccessToken()`
3. Call `providerClient.listFiles(rootPath)` → `StorageFile[]`
4. Diff against `storage_file_index` (by `external_file_id + last_modified_at`)
5. For new/changed PDFs/images: download via `providerClient.getFileContent()` → `forwardToIngest()` → update index row
6. For removed files: mark `index_status = 'removed'`
7. Set `sync_status = 'idle'`, update `last_synced_at + file_count`

Runs synchronously (Phase 1 — small file counts). Move to background queue when scheduled sync is added.

### Ingest Integration

Reuses `forwardToIngest(stream, filename, mimeType)` from `mira-hub/src/lib/mira-ingest-client.ts`. Only PDFs and supported images are indexed; other MIME types set `index_status = 'skipped'`.

### Hub UI

- **`/settings/storage`** — new settings page with provider cards (connect/disconnect/sync)
- **`/namespace` page** — right panel gains "Connected Files" tab; file rows are draggable onto namespace tree nodes

## Reused Infrastructure

| Asset | Location |
|---|---|
| Google OAuth | `src/app/api/auth/google/` |
| Microsoft OAuth | `src/app/api/auth/microsoft/` |
| Dropbox OAuth | `src/app/api/auth/dropbox/` |
| Token storage + refresh | `src/lib/bindings.ts`, `src/lib/token-refresh.ts` |
| Google Picker token | `src/app/api/picker/google/token/route.ts` |
| Dropbox Chooser key | `src/app/api/picker/dropbox/key/route.ts` |
| Document ingest | `src/lib/mira-ingest-client.ts` → `INGEST_URL/ingest/document-kb` |

## Verification

1. Connect Google Drive folder with test PDFs → "Sync now" → `storage_file_index` rows with `index_status='indexed'`
2. Drag file onto namespace node → `storage_file_nodes` row created, node shows document badge
3. Ask MIRA question about that node → answer cites the Drive doc with external link
4. Delete file from Drive → "Sync now" → row marked `status='removed'`
5. Repeat for SharePoint and Dropbox
6. Disconnect provider → cascade delete of index + node association rows
