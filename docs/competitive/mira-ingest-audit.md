# MIRA Ingest & Onboarding Capability Audit
**Date:** 2026-05-11  
**Purpose:** Competitive gap analysis for Florida Automation Expo, May 21, 2026  
**Change freeze:** May 18, 2026  
**Auditor:** Claude Code (automated codebase scan)

---

## Capability Audit

### 1. Photo scan → asset creation
**Status: ✅ Built and shipping**

- `mira-core/mira-ingest/main.py:492` — `POST /ingest/photo` route active; `_describe_photo()` (LLM vision pass) runs, writes to SQLite, pushes description to Open WebUI KB.
- `mira-bots/telegram/bot.py:210` — `_ingest_photo_background()` posts photos to mira-ingest; photo batch queue handles multi-photo bursts.
- `mira-mcp/server.py:388` — `create_asset_from_nameplate()` MCP tool creates Atlas CMMS asset from extracted nameplate fields.

**Note:** Telegram photo → ingest → KB is the primary delivery. Hub `/scan` page resolves by QR tag (asset_tag); direct camera-to-asset-creation via web UI is in mira-scan-spec scope but marked "planned" for nameplate OCR path.

---

### 2. PDF/manual ingestion → KB chunks
**Status: ✅ Built and shipping**

- `mira-core/mira-ingest/main.py:794` — `POST /ingest/document-kb` uploads PDF to Open WebUI, uses pdfplumber + optional Docling for extraction, stores in knowledge_entries with tenant_id.
- `mira-bots/telegram/bot.py:229` — `document_handler()` — PDFs sent to Telegram bot auto-route to `/ingest/document-kb`.
- `mira-hub/src/app/(hub)/knowledge/page.tsx` — Web picker UI with `unsPath` field shown in KB growth dashboard.

**Note:** PDF-only for MVP (MIME enforced). Relevance gate filters non-maintenance content before embedding.

---

### 3. CSV/spreadsheet bulk import for assets
**Status: 🟡 Partial — work orders only, not assets**

- `mira-web/src/lib/csv-import.ts` — CSV importer exists but ingests **historical work orders** (columns: date, title, description, priority, asset, category), max 500 rows. Calls `createWorkOrder()` on Atlas.
- No CSV import path for asset records (name, make, model, serial_number, location) exists in any surface.

**Note:** Work order CSV import is complete and tested. Asset bulk import from CSV is missing.

---

### 4. Public REST API for ingest
**Status: 🔴 Missing — spec only, no implementation**

- `docs/specs/public-ingest-api-spec.md` — Draft v1, explicitly marked **"Status: Draft v1 — spec only, no implementation"** (created 2026-05-11).
- No `mira-hub/src/app/api/v1/` public routes exist. Current ingest is internal-only (core-net Docker network).
- Spec describes "Twilio for Maintenance" model with `@factorylm/sdk-js` and `factorylm-py` SDKs — not built.

---

### 5. MCP server for AI agent access
**Status: ✅ Built and shipping**

- `mira-mcp/server.py` — FastMCP server with 20+ tools exposed: `get_equipment_status`, `list_active_faults`, `get_fault_history`, `cmms_write_work_order`, `cmms_list_assets`, `kg_maintenance_context`, `kg_impact_analysis`, `kg_root_cause_chain`, `run_kb_builder`, `create_asset_from_nameplate`, and more.
- REST endpoints also exposed at `/api/cmms/*`, `/api/kg/schematic`, `_rest_embed` (POST), `_rest_ingest_pdf` (POST).
- `mira-mcp/server.py:443` — `_rest_embed` for embedding queries; `476` — `_rest_ingest_pdf` for PDF ingest with tenant_id.

**Note:** Public-facing endpoint URL and auth model not documented for external customers. Internal-only today.

---

### 6. Google Drive / SharePoint / Dropbox connectors
**Status: 🟡 Partial — OAuth wired, sync incomplete**

- `mira-hub/src/app/api/auth/dropbox/route.ts` — Full Dropbox OAuth flow (offline token).
- `mira-hub/src/app/api/auth/microsoft/route.ts` — Microsoft OAuth with `Files.Read.All Sites.Read.All` scopes (SharePoint-ready).
- `mira-hub/src/app/api/picker/google/token/route.ts` — Google Picker token route exists.
- `mira-crawler/tasks/gdrive.py` — GDrive sync via rclone (`gdrive:FactoryLM/Manuals`) as Celery task.

**Note:** OAuth auth flows are implemented; end-to-end sync and KB ingest triggering from connected accounts is partial/not verified as shipping. Confluence auth also present (`mira-hub/src/app/api/auth/confluence/`).

---

### 7. QR code asset binding
**Status: ✅ Built and shipping**

- `mira-hub/src/app/api/assets/[id]/qr/route.ts:8` — `POST /api/assets/[id]/qr` binds `equipment_number` (asset_tag) to asset, sets `qr_generated_at`, encodes `/m/{equipment_number}` URL.
- `mira-web/src/lib/qr-generate.ts`, `qr-pdf.ts`, `qr-tracker.ts` — QR generation, PDF print sheets, scan event tracking.
- `mira-core/mira-ingest/scripts/purge_qr_scan_events.py` — Nightly cleanup of `qr_scan_events` table.
- `mira-hub/src/app/m/[assetTag]/page.tsx` — Mobile landing page for QR scan → diagnostic chat.

---

### 8. UNS / ISA-95 data model (hierarchical asset paths)
**Status: 🟡 Partial — UNS paths stored, not enforced**

- `mira-hub/src/app/(hub)/knowledge/page.tsx:73,82` — `unsPath: string` field exists in KB entry types and is displayed in the UI.
- `mira-hub/scripts/kg-uns-backfill.ts` — Backfill script for UNS paths on KG entities.
- `mira-hub/src/lib/knowledge-graph/types.ts` — Entity types include `plant`, `area`, `line`, `component` — ISA-95 hierarchy levels.

**Note:** UNS paths are stored and displayed but no enforcement layer, no structured ISA-95 node builder UI. The 3-minute demo script references "UNS-compatible" as a selling point. Hierarchy exists in KG entity types but asset form fields don't expose site/area/cell hierarchy.

---

### 9. Knowledge graph (asset → component → fault relationships)
**Status: ✅ Built and shipping**

- `mira-hub/src/lib/knowledge-graph/types.ts` — Full entity type registry: `equipment`, `fault_code`, `component`, `resolution`, `pm_task`, `electrical_component`, plus relationship types: `caused_by`, `resolved_by`, `has_component`, `electrically_connected`, `triggered_pm`, etc.
- `mira-mcp/server.py` — KG MCP tools: `kg_maintenance_context` (620), `kg_impact_analysis` (650), `kg_root_cause_chain` (664), `kg_traverse_chain` (678), `kg_flag_pm_mismatches` (708), `kg_extract_schematic` (733).
- `mira-hub/src/app/api/kg/sync/route.ts` — `POST /api/kg/sync` — full CMMS → KG batch import per tenant.

---

### 10. Vendor-scoped RAG (per-tenant + public OEM corpus)
**Status: 🟡 Partial — per-tenant scoping works, public OEM corpus partial**

- `mira-mcp/server.py:497` — `_rest_ingest_pdf` resolves `tenant_id` from form field (tested in `mira-mcp/tests/test_ingest_pdf_tenant.py`).
- `mira-mcp/tenant_resolver.py` — Tenant resolution module exists.
- `mira-crawler/route_fallback.py` — OEM manual discovery pipeline (DDG → Firecrawl → LLM URL discovery for public PDFs) is built.

**Note:** Per-tenant ingest is tested. Public OEM corpus is crawler-driven (not auto-populated on tenant signup). Shared public OEM corpus across tenants is not implemented as a persistent layer — each tenant ingests their own.

---

### 11. i3X compatibility envelope on API responses
**Status: 🔴 Missing — spec only**

- `docs/specs/public-ingest-api-spec.md:613` — Section 10 defines i3X mapping (Object/Element/VQT) and specifies `mira-hub/src/lib/i3x.ts` as the implementation target.
- `docs/specs/public-ingest-api-spec.md:621` — Explicitly: "We don't adopt i3X in v1 (the spec is still moving), but every response shape includes a forward-compatible `i3x` envelope."
- No `mira-hub/src/lib/i3x.ts` file exists. No current route handler applies i3X envelope.

---

### 12. Self-service signup → playground (sandbox)
**Status: 🟡 Partial — /buy and Stripe exist; 7-day sandbox not built**

- `mira-web/public/buy.html` — Buy page exists.
- `mira-web/src/lib/stripe.ts` — Checkout session creation, billing portal, webhook handler all implemented (`mira-web/src/server.ts:1060`).
- `docs/specs/public-ingest-api-spec.md` — Describes "7-day sandbox tenant w/ seed data" as the trial path, but this is spec-only.
- `mira-web/src/seed/demo-data.ts` — Demo seed data exists but no automated tenant provisioning into sandbox environment on signup.

**Note:** You can buy ($97/mo Stripe checkout). The sandbox/playground with seed data for frictionless 5-min trial is not built.

---

### 13. Auto-PM extraction from manuals
**Status: 🟡 Partial — PM schedule API exists, extraction from manual text not automated**

- `mira-mcp/server.py:360` — `cmms_list_pm_schedules()` MCP tool; `server.py:828` — REST `GET /api/cmms/pm-schedules`.
- `mira-hub/src/app/api/pm-schedules/` — PM schedule CRUD routes exist in Hub.
- `docs/specs/demo-readiness-may21-spec.md` item C4: "PM schedules — Auto-created PMs from manual extraction show up" is listed as a demo blocker.

**Note:** PM schedule storage and CMMS write-through exist. LLM-driven extraction of PM intervals from ingested PDF text and auto-creation of PM schedules is not confirmed as implemented — demo spec lists it as a must-work item, suggesting it may be in progress or gap.

---

### 14. Stripe-based purchase flow → tenant provisioning
**Status: ✅ Built and shipping**

- `mira-web/src/server.ts:1059` — `POST /api/stripe/webhook` fully handles `checkout.session.completed` (tenant activation), `customer.subscription.updated` (subscription changes), `customer.subscription.deleted` (churn).
- `mira-web/src/lib/stripe.ts` — Checkout session (`createCheckoutSession`), billing portal, anonymous checkout flow.
- Tenant activation on webhook is wired: email fallback if no `tenant_id` in session metadata.

---

### 15. Telegram / Slack ingress
**Status: ✅ Built and shipping (Telegram) / 🟡 Partial (Slack)**

- `mira-bots/telegram/bot.py` — Production Telegram bot: photo handler, document handler (PDF), text chat via GSD engine, voice, admin commands, photo batch queue. 9/9 tests per CLAUDE.md.
- `mira-hub/src/app/api/auth/slack/` — Slack OAuth flow exists.
- No `mira-bots/slack/` bot adapter found in the file listing (only Telegram adapter confirmed). Slack auth may be channels integration, not a full bot.

---

### 16. CMMS write-through (MaintainX, Fiix, Limble, Atlas)
**Status: ✅ Built and shipping**

- `mira-mcp/cmms/maintainx.py`, `fiix.py`, `limble.py`, `atlas.py` — All four adapters exist.
- `mira-mcp/cmms/factory.py` — Factory pattern for adapter selection.
- `mira-mcp/server.py:270` — `cmms_write_work_order`, `cmms_create_work_order`, `cmms_complete_work_order` MCP tools.
- Nango integration (`nango-integrations/maintainx/`) — Sync for work orders, assets, parts + create-work-order action.

**Note:** MaintainX is most complete (Nango syncs + direct adapter). Fiix, Limble, Atlas have adapters but depth varies.

---

### 17. Nameplate OCR
**Status: ✅ Built and shipping**

- `mira-mcp/server.py:388` — `create_asset_from_nameplate()` — creates Atlas asset from extracted nameplate fields (make, model, serial, location, tenant_id).
- `mira-mcp/server.py:870` — `POST /api/cmms/nameplate` REST endpoint — full vision pipeline: three vision passes (classify, detect, extract), then `create_asset_from_nameplate()`.
- `mira-core/mira-ingest/main.py:236` — `_describe_photo()` LLM vision pass on every photo upload.
- `mira-bots/telegram/bot.py:210` — Telegram photo → `/ingest/photo` pipeline (nameplate photos work via Telegram).

**Note:** Vision pipeline runs via qwen2.5vl:7b (local) or cloud cascade. Hub camera-to-nameplate web UI is in mira-scan-spec scope but spec marks computer-vision nameplate OCR as "planned" for web surface. Telegram path confirmed working.

---

### 18. DT scorecard / assessment funnel
**Status: 🟡 Partial — HTML page exists, backend scoring incomplete**

- `mira-web/public/assess.html` — File exists and is served at `GET /assess` (`mira-web/src/server.ts:445`).
- `docs/specs/dt-scorecard-spec.md` — 6-dimension CESMII-based framework spec (Data & Documentation, Work Order Management, PM, Asset Intelligence, Knowledge Sharing, Technology Readiness), 20 questions, scoring 1–5, industry benchmarks, FactoryLM CTA.
- No backend scoring endpoint, no NeonDB persistence for assessment results, no lead capture wired to CRM.

**Note:** The HTML page exists but the spec defines full functionality (lead capture, PDF scorecard output, Drip/CRM integration, benchmarked report). These appear unimplemented.

---

## Summary Table

| # | Capability | Status | Demo Risk |
|---|-----------|--------|-----------|
| 1 | Photo scan → asset creation | ✅ | Low (Telegram proven; Hub scan web UI partially out-of-scope) |
| 2 | PDF/manual ingestion → KB chunks | ✅ | Low |
| 3 | CSV bulk import for assets | 🟡 | Medium — WO only, not assets |
| 4 | Public REST API for ingest | 🔴 | High — spec only |
| 5 | MCP server for AI agent access | ✅ | Low |
| 6 | Google Drive / SharePoint / Dropbox | 🟡 | Medium — OAuth wired, sync unverified |
| 7 | QR code asset binding | ✅ | Low |
| 8 | UNS / ISA-95 data model | 🟡 | Medium — paths stored, not enforced |
| 9 | Knowledge graph | ✅ | Low |
| 10 | Vendor-scoped RAG | 🟡 | Medium — per-tenant works; shared OEM corpus partial |
| 11 | i3X compatibility envelope | 🔴 | Low for May 21 (not in demo script) |
| 12 | Self-service signup → sandbox | 🟡 | Medium — buy works; sandbox missing |
| 13 | Auto-PM extraction from manuals | 🟡 | HIGH — demo spec C4 blocks demo |
| 14 | Stripe purchase → tenant provisioning | ✅ | Low |
| 15 | Telegram / Slack ingress | ✅ (Telegram) | Low |
| 16 | CMMS write-through | ✅ | Low |
| 17 | Nameplate OCR | ✅ | Low |
| 18 | DT scorecard / assessment funnel | 🟡 | Medium — page exists, scoring not wired |

---

## Demo-Blocker Gaps (Priority Order)

### CRITICAL — Would embarrass at expo

**#13 — Auto-PM extraction from manuals** (`docs/specs/demo-readiness-may21-spec.md` item C4)
- Demo spec explicitly lists "Auto-created PMs from manual extraction show up" as a MUST WORK blocker.
- PM schedule storage exists (`mira-mcp`, `mira-hub/src/app/api/pm-schedules/`), but automated LLM extraction from PDF text to PM schedule creation is not confirmed implemented.
- **Action:** Verify end-to-end: ingest a manual PDF → confirm PM schedules appear in Atlas. If broken, either seed demo data manually or pull item from demo path before May 18.

### HIGH — Would confuse or disappoint

**#4 — Public REST API for ingest** (spec-only)
- `docs/specs/public-ingest-api-spec.md` created 2026-05-11, marked "Draft v1 — spec only, no implementation."
- Do NOT show or mention a public API in the demo — it does not exist.
- **Action:** Remove from any demo slides/talking points. It's a roadmap item.

**#12 — Self-service signup → sandbox**
- Stripe buy flow works. But the "7-day sandbox tenant with seed data" described in the public ingest spec does not exist.
- The demo relies on Mike's provisioned tenant with real data — that's fine for May 21. The gap matters for post-demo self-serve CTAs.
- **Action:** Confirm demo tenant has full seed data. Don't promise "sign up and try it yourself tonight" if sandbox isn't live.

### MEDIUM — Rough edges that could surface

**#3 — CSV bulk import for assets**
- CSV import only covers work orders, not asset records.
- If a prospect asks "can I bulk-import my equipment list from a spreadsheet?" the answer is no.
- **Action:** Have a scripted answer ("we're adding full asset import post-launch").

**#6 — Google Drive / SharePoint / Dropbox connectors**
- OAuth flows are coded. End-to-end sync (connect → auto-ingest to KB) is not verified as working.
- **Action:** Test the full Dropbox flow before May 18. If broken, remove from demo path.

**#18 — DT scorecard / assessment funnel**
- `assess.html` page exists and renders at `/assess`. Backend scoring, lead capture, and PDF report are not implemented.
- If shown live, a prospect who completes the quiz will get no result.
- **Action:** Either wire a minimal backend score by May 18, or gate the demo to showing the form UI only, not submitting.

**#11 — i3X compatibility envelope**
- Not in demo script. No action needed for May 21. Flag for post-demo positioning with enterprise prospects.

---

## Evidence File Index

| Item | Key files |
|------|-----------|
| Photo ingest | `mira-core/mira-ingest/main.py:492`, `mira-bots/telegram/bot.py:210` |
| PDF ingest | `mira-core/mira-ingest/main.py:794`, `mira-hub/src/app/(hub)/knowledge/page.tsx` |
| CSV import | `mira-web/src/lib/csv-import.ts` |
| Public API spec | `docs/specs/public-ingest-api-spec.md` |
| MCP server | `mira-mcp/server.py:154–760` |
| Drive/SharePoint/Dropbox | `mira-hub/src/app/api/auth/{dropbox,microsoft,google}/`, `mira-crawler/tasks/gdrive.py` |
| QR binding | `mira-hub/src/app/api/assets/[id]/qr/route.ts`, `mira-web/src/lib/qr-generate.ts` |
| UNS/ISA-95 | `mira-hub/src/lib/knowledge-graph/types.ts`, `mira-hub/scripts/kg-uns-backfill.ts` |
| Knowledge graph | `mira-hub/src/lib/knowledge-graph/types.ts`, `mira-mcp/server.py:620–733` |
| Tenant RAG | `mira-mcp/tests/test_ingest_pdf_tenant.py`, `mira-mcp/tenant_resolver.py` |
| i3X spec | `docs/specs/public-ingest-api-spec.md:613` |
| Stripe/signup | `mira-web/src/lib/stripe.ts`, `mira-web/src/server.ts:1059` |
| PM extraction | `mira-mcp/server.py:360`, `docs/specs/demo-readiness-may21-spec.md:C4` |
| Nameplate OCR | `mira-mcp/server.py:388,870` |
| DT scorecard | `mira-web/public/assess.html`, `docs/specs/dt-scorecard-spec.md` |
| CMMS write-through | `mira-mcp/cmms/{maintainx,fiix,limble,atlas}.py`, `nango-integrations/maintainx/` |
| Telegram/Slack | `mira-bots/telegram/bot.py`, `mira-hub/src/app/api/auth/slack/` |
