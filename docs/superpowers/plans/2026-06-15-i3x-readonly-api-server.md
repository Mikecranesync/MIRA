# i3X Read-Only API Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose MIRA's approved UNS/KG/live-signal context through the i3X (CESMII) read/query HTTP endpoints, gated to verified + approved-tag data, with writes disabled.

**Architecture:** Thin Next.js App-Router route handlers under `mira-hub/src/app/api/i3x/v1/` call a new **gated data-access layer** (`src/lib/i3x/data-access.ts`) that reads NeonDB through the existing `withTenantContext` RLS path, applies the FAIL-CLOSED approval gate (`approval.ts`), and feeds rows into the **already-shipped pure projection layer** (`src/lib/i3x/*`). Responses are wrapped in i3X `SuccessResponse`/`BulkResponse` envelopes. Auth is a bearer API key resolving to a tenant; `GET /info` requires none. No write paths exist.

**Tech Stack:** TypeScript, Next.js App Router (custom `next` — read `node_modules/next/dist/docs/` before route work), vitest, `node-postgres` via `@/lib/db` + `@/lib/tenant-context`, NeonDB (ltree, RLS), SHA-256 (`node:crypto`) for key hashing.

**Builds on:** `feat/i3x-strategy-research` (the projection layer, commit `001cde74`). Design docs: `docs/research/i3x-strategy-for-factorylm-mira.md`, `docs/architecture/i3x-aligned-ingestion-and-context-model.md`, `docs/implementation/i3x-mvp-plan.md` (this plan is the detailed Phase-2-remainder of that MVP plan).

---

## Scope

**In scope (one coherent, curl-able, testable server):** auth + gated data-access + the i3X **read/query** MUST endpoints: `/info`, `/namespaces`, `/objecttypes` (+`/query`), `/relationshiptypes` (+`/query`), `/objects` (+`/list`), `/objects/related`, `/objects/value`, `/objects/history`. Read-only; `update.*=false`.

**Out of scope — each is its own follow-on plan (do NOT build here):**
- **Subscriptions subsystem** (`/subscriptions/*` create/register/sync/list/delete). MUST for *full* conformance but a distinct stateful subsystem (sequence numbers, TTL, 206-on-overflow). Separate plan. Until then `/info` honestly reports the base capabilities; the server is "1.0 Compatible (read/query)", not "Full 1.0".
- **OPC UA / MQTT ingestion adapters** (architecture doc Layer 1, gap G8).
- **Signal classification pass** (Layer 4, gap G5) — Phase 3 of the MVP plan.
- **CESMII conformance-suite certification run** — Phase 5 of the MVP plan.
- **Per-type JSON Schema enrichment beyond the minimal core set** (gap G1 full closure).

**Constraints carried from doctrine (every task honors these):** read-only (no `PUT`, no plant writes); approved-only (verified entities + allowlisted tags); no historian dependency (history = bounded `tag_events` window); tenant-isolated via RLS; one i3X mapping (reuse the projection layer — do not fork).

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `mira-hub/db/migrations/046_i3x_api_keys.sql` | tenant-scoped, hashed, read-only bearer keys | create |
| `mira-hub/src/lib/i3x/response.ts` | i3X `SuccessResponse`/`BulkResponse`/`ErrorResponse` envelope builders | create |
| `mira-hub/src/lib/i3x/auth.ts` | `Authorization: Bearer` → `{ tenantId }` (or 401) | create |
| `mira-hub/src/lib/i3x/namespaces.ts` | namespace list builder | create |
| `mira-hub/src/lib/i3x/object-types.ts` | minimal JSON-Schema'd ObjectType registry for core entity types | create |
| `mira-hub/src/lib/i3x/data-access.ts` | gated NeonDB reads → projection inputs (entities, parentId, relationships, value, history) | create |
| `mira-hub/src/app/api/i3x/v1/info/route.ts` | `GET /info` (no auth) | create |
| `mira-hub/src/app/api/i3x/v1/namespaces/route.ts` | `GET /namespaces` | create |
| `mira-hub/src/app/api/i3x/v1/objecttypes/route.ts` | `GET /objecttypes` | create |
| `mira-hub/src/app/api/i3x/v1/objecttypes/query/route.ts` | `POST /objecttypes/query` | create |
| `mira-hub/src/app/api/i3x/v1/relationshiptypes/route.ts` | `GET /relationshiptypes` | create |
| `mira-hub/src/app/api/i3x/v1/relationshiptypes/query/route.ts` | `POST /relationshiptypes/query` | create |
| `mira-hub/src/app/api/i3x/v1/objects/route.ts` | `GET /objects` | create |
| `mira-hub/src/app/api/i3x/v1/objects/list/route.ts` | `POST /objects/list` | create |
| `mira-hub/src/app/api/i3x/v1/objects/related/route.ts` | `POST /objects/related` | create |
| `mira-hub/src/app/api/i3x/v1/objects/value/route.ts` | `POST /objects/value` (read), `PUT`→501 | create |
| `mira-hub/src/app/api/i3x/v1/objects/history/route.ts` | `POST /objects/history` (read), `PUT`→501 | create |
| `*.test.ts` beside each lib file | unit tests | create |
| `mira-hub/src/app/api/i3x/v1/__tests__/contract.test.ts` | OpenAPI-shape + e2e gating tests | create |

**Reuse (do not reimplement):** `@/lib/i3x/*` projection layer; `@/lib/session` (`SessionContext`); `@/lib/tenant-context` (`withTenantContext`); `@/lib/db`; existing KG queries in `@/lib/knowledge-graph/queries.ts` if a needed query already exists (check before writing SQL).

---

## Verified ground truth (read before coding)

- `withTenantContext<T>(tenantId: string, fn: (client) => Promise<T>): Promise<T>` — opens a txn, `SET LOCAL ROLE factorylm_app`, sets `app.tenant_id` + `app.current_tenant_id`, runs `fn(client)` where `client.query(sql, params)` is `pg`-style returning `{ rows }`, then COMMIT/ROLLBACK. All tenant reads go through it.
- `kg_entities` (mig 001 + 010): `id UUID, tenant_id UUID, entity_type TEXT, entity_id TEXT, name TEXT, properties JSONB, uns_path LTREE (mig 010), approval_state TEXT (mig 029, default 'proposed')`. **No `parent_id` column** — derive parentId from `uns_path` ancestry.
- `kg_relationships` (mig 001 + 029): `id, tenant_id, source_id, target_id, relationship_type TEXT, properties JSONB, confidence, approval_state TEXT (mig 029)`.
- `approved_tags` (mig 035): `tenant_id UUID, source_system TEXT, source_tag_path TEXT, normalized_tag_path TEXT, uns_path LTREE, enabled BOOLEAN`. The allowlist of exposable tag paths.
- `live_signal_cache` (mig 020 + 036): `tenant_id, plc_tag, uns_path LTREE, last_value_text, last_value_numeric, last_value_bool, last_seen_at, latest_quality, freshness_status, ...`. **No `value_type` column** — infer type from which `last_value_*` column is non-null.
- `tag_events` (mig 033): `tenant_id, uns_path LTREE, tag_path, value TEXT, value_type TEXT, quality TEXT, event_timestamp TIMESTAMPTZ, ...`. Has `value_type`; backs history.
- i3X envelopes (from `api.i3x.dev/v1/openapi.json`):
  - `SuccessResponse<T> = { success: boolean, result: T[] | null }`
  - `ErrorResponse = { success: boolean, responseDetail: { title: string, status: number, detail: string } }`
  - `BulkResponse<T> = { success: boolean, results: BulkResultItem<T>[] }`
  - `BulkResultItem<T> = { success: boolean, elementId?: string | null, result?: T | null, responseDetail?: ErrorDetail | null }`
- Projection layer exports (already shipped, use verbatim): `serverInfo`, `qualityToI3x`, `toVQT`, `toCurrentValueResult`, `toHistoricalValueResult`, `MiraReading`, `isExposable`, `filterExposable`, `filterApprovedTags`, `kgEntityToObjectInstance`, `KgEntity`, `objectTypeElementId`, `MIRA_TYPE_NAMESPACE_URI`, `reverseOf`, `relationshipType`, `listRelationshipTypes`, `relatedFromEdge`, `KgRelationship`.

Run all test commands from `mira-hub/`. The worktree needs `node_modules` (symlink the main checkout's, or `bun install`).

---

## Phase A — Auth + gated data-access foundations

### Task A1: i3X API keys migration

**Files:**
- Create: `mira-hub/db/migrations/046_i3x_api_keys.sql`

> Confirm `046` is the next free number first: `ls mira-hub/db/migrations | sort | tail -3`. If taken, use the next integer and update references.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 046: i3x_api_keys — bearer keys for the read-only i3X API.
-- Each key is tenant-scoped, stores only a SHA-256 hash (never the plaintext),
-- and is read-only by construction (the i3X server has no write paths).
BEGIN;

CREATE TABLE IF NOT EXISTS i3x_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,          -- sha256(hex) of the plaintext key
  label       TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_i3x_api_keys_hash ON i3x_api_keys(key_hash) WHERE enabled;

-- Resolved BEFORE a tenant context exists (the key IS what identifies the
-- tenant), so the lookup runs as owner; do NOT enable RLS on this table.
COMMIT;
```

- [ ] **Step 2: Dry-run then apply on the dev Neon branch**

Run: `gh workflow run apply-migrations.yml -f mode=dry-run -f target=dev` then `-f mode=apply -f target=dev` (per `docs/environments.md`; never hand-edit prod).
Expected: dry-run prints the statement; apply reports success. (If running locally against a dev branch, apply with the Hub's migration runner — never against prod.)

- [ ] **Step 3: Commit**

```bash
git add mira-hub/db/migrations/046_i3x_api_keys.sql
git commit -m "feat(i3x): i3x_api_keys migration (tenant-scoped read-only bearer keys)"
```

### Task A2: Bearer-key auth resolver

**Files:**
- Create: `mira-hub/src/lib/i3x/auth.ts`
- Test: `mira-hub/src/lib/i3x/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { hashKey, resolveTenantFromKeyRow, parseBearer } from "@/lib/i3x/auth";

describe("parseBearer", () => {
  it("extracts the token from an Authorization header", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
  });
  it("is case-insensitive on the scheme", () => {
    expect(parseBearer("bearer abc123")).toBe("abc123");
  });
  it("returns null when missing or malformed", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Basic xyz")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
  });
});

describe("hashKey", () => {
  it("produces a stable lowercase hex sha256", () => {
    expect(hashKey("secret")).toBe(hashKey("secret"));
    expect(hashKey("secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });
});

describe("resolveTenantFromKeyRow", () => {
  it("returns the tenantId for an enabled key row", () => {
    expect(resolveTenantFromKeyRow({ tenant_id: "t1", enabled: true })).toBe("t1");
  });
  it("returns null for a disabled or missing row", () => {
    expect(resolveTenantFromKeyRow({ tenant_id: "t1", enabled: false })).toBeNull();
    expect(resolveTenantFromKeyRow(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/auth.test.ts`
Expected: FAIL — cannot find module `@/lib/i3x/auth`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { createHash } from "node:crypto";
import { query } from "@/lib/db";

/** SHA-256 hex of a plaintext key. Only the hash is ever stored. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

interface KeyRow {
  tenant_id: string;
  enabled: boolean;
}

/** Pure: map a looked-up key row to a tenantId (or null). */
export function resolveTenantFromKeyRow(row: KeyRow | null): string | null {
  return row && row.enabled ? row.tenant_id : null;
}

/**
 * Resolve the tenant for a request from its bearer key. Runs as owner (the key
 * identifies the tenant before any RLS context exists). Returns null on any
 * failure — callers turn that into a 401. NEVER logs the plaintext key.
 */
export async function resolveI3xTenant(req: Request): Promise<string | null> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) return null;
  const { rows } = await query<KeyRow>(
    "SELECT tenant_id, enabled FROM i3x_api_keys WHERE key_hash = $1 LIMIT 1",
    [hashKey(token)],
  );
  return resolveTenantFromKeyRow(rows[0] ?? null);
}
```

> Confirm `@/lib/db` exports `query<T>(sql, params): Promise<{ rows: T[] }>`. If its export differs (e.g. a pool you call `.query` on), adapt this one call to match — check `src/lib/db.ts` before implementing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/auth.test.ts`
Expected: PASS (the pure helpers; `resolveI3xTenant` is covered by the contract test in Phase D).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i3x/auth.ts src/lib/i3x/auth.test.ts
git commit -m "feat(i3x): bearer-key auth resolver (hash-only, tenant-scoped)"
```

### Task A3: Response envelopes

**Files:**
- Create: `mira-hub/src/lib/i3x/response.ts`
- Test: `mira-hub/src/lib/i3x/response.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { successList, bulk, bulkItem, errorBody } from "@/lib/i3x/response";

describe("successList", () => {
  it("wraps an array in { success, result }", () => {
    expect(successList([1, 2])).toEqual({ success: true, result: [1, 2] });
  });
  it("emits result:[] (not null) for an empty list", () => {
    expect(successList([])).toEqual({ success: true, result: [] });
  });
});

describe("bulk / bulkItem", () => {
  it("a successful item carries elementId + result", () => {
    expect(bulkItem("e1", { v: 1 })).toEqual({ success: true, elementId: "e1", result: { v: 1 } });
  });
  it("a not-found item carries an ErrorDetail and success:false", () => {
    const item = bulkItem("e2", null, { title: "Not Found", status: 404, detail: "no such element" });
    expect(item.success).toBe(false);
    expect(item.elementId).toBe("e2");
    expect(item.responseDetail).toEqual({ title: "Not Found", status: 404, detail: "no such element" });
  });
  it("bulk wraps items in { success, results }", () => {
    const b = bulk([bulkItem("e1", { v: 1 })]);
    expect(b.success).toBe(true);
    expect(b.results).toHaveLength(1);
  });
});

describe("errorBody", () => {
  it("builds an i3X ErrorResponse", () => {
    expect(errorBody(401, "Unauthorized", "missing key")).toEqual({
      success: false,
      responseDetail: { title: "Unauthorized", status: 401, detail: "missing key" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/response.test.ts`
Expected: FAIL — cannot find module `@/lib/i3x/response`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface ErrorDetail {
  title: string;
  status: number;
  detail: string;
}

/** SuccessResponse<T> — for the list/query endpoints. */
export function successList<T>(result: T[]): { success: true; result: T[] } {
  return { success: true, result };
}

export interface BulkItem<T> {
  success: boolean;
  elementId: string;
  result?: T | null;
  responseDetail?: ErrorDetail | null;
}

/** One element's result in a bulk response. Pass `detail` for a per-item error. */
export function bulkItem<T>(elementId: string, result: T | null, detail?: ErrorDetail): BulkItem<T> {
  if (detail) return { success: false, elementId, result: null, responseDetail: detail };
  return { success: true, elementId, result };
}

/** BulkResponse<T> — for /objects/value and /objects/history. */
export function bulk<T>(results: BulkItem<T>[]): { success: true; results: BulkItem<T>[] } {
  return { success: true, results };
}

/** ErrorResponse body. */
export function errorBody(status: number, title: string, detail: string) {
  return { success: false, responseDetail: { title, status, detail } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/response.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i3x/response.ts src/lib/i3x/response.test.ts
git commit -m "feat(i3x): SuccessResponse/BulkResponse/ErrorResponse envelope builders"
```

### Task A4: Gated data-access — entities + parentId derivation

**Files:**
- Create: `mira-hub/src/lib/i3x/data-access.ts`
- Test: `mira-hub/src/lib/i3x/data-access.test.ts`

The data-access layer is the single place that touches NeonDB. The SQL-bearing functions take an injected `client` (the `withTenantContext` callback arg) so they unit-test with a fake client — no live DB in unit tests. A pure helper `parentUnsPath` is tested directly.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parentUnsPath, loadEntitiesByIds } from "@/lib/i3x/data-access";

describe("parentUnsPath", () => {
  it("drops the last ltree segment", () => {
    expect(parentUnsPath("enterprise.acme.site.s1.area.a1.equipment.cv101")).toBe(
      "enterprise.acme.site.s1.area.a1.equipment",
    );
  });
  it("returns null for a single-segment or empty path", () => {
    expect(parentUnsPath("enterprise")).toBeNull();
    expect(parentUnsPath("")).toBeNull();
    expect(parentUnsPath(null)).toBeNull();
  });
});

describe("loadEntitiesByIds", () => {
  it("returns ONLY verified entities, with parent_id resolved from ancestry", async () => {
    const fakeRows = [
      { id: "child", entity_type: "equipment", name: "CV-101", approval_state: "verified",
        uns_path: "enterprise.acme.equipment.cv101", properties: {} },
      { id: "hidden", entity_type: "equipment", name: "Secret", approval_state: "proposed",
        uns_path: "enterprise.acme.equipment.secret", properties: {} },
      { id: "parent", entity_type: "area", name: "Area", approval_state: "verified",
        uns_path: "enterprise.acme.equipment", properties: {} },
    ];
    const client = {
      query: async () => ({ rows: fakeRows }),
    };
    const out = await loadEntitiesByIds(client, ["child", "hidden", "parent"]);
    // proposed 'hidden' is filtered out
    expect(out.map((e) => e.id).sort()).toEqual(["child", "parent"]);
    // child's parent_id resolves to the entity whose uns_path is its ancestor
    const child = out.find((e) => e.id === "child")!;
    expect(child.parent_id).toBe("parent");
    // a root (no ancestor present) has null parent_id
    const parent = out.find((e) => e.id === "parent")!;
    expect(parent.parent_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: FAIL — cannot find module `@/lib/i3x/data-access`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { KgEntity, KgRelationship, MiraReading } from "@/lib/i3x";
import { filterExposable } from "@/lib/i3x";

/** Minimal shape of the pg client passed by withTenantContext. */
export interface DbClient {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

/** The ltree parent of a uns_path (drops the last segment), or null at the root. */
export function parentUnsPath(path: string | null): string | null {
  if (!path) return null;
  const i = path.lastIndexOf(".");
  return i <= 0 ? null : path.slice(0, i);
}

interface EntityRow {
  id: string;
  entity_type: string;
  name: string;
  approval_state: string | null;
  uns_path: string | null;
  properties: Record<string, unknown> | null;
}

/**
 * Load verified entities by elementId (kg UUID), resolving parent_id from
 * uns_path ancestry against the same verified result set. Only verified rows
 * are returned AND only verified rows can act as a parent.
 */
export async function loadEntitiesByIds(client: DbClient, ids: string[]): Promise<KgEntity[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query<EntityRow>(
    `SELECT id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
       FROM kg_entities
      WHERE id = ANY($1)`,
    [ids],
  );
  const verified = filterExposable(rows);
  const byPath = new Map<string, string>();
  for (const r of verified) if (r.uns_path) byPath.set(r.uns_path, r.id);

  return verified.map((r) => {
    const parentPath = parentUnsPath(r.uns_path);
    const parent_id = parentPath ? byPath.get(parentPath) ?? null : null;
    return {
      id: r.id,
      entity_type: r.entity_type,
      name: r.name,
      approval_state: r.approval_state,
      uns_path: r.uns_path,
      properties: r.properties,
      parent_id,
    } satisfies KgEntity;
  });
}
```

> Note: parentId resolves only when the ancestor is in the queried set. The route layer's `/objects/list` should also fetch ancestors when present so parentId is populated; for `/objects` (roots/browse) this is acceptable. A fuller ancestor fetch is a refinement, not MVP-blocking.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i3x/data-access.ts src/lib/i3x/data-access.test.ts
git commit -m "feat(i3x): gated data-access — verified entities + parentId from uns_path ancestry"
```

### Task A5: Gated data-access — current value (approved-tag gated)

**Files:**
- Modify: `mira-hub/src/lib/i3x/data-access.ts`
- Test: `mira-hub/src/lib/i3x/data-access.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the existing describe file)**

```typescript
import { readingForElement } from "@/lib/i3x/data-access";

describe("readingForElement — value only for approved tags", () => {
  it("returns a MiraReading when the element's uns_path is approved + cached", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("kg_entities")) {
          return { rows: [{ uns_path: "enterprise.acme.equipment.cv101.datapoint.motor_current" }] };
        }
        if (sql.includes("approved_tags")) {
          return { rows: [{ uns_path: "enterprise.acme.equipment.cv101.datapoint.motor_current" }] };
        }
        // live_signal_cache
        return {
          rows: [{
            uns_path: "enterprise.acme.equipment.cv101.datapoint.motor_current",
            last_value_text: null, last_value_numeric: 8.3, last_value_bool: null,
            latest_quality: "good", freshness_status: "live",
            last_seen_at: "2026-06-14T12:00:00.000Z",
          }],
        };
      },
    };
    const r = await readingForElement(client, "elem-uuid");
    expect(r).not.toBeNull();
    expect(r!.value).toBe(8.3);
    expect(r!.valueType).toBe("float");
    expect(r!.quality).toBe("good");
  });

  it("returns null when the element's uns_path is NOT approved (fail-closed)", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("kg_entities")) return { rows: [{ uns_path: "enterprise.acme.equipment.cv101.datapoint.secret" }] };
        if (sql.includes("approved_tags")) return { rows: [] }; // not allowlisted
        return { rows: [] };
      },
    };
    expect(await readingForElement(client, "elem-uuid")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: FAIL — `readingForElement` not exported.

- [ ] **Step 3: Write minimal implementation (append to data-access.ts)**

```typescript
interface CacheRow {
  uns_path: string | null;
  last_value_text: string | null;
  last_value_numeric: number | null;
  last_value_bool: boolean | null;
  latest_quality: string | null;
  freshness_status: string | null;
  last_seen_at: string;
}

/** Reconstruct a MiraReading from a live_signal_cache row (type inferred by column). */
function cacheRowToReading(row: CacheRow): MiraReading {
  if (row.last_value_bool !== null) {
    return { value: row.last_value_bool, valueType: "bool", quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
  }
  if (row.last_value_numeric !== null) {
    const n = row.last_value_numeric;
    return { value: n, valueType: Number.isInteger(n) ? "int" : "float", quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
  }
  return { value: row.last_value_text, valueType: "string", quality: row.latest_quality ?? "uncertain",
    freshness: row.freshness_status ?? "live", timestamp: row.last_seen_at };
}

/**
 * Current value for an element. Chain: elementId → kg_entities.uns_path →
 * approved_tags (enabled) → live_signal_cache. Returns null if the element is
 * unknown, its tag is not on the allowlist, or there is no cached value.
 */
export async function readingForElement(client: DbClient, elementId: string): Promise<MiraReading | null> {
  const ent = await client.query<{ uns_path: string | null }>(
    "SELECT uns_path::text AS uns_path FROM kg_entities WHERE id = $1 LIMIT 1",
    [elementId],
  );
  const unsPath = ent.rows[0]?.uns_path;
  if (!unsPath) return null;

  const allowed = await client.query<{ uns_path: string }>(
    "SELECT uns_path::text AS uns_path FROM approved_tags WHERE uns_path = $1::ltree AND enabled = true LIMIT 1",
    [unsPath],
  );
  if (allowed.rows.length === 0) return null; // fail-closed

  const cache = await client.query<CacheRow>(
    `SELECT uns_path::text AS uns_path, last_value_text, last_value_numeric, last_value_bool,
            latest_quality, freshness_status, last_seen_at
       FROM live_signal_cache WHERE uns_path = $1::ltree LIMIT 1`,
    [unsPath],
  );
  const row = cache.rows[0];
  return row ? cacheRowToReading(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: PASS (all data-access tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i3x/data-access.ts src/lib/i3x/data-access.test.ts
git commit -m "feat(i3x): current-value data-access (approved-tag gated, type inferred from cache columns)"
```

### Task A6: Gated data-access — history window + relationships

**Files:**
- Modify: `mira-hub/src/lib/i3x/data-access.ts`
- Test: `mira-hub/src/lib/i3x/data-access.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { historyForElement, relationshipsForElement } from "@/lib/i3x/data-access";

describe("historyForElement — bounded tag_events window, approved only", () => {
  it("maps tag_events rows to MiraReadings (value_type carried)", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("kg_entities")) return { rows: [{ uns_path: "enterprise.a.eq.cv.datapoint.cur" }] };
        if (sql.includes("approved_tags")) return { rows: [{ uns_path: "enterprise.a.eq.cv.datapoint.cur" }] };
        return { rows: [
          { value: "8.3", value_type: "float", quality: "good", event_timestamp: "2026-06-14T12:00:00.000Z" },
          { value: "8.5", value_type: "float", quality: "good", event_timestamp: "2026-06-14T12:01:00.000Z" },
        ] };
      },
    };
    const out = await historyForElement(client, "elem", { startTime: null, endTime: null, limit: 1000 });
    expect(out).toHaveLength(2);
    expect(out[0].valueType).toBe("float");
  });
  it("returns [] for an unapproved element", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("kg_entities")) return { rows: [{ uns_path: "x" }] };
        if (sql.includes("approved_tags")) return { rows: [] };
        return { rows: [] };
      },
    };
    expect(await historyForElement(client, "elem", { startTime: null, endTime: null, limit: 1000 })).toEqual([]);
  });
});

describe("relationshipsForElement — verified edges touching the element", () => {
  it("returns only verified edges where the element is source or target", async () => {
    const client = {
      query: async () => ({ rows: [
        { source_id: "elem", target_id: "motor", relationship_type: "has_component", approval_state: "verified" },
      ] }),
    };
    const edges = await relationshipsForElement(client, "elem");
    expect(edges).toHaveLength(1);
    expect(edges[0].relationship_type).toBe("has_component");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: FAIL — `historyForElement` / `relationshipsForElement` not exported.

- [ ] **Step 3: Write minimal implementation (append)**

```typescript
interface EventRow {
  value: string | null;
  value_type: string | null;
  quality: string | null;
  event_timestamp: string;
}

/** Bounded history window for an element (approved-tag gated). */
export async function historyForElement(
  client: DbClient,
  elementId: string,
  opts: { startTime: string | null; endTime: string | null; limit: number },
): Promise<MiraReading[]> {
  const ent = await client.query<{ uns_path: string | null }>(
    "SELECT uns_path::text AS uns_path FROM kg_entities WHERE id = $1 LIMIT 1",
    [elementId],
  );
  const unsPath = ent.rows[0]?.uns_path;
  if (!unsPath) return [];
  const allowed = await client.query(
    "SELECT 1 FROM approved_tags WHERE uns_path = $1::ltree AND enabled = true LIMIT 1",
    [unsPath],
  );
  if (allowed.rows.length === 0) return [];

  const { rows } = await client.query<EventRow>(
    `SELECT value, value_type, quality, event_timestamp
       FROM tag_events
      WHERE uns_path = $1::ltree
        AND ($2::timestamptz IS NULL OR event_timestamp >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR event_timestamp <= $3::timestamptz)
      ORDER BY event_timestamp ASC
      LIMIT $4`,
    [unsPath, opts.startTime, opts.endTime, opts.limit],
  );
  return rows.map((r) => ({
    value: r.value,
    valueType: (r.value_type ?? "string") as MiraReading["valueType"],
    quality: r.quality ?? "uncertain",
    freshness: "live",
    timestamp: r.event_timestamp,
  }));
}

/** Verified relationship edges where the element is source OR target. */
export async function relationshipsForElement(client: DbClient, elementId: string): Promise<KgRelationship[]> {
  const { rows } = await client.query<KgRelationship & { approval_state: string }>(
    `SELECT source_id, target_id, relationship_type, approval_state
       FROM kg_relationships
      WHERE (source_id = $1 OR target_id = $1)`,
    [elementId],
  );
  return filterExposable(rows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/data-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i3x/data-access.ts src/lib/i3x/data-access.test.ts
git commit -m "feat(i3x): history-window + verified-relationship data-access"
```

---

## Phase B — Registry endpoints (namespaces, object types, relationship types, info)

### Task B1: Namespace builder + `GET /namespaces`

**Files:**
- Create: `mira-hub/src/lib/i3x/namespaces.ts`
- Test: `mira-hub/src/lib/i3x/namespaces.test.ts`
- Create: `mira-hub/src/app/api/i3x/v1/namespaces/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { listNamespaces } from "@/lib/i3x/namespaces";
import { MIRA_TYPE_NAMESPACE_URI } from "@/lib/i3x";

describe("listNamespaces", () => {
  it("includes the MIRA type namespace with a unique uri (i3X MUST: >=1 namespace)", () => {
    const ns = listNamespaces();
    expect(ns.length).toBeGreaterThan(0);
    const uris = ns.map((n) => n.uri);
    expect(uris).toContain(MIRA_TYPE_NAMESPACE_URI);
    expect(new Set(uris).size).toBe(uris.length); // unique
    for (const n of ns) expect(n.displayName).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/namespaces.test.ts`
Expected: FAIL — cannot find module `@/lib/i3x/namespaces`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Namespace } from "@/lib/i3x";
import { MIRA_TYPE_NAMESPACE_URI } from "@/lib/i3x";

/** The namespaces the server exposes. MVP: the MIRA type vocabulary namespace. */
export function listNamespaces(): Namespace[] {
  return [{ uri: MIRA_TYPE_NAMESPACE_URI, displayName: "MIRA Industrial Types" }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/namespaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the route handler**

```typescript
// mira-hub/src/app/api/i3x/v1/namespaces/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listNamespaces } from "@/lib/i3x/namespaces";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  return NextResponse.json(successList(listNamespaces()));
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/i3x/namespaces.ts src/lib/i3x/namespaces.test.ts src/app/api/i3x/v1/namespaces/route.ts
git commit -m "feat(i3x): GET /namespaces"
```

### Task B2: ObjectType registry + `GET /objecttypes` (+ `/query`)

**Files:**
- Create: `mira-hub/src/lib/i3x/object-types.ts`
- Test: `mira-hub/src/lib/i3x/object-types.test.ts`
- Create: `mira-hub/src/app/api/i3x/v1/objecttypes/route.ts`
- Create: `mira-hub/src/app/api/i3x/v1/objecttypes/query/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { listObjectTypes } from "@/lib/i3x/object-types";
import { MIRA_TYPE_NAMESPACE_URI, objectTypeElementId } from "@/lib/i3x";

describe("listObjectTypes", () => {
  it("includes core types each with a JSON Schema + namespace (i3X MUST)", () => {
    const types = listObjectTypes();
    const ids = types.map((t) => t.elementId);
    expect(ids).toContain(objectTypeElementId("equipment"));
    expect(ids).toContain(objectTypeElementId("component"));
    expect(ids).toContain(objectTypeElementId("datapoint"));
    for (const t of types) {
      expect(t.namespaceUri).toBe(MIRA_TYPE_NAMESPACE_URI);
      expect(t.schema).toBeTruthy();
      expect(t.schema.type).toBe("object"); // a real JSON Schema
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i3x/object-types.test.ts`
Expected: FAIL — cannot find module `@/lib/i3x/object-types`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ObjectTypeResponse } from "@/lib/i3x";
import { MIRA_TYPE_NAMESPACE_URI, objectTypeElementId } from "@/lib/i3x";

/** Minimal core object types with hand-authored JSON Schemas (gap G1, MVP slice). */
const CORE_TYPES: ReadonlyArray<{ type: string; display: string; schema: Record<string, unknown> }> = [
  { type: "equipment", display: "Equipment",
    schema: { type: "object", properties: { name: { type: "string" }, uns_path: { type: "string" } } } },
  { type: "component", display: "Component",
    schema: { type: "object", properties: { name: { type: "string" }, uns_path: { type: "string" } } } },
  { type: "datapoint", display: "Datapoint (live signal)",
    schema: { type: "object", properties: { value: {}, quality: { type: "string" }, timestamp: { type: "string" } } } },
  { type: "fault_code", display: "Fault Code",
    schema: { type: "object", properties: { code: { type: "string" }, description: { type: "string" } } } },
];

export function listObjectTypes(): ObjectTypeResponse[] {
  return CORE_TYPES.map((t) => ({
    elementId: objectTypeElementId(t.type),
    displayName: t.display,
    namespaceUri: MIRA_TYPE_NAMESPACE_URI,
    sourceTypeId: t.type,
    schema: t.schema,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i3x/object-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Write both route handlers**

```typescript
// mira-hub/src/app/api/i3x/v1/objecttypes/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listObjectTypes } from "@/lib/i3x/object-types";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  return NextResponse.json(successList(listObjectTypes()));
}
```

```typescript
// mira-hub/src/app/api/i3x/v1/objecttypes/query/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listObjectTypes } from "@/lib/i3x/object-types";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

// MVP: query echoes the full list (filtering by body.elementIds is a refinement).
export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.elementIds) ? body.elementIds : undefined;
  const all = listObjectTypes();
  return NextResponse.json(successList(ids ? all.filter((t) => ids.includes(t.elementId)) : all));
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/i3x/object-types.ts src/lib/i3x/object-types.test.ts src/app/api/i3x/v1/objecttypes/route.ts src/app/api/i3x/v1/objecttypes/query/route.ts
git commit -m "feat(i3x): GET /objecttypes (+ /query) with minimal JSON-Schema'd core types"
```

### Task B3: `GET /relationshiptypes` (+ `/query`)

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/relationshiptypes/route.ts`
- Create: `mira-hub/src/app/api/i3x/v1/relationshiptypes/query/route.ts`

(No new lib — reuses `listRelationshipTypes()` from the projection layer, already tested.)

- [ ] **Step 1: Write the GET handler**

```typescript
// mira-hub/src/app/api/i3x/v1/relationshiptypes/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listRelationshipTypes } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  return NextResponse.json(successList(listRelationshipTypes()));
}
```

- [ ] **Step 2: Write the POST /query handler**

```typescript
// mira-hub/src/app/api/i3x/v1/relationshiptypes/query/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { listRelationshipTypes } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.elementIds) ? body.elementIds : undefined;
  const all = listRelationshipTypes();
  return NextResponse.json(successList(ids ? all.filter((t) => ids.includes(t.elementId)) : all));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/i3x/v1/relationshiptypes/route.ts src/app/api/i3x/v1/relationshiptypes/query/route.ts
git commit -m "feat(i3x): GET /relationshiptypes (+ /query)"
```

### Task B4: `GET /info` (no auth)

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/info/route.ts`

- [ ] **Step 1: Write the handler (note: NO auth — i3X MUST NOT require auth on /info)**

```typescript
// mira-hub/src/app/api/i3x/v1/info/route.ts
import { NextResponse } from "next/server";
import { serverInfo } from "@/lib/i3x";

export const dynamic = "force-dynamic";

// i3X requires /info to be reachable WITHOUT authentication.
export async function GET() {
  return NextResponse.json({ success: true, result: serverInfo() });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/i3x/v1/info/route.ts
git commit -m "feat(i3x): GET /info (no auth, capabilities update.*=false)"
```

---

## Phase C — Object + value + history endpoints

### Task C1: `POST /objects/list` and `GET /objects`

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/objects/list/route.ts`
- Create: `mira-hub/src/app/api/i3x/v1/objects/route.ts`

- [ ] **Step 1: Write `POST /objects/list`**

```typescript
// mira-hub/src/app/api/i3x/v1/objects/list/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { loadEntitiesByIds } from "@/lib/i3x/data-access";
import { kgEntityToObjectInstance } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  const entities = await withTenantContext(tenantId, (c) => loadEntitiesByIds(c, ids));
  return NextResponse.json(successList(entities.map(kgEntityToObjectInstance)));
}
```

- [ ] **Step 2: Write `GET /objects` (root browse — verified roots)**

```typescript
// mira-hub/src/app/api/i3x/v1/objects/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { kgEntityToObjectInstance } from "@/lib/i3x";
import { filterExposable } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";
import { parentUnsPath } from "@/lib/i3x/data-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const rows = await withTenantContext(tenantId, (c) =>
    c.query<{ id: string; entity_type: string; name: string; approval_state: string | null; uns_path: string | null; properties: Record<string, unknown> | null }>(
      `SELECT id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
         FROM kg_entities WHERE approval_state = 'verified' ORDER BY uns_path NULLS LAST LIMIT 500`,
    ).then((r) => r.rows),
  );
  const verified = filterExposable(rows);
  const byPath = new Map(verified.filter((r) => r.uns_path).map((r) => [r.uns_path as string, r.id]));
  const objects = verified.map((r) => {
    const pp = parentUnsPath(r.uns_path);
    return kgEntityToObjectInstance({ ...r, parent_id: pp ? byPath.get(pp) ?? null : null });
  });
  return NextResponse.json(successList(objects));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/i3x/v1/objects/list/route.ts src/app/api/i3x/v1/objects/route.ts
git commit -m "feat(i3x): GET /objects + POST /objects/list (verified entities, parentId resolved)"
```

### Task C2: `POST /objects/related`

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/objects/related/route.ts`

- [ ] **Step 1: Write the handler (bidirectional, via projection `relatedFromEdge`)**

```typescript
// mira-hub/src/app/api/i3x/v1/objects/related/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { relationshipsForElement, loadEntitiesByIds } from "@/lib/i3x/data-access";
import { kgEntityToObjectInstance, relatedFromEdge } from "@/lib/i3x";
import { successList, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  const relFilter: string | null = typeof body?.relationshipType === "string" ? body.relationshipType : null;

  const results = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const edges = await relationshipsForElement(c, id);
      const otherIds = edges.map((e) => (e.source_id === id ? e.target_id : e.source_id));
      const others = await loadEntitiesByIds(c, otherIds); // verified-only
      const byId = new Map(others.map((o) => [o.id, kgEntityToObjectInstance(o)]));
      for (const e of edges) {
        const r = relatedFromEdge(e, id, byId);
        if (r && (!relFilter || r.sourceRelationship === relFilter)) out.push(r);
      }
    }
    return out;
  });
  return NextResponse.json(successList(results));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/i3x/v1/objects/related/route.ts
git commit -m "feat(i3x): POST /objects/related (verified edges, bidirectional, verified targets only)"
```

### Task C3: `POST /objects/value` (read) + `PUT`→501

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/objects/value/route.ts`

- [ ] **Step 1: Write the handler (bulk current values; PUT explicitly 501 — writes disabled)**

```typescript
// mira-hub/src/app/api/i3x/v1/objects/value/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { readingForElement } from "@/lib/i3x/data-access";
import { toCurrentValueResult } from "@/lib/i3x";
import { bulk, bulkItem, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];

  const items = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const reading = await readingForElement(c, id);
      if (reading) out.push(bulkItem(id, toCurrentValueResult(reading)));
      else out.push(bulkItem(id, null, { title: "Not Found", status: 404, detail: "no approved value for element" }));
    }
    return out;
  });
  return NextResponse.json(bulk(items));
}

// Writes are disabled (read-only doctrine; i3X update.current=false).
export async function PUT() {
  return NextResponse.json(errorBody(501, "Not Implemented", "i3X writes are disabled on this server"), { status: 501 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/i3x/v1/objects/value/route.ts
git commit -m "feat(i3x): POST /objects/value (approved current values); PUT -> 501 (writes disabled)"
```

### Task C4: `POST /objects/history` (read) + `PUT`→501

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/objects/history/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
// mira-hub/src/app/api/i3x/v1/objects/history/route.ts
import { NextResponse } from "next/server";
import { resolveI3xTenant } from "@/lib/i3x/auth";
import { withTenantContext } from "@/lib/tenant-context";
import { historyForElement } from "@/lib/i3x/data-access";
import { toHistoricalValueResult } from "@/lib/i3x";
import { bulk, bulkItem, errorBody } from "@/lib/i3x/response";

export const dynamic = "force-dynamic";

const MAX_POINTS = 5000; // bounded tag_events window; no historian dependency

export async function POST(req: Request) {
  const tenantId = await resolveI3xTenant(req);
  if (!tenantId) return NextResponse.json(errorBody(401, "Unauthorized", "valid bearer key required"), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.elementIds) ? body.elementIds : [];
  const startTime: string | null = typeof body?.startTime === "string" ? body.startTime : null;
  const endTime: string | null = typeof body?.endTime === "string" ? body.endTime : null;

  const items = await withTenantContext(tenantId, async (c) => {
    const out = [];
    for (const id of ids) {
      const readings = await historyForElement(c, id, { startTime, endTime, limit: MAX_POINTS });
      out.push(bulkItem(id, toHistoricalValueResult(readings)));
    }
    return out;
  });
  return NextResponse.json(bulk(items));
}

export async function PUT() {
  return NextResponse.json(errorBody(501, "Not Implemented", "i3X writes are disabled on this server"), { status: 501 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/i3x/v1/objects/history/route.ts
git commit -m "feat(i3x): POST /objects/history (bounded tag_events window); PUT -> 501"
```

---

## Phase D — Integration tests, conformance shaping, ship

### Task D1: Contract + gating integration tests

**Files:**
- Create: `mira-hub/src/app/api/i3x/v1/__tests__/contract.test.ts`

These call the route handlers directly with mocked auth + a fake tenant client to prove: (a) /info needs no auth and reports writes-off; (b) every other endpoint 401s without a key; (c) proposed entities and unapproved tags never appear; (d) PUT → 501.

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it, vi } from "vitest";

// Mock auth: no header => null (401); "Bearer good" => tenant "t1".
vi.mock("@/lib/i3x/auth", () => ({
  resolveI3xTenant: async (req: Request) =>
    req.headers.get("authorization") === "Bearer good" ? "t1" : null,
}));

import { GET as info } from "@/app/api/i3x/v1/info/route";
import { GET as namespaces } from "@/app/api/i3x/v1/namespaces/route";
import { PUT as valuePut } from "@/app/api/i3x/v1/objects/value/route";

const authed = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { authorization: "Bearer good", ...(init.headers || {}) } });

describe("/info is open and read-only", () => {
  it("returns capabilities with writes disabled, no auth needed", async () => {
    const res = await info();
    const body = await res.json();
    expect(body.result.capabilities.update.current).toBe(false);
    expect(body.result.capabilities.update.history).toBe(false);
  });
});

describe("auth gating", () => {
  it("401s /namespaces without a bearer key", async () => {
    const res = await namespaces(new Request("http://x/api/i3x/v1/namespaces"));
    expect(res.status).toBe(401);
  });
  it("serves /namespaces with a valid key", async () => {
    const res = await namespaces(authed("http://x/api/i3x/v1/namespaces"));
    expect(res.status).toBe(200);
  });
});

describe("writes disabled", () => {
  it("PUT /objects/value returns 501", async () => {
    const res = await valuePut();
    expect(res.status).toBe(501);
  });
});
```

> The approval-gating assertions (proposed entities / unapproved tags never surface) are already proven at the unit level in `data-access.test.ts`. Add a route-level case here only if you wire a fake `withTenantContext` (mock `@/lib/tenant-context`) — keep it if cheap, skip if it balloons setup.

- [ ] **Step 2: Run test to verify it fails, then passes as routes land**

Run: `npx vitest run src/app/api/i3x/v1/__tests__/contract.test.ts`
Expected: PASS once Phase B/C routes exist (FAIL earlier on missing imports).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/i3x/v1/__tests__/contract.test.ts
git commit -m "test(i3x): contract tests — /info open+read-only, auth gating, writes 501"
```

### Task D2: OpenAPI-shape validation (optional-but-recommended)

**Files:**
- Modify: `mira-hub/src/app/api/i3x/v1/__tests__/contract.test.ts` (append)

- [ ] **Step 1: Add a shape check against the published schema**

Download once into the repo as a fixture (not a network call in CI): `curl -fsSL https://api.i3x.dev/v1/openapi.json -o src/app/api/i3x/v1/__tests__/openapi.fixture.json`. Then assert key response objects have the required fields (`success` on every envelope; `ObjectInstanceResponse` has `elementId/displayName/typeElementId/isComposition`; `VQT` quality ∈ the four values). Keep it a structural check, not a full JSON-Schema validator, unless `ajv` is already a dep.

```typescript
import fixture from "./openapi.fixture.json";
it("the published spec still defines the envelopes we target", () => {
  const schemas = (fixture as any).components.schemas;
  expect(schemas.VQT.properties.quality.description).toMatch(/Good.*Bad.*Uncertain/);
  expect(schemas.ObjectInstanceResponse.required).toEqual(
    expect.arrayContaining(["elementId", "displayName", "typeElementId", "isComposition"]),
  );
});
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run src/app/api/i3x/v1/__tests__/contract.test.ts
git add src/app/api/i3x/v1/__tests__/
git commit -m "test(i3x): pin response shapes against the published OpenAPI fixture"
```

### Task D3: Full suite, version bumps, docs, push

- [ ] **Step 1: Run the full i3x suite + bare suite (prove CI discovery)**

Run: `npx vitest run src/lib/i3x/ src/app/api/i3x/` then `npx vitest run 2>&1 | grep -c i3x`
Expected: all i3x tests pass; the bare run discovers them (count > 0).

- [ ] **Step 2: Typecheck the new module**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'i3x'`
Expected: `0`.

- [ ] **Step 3: Bump versions (required gates)**

```bash
# root version counter (required "Version Bump Check")
printf '3.20.0\n' > ../VERSION   # confirm current with `cat ../VERSION` first; bump minor
# Hub package.json (AGENTS.md convention)
# edit mira-hub/package.json "version" -> next minor
```

- [ ] **Step 4: Update the MVP plan's Phase 2 status + the i3X strategy doc**

Edit `docs/implementation/i3x-mvp-plan.md` Phase 2 → mark the read/query server done, link this plan. Note subscriptions remain (separate plan) so `/info` is "1.0 Compatible (read/query)".

- [ ] **Step 5: Commit + push the branch (no PR unless asked)**

```bash
git add ../VERSION mira-hub/package.json docs/implementation/i3x-mvp-plan.md
git commit -m "chore(i3x): version bumps + MVP-plan Phase 2 status for the read-only API server"
git push
```

---

## Risks & mitigations

- **Custom Next.js** (`mira-hub/AGENTS.md`: "This is NOT the Next.js you know"). Read `node_modules/next/dist/docs/` before writing route handlers; route-segment config (`dynamic`, `runtime`) and the `Request`/`NextResponse` API may differ from training data. Mitigate by copying the exact shape of an existing `src/app/api/*/route.ts`.
- **`@/lib/db` export shape** (Task A2/A6 assume `query<T>(sql, params)`). Verify against `src/lib/db.ts` and adapt the one call; everything else goes through `withTenantContext`'s client.
- **parentId completeness** — resolves only when the ancestor is in the queried set (Task A4 note). Acceptable for MVP; a recursive ancestor fetch is a follow-up, not a blocker.
- **ltree equality on `uns_path`** — comparisons cast text to `::ltree`. Confirm `approved_tags.uns_path` and `live_signal_cache.uns_path` are populated for the tags you test (they're nullable). A datapoint with no `uns_path` is correctly invisible (fail-closed).
- **Subscriptions are MUST for FULL conformance** — this server is honestly "1.0 Compatible (read/query)" until the subscriptions plan lands. `/info` reflects reality; don't claim Full 1.0.
- **No prod writes / no prod DB from a code session** — migrations go dev→staging→prod via `apply-migrations.yml`; never psql prod.

## What NOT to do

- ❌ Add any code path that mutates plant data or the KG via i3X. PUT stays 501.
- ❌ Expose `proposed`/`rejected`/`needs_review` entities or non-allowlisted tags — even "just for a demo."
- ❌ Fork the projection mapping — all shaping goes through `@/lib/i3x/*`.
- ❌ Build subscriptions, OPC UA, or classification here — separate plans.
- ❌ Authenticate `/info` (i3X MUST NOT require auth there).
- ❌ Bypass `withTenantContext` for tenant reads (RLS isolation).
- ❌ Log plaintext bearer keys.

---

## Self-review

- **Spec coverage:** every in-scope MUST read/query endpoint has a task — `/info` (B4), `/namespaces` (B1), `/objecttypes`+`/query` (B2), `/relationshiptypes`+`/query` (B3), `/objects` + `/objects/list` (C1), `/objects/related` (C2), `/objects/value` (C3), `/objects/history` (C4). Auth (A2), envelopes (A3), gated data-access (A4–A6), migration (A1), tests (D1–D2), ship (D3). Subscriptions explicitly deferred with rationale.
- **Placeholder scan:** no "TBD"/"handle errors"/"similar to Task N" — every code step shows complete code; repeated route boilerplate is written out per task.
- **Type consistency:** route handlers use the exact projection exports (`kgEntityToObjectInstance`, `toCurrentValueResult`, `toHistoricalValueResult`, `relatedFromEdge`, `listRelationshipTypes`, `serverInfo`) and the `KgEntity`/`KgRelationship`/`MiraReading` shapes from the shipped layer; data-access returns those shapes; envelope builders (`successList`/`bulk`/`bulkItem`/`errorBody`) are used identically across handlers.
- **Known soft spots flagged, not hidden:** parentId completeness (A4 note), `@/lib/db` shape (A2 note), bulk-envelope exactness (validated in D2), conformance tier honesty (risks).
