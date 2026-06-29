import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";
import { isGatewayOnline, probeUrlReachable } from "@/lib/gateway-probe";
import {
  freshnessCounts,
  type FreshnessTagRow,
  tagStatuses,
} from "@/lib/command-center-freshness";
import { buildCommissioningStatus } from "@/lib/commissioning";

export const dynamic = "force-dynamic";

/**
 * GET /api/command-center/commissioning
 *
 * Read-only remote-commissioning status for the current tenant: assembles the
 * signals the Hub ALREADY collects into one checklist a user in Orlando reads to
 * know whether the customer-site connector is ready, and what still needs doing
 * on-site. Pure assembly of the existing loop (ignition/ edge → mira-web claim →
 * mira-relay ingest → mira-hub) — NOT a new connector/relay/claim system.
 *
 * Reuses:
 *   - plg_activation_codes        (claim/online — same query as /gateways)
 *   - lib/gateway-probe           (gateway + display reachability probe)
 *   - approved_tags               (allowlist count — ingest is fail-closed)
 *   - live_signal_cache           (tag freshness via command-center-freshness)
 *   - kg_entities                 (equipment / UNS binding for Ask-MIRA)
 *   - display_endpoints           (live display reachability)
 *
 * GET-only. No mutations. Tenant-scoped throughout (one customer's connector
 * cannot read another's — RLS + explicit tenant_id predicates).
 */

interface GatewayRow {
  gateway_hostname: string;
  agent_id: string | null;
  created_at: string;
}

interface DisplayRow {
  id: string;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
}

interface CountsRow {
  approved_tags: number;
  equipment_total: number;
  equipment_with_uns: number;
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    // Claim/connector rows live in plg_activation_codes (no RLS → pool direct,
    // tenant_id is TEXT holding the UUID string). Same shape as /gateways.
    let gatewayRows: GatewayRow[];
    {
      const client = await pool.connect();
      try {
        const res = await client.query<GatewayRow>(
          `SELECT DISTINCT ON (gateway_hostname)
                  gateway_hostname, agent_id, created_at
             FROM plg_activation_codes
            WHERE tenant_id = $1
              AND activated = true
              AND gateway_hostname IS NOT NULL
              AND gateway_hostname != 'unknown'
            ORDER BY gateway_hostname, created_at DESC`,
          [ctx.tenantId],
        );
        gatewayRows = res.rows;
      } finally {
        client.release();
      }
    }

    // Tenant-scoped signals (RLS): approved-tag count, equipment/UNS binding,
    // enabled displays. live_signal_cache freshness fetched in its own guarded
    // block (migration 036 may lag on a fresh env — degrade, don't 500).
    const scoped = await withTenantContext(ctx.tenantId, async (c) => {
      const counts = await c.query<CountsRow>(
        `SELECT
            (SELECT COUNT(*) FROM approved_tags
              WHERE tenant_id = $1::uuid AND enabled = true)::int AS approved_tags,
            (SELECT COUNT(*) FROM kg_entities
              WHERE tenant_id = $1::uuid
                AND entity_type IN ('equipment','component'))::int AS equipment_total,
            (SELECT COUNT(*) FROM kg_entities
              WHERE tenant_id = $1::uuid
                AND entity_type IN ('equipment','component')
                AND uns_path IS NOT NULL)::int AS equipment_with_uns`,
        [ctx.tenantId],
      );
      const displays = await c.query<DisplayRow>(
        `SELECT id, scheme, host, port, path
           FROM display_endpoints
          WHERE tenant_id = $1::uuid AND enabled = true`,
        [ctx.tenantId],
      );
      return { counts: counts.rows[0], displays: displays.rows };
    });

    // Gateway reachability (concurrent, ~2s timeout each via the shared probe).
    const gateways = await Promise.all(
      gatewayRows.map(async (r) => ({
        hostname: r.gateway_hostname,
        agentId: r.agent_id,
        activatedAt: r.created_at,
        online: await isGatewayOnline(r.gateway_hostname),
      })),
    );
    const onlineGatewayCount = gateways.filter((g) => g.online).length;

    // Display reachability (concurrent) — same read-only probe.
    const reachableDisplayCount = (
      await Promise.all(
        scoped.displays.map(async (d) => {
          const portPart = d.port ? `:${d.port}` : "";
          const path = d.path.startsWith("/") ? d.path : `/${d.path}`;
          return probeUrlReachable(`${d.scheme}://${d.host}${portPart}${path}`);
        }),
      )
    ).filter(Boolean).length;

    // Tag freshness from live_signal_cache (guarded — see migration 036 note).
    let counts = { live: 0, stale: 0, simulated: 0 };
    try {
      const freshRows = await withTenantContext(ctx.tenantId, async (c) => {
        const res = await c.query<FreshnessTagRow>(
          `SELECT uns_path::text AS uns_path, last_seen_at, simulated, expected_freshness_seconds
             FROM live_signal_cache
            WHERE tenant_id = $1::uuid AND uns_path IS NOT NULL`,
          [ctx.tenantId],
        );
        return res.rows;
      });
      counts = freshnessCounts(tagStatuses(freshRows, Date.now()));
    } catch (err) {
      console.warn("[api/command-center/commissioning] freshness unavailable (migration 036?)", err);
    }

    const status = buildCommissioningStatus({
      gatewayCount: gateways.length,
      onlineGatewayCount,
      boundEquipmentCount: scoped.counts.equipment_total,
      resolvableUnsCount: scoped.counts.equipment_with_uns,
      approvedTagCount: scoped.counts.approved_tags,
      displayCount: scoped.displays.length,
      reachableDisplayCount,
      freshness: counts,
    });

    return NextResponse.json({
      gateways,
      status,
      counts: {
        gateways: gateways.length,
        onlineGateways: onlineGatewayCount,
        boundEquipment: scoped.counts.equipment_total,
        equipmentWithUns: scoped.counts.equipment_with_uns,
        approvedTags: scoped.counts.approved_tags,
        displays: scoped.displays.length,
        reachableDisplays: reachableDisplayCount,
      },
      freshnessCounts: counts,
    });
  } catch (err) {
    console.error("[api/command-center/commissioning GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
