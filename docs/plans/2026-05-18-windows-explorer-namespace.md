# Windows 3.1 Namespace Explorer — Design Plan

**Date:** 2026-05-18  
**Branch:** `feat/hub-namespace-explorer`  
**Status:** Ready for implementation

## Goal

Transform the Namespace tab from a read-only AI-populated graph viewer into an interactive Windows Explorer-style knowledge filesystem. Users must be able to:

1. Create folders (namespace nodes) manually
2. Rename and delete nodes
3. Drag PDFs/photos/manuals directly onto folders to attach them
4. Browse hierarchy exactly like Windows 3.1 File Manager — split pane, toolbar, context menus, status bar
5. View files and asset details in the right content panel

---

## What Already Exists (reuse, don't reinvent)

| Asset | Path | Reuse |
|---|---|---|
| Namespace tree component | `src/app/(hub)/namespace/page.tsx:213–319` | Extend |
| Node move/rename PUT | `src/app/api/namespace/node/[id]/route.ts` | Add DELETE handler |
| Tree fetch from kg_entities | `src/app/api/namespace/tree/route.ts` | Add file counts + status |
| Radix DropdownMenu | `@radix-ui/react-dropdown-menu` | Context menus (no new dep) |
| Lucide icons | `lucide-react` | Add Folder, FolderOpen |
| `withTenantContext` | `src/lib/tenant-context.ts` | All new routes |
| `sessionOr401` | `src/lib/session.ts` | All new routes |
| `uns.slugify()` | `src/lib/uns.ts` | UNS path building |
| `RESERVED_LABELS` | `src/lib/uns.ts` | Validate new node names |
| `namespace_versions` audit | migration 021 | Append create/delete events |

**Verified:** The existing PUT route does a direct `UPDATE kg_entities` — no `kg_approval_state` gate. POST (create) and DELETE can follow the same pattern.

---

## Database — migration 024

### `mira-hub/db/migrations/024_namespace_direct_uploads.sql`

Reuse the existing `uploads` table for cloud-source files by adding a `namespace_node_id` FK. For direct desktop drag-drop (not Drive/Dropbox), add a separate table to avoid the pipeline-dependency.

```sql
-- Associate existing cloud uploads with namespace nodes
ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS namespace_node_id UUID
    REFERENCES kg_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uploads_namespace_node
  ON uploads (tenant_id, namespace_node_id)
  WHERE namespace_node_id IS NOT NULL;

-- Direct file uploads from drag-drop (desktop → namespace folder)
CREATE TABLE IF NOT EXISTS namespace_direct_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  node_id      UUID REFERENCES kg_entities(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes <= 10485760),
  content      BYTEA NOT NULL,
  uploaded_by  UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ndu_node
  ON namespace_direct_uploads (tenant_id, node_id);
CREATE INDEX IF NOT EXISTS idx_ndu_tenant
  ON namespace_direct_uploads (tenant_id, created_at DESC);

ALTER TABLE namespace_direct_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY ndu_tenant ON namespace_direct_uploads
  USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON namespace_direct_uploads TO factorylm_app;
```

**Critical rule:** List queries must never `SELECT content` — only `id, filename, mime_type, size_bytes, created_at`. Only the dedicated download endpoint fetches `content`. A stray `SELECT *` pulls megabytes into Node memory.

**Delete strategy:** Hard-delete on `kg_entities`. Do NOT add `deleted_at` — that column would propagate `WHERE deleted_at IS NULL` to `mira-bots`, `mira-crawler`, `mira-mcp`, and the engine. The `namespace_versions` audit row is the tombstone.

---

## Backend — 4 new/extended routes

### 1. `src/app/api/namespace/node/route.ts` (NEW — POST create)

```
POST /api/namespace/node
Body: { parentId?: string, name: string, kind?: string }
```

Logic:
1. Validate `name` non-empty; `kind` defaults to `"area"`, must be in `ENTITY_TYPES` whitelist
2. Slug the name via `uns.slugify()` — reject with 422 if slug is in `RESERVED_LABELS`
3. Resolve parent `uns_path` from `kg_entities WHERE id = parentId AND tenant_id = $tenantId`
4. Build child path: `parentPath + "." + slug` (or just `slug` if root)
5. INSERT into `kg_entities` (`entity_type`, `name`, `uns_path`, `tenant_id`)
6. INSERT into `namespace_versions` (operation=`create`, actor_kind=`human`)
7. Response: `{ ok: true, node: { id, name, kind, unsPath } }`

### 2. `src/app/api/namespace/node/[id]/route.ts` (EXTEND — add DELETE)

```
DELETE /api/namespace/node/:id
```

Logic:
1. Return 409 if node has children in `kg_entities WHERE parent determined by uns_path prefix`
2. Cascade-null: `UPDATE namespace_direct_uploads SET node_id = NULL WHERE node_id = $id`
3. Cascade-null: `UPDATE uploads SET namespace_node_id = NULL WHERE namespace_node_id = $id`
4. INSERT into `namespace_versions` (operation=`delete`, from_state=full entity snapshot as JSONB)
5. `DELETE FROM kg_entities WHERE id = $id AND tenant_id = $tenantId`
6. Response: `{ ok: true }`

### 3. `src/app/api/namespace/node/[id]/files/route.ts` (NEW)

```
GET  /api/namespace/node/:id/files    → list files attached to node
POST /api/namespace/node/:id/files    → upload file (multipart/form-data)
```

GET — returns merged list from both `namespace_direct_uploads` and `uploads WHERE namespace_node_id = $id`:
```json
{ "files": [{ "id", "filename", "mime_type", "size_bytes", "source", "created_at" }] }
```

POST — direct upload:
1. Parse `request.formData()` — single `file` field
2. Enforce 10 MB limit (413 if exceeded)
3. MIME allowlist: `application/pdf`, `image/*`, `text/*`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.*`
4. INSERT into `namespace_direct_uploads` with `content = Buffer.from(await file.arrayBuffer())`
5. Fire-and-forget: call `runIngestPipeline()` from `lib/upload-pipeline.ts`
6. Response: `{ ok: true, file: { id, filename, size_bytes } }`

### 4. `src/app/api/namespace/files/[id]/route.ts` (NEW)

```
GET    /api/namespace/files/:id    → download file
DELETE /api/namespace/files/:id    → remove file
```

GET — serves binary content:
- SELECT `content, mime_type, filename` WHERE `id = $id AND tenant_id = $tenantId` (cross-tenant 404)
- Return `Response` with `Content-Type`, `Content-Disposition: attachment; filename=...`

DELETE — removes file:
- DELETE WHERE `id = $id AND tenant_id = $tenantId`
- Response: `{ ok: true }`

### 5. `src/app/api/namespace/tree/route.ts` (MINOR EDIT)

Add to each `NamespaceNode`:
- `filesCount: number` — LEFT JOIN COUNT from `namespace_direct_uploads` + `uploads WHERE namespace_node_id`
- `status?: string` — LEFT JOIN `cmms_equipment.status` on `entity_id` for equipment nodes

---

## Frontend — `namespace/page.tsx` rewrite

### Layout

```
┌─ Toolbar ──────────────────────────────────────────────────────────┐
│ [New Folder] [Upload] [Expand All] [Collapse All]     [🔄 Refresh] │
├─ Tree Panel (280px) ──────────┬─ Content Panel ───────────────────┤
│ ▶ enterprise                  │  enterprise › building_a › elec   │
│   ▼ building_a                │  ┌─ Folders ─────────────────────┐│
│      ▼ electrical             │  │ 📁 mcc_01    📁 transformers  ││
│         mcc_01 ●              │  └───────────────────────────────┘│
│         transformers          │  ┌─ Files ────────────────────────┐│
│      hvac                     │  │ 📄 VFD_Manual.pdf   1.2 MB    ││
│   building_b                  │  │ 📄 Wiring_Dia.pdf   845 KB    ││
│                               │  └───────────────────────────────┘│
├───────────────────────────────┴───────────────────────────────────┤
│ 4 objects (2 folders, 2 files)  │  enterprise.building_a.elec     │
└────────────────────────────────────────────────────────────────────┘
```

### Visual style (industrial, dense)

| Element | Tailwind |
|---|---|
| Tree panel bg | `bg-[#f0f0f0] border-r border-gray-400 font-mono text-[13px]` |
| Content panel | `bg-white font-mono text-[13px]` |
| Toolbar | `bg-[#d4d0c8] border-b border-gray-400 flex gap-1 p-1` |
| Toolbar button | `border border-gray-500 bg-[#d4d0c8] hover:bg-[#e8e8e8] px-2 py-0.5 text-[12px]` |
| Tree row | `h-7 flex items-center gap-1 px-1 cursor-pointer select-none` |
| Selected row | `bg-[#000080] text-white` |
| Status bar | `bg-[#d4d0c8] border-t border-gray-400 text-[11px] px-2 py-0.5` |
| File drop target | `bg-[#c0c0ff] outline-2 outline-dashed outline-blue-600` |

### New state shape

```typescript
type EditingState = { nodeId: string; value: string } | null;
type NewFolderState = { parentId: string | null; value: string } | null;
type UploadProgress = { nodeId: string; progress: 'uploading' | 'done' | 'error' } | null;
type NodeFiles = Record<string, FileRecord[]>;

interface FileRecord {
  id: string; filename: string; mime_type: string;
  size_bytes: number; source: 'direct' | 'upload'; created_at: string;
}
```

### Toolbar

- **New Folder**: `setNewFolder({ parentId: selected?.id ?? null, value: "" })`
- **Upload**: trigger `<input type="file" multiple>` on selected node
- **Expand All / Collapse All**: toggle `expandedIds` set

### TreeNode extensions

- `Folder`/`FolderOpen` icon from lucide-react (area/line/system kinds); `Cog`/`Factory` for equipment
- **Status dot**: colored circle (green/yellow/red) from `node.status` field
- **Files count badge**: `({node.filesCount})` when > 0
- **Inline rename**: double-click → swap label with `<input>`, Enter/Blur → PUT `{ newName }`
- **New folder inline row**: when `newFolder.parentId === node.id`, render input as first child; Enter → POST; Escape → cancel
- **External file drop zone**: detect `event.dataTransfer.types.includes('Files')`, highlight node, `onDrop` → `uploadFiles(node.id, e.dataTransfer.files)`
- **Radix context menu** on right-click: `New Folder · Rename · Upload Files · ─ · Delete`

### ContentPanel

- Breadcrumb: `unsPath.split('.').map(segment => clickable link)`
- **Folders section**: icon grid of child nodes — click to select + expand in tree
- **Files section**: list with filename, size, date, download-on-click, delete-on-hover (×)
- **Drop zone overlay**: full-panel, `onDrop` → upload to selected node
- Skeleton loader while uploading

### StatusBar

- Left: `"N objects (X folders, Y files)"`
- Right: selected `unsPath`

---

## Part 2 — Nav Restructure + Assets → Namespace Merge

### Nav changes (`src/providers/access-control.ts`)

**Current nav has two parallel systems:** Assets (flat list) and namespace (hierarchical tree of the same entities). As namespace becomes the filesystem, Assets is redundant.

Restructure `NAV_ITEMS`:

| Group | Items |
|---|---|
| Intelligence | Conversations · Alerts · Event Log |
| Knowledge & Structure | **namespace** (primary) · Knowledge · ~~proposals~~ (moves to namespace tab) |
| Operations (promote from More) | Work Orders · Schedule · Reports · Parts |
| Platform | Channels · Integrations · Usage |

Remove from primary nav: `Assets` (absorbed), `proposals` (becomes namespace tab), `Ladder Logic` (stays in More until built).

Do NOT delete the `/assets` route — keep for backward compat / deep linking. Remove from nav only.

### Tabbed detail panel for equipment nodes

When `selected.kind` ∈ `['asset', 'equipment', 'component']`, ContentPanel shows tabs:

```
[Children] [Files] [Proposals] [Details] [Work Orders]
```

- **Details**: manufacturer, model, serial, status badge, QR link + Print QR button
- **Work Orders**: open WOs filtered by `entity_id`
- **Proposals**: pending/verified proposals for this node (replaces top-level proposals page per-node)
- **Files**: attached documents (from files routes above)

Non-equipment nodes: `[Children] [Files] [Proposals]`

### Status dots on tree nodes

Add `status?: string` to `NamespaceNode` — populated by LEFT JOIN on `cmms_equipment.status` via `entity_id` in the tree route.

---

## Files to create / modify

| File | Action |
|---|---|
| `db/migrations/024_namespace_direct_uploads.sql` | CREATE |
| `src/app/api/namespace/node/route.ts` | CREATE (POST) |
| `src/app/api/namespace/node/[id]/route.ts` | EXTEND (add DELETE) |
| `src/app/api/namespace/node/[id]/files/route.ts` | CREATE (GET + POST) |
| `src/app/api/namespace/files/[id]/route.ts` | CREATE (GET download + DELETE) |
| `src/app/api/namespace/tree/route.ts` | MINOR EDIT (+filesCount, +status) |
| `src/app/(hub)/namespace/page.tsx` | FULL REWRITE (~600 lines) |
| `src/providers/access-control.ts` | EDIT (nav restructure) |

---

## Execution sequence

1. Migration `024_namespace_direct_uploads.sql`
2. POST `/api/namespace/node` — create node
3. DELETE on `/api/namespace/node/[id]` — delete node
4. Files routes — upload, list, download, delete
5. Tree route — add filesCount + status
6. `page.tsx` — full rewrite (Explorer layout, toolbar, context menu, content panel, status bar)
7. `access-control.ts` — nav restructure

---

## Verification

```bash
# Apply migration
psql $NEON_DATABASE_URL -f mira-hub/db/migrations/024_namespace_direct_uploads.sql

# Run dev server
cd mira-hub && npm run dev

# Manual E2E golden path:
# 1. /hub/namespace — toolbar appears, split pane visible
# 2. Toolbar "New Folder" → type "Building A" → Enter → appears in tree
# 3. Right-click "Building A" → Rename → "Building_A" → Enter → label updates
# 4. Drag a PDF onto "Building A" in tree → file appears in right panel
# 5. Click PDF filename → download starts
# 6. Right-click leaf node → Delete → node gone; blocked if it has children
# 7. Drag node onto another folder → reparent (existing PUT)

# Regression suite
cd mira-hub && npx playwright test tests/e2e/
```

---

## Out of scope

- AI extraction on uploaded files (fire-and-forget `runIngestPipeline` only; integration deferred)
- Semantic / full-text file search
- MinIO/S3 object storage migration
- Tree virtualization for 100k+ nodes
- Multi-select drag
- Real-time collaborative sync
- Full deletion of `/assets` route (nav removal only this PR)
