import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { sessionOr401 } from "@/lib/session";
import { trialAccessDecision } from "@/capabilities/trial-access";
import { withTenantContext } from "@/lib/tenant-context";
import { notebookReadProjection as notebook, readNotebookHeader } from "@/lib/equipment-notebooks";
import { threadKeyOf } from "@/capabilities/bench-components/http";
import { componentReadProjection as component, readComponent } from "@/capabilities/bench-components/store";

const kinds = ["namespace", "asset", "notebook", "notebook_component", "installed_instance"] as const;
type Kind = typeof kinds[number];
type ParentKind = "root" | "namespace" | "asset" | "notebook";
type Actor = { tenantId: string; userId: string; role?: string };
type Scope = { kind: ParentKind; id: string | null };
type InventoryRow = { kind: Kind; id: string; name: string; parent_kind: ParentKind; parent_id: string | null; data: Record<string, unknown>; child_count?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class BrowserError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const reject = (code = "invalid_request"): never => { throw new BrowserError(400, code); };
function id(value: string | null): string { if (!value || !UUID.test(value)) throw new BrowserError(400,"invalid_request"); return value.toLowerCase(); }
function integer(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) return fallback;
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) reject();
  return Number(value);
}
function parameters(request: Request, allowed: string[]): URLSearchParams {
  const p = new URL(request.url).searchParams;
  for (const key of p.keys()) if (!allowed.includes(key) || p.getAll(key).length !== 1) reject();
  return p;
}
function scopeOf(p: URLSearchParams, prefix: "parent" | "scope"): Scope {
  const kind = p.get(`${prefix}Kind`);
  if (!["root", "namespace", "asset", "notebook"].includes(kind ?? "")) reject();
  const value = p.get(`${prefix}Id`);
  if (kind === "root") { if (value !== null) reject(); return { kind, id: null }; }
  return { kind: kind as ParentKind, id: id(value) };
}
function secret(): string {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new BrowserError(503, "cursor_secret_unavailable");
  return value;
}
function sign(value: string): Buffer { return createHmac("sha256", secret()).update("equipment-browser:v1\0").update(value).digest(); }
function cursor(binding: string, last: [Kind, string]): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, binding, last })).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}
function readCursor(value: string | null, binding: string): [string, string] | null {
  if (value === null) return null;
  if (value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) reject("invalid_cursor");
  const [payload, signature] = value.split(".");
  const supplied = Buffer.from(signature, "base64url"), expected = sign(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) reject("invalid_cursor");
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.v !== 1 || decoded.binding !== binding || !Array.isArray(decoded.last) || decoded.last.length !== 2 || !kinds.includes(decoded.last[0]) || !UUID.test(decoded.last[1])) reject("invalid_cursor");
    return decoded.last;
  } catch { return reject("invalid_cursor"); }
}

/** Existing storage identities form a forest, never a name/model join. Ambiguous namespace
 * placement stays at root. Missing notebook/asset placement also stays visible at root.
 * Parent paths are physical browsing placement only; they never create an identity link.
 */
// Only the persisted, unique, verified same-tenant bridge coalesces a machine.
// Equal names, paths or UUIDs alone never establish that identity.
// Keep the maintenance tree's enterprise-or-unpathed rule, except for private
// unpathed notebook backing nodes that were never public browser scopes.
const eligibleNamespace = `eligible_namespace AS NOT MATERIALIZED (
  SELECT k.* FROM kg_entities k
  WHERE k.tenant_id=$1::uuid AND (
    k.uns_path <@ 'enterprise'::ltree OR (k.uns_path IS NULL AND NOT EXISTS (
      SELECT 1 FROM equipment_notebooks n WHERE n.tenant_id=k.tenant_id AND n.node_id=k.id
    ))
  )
)`;
const bridges = `bridged_assets AS NOT MATERIALIZED (
  SELECT e.id AS asset_id, min(k.id::text)::uuid AS node_id, min(k.name) AS name, min(k.uns_path::text)::ltree AS uns_path
  FROM cmms_equipment e JOIN kg_entities k
    ON k.tenant_id=$1::uuid AND k.entity_id=e.id::text
      AND k.entity_type IN ('equipment','asset') AND k.approval_state='verified'
  WHERE e.tenant_id::text=$1::uuid::text
  GROUP BY e.id HAVING count(*)=1 AND bool_and(coalesce(k.uns_path <@ 'enterprise'::ltree,false))
)`;
const componentInventory = `
  SELECT 'notebook_component'::text AS kind,c.id::text AS id,
    coalesce(r.local_tag,r.raw_label,c.kind,'Unknown component') AS name,
    'notebook'::text AS parent_kind,c.notebook_id AS parent_id,
    concat_ws(' ',c.kind,r.raw_label,r.manufacturer,r.family,r.catalog_number,r.serial_number,r.local_tag) AS search_text,
    to_jsonb(h) AS data
  FROM notebook_components c ${component.latestJoin}
  CROSS JOIN LATERAL (SELECT ${component.columns}) h
  JOIN equipment_notebooks n ON n.tenant_id=c.tenant_id AND n.id=c.notebook_id
  WHERE c.tenant_id=$1::uuid`;

const placementCandidates = `${eligibleNamespace}, ${bridges}, placement_candidates AS MATERIALIZED (
  SELECT 'namespace'::text AS kind,k.id::text AS id,k.name,
    CASE WHEN pb.asset_id IS NOT NULL THEN 'asset' WHEN p.id IS NULL THEN 'root' ELSE 'namespace' END AS parent_kind,
    coalesce(pb.asset_id,p.id) AS parent_id,false AS explicit_parent,
    concat_ws(' ',k.name,k.entity_type,k.entity_id) AS search_text,
    jsonb_build_object('entityType',k.entity_type,'unsPath',k.uns_path::text) AS data
  FROM eligible_namespace k
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(nearest.id::text)::uuid END AS id
    FROM (
      SELECT a.id FROM eligible_namespace a
      WHERE a.uns_path @> k.uns_path AND a.uns_path<>k.uns_path
      ORDER BY nlevel(a.uns_path) DESC FETCH FIRST 1 ROW WITH TIES
    ) nearest
  ) p ON true
  LEFT JOIN bridged_assets pb ON pb.node_id=p.id
  WHERE NOT EXISTS (SELECT 1 FROM bridged_assets b WHERE b.node_id=k.id)
  UNION ALL
  SELECT 'asset',e.id::text,coalesce(b.name,e.equipment_number),
    CASE WHEN a.id IS NOT NULL THEN 'asset' WHEN pb.asset_id IS NOT NULL THEN 'asset' WHEN p.id IS NOT NULL THEN 'namespace' ELSE 'root' END,
    coalesce(a.id,pb.asset_id,p.id),a.id IS NOT NULL,
    concat_ws(' ',b.name,e.equipment_number,e.manufacturer,to_jsonb(e)->>'model_number',to_jsonb(e)->>'description'),
    jsonb_build_object('manufacturer',e.manufacturer,'model',to_jsonb(e)->>'model_number','unsPath',placement.uns_path::text)
  FROM cmms_equipment e
  LEFT JOIN bridged_assets b ON b.asset_id=e.id
  LEFT JOIN cmms_equipment a ON a.tenant_id=e.tenant_id AND a.id=(to_jsonb(e)->>'parent_asset_id')::uuid AND a.id<>e.id
  CROSS JOIN LATERAL (
    SELECT coalesce(b.uns_path, CASE WHEN e.uns_path <@ 'enterprise'::ltree THEN e.uns_path END) AS uns_path
  ) placement
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(nearest.id::text)::uuid END AS id
    FROM (
      SELECT k.id FROM eligible_namespace k
      WHERE k.uns_path @> placement.uns_path AND k.uns_path<>placement.uns_path
      ORDER BY nlevel(k.uns_path) DESC FETCH FIRST 1 ROW WITH TIES
    ) nearest
  ) p ON a.id IS NULL
  LEFT JOIN bridged_assets pb ON pb.node_id=p.id
  WHERE e.tenant_id::text=$1::uuid::text
)`;

type PlacementKind = "asset" | "namespace";
type PlacementEdge = {
  kind: PlacementKind; id: string; parent_kind: PlacementKind | "root";
  parent_id: string | null; explicit_parent: boolean;
};
const placementKey = (kind: string, id: string | null) => `${kind}:${id}`;

export function equipmentBrowserTopology(edges: PlacementEdge[], scope: Scope, scopedSearch: boolean) {
  const byKey = new Map(edges.map(edge => [placementKey(edge.kind,edge.id),edge]));
  const visited = new Set<PlacementEdge>();
  const cuts = new Set<PlacementEdge>();

  // A placement has at most one parent. Each walk finishes every node it visits,
  // so merging tails and long cycles never start a second walk of the same nodes.
  for (const edge of edges) {
    if (visited.has(edge)) continue;
    const path: PlacementEdge[] = [];
    const pathIndex = new Map<PlacementEdge,number>();
    let current: PlacementEdge | undefined = edge;
    while (current && !visited.has(current)) {
      visited.add(current);
      pathIndex.set(current,path.length);
      path.push(current);
      current = byKey.get(placementKey(current.parent_kind,current.parent_id));
    }
    const cycleStart = current && pathIndex.get(current);
    if (cycleStart === undefined) continue;
    let cut = path[cycleStart];
    for (const candidate of path.slice(cycleStart+1)) {
      if (candidate.explicit_parent !== cut.explicit_parent
        ? !candidate.explicit_parent
        : placementKey(candidate.kind,candidate.id) < placementKey(cut.kind,cut.id)) cut = candidate;
    }
    cuts.add(cut);
  }

  const namespaces: string[] = [], assets: string[] = [];
  if (scopedSearch) {
    const children = new Map<string,PlacementEdge[]>();
    for (const edge of edges) {
      if (cuts.has(edge) || edge.parent_id === null) continue;
      const key = placementKey(edge.parent_kind,edge.parent_id);
      const siblings = children.get(key);
      if (siblings) siblings.push(edge);
      else children.set(key,[edge]);
    }
    const pending = [placementKey(scope.kind,scope.id)];
    while (pending.length) {
      for (const child of children.get(pending.pop()!) ?? []) {
        (child.kind === "namespace" ? namespaces : assets).push(child.id);
        pending.push(placementKey(child.kind,child.id));
      }
    }
  }

  return {
    cuts: [...cuts].map(({kind,id}) => ({kind,id})),
    namespaces,
    assets,
  };
}

export async function readEquipmentBrowserTopology(client: PoolClient, tenant: string, scope: Scope, search: boolean) {
  const {rows} = await client.query<PlacementEdge>(
    `WITH ${placementCandidates} SELECT kind,id,parent_kind,parent_id,explicit_parent FROM placement_candidates`, [tenant]);
  return equipmentBrowserTopology(rows,scope,search && scope.kind !== "root");
}

const inventory = `${placementCandidates}, branch_items AS MATERIALIZED (
  SELECT c.kind,c.id,c.name,
    CASE WHEN cut.id IS NULL THEN c.parent_kind ELSE 'root' END AS parent_kind,
    CASE WHEN cut.id IS NULL THEN c.parent_id END AS parent_id,
    c.search_text,c.data
  FROM placement_candidates c
  LEFT JOIN jsonb_to_recordset($9::jsonb) AS cut(kind text,id text) ON cut.kind=c.kind AND cut.id=c.id
  UNION ALL
  SELECT 'notebook',n.id::text,n.display_name,
    CASE WHEN b.asset_id IS NOT NULL THEN 'asset' WHEN binding.id IS NOT NULL THEN 'namespace' ELSE 'root' END,
    coalesce(b.asset_id,binding.id),
    concat_ws(' ',n.display_name,n.manufacturer,n.model,n.catalog_number,n.asset_tag,n.serial_number),to_jsonb(h)
  FROM equipment_notebooks n ${notebook.boundAssetJoin}
  LEFT JOIN bridged_assets b ON b.asset_id::text=n.equipment_entity_id
  LEFT JOIN LATERAL (
    SELECT min(k.id::text)::uuid AS id FROM kg_entities k
    WHERE k.tenant_id=n.tenant_id AND k.approval_state='verified'
      AND k.entity_type IN ('equipment','asset')
      AND coalesce(k.entity_id,k.id::text)=n.equipment_entity_id
    HAVING count(*)=1 AND bool_and(coalesce(k.uns_path <@ 'enterprise'::ltree,false))
  ) binding ON b.asset_id IS NULL
  CROSS JOIN LATERAL (SELECT ${notebook.columns}) h WHERE n.tenant_id=$1::uuid
  UNION ALL
  SELECT 'installed_instance',i.id::text,coalesce(i.canonical_name,i.component_name),CASE WHEN e.id IS NULL THEN 'root' ELSE 'asset' END,e.id,
    concat_ws(' ',i.component_name,i.canonical_name,array_to_string(i.aliases,' '),i.plc_tag,t.manufacturer,t.model),
    jsonb_build_object('componentName',i.component_name,'canonicalName',i.canonical_name,'aliases',i.aliases,'assetId',i.asset_id,
      'humanConfirmed',i.human_confirmed,'manufacturer',t.manufacturer,'model',t.model,'unsPath',i.uns_path::text)
  FROM installed_component_instances i LEFT JOIN cmms_equipment e ON e.tenant_id::text=i.tenant_id::text AND e.id=i.asset_id
  LEFT JOIN component_templates t ON t.id=i.template_id WHERE i.tenant_id=$1::uuid
), inventory AS NOT MATERIALIZED (
  SELECT * FROM branch_items
  UNION ALL
  ${componentInventory}
)`;

/** The exact page SQL, also used for restricted-role EXPLAIN qualification. */
export function equipmentBrowserPageSql(search: boolean, root: boolean, notebookScope = false): string {
  const withinScope = root
    ? "parent_kind=$2 AND parent_id IS NULL AND $3::uuid IS NULL"
    : "parent_kind=$2 AND parent_id=$3::uuid";
  const scopedSearch = search && !root && !notebookScope;
  const matchScope = scopedSearch ? "true"
    : search && root ? "$2::text='root' AND $3::uuid IS NULL" : withinScope;
  const scopeCtes = scopedSearch ? `, scoped AS MATERIALIZED (
        SELECT * FROM inventory WHERE (${withinScope})
          OR (parent_kind='namespace' AND parent_id=ANY($10::uuid[]))
          OR (parent_kind='asset' AND parent_id=ANY($11::uuid[]))
      ), scoped_matches AS (
        SELECT * FROM scoped
        UNION ALL
        SELECT * FROM inventory WHERE parent_kind='notebook'
          AND parent_id IN (SELECT id::uuid FROM scoped WHERE kind='notebook')
      )` : "";
  return `/* equipment-browser:${search ? "search" : "children"} */
      WITH ${notebookScope ? `inventory AS (${componentInventory} AND c.notebook_id=$3::uuid)` : inventory}${scopeCtes},
      matched AS MATERIALIZED (
        SELECT * FROM ${scopedSearch ? "scoped_matches" : "inventory"}
        WHERE ${matchScope}
          AND ($4::text IS NULL OR kind=$4) AND (
            $5::text = '' OR regexp_replace(normalize(search_text, NFKC), '[[:space:]]+', ' ', 'g')
              ILIKE ('%' || $5 || '%') ESCAPE E'\\\\'
          )
      ), counts AS (SELECT count(*) AS total,coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) AS by_kind
        FROM (SELECT kind,count(*) AS n FROM matched GROUP BY kind) groups
      ), total AS (SELECT count(*) AS n FROM matched), page_keys AS MATERIALIZED (
        SELECT m.* FROM matched m
        WHERE ($6::text IS NULL OR (m.kind COLLATE "C",m.id COLLATE "C") > ($6::text COLLATE "C",$7::text COLLATE "C"))
        ORDER BY m.kind COLLATE "C",m.id COLLATE "C" LIMIT $8
      ), limited AS (
        SELECT m.*, CASE
          WHEN m.kind='notebook' THEN (
            SELECT count(*) FROM notebook_components c
            WHERE c.tenant_id=$1::uuid AND c.notebook_id=m.id::uuid
          )
          WHEN m.kind IN ('namespace','asset') THEN (
            SELECT count(*) FROM ${notebookScope ? "inventory" : "branch_items"}
            WHERE parent_kind=m.kind AND parent_id=m.id::uuid
          )
          ELSE 0
        END AS child_count FROM page_keys m
      ) SELECT (SELECT n FROM total)::int AS total,(SELECT by_kind FROM counts) AS by_kind,
        coalesce((SELECT jsonb_agg(to_jsonb(limited) ORDER BY kind COLLATE "C",id COLLATE "C") FROM limited),'[]'::jsonb) AS items`;
}

function item(row: InventoryRow) {
  const data = row.kind === "notebook_component" ? { component: component.decode(row.data) }
    : row.kind === "notebook" ? { notebook: notebook.decode(row.data) } : row.data;
  return {
    kind: row.kind, id: row.id, name: row.name,
    parent: { kind: row.parent_kind, id: row.parent_id },
    placement: row.parent_kind === "root" && row.kind !== "namespace" ? "unplaced" : "placed",
    childrenCount: Number(row.child_count ?? 0), ...data,
    ...(row.kind === "installed_instance" ? { resolution: { status: "unmapped", reason: "no_link", target: null } } : {}),
  };
}
async function authorize(client: PoolClient, tenant: string, scope: Scope): Promise<Scope> {
  if (scope.kind === "root") return scope;
  const table = { namespace: "kg_entities", asset: "cmms_equipment", notebook: "equipment_notebooks" }[scope.kind];
  const tenantPredicate = scope.kind === "asset" ? "tenant_id::text=$1::text" : "tenant_id=$1::uuid";
  if (scope.kind === "namespace") {
    const { rows } = await client.query<{asset_id:string | null}>(
      `WITH ${eligibleNamespace}, ${bridges}
       SELECT b.asset_id FROM eligible_namespace n LEFT JOIN bridged_assets b ON b.node_id=n.id
       WHERE n.id=$2::uuid`, [tenant,scope.id]);
    if (!rows[0]) throw new BrowserError(404, "not_found");
    return rows[0].asset_id ? {kind:"asset",id:rows[0].asset_id} : scope;
  }
  const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE ${tenantPredicate} AND id=$2::uuid`, [tenant,scope.id]);
  if (!rowCount) throw new BrowserError(404, "not_found");
  return scope;
}

async function page(request: Request, actor: Actor, search: boolean) {
  const p = parameters(request, [search ? "scopeKind" : "parentKind",search ? "scopeId" : "parentId",...(search ? ["q"] : []),"kind","limit","cursor"]);
  const scope = scopeOf(p, search ? "scope" : "parent");
  const limit = integer(p.get("limit"),50); if (limit < 1 || limit > 100) reject("invalid_limit");
  const filter = p.get("kind"); if (filter !== null && !kinds.includes(filter as Kind)) reject();
  const query = (p.get("q") ?? "").normalize("NFKC").trim().replace(/\s+/g," ");
  if (query.length > 200 || (search && !query)) reject("invalid_query");
  secret();
  const binding = JSON.stringify([actor.tenantId,actor.userId,actor.role ?? "",search ? "search" : "children",scope,filter,query]);
  const last = readCursor(p.get("cursor"),binding);
  const escaped = query.replace(/[\\%_]/g,"\\$&");
  return withTenantContext(actor.tenantId, async (client) => {
    const canonicalScope = await authorize(client,actor.tenantId,scope);
    const root = canonicalScope.kind === "root", notebookScope = canonicalScope.kind === "notebook";
    const values: unknown[] = [actor.tenantId,canonicalScope.kind,canonicalScope.id,filter,escaped,last?.[0] ?? null,last?.[1] ?? null,limit+1];
    if (!notebookScope) {
      const topology = await readEquipmentBrowserTopology(client,actor.tenantId,canonicalScope,search);
      values.push(JSON.stringify(topology.cuts));
      if (search && !root) values.push(topology.namespaces,topology.assets);
    }
    const { rows } = await client.query(equipmentBrowserPageSql(search,root,notebookScope),values);
    const result = rows[0], all = result.items as InventoryRow[], hasMore = all.length > limit, selected = all.slice(0,limit);
    const tail = selected.at(-1);
    return { scope:canonicalScope,items: selected.map(item),counts: { total: result.total,byKind: result.by_kind },hasMore,
      nextCursor: hasMore && tail ? cursor(binding,[tail.kind,tail.id]) : null,consistency: "live_keyset" };
  }, { signal: request.signal,readOnly: true });
}

async function resolve(request: Request, actor: Actor) {
  const p = parameters(request,["targetKind","notebookId","componentId","installedInstanceId","expectedRevision","selectionVersion","threadKey"]);
  const target = p.get("targetKind");
  if (target !== "notebook_component" && target !== "installed_instance") reject();
  if (target === "installed_instance" && ["notebookId","componentId","expectedRevision","selectionVersion","threadKey"].some((key) => p.has(key))) reject();
  if (target === "notebook_component" && p.has("installedInstanceId")) reject();
  const installedId = target === "installed_instance" ? id(p.get("installedInstanceId")) : null;
  const notebookId = target === "notebook_component" ? id(p.get("notebookId")) : null;
  const componentId = target === "notebook_component" ? id(p.get("componentId")) : null;
  const revision = p.has("expectedRevision") ? integer(p.get("expectedRevision")) : null;
  const version = p.get("selectionVersion");
  const expectedVersion = version === "none" ? null : version !== null ? integer(version) : undefined;
  const rawThread = p.get("threadKey");
  const thread = rawThread === null ? null : threadKeyOf(rawThread);
  if (expectedVersion !== undefined && thread === null) reject();
  if (rawThread !== null && expectedVersion === undefined) reject();
  return withTenantContext(actor.tenantId, async (client) => {
    if (installedId) {
      const { rows } = await client.query(`SELECT i.id::text,i.component_name,i.canonical_name,i.asset_id::text,i.human_confirmed,t.manufacturer,t.model
        FROM installed_component_instances i LEFT JOIN component_templates t ON t.id=i.template_id WHERE i.tenant_id=$1::uuid AND i.id=$2::uuid`,[actor.tenantId,installedId]);
      if (!rows[0]) throw new BrowserError(404,"not_found");
      return { status: "unmapped",reason: "no_link",target: null,installedInstance: rows[0] };
    }
    const header = await readNotebookHeader(client,actor.tenantId,notebookId!);
    const record = header && await readComponent(client,actor.tenantId,notebookId!,componentId!);
    if (!header || !record) throw new BrowserError(404,"not_found");
    if (record.retiredAt) throw new BrowserError(409,"component_retired");
    if (revision !== null && revision !== (record.current?.revision ?? 0)) throw new BrowserError(409,"stale_revision");
    if (expectedVersion !== undefined) {
      const { rows } = await client.query(`SELECT component_id::text,component_revision,version,cleared_at IS NOT NULL AS cleared FROM notebook_thread_selections
        WHERE tenant_id=$1::uuid AND notebook_id=$2::uuid AND owner_user_id=$3 AND thread_key=$4`,[actor.tenantId,notebookId,actor.userId,thread]);
      const selection = rows[0];
      if ((selection ? Number(selection.version) : null) !== expectedVersion || (selection && (selection.cleared || selection.component_id !== componentId || Number(selection.component_revision) !== (record.current?.revision ?? 0)))) throw new BrowserError(409,"selection_changed");
    }
    return { status: "resolved",notebook: header,component: record,identityUsable: record.current?.identityStatus === "user_confirmed" };
  }, { signal: request.signal,readOnly: true });
}

export async function equipmentBrowser(request: Request, action: "children" | "search" | "resolve"): Promise<Response> {
  const actor = await sessionOr401({ requireCurrentUser: true });
  if (actor instanceof NextResponse) {
    actor.headers.set("Cache-Control", "private, no-store");
    return actor;
  }
  const access = trialAccessDecision(actor.status,actor.trialExpiresAt);
  if (access !== "ok") {
    return NextResponse.json({
      error: access === "pending" ? "Your account is pending approval." : "Your pilot has ended. Contact FactoryLM to continue.",
    }, { status:403, headers: { "Cache-Control":"private, no-store" } });
  }
  try {
    const result = action === "resolve" ? await resolve(request,actor) : await page(request,actor,action === "search");
    return NextResponse.json(result,{ headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ error: error instanceof BrowserError ? error.code : aborted ? "request_aborted" : "query_failed" },
      { status: error instanceof BrowserError ? error.status : aborted ? 499 : 500,headers: { "Cache-Control": "private, no-store" } });
  }
}
