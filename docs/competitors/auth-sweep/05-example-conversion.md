# Auth-sweep — example before/after

Worked example: one of the converted routes from #574 chat threads. Shows
exactly what the codemod produces so you can sanity-check before applying
to all 13 branches.

## File

`mira-hub/src/app/api/v1/assets/[id]/chat/threads/route.ts`

## BEFORE (off `agent/issue-574-byo-llm-asset-chat-0331`)

```ts
// /api/v1/assets/[id]/chat/threads — list / create chat threads.
// Issue #574 — see docs/adr/0017-byo-llm-asset-chat.md

import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// TODO(#574): replace with shared auth helper.
function getTenantContext(req: Request): { tenantId: string } | null {
  const t = req.headers.get("x-tenant-id");
  return t ? { tenantId: t } : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = getTenantContext(req);
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: assetId } = await params;
  const { rows } = await pool.query(
    `SELECT id, asset_id, title, created_at
       FROM chat_threads
      WHERE tenant_id = $1 AND asset_id = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [ctx.tenantId, assetId],
  );
  return NextResponse.json({ items: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = getTenantContext(req);
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: assetId } = await params;
  const body = await req.json().catch(() => ({}));
  const title = (body.title ?? "Untitled thread").toString().slice(0, 200);

  const { rows } = await pool.query(
    `INSERT INTO chat_threads (tenant_id, asset_id, title)
     VALUES ($1, $2, $3)
     RETURNING id, asset_id, title, created_at`,
    [ctx.tenantId, assetId, title],
  );
  return NextResponse.json(rows[0], { status: 201 });
}
```

## AFTER (codemod output, no manual edits)

```ts
// /api/v1/assets/[id]/chat/threads — list / create chat threads.
// Issue #574 — see docs/adr/0017-byo-llm-asset-chat.md

import { NextResponse } from "next/server";
import { requireSession, withTenant } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);

  const { id: assetId } = await params;
  const { rows } = await withTenant(session, (client) =>
    client.query(
      `SELECT id, asset_id, title, created_at
         FROM chat_threads
        WHERE asset_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [assetId],
    ),
  );
  return NextResponse.json({ items: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);

  const { id: assetId } = await params;
  const body = await req.json().catch(() => ({}));
  const title = (body.title ?? "Untitled thread").toString().slice(0, 200);

  const { rows } = await withTenant(session, (client) =>
    client.query(
      `INSERT INTO chat_threads (tenant_id, asset_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, asset_id, title, created_at`,
      [session.tenantId, assetId, title],
    ),
  );
  return NextResponse.json(rows[0], { status: 201 });
}
```

## What the codemod did, line-by-line

| Change | Line(s) BEFORE | Line(s) AFTER | Reason |
|---|---|---|---|
| Removed import | `import pool from "@/lib/db";` | gone | nothing references `pool` anymore |
| Added imports | n/a | `import { requireSession, withTenant } from "@/lib/auth/session";` | centralised helpers |
| Removed stub | 9-line `function getTenantContext` + `// TODO` | gone | superseded by `requireSession` |
| Replaced check | `const ctx = getTenantContext(req); if (!ctx) return 401;` | `const session = await requireSession(req);` | throws `HttpAuthError(401)` if no session |
| Wrapped GET query | `await pool.query(...)` | `await withTenant(session, (client) => client.query(...))` | sets `mira.tenant_id` GUC for RLS |
| Wrapped POST query | same | same | same |
| Removed app-side filter | `WHERE tenant_id = $1 AND asset_id = $2` + `[ctx.tenantId, assetId]` | `WHERE asset_id = $1` + `[assetId]` | RLS enforces it |
| Renamed reference | `ctx.tenantId` | `session.tenantId` | only on the INSERT — POST writes still need `tenant_id` explicitly because RLS WITH CHECK validates the column equals `current_setting('mira.tenant_id')` |

## Where the codemod refused — and why

For #574 specifically, the codemod will mark these for manual review:

```
mira-hub/src/app/api/v1/assets/[id]/chat/route.ts    pool.connect() — wrap manually with withTenant()
```

The chat route uses `pool.connect()` for the SSE streaming case where the
client is held across the entire response. This is a real concern (the
GUC needs to be set inside the same connection that streams), but the
codemod can't blindly rewrite a multi-statement handler. Convert by hand:

```ts
// Before: const client = await pool.connect();
// After:
return withTenant(session, async (client) => {
  // ... existing handler body using `client` ...
  // Note: response streaming via Response/ReadableStream is fine inside
  // withTenant — the BEGIN/COMMIT wraps whatever the handler returns.
  return new Response(stream, { headers: { ... } });
});
```

`withTenant` resolves with whatever `fn` returns, so returning a
`Response` is supported.

## Quick verify after applying

```bash
cd mira-hub
git diff --stat              # confirm only routes changed
grep -r 'getTenantContext'   # should print nothing
grep -r 'x-tenant-id' src/app/api  # should print nothing
npx tsc --noEmit -p .
npx eslint src --max-warnings 0
npx vitest run src/lib/auth/__tests__
```

If `tsc` reports `'session' is declared but its value is never read`, the
codemod produced an unused binding (rare). Either the route had a stub
that was never wired, or you can safely remove the line.
