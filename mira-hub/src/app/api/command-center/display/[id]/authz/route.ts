import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Command Center display AUTHZ subrequest (cloud-reach phase).
 *
 * Goal prompt: ~/.claude/plans/polymorphic-wandering-dahl.md (Phase 2).
 *
 * The VPS nginx fronts the cloud display path with `auth_request` pointing here:
 *
 *   location ~ ^/api/command-center/display/(?<id>...)/stream {
 *     auth_request /api/command-center/display/$id/authz;   # ← this route
 *     proxy_pass http://<charlie-tailscale-ip>:8889/display/$id$rest;  # WS-native
 *   }
 *
 * This route answers ONLY "may the CURRENT session's tenant watch THIS display?":
 *   200 → yes (row exists for the tenant via RLS, enabled)
 *   401 → no session
 *   403 → session, but display disabled or not visible to this tenant
 *
 * Separation of concerns (decided with the operator):
 *   - Hub owns PER-TENANT authz (this route, RLS-scoped).
 *   - Charlie's mira-proxy owns the SSRF host allowlist (which host:port is
 *     reachable at all) — sourced from display_endpoints, never client input.
 * nginx does the transport (WS upgrades) because a Next route handler can't.
 *
 * Body-less by design: auth_request ignores the body and only reads the status.
 * Never leaks host/port (that lives in the proxy's generated allowlist).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return new NextResponse(null, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return new NextResponse(null, { status: 403 });

  try {
    const ok = await withTenantContext(ctx.tenantId, async (c) => {
      // RLS scopes this to the session tenant; enabled gate enforced here.
      const res = await c.query<{ enabled: boolean }>(
        `SELECT enabled FROM display_endpoints WHERE id = $1::uuid`,
        [id],
      );
      const row = res.rows[0];
      return Boolean(row && row.enabled);
    });
    return new NextResponse(null, { status: ok ? 200 : 403 });
  } catch (err) {
    console.error("[api/command-center/display authz]", err);
    return new NextResponse(null, { status: 403 }); // fail-closed
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
