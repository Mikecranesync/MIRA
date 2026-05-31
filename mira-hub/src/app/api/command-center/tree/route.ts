import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { buildTree, type NamespaceNode } from "@/app/api/namespace/tree/route";

export const dynamic = "force-dynamic";

/**
 * Command Center tree — the namespace tree annotated with live-display info.
 *
 * Goal prompt: ~/.claude/plans/polymorphic-wandering-dahl.md
 *
 * Reuses the /api/namespace/tree query + buildTree() (single source of truth
 * for the UNS tree shape), then layers on, per node:
 *   - hasLiveDisplay / displayId / displayType — does this UNS node have an
 *     enabled row in display_endpoints?
 *   - live — is that display reachable RIGHT NOW? This is the green dot. We do
 *     a short server-side GET of the display URL (concurrent, ~2s timeout,
 *     cached ~10s). A response = green; refused/timeout = gray. This measures
 *     "is there a live display to watch", which is the asked-for semantic —
 *     NOT PLC-signal freshness and NOT equipment running/fault state.
 *
 * Read-only. No mutations live here.
 */

const PROBE_TIMEOUT_MS = 2_000;
const PROBE_CACHE_MS = 10_000;

// Cloud-reach phase: the Hub server (prod VPS) cannot reach a plant-LAN HMI directly
// (RFC1918, no accept-routes), so probing the raw host:port always reads gray there.
// When CLOUD_PROXY is on, probe THROUGH Charlie's on-prem proxy over Tailscale — the
// SAME hop the iframe uses — so liveness reflects the real watch path. Symmetric with
// the display/[id] redirect switch. CC_PROXY_BASE is Charlie's Tailscale proxy origin
// (e.g. http://100.70.49.126:8889); the proxy resolves {displayId} via its allowlist.
const CLOUD_PROXY = process.env.COMMAND_CENTER_CLOUD_PROXY === "1";
const CC_PROXY_BASE = (process.env.COMMAND_CENTER_PROXY_BASE ?? "").replace(/\/$/, "");

interface KgEntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  uns_path: string | null;
  created_at: string;
  files_count: string;
  equipment_status: string | null;
}

interface ProposalCountRow {
  uns_path: string | null;
  status: string;
  cnt: string;
}

interface DisplayRow {
  id: string;
  uns_path: string | null;
  display_type: string;
  label: string | null;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
}

export interface CommandCenterNode extends NamespaceNode {
  hasLiveDisplay: boolean;
  displayId: string | null;
  displayType: string | null;
  displayLabel: string | null;
  live: boolean;
  children: CommandCenterNode[];
}

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const entitiesRes = await c.query<KgEntityRow>(
        `SELECT
            e.id,
            e.entity_type,
            e.entity_id,
            e.name,
            e.uns_path::text AS uns_path,
            e.created_at,
            (SELECT COUNT(*) FROM namespace_direct_uploads ndu
             WHERE ndu.node_id = e.id AND ndu.tenant_id = e.tenant_id)::text AS files_count,
            NULL AS equipment_status
         FROM kg_entities e
         WHERE e.tenant_id = $1::uuid
         ORDER BY e.uns_path::text NULLS LAST, e.name`,
        [ctx.tenantId],
      );

      const proposalsRes = await c.query<ProposalCountRow>(
        `SELECT
            COALESCE(e.uns_path::text, '') AS uns_path,
            p.status,
            COUNT(*)::text AS cnt
         FROM relationship_proposals p
         LEFT JOIN kg_entities e ON e.id = p.source_entity_id
         WHERE p.tenant_id = $1::uuid
         GROUP BY e.uns_path::text, p.status`,
        [ctx.tenantId],
      );

      const displaysRes = await c.query<DisplayRow>(
        `SELECT id, uns_path::text AS uns_path, display_type, label,
                scheme, host, port, path
           FROM display_endpoints
          WHERE tenant_id = $1::uuid AND enabled = true`,
        [ctx.tenantId],
      );

      return {
        entities: entitiesRes.rows,
        proposals: proposalsRes.rows,
        displays: displaysRes.rows,
      };
    });

    // Probe every display's reachability concurrently (cached ~10s).
    const liveness = new Map<string, boolean>();
    await Promise.all(
      result.displays.map(async (d) => {
        liveness.set(d.id, await probe(d));
      }),
    );

    const baseNodes = buildTree(result.entities, result.proposals);

    const displaysByPath = new Map<string, DisplayRow>();
    for (const d of result.displays) {
      if (d.uns_path) displaysByPath.set(d.uns_path, d);
    }

    const nodes = baseNodes.map((n) => annotate(n, displaysByPath, liveness));
    const liveCount = [...liveness.values()].filter(Boolean).length;

    return NextResponse.json({
      nodes,
      total: result.entities.length,
      displaysTotal: result.displays.length,
      liveCount,
    });
  } catch (err) {
    console.error("[api/command-center/tree GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function annotate(
  node: NamespaceNode,
  displaysByPath: Map<string, DisplayRow>,
  liveness: Map<string, boolean>,
): CommandCenterNode {
  const d = node.unsPath ? displaysByPath.get(node.unsPath) : undefined;
  return {
    ...node,
    hasLiveDisplay: !!d,
    displayId: d?.id ?? null,
    displayType: d?.display_type ?? null,
    displayLabel: d?.label ?? null,
    live: d ? (liveness.get(d.id) ?? false) : false,
    children: node.children.map((c) => annotate(c, displaysByPath, liveness)),
  };
}

// ── Reachability probe ────────────────────────────────────────────────────────
// "Is there a live display to watch?" = can the server reach the display URL.
// Phase 1 (local Charlie Hub) probes the host directly; the cloud-reach phase
// probes via the on-prem proxy (same URL the iframe is redirected to). The host
// stored must be reachable from the Hub server; for the local tracer bullet the
// Charlie LAN IP is reachable from both the server and the LAN browser.

const probeCache = new Map<string, { at: number; url: string; live: boolean }>();

async function probe(d: DisplayRow): Promise<boolean> {
  const path = d.path.startsWith("/") ? d.path : `/${d.path}`;

  // Cloud mode: probe THROUGH the proxy (the same hop the iframe uses), since the
  // raw LAN host is unreachable from the prod Hub server. Falls back to the direct
  // host if the proxy base isn't configured (so a misconfig reads gray, not green).
  let url: string;
  if (CLOUD_PROXY && CC_PROXY_BASE) {
    url = `${CC_PROXY_BASE}/display/${d.id}${path}`;
  } else {
    const portPart = d.port ? `:${d.port}` : "";
    url = `${d.scheme}://${d.host}${portPart}${path}`;
  }

  const now = Date.now();
  const cached = probeCache.get(d.id);
  if (cached && cached.url === url && now - cached.at < PROBE_CACHE_MS) {
    return cached.live;
  }

  let live = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // Any HTTP response (incl. 3xx/4xx) means something is listening = watchable.
    // redirect:'manual' so a dashboard redirect counts as up without a second hop.
    await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
    live = true;
  } catch {
    live = false; // connection refused / DNS / timeout
  } finally {
    clearTimeout(timer);
  }

  probeCache.set(d.id, { at: now, url, live });
  return live;
}
