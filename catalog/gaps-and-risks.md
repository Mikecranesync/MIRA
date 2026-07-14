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

<!-- Phase 2/3 findings (duplication, dead code, hidden coupling, missing tests, risky cross-tenant) append below -->
