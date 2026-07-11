# PLC Program Parsing — Discovery Inventory

Sibling dirs `mira-uns`, `mira-gui`, `mira-why` are NOT git repos — plain file copies of MIRA (leftovers). `mira-events`, `mira-flightsim` have nothing PLC-related.

## ⚠️ Headline: THREE diverged lineages of mira-plc-parser, one lost mid-merge

| Lineage | Where | Phases | On main? |
|---|---|---|---|
| **A — main** | `MIRA/mira-plc-parser` | Phase 1 (L5X+CSV) + Phase 2 (ST+PLCopen) + UNS/i3X proposal layer + coverage/inspect | ✅ |
| **B — `feat/vfd-analyzer-auto-map`** (local + origin) | same path, diverged after Phase 2 | Phases 3–7: **correlate** (fuses L5X+CSV+Modbus by signal name), **compiler** (folder→asset graph), **vqt_attach** (live value binding), Phase 5 **analysis depth** (permissives/interlocks, timer→fault chains, sequences), Phase 6 **Siemens TIA Openness XML**, Phase 7 **PDF/OCR fallback** | ❌ unmerged |
| **C — `feat/plc-mapper-gui`** (local + origin) | same path | Tag Mapper / Namespace Builder GUI + i3X live server client (+ AOI/FBD/module L5X — those ARE merged) | ❌ GUI **silently lost in merge `6b11ed87`** (PR #2141); fully recoverable from `origin/feat/plc-mapper-gui` |

- "What prevents this motor from running" capability (`_permissives`, `_timer_fault_chains`, `_sequences` in analyze.py, REVIEW-graded interlock chains) exists ONLY on branch B.
- Tag Mapper GUI: built (`ba4e98bc`→`83b14ecc` MIRA-Tag-Mapper.exe, PyInstaller, WebView2, accept/reject Tag Roles tab), lost in merge conflict resolution, recover via `git show origin/feat/plc-mapper-gui:mira-plc-parser/gui/desktop.py` etc.

## 1. mira-plc-parser core (main) — production, REUSE as base
- `ir.py` — MIRA PLC IR (Controller→Program→Routine→Rung→Tag + Provenance{confidence: HIGH/MEDIUM/LOW/REVIEW})
- `detect.py` — content-first vendor/format detector (L5X, CSV, PLCopen, ST; Siemens stub)
- `parsers/rockwell_l5x.py`, `csv_tags.py`, `structured_text.py`, `plcopen_xml.py`, `ignition_json.py` (ISA-95 + i3X export)
- `analyze.py` — tag dictionary, routine summaries, output-dependency map, fault/asset/VFD-signal candidates, safety-review flags. SHALLOWER than branch B (no permissive/interlock/timer/sequence extraction)
- `coverage.py` — parser honesty: elements present vs extracted, coverage %, gap milestones
- `uns.py` — ISA-95 UNS path proposal per tag (confidence tiers, overridable prefix)
- `i3x.py` — UNS proposals → CESMII i3X payload
- `pipeline.py` — report schema pinned `mira-plc-parser/report@1`; `cli.py` — analyze/inspect/benchmark/i3x-export; dist .exe
- 128 tests; fixtures: conveyor.L5X/.plcopen.xml/.st, gs10_tags.csv, ignition_cappy_hour_mini.json, golden report snapshots
- `evals/real_samples/` (untracked, new): 4 real Siemens/Rockwell XML samples — DIFFERENT from branch B's evals (which has scoring rubric + licensed SCL sample; branch B's more mature) — merge the two eval sets

## 2. Branch B (feat/vfd-analyzer-auto-map) — experimental, unmerged, tested → MIGRATE (highest priority)
- `correlate.py` — multi-source fusion L5X+CSV+CCW Modbus map (MbSrvConf CSV dialect), asset-scoped node IDs
- `compiler.py` — "PLC Asset Compiler": folder of messy exports → discovery → parse → normalize → fuse → provenance/confidence → asset graph → human-review report; `compile_folder(asset_by="folder")`. Doc: COMPILER.md
- `roles.py`, `discovery.py` — signal-role classification, export discovery
- `vqt_attach.py` — live snapshot (addr→value) onto compiled graph → asset_graph.live.json (V/Q/T per signal). Doc: VQT_ATTACH_SPEC.md (#2102)
- `analyze.py` Phase 5 — `_permissives()` (safety permissives graded REVIEW), `_timer_fault_chains()`, `_sequences()` (step/state registers), `_is_equipment_output()`
- `parsers/siemens_tia_xml.py` — TIA Openness XML (SCL), validated vs real MIT-licensed sample
- `parsers/pdf_ocr.py` — PDF/screenshot OCR fallback (low-confidence)
- CLI adds correlate/compile/attach subcommands
- Tests: test_correlate, test_compiler, test_roles, test_analysis_depth, test_siemens, test_pdf_ocr, test_vqt_attach — none on main

## 3. Branch C GUI — orphaned → MIGRATE (recover, don't rebuild)
- `gui/desktop.py` (129 lines) + `gui/index.html` (266) — "MIRA Namespace Builder": reads report.json, prefix once, live UNS path recompute, confidence color-coding, i3X export; Tag Roles accept/reject
- `MIRA-Tag-Mapper.spec` — single .exe, zero third-party deps (WebView2)
- `758e43ad` — i3X SERVER client (only live-system piece in the domain)
- Reconcile against current report@1 schema; consider folding UX into mira-contextualizer instead of second standalone GUI

## 4. mira-contextualizer/ — production, on main → REUSE/EXTEND
Windows desktop app; ingests any doc (manuals, wiring PDFs, PLC exports) → deterministic UNS/roles/i3X proposals; composes mira-plc-parser. Modules: engine.py, contextualize.py (fault codes, drive params, catalog numbers, cross-refs), bundle.py (portable bundle@1 zip: manifest, uns.json, i3x.json, kg_entities/relationships, signals.csv, review.json), profile.py (.miraprofile), ccw.py, manuals.py, placement.py, standards.py, scorecard.py, server.py. 14 test files. Hub bridge: POST /api/contextualization/import → KG via Promote flow.

## 5. mira-hub — TWO live PLC-import surfaces (dedupe flag)
- `plc-import/page.tsx` + `plc-import-view.ts` — PLC Import wizard (Phase 8, merged) → `/api/connectors/plc/import` → mira-ingest `/ingest/plc-parse` (`mira-core/mira-ingest/main.py`, HTTP sidecar exposing mira-plc-parser; test_plc_parse.py)
- `/api/contextualization/import` — contextualizer bundle path
- Parallel intake surfaces with overlapping purpose → reconcile, not urgent.

## 6. plc/ — Micro820 Conv_Simple lineage
- `discover.py` (629 lines) + test — read-only fieldbus discovery (subnet + RS-485, device-profiles/*.yaml, inventory.json; READ-only Modbus + CIP List Identity). Production. Reuse.
- `deploy_modbus_map.py` — writes MbSrvConf XML into CCW project. Production tooling.
- 12 versioned ST program iterations + 3 versioned Modbus maps = commissioning audit trail (archive)
- `ccw/` — closed CCW binary project (not parseable, correct)
- CCW project scripting: create_ld_project.py, populate_variables.py, inject_vars_accdb.py, ccw_autoflash_1_9.py
- `specs/phase1_conveyor.iecst`, `phase1_ladder.md`, `Prog2_ladder.md` — ground-truth ladder specs, potential parser fixtures
- `vfd_diag.py`, `live_monitor.py`, `mqtt_publisher.py` — live telemetry (downstream)

## 7. mira-machine-logic-graph/ — DUPLICATE flag
TypeScript/Bun service, does NOT use mira_plc_parser. Parses CCW ST (plc/Prog2.stf) + variable-manifest.json (supplies Modbus addresses .stf lacks) → Ignition tag JSON with i3x.* metadata. Endpoints /health /projects /projects/:id/ignition-tags. Genuine duplication with parsers/structured_text.py — reconcile/retire one (Python IR pipeline is stated long-term architecture). Its ST-identifiers ∩ variable-manifest Modbus-address-merge trick should be absorbed by branch B's correlate.py.

## 8. Adjacent
- `mira-connect/mira_connect/drivers/modbus_driver.py` + tests — live Modbus polling driver (runtime, not parser)
- `ignition/` — tag allowlist + WebDev target
- `plc/conv_simple_anomaly/` — anomaly engine consuming live telemetry (downstream, not duplicate)

## Verdicts
| Component | Verdict |
|---|---|
| mira-plc-parser core (main) | reuse — base |
| Branch B compiler/correlate/depth/Siemens/OCR | **migrate — highest priority** (answers "what controls/prevents X") |
| Branch C GUI | migrate — recover from origin, reconcile into contextualizer |
| mira-contextualizer | reuse/extend |
| Hub PLC wizard + mira-ingest bridge | reuse (reconcile dual intake later) |
| plc/discover.py, deploy_modbus_map.py | reuse |
| mira-machine-logic-graph | duplicated — reconcile/retire |
| Dual eval sets (main vs branch B) | merge — branch B's more mature |
