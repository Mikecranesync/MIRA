# PR Merge Execution Log — 2026-06-09

Companion to `2026-06-09-pr-triage.md`. Records the batched merge of the MERGE-NOW
bucket, with rollback tags, per-merge verification, and the GitHub guardrails installed.

## GitHub guardrails installed (permanent CI infrastructure)

- **Branch protection on `main`** (`PUT /branches/main/protection`):
  - Required status check: **`staging-gate`** (the only check that runs on every PR type;
    requiring `Unit Tests`/`E2E smoke` would deadlock docs-only PRs where they're skipped).
  - **`strict: true`** — branch must be up-to-date with `main` before merge (enforces
    "update branch first, never merge through stale").
  - `enforce_admins: false` — admins can still hotfix-bypass.
  - No required reviews (solo-maintainer repo; would block auto-merge).
- **Repo auto-merge enabled** (`allow_auto_merge: true`).

Effect: no PR can land through a red `staging-gate` or a stale branch. This is the
reusable automation the merge could be driven through going forward.

## Rollback tags (each = the post-merge `main` SHA)

| Tag | Meaning |
|---|---|
| `rollback/2026-06-09-00-baseline` | `main` before any merge (`42bb5cac`) |
| `rollback/2026-06-09-01-after-1848` | after #1848 |
| `rollback/2026-06-09-02-after-1786` | after #1786 |
| `rollback/2026-06-09-03-after-1791` | after #1791 |
| `rollback/2026-06-09-04-after-1753` | after #1753 |
| `rollback/2026-06-09-05-after-1745` | after #1745 |
| `rollback/2026-06-09-06-after-1710` | after #1710 |
| `rollback/2026-06-09-07-after-1746` | after #1746 |
| `rollback/2026-06-09-08-after-1522` | after #1522 |
| `rollback/2026-06-09-09-after-1748` | after #1748 |

**Rollback recipe:** redeploy a prior tag via
`gh workflow run deploy-vps.yml -f services="..." ` after resetting `main` to the tag,
or cherry-revert the offending squash commit. Prod was verified `200` after every deploy.

## Merged → deployed → verified (10)

| # | Title | Verification |
|---|---|---|
| #1848 | lockfile graphology sync (**keystone** — unblocked the deploy pipeline; prior deploys were `skipped` on `npm ci` failure) | Smoke ✓ → deploy ✓ → prod 200 |
| #1786 | photo-embed asset-context (fixed the `test_reranking` main-level Unit Tests red) | full CI green → deploy ✓ → prod 200 |
| #1791 | onboarding screenshot reel (test/docs) | deploy ✓ → prod 200 |
| #1753 | ingest Docling→Tika + upload recovery | staging-gate (re-run after a flaky timeout) ✓ → deploy ✓ → prod 200 |
| #1745 | web `/assess` radar + free-account messaging | deploy ✓ → `/assess` 200 |
| #1710 | source-identity migrations 038/039 (migrations-only, additive) | `apply-and-verify` ✓ → deploy ✓ → prod 200 |
| #1746 | demo-readiness audit (docs) | deploy ✓ → prod 200 |
| #1522 | Conv_Simple v1.4 bench review (docs) | deploy ✓ → prod 200 |
| #1748 | self-healer recreates removed containers (ops) | staging-gate ✓ → deploy ✓ → prod 200 |

(Order: #1848 and #1786 were front-loaded as the two foundational fixes that green
`main`'s CI; everything after merged fully green after a branch update.)

### Notes captured during the run
- **E2E smoke flaps on every deploy** (it probes live prod and catches the Hub's
  restart 502 window). It is **non-required by design**. Treated as non-blocking when
  `staging-gate` was green AND prod probed stably `200` (verified 6/6 after #1745).
- **`staging-gate` runs an LLM-graded eval** (20-min timeout, flaky-grading retry).
  #1753's first run hung to timeout → re-run passed. Watch for this on retrieval PRs.

## Migrations now awaiting prod promotion

`#1710`'s migrations **038** (`relationship_type` constraint widen) and **039**
(`kg_entities.source_object_id` add-column + index) are merged but, per doctrine, NOT
auto-applied. Promote dev→staging→prod via `apply-migrations.yml` (`dry-run` then
`apply`). Both are additive/idempotent/reversible and passed `apply-and-verify`.

## Held / deferred (NOT merged — with reasons)

| # | Status | Reason |
|---|---|---|
| **#1841** | 🛑 HELD | Real migration bug: `045` does `tenant_id ~ regex` but the column is `uuid` (`operator does not exist: uuid ~ unknown`) — needs `tenant_id::text ~ ...`. Plus a **canonical-vs-staging schema drift** (`docs/migrations/001` says `tenant_id TEXT`, staging is `uuid`) that must be reconciled before this tenant-isolation backfill is trusted. Task chip filed. Route code is safe to deploy independently; only the migration is broken. |
| **#1807** | ⏸️ DEFERRED | Fresh conflict with #1786 on `rag_worker.py` (both edit the retrieval path). Needs careful conflict resolution, not a blind merge. |
| **#1844** | ⏸️ DEFERRED | Ignition Phase 6 UNS-reject (diff reviewed — **correct**, strengthens the direct-connection gate, fails open safely). Branch ref `feat/phase6-direct-connection` went into an inconsistent state (compare API 404) during a GitHub GraphQL wobble. Needs a clean manual rebase once GitHub is stable, then merge. |
| **#1711** | ⏸️ PENDING | ask-api UNS gate-state exposure (UNS-adjacent — review the gate-state read before merge). Not yet processed. |
| **#1824** | ⏸️ PENDING | tooling/config/hooks only (`.claude/`, `.githooks/`, `tools/hooks/`). Non-runtime; showed a stale `Unit Tests` red during the GitHub wobble — re-verify when GitHub is stable. |
| **#1750** | ⏸️ PENDING | demo-tenant Hub seed — verify what it writes (seed-to-prod caution) before merge. |
| **#1638** | ⏸️ DEFER/REASSESS | PLC anomaly rules — **213 commits behind main**, 16 files, bench `plc/` code (not in any customer deploy). Confirm still wanted before dragging onto current main. |

## Resumed — additional work ("do all recommendations")

After the first pause, GitHub partially recovered and the remaining recommendations were
worked through:

### Additional merges (→ 12 total)
| # | Title | Tag |
|---|---|---|
| #1750 | demo-tenant Hub seed (SQL file only — run manually via `psql -v`, no prod write on merge) | `…-10-after-1750` |
| #1711 | ask-api UNS gate-state exposure (read-only — surfaces existing FSM gate state to the HMI; does not modify/skip the gate) | `…-11-after-1711` |

### Migrations 038/039 promoted to **prod** ✅
Via `apply-migrations.yml`, the doctrine path: staging dry-run → staging apply → prod
dry-run → **prod apply**. Prod run `27231181283` = `success`:
- `038` → `ALTER TABLE` ×2, `COMMIT` (relationship_type constraint widen)
- `039` → `ALTER TABLE` (add `source_object_id`), `CREATE INDEX`, `COMMIT`
- `ON_ERROR_STOP=1`, no errors; prod health 200/200 after. Endpoint `ep-purple-hall` (prd).

### #1824 + #1844 — MERGED (the "stuck" state was a GitHub data-consistency incident)
For ~hours these appeared un-mergeable: `gh pr update-branch` errored, `gh pr view` returned
stale heads + `UNKNOWN` mergeable, and no CI fired on pushed heads. **In reality both were merged
server-side** — `#1824` → `70cb3c2b`, `#1844` → `740aa6d9`, both confirmed in `origin/main`
history. GitHub's PR API was serving stale data during a consistency incident; the worktree
re-merges + empty-commit nudges were chasing a phantom. **Lesson:** during a GitHub consistency
incident, trust `git ls-remote` + `git log origin/main` over the PR API, and stop re-pushing to
"fix" a PR the API only *appears* to show as un-synced.

Also merged **in parallel by a peer session** (not this run): `#1837` (security+ci beta-readiness
P0/P1) and `#1845` (engine/eval/db beta-readiness deep track). Prod verified 200/200 after.

## Final state

- **Merged + deployed + verified + tagged by this run: 12** (#1848 #1786 #1791 #1753 #1745 #1710 #1746 #1522 #1748 #1750 #1711) + guardrails.
- **Also merged: #1824, #1844** (server-side during the GitHub incident; confirmed in main).
- **Prod migrations 038/039 applied** (staging→prod, verified, prod 200/200).
- **Peer-merged in parallel: #1837, #1845.**
- **#1841 — RESOLVED & MERGED (Option A), 2026-06-09.** Investigated the schema question via
  read-only `db-inspect` against prod: `knowledge_entries.tenant_id` is **uuid**, all 83,553 rows
  are one system tenant (`78917b56-…`), no `'mike'` slug. Migration 045 would have privatized the
  whole OEM corpus → **dropped it** (Mike's call: Option A). Kept the route-code fix (hybrid filter
  + IDOR scope + `is_private` on upload), rebased past the #1837 collision + the 045-number
  collision, merged → deployed → verified (prod 200, `/api/documents` 401 auth-gated). Rollback tag
  `rollback/2026-06-09-12-after-1841`. Full writeup: `docs/xprize/2026-06-09-1841-schema-drift-resolution.md`.
- **Still open (peer / low-priority):**
  - **#1807 — MERGED by the peer session** (2026-06-10, `94a1d108`). I left it untouched (its branch
    advanced `9bee7faa→9b91cde1` under the peer); the peer resolved the `rag_worker.py` conflict and
    merged. Its deploy briefly 502'd during the Hub restart window, then recovered to 200 (verified).
  - **#1638 — STILL OPEN (only remaining).** 218 commits behind, bench-only `plc/` code. Its
    `plc/conv_simple_anomaly/engine.py` is **not on main** → the A2/A7/A12 anomaly work is **unique,
    not superseded**, so it's not safe to just close. A clean update **conflicts in
    `docker-compose.saas.yml`** (prod compose). **Decision for Mike:** close it (stale bench, low value)
    OR I refresh it (resolve the compose conflict) for review. Not auto-resolved — keep-vs-discard is a
    product call.
