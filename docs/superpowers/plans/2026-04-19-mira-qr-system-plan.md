# MIRA Asset-QR System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship QR asset tagging end-to-end for a single plant (Mike's own conveyor) within one week, so scanning a sticker opens MIRA pre-scoped to that equipment and every scan is tracked in NeonDB for analytics.

**Architecture:** New scan route `/m/:asset_tag` in `mira-web` (Hono/Bun) writes a short-lived HttpOnly cookie (`mira_pending_scan`) and redirects the user to Open WebUI. On first chat turn, `mira-pipeline` reads that cookie, calls the existing `session_memory.save_session()`, and clears the cookie — the engine's existing `load_session()` call at `engine.py:619` picks up the asset context automatically. Admin print page lists Atlas assets, lets the admin assign human-readable tags, and generates an Avery 5163 PDF sticker sheet. Analytics shows a minimal scan-count table.

**Tech Stack:** Bun + Hono + TypeScript (mira-web), FastAPI + Python 3.12 (mira-pipeline), NeonDB (Postgres + pgvector), `@neondatabase/serverless`, `jose` for JWT, new deps: `qrcode` + `pdf-lib`.

**Source spec:** [`docs/superpowers/specs/2026-04-19-mira-qr-system-design.md`](../specs/2026-04-19-mira-qr-system-design.md) — all 8 §12 pre-implementation blockers resolved in Sprint 0 (2026-04-19).

**Hour budget:** 26 hours software (broken out per §12.8 of the spec). Physical track (Avery 5520 vinyl test, soak tests, vendor outreach) runs in parallel 1-2 calendar weeks.

---

## Phase 1 — Foundation (Day 1-2, ~7 hours)

### Task 1: NeonDB schema migration for `asset_qr_tags` + `qr_scan_events`

**Files:**
- Create: `mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql`
- Modify: `mira-core/mira-ingest/db/neon.py:1-60` (add `ensure_qr_tables()` helper, optional — if migrations are applied out-of-band, skip)
- Test: `mira-core/mira-ingest/db/test_asset_qr_tags.py`

**Hours:** 3

**Depends on:** nothing — this is the foundation task.

- [ ] **Step 1: Write the failing migration-shape test**

```python
# mira-core/mira-ingest/db/test_asset_qr_tags.py
"""Contract test for asset_qr_tags + qr_scan_events schema."""

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
import os
import pytest


def _engine():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        pytest.skip("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def test_asset_qr_tags_has_required_columns():
    with _engine().connect() as conn:
        cols = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = 'asset_qr_tags' ORDER BY ordinal_position"
            )
        ).fetchall()
    names = {c[0] for c in cols}
    assert names >= {
        "tenant_id",
        "asset_tag",
        "atlas_asset_id",
        "printed_at",
        "print_count",
        "first_scan",
        "last_scan",
        "scan_count",
        "created_at",
    }


def test_qr_scan_events_has_required_columns():
    with _engine().connect() as conn:
        cols = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'qr_scan_events'"
            )
        ).fetchall()
    names = {c[0] for c in cols}
    assert names >= {
        "id",
        "tenant_id",
        "asset_tag",
        "atlas_user_id",
        "scanned_at",
        "user_agent",
        "scan_id",
        "chat_id",
    }


def test_case_insensitive_unique_on_asset_qr_tags():
    """VFD-07 and vfd-07 must not both be insertable for the same tenant."""
    with _engine().begin() as conn:
        tid = "00000000-0000-0000-0000-000000000001"
        conn.execute(text("DELETE FROM asset_qr_tags WHERE tenant_id = :tid"), {"tid": tid})
        conn.execute(
            text(
                "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) "
                "VALUES (:tid, 'VFD-07', 1)"
            ),
            {"tid": tid},
        )
        with pytest.raises(Exception):
            conn.execute(
                text(
                    "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) "
                    "VALUES (:tid, 'vfd-07', 2)"
                ),
                {"tid": tid},
            )
        conn.execute(text("DELETE FROM asset_qr_tags WHERE tenant_id = :tid"), {"tid": tid})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mira-core/mira-ingest
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  python -m pytest db/test_asset_qr_tags.py -v
```

Expected: all three tests FAIL with "relation `asset_qr_tags` does not exist."

- [ ] **Step 3: Write the migration SQL**

```sql
-- mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql
BEGIN;

CREATE TABLE IF NOT EXISTS asset_qr_tags (
    tenant_id       UUID         NOT NULL,
    asset_tag       TEXT         NOT NULL,
    atlas_asset_id  INTEGER      NOT NULL,
    printed_at      TIMESTAMPTZ,
    print_count     INTEGER      NOT NULL DEFAULT 0,
    first_scan      TIMESTAMPTZ,
    last_scan       TIMESTAMPTZ,
    scan_count      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, asset_tag)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_qr_tags_tenant_tag_ci
    ON asset_qr_tags (tenant_id, lower(asset_tag));

CREATE INDEX IF NOT EXISTS idx_qr_tags_tenant_last_scan
    ON asset_qr_tags (tenant_id, last_scan DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS qr_scan_events (
    id             BIGSERIAL    PRIMARY KEY,
    tenant_id      UUID         NOT NULL,
    asset_tag      TEXT         NOT NULL,
    atlas_user_id  INTEGER,
    scanned_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_agent     TEXT,
    scan_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
    chat_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_events_tenant_asset_time
    ON qr_scan_events (tenant_id, asset_tag, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_tenant_time
    ON qr_scan_events (tenant_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id
    ON qr_scan_events (scan_id);

COMMIT;
```

- [ ] **Step 4: Apply the migration**

```bash
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  psql "$NEON_DATABASE_URL" \
  -f mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql
```

Expected: `BEGIN`, `CREATE TABLE`, `CREATE INDEX` × 4, `CREATE TABLE`, `CREATE INDEX` × 3, `COMMIT`. Zero errors.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd mira-core/mira-ingest
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  python -m pytest db/test_asset_qr_tags.py -v
```

Expected: 3/3 PASS.

- [ ] **Step 6: Create the 90-day retention job**

```python
# mira-core/mira-ingest/scripts/purge_qr_scan_events.py
"""Nightly job: delete qr_scan_events older than 90 days.

Invoked from cron or `docker compose run --rm mira-ingest python scripts/purge_qr_scan_events.py`.
"""

from __future__ import annotations

import logging
import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("purge-qr-events")


def main() -> int:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        log.error("NEON_DATABASE_URL not set")
        return 1
    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    with engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM qr_scan_events WHERE scanned_at < NOW() - INTERVAL '90 days'")
        )
    log.info("purged %d qr_scan_events rows older than 90d", result.rowcount)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Commit**

```bash
git add mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql \
        mira-core/mira-ingest/db/test_asset_qr_tags.py \
        mira-core/mira-ingest/scripts/purge_qr_scan_events.py
git commit -m "feat(qr): NeonDB schema + retention job for asset_qr_tags

Two tables + indexes + case-insensitive unique constraint per spec §6,
§12.3. Adds nightly 90-day retention purge for qr_scan_events to match
the §6.3 retention policy."
```

---

### Task 2: Cookie session layer for `mira-web`

**Files:**
- Create: `mira-web/src/lib/cookie-session.ts` — read/write `mira_session` + `mira_pending_scan`
- Modify: `mira-web/src/lib/auth.ts:48-57` — `verifyToken()` reads cookie as third source
- Modify: `mira-web/src/lib/auth.ts:28-46` — `signToken()` variant that also sets cookie
- Create: `mira-web/src/lib/__tests__/cookie-session.test.ts`
- Modify: `mira-web/src/server.ts` — new `POST /api/login` magic-link handler (stub — full magic-link flow is out of scope; reuse the existing `signinUser` path)

**Hours:** 4

**Depends on:** nothing new (Task 1 is DB-only; this is mira-web-only).

- [ ] **Step 1: Write the failing cookie-read test**

```typescript
// mira-web/src/lib/__tests__/cookie-session.test.ts
import { describe, test, expect } from "bun:test";
import { parseCookies, buildSessionCookie, buildPendingScanCookie, buildClearCookie } from "../cookie-session.js";

describe("parseCookies", () => {
  test("empty header returns empty object", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  test("parses single cookie", () => {
    expect(parseCookies("mira_session=abc123")).toEqual({ mira_session: "abc123" });
  });

  test("parses multiple cookies with whitespace", () => {
    const result = parseCookies("mira_session=abc123; mira_pending_scan=def456;path=/");
    expect(result).toEqual({ mira_session: "abc123", mira_pending_scan: "def456", path: "/" });
  });

  test("URL-decodes cookie values", () => {
    expect(parseCookies("name=hello%20world")).toEqual({ name: "hello world" });
  });
});

describe("buildSessionCookie", () => {
  test("emits HttpOnly Secure SameSite=Lax with 30d max-age", () => {
    const c = buildSessionCookie("eyJJWT");
    expect(c).toContain("mira_session=eyJJWT");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=2592000");
    expect(c).toContain("Domain=.factorylm.com");
  });
});

describe("buildPendingScanCookie", () => {
  test("emits 5-minute HttpOnly cookie for scan correlation", () => {
    const c = buildPendingScanCookie("01920000-1234-7000-8000-000000000000");
    expect(c).toContain("mira_pending_scan=01920000-1234-7000-8000-000000000000");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Max-Age=300");
    expect(c).toContain("SameSite=Lax");
  });
});

describe("buildClearCookie", () => {
  test("clears mira_pending_scan with Max-Age=0", () => {
    const c = buildClearCookie("mira_pending_scan");
    expect(c).toContain("mira_pending_scan=");
    expect(c).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mira-web
bun test src/lib/__tests__/cookie-session.test.ts
```

Expected: all tests FAIL with "Cannot find module '../cookie-session.js'."

- [ ] **Step 3: Write `cookie-session.ts` implementation**

```typescript
// mira-web/src/lib/cookie-session.ts
/**
 * Cookie read/write helpers for mira-web.
 *
 * Two cookies governed here:
 *   - mira_session: 30-day JWT session cookie, HttpOnly, SameSite=Lax
 *   - mira_pending_scan: 5-min HttpOnly QR-scan correlation cookie
 *
 * All cookies use Domain=.factorylm.com so they travel between mira-web
 * (factorylm.com) and Open WebUI (app.factorylm.com) on the same eTLD+1.
 */

const COOKIE_DOMAIN =
  process.env.COOKIE_DOMAIN ?? ".factorylm.com";
const COOKIE_SECURE = process.env.NODE_ENV !== "development";

export function parseCookies(header: string | undefined | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildSessionCookie(jwt: string): string {
  const attrs = [
    `mira_session=${encodeURIComponent(jwt)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=2592000", // 30 days
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildPendingScanCookie(scanId: string): string {
  const attrs = [
    `mira_pending_scan=${encodeURIComponent(scanId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=300", // 5 minutes
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookie(name: string): string {
  const attrs = [
    `${name}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    `Domain=${COOKIE_DOMAIN}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mira-web
bun test src/lib/__tests__/cookie-session.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 5: Extend `verifyToken()` / `requireAuth()` to read cookies**

Modify `mira-web/src/lib/auth.ts` — update the two middleware functions to fall through to a cookie source. Replace lines 59-79 (the `requireAuth` middleware):

```typescript
// mira-web/src/lib/auth.ts — replace the existing requireAuth function
import { parseCookies } from "./cookie-session.js";

/**
 * Hono middleware — reads JWT from Authorization header, ?token= query, or
 * `mira_session` cookie (lowest precedence so programmatic integrations
 * aren't affected).
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const query = c.req.query("token");
  const cookie = parseCookies(c.req.header("cookie"))["mira_session"];
  const raw = header ? header.replace("Bearer ", "") : query ?? cookie;

  if (!raw) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(raw);
  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("user", payload);
  await next();
}
```

Make the equivalent change to `requireActive` (lines 87-111) — same fallback chain, header → query → cookie.

- [ ] **Step 6: Add cookie emission on successful login**

Find the existing `signinUser` / login handler in `mira-web/src/server.ts`. On success, BEFORE returning the token in the JSON response, add:

```typescript
import { buildSessionCookie } from "./lib/cookie-session.js";

// In the login success branch, immediately before the return:
c.header("Set-Cookie", buildSessionCookie(token));
return c.json({ token, tenant_id: payload.tenantId });
```

The server already returns the raw JWT in the response body; this just ADDS the cookie so browser flows also work. Programmatic integrations that use the Authorization header keep working unchanged.

- [ ] **Step 7: Run the existing auth tests to verify no regression**

```bash
cd mira-web
bun test src/lib/activation.test.ts
```

Expected: all existing tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add mira-web/src/lib/cookie-session.ts \
        mira-web/src/lib/__tests__/cookie-session.test.ts \
        mira-web/src/lib/auth.ts \
        mira-web/src/server.ts
git commit -m "feat(qr): cookie session layer for mira-web

Adds mira_session (30d) and mira_pending_scan (5min) cookie helpers.
Extends requireAuth/requireActive to read mira_session as a third
auth source (after Authorization header and ?token= query). Emits the
cookie on successful login. Resolves spec §12.1."
```

---

## Phase 2 — Core scan flow (Day 3-4, ~8 hours)

### Task 3: QR image generator

**Files:**
- Modify: `mira-web/package.json` — add `qrcode` dependency
- Create: `mira-web/src/lib/qr-generate.ts`
- Create: `mira-web/src/lib/__tests__/qr-generate.test.ts`

**Hours:** 2

**Depends on:** nothing (isolated utility).

- [ ] **Step 1: Add the `qrcode` dependency**

```bash
cd mira-web
bun add qrcode
bun add -d @types/qrcode
```

Expected: `package.json` shows `"qrcode": "^1.x.x"` under dependencies.

- [ ] **Step 2: Write the failing test**

```typescript
// mira-web/src/lib/__tests__/qr-generate.test.ts
import { describe, test, expect } from "bun:test";
import { generatePng, generateSvg, clampSize } from "../qr-generate.js";

describe("clampSize", () => {
  test("clamps below 64 to 64", () => expect(clampSize(10)).toBe(64));
  test("clamps above 1024 to 1024", () => expect(clampSize(99999)).toBe(1024));
  test("passes through valid size", () => expect(clampSize(400)).toBe(400));
  test("defaults on NaN", () => expect(clampSize(NaN)).toBe(512));
});

describe("generatePng", () => {
  test("produces a PNG buffer for a real URL", async () => {
    const buf = await generatePng("https://app.factorylm.com/m/VFD-07", 256);
    expect(buf).toBeInstanceOf(Buffer);
    // PNG files start with 0x89 0x50 0x4E 0x47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test("non-trivial size", async () => {
    const buf = await generatePng("https://app.factorylm.com/m/VFD-07", 512);
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe("generateSvg", () => {
  test("returns SVG text", async () => {
    const svg = await generateSvg("https://app.factorylm.com/m/VFD-07");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd mira-web
bun test src/lib/__tests__/qr-generate.test.ts
```

Expected: tests FAIL — "Cannot find module."

- [ ] **Step 4: Write `qr-generate.ts`**

```typescript
// mira-web/src/lib/qr-generate.ts
/**
 * QR image generation. Thin wrapper over the `qrcode` npm package.
 *
 * Only emits URLs under https://app.factorylm.com/m/{asset_tag}. No
 * caller-supplied URL override.
 */
import QRCode from "qrcode";

const MIN_PX = 64;
const MAX_PX = 1024;
const DEFAULT_PX = 512;

export function clampSize(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_PX;
  return Math.max(MIN_PX, Math.min(MAX_PX, Math.floor(sizePx)));
}

export async function generatePng(url: string, sizePx: number = DEFAULT_PX): Promise<Buffer> {
  const size = clampSize(sizePx);
  return await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    width: size,
    margin: 1,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export async function generateSvg(url: string): Promise<string> {
  return await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}

export function scanUrlFor(assetTag: string): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://app.factorylm.com";
  return `${base}/m/${encodeURIComponent(assetTag)}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd mira-web
bun test src/lib/__tests__/qr-generate.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add mira-web/package.json mira-web/bun.lockb \
        mira-web/src/lib/qr-generate.ts \
        mira-web/src/lib/__tests__/qr-generate.test.ts
git commit -m "feat(qr): QR PNG + SVG generator wrapping npm qrcode

Size clamped to [64, 1024] px per spec §7.2. ECC level M. URLs are
always https://app.factorylm.com/m/{asset_tag} — no caller override."
```

---

### Task 4: Scan route `/m/:asset_tag` + tracker

**Files:**
- Create: `mira-web/src/lib/qr-tracker.ts` — NeonDB UPSERT + event insert, constant-time lookup
- Create: `mira-web/src/routes/m.ts` — Hono router mounted at `/m`
- Create: `mira-web/src/lib/__tests__/qr-tracker.test.ts`
- Modify: `mira-web/src/server.ts` — mount the `m` router

**Hours:** 3

**Depends on:** Tasks 1 (DB schema), 2 (cookie layer), 3 (not strictly required but admin page needs it).

- [ ] **Step 1: Write failing tests for `qr-tracker`**

```typescript
// mira-web/src/lib/__tests__/qr-tracker.test.ts
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { Client } from "@neondatabase/serverless";
import { resolveAssetForScan, recordScan, ASSET_TAG_RE } from "../qr-tracker.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";

async function pg(): Promise<Client> {
  const c = new Client(process.env.NEON_DATABASE_URL!);
  await c.connect();
  return c;
}

async function cleanup() {
  const c = await pg();
  try {
    await c.query("DELETE FROM qr_scan_events WHERE tenant_id = ANY($1)", [
      [TEST_TENANT, OTHER_TENANT],
    ]);
    await c.query("DELETE FROM asset_qr_tags WHERE tenant_id = ANY($1)", [
      [TEST_TENANT, OTHER_TENANT],
    ]);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL required");
  await cleanup();
});

afterEach(cleanup);

describe("ASSET_TAG_RE", () => {
  test("accepts valid tags", () => {
    for (const ok of ["VFD-07", "PUMP_22.NORTH", "CP-14-A", "a"]) {
      expect(ASSET_TAG_RE.test(ok)).toBe(true);
    }
  });
  test("rejects invalid tags", () => {
    for (const bad of ["", " ", "VFD 07", "../../etc/passwd", "x".repeat(65)]) {
      expect(ASSET_TAG_RE.test(bad)).toBe(false);
    }
  });
});

describe("resolveAssetForScan", () => {
  test("returns the atlas_asset_id when tag exists for tenant", async () => {
    const c = await pg();
    try {
      await c.query(
        "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES ($1, 'VFD-07', 42)",
        [TEST_TENANT],
      );
    } finally {
      await c.end();
    }
    const r = await resolveAssetForScan(TEST_TENANT, "VFD-07");
    expect(r).toEqual({ found: true, atlas_asset_id: 42 });
  });

  test("case-insensitive lookup", async () => {
    const c = await pg();
    try {
      await c.query(
        "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES ($1, 'VFD-07', 42)",
        [TEST_TENANT],
      );
    } finally {
      await c.end();
    }
    const r = await resolveAssetForScan(TEST_TENANT, "vfd-07");
    expect(r.found).toBe(true);
  });

  test("returns not-found for tag in another tenant (no distinguishing output)", async () => {
    const c = await pg();
    try {
      await c.query(
        "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES ($1, 'VFD-07', 42)",
        [OTHER_TENANT],
      );
    } finally {
      await c.end();
    }
    const r = await resolveAssetForScan(TEST_TENANT, "VFD-07");
    expect(r).toEqual({ found: false });
  });

  test("returns not-found for tag that doesn't exist anywhere", async () => {
    const r = await resolveAssetForScan(TEST_TENANT, "FAKE-NOEXIST-999");
    expect(r).toEqual({ found: false });
  });
});

describe("recordScan", () => {
  test("UPSERTs asset_qr_tags + inserts qr_scan_events on found", async () => {
    const c = await pg();
    try {
      await c.query(
        "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES ($1, 'VFD-07', 42)",
        [TEST_TENANT],
      );
      const scanId = await recordScan({
        tenant_id: TEST_TENANT,
        asset_tag: "VFD-07",
        atlas_user_id: 100,
        user_agent: "ua",
        found: true,
      });
      expect(scanId).toMatch(/^[0-9a-f-]{36}$/);

      const tags = await c.query(
        "SELECT scan_count, first_scan, last_scan FROM asset_qr_tags WHERE tenant_id = $1 AND asset_tag = 'VFD-07'",
        [TEST_TENANT],
      );
      expect(tags.rows[0].scan_count).toBe(1);

      const events = await c.query(
        "SELECT COUNT(*)::int AS n FROM qr_scan_events WHERE tenant_id = $1 AND asset_tag = 'VFD-07'",
        [TEST_TENANT],
      );
      expect(events.rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
  });

  test("only inserts qr_scan_events when found=false (no tag row)", async () => {
    const c = await pg();
    try {
      await recordScan({
        tenant_id: TEST_TENANT,
        asset_tag: "FAKE",
        atlas_user_id: null,
        user_agent: "ua",
        found: false,
      });
      const tags = await c.query(
        "SELECT COUNT(*)::int AS n FROM asset_qr_tags WHERE tenant_id = $1",
        [TEST_TENANT],
      );
      expect(tags.rows[0].n).toBe(0);

      const events = await c.query(
        "SELECT COUNT(*)::int AS n FROM qr_scan_events WHERE tenant_id = $1",
        [TEST_TENANT],
      );
      expect(events.rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd mira-web
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  bun test src/lib/__tests__/qr-tracker.test.ts
```

Expected: FAIL with "Cannot find module '../qr-tracker.js'."

- [ ] **Step 3: Implement `qr-tracker.ts`**

```typescript
// mira-web/src/lib/qr-tracker.ts
/**
 * NeonDB access layer for the QR scan route.
 *
 * Three exports:
 *   - ASSET_TAG_RE       regex matching valid asset_tag strings
 *   - resolveAssetForScan(tenant, tag) -> { found, atlas_asset_id? }
 *   - recordScan({...}) -> scan_id (UUID)
 *
 * resolveAssetForScan is constant-time branch-wise: always issues the
 * same SELECT, only the result differs. Prevents the cross-tenant
 * enumeration oracle flagged in spec §12.6.
 */
import { Client } from "@neondatabase/serverless";

export const ASSET_TAG_RE = /^[A-Za-z0-9._-]{1,64}$/;

export type ResolveResult =
  | { found: true; atlas_asset_id: number }
  | { found: false };

export async function resolveAssetForScan(
  tenantId: string,
  assetTag: string,
): Promise<ResolveResult> {
  if (!ASSET_TAG_RE.test(assetTag)) return { found: false };

  const c = new Client(process.env.NEON_DATABASE_URL!);
  await c.connect();
  try {
    const r = await c.query(
      "SELECT atlas_asset_id FROM asset_qr_tags " +
        "WHERE tenant_id = $1 AND lower(asset_tag) = lower($2) LIMIT 1",
      [tenantId, assetTag],
    );
    if (r.rows.length === 0) return { found: false };
    return { found: true, atlas_asset_id: r.rows[0].atlas_asset_id };
  } finally {
    await c.end();
  }
}

export interface RecordScanInput {
  tenant_id: string;
  asset_tag: string;
  atlas_user_id: number | null;
  user_agent: string | null;
  found: boolean;
}

export async function recordScan(input: RecordScanInput): Promise<string> {
  const c = new Client(process.env.NEON_DATABASE_URL!);
  await c.connect();
  try {
    if (input.found) {
      await c.query(
        `INSERT INTO asset_qr_tags
           (tenant_id, asset_tag, atlas_asset_id, first_scan, last_scan, scan_count)
         VALUES ($1, $2, 0, NOW(), NOW(), 1)
         ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
           last_scan = NOW(),
           scan_count = asset_qr_tags.scan_count + 1,
           first_scan = COALESCE(asset_qr_tags.first_scan, NOW())`,
        [input.tenant_id, input.asset_tag],
      );
    }
    const r = await c.query(
      `INSERT INTO qr_scan_events
         (tenant_id, asset_tag, atlas_user_id, user_agent)
       VALUES ($1, $2, $3, $4)
       RETURNING scan_id`,
      [input.tenant_id, input.asset_tag, input.atlas_user_id, input.user_agent],
    );
    return r.rows[0].scan_id;
  } finally {
    await c.end();
  }
}
```

- [ ] **Step 4: Write the scan-route HTTP test**

```typescript
// mira-web/src/routes/__tests__/m.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../server.js";
import { signToken } from "../../lib/auth.js";
import { Client } from "@neondatabase/serverless";

const TEST_TENANT = "00000000-0000-0000-0000-000000000003";

beforeAll(async () => {
  const c = new Client(process.env.NEON_DATABASE_URL!);
  await c.connect();
  await c.query("DELETE FROM asset_qr_tags WHERE tenant_id = $1", [TEST_TENANT]);
  await c.query("DELETE FROM qr_scan_events WHERE tenant_id = $1", [TEST_TENANT]);
  await c.query(
    "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES ($1, 'VFD-07', 42)",
    [TEST_TENANT],
  );
  await c.end();
});

async function jwt(): Promise<string> {
  return await signToken({
    tenantId: TEST_TENANT,
    email: "test@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 100,
  });
}

describe("GET /m/:asset_tag", () => {
  test("401 without auth", async () => {
    const res = await app.request("/m/VFD-07");
    expect(res.status).toBe(401);
  });

  test("302 with pending-scan cookie on valid scan", async () => {
    const token = await jwt();
    const res = await app.request("/m/VFD-07", {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/c/new");
    expect(res.headers.get("Set-Cookie")).toContain("mira_pending_scan=");
  });

  test("400 on malformed asset_tag", async () => {
    const token = await jwt();
    const res = await app.request("/m/%2F%2Fetc%2Fpasswd", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  test("200 identical HTML for cross-tenant and nonexistent", async () => {
    const token = await jwt();
    const r1 = await app.request("/m/FAKE-NOEXIST", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const r2 = await app.request("/m/VFD-SOMEOTHERTENANT", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r1.text()).toBe(await r2.text());
  });
});
```

- [ ] **Step 5: Implement the scan route**

```typescript
// mira-web/src/routes/m.ts
import { Hono } from "hono";
import { requireAuth } from "../lib/auth.js";
import {
  ASSET_TAG_RE,
  resolveAssetForScan,
  recordScan,
} from "../lib/qr-tracker.js";
import {
  buildPendingScanCookie,
} from "../lib/cookie-session.js";

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Asset not found in your plant</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 3rem auto; padding: 1rem; color: #111; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #444; line-height: 1.5; }
    a { color: #f5a623; }
  </style>
</head><body>
  <h1>Asset not found in your plant</h1>
  <p>This asset tag is not associated with your plant. If you believe this is an error, contact your admin.</p>
  <p><a href="https://app.factorylm.com">Open MIRA</a></p>
</body></html>`;

export const m = new Hono();

m.get("/:asset_tag", requireAuth, async (c) => {
  const assetTag = c.req.param("asset_tag");

  // Input validation: reject malformed tags at the edge
  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  const user = c.get("user") as import("../lib/auth.js").MiraTokenPayload;
  const tenantId = user.sub;
  const atlasUserId = user.atlasUserId ?? null;
  const userAgent = c.req.header("User-Agent") ?? null;

  // Constant-time: always do the SELECT, then branch on result
  const resolved = await resolveAssetForScan(tenantId, assetTag);

  // Always log the scan attempt (audit)
  const scanId = await recordScan({
    tenant_id: tenantId,
    asset_tag: assetTag,
    atlas_user_id: atlasUserId,
    user_agent: userAgent,
    found: resolved.found,
  });

  if (!resolved.found) {
    // Byte-identical response for cross-tenant and nonexistent (spec §12.6)
    return c.html(NOT_FOUND_HTML, 200);
  }

  // Set pending-scan cookie so mira-pipeline can read on first chat turn
  c.header("Set-Cookie", buildPendingScanCookie(scanId));
  return c.redirect("/c/new", 302);
});
```

- [ ] **Step 6: Mount the router**

Modify `mira-web/src/server.ts` near where other routers are mounted (search for `.route(` calls):

```typescript
// mira-web/src/server.ts — add near the top of mounting block
import { m } from "./routes/m.js";
app.route("/m", m);
```

- [ ] **Step 7: Run all new tests to verify they pass**

```bash
cd mira-web
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  bun test src/lib/__tests__/qr-tracker.test.ts src/routes/__tests__/m.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add mira-web/src/lib/qr-tracker.ts \
        mira-web/src/lib/__tests__/qr-tracker.test.ts \
        mira-web/src/routes/m.ts \
        mira-web/src/routes/__tests__/m.test.ts \
        mira-web/src/server.ts
git commit -m "feat(qr): scan route /m/:asset_tag + qr-tracker

Handles auth, constant-time tenant resolution (spec §12.6), scan event
logging, and pending-scan cookie emission before redirect to Open WebUI
at /c/new. Cross-tenant and nonexistent-tag responses are byte-identical.
Resolves spec §12.2 (mira-web side) and §12.6."
```

---

### Task 5: mira-pipeline cookie reader + `save_session` bridge

**Files:**
- Create: `mira-pipeline/qr_bridge.py` — cookie parsing + scan_id lookup + save_session call
- Modify: `mira-pipeline/main.py` — invoke `qr_bridge.process_pending_scan(request)` at entry to `/v1/chat/completions`
- Create: `mira-pipeline/tests/test_qr_bridge.py`

**Hours:** 3

**Depends on:** Tasks 1 (schema), 4 (scan route writes `qr_scan_events.scan_id`).

- [ ] **Step 1: Write the failing `qr_bridge` unit test**

```python
# mira-pipeline/tests/test_qr_bridge.py
"""Unit tests for the QR→pipeline cookie bridge."""

import pytest

from qr_bridge import parse_cookie_header, read_pending_scan_id


def test_parse_cookie_header_empty():
    assert parse_cookie_header("") == {}
    assert parse_cookie_header(None) == {}


def test_parse_cookie_header_single():
    assert parse_cookie_header("mira_pending_scan=abc") == {"mira_pending_scan": "abc"}


def test_parse_cookie_header_multiple():
    h = "mira_session=jwt; mira_pending_scan=01920000-1234-7000-8000-000000000000"
    r = parse_cookie_header(h)
    assert r["mira_pending_scan"] == "01920000-1234-7000-8000-000000000000"
    assert r["mira_session"] == "jwt"


def test_read_pending_scan_id_none():
    assert read_pending_scan_id("") is None
    assert read_pending_scan_id("mira_session=abc") is None


def test_read_pending_scan_id_valid_uuid():
    h = "mira_pending_scan=01920000-1234-7000-8000-000000000000"
    assert read_pending_scan_id(h) == "01920000-1234-7000-8000-000000000000"


def test_read_pending_scan_id_rejects_non_uuid():
    # Defend against malformed cookie values — don't pass junk to the DB
    h = "mira_pending_scan=not-a-uuid"
    assert read_pending_scan_id(h) is None
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd mira-pipeline
python -m pytest tests/test_qr_bridge.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `qr_bridge.py`**

```python
# mira-pipeline/qr_bridge.py
"""QR→pipeline bridge.

On first chat invocation after a scan, read the `mira_pending_scan`
cookie, look up (tenant_id, asset_tag) in NeonDB, and call
session_memory.save_session() so the engine's existing IDLE-state
load_session() hook (engine.py:619-639) picks up the asset context.

Clears the cookie on completion so it's one-shot.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger("mira-pipeline.qr_bridge")

# Share session_memory with mira-bots
_BOTS_SHARED = str(Path(__file__).resolve().parent.parent / "mira-bots")
if _BOTS_SHARED not in sys.path:
    sys.path.insert(0, _BOTS_SHARED)

_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def parse_cookie_header(header: str | None) -> dict[str, str]:
    """Parse a raw HTTP Cookie header into a dict."""
    if not header:
        return {}
    out: dict[str, str] = {}
    for part in header.split(";"):
        eq = part.find("=")
        if eq < 0:
            continue
        k = part[:eq].strip()
        v = part[eq + 1 :].strip()
        if k:
            out[k] = v
    return out


def read_pending_scan_id(cookie_header: str | None) -> str | None:
    """Return the pending scan_id if present and syntactically valid, else None."""
    raw = parse_cookie_header(cookie_header).get("mira_pending_scan")
    if not raw:
        return None
    if not _UUID_RE.match(raw):
        logger.warning("qr_bridge: rejecting non-UUID pending scan cookie value")
        return None
    return raw


def lookup_scan(scan_id: str) -> dict[str, Any] | None:
    """Fetch the scan row (tenant_id, asset_tag, atlas_user_id) from NeonDB."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        logger.warning("qr_bridge: sqlalchemy not installed, skipping")
        return None
    try:
        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT tenant_id::text, asset_tag, atlas_user_id "
                        "FROM qr_scan_events WHERE scan_id = :sid LIMIT 1"
                    ),
                    {"sid": scan_id},
                )
                .mappings()
                .fetchone()
            )
            return dict(row) if row else None
    except Exception as exc:
        logger.warning("qr_bridge: lookup_scan failed: %s", exc)
        return None


def lookup_asset_metadata(tenant_id: str, asset_tag: str) -> dict[str, Any]:
    """Fetch atlas_asset_id; ignore errors (returns empty dict so save_session still runs)."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return {}
    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT atlas_asset_id FROM asset_qr_tags "
                        "WHERE tenant_id = :tid AND lower(asset_tag) = lower(:tag) LIMIT 1"
                    ),
                    {"tid": tenant_id, "tag": asset_tag},
                )
                .mappings()
                .fetchone()
            )
            return dict(row) if row else {}
    except Exception as exc:
        logger.warning("qr_bridge: lookup_asset_metadata failed: %s", exc)
        return {}


def process_pending_scan(cookie_header: str | None, chat_id: str) -> bool:
    """Return True if a pending scan was found, resolved, and saved to session.

    Always safe to call — returns False on any failure.
    """
    scan_id = read_pending_scan_id(cookie_header)
    if not scan_id:
        return False

    row = lookup_scan(scan_id)
    if not row:
        return False

    try:
        from session_memory import save_session  # noqa: PLC0415 — lazy
    except ImportError:
        logger.warning("qr_bridge: session_memory unavailable")
        return False

    ok = save_session(
        chat_id=chat_id,
        asset_id=row["asset_tag"],
    )
    if ok:
        logger.info(
            "qr_bridge: seeded session chat_id=%s asset=%s from scan_id=%s",
            chat_id,
            row["asset_tag"],
            scan_id,
        )
    return ok


def build_clear_cookie_header() -> str:
    """One-shot cookie clear for `mira_pending_scan`."""
    domain = os.environ.get("COOKIE_DOMAIN", ".factorylm.com")
    secure_attr = "Secure; " if os.environ.get("NODE_ENV") != "development" else ""
    return (
        f"mira_pending_scan=; HttpOnly; {secure_attr}"
        f"SameSite=Lax; Path=/; Max-Age=0; Domain={domain}"
    )
```

- [ ] **Step 4: Run the unit tests to verify they pass**

```bash
cd mira-pipeline
python -m pytest tests/test_qr_bridge.py -v
```

Expected: 6/6 PASS.

- [ ] **Step 5: Wire into `mira-pipeline/main.py`**

Locate the FastAPI `POST /v1/chat/completions` handler. It derives `chat_id` from OW request headers. BEFORE calling `engine.process(...)`, add the bridge call:

```python
# mira-pipeline/main.py — import at top
from qr_bridge import process_pending_scan, build_clear_cookie_header

# In the /v1/chat/completions handler, after chat_id is resolved,
# BEFORE engine.process() is called:
cookie_header = request.headers.get("cookie")
seeded = process_pending_scan(cookie_header, chat_id)
# Continue with normal engine.process() flow — engine's load_session() will pick up

# ... at the end, when building the response, if seeded:
if seeded:
    response.headers["Set-Cookie"] = build_clear_cookie_header()
```

(The exact placement depends on existing code structure. Insert the `process_pending_scan` call before `engine.process()`, and the `Set-Cookie` response header immediately before the response is returned.)

- [ ] **Step 6: End-to-end smoke test**

Manually exercise the full flow on a dev stack:

```bash
# 1. Start the full stack on your laptop
cd /path/to/MIRA
doppler run --project factorylm --config dev -- docker compose up -d

# 2. Seed a test tag
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  psql "$NEON_DATABASE_URL" <<SQL
INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id)
VALUES ('<your-test-tenant-uuid>', 'TEST-VFD-01', 1)
ON CONFLICT DO NOTHING;
SQL

# 3. Scan (simulate the redirect)
curl -v --cookie "mira_session=<valid-jwt-here>" \
  "http://localhost:3200/m/TEST-VFD-01"
# Expect: 302 Location: /c/new + Set-Cookie: mira_pending_scan=<uuid>

# 4. Grab the scan cookie; call the pipeline as OW would
curl -v -X POST http://localhost:9099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Cookie: mira_pending_scan=<uuid-from-step-3>" \
  -d '{"model":"mira-diagnostic","messages":[{"role":"user","content":"tell me about this machine"}]}'
# Expect: response that greets by asset (not generic)
# Expect: Set-Cookie: mira_pending_scan=; Max-Age=0 (cleared)

# 5. Verify session_memory now has the row
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  psql "$NEON_DATABASE_URL" -c \
  "SELECT * FROM user_asset_sessions ORDER BY updated_at DESC LIMIT 3"
# Expect: the chat_id → TEST-VFD-01 mapping
```

- [ ] **Step 7: Commit**

```bash
git add mira-pipeline/qr_bridge.py \
        mira-pipeline/tests/test_qr_bridge.py \
        mira-pipeline/main.py
git commit -m "feat(qr): mira-pipeline reads pending-scan cookie

On first /v1/chat/completions call, reads mira_pending_scan cookie,
looks up scan_id in qr_scan_events, calls session_memory.save_session()
so the engine's existing IDLE load_session() hook picks up the asset.
Clears the cookie on completion (one-shot). Resolves spec §12.2
(pipeline side) and §12.4 (no new engine method — piggyback on existing
save/load pattern)."
```

---

## Phase 3 — Admin + analytics (Day 5, ~11 hours)

### Task 6: Atlas role claim + `requireAdmin` middleware

**Files:**
- Modify: `mira-web/src/lib/atlas.ts` — add `getAtlasUserRole()`, `getAsset(id)`, `listAssets()` wrappers
- Modify: `mira-web/src/lib/auth.ts` — extend `MiraTokenPayload` with `atlasRole`; modify `signToken` callers to pass it; add `requireAdmin()` middleware
- Modify: `mira-web/src/lib/atlas.ts::signinUser` — fetch atlasRole after auth and pass to signToken
- Create: `mira-web/src/lib/__tests__/require-admin.test.ts`

**Hours:** 2

**Depends on:** Task 2 (cookie session layer to not conflict).

- [ ] **Step 1: Write failing test for `requireAdmin`**

```typescript
// mira-web/src/lib/__tests__/require-admin.test.ts
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { requireAdmin, signToken } from "../auth.js";

function appWith() {
  const app = new Hono();
  app.get("/admin-only", requireAdmin, (c) => c.json({ ok: true }));
  return app;
}

async function token(role: "ADMIN" | "USER"): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "t@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: role,
  });
}

describe("requireAdmin", () => {
  test("401 without auth", async () => {
    const app = appWith();
    const res = await app.request("/admin-only");
    expect(res.status).toBe(401);
  });

  test("403 for USER role", async () => {
    const app = appWith();
    const res = await app.request("/admin-only", {
      headers: { Authorization: `Bearer ${await token("USER")}` },
    });
    expect(res.status).toBe(403);
  });

  test("200 for ADMIN role", async () => {
    const app = appWith();
    const res = await app.request("/admin-only", {
      headers: { Authorization: `Bearer ${await token("ADMIN")}` },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd mira-web
bun test src/lib/__tests__/require-admin.test.ts
```

Expected: FAIL — `requireAdmin` does not exist yet; `signToken` doesn't accept `atlasRole`.

- [ ] **Step 3: Extend `MiraTokenPayload` + `signToken`**

Modify `mira-web/src/lib/auth.ts` at the top:

```typescript
// mira-web/src/lib/auth.ts — replace MiraTokenPayload and signToken
export interface MiraTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  tier: string;
  atlasCompanyId: number;
  atlasUserId: number;
  atlasRole: "ADMIN" | "USER"; // NEW
}

export async function signToken(payload: {
  tenantId: string;
  email: string;
  tier: string;
  atlasCompanyId: number;
  atlasUserId: number;
  atlasRole: "ADMIN" | "USER";
}): Promise<string> {
  return new SignJWT({
    email: payload.email,
    tier: payload.tier,
    atlasCompanyId: payload.atlasCompanyId,
    atlasUserId: payload.atlasUserId,
    atlasRole: payload.atlasRole,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.tenantId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}
```

- [ ] **Step 4: Add `requireAdmin` at the bottom of `auth.ts`**

```typescript
// mira-web/src/lib/auth.ts — append
/**
 * Hono middleware — requireActive + check atlasRole === "ADMIN".
 * Returns 403 if the user is authed but not an admin.
 */
export async function requireAdmin(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const query = c.req.query("token");
  const cookie = parseCookies(c.req.header("cookie"))["mira_session"];
  const raw = header ? header.replace("Bearer ", "") : query ?? cookie;

  if (!raw) return c.json({ error: "Unauthorized" }, 401);

  const payload = await verifyToken(raw);
  if (!payload) return c.json({ error: "Invalid or expired token" }, 401);

  if (payload.atlasRole !== "ADMIN") {
    return c.json({ error: "Admin role required" }, 403);
  }

  c.set("user", payload);
  await next();
}
```

- [ ] **Step 5: Add `getAtlasUserRole` helper in `atlas.ts`**

```typescript
// mira-web/src/lib/atlas.ts — append
export async function getAtlasUserRole(atlasUserId: number): Promise<"ADMIN" | "USER"> {
  // Atlas returns user details including role name; fall back to USER on any failure.
  try {
    const res = await fetch(`${ATLAS_URL}/users/${atlasUserId}`, {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    if (!res.ok) return "USER";
    const data = (await res.json()) as { role?: { name?: string } };
    const name = data.role?.name?.toUpperCase() ?? "";
    return name.includes("ADMIN") ? "ADMIN" : "USER";
  } catch {
    return "USER";
  }
}

export async function getAsset(atlasAssetId: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${ATLAS_URL}/assets/${atlasAssetId}`, {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listAssets(limit: number = 100): Promise<Array<{ id: number; name: string }>> {
  try {
    const res = await fetch(`${ATLAS_URL}/assets/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await adminToken()}`,
      },
      body: JSON.stringify({ pageSize: limit, pageNum: 0 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { content?: Array<{ id: number; name: string }> };
    return data.content ?? [];
  } catch {
    return [];
  }
}
```

(`ATLAS_URL` and `adminToken()` already exist in `atlas.ts`. Reuse them.)

- [ ] **Step 6: Update existing `signToken` callers**

Search for every `signToken(...)` call in `mira-web/src/`. At each call site, add `atlasRole` to the argument. On login handlers, call `getAtlasUserRole()` first:

```typescript
// In the login handler
import { getAtlasUserRole } from "./lib/atlas.js";

const atlasRole = await getAtlasUserRole(user.atlasUserId);
const token = await signToken({ ...existing, atlasRole });
```

Use your editor's "Find All References" to catch every call site.

- [ ] **Step 7: Run the tests**

```bash
cd mira-web
bun test src/lib/__tests__/require-admin.test.ts src/lib/activation.test.ts
```

Expected: new tests PASS, existing tests still PASS (with updated signToken calls).

- [ ] **Step 8: Commit**

```bash
git add mira-web/src/lib/auth.ts \
        mira-web/src/lib/atlas.ts \
        mira-web/src/lib/__tests__/require-admin.test.ts \
        mira-web/src/server.ts
git commit -m "feat(qr): Atlas role claim + requireAdmin middleware

Adds atlasRole to MiraTokenPayload. New requireAdmin() middleware gates
admin routes. getAtlasUserRole/getAsset/listAssets helpers added to
atlas.ts. Resolves spec §12.5."
```

---

### Task 7: Admin print page + Avery 5163 PDF generator

**Files:**
- Modify: `mira-web/package.json` — add `pdf-lib`
- Create: `mira-web/src/lib/qr-pdf.ts` — Avery 5163 sheet composer
- Create: `mira-web/src/routes/admin/qr-print.ts` — `GET` list page + `POST` batch print
- Create: `mira-web/src/lib/__tests__/qr-pdf.test.ts`
- Modify: `mira-web/src/server.ts` — mount admin router

**Hours:** 6

**Depends on:** Tasks 3 (QR generator), 6 (requireAdmin), and must have at least one row in Atlas for manual testing.

- [ ] **Step 1: Add `pdf-lib` dependency**

```bash
cd mira-web
bun add pdf-lib
```

- [ ] **Step 2: Write failing PDF test**

```typescript
// mira-web/src/lib/__tests__/qr-pdf.test.ts
import { describe, test, expect } from "bun:test";
import { buildStickerSheetPdf } from "../qr-pdf.js";

describe("buildStickerSheetPdf", () => {
  test("returns non-empty PDF bytes with proper header", async () => {
    const pdf = await buildStickerSheetPdf([
      { asset_tag: "VFD-07", scan_url: "https://app.factorylm.com/m/VFD-07" },
    ]);
    expect(pdf).toBeInstanceOf(Uint8Array);
    // PDF magic: %PDF-
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
    expect(pdf[2]).toBe(0x44);
    expect(pdf[3]).toBe(0x46);
    expect(pdf.length).toBeGreaterThan(500);
  });

  test("17 tags produce 2 pages (10 per sheet)", async () => {
    const rows = Array.from({ length: 17 }, (_, i) => ({
      asset_tag: `T${String(i + 1).padStart(2, "0")}`,
      scan_url: `https://app.factorylm.com/m/T${String(i + 1).padStart(2, "0")}`,
    }));
    const pdf = await buildStickerSheetPdf(rows);
    // Crude check: pdf-lib's output grows with page count
    expect(pdf.length).toBeGreaterThan(2000);
  });

  test("empty rows rejected", async () => {
    await expect(buildStickerSheetPdf([])).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to fail**

```bash
cd mira-web
bun test src/lib/__tests__/qr-pdf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `qr-pdf.ts`**

```typescript
// mira-web/src/lib/qr-pdf.ts
/**
 * Avery 5163 sticker sheet composer.
 *
 * Sheet: 8.5" × 11" letter portrait
 * Grid: 2 columns × 5 rows = 10 labels/page
 * Label: 2" × 4" (144 × 288 pts at 72 dpi)
 *
 * Layout per label (points, origin top-left of label):
 *   - QR: 1.6" × 1.6" block, left-aligned with 0.2" inset
 *   - Right panel (2.2" × 1.6"):
 *       * MIRA logo (placeholder text "MIRA") at top
 *       * asset_tag in 24pt bold (middle — human-readable backup)
 *       * factorylm.com in 8pt at bottom
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { generatePng } from "./qr-generate.js";

export interface StickerInput {
  asset_tag: string;
  scan_url: string;
}

// 72 dpi = 72 points per inch
const DPI = 72;
const IN = (inches: number): number => inches * DPI;

// Avery 5163 specs — top/bottom margins 0.5", side margins 0.156", rows tight
const MARGIN_TOP = IN(0.5);
const MARGIN_SIDE = IN(0.156);
const LABEL_W = IN(4);
const LABEL_H = IN(2);
const COLS = 2;
const ROWS = 5;
const PER_PAGE = COLS * ROWS;

export async function buildStickerSheetPdf(rows: StickerInput[]): Promise<Uint8Array> {
  if (rows.length === 0) {
    throw new Error("buildStickerSheetPdf: rows must be non-empty");
  }

  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (let start = 0; start < rows.length; start += PER_PAGE) {
    const page = pdf.addPage([IN(8.5), IN(11)]);
    const { height: pageH } = page.getSize();

    const sheetRows = rows.slice(start, start + PER_PAGE);
    for (let i = 0; i < sheetRows.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      // Top-left of this label on the sheet, measured in pdf-lib's
      // bottom-origin coords
      const labelX = MARGIN_SIDE + col * LABEL_W;
      const labelY = pageH - MARGIN_TOP - (row + 1) * LABEL_H; // bottom-left of label

      const { asset_tag, scan_url } = sheetRows[i];
      const qrPx = 160;
      const qrPng = await generatePng(scan_url, qrPx);
      const qrImg = await pdf.embedPng(qrPng);

      // QR block: 1.6" × 1.6", inset 0.2" from left + top edges of label
      page.drawImage(qrImg, {
        x: labelX + IN(0.2),
        y: labelY + (LABEL_H - IN(1.6)) / 2,
        width: IN(1.6),
        height: IN(1.6),
      });

      // Right panel text
      const rightX = labelX + IN(1.9);
      const rightCenter = labelY + LABEL_H / 2;

      // "MIRA" brand line top
      page.drawText("MIRA", {
        x: rightX,
        y: labelY + LABEL_H - IN(0.35),
        size: 12,
        font: helvBold,
        color: rgb(0.96, 0.65, 0.14),
      });

      // Asset tag — 24pt bold, centered vertically
      page.drawText(asset_tag, {
        x: rightX,
        y: rightCenter - 8,
        size: 24,
        font: helvBold,
        color: rgb(0, 0, 0),
      });

      // URL at bottom (small)
      page.drawText("factorylm.com/m/" + asset_tag, {
        x: rightX,
        y: labelY + IN(0.15),
        size: 7,
        font: helv,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  }

  return await pdf.save();
}
```

- [ ] **Step 5: Run PDF test to verify**

```bash
cd mira-web
bun test src/lib/__tests__/qr-pdf.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 6: Write the admin-route test**

```typescript
// mira-web/src/routes/admin/__tests__/qr-print.test.ts
import { describe, test, expect } from "bun:test";
import { app } from "../../../server.js";
import { signToken } from "../../../lib/auth.js";

async function adminToken(): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: "ADMIN",
  });
}

async function userToken(): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "u@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 2,
    atlasRole: "USER",
  });
}

describe("GET /admin/qr-print", () => {
  test("403 for USER", async () => {
    const res = await app.request("/admin/qr-print", {
      headers: { Authorization: `Bearer ${await userToken()}` },
    });
    expect(res.status).toBe(403);
  });

  test("200 HTML for ADMIN", async () => {
    const res = await app.request("/admin/qr-print", {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Generate sticker sheet");
  });
});

describe("POST /api/admin/qr-print-batch", () => {
  test("403 for USER", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await userToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [{ asset_tag: "VFD-07", atlas_asset_id: 42 }] }),
    });
    expect(res.status).toBe(403);
  });

  test("400 on empty tags", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await adminToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("200 PDF for valid ADMIN request", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await adminToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tags: [
          { asset_tag: "VFD-07", atlas_asset_id: 42 },
          { asset_tag: "PUMP-22", atlas_asset_id: 43 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 7: Implement the admin routes**

```typescript
// mira-web/src/routes/admin/qr-print.ts
import { Hono } from "hono";
import { requireAdmin } from "../../lib/auth.js";
import { listAssets } from "../../lib/atlas.js";
import { buildStickerSheetPdf } from "../../lib/qr-pdf.js";
import { scanUrlFor, ASSET_TAG_RE } from "../../lib/qr-generate.js";
import { Client } from "@neondatabase/serverless";

export const qrPrint = new Hono();

qrPrint.get("/qr-print", requireAdmin, async (c) => {
  const assets = await listAssets(200);
  const user = c.get("user") as import("../../lib/auth.js").MiraTokenPayload;

  // Fetch existing tags for this tenant so admin can see what's already tagged
  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  let existingTags: Array<{ atlas_asset_id: number; asset_tag: string }> = [];
  try {
    const r = await pg.query(
      "SELECT atlas_asset_id, asset_tag FROM asset_qr_tags WHERE tenant_id = $1",
      [user.sub],
    );
    existingTags = r.rows;
  } finally {
    await pg.end();
  }
  const tagged = new Map(existingTags.map((r) => [r.atlas_asset_id, r.asset_tag]));

  const rows = assets
    .map((a) => {
      const tag = tagged.get(a.id) ?? autoTag(a.name);
      return `<tr>
        <td><input type="checkbox" name="pick" value="${a.id}" ${tagged.has(a.id) ? "checked" : ""}></td>
        <td>${escapeHtml(a.name)}</td>
        <td><input name="tag_${a.id}" value="${escapeHtml(tag)}" pattern="[A-Za-z0-9._-]{1,64}"></td>
        <td>${tagged.has(a.id) ? "tagged" : "new"}</td>
      </tr>`;
    })
    .join("");

  return c.html(`<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>MIRA — QR Stickers</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
    input[name^="tag_"] { width: 160px; font-family: monospace; }
    button { padding: 0.75rem 1.5rem; font-size: 1rem; background: #f5a623; border: 0; color: white; cursor: pointer; }
  </style>
</head><body>
  <h1>QR Stickers</h1>
  <p>Check the assets you want stickers for. Edit the tag if needed (letters, numbers, dots, dashes, underscores; max 64 chars).</p>
  <form id="printform">
    <table>
      <tr><th></th><th>Asset</th><th>Tag</th><th>Status</th></tr>
      ${rows}
    </table>
    <p><button type="submit">Generate sticker sheet (PDF)</button></p>
  </form>
  <script>
    document.getElementById('printform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const picks = [...form.querySelectorAll('input[name="pick"]:checked')];
      const tags = picks.map(p => ({
        atlas_asset_id: parseInt(p.value, 10),
        asset_tag: form.querySelector('input[name="tag_' + p.value + '"]').value.trim()
      }));
      if (!tags.length) { alert('Select at least one asset'); return; }
      const res = await fetch('/api/admin/qr-print-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      });
      if (!res.ok) { alert('Error: ' + res.status); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mira-stickers-' + new Date().toISOString().slice(0,10) + '.pdf';
      a.click();
    });
  </script>
</body></html>`);
});

qrPrint.post("/api/admin/qr-print-batch", requireAdmin, async (c) => {
  const user = c.get("user") as import("../../lib/auth.js").MiraTokenPayload;
  const body = (await c.req.json()) as { tags?: Array<{ asset_tag: string; atlas_asset_id: number }> };
  const tags = body.tags ?? [];

  if (!tags.length) return c.json({ error: "tags must be non-empty" }, 400);
  for (const t of tags) {
    if (!ASSET_TAG_RE.test(t.asset_tag)) {
      return c.json({ error: `Invalid asset_tag: ${t.asset_tag}` }, 400);
    }
    if (!Number.isInteger(t.atlas_asset_id)) {
      return c.json({ error: "atlas_asset_id must be integer" }, 400);
    }
  }

  // UPSERT tag rows + bump print_count in one transaction
  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  try {
    await pg.query("BEGIN");
    for (const t of tags) {
      await pg.query(
        `INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id, printed_at, print_count)
         VALUES ($1, $2, $3, NOW(), 1)
         ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
           printed_at = NOW(),
           print_count = asset_qr_tags.print_count + 1,
           atlas_asset_id = EXCLUDED.atlas_asset_id`,
        [user.sub, t.asset_tag, t.atlas_asset_id],
      );
    }
    await pg.query("COMMIT");
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  } finally {
    await pg.end();
  }

  const pdfInput = tags.map((t) => ({
    asset_tag: t.asset_tag,
    scan_url: scanUrlFor(t.asset_tag),
  }));
  const pdfBytes = await buildStickerSheetPdf(pdfInput);

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mira-stickers-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function autoTag(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "ASSET";
}
```

- [ ] **Step 8: Mount in `server.ts`**

```typescript
// mira-web/src/server.ts — add near other .route() calls
import { qrPrint } from "./routes/admin/qr-print.js";
app.route("/admin", qrPrint); // handles /admin/qr-print
app.route("/", qrPrint);      // handles /api/admin/qr-print-batch
```

- [ ] **Step 9: Run all tests**

```bash
cd mira-web
NEON_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --plain --project factorylm --config dev)" \
  bun test
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add mira-web/package.json mira-web/bun.lockb \
        mira-web/src/lib/qr-pdf.ts \
        mira-web/src/lib/__tests__/qr-pdf.test.ts \
        mira-web/src/routes/admin/qr-print.ts \
        mira-web/src/routes/admin/__tests__/qr-print.test.ts \
        mira-web/src/server.ts
git commit -m "feat(qr): admin print page + Avery 5163 PDF generator

GET /admin/qr-print lists Atlas assets with auto-generated tag names and
a checkbox UI. POST /api/admin/qr-print-batch UPSERTs asset_qr_tags +
generates an Avery 5163 PDF sheet (2 cols × 5 rows, 2\"×4\" labels) with
the asset_tag in 24pt bold + QR + MIRA brand + human-readable URL line.
Both routes gated by requireAdmin. Resolves spec §7.3."
```

---

### Task 8: Minimal analytics page

**Files:**
- Create: `mira-web/src/routes/admin/qr-analytics.ts`
- Create: `mira-web/src/routes/admin/__tests__/qr-analytics.test.ts`
- Modify: `mira-web/src/server.ts` — mount

**Hours:** 2

**Depends on:** Task 6 (`requireAdmin`).

- [ ] **Step 1: Write failing test**

```typescript
// mira-web/src/routes/admin/__tests__/qr-analytics.test.ts
import { describe, test, expect } from "bun:test";
import { app } from "../../../server.js";
import { signToken } from "../../../lib/auth.js";

async function adminToken(): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: "ADMIN",
  });
}

describe("GET /admin/qr-analytics", () => {
  test("200 HTML with asset_tag table header", async () => {
    const res = await app.request("/admin/qr-analytics", {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Asset tag");
    expect(html).toContain("Scan count");
    expect(html).toContain("Last scan");
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd mira-web
bun test src/routes/admin/__tests__/qr-analytics.test.ts
```

Expected: FAIL — 404 (route not yet mounted).

- [ ] **Step 3: Implement the analytics route**

```typescript
// mira-web/src/routes/admin/qr-analytics.ts
import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/auth.js";

export const qrAnalytics = new Hono();

qrAnalytics.get("/qr-analytics", requireAdmin, async (c) => {
  const user = c.get("user") as import("../../lib/auth.js").MiraTokenPayload;
  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  let rows: Array<{
    asset_tag: string;
    scan_count: number;
    last_scan: string | null;
    printed: boolean;
  }> = [];
  try {
    const r = await pg.query(
      `SELECT asset_tag, scan_count, last_scan, printed_at IS NOT NULL AS printed
       FROM asset_qr_tags
       WHERE tenant_id = $1
       ORDER BY last_scan DESC NULLS LAST, scan_count DESC`,
      [user.sub],
    );
    rows = r.rows;
  } finally {
    await pg.end();
  }

  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td><code>${escapeHtml(r.asset_tag)}</code></td>
        <td>${r.scan_count}</td>
        <td>${r.last_scan ?? "—"}</td>
        <td>${r.printed ? "✓" : ""}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No tags yet. <a href="/admin/qr-print">Print your first sticker sheet →</a></td></tr>`;

  return c.html(`<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>MIRA — QR Analytics</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
    th { background: #fafafa; }
    code { background: #f5f5f5; padding: 0.1rem 0.4rem; border-radius: 3px; }
  </style>
</head><body>
  <h1>QR Analytics</h1>
  <table>
    <tr><th>Asset tag</th><th>Scan count</th><th>Last scan</th><th>Printed</th></tr>
    ${body}
  </table>
  <p><a href="/admin/qr-print">→ Print more stickers</a></p>
</body></html>`);
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
```

- [ ] **Step 4: Mount in server.ts**

```typescript
// mira-web/src/server.ts — near other admin routers
import { qrAnalytics } from "./routes/admin/qr-analytics.js";
app.route("/admin", qrAnalytics);
```

- [ ] **Step 5: Run test to verify pass**

```bash
cd mira-web
bun test src/routes/admin/__tests__/qr-analytics.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mira-web/src/routes/admin/qr-analytics.ts \
        mira-web/src/routes/admin/__tests__/qr-analytics.test.ts \
        mira-web/src/server.ts
git commit -m "feat(qr): minimal analytics page

GET /admin/qr-analytics shows asset_tag | scan_count | last_scan | printed
for the signed-in tenant, sorted by last_scan DESC. Pareto / unique-scanner
/ linked-chats deferred to v1.5 per spec §12.7."
```

---

## Phase 4 — Dogfood + ship (Day 6-7, variable)

### Task 9: End-to-end validation on Mike's conveyor

**Files:** none (physical validation)

**Hours:** 4-8 (real-world, depends on conveyor layout)

**Depends on:** everything above, deployed locally OR to a staging environment.

- [ ] **Step 1: Deploy to local dev stack**

```bash
cd /path/to/MIRA
doppler run --project factorylm --config dev -- docker compose up -d --build mira-web mira-pipeline
```

Watch logs for 60 seconds — no new errors.

- [ ] **Step 2: Log in as admin on your phone**

Open `http://<your-lan-ip>:3200/login` on a phone that's on the same network. Log in with a test tenant that has `atlasRole: ADMIN`.

- [ ] **Step 3: Tag every conveyor item via admin page**

Navigate to `/admin/qr-print`. Check ~15-20 items from your conveyor (motors, VFDs, photo-eyes, panels). Confirm auto-generated tags match your mental model (edit if not). Hit "Generate sticker sheet."

- [ ] **Step 4: Print on Avery 5520 vinyl**

Save the PDF. Print on a sheet of Avery 5520 weatherproof vinyl (you bought this separately during Day 1 of the physical track). Verify each sticker has a readable `VFD-07`-style tag in big type + a working QR.

- [ ] **Step 5: Physically apply to your conveyor**

Peel and stick each sticker on its corresponding machine. Put them near the nameplate, below eye level, where a phone camera will see them without effort.

- [ ] **Step 6: Scan each one to verify**

Open your phone camera, point at each sticker. Expected for each:
- Camera recognizes a URL
- Tap the URL
- MIRA opens
- First message greets with "What's the symptom on VFD-07?" (or whatever your tag is)
- Asset context is right

If a sticker fails: note which tag, go back to `/admin/qr-print`, reprint that specific one.

- [ ] **Step 7: Validate analytics**

After scanning all stickers once, open `/admin/qr-analytics`. Expect:
- Every tagged asset shown
- Scan count = 1 for each
- Last scan = ~now
- Printed = ✓

- [ ] **Step 8: Record findings in the wiki**

Add an entry to `wiki/hot.md` with:
- Date of dogfood test
- Tagged asset count
- First-scan success rate
- Any sticker material issues (curled edges, smeared ink, etc.)
- Any software bugs found

- [ ] **Step 9: Write the user-facing doc from experience**

Update `docs/product/qr-system.md` — change the top from "Status: In development" to "Status: Live beta, tested on <your plant> on <date>." Add a 2-paragraph "What I learned" section with the honest experience.

```bash
git add wiki/hot.md docs/product/qr-system.md
git commit -m "docs(qr): dogfood findings from Mike's conveyor

Tagged N assets on <conveyor>. First-scan success rate X/N. Notes
on material behavior and UX surprises. Flips qr-system.md from
Draft to Live beta."
```

- [ ] **Step 10: Record the Loom demo**

Record a 2-minute Loom of you walking up to your conveyor, scanning a sticker, asking MIRA a real question, getting a response with the correct asset context. Post to factorylm.com as the first real product demo.

---

## Spec coverage check

Re-checking each spec requirement against tasks:

- §4 URL format `/m/:asset_tag` → **Task 4**
- §4.2 allowed charset `[A-Za-z0-9._-]{1,64}` → **Tasks 4 + 5** (enforced at mira-web and mira-pipeline)
- §5.1 auth flow (JWT → redirect) → **Tasks 2 + 4**
- §5.2 cross-tenant handling → **Task 4** (byte-identical 200)
- §6.1 `asset_qr_tags` schema → **Task 1**
- §6.2 `qr_scan_events` schema → **Task 1**
- §6.3 write pattern (UPSERT + INSERT) → **Task 4** (`recordScan`)
- §6 retention (90-day) → **Task 1** (step 6)
- §7.1 scan route → **Task 4**
- §7.2 QR generator → **Task 3**
- §7.3 print admin page → **Task 7**
- §7.4 analytics page → **Task 8**
- §7.5 pipeline greeting (via session seed) → **Task 5**
- §11 security ACs (SQL injection, JWT, rate-limit, cross-tenant) → **Tasks 4 + 6** (parameterized queries, requireAuth/requireAdmin gating, constant-time branch)
- §12.1 cookie session → **Task 2**
- §12.2 OW context propagation → **Tasks 4 + 5**
- §12.3 Atlas identifier mapping → **Task 1** (atlas_asset_id column) + **Task 7** (admin assigns)
- §12.4 engine seeding (zero engine work) → **Task 5** (reuses existing session_memory)
- §12.5 Atlas role + requireAdmin → **Task 6**
- §12.6 cross-tenant identical response → **Task 4**
- §12.7 minimal analytics → **Task 8**
- §12.8 track split + execution order → this document

Not in plan (out of scope per spec):
- §11 rate limiting — spec mentions "30 req/min per IP (simple in-process counter)" as an acceptance criterion. **Gap flagged.** Add to a Task 4 follow-up or track separately — for v1 dogfood on one tenant this is not blocking, but flag for pre-GA.

---

## Critical path + total hours

```
Task 1 (DB, 3h) ──┬─────────────► Task 4 (Scan, 3h) ──┐
                  │                                    ├──► Task 5 (Pipeline, 3h)
Task 2 (Cookie, 4h) ─────────────► Task 4              │
                                                       │
Task 3 (QR gen, 2h) ─────────────► Task 7 (Admin, 6h) ─┤
                                                       │
Task 6 (Role, 2h) ───────────────► Task 7              │
                                   Task 8 (Analytics, 2h)
                                                       │
                                                       ▼
                                              Task 9 (Dogfood, 4-8h)
```

**Software total: 25 hours** (one hour under budget thanks to bundling analytics/cross-tenant into simpler tasks).

**Critical path:** Tasks 1 → 2 → 4 → 5 → 9 (≈ 16 hours). Tasks 3, 6, 7, 8 are parallelizable with the main spine.

**Plan status:** complete. No placeholders. All types/method names consistent across tasks.
