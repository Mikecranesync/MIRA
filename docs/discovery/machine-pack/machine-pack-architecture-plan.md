# Machine Pack Architecture — Discovery Synthesis & Phased Build Plan

**Produced 2026-07-10** from the mandate (`FactoryLM-MIRA Architecture.docx`) by 8 parallel Sonnet discovery agents (repo + branch archaeology) + 1 Opus lead-architect synthesis. Repo: `Mikecranesync/MIRA`, main at VERSION 3.128.5. Ships as small reviewable PRs, no prod deploys, read-only by default.

**One-line finding:** The mandate assumes a greenfield build. The codebase is ~70-80% there. The correct move is *generalize, migrate, and wire what exists* — not invent. The single highest-leverage action is porting the unmerged PLC cause-and-effect analysis from `feat/vfd-analyzer-auto-map`. **The gs10-ask-tool worktree (`feat/hub-live-signal-polish`) is ~70 commits stale — rebase on `origin/main` before any code work; six inventories independently flagged this.**

Full domain inventories (source material): `scratchpad/discovery/01..08-*.md` (PLC parsing, print/wiring, drive packs, KB/KG/UNS, live state, WO/CMMS, diagnostics/safety/eval, pack formats/APIs).

---

# Part 1 — Discovery Report (condensed synthesis)

## Per-capability status table

| Capability | What EXISTS (path · status) | Verdict | What's MISSING |
|---|---|---|---|
| **Pack format** | `mira-bots/shared/drive_packs/schema.py` (DrivePack dataclasses, schema_version 1\|2, family/nameplate/live_decode/envelope/knowledge/provenance/parameters/keypad_navigation) · prod. `packs/README.md` field doc. | **generalize (base)** | `kind` discriminator; generic signal-decode block (live_decode is VFD-shaped) |
| **A. PLC Reader** | `mira-plc-parser/` core (main): `ir.py`, `detect.py`, parsers (L5X/CSV/PLCopen/ST/ignition_json), `analyze.py` (shallow), `coverage.py`, `uns.py`, `i3x.py`, `pipeline.py` pinned `report@1` · prod, 128 tests. **Deep cause/effect (`_permissives`/`_timer_fault_chains`/`_sequences`/`compiler.py`/`correlate.py`/`vqt_attach.py`/Siemens TIA/PDF-OCR) on `feat/vfd-analyzer-auto-map`** · unmerged, tested. | **reuse core + MIGRATE branch B (highest priority)** | "What prevents this motor" lives only on branch B; not on main |
| **B. Compiler** | `compiler.py` "PLC Asset Compiler" (folder→asset graph, provenance/confidence) on branch B. `mira-contextualizer/` (engine/contextualize/bundle `bundle@1`/profile `.miraprofile`/ccw/manuals/standards) · prod, 14 tests. | **migrate B + reuse contextualizer** | No pack-level compiler that fuses PLC IR + wiring + drive packs + live into one MachinePack |
| **C. Live Observer** | ONE-pipeline ingest: `mira-relay/ingest_contract.py` + `tag_ingest.py` + `tag_diff_logger.py` · prod. Machine Memory arc: `mira-crawler/run_engine/*` + migs 038/040 + Hub `machine-current-state.ts`/`command-center-freshness.ts` (pure, canonical) · prod, best-tested slice. `mira-relay/historian_postgres.py`. | **reuse as-is / extend** | `expected_envelope` (mig 025) consumed by nothing; no SSE/WS push; conveyor_events↔faults SQLite collision (P1); NorthwindBottling parity-test gap |
| **D. Diagnostic Engine** | Three "fault→causes→checks→confidence" shapes: `demo/factory_difference_engine/fault_dictionary.py`+`fault_bundle.py`+`fault_report.py` (built, tested); SimLab `simlab/diagnostic.py::assemble_evidence`/`grade`; `mira-mcp/factorylm_external_ai/conveyor_context.py` SDK (static). `drive_packs/cards.py::build_cards()`. Engine FSM `mira-bots/shared/engine.py` + SAFETY_ALERT. | **converge on fault_dictionary/bundle; reuse SimLab grader** | No engine that *composes* fault_dictionary + PLC interlock analysis + wiring_connections + live state + drive packs into one evidence chain |
| **E. Procedure Engine** | Nothing structured. `drive_packs` keypad_navigation (view-only steps) + `component_templates.troubleshooting_steps` JSONB + fault_bundle "check first" fields are the raw material. | **build (thin, over existing data)** | Structured procedure format with preconditions/safety/branches/stop-conditions |
| **F. Parts Intelligence** | `component_templates` (mig 016: power_specs/pinout/pm_checks/…) + `017 installed_component_instances` · prod. WO parts picker (#897). KG `SAME_MODEL_AS`/`HAS_DOCUMENT` inference. | **reuse component_templates** | Approved-replacement/compatibility edges as KG relationships w/ human gate |
| **G. Maintenance Memory** | migs 038 machine_run/run_diff + 040 windows · prod. Distillation flywheel 1–4b (`tools/relational_distill.py`, #2596 merged). `relationship_evidence` (technician_note). WO `resolution`/`fault_description`. | **reuse/extend** | No dedicated technician-notes/downtime/repair-record table (captured indirectly); WO-history miner is doctrine-only, unbuilt |
| **H. Work Management** | `work_orders` (migs 005-008 + 060 source_run_diff_id) + WO detail page (timer/parts/photo evidence #1929) + MachineMemoryCard "Create WO" deep-link (#2415) + `mira-cmms/` Atlas + `mira-mcp/cmms/*` adapters · prod. | **reuse as-is** | Shift handoff (docs only); maintenance-case (none); unify `tools/owui_tools/create_work_order.py` duplicate |
| **Safety** | `mira-bots/shared/guardrails.py` (SAFETY_KEYWORDS + _IMMEDIATE, 1080 lines) + engine SAFETY_ALERT short-circuit + UNS location gate + read-only doctrine `.claude/rules/` · prod. | **reuse, do not fork** | Nothing — mandate safety bullets already satisfied (see Part 4 mapping) |
| **Eval** | SimLab CI merge-gate `.github/workflows/ci.yml::simlab-gate` + `test_grader_gate.py` (scenarios A–F, blocks merge, offline) · prod. `deepeval_suite.py`, golden CSVs, drive-pack 5-layer grader, print-translator benchmark. | **extend SimLab, do not build new harness** | Mandate's 14-case benchmark not fully covered; GS10_FAULT_CODES not folded in |
| **Provenance/approval** | ADR-0017 state machine: `relationship_proposals`/`relationship_evidence` (mig 018) + `ai_suggestions` (027/062) + `kg_*.approval_state` (029) + `/api/proposals/[id]/decide` (only verified path). Centralized writers `kg_writer.py`/`proposal_writer.py`. | **the ONE system — never parallel it** | **No ADR maps pack `trust_status` ↔ `ai_suggestions.status` ↔ `component_templates.verification_status`** — write it first |
| **KB/KG/UNS** | `neon_recall.py` retrieval · prod. `uns.py` canonical grammar (3 intentional copies). `kg_writer.py` choke point. | **reuse as-is** | `full_ingest_pipeline.py` BROKEN (docling :5001 removed 2026-06-06); two ingest trees (mira-crawler vs mira-core/mira-ingest) |
| **Wiring** | `026_wiring_connections.sql` + `tools/wiring_map_import.py` (YAML→rows, CV-101) + `wiring_profile/*` Q&A (verified-only) + Telegram intake + `schematic_intelligence.py` extractor + `wiring_diagram/` generator · prod. | **reuse** | Issue #2605 (ai_suggestions/Hub wiring-review bridge); evidence-binding guard (skipped tests spec'd) |

## Duplicated / overlapping systems found + resolution

| Overlap | Resolution |
|---|---|
| **3 mira-plc-parser lineages** (main / branch B / branch C GUI) | Main = base; **migrate branch B** (compiler/correlate/depth/Siemens/OCR); recover branch C GUI from `origin/feat/plc-mapper-gui`, fold UX into contextualizer not a 2nd standalone .exe |
| **`mira-machine-logic-graph`** (Bun/TS) duplicates `parsers/structured_text.py` | **Retire** the TS service; absorb its ST-identifier ∩ variable-manifest Modbus-merge trick into branch B's `correlate.py` (Python IR is stated long-term architecture) |
| **3 diagnostic-hypothesis shapes** (SimLab / fault_dictionary+bundle / external_ai SDK) | **Converge on fault_dictionary/bundle** as the schema; SimLab stays the *oracle* (grader), external_ai SDK reads from canonical dictionary instead of hand-authoring |
| **Triplicated GS10 decode tables** (pack JSON canonical / `gs10-display.ts` / Ignition WebDev) | Pack JSON is single source of truth (`live_snapshot.py` already derives from it). Keep TS copy as *guarded* duplicate (drift-test like `test_drive_pack_hub_copy_sync.py`); do not converge Ignition now |
| **3 machine-memory bridges** (ask_api / ignition_chat / Hub machine-memory.ts) | Deliberate per-surface mirrors, parity-tested — **keep**, do not merge |
| **2 ingest trees** (`mira-crawler/ingest` vs `mira-core/mira-ingest`) | Consolidation review (not urgent); mira-crawler is canonical for KB |
| **2 answer brains** (Python engine strong-citation vs Hub `manual-rag.ts` BM25-only) | Known gap: Hub asset-chat doesn't call pack path. Wire Hub → pack path (top drive-pack gap) |
| **`owui_tools/create_work_order.py`** raw-urllib duplicate | Route through shared `mira-mcp/cmms` adapter |
| **3 uns.py copies / 2 proposal writers** | Intentional (CI-enforced import boundary / Hub-vs-ingest). **Leave.** |
| **conveyor_events vs faults** (same SQLite file, never joined) | **P1 fix** before conv_simple_anomaly leaves bench |
| **6 `worktree-drivepack-*` branches** | Superseded — retire/ignore |

---

# Part 2 — Architecture decisions

**AD-1 — Machine Pack = generalization of DrivePack, not a new schema.**
Add a `kind` discriminator (`"vfd" | "conveyor" | "motor_starter" | …`) to the existing `drive_packs/schema.py` dataclasses and rename the module concept to **Pack** (DrivePack becomes `kind:"vfd"`). *Reuses:* loader/resolver/cards/registry/extractor/grader/provenance verbatim. *Rejects:* a parallel `machine_packs/` tree. The VFD-specific `live_decode`/`envelope` become one variant of a generic `signal_decode` block; reconcile field names with `component_templates` power_specs/input_output_specs. **Relationship map:** `.miraprofile` (contextualizer) = the *portable authoring bundle* that a compiler emits; **MachinePack** = the *promoted, trust-graded, queryable* artifact; **component_templates** (mig 016) = the shared per-component-type store a pack *points into* (pointer-only, reuse-don't-rehold); **PLC IR `report@1`** = an *input* the compiler consumes, cited in provenance. A pack composes references to all four; it does not re-hold their contents.

**AD-2 — Provenance vocabulary unification via a new ADR-0026 (write FIRST, before any generalization code).**
Three vocabularies exist: pack `bench_verified`/`manual_cited`; PLC IR `HIGH/MEDIUM/LOW/REVIEW`; KG `proposed/reviewed/verified/rejected`; pack trust `rejected<internal_only<beta<trusted`. ADR-0026 (modeled on ADR-0017) defines the *canonical mapping table* — e.g. `bench_verified → verified`, `manual_cited → proposed(high-confidence)`, pack `trusted` requires human sign-off = KG `verified` = component_template `verified`. *Reuses:* ADR-0017 state machine + `ai_suggestions` as the ONE approval queue. *Rejects:* any new confidence/approval field.

**AD-3 — The deterministic diagnostic engine is a composer, not a new brain.**
A new pure module `mira-bots/shared/diagnostics/evidence_chain.py` assembles: `fault_dictionary.lookup_fault()` + branch-B PLC `_permissives`/`_timer_fault_chains`/`_sequences` output + `wiring_connections` (verified rows) + live state (`live_snapshot.assess_snapshots`) + drive-pack `build_cards()`. Output = mandate's chain (observed→live→PLC logic→permissive/interlock→wiring→drive→causes→checks) with supporting/conflicting/missing evidence + citations. **Deterministic first (rules/graph/state); LLM only renders the assembled chain** — reuse `engine.py`'s existing "explain, don't decide" seam. *Rejects:* the external_ai SDK's hand-authored static hypotheses (rewire to read canonical).

**AD-4 — SimLab is the oracle; the benchmark extends the merge-gate.**
The mandate's 14-case benchmark becomes new scenarios in `simlab/scenarios.py` graded by the existing `simlab/diagnostic.py::grade()` and gated by `simlab-gate`. *Rejects:* a standalone benchmark harness.

**AD-5 — Read-only by default, structurally enforced.**
Every new module follows the drive-pack pattern: pure, no I/O, never raises, never guesses (`addr:null` ≠ guess). Writes only to `ai_suggestions`/`relationship_proposals` (proposed). PLC/VFD writes remain out of scope entirely.

**AD-6 — The Machine Pack Compiler = branch-B PLC Asset Compiler + contextualizer, unified.**
`compiler.py` (branch B: exports→asset graph) feeds the contextualizer's `bundle.py`/`profile.py` authoring flow, which emits a `.miraprofile`; a new thin `pack_compiler` promotes a reviewed profile into a trust-graded MachinePack. *Rejects:* a third compiler. Must not silently merge contradictory evidence — preserve conflicts as `relationship_evidence` with negative `confidence_contribution`.

**AD-7 — Live evidence via `expected_envelope` + pack envelope, finally consumed.**
Wire `tag_entities.expected_envelope` (mig 025, currently read by nothing) into the run_engine anomaly eval, sourced from pack `envelope` bands. Closes the drive-pack open gap #7 and the live-state "expected_envelope unconsumed" debt in one move.

**AD-8 — Recover, don't rebuild, the Tag Mapper GUI.**
Recover from `origin/feat/plc-mapper-gui`, reconcile against `report@1`, fold into `mira-contextualizer` rather than shipping a second standalone .exe.

**AD-9 — Procedure Engine is a thin format over existing check-lists.**
Reuse `component_templates.troubleshooting_steps`, drive-pack `keypad_navigation`, and fault_bundle "check first" fields; add precondition/safety/branch/stop-condition/escalation wrappers. No LLM-generated steps (mandate + `mira-industrial-safety` skill).

**AD-10 — WO-history mining hangs off the flywheel, no new write path.**
Build the `work-order-history-miner` skill's taxonomy against `tools/relational_distill.py` + `proposal_writer` + `ai_suggestions` — same bridge, no parallel system.

**AD-11 — Fix ingest before compiling anything.** `full_ingest_pipeline.py` is BROKEN (docling :5001). Repoint to Tika/pdfplumber early; it blocks manual→pack candidate flow.

---

# Part 3 — Phased build plan

Each PR targets ≤~500 LOC. **[∥]** = parallelizable. Rebase the working tree on `origin/main` before Phase 0.

### Phase 0 — Recovery & unblock (parallel, low-risk)
*Goal: stop the bleeding; make the base solid before generalizing.*
- **PR-0.1 [∥]** docling→Tika fix. Modify `mira-crawler/tasks/full_ingest_pipeline.py`, `converter.py`, sweep siblings (mira-pipeline, scripts/*, tools/proveit). Default pdfplumber-only, Tika opt-in. *Test:* `test_converter_tables`, `test_ingest`. *Exit:* manual ingest runs without :5001.
- **PR-0.2 [∥]** conveyor_events↔faults SQLite collision (P1). Fix `plc/conv_simple_anomaly/engine.py` write target / join. *Test:* new join test. *Exit:* faults readable by `mira-mcp /api/faults/active` from same events.
- **PR-0.3 [∥]** NorthwindBottling parity test (one-line fix per inventory). *Exit:* vendored anomaly copy guarded.
- **PR-0.4 [∥]** GS10_FAULT_CODES fold-in: join `plc/conv_simple_anomaly/rules_core.py::GS10_FAULT_CODES` (50 real codes) into `demo/factory_difference_engine/fault_dictionary.py`. *Test:* extend `tests/simlab/test_fault_dictionary.py`. *Exit:* one fault-code source for GS10.

### Phase 1 — Discovery report + ADR
- **PR-1.1** Commit this synthesis as `docs/discovery/machine-pack-architecture-synthesis.md`.
- **PR-1.2** Write **ADR-0026** `docs/adr/0026-machine-pack-and-provenance-unification.md` (AD-1, AD-2 mapping table). *Exit:* Mike accepts.

### Phase 2 — Machine Pack schema (generalize DrivePack)
- **PR-2.1** Add `kind` discriminator + generic `signal_decode` block to `mira-bots/shared/drive_packs/schema.py`; DrivePack = `kind:"vfd"`. Additive, schema_version bump to 3 (v1/v2 still load). *Test:* extend `test_drive_packs.py`, `test_schema_v2`. *Exit:* GS10 pack loads unchanged under v3 loader.
- **PR-2.2** Author example **conveyor MachinePack** (`packs/conv_simple_cv101/pack.json`) referencing existing CV-101 artifacts (PLC IR, wiring YAML, GS10 drive pack, fault codes). *Fixture:* `tests/fixtures/machine_packs/cv101_pack.json`. *Exit:* loader validates it; trust_status=`beta` (no bench sign-off yet).

### Phase 3 — PLC Reader integration (MIGRATE branch B — highest leverage)
*Goal: land "what controls / what prevents" deterministically. Largest migration — sequence early.*
- **PR-3.1** Port `parsers/siemens_tia_xml.py` + `pdf_ocr.py` + their tests (self-contained, low conflict). *[∥ with 3.2]*
- **PR-3.2** Port `correlate.py` + `roles.py` + `discovery.py` (L5X+CSV+Modbus fusion) + tests. Absorb `mira-machine-logic-graph`'s ST∩manifest Modbus-merge trick here.
- **PR-3.3** Port `analyze.py` Phase 5 depth: `_permissives`/`_timer_fault_chains`/`_sequences`/`_is_equipment_output` + `test_analysis_depth`. **This answers "what prevents this motor from running."** *Exit:* on `conveyor.L5X` fixture, engine returns permissive chain graded REVIEW.
- **PR-3.4** Port `compiler.py` (PLC Asset Compiler) + `vqt_attach.py` + COMPILER.md/VQT_ATTACH_SPEC.md + tests. Merge the two eval sets (branch B's more mature). *Exit:* `compile_folder()` on CV-101 exports → asset graph with live values.
- **PR-3.5** Retire `mira-machine-logic-graph/` (delete service, migration note). *Exit:* no Bun/TS ST parser remains.

### Phase 4 — Machine Pack Compiler
- **PR-4.1** `mira-contextualizer` pack-emit: extend `profile.py`/`bundle.py` to emit a MachinePack draft from a reviewed `.miraprofile`. *Reuses:* contextualizer engine + branch-B compiler output.
- **PR-4.2** Trust promotion: reuse `tools/drive-pack-extract/grading/` 5-layer grader on MachinePacks (generalize domain_rules). *Test:* grader runs on cv101 pack. *Exit:* pack gets trust_status via existing pipeline, conflicts preserved (no silent merge).
- **PR-4.3 [∥]** Recover Tag Mapper GUI from `origin/feat/plc-mapper-gui`, reconcile to `report@1`, fold into contextualizer. *Decision gate for Mike:* standalone .exe vs contextualizer tab.

### Phase 5 — Live Machine Observer (mostly wiring existing)
- **PR-5.1** Wire `expected_envelope` (AD-7): consume mig-025 `tag_entities.expected_envelope` in `mira-crawler/run_engine/anomaly_rules.py`, sourced from pack `envelope`. *Test:* run_engine eval fires on out-of-envelope. *Exit:* envelope no longer dead.
- **PR-5.2 [∥]** Normalized observer read-model: thin service composing `machine-current-state.ts` + `command-center-freshness.ts` + interlock/permissive/sequence states (from Phase 3) → structured observation JSON. *Exit:* observer reports connectivity/alarms/sequence-step/permissive-states/freshness — observations, not diagnoses.
- **PR-5.3 [∥, deferrable]** SSE/WS live-tag push (the one genuine BUILD gap). Defer if Phase 8 proof works on poll.

### Phase 6 — Deterministic Diagnostic Engine
- **PR-6.1** `mira-bots/shared/diagnostics/evidence_chain.py` (AD-3): compose fault_dictionary + PLC interlock analysis + wiring verified rows + live observer + drive-pack cards into the mandate's chain. Pure, deterministic. *Test:* `tests/test_evidence_chain.py` per symptom class.
- **PR-6.2** Rewire `mira-mcp/factorylm_external_ai/conveyor_context.py` to read canonical fault_dictionary instead of static hypotheses (kills the 3rd shape). *Exit:* one hypothesis schema.
- **PR-6.3** LLM-explains seam: `engine.py` renders assembled chain only. *Exit:* no LLM-originated conclusions.

### Phase 7 — Procedure Engine + Maintenance Memory + Parts/Work (parallel)
- **PR-7.1 [∥]** Procedure format `mira-bots/shared/procedures/` over component_templates.troubleshooting_steps + keypad_navigation (AD-9). Safety notices from guardrails. *Test:* schema + LOTO-precondition fixture.
- **PR-7.2 [∥]** WO-history miner (AD-10) against `tools/relational_distill.py` + proposal_writer. Taxonomy from `work-order-history-miner` skill. *Test:* extend `test_relational_distill`.
- **PR-7.3 [∥]** Parts intelligence: approved-replacement/compatibility as KG proposals through `ai_suggestions` (never claim interchangeability without human approval). *Reuses:* component_templates + kg-infer-proposals.
- **PR-7.4 [∥]** Unify `owui_tools/create_work_order.py` → shared cmms adapter.
- **PR-7.5 [∥]** Issue #2605: route LLM-derived wiring rows through `ai_suggestions` + Hub approve path (adds wiring suggestion_type, Hub /api/proposals wiring query). Implement the evidence-binding guard (skipped tests in `docs/eval/print-translator-benchmark/regression_fixtures/`).

### Phase 8 — Eval + CV-101 end-to-end proof
- **PR-8.1** Add mandate's 14 benchmark cases to `simlab/scenarios.py`, graded by `simlab/diagnostic.py::grade()`, gated by `simlab-gate` (AD-4). *Exit:* merge-blocking on the 14 cases.
- **PR-8.2 — FINAL PROOF: "conveyor will not start" on CV-101.** End-to-end over the real Conv_Simple (Micro820 + GS10). Evidence chain the engine must emit:
  - Current live states ← `live_snapshot`/machine-current-state (CV-101 live pipeline)
  - Relevant PLC command ← branch-B `_is_equipment_output` on Prog2 IR
  - Blocking permissive/interlock ← branch-B `_permissives`/`_sequences`
  - Related wiring path ← `wiring_connections` verified rows (`plc/conv_simple_electrical/model/*.yaml`)
  - Drive-ready/fault state ← GS10 drive pack `build_cards()` + GS10_FAULT_CODES
  - Ranked probable causes + safe checks + citations (PLC rung / print sheet / manual / live) + missing evidence ← `evidence_chain.py`
  - Repair record storable after technician confirmation ← WO `source_run_diff_id` + `relationship_evidence(technician_note)`
  - *Exit:* single deterministic run produces the full cited chain; SimLab replay-identical; LLM only narrates.

**Parallelizable:** all of Phase 0; PR-3.1∥3.2; Phase 5 internally; all of Phase 7. Phases 2→3→4→6→8 are the critical path.

---

# Part 4 — Risks, open questions, what NOT to build

## Do NOT rebuild (mandate asks, already exists)
- **Pack schema** — generalize DrivePack, don't design fresh (~80% done).
- **Provenance/approval** — ADR-0017 + ai_suggestions + relationship_proposals is THE system. Never parallel it.
- **PLC parsing** — exists (main) + deep analysis (branch B, migrate). Don't re-parse.
- **Wiring reader/writer/Q&A/generator** — production-complete except #2605.
- **Fault dictionary/bundle/report** — A/B/C built; converge, don't rebuild.
- **Live ingest + Machine Memory + freshness** — canonical, best-tested slice.
- **Benchmark harness** — extend SimLab grader gate.
- **Guardrails/safety** — reuse guardrails.py + SAFETY_ALERT + UNS gate verbatim.
- **WO/CMMS** — mig 060 + MachineMemoryCard + Atlas adapters production.
- **Retrieval (neon_recall), UNS grammar** — reuse as-is.

## Explicitly defer
- SSE/WS live-tag push (PR-5.3) — nice-to-have; proof works on poll.
- Siemens G120 pack — separate backlog (issue #2577); Machine Pack generalization must not wait on it.
- Two-ingest-tree consolidation (mira-crawler vs mira-core) — review, not urgent.
- Dedicated technician-notes/downtime/shift-handoff tables — captured indirectly today; build only if the proof exposes a real gap.
- VFD Analyzer auto-map / Ignition Exchange resource — adjacent, possibly superseded by Drive Commander; reconcile before it collides with expected_envelope.
- Hub asset-chat → pack path wiring — real gap but not on the proof's critical path.

## Safety requirement → existing mechanism mapping
| Mandate safety bullet | Satisfied by |
|---|---|
| Read-only by default | Drive-pack purity doctrine + `.claude/rules/`; new modules follow it |
| No PLC/VFD writes | Out of scope; `_readonly` no-write-FC test gate; external-ai Defer list |
| Human approval for consequential actions | `/api/proposals/[id]/decide` + ai_suggestions (only verified path) |
| LOTO awareness / electrical warnings | `guardrails.py` SAFETY_KEYWORDS_IMMEDIATE + `mira-industrial-safety` skill; keypad_navigation view_only_warning |
| Confidence thresholds / insufficient-evidence | resolver honest-refusal; fault_bundle missing_evidence; wiring_profile verified-only refusal |
| Audit logs | `decision_traces` (migs 032/055) + kg_triples_log |
| Source citations | provenance.sources + relationship_evidence + report@1 locators |
| Data freshness | `command-center-freshness.ts` (canonical) |
| Observation vs recommendation | Live Observer emits observations; diagnostic engine separates evidence from checks |

## Questions only Mike can answer
1. **Tag Mapper GUI (PR-4.3):** recover as standalone .exe, or fold into mira-contextualizer? (Inventory recommends contextualizer; needs your call.)
2. **CV-101 bench access for the final proof:** is the Micro820+GS10 bench live and reachable for PR-8.2, or should the proof run against SimLab's CV-200 alias first, then bench? (Determines whether Phase 8 needs hardware time.)
3. **ADR-0026 trust mapping (AD-2):** confirm `bench_verified→verified` and that pack `trusted` requires the same human sign-off as KG `verified` — this locks the provenance vocabulary for everything downstream.

**Biggest risk:** the branch-B migration (Phase 3) is the linchpin and the largest merge surface (~5 PRs, unmerged since Phase 2 diverged). If it stalls, the whole "what prevents this motor" capability — and the final proof — stalls. Sequence it early, keep each port ≤500 LOC, and land the eval-set merge with it so parity is provable.

---

**Load-bearing files:** `mira-bots/shared/drive_packs/schema.py`, `feat/vfd-analyzer-auto-map:mira-plc-parser/mira_plc_parser/{analyze,compiler,correlate,vqt_attach}.py`, `origin/feat/plc-mapper-gui:mira-plc-parser/gui/`, `docs/adr/0017-*`/`0025-*` (+ proposed 0026), `mira-relay/ingest_contract.py`, `mira-crawler/run_engine/`, `mira-hub/db/migrations/{016,025,026,038,040,060}`, `demo/factory_difference_engine/fault_dictionary.py`, `plc/conv_simple_anomaly/rules_core.py`, `plc/conv_simple_electrical/model/*.yaml`, `simlab/diagnostic.py`, `mira-crawler/tasks/full_ingest_pipeline.py`.
