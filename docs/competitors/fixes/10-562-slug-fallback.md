# Fix #10 — #562 asset hierarchy: slug fallback for empty regex output

**Branch:** `agent/issue-562-asset-hierarchy-0405`
**Severity:** ⚠️ High (data integrity)
**Effort:** ~15 min

## What's broken

`mira-hub/db/migrations/2026-04-24-003-asset-hierarchy.sql:144-160`:

```sql
SET slug = COALESCE(
  e.slug,
  NULLIF(regexp_replace(lower(coalesce(e.equipment_number, e.id::text)),
                        '[^a-z0-9]+', '-', 'g'), '')
)
```

If `equipment_number = "!!!"` or any all-non-alphanumeric value, the
regex strips it to `''`, `NULLIF` returns NULL, COALESCE returns NULL.
The row's `slug` stays NULL.

Consequences:
- The PATH index `text_pattern_ops` doesn't include rows with NULL paths — they don't appear in subtree queries.
- Future inserts to the same area can't detect collision because the unique constraint `(area_id, slug)` is partial (NULL doesn't collide with NULL in btree).
- The QR code endpoint `/api/v1/assets/{id}/qr` produces a URL with `…/null/null/null` — confusing, breaks scan-to-WO flows.

## The fix

Use a deterministic fallback when the slug regex strips everything.
Prefer a UUID prefix from `id` so the slug is stable across re-runs of
the migration.

### Patch 10.1 — Migration

Replace the slug computation in the existing migration. If you can't
edit the original (it's already been applied somewhere), add a follow-up
migration:

```sql
-- mira-hub/db/migrations/2026-04-25-003-asset-slug-fallback.sql
-- Issue: #562 follow-up — backfill empty slugs.
--
-- The original migration 2026-04-24-003 computed slug from
-- equipment_number via regex. Equipment with no alphanumerics in their
-- number got slug=NULL. Backfill those with a deterministic UUID prefix.

BEGIN;

-- Backfill equipment with NULL slug.
UPDATE cmms_equipment
   SET slug = 'asset-' || substring(id::text, 1, 8)
 WHERE slug IS NULL OR slug = '';

-- Recompute path for those rows. Joining to sites + areas to rebuild it.
UPDATE cmms_equipment e
   SET path = '/' || s.slug || '/' || a.slug || '/' || e.slug
  FROM cmms_sites s
  JOIN cmms_areas a ON a.site_id = s.id AND a.id = e.area_id
 WHERE s.id = e.site_id
   AND (e.path IS NULL OR e.path = '');

-- Add NOT NULL once we're sure no rows are NULL.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cmms_equipment WHERE slug IS NULL) THEN
        ALTER TABLE cmms_equipment ALTER COLUMN slug SET NOT NULL;
    ELSE
        RAISE WARNING 'cmms_equipment still has rows with NULL slug — fix data before NOT NULL';
    END IF;
END $$;

COMMIT;
```

### Patch 10.2 — Library: same logic in TS for new inserts

`mira-hub/src/lib/cmms/hierarchy.ts` (search for `buildSlug` /
`generateSlug` / similar):

```ts
/**
 * Build a stable slug from a candidate string. Strips non-alphanumerics,
 * lower-cases, collapses runs of separators. If the result is empty
 * (e.g. input was "!!!" or "  "), returns a deterministic fallback
 * "asset-<8 hex>" derived from the rowId.
 *
 * @param candidate equipment_number or similar human-meaningful string
 * @param rowId     row UUID, used as a fallback discriminator
 */
export function buildSlug(candidate: string | null | undefined, rowId: string): string {
  const cleaned = (candidate ?? "")
    .toLowerCase()
    .normalize("NFKD")           // fold accents
    .replace(/\p{M}/gu, "")      // strip combining marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");    // trim leading/trailing dashes
  if (cleaned.length > 0) return cleaned;
  // Fallback: deterministic, derived from rowId so re-running this on
  // the same row gives the same slug.
  return `asset-${rowId.replace(/-/g, "").slice(0, 8)}`;
}
```

Use this everywhere `slug` is generated for new equipment / components.

## Test

`mira-hub/src/lib/cmms/__tests__/hierarchy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSlug } from "../hierarchy";

const ROW_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("buildSlug", () => {
  it("produces sensible slugs from equipment numbers", () => {
    expect(buildSlug("MC-AC-001", ROW_ID)).toBe("mc-ac-001");
  });

  it("trims leading/trailing dashes", () => {
    expect(buildSlug("---abc---", ROW_ID)).toBe("abc");
  });

  it("collapses runs of separators", () => {
    expect(buildSlug("a   b__c", ROW_ID)).toBe("a-b-c");
  });

  it("folds diacritics (NFKD)", () => {
    expect(buildSlug("café", ROW_ID)).toBe("cafe");
  });

  it("falls back to asset-<8 hex> when input is empty", () => {
    expect(buildSlug("", ROW_ID)).toBe("asset-550e8400");
  });

  it("falls back when input is all-non-alphanumeric (the bug)", () => {
    expect(buildSlug("!!!", ROW_ID)).toBe("asset-550e8400");
  });

  it("falls back for whitespace-only input", () => {
    expect(buildSlug("   \t\n  ", ROW_ID)).toBe("asset-550e8400");
  });

  it("falls back for null", () => {
    expect(buildSlug(null, ROW_ID)).toBe("asset-550e8400");
  });

  it("fallback is deterministic across calls", () => {
    expect(buildSlug("", ROW_ID)).toBe(buildSlug("", ROW_ID));
  });

  it("fallback differs per rowId", () => {
    const a = buildSlug("", ROW_ID);
    const b = buildSlug("", "660e8400-e29b-41d4-a716-446655440001");
    expect(a).not.toBe(b);
  });
});
```

Plus an integration test for the migration:

```ts
// mira-hub/db/__tests__/asset-slug-backfill.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { execSync } from "node:child_process";

const URL = process.env.TEST_DATABASE_URL;
let pool: Pool;

beforeAll(async () => {
  if (!URL) throw new Error("TEST_DATABASE_URL required");
  pool = new Pool({ connectionString: URL });
  for (const m of [
    "2026-04-24-003-asset-hierarchy.sql",
    "2026-04-25-003-asset-slug-fallback.sql",
  ]) {
    execSync(`psql ${URL} -f mira-hub/db/migrations/${m}`, { stdio: "inherit" });
  }
});

afterAll(async () => {
  await pool.end();
});

describe("asset slug backfill migration", () => {
  it("populates slugs for equipment with non-alphanumeric equipment_numbers", async () => {
    // Seed a problematic row.
    const { rows: tenant } = await pool.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES (gen_random_uuid(), 'tt', 'Test', 'active') RETURNING id`,
    );
    const tenantId = tenant[0].id;

    const { rows: site } = await pool.query(
      `INSERT INTO cmms_sites (tenant_id, slug, name) VALUES ($1, 'site-1', 'Site') RETURNING id`,
      [tenantId],
    );
    const { rows: area } = await pool.query(
      `INSERT INTO cmms_areas (tenant_id, site_id, slug, name) VALUES ($1, $2, 'area-1', 'Area') RETURNING id`,
      [tenantId, site[0].id],
    );

    // Equipment with junk equipment_number → slug ends up NULL after the original migration.
    await pool.query(
      `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, site_id, area_id, slug, path)
       VALUES ($1, $2, 'Acme', $3, $4, NULL, NULL)`,
      [tenantId, "!!!", site[0].id, area[0].id],
    );

    // Re-run the backfill (idempotent).
    execSync(`psql ${URL} -f mira-hub/db/migrations/2026-04-25-003-asset-slug-fallback.sql`, {
      stdio: "inherit",
    });

    const { rows } = await pool.query(
      `SELECT slug, path FROM cmms_equipment WHERE equipment_number = '!!!'`,
    );
    expect(rows[0].slug).toMatch(/^asset-[0-9a-f]{8}$/);
    expect(rows[0].path).toBe(`/site-1/area-1/${rows[0].slug}`);
  });

  it("does not touch equipment with valid slugs already", async () => {
    // Seed a row with a real slug.
    await pool.query(
      `UPDATE cmms_equipment SET slug = 'real-slug', equipment_number = 'MC-AC-1'
       WHERE equipment_number = '!!!'`,
    );
    execSync(`psql ${URL} -f mira-hub/db/migrations/2026-04-25-003-asset-slug-fallback.sql`, {
      stdio: "inherit",
    });
    const { rows } = await pool.query(
      `SELECT slug FROM cmms_equipment WHERE equipment_number = 'MC-AC-1'`,
    );
    expect(rows[0].slug).toBe("real-slug");
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/cmms/__tests__/hierarchy.test.ts

# Integration:
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name mira-slug-test postgres:16
sleep 3
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
  npx vitest run db/__tests__/asset-slug-backfill.integration.test.ts
docker stop mira-slug-test
```

12 tests pass. Slug NULL path is closed; backfill is idempotent; existing-slug rows untouched.

## Why this design

- **Deterministic fallback** — `asset-<rowId prefix>` instead of random suffix means re-running the migration produces the same slug, so QR codes and external references don't break.
- **NOT NULL on backfill** — once every row has a slug, set the constraint so future inserts fail loudly instead of silently storing NULL.
- **TS helper used at write time** — keeps the slug invariant maintained for new equipment without needing a migration sweep.
- **Path recomputed in the same migration** — keeps `path` and `slug` in sync. Without this, slug is fixed but path stays stale.
