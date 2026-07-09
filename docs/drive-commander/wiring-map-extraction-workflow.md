# Runbook — Machine Pack `wiring_map` extraction (reuse-first)

**Status:** DISCOVERED / not yet built · **Date:** 2026-07-09 · **Owner rule:** wire proven pieces together; **no new architecture until the writer seam is proven.**
**Source of truth for the inventory:** `docs/discovery/2026-07-09-wiring-print-extraction-recovery.md` (read it first).

This runbook describes how an uploaded wiring diagram / photo / PDF becomes a **cited, structured, human-gated** wiring section on a drive/Machine Pack — **using code that already exists**. It exists because a discovery sweep proved the reader, the generator IR, the live extractor, and the product store are all already built; only a **writer**, an **optional Pack section**, and **one scorecard gate** are missing.

---

## The pieces you are reusing (do NOT rebuild these)

| Need | Reuse this (already in-tree / live) | Evidence |
|---|---|---|
| Upload doors | Telegram `photo_handler`/`document_handler`, Slack image path, Hub `POST /api/uploads/folder`, MiraDrop watcher | `mira-bots/telegram/bot.py:919/350`, `tools/mira-drop-watcher/main.py` |
| Classify a drawing | `vision_worker` (`ELECTRICAL_PRINT` + `_detect_drawing_type`), PDF `_ELECTRICAL_RE` routing | `mira-bots/shared/workers/vision_worker.py`, `mira-core/mira-ingest/main.py` |
| **Extract structure from an image** | **`/api/kg/schematic`** → `schematic_intelligence` (classify → detect_symbols → `trace_connections` → `to_kg_payload`) | `mira-mcp/schematic_intelligence.py`, `mira-mcp/server.py:1020` |
| Extract from a PDF wiring sheet / cable schedule | `converter._format_table_markdown` + `chunker._detect_table_regions` + Tika OCR (`mira-tika:9998`) for scanned | `mira-crawler/ingest/converter.py:74`, `chunker.py:221` |
| IR / field vocabulary | `wiring_diagram/schema.py` `Terminal`/`Connection`/`Bus` **or** §4 `TerminalRecord`/`WireRecord` | `mira-bots/shared/wiring_diagram/schema.py`, `docs/references/industrial-wiring-diagram-standards.md` §4 |
| Mandatory evidence | §4 `Evidence` block + `relationship_evidence`; `to_kg_payload` already emits proposals | `industrial-wiring-diagram-standards.md` §4.7 |
| **Structured destination** | **`wiring_connections` table (migration 026)** — currently DORMANT (no writer) | `mira-hub/db/migrations/026_wiring_connections.sql` |
| Chat over the result | merged `ELECTRICAL_PRINT` reader (`_analyze_schematic_with_question` + `PrintWorker`); cited Hub chat (`assets/[id]/chat`) | `mira-bots/shared/engine.py:891`, `mira-hub/src/app/api/assets/[id]/chat/route.ts` |
| Validation | `tools/drive-pack-extract/scorecard.py` (trust ladder, `--ci`) — extend the L177 "wiring/keypad presence" seam | `tools/drive-pack-extract/scorecard.py:147/177` |

**Ignore / do not touch:** `mira-sidecar` (dead ChromaDB), docling (removed — orphaned imports fall back), `glm-ocr` (HTTP 400 in prod; use `qwen2.5vl`), `feat/northwind-cv200-cloud-wiring` (name false-positive). Do **not** fork the docling→Tika migration — coordinate with `fix/needs-ocr-tika-drain` (#2539).

---

## The workflow

```
UPLOAD  Telegram/Slack photo+PDF · Hub /api/uploads/folder · MiraDrop
   │
CLASSIFY  vision_worker → ELECTRICAL_PRINT + drawing_type ; PDF → _ELECTRICAL_RE
   │
EXTRACT   image  → /api/kg/schematic   (symbols + trace_connections)
          PDF    → converter tables + Tika OCR + §4 connection-table parse
   │
EVIDENCE  every terminal/wire carries §4 Evidence (page/grid/bbox/ocr_confidence)
          ── NO EVIDENCE ⇒ the fact is NOT asserted; mark it a gap (never invent) ──
   │
STRUCTURE normalize → wiring_connections (mig 026)
          approval_state='proposed', tenant-scoped, + relationship_evidence
   │
PACK      assemble drive-pack wiring_map section (schema_version 3, OPTIONAL/back-compat)
          from the family/asset's VERIFIED wiring_connections rows only
   │
SCORECARD scorecard.py wiring gate: presence · cite-integrity · no-invention · trust ladder · --ci
   │
HUMAN     proposed → verified on human sign-off (Hub /proposals). NEVER auto-verify.
```

Grounding invariants (already the house style — reuse verbatim):
- **Evidence-or-gap.** No page/grid/symbol/bbox evidence → the terminal/wire is a **gap**, drawn/stored as unpopulated, never guessed. (`verified | field_verify | proposed`, as in `plc/conv_simple_electrical/model/*.yaml`.)
- **Proposed → verified is human-only.** The writer sets `approval_state='proposed'`; promotion is a human decide, never automatic (ADR-0017, §4.7).
- **Tenant-scoped + RLS.** `wiring_connections` already carries the tenant policy + grants — honor them.

---

## Build order (each step independently valuable, gated, minimal)

### PR-1 — Prove the dormant store with cited data (zero vision risk) ← START HERE
Load the **already-cited, human-verified** `plc/conv_simple_electrical/model/{terminals,wires,devices}.yaml` (`status: verified`) and write those wire records into `wiring_connections` (mig 026) as `approval_state='proposed'`, tenant-scoped, each row carrying its `source:` as evidence. Round-trip read-back test. **No pack change, no scorecard change, no vision call.**
*Why first:* it exercises the single missing seam (the table's writer) with data that cannot hallucinate, proving store + evidence discipline end-to-end.

### PR-2 — Wire the live extractor into the same writer
Feed `/api/kg/schematic` (`schematic_intelligence`) output through the PR-1 writer for a **real** drawing (start with the CV-101 print, whose ground truth is known from `docs/onboarding/cv-101-evidence/`). Everything below `medium` OCR confidence → gap, not a row. Gate: extracted connections that match the cited CV-101 evidence promote to a proposal; the rest stay gaps.

### PR-3 — Optional Pack `wiring_map` section + scorecard gate
Add an **optional** `wiring_map` block to `drive_packs/schema.py` (bump `schema_version` 2→3; loader accepts packs with or without it). Assemble it from the family/asset's **verified** `wiring_connections` rows. Extend `scorecard.py` at the L177 seam with a wiring gate (presence + cite-integrity + no-invention), same trust ladder + `--ci`.

**Deferred / ruled out for now (recorded decision):** routing uploaded drawing **images** into the citable `knowledge_entries` chunk corpus (the image-citability gap) is a separate ingest change entangled with the live docling→Tika consolidation — defer until that cluster lands. Treat `wiring_connections` (structured), not `knowledge_entries` (chunks), as the wiring destination.

---

## Verification (per step)
- **PR-1:** `python <writer> --asset cv-101 --dry-run` prints the proposed rows; apply → `tests/integration/test_phase0_schema.py`-style round-trip read-back returns them; every row has non-null evidence; all `approval_state='proposed'`.
- **PR-2:** the schematic-extracted connection set for the CV-101 print ⊆ the cited CV-101 evidence (no invented wire numbers); low-confidence items land as gaps, not rows.
- **PR-3:** a pack with a `wiring_map` and one without both load (back-compat); `scorecard.py --ci` passes for a cited wiring section and **fails** for an invented/uncited one (falsifiable, like the flywheel benchmark).

## Cross-references
- Inventory + recommended PR detail: `docs/discovery/2026-07-09-wiring-print-extraction-recovery.md`
- Reader doctrine (§4 extraction model, §4.7 graph mapping): `docs/references/industrial-wiring-diagram-standards.md`
- Store: `mira-hub/db/migrations/026_wiring_connections.sql` · Live extractor: `mira-mcp/schematic_intelligence.py` (`/api/kg/schematic`)
- Generator IR: `mira-bots/shared/wiring_diagram/schema.py` · Cited data: `plc/conv_simple_electrical/model/*.yaml`
- Pack plug-in points: `mira-bots/shared/drive_packs/schema.py`, `tools/drive-pack-extract/scorecard.py:177`
- Prior audits: `docs/discovery/electrical_print_reuse_audit.md`, `docs/discovery/electrical_print_prior_artifact_recovery.md`
- Ingest saga (coordinate, don't fork): `docs/discovery/2026-07-07-prod-ingest-docling-and-vps-memory.md`, branch `fix/needs-ocr-tika-drain` (#2539), blueprint `docs/adr/0019-miradrop-ingest-v2.md`
