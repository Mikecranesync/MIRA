# Gaps & Risks

Evidence-backed findings from the archaeology run. **Findings are recorded, not fixed** (this is a
read-only catalog). Each carries confidence + evidence. Phase 3/4 append to this file.

## Documentation drift

- **G1 — CLAUDE.md repo map understates the module surface.** 23 `mira-*` module dirs exist; 9 are
  absent from the Repo Map (`mira-connectors`, `mira-contextualizer`, `mira-fault-detective`,
  `mira-fault-sim`, `mira-ignition-exchange`, `mira-machine-logic-graph`, `mira-plc-parser`,
  `mira-scan-monday`, `mira-trend-viewer`). *confirmed* — `ls` vs `CLAUDE.md` §Repo Map, commit cde2c418.
  Risk: onboarding/agents route around real modules; some may be dead/experimental (Phase 2 resolves each).
- **G2 — `mira-ops` is in the repo map but not present at top level** at commit cde2c418. *confirmed* —
  `ls`. Either relocated, renamed, or removed. Phase 2 verifies (possible stale doc entry).

## Cross-repo ambiguity

- **G3 — MIRA vs factorylm relationship is unverified.** Two separate "FactoryLM" monorepos with
  overlapping concepts (both have cmms, diagnosis, ignition, agents). Whether factorylm is superseded,
  a shared-lib source, or a parallel product line is *unknown* (manual-reasoning). Risk: duplicated
  implementations / components being rebuilt across repos (the plan explicitly asks to surface this).
  Needs a code-level comparison pass.

## Not-cloned / blind spots

- **G4 — MIRA_PLC internals uncatalogued.** Private, not cloned locally; only gh metadata captured.
  12 open PRs suggest active work invisible to this catalog. Follow-up: clone + deep pass (unknowns.md).
- **G5 — factorylm local checkout is 10 behind origin/main.** Facts anchored to local commit 2129452
  may lag origin. Re-anchor on a fresh clone/pull before trusting factorylm internals.

## Superseded / archived surface

- **G6 — 72 archived repos, several "merged into monolith".** The merge relationships come from gh
  *descriptions* only (`factorylm-core`, `factorylm-mini`, `pi-gateway`, `mikes-brain`,
  `factorylm-plc-client` say "ARCHIVED - Merged into factorylm monolith"). *strong-inference* — not
  code-verified that their code actually lives in factorylm today. Low priority (archived), but the
  claim should not be stated as fact without a code check.

## Phase 2 findings (per-module deep dive)

- **G1 — RESOLVED.** All 9 previously-undocumented `mira-*` modules identified (README/pyproject-grounded, see `services.yaml`): `mira-connectors` (connector framework), `mira-contextualizer` (offline desktop factory-contextualizer), `mira-fault-detective` (7-rule diagnostic engine), `mira-fault-sim` (sensor/vision/fuse simulator), `mira-ignition-exchange` (Perspective Exchange resources), `mira-machine-logic-graph` (CCW ST→Ignition tags service), `mira-plc-parser` (vendor-agnostic PLC-export analyzer), `mira-scan-monday` (monday.com marketplace app), `mira-trend-viewer` (ISA-101 trend viewer). **Residual risk:** CLAUDE.md's repo map is still stale — update it to add these 9 + drop `mira-ops`.
- **G2 — CONFIRMED.** `mira-ops` does not exist (absent top-level + nested). The repo map entry is stale; observability is `docker-compose.observability.yml`. *confirmed* — `ls`/`fd`.
- **G7 — No feature-flag registry.** ~40+ flags (`ENFORCE_*`, `MIRA_*_ENABLED`, `QUALITY_GATE_ENABLED`) are read ad-hoc via `os.getenv` scattered across modules; no single registry. *strong-inference* — `rg`. Risk: flags hard to audit; drift between docs and behavior (one already caught — `MIRA_UNS_GATE_ENABLED` was not at its documented location).
- **G8 — Duplicate diagnostic-engine branding.** `mira-fault-sim`'s pyproject description is a copy-paste of `mira-fault-detective`'s ("MIRA Conveyor Fault Detective — …"). *confirmed* — cosmetic, but signals copy-paste module scaffolding. Two paired bench modules (detective + sim).
- **G9 — `cmms_equipment` schema lives in test fixtures, not migrations.** Created in `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql:62`, not the numbered migrations dir. *confirmed* — `rg`. Risk: prod `cmms_equipment` shape is not governed by the migration ledger; drift is invisible to `migration-drift-check`.
- **G10 — kg_entities/kg_relationships defined in TWO lineages.** Hub `001_knowledge_graph.sql` (live source) AND engine `docs/migrations/004/005`. *confirmed* — `rg`. Known/managed (ADR-0013) but a real duplication a newcomer will trip on.
- **G11 — ChromaDB is a live dependency via legacy `mira-sidecar`.** Still imported (`mira-sidecar/rag/store.py`), sunset "pending OEM migration" for months. *confirmed*. Undocumented production dependency risk if any path still routes to it.

## Phase 4 findings (dependencies / security)

- **G12 — unpinned prod base image.** `nangohq/nango-server:hosted` (floating `:hosted` tag) in the
  prod/saas compose violates the CLAUDE.md "pinned image versions" rule. *confirmed* — `rg`. Non-reproducible
  build + supply-chain risk. (All other prod base images are pinned; MIRA's own services build from local Dockerfiles.)
- **G13 — no vulnerability/SBOM evidence.** `syft`/`osv-scanner`/`semgrep`/`trivy`/`grype` are not installed on
  CHARLIE, so no CVE or SBOM scan was run. *confirmed* — `command -v`. Dependency inventory is manifest-based only
  (11 pyproject + 21 requirements + 9 package.json). Follow-up: install a scanner and run a real pass (U7).

## Cross-repo (Phase 3)

- **G3 — still open.** MIRA↔factorylm overlap not code-verified (would need a shared-symbol/dir diff across the two checkouts). Both carry `cmms`, `diagnosis`, `ignition`, `agents` concept dirs. See `unknowns.md` U3.

