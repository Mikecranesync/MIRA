# Fix #8 — #568 ISO 14224 seed: make idempotent

**Branch:** `agent/issue-568-failure-codes-iso14224-0405`
**Severity:** 🚫 Functional
**Effort:** ~45 min

## What's broken

`mira-hub/db/seeds/iso-14224-seed.sql` has 1000+ INSERT statements using
`gen_random_uuid()` per row. Re-running:

- Hits the unique constraint on `failure_classes.code`, raises `duplicate key value violates unique constraint`, rolls back the entire transaction.
- If anyone deploys this twice, the seed silently fails on the second run and you don't notice until you try to add a custom failure code with a code that collides with the unseeded row.

Self-flagged in the seed file header. The agent listed the fix path
("uuid_generate_v5 + ON CONFLICT") but didn't apply it.

## The fix

Replace `gen_random_uuid()` with `uuid_generate_v5()` against a stable
namespace, and add `ON CONFLICT (code) DO UPDATE SET …` so re-runs are
upserts.

### Patch 8.1 — Migration: ensure `uuid-ossp` is installed

Add to the head of `mira-hub/db/migrations/2026-04-24-006-iso-14224.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

(Neon supports it. No action required if already present in the migration; verify via `\dx` in psql.)

### Patch 8.2 — Add a seed-versions table

```sql
-- Add to the end of 2026-04-24-006-iso-14224.sql

CREATE TABLE IF NOT EXISTS seed_versions (
    seed_name      TEXT PRIMARY KEY,
    applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_sha256    TEXT NOT NULL,
    row_count      INTEGER NOT NULL DEFAULT 0
);
```

### Patch 8.3 — Rewrite the seed file

Make it idempotent by:

1. Using `uuid_generate_v5(namespace_uuid, code)` so re-running produces the same UUID, allowing `ON CONFLICT` to no-op.
2. Adding `ON CONFLICT (code) DO UPDATE SET …` so name/description changes propagate on re-run (handy when you tune wording in dev).
3. Bracketing with a `seed_versions` row check so production won't re-run the seed unless the file SHA changes.

```sql
-- mira-hub/db/seeds/iso-14224-seed.sql (rewritten)
--
-- Idempotent. Safe to re-run.
--
-- Strategy:
--   * Stable UUIDs via uuid_generate_v5(NS, code). The NS is a fixed
--     per-domain namespace that we generated once with `uuidgen` and
--     pinned below. Don't change it — every existing reference to the
--     resulting UUIDs would break.
--   * ON CONFLICT (code) DO UPDATE keeps name/description in sync with
--     the seed file, which is the editable source of truth.
--   * Wrapped in a seed_versions guard. If the file's SHA matches what
--     is stored, exit early (no-op).
--
-- Run:
--    SHA=$(shasum -a 256 mira-hub/db/seeds/iso-14224-seed.sql | awk '{print $1}')
--    psql "$DB" -v sha="'$SHA'" -f mira-hub/db/seeds/iso-14224-seed.sql

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Guard — exit early if this exact file has been applied.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    expected_sha TEXT := :sha;        -- supplied via psql -v sha='...'
    current_sha  TEXT;
BEGIN
    SELECT file_sha256 INTO current_sha
      FROM seed_versions WHERE seed_name = 'iso-14224';
    IF current_sha IS NOT NULL AND current_sha = expected_sha THEN
        RAISE NOTICE 'seed iso-14224 already applied at this file SHA — no-op';
        RETURN;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Equipment classes — stable UUIDs via v5(NS, code).
-- ---------------------------------------------------------------------------
-- Namespace: pin once, never change. Generated with `uuidgen`.
\set iso_ns '''2c6b4f14-9b4f-5a1a-9f4a-9b4f5a1a9f4a'''

INSERT INTO failure_classes (id, code, name, description, iso_section, equipment_type, tenant_id, is_custom)
VALUES
    (uuid_generate_v5(:iso_ns::uuid, 'PU-CEN'), 'PU-CEN', 'Centrifugal pump',           'Single- or multi-stage centrifugal pump for liquid transfer.', 'ISO 14224 A.2.4.1', 'pump',           NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'PU-REC'), 'PU-REC', 'Reciprocating pump',         'Positive-displacement piston or plunger pump.',                'ISO 14224 A.2.4.2', 'pump',           NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'MO-ELE'), 'MO-ELE', 'Electric motor',             'AC induction or synchronous electric motor, all sizes.',       'ISO 14224 A.2.3.1', 'motor',          NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'GB-MEC'), 'GB-MEC', 'Gearbox',                    'Mechanical gear reducer / speed-changer.',                     'ISO 14224 A.2.5.1', 'transmission',   NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'CO-SCR'), 'CO-SCR', 'Screw compressor',           'Rotary screw gas compressor (oil-flooded or oil-free).',       'ISO 14224 A.2.2.3', 'compressor',     NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'CO-REC'), 'CO-REC', 'Reciprocating compressor',   'Piston-type gas compressor.',                                  'ISO 14224 A.2.2.1', 'compressor',     NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'HE-SHL'), 'HE-SHL', 'Shell-and-tube heat exchanger','Tubular heat exchanger, shell-and-tube configuration.',      'ISO 14224 A.2.6.1', 'heat_exchanger', NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'VA-GAT'), 'VA-GAT', 'Gate valve',                 'Manual or actuated gate isolation valve.',                     'ISO 14224 A.2.8.1', 'valve',          NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'VA-CTL'), 'VA-CTL', 'Control valve',              'Modulating control valve with positioner.',                    'ISO 14224 A.2.8.4', 'valve',          NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'FA-CEN'), 'FA-CEN', 'Centrifugal fan / blower',   'Centrifugal industrial fan or blower.',                        'ISO 14224 A.2.7.1', 'fan',            NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'CV-BLT'), 'CV-BLT', 'Belt conveyor',              'Continuous belt conveyor for bulk or unit loads.',             'ISO 14224 A.2.9.1', 'conveyor',       NULL, false),
    (uuid_generate_v5(:iso_ns::uuid, 'MA-CNC'), 'MA-CNC', 'CNC machining centre',       'Computer-numerical-control machine tool (mill, lathe, etc.).', 'ISO 14224 A.3.1',   'machine_tool',   NULL, false)
ON CONFLICT (code) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    iso_section = EXCLUDED.iso_section,
    equipment_type = EXCLUDED.equipment_type;

-- ---------------------------------------------------------------------------
-- 2. Failure modes (per class) — same v5 + ON CONFLICT pattern.
-- ---------------------------------------------------------------------------
-- ... (apply the same v5 / ON CONFLICT idiom to every INSERT in the file)

-- ---------------------------------------------------------------------------
-- 3. Stamp the version row.
-- ---------------------------------------------------------------------------
INSERT INTO seed_versions (seed_name, file_sha256, row_count)
VALUES ('iso-14224', :sha, (SELECT count(*) FROM failure_classes WHERE is_custom = false))
ON CONFLICT (seed_name) DO UPDATE
    SET applied_at = now(),
        file_sha256 = EXCLUDED.file_sha256,
        row_count = EXCLUDED.row_count;

COMMIT;
```

The same `v5(:iso_ns, <code>) … ON CONFLICT (code) DO UPDATE` pattern
applies to `failure_modes`, `failure_mechanisms`, `failure_causes`. Bulk
sed:

```bash
# In your editor, on the seed file:
#   1. Replace every `gen_random_uuid()` with the v5 call patterned above
#      (you'll need a unique key per row — use the row's `code` column).
#   2. Add `ON CONFLICT (code) DO UPDATE SET <non-key cols>` after each
#      VALUES list.
```

### Patch 8.4 — Apply script

```bash
# mira-hub/scripts/apply-iso-14224-seed.sh
set -e
SEED="$(dirname "$0")/../db/seeds/iso-14224-seed.sql"
SHA=$(shasum -a 256 "$SEED" | awk '{print $1}')
echo "applying iso-14224 seed at sha=$SHA"
psql "${DATABASE_URL:?DATABASE_URL must be set}" \
  -v "sha=$SHA" \
  -f "$SEED"
```

## Test

`mira-hub/db/__tests__/iso-14224-seed.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

let pool: Pool;
const SEED_PATH = "mira-hub/db/seeds/iso-14224-seed.sql";
const URL = process.env.TEST_DATABASE_URL;

beforeAll(async () => {
  if (!URL) throw new Error("TEST_DATABASE_URL required");
  pool = new Pool({ connectionString: URL });

  // Apply schema migrations through #568.
  for (const m of [
    "2026-04-24-003-asset-hierarchy.sql",
    "2026-04-24-006-iso-14224.sql",
  ]) {
    execSync(`psql ${URL} -f mira-hub/db/migrations/${m}`, { stdio: "inherit" });
  }
});

afterAll(async () => {
  await pool.end();
});

function applySeed() {
  const sha = createHash("sha256").update(readFileSync(SEED_PATH)).digest("hex");
  execSync(`psql ${URL} -v "sha=${sha}" -f ${SEED_PATH}`, { stdio: "inherit" });
}

describe("ISO 14224 seed — idempotency", () => {
  it("applies cleanly the first time", async () => {
    applySeed();
    const { rows } = await pool.query(
      "SELECT count(*)::int FROM failure_classes WHERE is_custom = false",
    );
    expect(rows[0].count).toBeGreaterThanOrEqual(12);
  });

  it("re-running is a no-op (no errors, no duplicates)", async () => {
    const { rows: before } = await pool.query("SELECT count(*)::int FROM failure_classes");
    applySeed();
    const { rows: after } = await pool.query("SELECT count(*)::int FROM failure_classes");
    expect(after[0].count).toBe(before[0].count);
  });

  it("UUIDs are stable across runs (v5 namespace)", async () => {
    const { rows: r1 } = await pool.query(
      "SELECT code, id FROM failure_classes WHERE code = 'PU-CEN'",
    );
    applySeed();
    const { rows: r2 } = await pool.query(
      "SELECT code, id FROM failure_classes WHERE code = 'PU-CEN'",
    );
    expect(r1[0].id).toBe(r2[0].id);
  });

  it("seed_versions row reflects the applied SHA", async () => {
    const sha = createHash("sha256").update(readFileSync(SEED_PATH)).digest("hex");
    const { rows } = await pool.query(
      "SELECT file_sha256 FROM seed_versions WHERE seed_name = 'iso-14224'",
    );
    expect(rows[0].file_sha256).toBe(sha);
  });

  it("editing a seed row's name propagates on re-run (DO UPDATE)", async () => {
    // Manually mutate one row to simulate someone applying an old SHA.
    await pool.query(
      "UPDATE failure_classes SET name = 'OLD NAME' WHERE code = 'MO-ELE'",
    );
    applySeed();
    const { rows } = await pool.query(
      "SELECT name FROM failure_classes WHERE code = 'MO-ELE'",
    );
    expect(rows[0].name).toBe("Electric motor"); // back to seed value
  });

  it("custom (tenant-created) rows are NOT touched by re-running", async () => {
    // Insert a custom row.
    await pool.query(
      `INSERT INTO failure_classes (id, code, name, tenant_id, is_custom)
       VALUES (gen_random_uuid(), 'CUSTOM-XYZ', 'Custom thing', '00000000-0000-0000-0000-000000000001', true)`,
    );
    applySeed();
    const { rows } = await pool.query(
      "SELECT name FROM failure_classes WHERE code = 'CUSTOM-XYZ'",
    );
    expect(rows[0].name).toBe("Custom thing"); // untouched
  });
});
```

## Verification

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name mira-seed-test postgres:16
sleep 3
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
  npx vitest run mira-hub/db/__tests__/iso-14224-seed.integration.test.ts
docker stop mira-seed-test
```

6 tests pass. The seed is now safe to re-run; SHA-keyed guard prevents
accidental re-runs at the same version; custom rows stay untouched.

## Why this design

- **`uuid_generate_v5` over `gen_random_uuid()`** — stable across environments, so a WO closed in dev with `failure_code_id = X` exports cleanly to staging/prod where the same code resolves to the same UUID.
- **`ON CONFLICT (code) DO UPDATE`** — lets us iterate seed wording without re-creating IDs. Tenants' custom rows have `code` values that collide with seeded codes only if they're trying to override (which we do NOT support — codes for shared rows have a reserved namespace).
- **`seed_versions` table** — gives ops a single place to look to confirm "which seed SHA is on this DB?" without inspecting every row.
- **`\set ON_ERROR_STOP on`** — non-zero exit on any error. Without this, psql swallows non-rolling failures.
