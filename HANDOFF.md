# HANDOFF — Repository Archaeology Catalog

**Branch:** `docs/repo-archaeology-catalog` · **Worktree:** `.claude/worktrees/repo-archaeology` · **Base:** origin/main `cde2c418`
**Run:** autonomous, 2026-07-14 · **Commits:** `bcfaa9d8` (scaffold + Phase 1), `cf3f3f32` (Phase 2–4)
**Status:** all 6 plan phases delivered; `python catalog/validate.py` exits 0 (74 facts, every confirmed anchor verified to exist).

## What was built (vs PLAN scope)

| PLAN item | Status | Where |
|---|---|---|
| 1. Catalog scaffold + validator + refresh tooling | ✅ | `catalog/{README.md,validate.py,build_organization.py,refresh.sh,schema/fact.schema.json}`, `.claude/commands/catalog-org.md` |
| 2. Phase 1 — org discovery (98 repos classified) | ✅ | `catalog/organization.yaml` (generated), `catalog/repositories/*.yaml` (6 active repos) |
| 3. Phase 2 — MIRA per-module archaeology | ✅ | `catalog/{services,apis,databases,schemas,workers-and-crons,integrations,deployments,environment-variables,feature-flags}.yaml` |
| 4. Phase 3 — cross-repo architecture | ✅ (lean) | `catalog/{relationships.json,architecture.mmd,data-flows.mmd,gaps-and-risks.md}` |
| 5. Phase 4 — dependency/security | ✅ (manifest-only) | `catalog/dependencies/README.md` |
| 6. Phase 5 — durable assembly + evidence | ✅ | evidence-backed facts throughout; raw findings in `catalog/evidence/`; `catalog/unknowns.md` |
| 7. Phase 6 — refresh tooling + validation | ✅ | `validate.py` + `refresh.sh` + `/catalog-org` skill (CI stub documented, not installed) |

## Headline findings (see `catalog/gaps-and-risks.md`)

- **Doc drift:** CLAUDE.md's repo map lists ~13 modules; the tree has **21** `mira-*` dirs. 9 were undocumented — all now resolved. `mira-ops` in the map **does not exist**.
- **G3 (open):** MIRA ↔ factorylm relationship not code-verified (two "FactoryLM" monorepos, overlapping concept dirs). Needs a shared-symbol diff.
- **G9/G10:** `cmms_equipment` schema lives in test fixtures (not migrations); `kg_entities` defined in two migration lineages.
- **G12:** prod compose pulls `nangohq/nango-server:hosted` (unpinned) — violates the pinned-image rule.
- **G11:** ChromaDB still a live dep via legacy `mira-sidecar`.

## Owed / skipped (needs follow-up)

1. **SBOM/CVE scan not run** — `syft`/`osv-scanner`/`semgrep`/`trivy`/`grype` not installed on CHARLIE. Install one + run a real pass (unknowns U7, gaps G13).
2. **MIRA_PLC internals uncatalogued** — private, not cloned. Clone + deep pass to catalog its firmware/Ignition/PDF-gen internals (U4).
3. **factorylm deep archaeology** — cataloged at top-level-dir granularity only; local checkout was 10 behind origin. Re-anchor on a fresh pull, then deep-dive (U3, G3).
4. **Archived repos** — 72 classified only (Phase-1). "Merged into monolith" claims are gh-description-derived (`strong-inference`), not code-verified.

## Decisions for the operator

- **`/VERSION` bump:** this branch adds `.py`/`.sh` (not markdown-only), so `version-gate.yml` will likely require a `/VERSION` bump on the PR. I left `/VERSION` untouched (out of scope for a read-only archaeology run). **Decide at merge:** bump it, or add `catalog/**` + `*.md` tooling to the version-gate docs-exempt paths.
- **Merge is yours** — I did not merge (per plan). No production changes were made; the catalog is purely additive under `catalog/`.
- Consider fixing the doc drift (update CLAUDE.md repo map: +9 modules, −mira-ops) as a quick follow-up PR.

## Reproduce / refresh

```bash
cd .claude/worktrees/repo-archaeology
python catalog/validate.py        # exits 0 — 74 facts, evidence-checked
bash   catalog/refresh.sh          # re-discover org + regenerate organization.yaml + validate
# deep-inventory refresh: re-run the scout dispatch in .claude/commands/catalog-org.md, spot-verify, commit
```

## Evidence preserved

`catalog/evidence/gh-repo-list.json` (98 repos), `mira-structure.txt`, `factorylm-structure.txt`.
Every `confidence: confirmed` fact carries a real `file` anchor that `validate.py` checks exists.
