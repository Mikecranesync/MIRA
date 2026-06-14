# Changelog

All notable changes to mira-hub. Format follows the project's Versioning Discipline rule: one line per release, namespaced semver tag at merge.

## v2.4.0 — 2026-06-14
- fix(schedule): PM "Mark Complete" now persists via new `POST /api/pm-schedules/[id]/complete` (stamps `last_completed_at`, rolls `next_due_at` forward, resets meter cycle for meter PMs); trigger buttons use `${API_BASE}/api/...` (was hardcoded `/hub/api`) with `res.ok` checks + error toasts + local-state sync; self-contained synthetic `tools/seed_demo_tenant_pms.sql` for the demo tenant (#1950)

## v2.2.7 — 2026-06-12
- fix(hub): a manual uploaded via Knowledge → Upload is now one click from being asked about. The PDF was already chunked + attached to the per-tenant Inbox node and citable (#1806), but nothing pointed the user there: the post-upload card said "Parsed", the Inbox folder read "0 files", and the user's own folder's Ask MIRA structurally can't reach Inbox docs (subtree-scoped retrieval) → felt broken. Now (1) the upload summary card shows an **"Ask MIRA about this manual"** CTA deep-linking to `/namespace?node=<inbox>&chat=1`; (2) `namespace?node=&chat=1` selects + expands the target node and auto-opens Ask MIRA; (3) node `files_count` + the folder Files list now include v2-indexed PDFs (`hub_uploads.kg_entity_id`), shown as read-only "indexed" entries — killing the "0 files" lie. No schema change. (The reported "Knowledge upload hits the demo `/api/documents/upload`" was stale — it's hit `/api/uploads/local` since the Knowledge-tab unification; that demo endpoint is now-orphaned dead code, noted for separate cleanup.) (#1900)

## v2.2.6 — 2026-06-12
- fix(hub): fresh-tenant Feed header no longer shows a hardcoded "Mike Harper · Admin" — it now renders the real signed-in user (name + role) from `/api/me`, the same source as the sidebar, and renders nothing until loaded. Also replaced the leftover "Mike Harper" placeholder in the labs-only Conversations/Team mock data with a generic name. No real cross-tenant data was leaking — the strings were hardcoded. (#1904)

## v2.2.5 — 2026-06-12
- security(hub): node-attachment manual chunks are now written `is_private = true` (`writePdfChunksForNode`). They were inserted without it → defaulted `false` → a tenant's uploaded manual could surface in other tenants' library/aggregate views via the hybrid read filter `(is_private = false OR tenant_id = $caller)` (#1833 leak class). Migration 052 backfills existing v2 node_attachment chunks to private; shared OEM corpus untouched. Adds a regression test pinning the INSERT to `is_private = true`. (#1903)

## v2.2.4 — 2026-06-12
- fix(hub): folder=brain PDF upload 500 — second cause. Signup created only the auth-side `hub_tenants` row, never the data-side `tenants` row that `knowledge_entries.tenant_id` FK-references, so a fresh tenant's first manual upload threw `23503 knowledge_entries_tenant_id_fkey` ("Server storage error") even after the unpdf fix. `createUser` now creates the `tenants` row (id, name, contact_email) at signup; migration 051 backfills existing fresh tenants. Verified against the live prod FK + reproduced fixed on staging. Closes the upload→retrieval gap for strangers. (#1899)

## v2.2.3 — 2026-06-12
- fix(hub): magic-link page (`/magic`) no longer renders the authenticated app chrome to signed-out visitors. It lived inside the `(hub)` route group, so its `Sidebar` fired `GET /api/me` pre-auth → a `401` console error + the full nav (Feed/Admin/Review queue) bleeding behind the full-screen sign-in gradient. Moved out of `(hub)` to a top-level route (same `/magic` URL, root layout only) — matching the existing `login`/`signup`/`m`/`quickstart` pre-auth pattern. Console clean; no nav leak.
## v2.2.2 — 2026-06-12
- fix(hub): folder=brain PDF upload no longer 500s — `unpdf` is now in `serverExternalPackages` so its runtime `import('unpdf/pdfjs')` resolves in the `output: standalone` build (was dropped from the trace → `Cannot find module 'unpdf/pdfjs'` on every PDF upload). Upload errors now surface a specific message + a durable error row in the Files panel instead of looking like "nothing happened". Adds a standalone-bundling regression guard + a real upload→citation e2e. Unblocks the beta gate. (#1899)

## v2.2.1 — 2026-06-11
- fix(hub): Command Center — every tree node is now selectable; the detail panel no longer freezes on the one live-display node. Selection was gated on `hasLiveDisplay`, swallowing clicks on VFDs / PLCs / folders. Refresh button now spins + disables while fetching. (#1881)

## v2.2.0 — 2026-06-07
- fix(hub): Command Center selecting a node with a live display renders **"Open Live View"** button (target=`_blank`, rel=`noopener noreferrer`) instead of an embedded iframe. Iframe was XFO=SAMEORIGIN blocked. Top-level navigation ignores XFO; matches direct-connection handoff model. (#1765)

## v2.1.4 — 2026-06-07
- security(hub): HSTS + X-Frame-Options + remove X-Powered-By; /scan CSP frame-ancestors *.monday.com (#1762)

## v2.1.3 — 2026-06-07
- fix(hub): unauth /api/* returns 401 JSON instead of 308→/login HTML (#1764)

## v2.1.2 — 2026-06-07
- fix(hub): /scan 412px mobile overflow (#1763)

## v2.1.1 — 2026-06-06
- fix(hub): /api/usage KB Chunks tile now returns total knowledge_entries (#1761)

## [1.9.1] - 2026-05-22
### Fixed
- `/hub/namespace` — clicking `+` on a synthesized parent row (kind=`namespace`, id prefixed `synthetic:`) returned `400 parentId required (uuid)` with no way to recover, because POST `/api/namespace/node` requires a UUID and synthesized nodes have no kg_entities row. Hide the `+` button on synthesized rows and show a short hint ("run onboarding to add") so the user is steered to the wizard that materializes a real parent. Inline-create remains available on every real (UUID-id) row.

## [1.9.0] - 2026-05-21
### Added
- `/hub/namespace` — inline child creation on every tree row. A `+` button (always visible, ≥44×44 tap target) expands a card under the parent with a kind dropdown (site/area/line/equipment/component/namespace/custom), name input, live read-only path preview (`parent.uns_path.<slug>`), and 3-source file attach (Google Drive, Dropbox, Upload-from-device). Save creates the kg_entities row + writes a `namespace_versions` audit row (operation=create) + binds any attached file's `hub_uploads.uns_path` to the new node. Mobile-first; Playwright suite covers 9 acceptance scenarios incl. iPhone viewport tap-target check.
- `POST /api/namespace/node` — new create endpoint. Body `{parentId, kind, name, uploadId?}`. 201 on success, 409 duplicate-name, 404 parent-not-found, 401 unauth.
- `uns_path` column on `hub_uploads` (idempotent ALTER) — populated when an upload is bound to a namespace node during inline create. Existing rows stay NULL.
- `POST /api/uploads` and `POST /api/uploads/local` accept optional `unsPath` field (validated against ltree `^[a-z0-9_]+(\.[a-z0-9_]+)*$` format).

## [1.8.0] - 2026-05-20
### Added
- `/hub/admin/review` — **read-only** preview gallery. One page, all pending artifacts visible in one place: KG relationship proposals + cartoons + screenshots + web-review findings. Admin-only (ADMIN_EMAILS allowlist). Mobile-first. No approve/publish action wired in this PR — surface is purely for visibility while the publish workflow gets designed. Read-only compose mounts for `marketing/`, `docs/promo-screenshots/`, `tools/web-review-runs/`.

## [1.7.0] - 2026-05-18
### Changed
- Feed page renders live work-order + PM data from `/api/work-orders` and `/api/pm-schedules` (#1033). KPI cards show real Open WO / Overdue PM / Total WO / Auto-Extracted PM counts; hardcoded `12 / 3 / 2.4h / 67%` values removed. Feed items composed from the most-recent 5 work orders + 3 nearest-due PM schedules.
- Schedule page FALLBACK_PMS array emptied — page now renders strictly from `/api/pm-schedules` on the demo tenant (seeded via `tools/seed_demo_tenant_pms.sql`).

## [1.6.1] - 2026-05-18
### Fixed
- DB migration 023 grants `factorylm_app` SELECT/INSERT/UPDATE on relationship_proposals, relationship_evidence, component_templates, component_template_sources, installed_component_instances, health_scores, wizard_progress, namespace_versions. Fixes HTTP 500 on /api/namespace/tree, /api/proposals, /api/readiness, /api/components/[id] and related routes — same RLS-role grant gap that #1345/#1343/#1344 surfaced. Requires `gh workflow run "Apply Prod Migrations"` after merge.

## [1.6.0] - 2026-05-17
### Removed
- Actions tab removed from primary nav and mobile bottom tabs (mock-data only, no backend)

## [1.4.0] - 2026-04-26
- Upload-pipeline hardening sweep — tenant_id filter on updateUploadStatus (#707), structured JSON logs + X-Request-Id propagation (#709), path-traversal sanitization on asset_tag (#726), magic-byte file sniffing on PDF/image uploads (#729), AbortSignal/timeout on every outbound fetch (#730), SSRF guard + manual-redirect re-validation on streamFromSignedUrl (#731), cloud-source upload idempotency (#733), manual retry endpoint POST /api/uploads/:id/retry (#734).

> **Note on prior v1.4.0 attempt:** A `mira-hub/v1.4.0` tag briefly existed pointing at orphan commit `a2ceac7` (an attempted release of the UX audit + Playwright suite work that was prepared on a branch never merged to `main`). The underlying UX-audit and mobile-upload feature work itself did land via PR #715 and others, but the release-prep commit and its tag were stranded. The orphan tag was deleted on 2026-04-26 and v1.4.0 reused for today's upload-pipeline hardening sweep.

## [1.3.0] - 2026-04-25
- Photos upload — JPEG/PNG/WebP/HEIC + multi-select + asset linking (#546)

## [1.2.0] - 2026-04-25
- Knowledge upload picker — Google Picker + Dropbox Chooser + local file picker (#540)

## [1.1.0] - 2026-04-24
- First tagged release. NeonDB-backed API (6 routes), Playwright e2e suite (76/76), i18n (EN/ES/HI/ZH), design system + login/feed pages.
