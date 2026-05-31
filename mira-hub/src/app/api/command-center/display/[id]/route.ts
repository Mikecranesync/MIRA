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
 * CLOUD-REACH PHASE (Phase 2): the cloud Hub's browser can't reach a LAN HMI or
 * Charlie's Tailscale IP, so a 302 to host:port is useless. When
 * COMMAND_CENTER_CLOUD_PROXY is set, this route instead 302s to a SAME-ORIGIN
 * relative path `${CLOUD_PROXY_PREFIX}/{id}/{path}` (default `/cc-display`). VPS
 * nginx owns that prefix: it `auth_request`s `…/display/{id}/authz` (per-tenant)
 * then proxy_passes (HTTP+WS) to Charlie's mira-proxy over Tailscale, which holds
 * the display_endpoints host allowlist. Everything the browser sees is same-origin
 * HTTPS → no mixed-content, frame-src 'self' suffices, WS works (nginx, not this
 * route, carries the upgrade). Same route contract + same iframe src, no client rework.
 *
 * READ-ONLY: only GET is exported. POST/PUT/PATCH/DELETE → 405. This route never
 * forwards a control action to a panel (.claude/rules/fieldbus-readonly.md).
 */
const CLOUD_PROXY = process.env.COMMAND_CENTER_CLOUD_PROXY === "1";
const CLOUD_PROXY_PREFIX = process.env.COMMAND_CENTER_CLOUD_PROXY_PREFIX ?? "/cc-display";

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

    const path = row.path.startsWith("/") ? row.path : `/${row.path}`;

    if (CLOUD_PROXY) {
      // Phase 2: 302 to a same-origin relative path that VPS nginx owns (auth_request
      // + WS-native proxy_pass to Charlie). Never expose host:port to the client.
      // The display path is preserved so the HMI's relative assets + socket resolve.
      // Relative Location so it resolves against the request's own origin behind
      // the VPS (https://app.factorylm.com) — no hardcoded host/scheme.
      const target = `${CLOUD_PROXY_PREFIX}/${id}${path}`;
      return new NextResponse(null, { status: 302, headers: { Location: target } });
    }

    // Phase 1 (local Charlie Hub): browser is on the LAN, 302 straight to the HMI.
    const portPart = row.port ? `:${row.port}` : "";
    const target = `${row.scheme}://${row.host}${portPart}${path}`;
    return NextResponse.redirect(target, 302);
  } catch (err) {
    console.error("[api/command-center/display GET]", err);
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
