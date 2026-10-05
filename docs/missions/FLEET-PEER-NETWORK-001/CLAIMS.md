# Application-team claims at the time of Slice A (2026-09-07, documented, not modified)

| Record | Owner | Branch / state | Keys |
|---|---|---|---|
| #3626 FACTORYLM-UNIFIED-UI-CUTOVER-001 | Codex on Charlie (+Claude bounded writer) | `codex/factorylm-unified-ui-cutover-001`, PR #3647 draft | `root:CLAUDE.md`, `root:AGENTS.md`, `docs/architecture/convergence`, `.claude/rules`, `.claude/workflows`, `.github/workflows/ui-lifecycle-guard.yml`, `tools/ui_surface_lifecycle_guard.py`, `wiki/hot.md` |
| #3649 FLM-UI-4000 Slice C | mira-97 (Charlie) | `feat/flm-ui-slice-c-nav-hierarchy`, PR #3651 draft, frozen at `bdd95ec927…` | `packages/factorylm-ui`, `apps/factorylm-ui-lab` |
| #3650 FLM-UI-4000 Slice D | mira-97 (Charlie) | `feat/flm-ui-slice-d-density-color`, PR #3652 draft (stacked on C) | `packages/factorylm-theme`, `packages/factorylm-ui`, `apps/factorylm-ui-lab`, `docs/design/factorylm-tokens.css` |
| #3644 mobile failed-turn retry | mira-97 | `feat/flm-ui-slice-b-mobile-host`, PR draft, **parked** for Mike (legacy-path governance) | `mira-mobile` |
| #3648 FLEET-PEER-NETWORK-001 Slice A | mira-97 | `feat/fleet-peer-network-001a-contract` | `docs/peer-network`, `docs/missions`, `deployment/network.yml`, `tests/peer_network`, `.github/workflows/ci.yml` (widened 2026-09-07: contract job), `tools/peer_network` (widened 2026-09-07: executable race/key semantics — Codex packet) |

Open `.fleet/` writers (why the deprecation is a notice, not a move): #3558, #3554, #3552, #3551,
#3550, #3549, #3533.
