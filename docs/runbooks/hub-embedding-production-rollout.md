# Runbook — Hub embedding: production rollout, smoke, rollback

**Scope:** restoring the `mira-hub` vector path in production (write *and* read).
**Status:** staging deployed + proven end-to-end 2026-08-21. Production pending human GO.

---

## 1. What was broken (both halves, two independent causes)

The Hub owns both halves of its own vector path, and both call the same embedder:

| half | file | symptom when broken |
|---|---|---|
| write | `lib/node-knowledge-ingest.ts::embedPendingNodeChunks` | chunks stay `embedding IS NULL` |
| read | `lib/agents/asset-intelligence.ts::searchKB` | throws `OLLAMA_BASE_URL not set` |

Two causes stacked, and **fixing either alone changes nothing**:

1. **Missing privilege** — `factorylm_app` had `INSERT, SELECT` on `knowledge_entries` but never
   `UPDATE`, so the embedding write failed `42501`. Fixed by migration
   `079_grant_app_knowledge_entries_update.sql`.
2. **Missing embedder config** — `mira-hub` was the only service calling `OLLAMA_BASE_URL` that
   was never given it, so `embedText` returned `embedder_not_configured` and short-circuited
   *before* reaching the UPDATE. Fixed by declaring it on the `mira-hub` service.

Diagnostic signature: corpus-wide embedding coverage is high, but `node_attachment` alone is
near-zero. Measured on prod 2026-08-21: **92,370 total / 1,227 dark — 100% of the dark rows were
`node_attachment` (5.2% embedded)**, every other `source_type` at 100%.

## 2. Current state

| | migration 079 (grant) | `OLLAMA_BASE_URL` on hub | live Hub embedding |
|---|---|---|---|
| dev | applied | n/a (local) | proven |
| staging | applied (auto, `migration-verify.yml`) | **deployed** | **proven — 19/19 on a fresh upload** |
| prod | **applied + verified** (`INSERT,SELECT,UPDATE`) | **pending this PR** | pending |

Production Doppler **already has** `OLLAMA_BASE_URL` (Bravo node over Tailscale) — the five sibling
services use it today. **No production secret change is required.**

## 3. Production deployment sequence

Read-only preflight, then one deploy, then verify. Nothing here is destructive.

```bash
# 0. PREFLIGHT (read-only) — record the "before" numbers.
gh workflow run db-inspect.yml -f target=prod
#    Capture: factorylm_app grants on knowledge_entries  -> expect INSERT,SELECT,UPDATE
#             embedding coverage, node_attachment row    -> expect ~5.2% embedded

# 1. MERGE. This is the production-mutating step: merging to main chains
#    push -> "Smoke Test" -> deploy-vps.yml, which rebuilds+restarts mira-hub
#    (TARGETS defaults to a list including mira-hub) with the new compose env.
gh pr merge <PR> --squash

# 2. WATCH the deploy.
gh run list --workflow=deploy-vps.yml --limit 1
#    deploy-vps runs its own post-deploy `mira-hub health check` step.

# 3. VERIFY (see §4).
```

Migration 079 is **already applied to prod** and recorded in `schema_migrations`; no migration step
is required at deploy time. A post-merge `apply-migrations.yml` run with `migrations=all` correctly
reports it as `skip (already applied)`.

## 4. Production smoke test (automated, read-only first)

**4a. Config + privilege (read-only, sanctioned).**

```bash
gh workflow run db-inspect.yml -f target=prod
```
Assert, from the DB output — not from workflow success:
- `knowledge_entries | INSERT,SELECT,UPDATE`
- the embedding-coverage table renders (proves the probe is deployed)

**4b. Hub liveness.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.factorylm.com/api/health/
```
Expect `200`.

**4c. The real test — a fresh document must embed.** This is the only check that proves the whole
chain, and it is the same flow proven on staging:

1. Sign in to `app.factorylm.com` as a test tenant.
2. Create an Equipment Notebook, upload a **fresh, never-ingested** PDF (a duplicate deduplicates
   and proves nothing — the file is content-hashed per tenant).
3. Re-run `db-inspect.yml -f target=prod` and assert on the `node_attachment` row:
   `total_chunks` increased **and** `embedded` increased by the same amount.
4. Ask a question the document answers; assert the reply carries a citation, and open the cited
   page to confirm the claim's tokens are literally on it.

**Pass criteria:** new chunks appear with `emb = 0` briefly (immediately BM25-searchable), then
reach full coverage within ~1 min for a small document, and the answer cites a real page.

## 4d. The permanent production-smoke tenant

**Do not create a throwaway account per smoke run.** §4c needs a signed-in tenant that can reach
`/equipment/`, and the pre-existing test account `pf525.test@factorylm.com` is **trial-expired** —
it hard-redirects to `/upgrade/`, so it cannot run the smoke. Rather than minting a random account
each time, one designated tenant is documented here:

| | |
|---|---|
| Login | `prod.smoke.20260821@factorylm.test` |
| Created | 2026-08-21, via the normal public `/signup/` flow (7-day trial) |
| Purpose | production smoke only — never a demo or customer account |
| Password | not recorded in the repo; held with the other prod test credentials |

**Two standing caveats.**

1. **Its trial expires**, and an expired tenant is paywalled off `/equipment/` — the exact failure
   that forced this tenant to exist. Before relying on it, confirm it can still open
   `/equipment/`; if not, extend/upgrade it rather than minting another throwaway.
2. **It accumulates smoke artifacts** (a notebook + a document per run). Prune periodically, but
   **preserve the evidence first** — the coverage before/after numbers and the verified citation
   are the proof that the deploy worked.

Smoke uploads are counted by the coverage probe like any other chunk, so a smoke run moves
`node_attachment.total` and `embedded` together. That is the assertion, not noise.

## 5. Backlog recovery (separate, bounded — NOT part of the deploy)

The deploy fixes the path forward; it does not retroactively embed the **1,227** existing dark
`node_attachment` rows. Recover deliberately, never as one uncontrolled batch:

```bash
# Count only, writes nothing.
doppler run -p factorylm -c prd -- python tools/backfill_knowledge_embeddings.py --dry-run

# Bounded slice. Repeat, re-measuring coverage between runs.
doppler run -p factorylm -c prd -- \
  python tools/backfill_knowledge_embeddings.py --source-type node_attachment --limit 200
```

Must run from a **Tailnet node** — CI has no route to the embedder (`apply-seeds.yml` documents the
same constraint). Re-measure with the `db-inspect` coverage probe after each slice.

## 6. Rollback

| what | how | blast radius |
|---|---|---|
| Hub config/code | `gh workflow run deploy-vps.yml -f services="mira-hub"` from the previous good SHA, or revert the PR and let the normal chain redeploy | hub only; chunks stay BM25-searchable throughout |
| Migration 079 | `REVOKE UPDATE ON knowledge_entries FROM factorylm_app;` via `apply-migrations.yml`-style access | returns to the prior (broken) state; no data loss |
| Embeddings written | none needed — writes are additive to a nullable column; `embedding` can be set back to `NULL` per-row if ever required | additive only |

**Nothing in this change is destructive.** The grant adds one privilege, the compose change adds one
env var, and embedding writes populate a previously-`NULL` column. Retrieval degrades to BM25 (the
current production behavior) at every rollback point — it never goes below today's baseline.

## 7. Why BM25-only was survivable, and why this still matters

Chunks are full-text searchable the moment they are written (`content_tsv`), independent of
embeddings — which is why notebooks returned correct, page-exact cited answers throughout the
outage. The vector lane adds paraphrase/concept recall ("slow down ramp" -> `Decel Time 1`); its
absence narrows recall rather than breaking retrieval. Restoring it is a quality fix, not an outage
fix — do not let that justify skipping the fresh-document smoke in §4c.

## Cross-references

- `mira-hub/db/migrations/079_grant_app_knowledge_entries_update.sql` — the grant + its evidence
- `.github/workflows/db-inspect.yml` — read-only grants + embedding-coverage probes
- `tools/backfill_knowledge_embeddings.py` — bounded recovery (`--dry-run`, `--limit`, `--source-type`)
- `.claude/rules/knowledge-entries-tenant-scoping.md` — why the coverage read is tenant-agnostic
  (operator diagnostic, not a per-tenant surface)
