import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Default Ignition gateway HTTP port.
const IGNITION_PORT = 8088;
// Short timeout so the modal doesn't hang if the gateway is unreachable.
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Probe the gateway's status endpoint. Returns true if the gateway responds
 * with any non-5xx status. A redirect (3xx) counts as up — Ignition's gateway
 * login page responds 302 for unauthenticated requests.
 *
 * gateway_hostname from plg_activation_codes may be "host" or "host:port".
 */
async function isGatewayOnline(hostname: string): Promise<boolean> {
  const hasPort = hostname.includes(":");
  const base = hasPort
    ? `http://${hostname}`
    : `http://${hostname}:${IGNITION_PORT}`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${base}/main`, {
      signal: ctl.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

export interface GatewayEntry {
  hostname: string;
  agentId: string | null;
  activatedAt: string;
  online: boolean;
}

/**
 * GET /api/command-center/gateways
 *
 * Returns the list of Ignition gateways that have activated MIRA Connect for
 * this tenant (from plg_activation_codes), each annotated with a live HTTP
 * reachability probe.
 *
 * plg_activation_codes.tenant_id is TEXT holding the same UUID string as
 * ctx.tenantId — no cast needed, TEXT = 'some-uuid-string' comparison works.
 * The table has no RLS so we use the pool directly (neondb_owner).
 */
export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let rows: Array<{ gateway_hostname: string; agent_id: string | null; created_at: string }>;
  try {
    const client = await pool.connect();
    try {
      const res = await client.query<{
        gateway_hostname: string;
        agent_id: string | null;
        created_at: string;
      }>(
        `SELECT DISTINCT ON (gateway_hostname)
                gateway_hostname,
                agent_id,
                created_at
           FROM plg_activation_codes
          WHERE tenant_id = $1
            AND activated  = true
            AND gateway_hostname IS NOT NULL
            AND gateway_hostname != 'unknown'
          ORDER BY gateway_hostname, created_at DESC`,
        [ctx.tenantId],
      );
      rows = res.rows;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[api/command-center/gateways]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const gateways: GatewayEntry[] = await Promise.all(
    rows.map(async (r) => ({
      hostname: r.gateway_hostname,
      agentId: r.agent_id,
      activatedAt: r.created_at,
      online: await isGatewayOnline(r.gateway_hostname),
    })),
  );

  return NextResponse.json({ gateways });
}
