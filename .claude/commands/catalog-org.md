# /catalog-org — refresh the repository archaeology catalog

Refreshes `catalog/` (built by the 2026-07-14 Repository Archaeology run). Read-only over the
codebase; the only writes are to `catalog/`.

## What it does

1. **Discover repository changes** — re-run `gh repo list Mikecranesync` into
   `catalog/evidence/gh-repo-list.json`; diff against the committed copy to spot new/removed/renamed repos.
2. **Refresh deterministic inventory** — `python catalog/build_organization.py` regenerates
   `organization.yaml`. New non-archived repos surface as `active-supporting` (heuristic) for triage.
3. **Identify stale catalog entries** — `python catalog/validate.py` errors on any `confirmed` fact
   whose referenced file no longer exists in a resolvable repo (MIRA, factorylm) → a deleted/renamed
   component is surfaced for review, never silently dropped.
4. **Update evidence** — re-capture `catalog/evidence/mira-structure.txt` (module dirs, workflow count,
   compose files, VERSION) and `factorylm-structure.txt`.
5. **Regenerate diagrams** — hand-review `architecture.mmd` / `data-flows.mmd` against the refreshed
   inventory; the validator compile-checks them (mmdc if installed, else syntax sanity).
6. **Report meaningful changes** — summarize repo adds/removes, module adds/removes, and any newly
   failing facts. Avoid rewriting unchanged files (generator output is stable for stable input).
7. **Fail on unsupported claims** — `validate.py` exit≠0 blocks the refresh: a `confirmed` fact with no
   `file`/code-level `detection_method`, a missing referenced file, a duplicate id, or a non-compiling
   mermaid diagram all fail.

## Run

```bash
bash catalog/refresh.sh        # steps 1-3 automated
python catalog/validate.py     # gate (must exit 0)
```

## Refresh the deep (Phase 2/3) inventories

The `services/apis/databases/schemas/workers-and-crons/integrations/relationships` inventories are
evidence-heavy and are NOT auto-regenerated (they need the sole-writer + spot-verify discipline that
guards against fabricated symbols). To refresh them:

1. Dispatch **read-only Haiku scouts** (Agent tool), one per inventory dimension, each returning **raw
   evidence** (`rg`/`fd`/file:line output), never prose claims.
2. As the **sole writer**, spot-verify ≥10 sampled facts against real `file:line` before writing any
   `confidence: confirmed` entry.
3. Use **Sonnet** only for the Phase-3 cross-repo synthesis (`relationships.json`, gaps).
4. `python catalog/validate.py` before committing.

## Guardrails

- Read-only over the codebase. No production changes, no merges. Work on a branch/worktree.
- New `confirmed` facts require a `file` + a code-level `detection_method`. Documentation-derived
  claims are `strong-inference`. Never assert a code relationship from a filename or doc alone.

## CI (optional, documented — not auto-installed)

A `.github/workflows/catalog-validate.yml` could run `python catalog/validate.py` on any PR touching
`catalog/**` to enforce: referenced files exist, required fields present, mermaid compiles, duplicate
ids rejected, confirmed facts carry evidence. Left as a documented skeleton per the archaeology run's
scope (no new required checks added without operator sign-off).
