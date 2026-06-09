# Apply Migrations

**Authoritative doctrine:** `docs/environments.md` §"Hard rules" #5 (dev → staging → prod, never by hand).
**Historical naming:** `docs/migrations/deploy-order.md` — historical YYYY-MM-DD naming context; current files use `NNN_name.sql` prefix style.

This runbook covers all three migration directories, which workflows apply each,
and the correct dev → staging → prod promotion sequence.

---

## The three migration directories

| Directory | Schema | Automated applier |
|---|---|---|
| `mira-hub/db/migrations/` | Hub: proposals, namespaces, KG entities/relationships, tag events, decision traces | `apply-migrations.yml` |
| `mira-core/mira-ingest/db/migrations/` | Ingest: asset QR tags, tenant config, knowledge tsvector, intent signals | `apply-ingest-migrations.yml` |
| `docs/migrations/` | Engine: knowledge_entries, fault_codes, kg_entities, kg_relationships, kg_approval_state | **No automated applier** |

### Important: `docs/migrations/` has no workflow

Files in `docs/migrations/` (001-008) are planned engine-level migrations.
**No GitHub Actions workflow applies them automatically.** If you need to apply
these against a live database, you must run them manually via `psql` — which
requires explicit human approval and the `MIRA_ALLOW_PROD=1` override for any
prod-touching command. Do not apply them via Claude Code without explicit instruction.

Current high-water marks:
- `mira-hub/db/migrations/`: `037_tag_event_diffs.sql`
- `mira-core/mira-ingest/db/migrations/`: `012_conversation_eval.sql`
- `docs/migrations/`: `008_kg_approval_state.sql`

---

## Prerequisites

- Repo write access (required for `workflow_dispatch`)
- For the `production` environment gate: a repo admin must approve the run
  in the GitHub Actions UI before the `apply` step executes
  (`apply-migrations.yml:66` — environment: `production`)
- New migration files must be committed and merged to `main` before dispatching
  (workflows check out `main` at run time)

---

## Step 1 — Write the migration (dev)

```bash
# Create the file in the appropriate directory
touch mira-hub/db/migrations/038_your_feature_name.sql
# (or mira-core/mira-ingest/db/migrations/013_your_feature_name.sql)
```

Number the file as the next available integer after the current high-water mark.
Check `ls mira-hub/db/migrations/ | sort | tail -5` to confirm the next slot.

**Migration prefix collision warning:** prefixes 032 and 033 each have two files
in `mira-hub/db/migrations/`:
- `032_decision_traces.sql` and `032_inferred_relationship_types.sql`
- `033_kg_query_traces.sql` and `033_tag_events.sql`

When `apply-migrations.yml` resolves a prefix like `032`, it globs `032_*.sql`
and applies **all matching files in sort order**. This is a known collision.
New migrations must use unique prefixes starting at `038` or higher.
(Source: `.github/workflows/apply-migrations.yml:119-135`)

Test your migration against a dev database before promoting:
```bash
# Dev: run against the local or dev NeonDB branch
doppler run -p factorylm -c dev -- psql "$NEON_DATABASE_URL" -f mira-hub/db/migrations/038_your_feature_name.sql
```

Commit and open a PR. The migration file must be on `main` before dispatch.

---

## Step 2 — Apply to staging (dry-run, then apply)

### Hub migrations (`mira-hub/db/migrations/`)

```bash
# Dry-run first — inspect what would execute, no writes
gh workflow run apply-migrations.yml \
  -f target=staging \
  -f migrations="038" \
  -f mode=dry-run

# Watch the run
gh run list --workflow=apply-migrations.yml --limit 3
gh run watch <RUN_ID>
```

Review the dry-run output in the Actions log. It prints each SQL statement without
executing. When satisfied:

```bash
# Apply to staging
gh workflow run apply-migrations.yml \
  -f target=staging \
  -f migrations="038" \
  -f mode=apply
```

Expected output: `Migration 038_your_feature_name.sql applied successfully` (or similar).
The workflow records applied migrations so they are not re-applied on the next run.

**"all" mode:** passing `migrations=all` applies every file in `mira-hub/db/migrations/`
not yet recorded. Use with caution — on a staging reset this may replay many files.

### Ingest migrations (`mira-core/mira-ingest/db/migrations/`)

```bash
gh workflow run apply-ingest-migrations.yml \
  -f migrations="013" \
  -f mode=dry-run

gh workflow run apply-ingest-migrations.yml \
  -f migrations="013" \
  -f mode=apply
```

`apply-ingest-migrations.yml` always targets **prod** (no staging option —
`environment: production` hardcoded at line 42). Apply these to staging manually
via `psql` with the staging connection string (`NEON_STG_DATABASE_URL` from
Doppler `factorylm/stg`) before running the workflow.

Files with `-- Block 1` / `-- Block 2` comments are split at the marker:
Block 1 runs inside a transaction; Block 2 runs outside (for `CREATE INDEX CONCURRENTLY`).
(Source: `.github/workflows/apply-ingest-migrations.yml:159-176`)

---

## Step 3 — Verify on staging

After applying to staging, exercise the affected feature against the staging database:

```bash
# Staging NeonDB: branch br-small-term-ahtkz61d
# Connection string: NEON_STG_DATABASE_URL in Doppler factorylm/stg
doppler run -p factorylm -c stg -- psql "$NEON_DATABASE_URL" -c "\d your_new_table"
```

Or run the staging gate manually to check for retrieval regressions:
```bash
gh workflow run staging-gate.yml
```

---

## Step 4 — Apply to production (requires approval gate)

### Hub migrations

```bash
# Dry-run against prod first (recommended even after staging verified)
gh workflow run apply-migrations.yml \
  -f target=prod \
  -f migrations="038" \
  -f mode=dry-run

# Apply to prod — triggers production environment gate
gh workflow run apply-migrations.yml \
  -f target=prod \
  -f migrations="038" \
  -f mode=apply
```

When `target=prod` and `mode=apply`, the GitHub Actions environment `production`
is required (`.github/workflows/apply-migrations.yml:66`). A repo admin must
**approve** the run in the Actions UI before the SQL executes. The workflow
will pause at the environment gate and send a notification to approvers.

Concurrency: `group: migrations-prod`, `cancel-in-progress: false`. Only one
prod migration run at a time; a second dispatch queues.

### Ingest migrations (always prod)

```bash
gh workflow run apply-ingest-migrations.yml \
  -f migrations="013" \
  -f mode=dry-run

gh workflow run apply-ingest-migrations.yml \
  -f migrations="013" \
  -f mode=apply
```

Same production environment gate applies.

---

## NeonDB branch reference

| Target | NeonDB branch | Branch ID |
|---|---|---|
| staging | staging | `br-small-term-ahtkz61d` |
| production | main | `br-lively-bread-ahoa86se` |

Project: `divine-heart-77277150`.
(Source: `docs/environments.md:39`)

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Workflow dispatch fails with "Resource not accessible" | Your token lacks workflow dispatch permission | Ensure you have repo write access; `gh auth status` |
| Migration applied twice on staging | `migrations=all` + staging was reset to prod clone | Safe — idempotent migrations use `IF NOT EXISTS`; non-idempotent ones will error; check the log |
| Prefix collision applies unwanted file | `032` glob matches both `032_decision_traces.sql` and `032_inferred_relationship_types.sql` | Name new migrations starting at `038`; inspect the dry-run output before apply |
| Production gate never fires approval notification | Approver not listed in the `production` environment's required reviewers | Add the approver in GitHub repo Settings → Environments → production |
| `apply-ingest-migrations.yml` has no staging option | By design — hardcoded `environment: production` | Apply ingest migrations to staging manually via psql first |
| `docs/migrations/` engine files need to go to prod | No automated workflow exists | Apply manually via `psql` with explicit human approval; use `MIRA_ALLOW_PROD=1` override only in a human-controlled shell |
| Migration fails mid-run on prod | Statement error (type mismatch, FK violation, etc.) | The workflow runs each file inside a transaction (`psql -1`) — failure rolls back. Check the Actions log for the specific statement. Fix the file, re-open a PR, merge, and re-dispatch. Do NOT hand-edit prod schema. |
| NeonDB connection SSL error from Windows | `channel_binding` failure | Use a macOS host (CHARLIE or Alpha) for psql sessions — see CLAUDE.md Gotchas |
