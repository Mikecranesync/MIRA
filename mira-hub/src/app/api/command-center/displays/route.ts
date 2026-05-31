import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Command Center display registry — list + create (Phase 2 CRUD).
 *
 * Goal prompt: ~/.claude/plans/polymorphic-wandering-dahl.md (Phase 2: "register
 * arbitrary web HMIs by host/IP"). Backs the Command Center settings UI.
 *
 * RLS-scoped to the session tenant. uns_path is the canonical key (UNS-compliance
 * rule); equipment_id is an optional soft link. Read-only product still applies:
 * this registers WHERE to *watch* a display, never a control endpoint
 * (.claude/rules/fieldbus-readonly.md). After a mutation, the operator regenerates
 * the mira-proxy allowlist (mira-proxy/gen_allowlist.py) so the new host becomes
 * reachable through the cloud proxy — the registry is the allowlist's source.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPLAY_TYPES = new Set(["web_iframe", "nodered", "signals", "vnc"]);
const SCHEMES = new Set(["http", "https"]);
// host = LAN IP / hostname / docker service name. No scheme, path, or spaces — those
// are separate columns; this keeps the SSRF allowlist entries clean (host:port only).
const HOST_RE = /^[a-zA-Z0-9._-]+$/;

interface DisplayRow {
  id: string;
  uns_path: string | null;
  equipment_id: string | null;
  display_type: string;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
  label: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<DisplayRow>(
        `SELECT id, uns_path::text AS uns_path, equipment_id, display_type,
                scheme, host, port, path, label, enabled,
                created_at, updated_at
           FROM display_endpoints
          ORDER BY uns_path NULLS LAST, label`,
      );
      return res.rows;
    });
    return NextResponse.json({ displays: rows, total: rows.length });
  } catch (err) {
    console.error("[api/command-center/displays GET]", err);
    return NextResponse.json({ error: "List failed" }, { status: 500 });
  }
}

interface CreateBody {
  uns_path?: string;
  equipment_id?: string;
  display_type?: string;
  scheme?: string;
  host?: string;
  port?: number;
  path?: string;
  label?: string;
  enabled?: boolean;
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const v = validate(body, { requireKey: true });
  if (v.error) return NextResponse.json({ error: v.error }, { status: 422 });

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // If keyed by uns_path, ensure that node exists for this tenant (keeps the
      // registry addressable in the namespace, per the spec).
      if (v.uns_path) {
        const node = await c.query(
          `SELECT 1 FROM kg_entities WHERE tenant_id = $1::uuid AND uns_path = $2::ltree LIMIT 1`,
          [ctx.tenantId, v.uns_path],
        );
        if (node.rowCount === 0) return { kind: "uns_not_found" as const };
      }
      const ins = await c.query<{ id: string }>(
        `INSERT INTO display_endpoints
            (tenant_id, uns_path, equipment_id, display_type, scheme, host, port, path, label, enabled, created_by)
         VALUES ($1::uuid, $2::ltree, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid)
         RETURNING id`,
        [
          ctx.tenantId, v.uns_path, v.equipment_id, v.display_type, v.scheme,
          // created_by is a UUID column; only pass a UUID session id, else NULL
          // (audit-only field — don't 500 the create over it).
          v.host, v.port, v.path, v.label, v.enabled,
          UUID_RE.test(ctx.userId ?? "") ? ctx.userId : null,
        ],
      );
      return { kind: "ok" as const, id: ins.rows[0].id };
    });

    if (result.kind === "uns_not_found") {
      return NextResponse.json({ error: "uns_path has no matching namespace node" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (err: unknown) {
    // unique (tenant_id, uns_path) collision → 409
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return NextResponse.json({ error: "a display already exists for this uns_path" }, { status: 409 });
    }
    console.error("[api/command-center/displays POST]", err);
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }
}

// Shared validation for create/update. Exported so the [id] PATCH route reuses it.
export function validate(
  b: CreateBody,
  opts: { requireKey: boolean },
): {
  error?: string;
  uns_path: string | null;
  equipment_id: string | null;
  display_type: string;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
  label: string | null;
  enabled: boolean;
} {
  const uns_path = b.uns_path?.trim() || null;
  const equipment_id = b.equipment_id?.trim() || null;
  const bail = (error: string) =>
    ({ error, uns_path: null, equipment_id: null, display_type: "", scheme: "", host: "", port: null, path: "", label: null, enabled: false });

  if (opts.requireKey && !uns_path && !equipment_id) {
    return bail("either uns_path or equipment_id is required");
  }
  if (equipment_id && !/^[0-9a-f-]{36}$/i.test(equipment_id)) return bail("invalid equipment_id");

  const display_type = (b.display_type?.trim() || "web_iframe");
  if (!DISPLAY_TYPES.has(display_type)) return bail(`invalid display_type (one of ${[...DISPLAY_TYPES].join(", ")})`);

  const scheme = (b.scheme?.trim() || "http").toLowerCase();
  if (!SCHEMES.has(scheme)) return bail("scheme must be http or https");

  const host = b.host?.trim() || "";
  if (!host) return bail("host is required");
  if (!HOST_RE.test(host)) return bail("host must be a bare hostname/IP (no scheme, path, or spaces)");

  let port: number | null = null;
  if (b.port != null) {
    port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return bail("port must be 1–65535");
  }

  let path = b.path?.trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;

  const label = b.label?.trim() || null;
  const enabled = b.enabled !== false; // default true

  return { uns_path, equipment_id, display_type, scheme, host, port, path, label, enabled };
}
