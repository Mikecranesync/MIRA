import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { validateDisplayRegistration } from "@/lib/display-registration";

export const dynamic = "force-dynamic";

/**
 * Command Center display registry — collection route.
 *
 *   GET  → list the tenant's enabled displays (for the onboarding UI + tests).
 *   POST → register/lock a live display on a UNS node (the onboarding flow).
 *
 * The item resolver (GET → 302 to the HMI) lives in display/[id]/route.ts.
 *
 * "Locked" = once registered, the row lives in display_endpoints (a durable,
 * tenant-scoped table) and persists across reload, refresh, polling, seed
 * refresh (the seed upserts, never deletes), and namespace rebuilds (those
 * rebuild kg_entities, not this table). Nothing in the codebase disables or
 * deletes a display row, so a registered display stays put. Caveat: the join
 * to a node is by uns_path; if a namespace rebuild reparents a node to a NEW
 * uns_path, the display would need re-pointing (equipment_id fallback is the
 * future lever — display_endpoints.equipment_id already exists).
 *
 * READ-ONLY doctrine (.claude/rules/fieldbus-readonly.md): this stores only
 * where to *watch* a display — never a control endpoint. Registering a watch
 * URL is independent of the train-before-deploy agent-answer gate; it does not
 * authorize an asset agent to answer on the HMI.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DisplayListRow {
  id: string;
  uns_path: string | null;
  display_type: string;
  label: string | null;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
  node_name: string | null;
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<DisplayListRow>(
        `SELECT d.id, d.uns_path::text AS uns_path, d.display_type, d.label,
                d.scheme, d.host, d.port, d.path,
                e.name AS node_name
           FROM display_endpoints d
           LEFT JOIN kg_entities e
             ON e.tenant_id = d.tenant_id AND e.uns_path = d.uns_path
          WHERE d.tenant_id = $1::uuid AND d.enabled = true
          ORDER BY d.uns_path::text NULLS LAST`,
        [ctx.tenantId],
      );
      return res.rows;
    });
    return NextResponse.json({ displays: rows });
  } catch (err) {
    console.error("[api/command-center/display GET list]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateDisplayRegistration(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const { unsPath, host, scheme, port, path, displayType, label } = v.value;

  // SSRF lockdown for prod: when set, the registered host MUST be in the
  // operator allowlist (the tree route server-side-probes it). Unset = no
  // restriction beyond the validator's link-local block (dev/bench). A future
  // admin-role gate is blocked on #578 (Session.role is hardcoded "member").
  const allow = (process.env.COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length > 0 && !allow.includes(host)) {
    return NextResponse.json(
      { error: "host is not in the configured display host allowlist" },
      { status: 400 },
    );
  }

  const createdBy = UUID_RE.test(ctx.userId) ? ctx.userId : null;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // The display must attach to a real namespace node owned by this tenant.
      const exists = await c.query(
        `SELECT 1 FROM kg_entities
          WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
          LIMIT 1`,
        [ctx.tenantId, unsPath],
      );
      if (exists.rows.length === 0) return { notFound: true as const };

      // Upsert by (tenant_id, uns_path) — re-registering the same node updates
      // it in place (never duplicates, never deletes). Matches the seed.
      const res = await c.query(
        `INSERT INTO display_endpoints
            (tenant_id, uns_path, display_type, scheme, host, port, path, label, enabled, created_by)
         VALUES ($1::uuid, $2::ltree, $3, $4, $5, $6, $7, $8, true, $9)
         ON CONFLICT (tenant_id, uns_path) WHERE uns_path IS NOT NULL
         DO UPDATE SET
            display_type = EXCLUDED.display_type,
            scheme = EXCLUDED.scheme,
            host = EXCLUDED.host,
            port = EXCLUDED.port,
            path = EXCLUDED.path,
            label = EXCLUDED.label,
            enabled = true,
            updated_at = now()
         RETURNING id, uns_path::text AS uns_path, display_type, label,
                   scheme, host, port, path`,
        [ctx.tenantId, unsPath, displayType, scheme, host, port, path, label, createdBy],
      );
      return { row: res.rows[0] };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: `No namespace node at UNS path "${unsPath}". Build the namespace first.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ display: result.row }, { status: 201 });
  } catch (err) {
    console.error("[api/command-center/display POST register]", err);
    return NextResponse.json({ error: "Register failed" }, { status: 500 });
  }
}
