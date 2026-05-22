# Changelog

All notable changes to mira-hub. Format follows the project's Versioning Discipline rule: one line per release, namespaced semver tag at merge.

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
