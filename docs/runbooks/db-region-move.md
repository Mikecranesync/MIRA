# Moving the database next to the server (region move)

**Status (2026-11-20): staging rehearsal tooling only.** Nothing has been switched. Production is
out of scope for the workflow described here.

## Why

The Hub server is in Oregon (OVH Hillsboro). Its Neon database is in Virginia (`aws-us-east-1`).
Measured 2026-11-20 from the server: one query costs about 61 ms of travel, against 0.04 ms of work
inside the database, and the Hub issues its queries one after another. Neon cannot change a
project's region in place, so the data has to be copied into a project in `aws-us-west-2`.

## The pieces

| Piece | What it is |
|---|---|
| `tools/db_region_copy.py` | Copies one database into an **empty** database elsewhere and proves the copy |
| `.github/workflows/db-region-copy.yml` | Runs the tool for **staging**, by hand, with a PostgreSQL 17 client |
| `tests/test_db_region_copy.py` | Pins every refusal and the comparison rules (named step in `ci.yml`) |

## What the tool guarantees

- **The source is only read**: one `READ ONLY` transaction, plus `pg_dump` through that same
  exported snapshot. Because the inventory and the dump see one instant, the comparison is exact
  even while the source is being written to.
- **The target must be empty, a different host, and in the expected region**, or the run refuses
  before copying. Empty means: no relation of any kind, function, type, operator, collation, text
  search configuration or extended statistic in a user schema; no schema besides `public`; and no
  large object, event trigger, publication, foreign server or extension beyond the built-in
  `plpgsql`. It never drops, cleans or overwrites.
- **An endpoint passed as `--refuse-host` is refused on either side.** The workflow passes
  production's endpoint id.
- **Addresses never reach a command line or the log.** They travel in the child processes'
  environment and are redacted from all output.

## What "proves the copy" means

After the restore the tool takes the same inventory of both sides and fails unless they match:

- every table: row count, a content fingerprint (two independently seeded, order-independent
  hash sums over every row: a check against rows lost or changed, not a cryptographic proof),
  columns, defaults, owner, privileges, row security on/off and forced, storage options;
- every row-security policy, compared **exactly**;
- indexes and constraints (table and domain) by definition; functions by their full definition
  (so volatility, strictness, language and settings count) and owner; triggers by definition and
  enabled state; views by definition, owner, options and privileges; sequences by position,
  counting rules (increment, bounds, cycle, cache) and privileges; table kind, persistence,
  partitioning and inheritance; column collation; enum, domain and composite types; rules,
  extended statistics, event triggers, publications, large objects;
- the application roles (flags, memberships, settings) and that the owner can still
  `SET ROLE factorylm_app`;
- schema owners and privileges, default privileges, and the migration ledger (count and content
  hashes).

Not compared: object comments, per-column statistics targets and storage settings. None of them
changes what a query returns.

Differences it tolerates, each printed:

| Difference | Why it is acceptable |
|---|---|
| Rows of a table named in `--leave-rows` (target must hold **zero**) | A deliberate choice; a partial copy still fails |
| An extension that is **newer** on the target | The new project offers newer builds; an older or unreadable version fails |
| A sequence further along on the target | It advanced on the source while the dump ran; behind fails |
| `pg_restore`: "permission denied to change default privileges" | The dump carries the platform's own default-privilege statements; the owner's are compared in the inventory |

A restore re-parses check constraints and index predicates, and Postgres then prints the same
expression differently (`ANY ((ARRAY['a'::character varying])::text[])` becomes
`ANY (ARRAY[('a'::character varying)::text])`). So for constraints and indexes only, a difference
is tolerated, and printed, when the two definitions are equal after removing (1) casts to `text`
or `character varying` and (2) parentheses that wrap a single value. Parentheses that group an
expression are never removed, so `(a OR b) AND c` and `a OR (b AND c)` stay different. Policies
get no such tolerance. Domain constraints are compared the same way as table constraints.

## What is deliberately not copied

- Schemas `neon_auth`, `pgrst`, `auth` and extension `pg_session_jwt`. They are created by Neon's
  optional sign-in and Data API features and owned by platform roles. Checked 2026-11-20 on
  staging: no policy, default, function, view or foreign key in the carried schemas refers to them.
- The rows of `public.cmms_sync_conflicts` (a sync-rejection log: 3.8 million rows, 6.2 GB of
  staging's 9.2 GB). Its structure is carried. The old database is kept, so the rows are not lost.
- Roles. A dump does not carry them. **Create the application roles on the target first**
  (`factorylm_app`, `anonymous`, `authenticated`, `authenticator`, same flags, memberships and
  settings, and the owner granted membership in each); the inventory compares them.
- Writes made to the source after the snapshot instant. Acceptable for staging. **Not acceptable
  for production: stop writers first.**

## Running the staging rehearsal

Preconditions: the Oregon project exists with an empty `staging` branch, the roles above, and an
empty `atlas_cmms` database; its **direct** address is stored as the `staging` environment secret
`NEON_STG_USW2_DATABASE_URL`.

1. Actions -> "DB region copy (staging rehearsal)" -> Run workflow, `mode = structure`. This
   rehearses the method without moving rows. A second run needs an empty target again: reset the
   target branch from its (empty) parent in the Neon console first.
2. Run again with `mode = full`.
3. Read the log: one `VERDICT: MATCH` line per database, the timings, and the target size.

A `REFUSED:` line means a precondition failed and nothing was copied. A `MISMATCH` verdict means
the copy ran and differs: do not use the target; reset the branch and investigate.

## After a matching copy (not done by this workflow)

1. Run the tenant-isolation tests against the new database.
2. Time one query trip from the server to the new host.
3. Switch staging: the staging database settings in Doppler and the `NEON_STG_DATABASE_URL`
   GitHub secret, then redeploy through `deploy-staging.yml`. **Human approval required.**
4. Keep the old staging database untouched for two weeks. Undo = put the settings back and
   redeploy.

## Production

Not covered. It needs, at least: writers stopped for the duration (13 services), a decision on
`cmms_sync_conflicts` there, `ovh-preflight.yml` updated (it checks for the current production
endpoint by name), and its own approval.
