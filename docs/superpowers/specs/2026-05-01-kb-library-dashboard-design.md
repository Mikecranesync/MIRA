# KB Library Dashboard and Self-Diagnosing Ingest — PRD

**Date:** 2026-05-01  
**Status:** Draft  
**Owner:** MIRA / FactoryLM  
**Related:** `docs/superpowers/specs/2026-04-09-24-7-kb-ingest-pipeline-design.md`, `docs/superpowers/specs/2026-04-24-knowledge-upload-picker-design.md`, `docs/developer/ingest-latency.md`

## Summary

Build a human-readable knowledge-base library and an internal ingest operations dashboard. The public/customer-safe view should present the KB as a library tree: manufacturer -> product family/model -> manual/document -> metadata. The internal view should show live ingest health, latency, parser failures, queue state, and operator actions.

The dashboard must hide chunk jargon from prospects and technicians. Chunks remain an internal implementation detail; the product surface should answer: "Which manufacturers, machines, manuals, and document types does MIRA know?"

## Problem

MIRA currently talks about KB scale in chunks, but customers understand manuals, machines, vendors, and fault-code coverage. Operators also cannot see, in one place, whether the ingest pipeline is healthy. Current failure evidence is scattered across cron logs, Docling logs, queue JSON, and ad hoc latency JSONL.

Recent KB-growth runs exposed the core observability gap:

- Docling can be healthy at `/health` while individual documents still take 10+ minutes or return empty content.
- Cron can appear to run while queue progress stalls unless exit codes and per-document status are surfaced.
- A successful parse can still produce suspicious output, such as high extracted character count but low stored chunk count.
- The current public story says "25,000+ chunks", which is technically true but not persuasive.

## Goals

1. Publish a FactoryLM KB Library page that shows the shared public-safe documentation index as a navigable table of contents.
2. Add an internal KB Ops dashboard that reports ingest health in near-real time.
3. Make the ingest pipeline self-diagnosing with structured stages, error categories, retry state, parser identity, and latency measurements.
4. Add operator actions for retrying, quarantining, reparsing, and restarting parser services.
5. Create a parser grading path so Docling and candidate replacements can be compared on speed, success rate, extracted structure, and schema fit.

## Non-Goals

- Do not publish customer-private documents or tenant-specific manuals to the public page.
- Do not expose full manual text publicly unless legal/source rights are explicitly approved.
- Do not add a cloud monitoring product or managed scheduler that violates MIRA's cloud constraints.
- Do not adopt AGPL/GPL dashboard platforms.
- Do not replace the parser stack before measuring current failures and schema mismatches.

## Users

- **Prospect:** wants proof that FactoryLM understands real industrial equipment, not generic chatbot claims.
- **Customer admin:** wants to know which uploaded manuals are indexed and whether their plant docs are ready.
- **MIRA operator:** wants failures, latency, retries, and parser health without SSHing into the VPS.
- **Support engineer:** wants a document run ID, stage timing, parser output, and suggested remediation.

## Product Surface

### Public KB Library

Route target: `factorylm.com/library` or `factorylm.com/knowledge-base`.

This page shows only documents marked `visibility = public` or `visibility = shared_catalog`. It should be useful as marketing proof and safe to share in demos.

Required content:

- Top stats: manufacturers, models/assets, manuals/documents, fault-code entries.
- Search across manufacturer, model, document title, document type, and source family.
- Tree view:
  - Manufacturer
  - Product family or model
  - Manual/document title
  - Document type, page count when known, indexed date, parser status badge.
- Filters: manufacturer, document type, equipment class, indexed freshness.
- Customer-readable labels: "Manuals", "Fault code references", "Install guides", "Technical data", "Safety docs".
- Optional proof row per document: "Used in cited answers" count once available.

No public page should display:

- Tenant ID
- Customer source filename if private
- Full chunk text
- Raw parser logs
- Internal failure tracebacks
- Private source URLs

### Internal KB Ops Dashboard

Route target: `mira-hub` authenticated area, extending `/knowledge` or adding `/knowledge/ops`.

Required panels:

- Live status strip: Healthy, Degraded, Failing, Paused.
- Current queue: active document, parser, elapsed time, stage, retry count.
- Last 24 hours: completed, failed, quarantined, retried.
- Failure inbox: document, manufacturer/model, stage, error category, last error, suggested action.
- Parser comparison: Docling vs fallback adapters by latency, success rate, empty-output rate, and schema completeness.
- Document anomalies: high parse chars with low stored chunks, zero fault-code extraction for known fault manuals, duplicate-heavy ingest.

## Dashboard Indicators

The first dial is required by the user; the next three are the recommended operator-grade indicators.

| Indicator | Definition | Why it matters | Initial thresholds |
|---|---|---|---|
| Ingest latency | p50/p95 delivery-to-KB time from `delivered_at` to `completed_at` | Shows whether docs are becoming searchable fast enough | Green p95 < 10 min, yellow 10-30 min, red > 30 min |
| Parse success rate | Successful parses / attempted documents over rolling 24h and 7d | Separates parser reliability from queue volume | Green >= 95%, yellow 85-95%, red < 85% |
| Queue freshness | Age of oldest pending item plus current backlog count | Detects a cron that runs but does not drain work | Green oldest < 24h, yellow 1-3d, red > 3d |
| Coverage quality | Weighted score from parsed chars, stored chunks, metadata completeness, citation readiness | Catches "succeeded" runs that are not useful | Green >= 0.85, yellow 0.65-0.85, red < 0.65 |

Secondary metrics:

- Empty-output rate by parser.
- Parser restart count.
- Duplicate rejection rate.
- Chunk-store ratio: stored chunks / candidate chunks.
- Fault-code extraction rate for manuals expected to contain faults.
- OCR warning count.

## Status Buttons and Actions

Actions are visible only to admins/operators and should require confirmation for disruptive operations.

- **Retry**: rerun the same document with the same parser and current code.
- **Retry with fallback**: rerun using the next parser adapter.
- **Quarantine**: mark a document as blocked so cron skips it until reviewed.
- **Restart parser**: restart `mira-docling-saas` after healthcheck or timeout criteria are met.
- **Rebuild document index**: regenerate library metadata from existing KB rows.
- **Publish/unpublish**: toggle whether a document appears on the public library page.
- **Open logs**: show redacted run logs and stage timings.
- **Mark resolved**: close a failure after successful reparse.

Auto-restart policy:

- Trigger only after N consecutive parser timeouts, parser healthcheck failure, or a worker exceeding max wall time.
- Restart once, back off, and retry the current document once.
- If retry fails, mark the run `failed`, mark dashboard `degraded`, switch to fallback if configured, and emit an alert.
- Never loop restarts indefinitely.

## Data Model

The existing Hub API groups `kb_chunks` by `system_category`, `subcategory`, `manufacturer`, `product_family`, `doc_type`, and `source`. Keep that as the first source of truth, but add document-level tables so we stop inferring manuals from chunks.

### `kb_documents`

One row per source document/manual.

Fields:

- `id UUID PRIMARY KEY`
- `tenant_id TEXT NULL` for global/shared docs; populated for tenant docs.
- `visibility TEXT NOT NULL` enum: `private`, `tenant`, `shared_catalog`, `public`.
- `manufacturer TEXT`
- `product_family TEXT`
- `model_number TEXT`
- `equipment_class TEXT`
- `manual_title TEXT`
- `manual_type TEXT`
- `source_url TEXT`
- `source_file TEXT`
- `source_hash TEXT`
- `page_count INTEGER`
- `file_bytes BIGINT`
- `parser TEXT`
- `parser_version TEXT`
- `status TEXT` enum: `queued`, `parsing`, `indexed`, `failed`, `quarantined`, `stale`.
- `parsed_chars INTEGER`
- `candidate_chunk_count INTEGER`
- `indexed_chunk_count INTEGER`
- `fault_code_count INTEGER`
- `quality_score NUMERIC`
- `last_ingest_run_id UUID`
- `created_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ`

### `kb_ingest_runs`

One row per attempt.

Fields:

- `id UUID PRIMARY KEY`
- `document_id UUID REFERENCES kb_documents(id)`
- `source_id TEXT`
- `source_url TEXT`
- `parser TEXT`
- `parser_version TEXT`
- `status TEXT` enum: `running`, `ok`, `failed`, `quarantined`.
- `delivered_at TIMESTAMPTZ`
- `started_at TIMESTAMPTZ`
- `completed_at TIMESTAMPTZ`
- `delivery_to_start_ms INTEGER`
- `delivery_to_done_ms INTEGER`
- `download_ms INTEGER`
- `parse_ms INTEGER`
- `chunk_ms INTEGER`
- `embed_ms INTEGER`
- `store_ms INTEGER`
- `kg_ms INTEGER`
- `parsed_chars INTEGER`
- `candidate_chunk_count INTEGER`
- `indexed_chunk_count INTEGER`
- `error_category TEXT`
- `error_message TEXT`
- `retry_count INTEGER DEFAULT 0`
- `restart_attempted BOOLEAN DEFAULT false`
- `metadata JSONB`

### `kb_ingest_events`

Append-only event log for stage-level detail and dashboard timelines.

Fields:

- `id UUID PRIMARY KEY`
- `run_id UUID REFERENCES kb_ingest_runs(id)`
- `event_type TEXT`
- `stage TEXT`
- `status TEXT`
- `message TEXT`
- `duration_ms INTEGER`
- `metadata JSONB`
- `created_at TIMESTAMPTZ`

## Error Taxonomy

All failures should map to one stable category:

- `download_failed`
- `unsupported_file_type`
- `parser_timeout`
- `parser_exception`
- `parser_empty_output`
- `ocr_low_confidence`
- `chunk_empty`
- `embedding_failed`
- `db_insert_failed`
- `kg_extract_failed`
- `quality_gate_failed`
- `dedup_all_rejected`
- `schema_mapping_failed`
- `unknown`

Each failure should include:

- Document ID
- Run ID
- Parser and version
- Stage
- Duration
- Error category
- Redacted message
- Suggested next action

## Parser Grading

The parser benchmark should run the same document set through each adapter and score:

- Delivery-to-index latency.
- Parsed character count.
- Page coverage.
- Table extraction quality.
- Fault-code extraction yield.
- Chunk-store ratio.
- Metadata completeness against `kb_documents`.
- Citation readiness: page/source fields present.
- Failure rate and timeout rate.

Initial candidate set:

- **Docling**: keep as primary candidate. Research confirms MIT licensing and strong structured document conversion fit.
- **Unstructured**: candidate fallback/comparison adapter. Research confirms Apache-2.0 licensing for the OSS/API repos.
- **Text-layer fallback adapter**: useful for keeping ingestion moving when layout parsing fails. Any library choice must pass the Apache 2.0/MIT-only policy before being added as a dependency.

Do not adopt PyMuPDF, Marker, or other parser libraries until license review is complete. Avoid AGPL/GPL components under the current project rules.

## APIs

Public-safe:

- `GET /api/kb/library`
- `GET /api/kb/library/tree`
- `GET /api/kb/library/stats`

Authenticated:

- `GET /api/kb/documents`
- `GET /api/kb/documents/:id`
- `GET /api/kb/health`
- `GET /api/kb/ingest-runs`
- `GET /api/kb/ingest-runs/:id`
- `POST /api/kb/ingest-runs/:id/retry`
- `POST /api/kb/documents/:id/quarantine`
- `POST /api/kb/documents/:id/publish`
- `POST /api/kb/parser/restart`

The existing `mira-hub/src/app/api/knowledge/route.ts` should remain compatible. New routes can return richer document/run models while the current page continues to group `kb_chunks`.

## Implementation Plan

### Phase 1 — Inventory and Index

- Add a library-index builder that groups existing KB rows into `kb_documents`.
- Backfill manufacturer, product family, model, document type, source URL, and chunk counts.
- Add visibility defaults: shared OEM docs can be `shared_catalog`; tenant docs default to `private`.
- Add anomaly detection for low stored chunks, zero parsed chars, and duplicate-heavy documents.

### Phase 2 — Ingest Run Sink

- Extend the existing latency JSONL recorder into a DB sink.
- Write one `kb_ingest_runs` row per wrapped command.
- Emit `kb_ingest_events` for download, parse, chunk, embed, store, KG extraction, and quality gates.
- Ensure cron exits nonzero on failed documents.

### Phase 3 — Internal Ops Dashboard

- Extend `mira-hub` knowledge UI with ops tabs or add `/knowledge/ops`.
- Use existing `recharts` for the first dials and trends.
- Use current Hub shell, tokens, badges, and Lucide icons.
- Add admin-only action buttons.

### Phase 4 — Public FactoryLM Library Page

- Add a public `mira-web` page backed by only public/shared catalog records.
- Render a searchable library tree and customer-readable stats.
- Add a "last updated" stamp and public-safe status badges.
- Avoid full-text excerpts until content rights are explicitly decided.

### Phase 5 — Parser Benchmarking and Auto-Recovery

- Build a fixed three-to-ten-document benchmark set with varied manuals.
- Grade Docling and candidate fallback adapters.
- Add one-shot parser restart automation with backoff.
- Add failure reports that can be sent to Slack/email later without changing schema.

## Open-Source Bootstrap Research

License policy: only Apache 2.0 or MIT dependencies are acceptable unless legal approval changes the rule.

Recommended:

- **Recharts** — MIT. Already installed in `mira-hub`, good enough for latency/success/backlog dials.
- **Apache ECharts** — Apache 2.0. Strong option if gauge/dial visuals outgrow Recharts.
- **TanStack Table** — MIT. Good candidate for sortable/filterable document and failure tables.
- **shadcn/ui patterns** — MIT. Useful as component inspiration if the Hub continues using Radix/Tailwind-style primitives.
- **Docling** — MIT. Keep measuring it before replacing it.
- **Unstructured** — Apache 2.0. Candidate parser fallback/comparison service.
- **Docusaurus/Nextra** — MIT. Useful inspiration for docs navigation, but probably too much framework for the current Hub/Web split.

Avoid for this feature:

- **Grafana OSS** — AGPL-3.0; violates the current license rule.
- **Metabase OSS** — AGPL; violates the current license rule.
- Any dashboard/observability package with AGPL, GPL, SSPL, Elastic License, or non-commercial restrictions.

Sources reviewed:

- Apache ECharts GitHub/license: `https://github.com/apache/echarts`
- TanStack Table GitHub/license: `https://github.com/TanStack/table`
- Recharts docs/license: `https://recharts.github.io/`
- shadcn/ui license: `https://github.com/shadcn-ui/ui/blob/main/LICENSE.md`
- Docusaurus GitHub/license: `https://github.com/facebook/docusaurus`
- Docling license references: `https://arxiv.org/abs/2501.17887`, `https://www.ibm.com/docs/en/esfd?topic=elite-support-docling-specification`
- Unstructured API GitHub/license: `https://github.com/Unstructured-IO/unstructured-api`
- Grafana GitHub/license: `https://github.com/grafana/grafana`
- Metabase license page: `https://www.metabase.com/license/`

## Acceptance Criteria

- Public page shows library stats and a manufacturer/model/manual tree without mentioning chunks as the primary unit.
- Public page never exposes private tenant docs.
- Internal dashboard shows current active ingest, oldest pending item, p50/p95 latency, parse success rate, queue freshness, and coverage quality.
- Failed runs appear with stable error categories and suggested actions.
- Operators can retry, quarantine, and restart parser service from admin-only controls.
- Ingest runs write structured DB records and still preserve append-only JSONL logs.
- A three-document parser benchmark can be rerun and compared across parser adapters.
- Cron reports failure with nonzero exit code when a document fails.

## Risks

- Existing KB metadata may not be clean enough to infer manual titles. The index builder should flag unknowns rather than inventing names.
- Public catalog rights need confirmation before exposing source URLs or document titles from downloaded OEM manuals.
- Parser latency can be high for large PDFs; dashboard must distinguish slow-but-progressing from stuck.
- A "success" status can hide poor utility if all chunks dedup away or schema mapping is empty. Coverage quality needs to be first-class.
- Adding too many dashboard dependencies will slow delivery; start with existing Hub stack.

## First Build Slice

Ship a narrow but real version:

1. `kb_documents` and `kb_ingest_runs` migrations.
2. Backfill script from current `kb_chunks`.
3. DB sink for the existing latency recorder.
4. Internal `/knowledge/ops` page with four dials and failure inbox.
5. Public `/library` page with manufacturer -> model -> document tree.
6. Parser benchmark report for the current three-document watch set.
