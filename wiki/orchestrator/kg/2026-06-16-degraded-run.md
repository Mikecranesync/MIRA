# KG note — 2026-06-16 degraded run (A9b)

**No KG delta this run. `graph.json` was NOT modified.**

## Why
- The bash sandbox was hard-down all run (`useradd` I/O error), so **graphify could not run**
  (consistent with every prior round's "graphify uninstallable" note).
- The only data available was the **local working tree @`26531db9`**, which `HISTORY.md`'s own
  2026-06-16 A9 entry shows is **~170 commits behind real `origin/main` @`ba79b4de`**.
- Hand-extracting nodes/edges from code that is 170 commits behind deploy truth would **pollute the
  graph with stale, deploy-contradicting facts**. Per the orchestrator's "don't fake it" rule, the
  honest choice is to extract nothing rather than extract wrong things.

## Graph state (unchanged, carried from HISTORY)
- Nightly graph (`@308e7b55`-era): **3888 nodes / 5853 edges** (no-clobber baseline used by recent
  rounds A8–F8).
- This run: **+0 nodes / +0 edges.**

## Re-check lead for the next healthy run (Lens B, on `origin/main`)
- One stale-tree observation worth a graph-backed confirmation: `/api/workflows` was, at
  `26531db9`, the **lone raw-pool route with an *optional* `tenant_id` filter** (14/15 others were
  tenant-scoped or intentionally-public aggregates). Verify on current main whether that outlier
  edge still exists or was closed in the 170-commit window.
