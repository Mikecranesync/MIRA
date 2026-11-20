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
| `tools/db_region_copy.py` | Copies one database into an **empty** database elsewhere and checks the copy against the source |
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

## What the comparison covers, and what it refuses

The tool does not claim to verify every kind of thing a Postgres database can hold. It verifies
the kinds listed below and **refuses to copy a source that holds anything else**, so a `MATCH`
never covers data it did not look at:

- Row contents are checked for ordinary and partitioned tables.
- A materialized view, a foreign table, a relation kind the tool does not know, or any large
  object on the source makes the run refuse before the dump, naming what it found. The rule is a
  whitelist of relation kinds, not a list of known gaps. Staging holds none of these (checked
  2026-11-20: both databases).

After the restore the tool takes the same inventory of both sides and fails unless they match.
A match needs positive evidence, not the absence of a difference: both inventories must carry
every section; every table whose rows were copied must have a content fingerprint on **both**
sides; and wherever rows were to be left behind (the named table in a full copy, every table in
a structure-only one) the target must hold **zero** rows. Equal row counts alone never pass.

- every table: row count, a content fingerprint (two independently seeded, order-independent
  hash sums over every whole row: a check against rows lost or changed, not a cryptographic
  proof), columns, defaults, owner, privileges, row security on/off and forced, storage options;
- every row-security policy, compared **exactly**;
- indexes and constraints (table and domain) by definition; functions by their full definition
  (so volatility, strictness, language and settings count) and owner; triggers by definition and
  enabled state; views by definition, owner, options and privileges; sequences by state (the
  stored value and whether it was already handed out, read from the sequence itself), counting
  rules (increment, bounds, cycle, cache) and privileges. A target sequence may be ahead of the
  source, in the direction the sequence counts, because the source can move while the dump
  runs; it may never be behind, and a sequence that cycles must match exactly; table kind, persistence,
  partitioning and inheritance; column collation; enum, domain and composite types; rules,
  extended statistics by definition; event triggers and publications by PRESENCE only (an event
  trigger's name and event, a publication's name and all-tables flag), not their membership or
  options;
- the application roles: flags, settings, and what each can do with each other role (see
  "Roles" below), and that the owner can still `SET ROLE factorylm_app`;
- schema owners and privileges, default privileges, and the migration ledger (count and content
  hashes).

One difference in how a definition is printed is tolerated, and only that one: an array of
string literals cast as a whole, `(ARRAY['a'::character varying])::text[]`, comes back from a
restore with the cast on each element, `ARRAY[('a'::character varying)::text]`. All 36
reprinted definitions on staging have this shape. Any other difference in a constraint or
index definition fails the run, including a cast added or removed anywhere else.

Not compared: object comments, per-column statistics targets and storage settings. None of them
changes what a query returns.

Known limits, accepted for the staging rehearsal (review round 7, owner's decision 2026-11-20):

- A publication's table list and options, and an event trigger's function and tags, are not
  compared. Staging holds no publication and no event trigger owned by the database owner.
- The empty-target check does not count user-defined casts. Creating a cast requires owning one of
  its two types, and every user-owned type is counted, so only a superuser could leave a cast in
  an otherwise empty database. The target is a fresh database created for this copy.

Revisit both before using the tool on a database that holds publications, or on a target that
was not created empty for the purpose.

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
  settings, and the owner granted membership in each). The tool refuses to start unless they
  match: it asks both servers what each role can actually do with each other role (is it a
  member, does it inherit without switching, may it switch, may it administer), not only
  whether a membership exists. A membership granted with the wrong options - for example one
  that inherits where the source requires an explicit switch - is a refusal. Three differences
  are expected on a new project and are printed, not hidden: the owner administers the roles it
  created there; platform service roles reach the application roles on the source only; and
  the role of a platform feature that is not carried exists on the source only.
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

How a run ends:

| Last line | Exit code | Meaning | What to do |
|---|---|---|---|
| `VERDICT: MATCH` for every database | exit code 0 | Copied and compared equal | Go on to "After a matching copy" |
| `VERDICT: MISMATCH` | exit code 1 | The copy ran and differs from the source | Do not use the target. Reset the branch and investigate |
| `REFUSED:` | exit code 2 | A precondition failed **before any restore started**. Nothing was written | Fix the cause and run again |
| `FAILED AFTER WRITING to ...` | exit code 3 | A restore had started in at least one database when the run failed. The line names each database as `copied` or `restore started, may be partial` | Do not use the target. **Reset the target branch before any retry** |

`REFUSED` is only ever printed before the first restore. Once one database has been written,
any later failure - including a refusal on the next database - is reported as
`FAILED AFTER WRITING`, because the target is no longer empty.

### How the restore protects the target

The target must be empty, and the tool checks that twice: before anything is read, and again
immediately before each database's restore (reading the source takes minutes; the first check
is old by then). The archive is then restored in three sections from the same held snapshot:
the objects, the rows, and last the indexes, constraints and privileges. The first two stop at
the first error, so if something in the target collides with an object being created, the run
ends there and no row is loaded on top of it. The tool cannot lock other sessions out of the
target: rows written into a copied table by someone else during the run are caught afterwards
by the content fingerprint and reported as a mismatch.

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
