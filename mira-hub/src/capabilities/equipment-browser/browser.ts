import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { notebookReadProjection as notebook, readNotebookHeader } from "@/lib/equipment-notebooks";
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
  if (!value) return null;
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
const bridges = `bridged_assets AS NOT MATERIALIZED (
  SELECT e.id AS asset_id, min(k.id::text)::uuid AS node_id, min(k.name) AS name
  FROM cmms_equipment e JOIN kg_entities k
    ON k.tenant_id=$1::uuid AND k.entity_id=e.id::text
      AND k.entity_type IN ('equipment','asset') AND k.approval_state='verified'
      AND k.uns_path IS NOT NULL
  WHERE e.tenant_id::text=$1::uuid::text
  GROUP BY e.id HAVING count(*)=1
)`;
const inventory = `${bridges}, inventory AS NOT MATERIALIZED (
  SELECT 'namespace'::text AS kind,k.id::text AS id,k.name,
    CASE WHEN pb.asset_id IS NOT NULL THEN 'asset' WHEN p.id IS NULL THEN 'root' ELSE 'namespace' END AS parent_kind,
    coalesce(pb.asset_id,p.id::uuid) AS parent_id,
    concat_ws(' ',k.name,k.entity_type,k.entity_id) AS search_text,
    jsonb_build_object('entityType',k.entity_type,'unsPath',k.uns_path::text) AS data
  FROM kg_entities k
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(a.id::text) END AS id FROM kg_entities a
    WHERE a.tenant_id=k.tenant_id AND a.uns_path @> k.uns_path AND a.uns_path<>k.uns_path
      AND nlevel(a.uns_path)=(SELECT max(nlevel(z.uns_path)) FROM kg_entities z WHERE z.tenant_id=k.tenant_id AND z.uns_path @> k.uns_path AND z.uns_path<>k.uns_path)
  ) p ON true
  LEFT JOIN bridged_assets pb ON pb.node_id=p.id::uuid
  WHERE k.tenant_id=$1::uuid AND NOT EXISTS (SELECT 1 FROM bridged_assets b WHERE b.node_id=k.id) AND (
    k.uns_path IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM equipment_notebooks n WHERE n.tenant_id=k.tenant_id AND n.node_id=k.id
    )
  )
  UNION ALL
  SELECT 'asset',e.id::text,coalesce(b.name,e.equipment_number),
    CASE WHEN a.id IS NOT NULL THEN 'asset' WHEN pb.asset_id IS NOT NULL THEN 'asset' WHEN p.id IS NOT NULL THEN 'namespace' ELSE 'root' END,
    coalesce(a.id,pb.asset_id,p.id::uuid),concat_ws(' ',b.name,e.equipment_number,e.manufacturer,to_jsonb(e)->>'model_number',to_jsonb(e)->>'description'),
    jsonb_build_object('manufacturer',e.manufacturer,'model',to_jsonb(e)->>'model_number','unsPath',e.uns_path::text)
  FROM cmms_equipment e
  LEFT JOIN bridged_assets b ON b.asset_id=e.id
  LEFT JOIN cmms_equipment a ON a.tenant_id=e.tenant_id AND a.id::text=to_jsonb(e)->>'parent_asset_id' AND a.id<>e.id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(k.id::text) END AS id FROM kg_entities k
    WHERE k.tenant_id=$1::uuid AND k.uns_path @> e.uns_path AND k.uns_path<>e.uns_path
      AND nlevel(k.uns_path)=(SELECT max(nlevel(z.uns_path)) FROM kg_entities z WHERE z.tenant_id=$1::uuid AND z.uns_path @> e.uns_path AND z.uns_path<>e.uns_path)
  ) p ON true
  LEFT JOIN bridged_assets pb ON pb.node_id=p.id::uuid
  WHERE e.tenant_id::text=$1::uuid::text
  UNION ALL
  SELECT 'notebook',n.id::text,n.display_name,
    CASE WHEN e.id IS NOT NULL THEN 'asset' WHEN ba.bound_asset_path IS NOT NULL THEN 'namespace' ELSE 'root' END,
    coalesce(e.id, CASE WHEN ba.bound_asset_path IS NOT NULL THEN ba.bound_asset_node_id END),
    concat_ws(' ',n.display_name,n.manufacturer,n.model,n.catalog_number,n.asset_tag,n.serial_number),to_jsonb(h)
  FROM equipment_notebooks n ${notebook.boundAssetJoin}
  LEFT JOIN cmms_equipment e ON e.tenant_id::text=n.tenant_id::text AND e.id::text=ba.bound_asset_entity_id
  CROSS JOIN LATERAL (SELECT ${notebook.columns}) h WHERE n.tenant_id=$1::uuid
  UNION ALL
  SELECT 'notebook_component',c.id::text,coalesce(r.local_tag,r.raw_label,c.kind,'Unknown component'),'notebook',c.notebook_id,
    concat_ws(' ',c.kind,r.raw_label,r.manufacturer,r.family,r.catalog_number,r.serial_number,r.local_tag),to_jsonb(h)
  FROM notebook_components c ${component.latestJoin}
  CROSS JOIN LATERAL (SELECT ${component.columns}) h
  JOIN equipment_notebooks n ON n.tenant_id=c.tenant_id AND n.id=c.notebook_id
  WHERE c.tenant_id=$1::uuid
  UNION ALL
  SELECT 'installed_instance',i.id::text,coalesce(i.canonical_name,i.component_name),CASE WHEN e.id IS NULL THEN 'root' ELSE 'asset' END,e.id,
    concat_ws(' ',i.component_name,i.canonical_name,array_to_string(i.aliases,' '),i.plc_tag,t.manufacturer,t.model),
    jsonb_build_object('componentName',i.component_name,'canonicalName',i.canonical_name,'aliases',i.aliases,'assetId',i.asset_id,
      'humanConfirmed',i.human_confirmed,'manufacturer',t.manufacturer,'model',t.model,'unsPath',i.uns_path::text)
  FROM installed_component_instances i LEFT JOIN cmms_equipment e ON e.tenant_id::text=i.tenant_id::text AND e.id=i.asset_id
  LEFT JOIN component_templates t ON t.id=i.template_id WHERE i.tenant_id=$1::uuid
)`;

/** The exact page SQL, also used for restricted-role EXPLAIN qualification. */
export function equipmentBrowserPageSql(search: boolean, root: boolean): string {
  const withinScope = root
    ? "parent_kind=$2 AND parent_id IS NULL AND $3::uuid IS NULL"
    : "parent_kind=$2 AND parent_id=$3::uuid";
  return `/* equipment-browser:${search ? "search" : "children"} */
      WITH RECURSIVE ${inventory}, descendants AS (
        SELECT * FROM inventory WHERE ${withinScope}
        UNION SELECT i.* FROM inventory i JOIN descendants d ON i.parent_kind=d.kind AND i.parent_id=d.id::uuid
      ), matched AS MATERIALIZED (
        SELECT * FROM ${search ? root ? "inventory" : "descendants" : "inventory"}
        WHERE ${search ? "true" : withinScope}
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
            SELECT count(*) FROM inventory
            WHERE kind IN ('namespace','asset','notebook','installed_instance')
              AND parent_kind=m.kind AND parent_id=m.id::uuid
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
  const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE ${tenantPredicate} AND id=$2::uuid`, [tenant,scope.id]);
  if (!rowCount) throw new BrowserError(404, "not_found");
  if (scope.kind === "namespace") {
    const { rows } = await client.query<{asset_id:string}>(
      `WITH ${bridges} SELECT asset_id FROM bridged_assets WHERE node_id=$2::uuid`, [tenant,scope.id]);
    if (rows[0]) return {kind:"asset",id:rows[0].asset_id};
  }
  return scope;
}

async function page(request: Request, actor: Actor, search: boolean) {
  const p = parameters(request, [search ? "scopeKind" : "parentKind",search ? "scopeId" : "parentId",...(search ? ["q"] : []),"kind","limit","cursor"]);
  const scope = scopeOf(p, search ? "scope" : "parent");
  const limit = integer(p.get("limit"),50); if (limit < 1 || limit > 100) reject("invalid_limit");
  const filter = p.get("kind"); if (filter && !kinds.includes(filter as Kind)) reject();
  const query = (p.get("q") ?? "").normalize("NFKC").trim().replace(/\s+/g," ");
  if (query.length > 200 || (search && !query)) reject("invalid_query");
  secret();
  const binding = JSON.stringify([actor.tenantId,actor.userId,actor.role ?? "",search ? "search" : "children",scope,filter,query]);
  const last = readCursor(p.get("cursor"),binding);
  const escaped = query.replace(/[\\%_]/g,"\\$&");
  return withTenantContext(actor.tenantId, async (client) => {
    const canonicalScope = await authorize(client,actor.tenantId,scope);
    const { rows } = await client.query(equipmentBrowserPageSql(search,canonicalScope.kind === "root"),
      [actor.tenantId,canonicalScope.kind,canonicalScope.id,filter,escaped,last?.[0] ?? null,last?.[1] ?? null,limit+1]);
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
  const thread = p.get("threadKey");
  if (expectedVersion !== undefined && (!thread || thread.length > 200)) reject();
  if (thread !== null && expectedVersion === undefined) reject();
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
  const actor = await sessionOr401();
  if (actor instanceof NextResponse) return actor;
  try {
    const result = action === "resolve" ? await resolve(request,actor) : await page(request,actor,action === "search");
    return NextResponse.json(result,{ headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ error: error instanceof BrowserError ? error.code : aborted ? "request_aborted" : "query_failed" },
      { status: error instanceof BrowserError ? error.status : aborted ? 499 : 500,headers: { "Cache-Control": "private, no-store" } });
  }
}
