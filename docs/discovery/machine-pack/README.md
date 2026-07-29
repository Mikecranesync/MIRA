# Machine Pack — Discovery Synthesis Index

**Date of discovery:** 2026-07-10
**Status:** Discovery complete. Plan accepted with decision overrides (below). ADR-0026 drafted separately (PR-1.2). **No runtime code has been changed** — this directory is documentation only.
**Method:** 8 parallel discovery agents swept the active repository, unmerged branches, and sibling working copies; a lead-architect synthesis produced the plan.

## Mandate

Build the next industrial-maintenance capability layer (Machine Pack + PLC reader + compiler + live observer + deterministic diagnostic engine + procedure engine + parts/maintenance/work management) around the existing Drive Commander, Print Reader, PLC parser, KB, UNS, live tag services, and agent infrastructure. Source: *FactoryLM-MIRA Architecture* mandate (2026-07-10).

**Headline finding:** the codebase is ~70–80% of the mandate already. The plan is *generalize, migrate, and wire what exists* — not invent.

## Contents

| File | What it is |
|---|---|
| [machine-pack-architecture-plan.md](machine-pack-architecture-plan.md) | The synthesis: per-capability status, duplicate-system resolutions, 11 architecture decisions (AD-1…AD-11), phased PR plan (Phase 0–8), risks & non-goals |
| [inventories/01-plc-parsing.md](inventories/01-plc-parsing.md) | PLC program parsing — 3 diverged `mira-plc-parser` lineages; deep cause/effect analysis unmerged on `feat/vfd-analyzer-auto-map`; Tag Mapper GUI lost in merge PR #2141 (recoverable) |
| [inventories/02-print-wiring.md](inventories/02-print-wiring.md) | Wiring/electrical-print OCR — Print Translator + wiring lane production-complete except issue #2605 and the evidence-binding guard |
| [inventories/03-drive-packs.md](inventories/03-drive-packs.md) | Drive packs / Drive Commander — schema, trust doctrine, extractor/grader, surfaces, gaps |
| [inventories/04-kb-kg-uns.md](inventories/04-kb-kg-uns.md) | Manuals/KB, knowledge graph (ADR-0017), UNS — incl. the broken docling ingest default |
| [inventories/05-live-machine-state.md](inventories/05-live-machine-state.md) | ONE-pipeline ingest, Machine Memory arc, Ignition collector, historian, `expected_envelope` gap |
| [inventories/06-wo-cmms-maintenance-memory.md](inventories/06-wo-cmms-maintenance-memory.md) | Work orders, CMMS adapters, distillation flywheel, technician-confirmation mechanisms |
| [inventories/07-diagnostics-safety-eval.md](inventories/07-diagnostics-safety-eval.md) | Engine FSM, guardrails, fault dictionary/bundle/report, SimLab oracle + CI gate, eval harnesses |
| [inventories/08-pack-formats-apis.md](inventories/08-pack-formats-apis.md) | Pack-like artifact formats, versioning/migration systems, MCP/API surfaces for thin clients |

## Repositories & locations inspected

- **`Mikecranesync/MIRA`** monorepo at `origin/main` `d3109c2a` (VERSION 3.128.5) — primary; includes `mira-bots`, `mira-hub`, `mira-crawler`, `mira-relay`, `mira-mcp`, `mira-plc-parser`, `mira-contextualizer`, `mira-connect(ors)`, `simlab`, `plc/`, `ignition/`, `demo/`, `tools/`.
- **Unmerged branches:** `feat/vfd-analyzer-auto-map` (PLC compiler/correlate/analysis-depth/Siemens/OCR), `feat/plc-mapper-gui` (Tag Mapper GUI — lost in merge `6b11ed87`, PR #2141), `feat/hub-live-signal-polish`, local `worktree-drivepack-*` snapshots (superseded).
- **Sibling working copies** under `Documents/GitHub/`: `mira-uns` (stale 2026-06-16 snapshot — ignore), `mira-gui`, `mira-why` (plain file copies, not repos), `mira-events`, `mira-flightsim`, `mira-cappy-factory` (no domain overlap found).

## Decisions locked 2026-07-10 (override the plan where noted)

1. **Tag Mapper GUI home: FactoryLM Hub** — *overrides plan AD-8/PR-4.3* (which recommended mira-contextualizer). Rationale: the Hub owns machine onboarding, UNS construction, evidence review, tag mapping, and human approval. Ignition, Telegram, and other thin clients consume approved mappings; they are not the system of record. The recovered GUI code from `origin/feat/plc-mapper-gui` becomes reference/donor material for a Hub surface, not a standalone .exe and not a contextualizer tab.
2. **CV-101 proof: bench-first** — the primary proof (plan PR-8.2) runs against the physical CV-101 conveyor (Micro820 PLC, GS10 drive, live tags, real documentation). SimLab reproduces the scenario as a deterministic CI regression fixture (PR-8.1) but **must not substitute** for the live proof.
3. **ADR-0026 trust mapping: approved in principle** with required boundaries — immutable raw/extracted evidence; observed/extracted/inferred/technician-confirmed/approved kept distinct; no silent promotion of agent inference; conflicts preserved and surfaced; approvals record reviewer/time/evidence/artifact-version; unapproved data usable at runtime only when labeled, never authoritative; consequential guidance requires approved mappings or explicit insufficient-evidence behavior; full provenance to source document / PLC location / live tag / technician record. See `docs/adr/0026-machine-pack-and-provenance-unification.md` (PR-1.2).

## Post-review corrections (2026-07-10, from independent verification agents)

- **`demo/factory_difference_engine/` is NOT on `origin/main`.** The fault-intelligence trio (`fault_dictionary.py`, `fault_bundle.py`, `fault_report.py`) and the difference-engine pipeline live on the unmerged branch `origin/feat/proveit-difference-engine-demo` (commits `9de9dc3a`/`81cf90d3`/`7b109bdd`). Inventory 07 describes them as built+tested, which is true — *on that branch*. Consequence for the plan: Phase 0 PR-0.4 (GS10_FAULT_CODES fold-in) and Phase 6 (evidence chain) acquire a prerequisite: **merge or port `feat/proveit-difference-engine-demo` first** — treat it like the branch-B migration, another recovered-work item, not a rebuild.
- `docs/discovery/drive_commander_convergence_audit_2026-07-07.md` was an uncommitted local artifact; it is committed alongside this index so its references resolve.
- The drive-pack field doc path is `mira-bots/shared/drive_packs/packs/README.md` (inventories sometimes shorthand it as `packs/README.md`).

## Status labels used across the inventories

- **production** — on `origin/main`, tested, in active use. Reuse.
- **experimental** — built and tested but unmerged, flag-gated, or demo-grade.
- **archived** — commissioning history / superseded snapshots kept for audit (e.g. versioned ST programs under `plc/`, `worktree-drivepack-*` branches).
- **duplicate** — overlapping implementations; each has an explicit resolution in the plan's "Duplicated / overlapping systems" table.
- **reusable** — verdicts `reuse` / `extend` / `migrate` in the inventory tables.
- **retirement candidates** — `mira-machine-logic-graph/` (Bun/TS ST parser duplicating `mira-plc-parser/parsers/structured_text.py`), the 6 `worktree-drivepack-*` branches, the external-AI SDK's hand-authored static diagnostics (rewire to canonical fault dictionary), `tools/owui_tools/create_work_order.py` raw-urllib path (unify into the shared CMMS adapter).

## Key existing ADRs and doctrine this work builds on

- [ADR-0017 — proposal state machine mapping](../../adr/0017-proposal-state-machine-mapping.md) — the ONE approval system (`relationship_proposals` / `ai_suggestions` / `kg_*.approval_state`); never parallel it.
- [ADR-0025 — drive intelligence packs and Drive Commander](../../adr/0025-drive-intelligence-packs-and-drive-commander.md) — the pack concept the Machine Pack generalizes.
- ADR-0026 (drafted in PR-1.2) — Machine Pack + provenance/trust unification.
- `docs/drive-commander/drive-pack-trust-doctrine.md` — CANDIDATE-vs-trusted acceptance flow, extended verbatim to Machine Packs.
- `docs/discovery/drive_commander_convergence_audit_2026-07-07.md` — prior 5-agent archaeology this synthesis extends.
- `docs/discovery/duplicate-systems-audit.md` (2026-07-03) — prior file:line-cited audit of the live-state domain.
- `.claude/rules/one-pipeline-ingest.md`, `.claude/rules/fieldbus-readonly.md` — ingest and read-only doctrine.

## Load-bearing source files (verified during discovery)

`mira-bots/shared/drive_packs/schema.py` · `mira-plc-parser/mira_plc_parser/{ir,analyze,uns,i3x}.py` · `feat/vfd-analyzer-auto-map:mira-plc-parser/mira_plc_parser/{compiler,correlate,vqt_attach}.py` · `origin/feat/plc-mapper-gui:mira-plc-parser/gui/` · `mira-relay/ingest_contract.py` · `mira-crawler/run_engine/` · `mira-crawler/ingest/{kg_writer,proposal_writer,uns}.py` · `mira-hub/db/migrations/{016,018,025,026,027,038,040,060}_*.sql` · `demo/factory_difference_engine/{fault_dictionary,fault_bundle,fault_report}.py` · `plc/conv_simple_anomaly/rules_core.py` · `plc/conv_simple_electrical/model/` · `simlab/diagnostic.py` · `mira-bots/shared/guardrails.py` · `tools/drive-pack-extract/` · `mira-contextualizer/mira_contextualizer/{profile,bundle}.py`
