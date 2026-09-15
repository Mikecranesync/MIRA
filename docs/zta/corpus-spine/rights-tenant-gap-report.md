# Corpus-Spine PR A — Rights & Tenant-Policy Gap Report (2026-07-29)

Source: full classification of all 81 `knowledge_entries` touchpoints
(`knowledge_entries_touchpoints.jsonl`) against `.claude/rules/knowledge-entries-tenant-scoping.md`
and `.claude/rules/oem-crawler-trusted.md`. **Audit only — no fixes, no backfills, no flag
flips in this slice** (PRD §11.9–10: counts and quarantine reports, not best-guess updates).

## P0 — leak-shaped readers (no tenant predicate)

| File | Exposure | Note |
|---|---|---|
| `mira-bots/shared/pm_extractor.py` | reads chunk CONTENT across all tenants incl. `is_private=true` | worst finding; cross-tenant content flow into PM extraction |
| `mira-hub/.../api/knowledge/manufacturer/route.ts` | private source_urls + titles in rollups | metadata leak |
| `mira-hub/.../api/knowledge/route.ts` | comment CLAIMS an is_private filter; queries have none | doc-vs-code divergence |
| `knowledge/stats`, `knowledge/growth`, `usage` routes | counts only | low severity, still unscoped |
| `youtube_harvester.py`, `backup_knowledge_base.py` | operator tools, full-table | acceptable if operator-only; document |

**Recommended follow-up (separate fix PRs, not this slice):** hybrid-law predicate on
pm_extractor + the three knowledge routes; regression tests per
`knowledge-entries-tenant-scoping.md` "what a reviewer must catch."

## P1 — write-law violations

- **`mira-core/mira-ingest` photo path** (`db/neon.py` + `main.py`): per-tenant photo
  content written with hardcoded `is_private=false` — violates the write law ("per-tenant
  uploads set is_private=true"); future cross-tenant exposure of customer photos.
- **`mira-crawler/ingest/kg_writer.py`**: UPDATE without tenant predicate.
- **`mira-core/scripts/remediate_knowledge_base.py`**: destructive DELETE (ops script) —
  quarantine-listed; must never run against prod without the environments doctrine.

## P1 — verified=true writers outside the sanctioned doctrine

Sanctioned: curated ManufacturerCrawler (SP1) and human admin decide route. Found
auto-verifying beyond that: `learning_ingester.py` (FAQ), `seed_kb_gaps.py`,
`apply_oem_seed.py`, `ingest_local_pdf.py` (local-path provenance is weak),
`seed-simlab-docs.py` (contained to demo tenant — acceptable, document). Each needs a
doctrine reference or a demotion decision (PRD §11.8).

## Unprovable-origin row groups (backfill FORBIDDEN — report only)

Per `.claude/rules/oem-crawler-trusted.md` ("a backfill selector is not a provenance
test"), these historic row groups cannot prove which writer created them from stored
metadata and are **marked, not modified**:

1. All `store.py`-written rows (no crawler-class column) — ManufacturerCrawler vs
   CSVCrawler vs `ingest_url` indistinguishable.
2. The `equipment_manual` shape shared by crawlers and `ingest_manuals.py`/gdrive/gmail
   ops scripts (same output shape, different trust).
3. `neon.py`-layer script writes (MIRA_TENANT_ID era).

**Provable-origin groups** (safe for future targeted work): v2 Hub uploads
(`ingest_route='v2'` + document id), `approved_faq` (feedback:// URL scheme), seeds with
`chunk_key`, SimLab demo tenant rows.

## Golden paths (confirmed compliant — protect these)

- Per-tenant upload chain: `node-knowledge-ingest.ts`, `documents/upload`,
  `namespace/node/files` (+ Telegram/Slack/contextualization clients) — literal
  `is_private=true`, provable provenance.
- Hybrid-law readers: `neon_recall.py`, `manual-rag.ts` (three dialects noted in the
  unified inventory — consolidation is future work, not this slice).
- SP1 curated OEM trust: `store.py` `oem_trusted` param scoped to ManufacturerCrawler.

## Duplicate/legacy path report (carried from the unified inventory, unchanged)

Review console v1 (retire), flywheel export bypassing paid_gate (gate or retire),
technician_v1_1 builder (archive), 4 drive-pack copies w/ 1 drift guard, retrieval law in
3 dialects, `verified` column unbackfilled (gate flip would zero retrieval — **do not flip
globally**, PRD §11.6), garage-tenant orphan producers (`tasks/_shared.py`,
`full_ingest_pipeline.py`).
