# Runbook — Applying migrations & preventing environment drift

**Why this exists.** In July 2026 the flywheel's mig 013 (`conversation_eval.meta`)
reached prod (via a one-off manual script) but **never staging** — because the
`mira-ingest` migration workflow was **prod-only and ledger-less**. Nothing could
apply it to staging, and nothing detected that staging was behind. This runbook is
the durable fix so it never becomes a one-off manual fix again.

## The two migration sets (one shared Neon DB, one ledger)

| Set | Dir | Apply workflow |
|---|---|---|
| Hub | `mira-hub/db/migrations/` | `apply-migrations.yml` |
| Ingest | `mira-core/mira-ingest/db/migrations/` | `apply-ingest-migrations.yml` |

Both target the **same** Neon database and both record every applied file in the
**same** `schema_migrations` ledger, keyed by full basename
(`013_conversation_eval_meta.sql`). The numeric prefixes overlap across the two
sets — that's fine, the ledger keys on the whole basename.

## Applying migrations (dev → staging → prod, always in that order)

Both workflows take the same inputs: `target` (staging | prod), `migrations`
(`all`, or a comma list like `012,013`), and `mode`:

- **`dry-run`** — print the plan + SQL headers, execute nothing. Always run this first.
- **`apply`** — run each un-applied file (single transaction; ingest splits
  `-- Block 1` / `-- Block 2` for `CONCURRENTLY` indexes) and **record it in the
  ledger**. `migrations=all` auto-skips files already in the ledger.
- **`seed-ledger`** — record files as applied **without running any SQL**. Use
  ONLY to baseline an existing DB whose schema you have **verified is already
  present** but unrecorded (see below). Never seed-ledger a migration whose DDL
  is not actually applied — that hides real drift.

```bash
# staging first, dry-run then apply:
gh workflow run apply-ingest-migrations.yml -f target=staging -f migrations=all -f mode=dry-run
gh workflow run apply-ingest-migrations.yml -f target=staging -f migrations=all -f mode=apply
# verify (below), then promote to prod:
gh workflow run apply-ingest-migrations.yml -f target=prod    -f migrations=all -f mode=apply
```

`DOPPLER_TOKEN` (repo secret) must be able to read both `factorylm/stg` and
`factorylm/prd`. The `prod` target carries the `production` environment gate.

## Detecting drift (the guard)

`tools/migration_drift.py` compares every repo migration (both dirs) to a DB's
`schema_migrations` ledger and lists anything missing.

```bash
# fails (exit 1) if the DB is missing any repo migration:
NEON_DATABASE_URL=$(doppler secrets get NEON_DATABASE_URL -p factorylm -c stg --plain) \
  python tools/migration_drift.py
# advisory (never fails), for reporting:
… python tools/migration_drift.py --warn-only
```

`migration-drift-check.yml` runs this **warn-only** against staging daily + on
demand. Its pure core is unit-tested (`tests/test_migration_drift.py`, in CI).

> **Windows note:** Neon's `channel_binding=require` fails from Windows psql/psycopg2.
> Strip it: `… --plain | sed 's/channel_binding=require/channel_binding=disable/'`.

## One-time ledger baseline (clearing existing drift)

As of 2026-07-09 the **staging** ledger was 22 migrations behind — most of those
migrations' DDL was already applied (via the ingest service, `migration-verify`,
or manual scripts) but never **recorded**. To get a clean ledger:

1. For each drifting migration, **verify whether its DDL is actually applied**
   (probe the table/column it creates — do not assume).
2. **DDL present** → `mode=seed-ledger` for that number (records without running).
3. **DDL absent** → `mode=apply` (runs it, then records) — dry-run first.
4. Re-run the drift check → it should reach **0**.
5. Only then, flip `migration-drift-check.yml` off `--warn-only` for that target to
   make drift a **hard, fail-loud gate**.

Do **not** blanket `seed-ledger` all drift — that would mark unapplied migrations
as done and hide true schema drift.

## Proven (2026-07-09, staging)

Drift detector reported 22 missing on staging including
`013_conversation_eval_meta.sql`; applying + recording 013 via the ledger path
dropped drift to 21 and cleared 013 (61/82 recorded). The apply→ledger→drift loop
works end-to-end on staging.

## Cross-references
- `.github/workflows/apply-migrations.yml` — Hub sister workflow (same ledger).
- `.github/workflows/apply-ingest-migrations.yml` — ingest apply (this runbook).
- `.github/workflows/migration-drift-check.yml` — the drift guard.
- `tools/migration_drift.py` — the detector.
- `.claude/rules/mira-hub-migrations.md` — Hub migration authoring rules (§8 immutability).
- `docs/environments.md` — dev/staging/prod promotion doctrine.
