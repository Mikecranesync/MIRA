# PLAN — Repository Archaeology Catalog

**Branch:** `docs/repo-archaeology-catalog` · **Worktree:** `.claude/worktrees/repo-archaeology` · **Base:** origin/main `cde2c418`
**Goal source:** `~/Downloads/Repository Archaeology Plan.docx` · **Run:** autonomous, 2026-07-14
**(Replaces the stale `feat/path-to-beta` PLAN.md that shipped on origin/main — that content lives in git history + on `feat/path-to-beta`.)**

## Contract

Durable, evidence-backed, machine-readable catalog of every FactoryLM/MIRA repo + its important
systems. Every `confirmed` fact carries repository/file/line/commit/detection-method/last_verified.
**No production changes. No merges. Read-only archaeology.** Reuse existing arch docs
(`docs/ARCHITECTURE.md`, `CONTEXT-MAP.md`, `docs/THEORY_OF_OPERATIONS.md`) — don't restart done work.
Distinguish confirmed / strong-inference / unknown. Never invent relationships from filenames alone.

## Reality (Phase-1 orientation, confirmed via `gh repo list Mikecranesync` + local git)

Org has ~62 repos; the **active, non-archived** set is small:
- **MIRA** — primary monorepo (this worktree). ~90% of the live surface. `mira-*` modules + plc/ + simlab/ + ignition/.
- **factorylm** — separate Digital-Twin monorepo (`~/factorylm`).
- **MIRA_PLC** (private) — PLC firmware + Ignition project + PDF generator.
- **factorylm-promo-video-generator**, **ladder-logic-editor** — supporting tools.
- **FactoryLM_v2.0** (private) — likely superseded.
Everything pushed `2026-03-03` = the "great archive" (merged-into-monolith cluster + frozen Jarvis/PAI/openclaw/Ralph).

## Scope (IN)

1. **Catalog scaffold** under `catalog/` — README + machine-readable YAML/JSON + evidence/ + mermaid.
2. **Phase 1 — Org discovery.** `organization.yaml` (all 62 repos, classified) + `repositories/<repo>.yaml` for the ~6 active repos (branch, langs, activity, purpose, CI, deploy, relationships).
3. **Phase 2 — Repo archaeology (ACTIVE).** MIRA per-module deep dive; factorylm + MIRA_PLC key-systems; tools lighter. Populate `services.yaml`, `apis.yaml`, `databases.yaml`, `schemas.yaml`, `workers-and-crons.yaml`, `integrations.yaml`, `deployments.yaml`, `environment-variables.yaml`, `feature-flags.yaml` — each fact evidence-backed.
4. **Phase 3 — Cross-repo architecture.** `relationships.json` + `architecture.mmd` + `data-flows.mmd`. Trace upload→ingest→retrieval, Ask MIRA, KB+KG, telemetry ingest, PLC/Ignition/Slack/Telegram/kiosk surfaces, deterministic-vs-LLM, approval gates, staging/prod. `gaps-and-risks.md` = duplication/dead-code/rebuilt-elsewhere/coupling.
5. **Phase 4 — Dependency & security.** `dependencies/` per active repo; SBOM (syft if present) / vuln (osv-scanner if present) / secrets-risk (no values) / base images / exposed services. Scanner output = evidence needing interpretation.
6. **Phase 5 — Durable assembly + evidence.** Fact objects with full provenance; `catalog/evidence/` raw findings; `unknowns.md`.
7. **Phase 6 — Refresh tooling.** `catalog/refresh.sh` + `.claude/commands/catalog-org.md` skill + `catalog/validate.py` (files exist, required fields present, mermaid compiles, dup ids rejected, confirmed⇒evidence, deleted-surfaced). Optional CI stub documented (not merged).

## Out of scope (OUT)

- Any code change to production modules / migrations / deploys / VPS / prod DB. **Read-only.**
- Merging this branch (operator merges after HANDOFF).
- Deep archaeology of **archived** repos — Phase-1 classification only.
- Modifying any file outside `catalog/`, `PLAN.md`, `HANDOFF.md`, `.planning/STATE.md`, `.claude/commands/catalog-org.md`.
- Fixing any bug/risk found — record in `gaps-and-risks.md`, do not fix.
- Running scanners that mutate state or hit external prod services / prod NeonDB / `@FactoryLM_Diagnose`.

## Success criteria

- P1: `organization.yaml` = all 62 repos classified (confirmed from gh); active set has `repositories/<repo>.yaml`.
- P2: every MIRA module has a component record with entry point + evidence; the 9 YAML inventories populated with file:line evidence.
- P3: `relationships.json` + 2 mermaid diagrams compile; `gaps-and-risks.md` evidence-backed.
- P4: `dependencies/` per active repo; SBOM/vuln/secrets present or explicitly "tool unavailable".
- P5: all `confirmed` facts have `file` + `detection_method`; `unknowns.md` separates inference from fact.
- P6: `python catalog/validate.py` exits 0; `/catalog-org` refresh entry point exists.

## Verify steps

- `python catalog/validate.py` exits 0 · `yq` parses every `catalog/*.yaml` · `jq` parses `relationships.json`.
- mermaid blocks compile (mmdc if available, else the validator's syntax check).
- Every `confidence: confirmed` fact has non-empty `file` + `detection_method`.
- **Spot-verify ≥10 sampled facts against real `file:line` before each commit** — guard against subagent-fabricated symbols (global CLAUDE.md law).

## Cadence & stop conditions

Commit each phase (durable checkpoint). Update `.planning/STATE.md` after each phase.
STOP + write HANDOFF.md on: turn > 200, budget > 70%, OUT-of-scope touch, architecture/security decision needed, all phases complete.
