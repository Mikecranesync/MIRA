# QR / Asset-Tagging — Open-Source Evaluation for MIRA

**Date:** 2026-05-15
**Author:** Claude (Opus 4.7) — research + opinion
**Status:** Decision document — recommendation locked, build plan below

---

## 1. Executive Recommendation

**Do not fork, host, or directly depend on any of the four repos.**

MIRA already has a **production QR pipeline** at `mira-web/src/{lib,routes}/` — 1,711 lines of Bun/Hono TypeScript, NeonDB-backed, multi-tenant, with Avery 5163/5160 sticker sheets, channel-aware routing (Telegram / Open WebUI / Slack / guest), and a scan-to-chat redirect that already lands the user inside MIRA. Three of the four open-source candidates are AGPL-3.0 and would force us to open-source `app.factorylm.com`. Two are PHP monoliths in a Bun stack. One is a Windows desktop tool.

**This evaluation confirms — not supersedes — the `qr-onboarding` skill** (`.claude/skills/qr-onboarding/SKILL.md`). That skill already documents the four onboarding modes (demo sheet, customer pack from explicit tags, NeonDB pull, bulk-register) running on `tools/qr-label-pdf.py` and `tools/qr-register-assets.py`. The recommendation below extends that direction with three migrations and five Hono routes; it does not redirect it.

The right play is:

1. **Keep MIRA's existing QR stack** — it works, it is on the right stack, and it is the only one that already speaks UNS, multi-tenant, and Slack.
2. **Steal three specific patterns** from the open-source projects (schema-only, not code): `(qr_id, asset_id)` indirection from Shelf, the maintenance-log table shape from Snipe-IT, and the inventory-number lookup redirect from GLPI.
3. **Build a thin "industrial asset registry" layer on top** of what MIRA has — adding ISA-95 hierarchy enforcement, `uns_path` on the asset side, multi-QR per asset, and a stable scan → MIRA-chat-with-context handshake.
4. **Do not embed any of these projects.** AGPL alone makes them dead-ends for a paid SaaS.

Estimated work: **3 weeks** for a rugged MVP, building on the existing 1,711 lines of MIRA QR code (not a greenfield rewrite).

---

## 2. Repo Comparison Table

| Dimension | Shelf.nu | Snipe-IT | GLPI Barcode Plugin | EPA QR_Tool | **MIRA today** |
|---|---|---|---|---|---|
| Language / stack | TypeScript, React Router 7, Hono, Prisma, Postgres | PHP 8.2, Laravel 12, Apache, MySQL, Eloquent | PHP 7.4+, GLPI plugin only | Python 3, Kivy desktop app (Windows) | **Bun, Hono, TS, NeonDB Postgres** |
| License | **AGPL-3.0** | **AGPL-3.0** | **AGPL-3.0** | Public domain | MIT (this repo) |
| Stars / activity | 2.6k / daily commits | 13.8k / daily commits | 41 / ~2 commits/year | 11 / dormant | n/a (private) |
| Multi-tenant | Yes (`Organization`) | No (`companies` is scoping, not tenancy) | No | No | **Yes (`tenant_id` UUID)** |
| Asset model | `Asset` + `Kit` + `Location` (parentId tree) | `Asset` + `Model` + `Manufacturer` + `Location` tree | GLPI's IT-centric model (Computer, Printer, NetworkEq) | None (raw text string) | `asset_qr_tags(tenant_id, asset_tag, atlas_asset_id)` + Atlas REST + KG `uns_path` |
| QR generation | `qrcode-generator` npm | `tecnickcom/tc-lib-barcode` PHP | `phpqrcode` (2010 SF release) | `qrcode` (lincoln-loop) | **`qrcode` npm** (`mira-web/src/lib/qr-generate.ts`) |
| QR payload | `https://shelf.nu/qr/{cuid}` (opaque) | URL to PHP asset page | Either GLPI form URL or inventory-number lookup | Raw text (no URL) | **`https://app.factorylm.com/m/{asset_tag}`** |
| Scan auth model | Login wall on every scan | Public page | Public lookup → form | n/a | **Auth optional; unauthed scans route to chooser / register / Slack** |
| Label / batch print | PNG, 4 sizes, ZIP batch | TCPDF, Avery sheets, configurable | PDF (Cezpdf), ISO sheet sizes | Bare PNG per row | **pdf-lib, Avery 5163 / 5160** (`mira-web/src/lib/qr-pdf.ts`) |
| Custom fields | Yes (TEXT, OPTION, BOOL, DATE, NUMBER) | Yes (fieldsets per category) | Inherits GLPI | No | No (today) — passes through to Atlas |
| Maintenance / work orders | **No** | `asset_maintenances` table | Inherits GLPI | No | **Yes — via Atlas CMMS REST** (`atlas-api:8088`) |
| File attachments | Images only (Postgres bytes) | Files (`uploads`, S3) | Inherits GLPI | None | **Yes — knowledge_entries + MinIO via Atlas** |
| Webhooks | Stripe only | Checkin/checkout only | None | None | Internal (Slack, Open WebUI) |
| Public REST API | None (mobile JWT only) | Yes, complete CRUD | None | None | **Yes (Hono routes + Atlas REST)** |
| SSO | SAML | LDAP / SAML / SCIM | GLPI native | None | JWT (`PLG_JWT_SECRET`) |
| ISA-95 awareness | No (flat parent tree) | No (flat parent tree) | No (IT-only model) | No | **Yes — `kg_entities.uns_path` ltree** |
| QR → chat trigger | No (login redirect) | No (web view) | No (form redirect) | No | **Yes — `/m/:tag` → Slack / OpenWebUI / Telegram / guest** |
| Embeddable in `app.factorylm.com` | No (standalone) | No (PHP monolith) | No (full GLPI install) | No (desktop) | **Already inside it** |

Bottom row is the punch line. Every cell where MIRA has **Yes** today is a cell where adopting one of these projects would be a regression or a side-by-side install.

---

## 3. Deep Dive Per Repo

### 3.1 Shelf.nu — https://github.com/Shelf-nu/shelf.nu

**Truth on the ground.** Live, healthy, daily commits as of 2026-05-15. TypeScript-strict, React Router 7 + Hono server runtime (so we share a runtime!), Prisma against Postgres. Stack is the closest match to MIRA of any candidate.

**Data model worth copying:**
- `Qr` table is a first-class entity, **not** a column on `Asset`: `id, version, errorCorrection, assetId, kitId, organizationId, batchId`. This lets you re-issue, retire, and migrate QRs without touching the asset row. (`packages/database/prisma/schema.prisma`)
- `Custody`, `Booking`, `AuditSession`, `ActivityEvent` separate state from history cleanly.
- `Location.parentId` self-reference for hierarchy.
- `CustomField` typed enum (`TEXT|OPTION|BOOLEAN|DATE|MULTILINE_TEXT|AMOUNT|NUMBER`).
- `Organization` + `UserOrganization` + `Tier` give a sane multi-tenant + billing pattern.

**Where it fails MIRA hard:**
- **AGPL-3.0.** Forking it inside our SaaS means open-sourcing the entire `app.factorylm.com` stack. Their hosted SaaS exists precisely because of this — they want you to either pay them or open-source your fork.
- **Login wall on every scan.** `routes/qr+/_public+/$qrId.tsx` redirects unauthenticated scans to login. For shop-floor technicians scanning a QR with a personal phone, this is the wrong UX. MIRA's `/m/:asset_tag` route already handles this better — anonymous scan can route to a guest report or Slack chooser.
- **No maintenance / work-order primitives.** Zero `WorkOrder`, `PMSchedule`, `FaultCode`, or `LaborRecord` tables. `AssetReminder` is a scheduled alert, not a work order.
- **File attachments = images only, in Postgres `Bytes`.** Wiring diagrams and PDFs are not first-class.
- **No public API.** `api+/` routes are session-authenticated only; mobile API uses Supabase JWT. Wiring an external system to read assets means scraping or DB access.
- **No `uns_path` field.** Custom fields exist but are JSON-valued, not ltree-indexable for ancestor/descendant queries — which MIRA does extensively (`gist (uns_path)` index in migration 007).

**Verdict: INSPIRE.** Steal the QR-as-its-own-table pattern, the activity-log shape, the Tier / TierLimit billing wiring. Do not fork. Do not run alongside.

---

### 3.2 Snipe-IT — https://github.com/grokability/snipe-it

**Truth on the ground.** Production-grade, 13.8k stars, daily commits, 467 test files. Built for IT asset management — laptops, monitors, software licenses, accessories. Not industrial.

**Data model worth referencing:**
- `asset_maintenances(asset_id, supplier_id, asset_maintenance_type, title, is_warranty, start_date, completion_date, cost, notes)` — clean shape for a maintenance log. MIRA could mirror this for an `asset_maintenance_records` table that overlays Atlas work-order history.
- `action_log` — every mutation logged with `user_id, action_type, target_type, target_id`. Maps to what we'd want for a tenant audit trail.
- `categories`, `manufacturers`, `asset_models` separated — good normalization that MIRA does not have today (we lean on `kg_entities` `entity_type='equipment'` + `properties` JSONB).

**REST API surface to study:**
`AssetsController` exposes: `index, show, showByTag, showBySerial, store, update, destroy, restore, checkout, checkin, checkinByTag, checkoutByTag, audit, history, getLabels, assignedAssets`. The `showByTag` and `checkinByTag` patterns are exactly what MIRA's `/m/:asset_tag` should expose as an API.

**Where it fails MIRA hard:**
- **AGPL-3.0.** Same SaaS-incompatibility as Shelf.
- **PHP Laravel monolith inside a Bun/TS stack.** Two runtimes, two deploy pipelines, two languages. Snipe-IT's own dockerfile is `ubuntu:24.04 + apache2 + libapache2-mod-php8.3` — that is not joining our compose graph cleanly.
- **No multi-tenant.** `companies` is row-scoping inside one install. MIRA sells to multiple factory customers from one platform.
- **No UNS / ISA-95 awareness.** Location tree is generic parent/child with no role labels.
- **Maintenance model is reactive logbook only.** No PM schedule, no fault code taxonomy, no parts BOM linkage — Atlas CMMS gives us more than Snipe-IT does here.

**Verdict: INSPIRE.** Copy the `asset_maintenances` table shape into MIRA's roadmap. Copy the Avery label template configurability into `qr-pdf.ts`. Read their checkout/checkin REST controller for inspiration on `/api/assets/:tag/checkout`. Do not host. Do not embed.

---

### 3.3 GLPI Barcode Plugin — https://github.com/pluginsGLPI/barcode

**Truth on the ground.** Effectively abandoned. 41 stars, 52 open issues, last release 2022-07-18, depends on PHP libraries from 2010 (`deltalab/phpqrcode`, `pear/Image_Barcode`) that need patches to run on modern PHP. Requires the full GLPI install (~6 MB PHP monolith + MySQL + Apache).

**The one good idea:** `front/checkItemByInv.php` is a single PHP script that:
1. Reads `inventoryNumber` from the QR scan.
2. Looks up the matching GLPI asset by `otherserial`.
3. Redirects to the GLPI asset form.

That is the right shape for a scan handler. **MIRA already implements this exact pattern** in `mira-web/src/routes/m.ts` — but more flexibly (multi-channel routing, auth-aware, tenant-scoped, constant-time on miss). Nothing to copy from the PHP.

**Where it fails MIRA hard:**
- **AGPL-3.0** (GLPI ecosystem default).
- **Full GLPI install required.** GLPI's data model is `Computer`, `Monitor`, `Software`, `NetworkEquipment`, `Printer` — IT, not OT. Bending it to model PowerFlex 525 drives, Modicon PLCs, and packaging-line components is fighting the framework.
- **2022-vintage dependencies** held together with composer patches.
- **No scan-triggered workflows.** It is a label PDF generator. Period.

**Verdict: SKIP entirely.** No code worth lifting. The redirect-by-inventory-number pattern is already in MIRA, better.

---

### 3.4 EPA QR_Tool — https://github.com/USEPA/QR_Tool

**Truth on the ground.** Python 3 + Kivy desktop GUI. Built to track personnel and equipment check-in at EPA field tents. PyInstaller-packaged Windows executable. Hard-coded `LAPTOP-4FMUSB50` in `Setup/settings.csv`. SQL Server support is half-implemented and commented out across the codebase.

**What it does:**
- Webcam scans a QR.
- The QR encodes raw text (a person's name, an equipment label) — **no URL, no resolution**.
- Logs scan event to local CSV or ArcGIS Online.
- Generates bare QR JPGs from a CSV.

**Verdict: SKIP entirely.** A Windows tent-tracking utility is not relevant to MIRA. The only useful primitive — the `qrcode` Python library — is already pip-installable in 30 seconds. MIRA already uses the equivalent `qrcode` npm package.

---

## 4. Licensing Concerns

| Repo | License | SaaS embed allowed? |
|---|---|---|
| Shelf.nu | **AGPL-3.0** | No, without commercial license from Shelf-nu |
| Snipe-IT | **AGPL-3.0** | No, without commercial license from Grokability |
| GLPI Barcode Plugin | **AGPL-3.0** | No |
| EPA QR_Tool | Public domain (17 U.S.C. § 105) | Yes — but tool is not useful |

AGPL-3.0 §13 ("Remote Network Interaction") is the killer for SaaS. Any modified version we deploy where users interact over a network triggers a source-disclosure obligation for the **entire combined work**. There is no "API boundary" loophole — courts and the FSF have been clear that the network interaction provision applies to the running process, not just the file we edited.

The clean reading: if MIRA forks any AGPL repo, `app.factorylm.com` must publish its complete source under AGPL. That is incompatible with our `$97/mo` paid SaaS posture (`MIRA/PRDS/factorylm-plg-funnel.md`).

**Even running an unmodified AGPL service alongside MIRA via REST API** has been argued both ways. The conservative reading: if your product *depends* on a running AGPL service and you ship that bundle to customers, you have to expose source for the integration plumbing too. Legal review territory.

**Conclusion on licensing: AGPL repos are not viable as forked dependencies and risky as bundled services. Use them as reference reading material only.**

---

## 5. Best Architecture for MIRA

The reference architecture below extends what MIRA already has rather than replacing it. Each box that exists today is marked ✅; each box to add is marked ⬜.

```
                    ┌────────────────────────────────────────────────────────┐
                    │                  PHYSICAL FACTORY                       │
                    │  Asset sticker (Avery 5163) — QR encodes               │
                    │  https://app.factorylm.com/m/{asset_tag}               │
                    └─────────────────────────┬──────────────────────────────┘
                                              │ technician scans with phone
                                              ▼
                    ┌────────────────────────────────────────────────────────┐
                    │  ✅ mira-web — Hono/Bun (src/routes/m.ts)               │
                    │                                                         │
                    │  GET /m/:asset_tag                                      │
                    │  ├─ resolve tenant + atlas_asset_id                     │
                    │  ├─ record scan_id in qr_scan_events                    │
                    │  ├─ read tenant_channel_config                          │
                    │  └─ route to chosen channel (or chooser)                │
                    └─────────────────────────┬──────────────────────────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                ▼                             ▼                             ▼
   ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────┐
   │ Slack (technician)    │   │ Open WebUI (logged-in)│   │ Guest report form        │
   │ slack-bolt AsyncApp   │   │ mira-pipeline:9099    │   │ /m/:asset_tag/report     │
   │ Socket Mode           │   │ (OpenAI-compat)       │   │ unauthenticated PLG loop │
   └──────────┬───────────┘   └──────────┬───────────┘   └──────────────────────────┘
              │                          │
              ▼                          ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  ✅ mira-bots/shared/engine.py — Supervisor / GSD                            │
   │                                                                              │
   │  scan_id arrives via pending_scan cookie or Slack metadata                   │
   │  ⬜ NEW: engine reads scan_id → loads asset_context from NeonDB              │
   │     - atlas_asset_id, uns_path, manufacturer, model, last 5 work orders     │
   │     - PRE-CONFIRMS context with technician (UNS gate, per .claude/CLAUDE.md) │
   │  → only then enters troubleshooting                                          │
   └──────────────────────────────────────┬───────────────────────────────────────┘
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  Knowledge layer                                                              │
   │  ✅ Atlas CMMS REST (assets, work orders, PMs) — atlas-api:8088              │
   │  ✅ NeonDB kg_entities (uns_path ltree, manufacturer, model, equipment)      │
   │  ✅ NeonDB knowledge_entries (pgvector) — manuals, wiring, PLC tags          │
   │  ⬜ NEW: asset_uns_link(asset_tag → kg_entities.id, uns_path)                │
   │  ⬜ NEW: asset_maintenance_records (audit overlay on Atlas work orders)      │
   │  ⬜ NEW: asset_attachments (S3/MinIO refs — manuals, wiring, photos)         │
   └──────────────────────────────────────────────────────────────────────────────┘
```

### Why this works

- **Stable QR → asset page:** `asset_qr_tags` is already keyed on `(tenant_id, asset_tag)` with a constant-time miss path (`mira-web/src/lib/qr-tracker.ts:36-45`).
- **UNS path mapping:** `kg_entities.uns_path` already exists as an indexed ltree (`docs/migrations/007_uns_path.sql`). We just need an `asset_uns_link` table tying an `asset_tag` to a `kg_entities.id`.
- **Manuals / wiring / photos / PLC tags / work-order history:** already attached via `knowledge_entries` (manuals + wiring), Atlas (work orders), `kg_entities.properties` JSONB (manufacturer, model, PLC tag metadata), and MinIO (photos).
- **ISA-95 hierarchy:** `uns_path` is `enterprise.{company}.site.{site}.area.{area}.line.{line}.work_cell.{cell}.equipment.{eq}` — already specified, already enforced by `uns_path_format` CHECK.
- **QR scan triggers chat with context:** today the scan lands the user in `/c/new` (Open WebUI) or a Slack channel via channel-config. We extend the engine to read the `pending_scan` cookie or Slack scan_id and inject UNS context into the very first turn.
- **Module inside `app.factorylm.com`:** already there. `mira-web` is the app.
- **No fork:** every adopted idea is a *schema pattern*, not copied source.

---

## 6. Recommended MVP Build

> The plan below is **conditional on accepting the recommendation in §1**. It is included because it was in the task brief; it is *not* a self-approved implementation roadmap. If approved, the work lands as a separate implementation PR (not this evaluation PR).

Three weeks. Each week ends with a demoable deliverable.

### Week 1 — Asset registry + UNS link
1. Add migration: `asset_uns_link(tenant_id uuid, asset_tag text, kg_entity_id uuid, uns_path ltree, asset_kind text, parent_asset_tag text)`.
2. Backfill from `kg_entities` for the existing demo tenant.
3. Extend `resolveAssetWithChannelConfig()` (`mira-web/src/lib/qr-tracker.ts:66`) to also return `uns_path` and `kg_entity_id`.
4. Extend the `pending_scan` cookie to carry the resolved `uns_path` (signed JWT).
5. Update `mira-bots/shared/engine.py` to read the scan's `uns_path` from the pending-scan claim and *skip the search step* of the UNS gate (we already know the asset — we just need confirmation).

### Week 2 — Asset hierarchy + maintenance overlay
1. Add migration: `asset_hierarchy(tenant_id, asset_tag, level enum(site|area|line|machine|component), parent_tag)`. CHECK constraint enforces the ISA-95 levels.
2. Add migration: `asset_maintenance_records(tenant_id, asset_tag, atlas_work_order_id nullable, kind enum(repair|pm|inspection|note), opened_at, closed_at, cost_cents nullable, technician_id nullable, notes)`. Snipe-IT's table shape, MIRA's keys.
3. Add `GET /api/m/:asset_tag` — returns the full context blob (asset, parents, UNS path, last 5 work orders, attached manuals count, last scan). Slack uses this on every `/m/...` callback.
4. Backfill from Atlas REST (`/api/assets`, `/api/work-orders`) for the demo tenant.

### Week 3 — Print pipeline polish + scan-to-chat handoff
1. Extend `mira-web/src/lib/qr-pdf.ts` to support a third label format: **Avery 6873 (1.25" × 1.75" weatherproof polyester)** for shop-floor durability. Add a "tenant_logo" optional asset.
2. Add `POST /api/admin/qr-print-batch-by-hierarchy` — generate a sticker sheet for all assets under a given `uns_path` ancestor (e.g., "everything under `enterprise.acme.site.lakeland.area.bottling.line.l1`").
3. Build the Slack scan-handoff: when a scan with `pending_scan` cookie lands on `/c/new`, the engine emits a single Slack DM in the technician's channel: "Scan registered for `{uns_path}`. Confirm to start troubleshooting." This satisfies the UNS gate without re-asking.
4. Add `qr_scan_events.chat_id` linkage (column already exists) so analytics can tie scans → conversation outcomes.

Out of scope for MVP: kit/bundle support, audit campaigns, SAML, kitting check-out flows, custody assignment. Add later if customer-driven.

---

## 7. Suggested Database Schema (aligned with existing tables)

**Migration tree:** these three new migrations live in **`docs/migrations/`** (where 004–007 live), not in `mira-core/mira-ingest/db/migrations/`. Reason: the new tables FK to `kg_entities`, which is owned by the `docs/migrations/` tree (006, 007). The `mira-ingest/db/migrations/` tree owns the operational tables (`asset_qr_tags`, `tenant_channel_config`) and we extend them by composite FK from the new tables — no schema changes to that tree. (Implementer: do not split the migrations across both trees; pick one and FK across.)

```sql
-- docs/migrations/008_asset_uns_link.sql
-- Bridges an asset_qr_tag to a kg_entities row carrying the UNS path.
-- This is the table the engine reads on every scan to enter troubleshooting
-- in a pre-confirmed context.
BEGIN;

CREATE TABLE IF NOT EXISTS asset_uns_link (
    tenant_id      UUID         NOT NULL,
    asset_tag      TEXT         NOT NULL,
    kg_entity_id   UUID         NOT NULL REFERENCES kg_entities(id) ON DELETE RESTRICT,
    uns_path       LTREE        NOT NULL,
    asset_kind     TEXT         NOT NULL CHECK (asset_kind IN (
                                  'site','area','line','work_cell','machine','component'
                                )),
    parent_tag     TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, asset_tag),
    FOREIGN KEY (tenant_id, asset_tag)
        REFERENCES asset_qr_tags (tenant_id, asset_tag) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, parent_tag)
        REFERENCES asset_qr_tags (tenant_id, asset_tag) ON DELETE SET NULL
);

CREATE INDEX asset_uns_link_uns_path_gist
    ON asset_uns_link USING gist (uns_path);
CREATE INDEX asset_uns_link_tenant_kind
    ON asset_uns_link (tenant_id, asset_kind);
CREATE INDEX asset_uns_link_parent
    ON asset_uns_link (tenant_id, parent_tag);

COMMENT ON TABLE asset_uns_link IS
    'Bridges physical asset (asset_qr_tags) to UNS knowledge entity (kg_entities). '
    'One row per physical asset instance. Enforces ISA-95 levels on asset_kind. '
    'uns_path is denormalized from kg_entities.uns_path so scans resolve in one query.';

COMMIT;
```

```sql
-- docs/migrations/009_asset_maintenance_records.sql
-- Overlay on Atlas work orders. Stores the MIRA-side facts (low-confidence
-- proposals, technician notes captured pre-CMMS) until they're promoted.
BEGIN;

CREATE TABLE IF NOT EXISTS asset_maintenance_records (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID         NOT NULL,
    asset_tag            TEXT         NOT NULL,
    atlas_work_order_id  INTEGER,                  -- nullable until promoted to Atlas
    kind                 TEXT         NOT NULL CHECK (kind IN (
                                          'repair','pm','inspection','observation','note'
                                        )),
    status               TEXT         NOT NULL DEFAULT 'open' CHECK (status IN (
                                          'open','in_progress','resolved','escalated','dropped'
                                        )),
    opened_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at            TIMESTAMPTZ,
    cost_cents           INTEGER,
    technician_atlas_id  INTEGER,
    scan_id              UUID         REFERENCES qr_scan_events(scan_id) ON DELETE SET NULL,
    chat_id              TEXT,                     -- links to engine episode
    notes                TEXT,
    evidence_json        JSONB,                    -- grounding refs (manual page, KG ids)
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id, asset_tag)
        REFERENCES asset_qr_tags (tenant_id, asset_tag) ON DELETE CASCADE
);

CREATE INDEX asset_maintenance_records_tenant_asset
    ON asset_maintenance_records (tenant_id, asset_tag, opened_at DESC);
CREATE INDEX asset_maintenance_records_scan
    ON asset_maintenance_records (scan_id) WHERE scan_id IS NOT NULL;
CREATE INDEX asset_maintenance_records_atlas
    ON asset_maintenance_records (atlas_work_order_id) WHERE atlas_work_order_id IS NOT NULL;

COMMENT ON TABLE asset_maintenance_records IS
    'MIRA-side maintenance ledger. Pre-records observations from scan-driven '
    'conversations before they become formal Atlas work orders. atlas_work_order_id '
    'is the back-reference once promoted.';

COMMIT;
```

```sql
-- docs/migrations/010_asset_attachments.sql
-- File attachments per asset (manuals, wiring diagrams, photos) outside of
-- knowledge_entries chunks. Storage is MinIO; we keep the key + metadata here.
BEGIN;

CREATE TABLE IF NOT EXISTS asset_attachments (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    asset_tag     TEXT         NOT NULL,
    kind          TEXT         NOT NULL CHECK (kind IN (
                                  'manual','wiring_diagram','photo','plc_tag_csv','other'
                                )),
    title         TEXT         NOT NULL,
    minio_bucket  TEXT         NOT NULL,
    minio_key     TEXT         NOT NULL,
    sha256        TEXT,
    bytes         BIGINT,
    mime          TEXT,
    uploaded_by   UUID,
    uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id, asset_tag)
        REFERENCES asset_qr_tags (tenant_id, asset_tag) ON DELETE CASCADE
);

CREATE INDEX asset_attachments_tenant_asset_kind
    ON asset_attachments (tenant_id, asset_tag, kind);

COMMIT;
```

No changes to `asset_qr_tags`, `qr_scan_events`, or `tenant_channel_config` — they already serve their purpose. The `qr_scan_events.chat_id` column (already present, currently unwritten) is the seam where scan analytics meets conversation outcomes.

---

## 8. Suggested API Routes

All hosted by `mira-web` (Hono/Bun, JWT-authenticated unless noted).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/m/:asset_tag` | optional | **Scan handler — already exists.** Channel-aware redirect. |
| GET | `/m/:asset_tag/choose` | optional | **Already exists.** Channel chooser when tenant has >1. |
| GET | `/m/:asset_tag/register` | optional | **Already exists.** PLG loop on unknown tag. |
| GET | `/m/:asset_tag/report` | optional | **Already exists.** Guest report form. |
| **GET** | **`/api/m/:asset_tag`** | JWT | **NEW.** Returns context blob — asset, UNS path, parents, last 5 work orders, last 3 scans, attachment counts. Used by Slack engine and any external system. |
| **GET** | **`/api/m/:asset_tag/maintenance`** | JWT | **NEW.** Asset's maintenance record log + Atlas work-order history merged. |
| **POST** | **`/api/m/:asset_tag/maintenance`** | JWT | **NEW.** Append a maintenance record (open observation, escalation, resolution). Engine writes here mid-conversation; admin promotes to Atlas later. |
| **POST** | **`/api/m/:asset_tag/attachments`** | JWT | **NEW.** Upload a manual/wiring/photo. Multipart. Streams to MinIO, records in `asset_attachments`. |
| **GET** | **`/api/m/:asset_tag/attachments`** | optional | **NEW.** List attachments (signed MinIO URLs, short TTL). |
| GET | `/admin/qr-print` | admin | **Already exists.** Sticker-print UI. |
| POST | `/api/admin/qr-print-batch` | admin | **Already exists.** Generate sticker PDF. |
| **POST** | **`/api/admin/qr-print-by-hierarchy`** | admin | **NEW.** Generate stickers for all descendants of a UNS path. Body: `{ uns_ancestor, format, levels: ['machine','component'] }`. |
| **POST** | **`/api/admin/assets/:asset_tag/uns-link`** | admin | **NEW.** Bind a physical asset to a `kg_entities` UNS path + ISA-95 kind + parent. |
| GET | `/admin/qr-analytics` | admin | **Already exists.** |

The five **NEW** endpoints are the entire incremental API surface for the MVP.

---

## 9. Suggested QR Label Printing Approach

We already have the right approach in `mira-web/src/lib/qr-pdf.ts` (pdf-lib + Avery 5163/5160). Three additions, no rewrite:

1. **Add Avery 6873 weatherproof polyester layout** — 1.25" × 1.75", 24 per sheet. This is the industrial sticker SKU; 5163/5160 are paper. The layout math is identical to what's in the file, just new constants.

2. **Add `tenant_logo_url`** to `tenant_channel_config` and overlay it on the right panel of each sticker (replacing the "MIRA" wordmark). Read once per print batch, embed as PNG.

3. **Add `print-by-hierarchy`** — given a UNS ancestor like `enterprise.acme.site.lakeland.area.bottling`, generate one sheet per descendant level (machines, then components). The UI prints all stickers needed for a new line install in one click.

**Do NOT** rebuild label rendering with one of the open-source approaches:
- Shelf's PNG-per-asset + ZIP is worse for shop-floor batch printing (printing 30 PNGs vs one PDF is friction).
- Snipe-IT's TCPDF is PHP-only.
- GLPI's Cezpdf is ancient.

`pdf-lib` is the right call. It's MIT, runs in Bun, and the existing code is 157 lines doing exactly what we need.

---

## 10. Suggested Implementation Plan

**Sequencing (3 weeks, single developer):**

| Day | Deliverable | Tests / proof |
|---|---|---|
| **W1 D1** | Migration `008_asset_uns_link.sql` applied to dev NeonDB | `\dt asset_uns_link` returns row; CHECK constraint rejects bad `asset_kind` |
| **W1 D2** | Extend `qr-tracker.ts` resolver to join `asset_uns_link` | Unit test in `mira-web/src/lib/__tests__/qr-tracker.test.ts` |
| **W1 D3-4** | Add `uns_path` to pending_scan JWT claim; engine reads it | Slack scan E2E test — message arrives with UNS context already populated |
| **W1 D5** | Backfill demo tenant from `kg_entities` | `SELECT count(*) FROM asset_uns_link WHERE tenant_id = <demo>` matches expected |
| **W2 D1** | Migration `009_asset_maintenance_records.sql` | Schema applied |
| **W2 D2** | `GET /api/m/:asset_tag` endpoint + integration test | curl returns expected JSON shape |
| **W2 D3** | `POST /api/m/:asset_tag/maintenance` endpoint | curl write + read round-trip |
| **W2 D4** | Atlas REST backfill script for last-90-day work orders → maintenance_records (kind=`repair`, status=`resolved`) | row count matches Atlas |
| **W2 D5** | Engine emits maintenance_record on every `RESOLVED` state | Playwright test: scan → chat → resolve → record visible in `/api/m/:asset_tag/maintenance` |
| **W3 D1** | Migration `010_asset_attachments.sql` + MinIO bucket layout | Schema + bucket created |
| **W3 D2** | Attachment upload/list endpoints | Upload a wiring PDF, fetch presigned URL, open it |
| **W3 D3** | Avery 6873 weatherproof layout in `qr-pdf.ts` | PDF visually correct at 1.25"×1.75" |
| **W3 D4** | `POST /api/admin/qr-print-by-hierarchy` | Generate stickers for entire demo line in one shot |
| **W3 D5** | Demo run: print → scan → Slack → engine knows context → resolve → maintenance record persists | Recorded video, saved to `docs/promo-screenshots/` per Screenshot Rule |

**Rollout:** behind `ENABLE_ASSET_UNS_LINK` env flag. Demo tenant first. Once green for 7 days, default on.

**Reference reads while building:**
- Shelf.nu `packages/database/prisma/schema.prisma` — for any field-naming questions
- Snipe-IT `app/Http/Controllers/Api/AssetsController.php` — for the `showByTag`/`checkinByTag` controller shape
- MIRA: `mira-web/src/lib/qr-tracker.ts`, `mira-web/src/routes/m.ts`, `docs/migrations/007_uns_path.sql` — for the patterns we extend

---

## 11. Risks / Gotchas

1. **AGPL contamination.** Do not copy AGPL source into the MIRA repo. Even small snippets. Read the open-source projects for **patterns**, not **lines**. Document any inspiration in the PR description so a future audit can trace what came from where. (We could even add an `evidence: 'inspired-by'` line to the migration comment for honesty.)

2. **Atlas CMMS is GPL-3.0, not AGPL.** REST-only integration with an unmodified Atlas container is unambiguously fine — GPL-3.0 has no §13 "network use" provision, and `mira-cmms/CLAUDE.md` already frames this as a "clean license boundary." The risk is *only* if `asset_maintenance_records` starts copying Atlas's internal table shape verbatim in a way that smells like a derivative work. Keep the schema Snipe-IT-shaped (which is what § 7 specifies) and we are safe. Do not import any Atlas Java code.

3. **`pending_scan` JWT carries `uns_path` — what if the asset is re-linked later?** Mitigation: include `(asset_tag, uns_path)` *and* `iat` in the claim; reject claims older than 24 h. If the asset's UNS path changed during that window, the next scan resolves it correctly.

4. **Multi-QR per asset.** Today `asset_qr_tags` is keyed `(tenant_id, asset_tag)`. If an asset gets re-stickered (label damaged), we'd want to retire the old `asset_tag` and issue a new one without losing scan history. Add an `asset_tag_alias` table later if customers actually need this. **Do NOT** preemptively refactor to a Shelf-style `qr_id → asset_id` indirection — that's a YAGNI rebuild.

5. **Constant-time miss guarantee.** `mira-web/src/lib/qr-tracker.ts:36-45` is constant-time within a tenant. The new `asset_uns_link` join must preserve this. Use `LEFT JOIN` not inner join, and make sure the response shape is identical on miss.

6. **Slack scan handoff requires a tech identity.** A guest scan on an open phone has no Slack user yet. Flow: guest scans → channel chooser → "Sign in with Slack" → bind `slack_user_id ↔ tenant_id`. We need to make sure the engine's UNS-confirmation prompt is the *first* message in the resulting Slack DM, not after the auth ceremony.

7. **Print-by-hierarchy could generate hundreds of stickers in one click.** Add a confirmation step at >50 assets. Stream the PDF — don't buffer in memory.

8. **MinIO bucket strategy.** One bucket per tenant or one bucket with `tenant_id/asset_tag/{kind}/{uuid}` prefixes? Atlas already uses bucket-per-tenant for work-order attachments. Match that pattern for `asset_attachments` to keep IAM consistent.

9. **Ignition / Sparkplug B integration is downstream.** The UNS path on `kg_entities` already aligns with the spec's `enterprise.{company}.site.{site}.area.{area}.line.{line}...` shape. When the relay ingests Sparkplug B node-IDs in the future, the matching key is the same `uns_path` — no further QR-side change needed.

10. **Don't over-build the asset hierarchy table.** We have a `parent_tag` self-reference in `asset_uns_link`. Materialized paths exist in `uns_path` itself (ltree). A separate `asset_hierarchy` join table would duplicate state. Skip it.

---

## 12. Final Decision

**Build. Don't fork.**

MIRA already has the entire QR primitive solved on the right stack. None of the four open-source projects help us — Shelf and Snipe-IT would force AGPL on our paid SaaS, GLPI is a 2022-vintage label generator depending on a PHP monolith we don't want, and the EPA tool is a Windows tent utility. The only valuable artifacts are three schema patterns (Shelf's `Qr` as its own table, Snipe-IT's `asset_maintenances`, Snipe-IT's REST `showByTag` shape), and one already-implemented pattern (GLPI's scan-by-inventory-number redirect) that MIRA's `mira-web/src/routes/m.ts` does better than the original.

Spend the three weeks above bolting a thin **asset-UNS-link** layer, a **maintenance ledger**, and an **attachments table** onto the existing QR pipeline. Ship a print-by-hierarchy admin action and a weatherproof Avery 6873 template. Demo it on a real factory line. Move on.

**One sentence to remember:** *Asset-tagging is solved here; the missing piece is the bridge from `asset_tag` to `uns_path` to `kg_entities` — three migrations and five Hono routes, not a fork.*

---

## Appendix A — Files I Inspected in the MIRA Codebase

| File | Lines | Role |
|---|---|---|
| `mira-web/src/lib/qr-generate.ts` | 41 | QR PNG/SVG generation via `qrcode` npm; `scanUrlFor()` |
| `mira-web/src/lib/qr-pdf.ts` | 157 | Avery 5163/5160 sticker sheets via pdf-lib |
| `mira-web/src/lib/qr-tracker.ts` | 129 | NeonDB resolver + scan event recorder |
| `mira-web/src/routes/m.ts` | 144 | Scan handler — auth flow + channel routing |
| `mira-web/src/routes/m-chooser.ts` | 200 | Channel chooser page |
| `mira-web/src/routes/m-register.ts` | 312 | PLG auto-register on unknown tag |
| `mira-web/src/routes/m-report.ts` | 255 | Guest report form |
| `mira-web/src/routes/qr-test.ts` | 244 | Dev test harness |
| `mira-web/src/routes/admin/qr-print.ts` | 162 | Admin sticker-print UI |
| `mira-web/src/routes/admin/qr-analytics.ts` | 67 | Scan analytics |
| `mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql` | 43 | `asset_qr_tags`, `qr_scan_events` |
| `mira-core/mira-ingest/db/migrations/004_tenant_channel_config.sql` | 23 | `tenant_channel_config` |
| `docs/migrations/006_kg_bridge.sql` | 60+ | `kg_entities`, `kg_relationships`, `knowledge_entries.equipment_entity_id` |
| `docs/migrations/007_uns_path.sql` | 87 | `kg_entities.uns_path` ltree + GIST index |
| `mira-cmms/CLAUDE.md` | — | Atlas CMMS REST API contract |

Total existing QR-related TypeScript: **1,711 lines**. This is what we're extending, not replacing.
