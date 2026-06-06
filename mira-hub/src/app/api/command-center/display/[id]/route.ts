import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Command Center display resolver.
 *
 * Goal prompt: ~/.claude/plans/polymorphic-wandering-dahl.md
 *
 * The Command Center page frames `/api/command-center/display/{id}`. This route
 * resolves the registry row (tenant-scoped via RLS, must be enabled) and, for
 * PHASE 1 (local Charlie Hub, on the same LAN as the HMI), 302-redirects the
 * iframe to the display's own URL. The browser then talks to the HMI directly —
 * so its WebSocket/live updates work, which a Next.js route handler could NOT
 * proxy (route handlers don't handle WS upgrades; a fetch-and-stream proxy would
 * render a frozen page). See the goal prompt's "transparent + WS-capable" note.
 *
 * CLOUD-REACH PHASE (later): the cloud Hub's browser can't reach a LAN HMI, so
 * this route's redirect target changes to the on-prem WS-capable reverse proxy
 * on Charlie (nginx, over Tailscale) — same route contract, no client rework.
 * (Also handle http→https mixed-content there: a https Hub can't frame a http
 * HMI; the proxy terminates TLS.)
 *
 * READ-ONLY: only GET is exported. POST/PUT/PATCH/DELETE → 405. This route never
 * forwards a control action to a panel (.claude/rules/fieldbus-readonly.md).
 */

interface DisplayEndpointRow {
  scheme: string;
  host: string;
  port: number | null;
  path: string;
  enabled: boolean;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid display id" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<DisplayEndpointRow>(
        `SELECT scheme, host, port, path, enabled
           FROM display_endpoints
          WHERE id = $1::uuid`,
        [id],
      );
      return res.rows[0] ?? null;
    });

    if (!row) {
      return NextResponse.json({ error: "Display not found" }, { status: 404 });
    }
    if (!row.enabled) {
      return NextResponse.json({ error: "Display disabled" }, { status: 404 });
    }

    const portPart = row.port ? `:${row.port}` : "";
    const path = row.path.startsWith("/") ? row.path : `/${row.path}`;
    const target = `${row.scheme}://${row.host}${portPart}${path}`;

    return NextResponse.redirect(target, 302);
  } catch (err) {
    console.error("[api/command-center/display GET]", err);
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
