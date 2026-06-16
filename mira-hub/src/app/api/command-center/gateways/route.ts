import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// Default Ignition gateway HTTP port.
const IGNITION_PORT = 8088;
// Short timeout so the modal doesn't hang if the gateway is unreachable.
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Extract the bare host from a "host" or "host:port" string.
 * Returns null for malformed values (scheme present, whitespace, etc.).
 */
function parseGatewayHost(raw: string): string | null {
  if (!raw || /[\s/]/.test(raw) || raw.includes("://")) return null;
  // Strip optional port suffix — host:port → host
  const colonIdx = raw.lastIndexOf(":");
  return colonIdx === -1 ? raw : raw.slice(0, colonIdx);
}

/**
 * SSRF guard: block link-local/unspecified addresses (same policy as
 * display-registration.ts). Legit plant LAN (10.x, 192.168.x, Tailscale
 * CGNAT 100.64/10) are allowed; the full prod lockdown is
 * COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST.
 */
function isLinkLocalHost(host: string): boolean {
  const lc = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    /^169\.254\./.test(host) ||
    /^fe80:/.test(lc) ||
    host === "0.0.0.0" ||
    lc === "::"
  );
}

/**
 * Probe the gateway's status endpoint. Returns true if the gateway responds
 * with any non-5xx status. A redirect (3xx) counts as up — Ignition's gateway
 * login page responds 302 for unauthenticated requests.
 *
 * gateway_hostname from plg_activation_codes may be "host" or "host:port".
 * Returns false (skips probe) for link-local addresses or hosts not in
 * COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST when that env var is set.
 */
async function isGatewayOnline(hostname: string): Promise<boolean> {
  const host = parseGatewayHost(hostname);
  if (!host || isLinkLocalHost(host)) return false;

  // SSRF lockdown: reuse the same allowlist env var as the display route.
  // When set, only probe gateways whose host appears in the allowlist.
  const allow = (process.env.COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes(host)) return false;

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
