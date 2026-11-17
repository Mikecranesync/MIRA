/** Actual HTTP -> production route -> production tenant transaction -> PostgreSQL.
 * Auth is injected at sessionOr401; this suite does not claim cookie/login or Next transport proof.
 * The test-only Node adapter forwards real socket cancellation to the Web Request signal.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { NextResponse } from "next/server";
import { addComponent, reviseComponent, setSelection } from "@/capabilities/bench-components/store";
import { readRevisionInput } from "@/capabilities/bench-components/validate";
import { withTenantContext } from "@/lib/tenant-context";
import { equipmentBrowserPageSql } from "../browser";

const db = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw new Error("Required disposable database prerequisites missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  const runtimeUrl=new URL(process.env.TEST_DATABASE_URL);
  runtimeUrl.username="api_runtime_owner";runtimeUrl.password="disposable_api_fixture";
  return {
    owner: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    app: new PgPool({ connectionString: runtimeUrl.toString(), max: 1 }) as Pool,
  };
});
vi.mock("@/lib/db", () => ({ default: db.app }));
const auth = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: Storage } = require("node:async_hooks");
  return new Storage() as AsyncLocalStorage<{ tenantId: string; userId: string } | null>;
});
vi.mock("@/lib/session", () => ({ sessionOr401: async () => auth.getStore() ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }));

describe("direct equipment API HTTP/PostgreSQL contract", () => {
  const a = uuid(), b = uuid(), notebook = uuid(), otherNotebook = uuid();
  let componentId: string, secondComponent: string;
  const installed = uuid(), assignedInstalled=uuid(), asset=uuid(), foreignAsset=uuid();
  let server: Server, base: string;
  const users = { a: { tenantId: a, userId: "browser-a" }, b: { tenantId: b, userId: "browser-b" }, second: { tenantId: a, userId: "browser-a2" } };
  const request = (route: string, token = "a", signal?: AbortSignal) => fetch(base + route, { headers: { authorization: token }, signal });
  async function until(check: () => Promise<boolean>) {
    const deadline=Date.now()+5000;
    while (!(await check())) { if (Date.now()>deadline) throw new Error("Database observation deadline exceeded"); await new Promise((resolve)=>setTimeout(resolve,10)); }
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET = "disposable-equipment-browser-cursor-fixture";
    await db.owner.query("DO $$ BEGIN CREATE ROLE api_runtime_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'disposable_api_fixture'; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await db.owner.query("ALTER ROLE api_runtime_owner PASSWORD 'disposable_api_fixture'; GRANT factorylm_app TO api_runtime_owner");
    await db.owner.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'API fixture A'),($2,$2::uuid::text,'API fixture B')",[a,b]);
    await db.owner.query("INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path) VALUES($1,$2,'Conveyor 7','conveyor7','enterprise.line.machine'),($3,$4,'Conveyor 7','conveyor7','enterprise.line.machine')",[asset,a,foreignAsset,b]);
    await db.owner.query("INSERT INTO equipment_notebooks (id,tenant_id,node_id,display_name) VALUES ($1,$2,$3,'Conveyor 7'),($4,$5,$6,'Conveyor 7')", [notebook,a,uuid(),otherNotebook,b,uuid()]);
    for (let i=0;i<2;i++) {
      const revision = readRevisionInput({ rawLabel: "GS11N-20P2",inputKind: "typed",manufacturer: "AutomationDirect",family: "GS10",catalogNumber: "GS11N-20P2",localTag: "VFD1",serialNumber: `serial-${i}` },true);
      if ("error" in revision) throw new Error(revision.error);
      const result = await addComponent(a,notebook,users.a.userId,{ clientRequestId: uuid(),kind: "drive",origin: "technician",position: i,revision });
      if (result.status !== "created") throw new Error(result.status);
      if (i===0) componentId=result.component.id; else secondComponent=result.component.id;
    }
    // Deliberately coincident UUID across different canonical kinds; no identity inference.
    await db.owner.query("INSERT INTO installed_component_instances(id,tenant_id,component_name,human_confirmed) VALUES ($1,$2,'VFD1',true),($3,$2,'MLC',false)",[componentId,a,installed]);
    await db.owner.query("INSERT INTO installed_component_instances(id,tenant_id,asset_id,component_name) VALUES($1,$2,$3,'MLC')",[assignedInstalled,a,asset]);
    const routes = new Map<string, (r: Request) => Promise<Response>>();
    for (const action of ["children", "search", "resolve"]) {
      const file = path.resolve("src/app/api/equipment-browser", action, "route.ts");
      if (existsSync(file)) routes.set(action, (await import(file)).GET);
    }
    server = createServer((incoming, outgoing) => {
      const controller = new AbortController();
      outgoing.on("close", () => { if (!outgoing.writableEnded) controller.abort(); });
      const token = String(incoming.headers.authorization ?? "");
      auth.run(users[token as keyof typeof users] ?? null, async () => {
        try {
          const url = new URL(incoming.url!, "http://localhost");
          const handler = routes.get(url.pathname.split("/").at(-1)!);
          const response = handler ? await handler(new Request(url, { signal: controller.signal })) : new Response("missing route", { status: 404 });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(await response.text());
        } catch { if (!outgoing.destroyed) { outgoing.writeHead(500); outgoing.end(); } }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/equipment-browser/`;
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    await db.owner.query("DELETE FROM equipment_notebooks WHERE tenant_id = ANY($1::uuid[])", [[a,b]]);
    await db.owner.query("DELETE FROM installed_component_instances WHERE tenant_id = ANY($1::uuid[])",[[a,b]]);
    await db.owner.query("DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])",[[a,b]]);
    await db.owner.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])",[[a,b]]);
    await Promise.all([db.app.end(),db.owner.end()]);
  });

  it("serves bounded authorized root children without another tenant's same-name notebook", async () => {
    const response = await request("children?parentKind=root&kind=notebook&limit=1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((row: { id: string }) => row.id)).toEqual([notebook]);
    expect(body.counts.total).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it.each(["0","101","-1","1.5","Infinity","01"])("rejects invalid page limit %s", async (limit) => {
    expect((await request(`children?parentKind=root&limit=${limit}`)).status).toBe(400);
  });

  it("requires a session and rejects ambiguous or untyped scopes", async () => {
    expect((await request("children?parentKind=root","missing")).status).toBe(401);
    for (const query of ["", "parentKind=notebook", "parentKind=root&parentId="+notebook,"parentKind=root&limit=1&limit=2","parentKind=root&tenantId="+b]) {
      expect((await request("children?"+query)).status).toBe(400);
    }
  });

  it("pages tied labels by exact identity and rejects replay across users, scopes, filters, query and tenant", async () => {
    const prefix=`children?parentKind=notebook&parentId=${notebook}&limit=1`;
    const first=await (await request(prefix)).json();
    expect(first.items).toHaveLength(1);expect(first.counts.total).toBe(2);expect(first.hasMore).toBe(true);
    const next=await (await request(prefix+"&cursor="+first.nextCursor)).json();
    expect(next.hasMore).toBe(false);expect(next.nextCursor).toBeNull();
    expect(new Set([first.items[0].id,next.items[0].id])).toEqual(new Set([componentId,secondComponent]));
    for (const [query,token] of [[prefix,"b"],[prefix,"second"],[prefix+"&kind=notebook_component","a"],["children?parentKind=root&limit=1","a"],[`search?scopeKind=notebook&scopeId=${notebook}&q=VFD1&limit=1`,"a"]]) {
      expect((await request(query+"&cursor="+first.nextCursor,token)).status).toBe(400);
    }
    expect((await request(prefix+"&cursor="+first.nextCursor.slice(0,-4)+"AAAA")).status).toBe(400);
    expect((await request(prefix+"&cursor="+first.nextCursor,"a")).headers.get("cache-control")).toContain("no-store");
  });

  it("does not expose foreign parents and rechecks authorization on every page", async () => {
    for (const parentId of [otherNotebook,uuid()]) expect((await request(`children?parentKind=notebook&parentId=${parentId}`)).status).toBe(404);
    const parent=uuid(), children=[uuid(),uuid()];
    await db.owner.query("INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path) VALUES ($1::uuid,$2::uuid,'line',$1::uuid::text,'test parent','enterprise.revoked'),($3::uuid,$2::uuid,'asset',$3::uuid::text,'first','enterprise.revoked.one'),($4::uuid,$2::uuid,'asset',$4::uuid::text,'second','enterprise.revoked.two')",[parent,a,...children]);
    const prefix=`children?parentKind=namespace&parentId=${parent}&limit=1`;
    const first=await (await request(prefix)).json();expect(first.hasMore).toBe(true);
    await db.owner.query("DELETE FROM kg_entities WHERE id=$1",[parent]);
    expect((await request(prefix+"&cursor="+first.nextCursor)).status).toBe(404);
    await db.owner.query("DELETE FROM kg_entities WHERE id=ANY($1::uuid[])",[children]);
  });

  it("exact resolution keeps repeated model/tag instances distinct; mixed targets never select a first match", async () => {
    for (const id of [componentId,secondComponent]) {
      const result=await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${id}&expectedRevision=1`);
      expect(result.status).toBe(200); const body=await result.json();
      expect(body.component.id).toBe(id);expect(body.component.current.revision).toBe(1);expect(body.identityUsable).toBe(true);
    }
    expect((await request(`resolve?targetKind=notebook_component&notebookId=${otherNotebook}&componentId=${componentId}`)).status).toBe(404);
    expect((await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}&installedInstanceId=${componentId}`)).status).toBe(400);
  });

  it("the same notebook header has consistent wire identity and timestamps in browsing and resolution",async()=>{
    const listing=await(await request("children?parentKind=root&kind=notebook")).json();
    const resolution=await(await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}`)).json();
    expect(resolution.notebook).toEqual(listing.items.find((r:{id:string})=>r.id===notebook).notebook);
  });

  it("installed instances remain visible and explicitly no_link even when a notebook component has the same UUID", async () => {
    const rows=await (await request("children?parentKind=root&kind=installed_instance")).json();
    expect(rows.counts.total).toBe(2);expect(rows.items.map((r:{id:string})=>r.id)).toContain(installed);
    for (const id of [componentId,installed]) {
      const response=await request(`resolve?targetKind=installed_instance&installedInstanceId=${id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "unmapped",reason: "no_link",target: null,installedInstance: { id } });
    }
    for (const id of [componentId,uuid()]) expect((await request(`resolve?targetKind=installed_instance&installedInstanceId=${id}`,"b")).status).toBe(404);
  });

  it("asset children and asset search use the stored asset ID while refusing foreign and unknown assets",async()=>{
    const listed=await(await request(`children?parentKind=asset&parentId=${asset}`)).json();
    expect(listed.counts.total).toBe(1);expect(listed.items[0]).toMatchObject({id:assignedInstalled,kind:"installed_instance",resolution:{reason:"no_link",target:null}});
    const found=await(await request(`search?scopeKind=asset&scopeId=${asset}&q=MLC`)).json();expect(found.counts.total).toBe(1);
    for(const id of [foreignAsset,uuid()])expect((await request(`children?parentKind=asset&parentId=${id}`)).status).toBe(404);
  });

  it("search is bounded by the exact scope and treats wildcard characters literally", async () => {
    const response=await request(`search?scopeKind=notebook&scopeId=${notebook}&q=GS11N-20P2&limit=1`);
    expect(response.status).toBe(200);const body=await response.json();
    expect(body.counts.total).toBe(2);expect(body.items).toHaveLength(1);expect(body.hasMore).toBe(true);
    expect((await (await request(`search?scopeKind=notebook&scopeId=${notebook}&q=%25`)).json()).counts.total).toBe(0);
    expect((await request(`search?scopeKind=notebook&scopeId=${otherNotebook}&q=VFD1`)).status).toBe(404);
  });

  it("identity corrections return stale_revision without repointing or changing the selection", async () => {
    const revision=readRevisionInput({ rawLabel:"Corrected",inputKind:"typed",manufacturer:"AutomationDirect",catalogNumber:"GS11N-20P2",localTag:"VFD1" },true);
    if ("error" in revision) throw new Error(revision.error);
    expect((await reviseComponent(a,notebook,componentId,users.a.userId,{clientRequestId:uuid(),expectedRevision:1,revision})).status).toBe("created");
    expect((await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}&expectedRevision=1`)).status).toBe(409);
    const current=await (await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}&expectedRevision=2`)).json();
    expect(current.component.current.revision).toBe(2);expect(current.component.id).toBe(componentId);
  });

  it("stale or corrected selections refuse resolution and remain isolated by user", async () => {
    const pick=await setSelection(a,notebook,users.a.userId,"browser-thread",{ componentId:secondComponent,via:"picker",expectedVersion:null,clientRequestId:uuid() });
    expect(pick.status).toBe("set");
    const route=`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${secondComponent}&selectionVersion=1&threadKey=browser-thread`;
    expect((await request(route)).status).toBe(200);
    expect((await request(route,"second")).status).toBe(409);
    const correction=readRevisionInput({ rawLabel:"Needs clarification",inputKind:"typed",unresolved:["catalogNumber"] },false);
    if ("error" in correction) throw new Error(correction.error);
    await reviseComponent(a,notebook,secondComponent,users.a.userId,{clientRequestId:uuid(),expectedRevision:1,revision:correction});
    expect((await request(route)).status).toBe(409);
    const raw=await (await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${secondComponent}`)).json();
    expect(raw.identityUsable).toBe(false);
    await setSelection(a,notebook,users.a.userId,"browser-thread",{ componentId:null,via:"picker",expectedVersion:1,clientRequestId:uuid() });
    expect((await request(route.replace("selectionVersion=1","selectionVersion=2"))).status).toBe(409);
  });

  it("GETs leave recency, identity, binding, confirmation, selection and turn history byte-for-byte unchanged", async () => {
    async function snapshot() {
      const result=[];
      for (const table of ["equipment_notebooks","notebook_components","notebook_component_revisions","notebook_thread_selections","equipment_notebook_turns","installed_component_instances"]) {
        result.push((await db.owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE tenant_id=ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,[[a,b]])).rows);
      }
      return JSON.stringify(result);
    }
    const before=await snapshot();
    for (const route of ["children?parentKind=root",`children?parentKind=notebook&parentId=${notebook}`,`search?scopeKind=root&q=VFD1`,`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}`,`resolve?targetKind=installed_instance&installedInstanceId=${installed}`]) {
      expect((await request(route)).status).toBe(200);
    }
    expect(await snapshot()).toBe(before);
  });

  it("real socket cancellation interrupts locked SQL, rolls back before unlocking and safely reuses the same pool backend", async () => {
    const lock=await db.owner.connect();
    try {
      await lock.query("BEGIN; LOCK TABLE notebook_components IN ACCESS EXCLUSIVE MODE");
      for (let repeat=0;repeat<3;repeat++) {
        const controller=new AbortController();
        const pending=request(`children?parentKind=notebook&parentId=${notebook}`,"a",controller.signal).catch((error)=>error);
        let pid=0;
        await until(async()=>{
          const result=await db.owner.query("SELECT pid FROM pg_stat_activity WHERE usename='api_runtime_owner' AND state='active' AND wait_event_type='Lock' AND query LIKE '%equipment-browser:children%'");
          pid=result.rows[0]?.pid ?? 0;return pid!==0;
        });
        controller.abort(); expect((await pending).name).toBe("AbortError");
        await until(async()=>{
          const result=await db.owner.query("SELECT state,query FROM pg_stat_activity WHERE pid=$1",[pid]);
          return result.rows[0]?.state==="idle" && result.rows[0]?.query==="ROLLBACK";
        });
        const lease=await db.app.connect();
        try {
          const result=await lease.query("SELECT pg_backend_pid() AS pid,current_user AS role,current_setting('app.tenant_id',true) AS a,current_setting('app.current_tenant_id',true) AS b,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged");
          expect(result.rows[0]).toEqual({pid,role:"api_runtime_owner",a:"",b:"",privileged:false});
        } finally { lease.release(); }
      }
    } finally { await lock.query("ROLLBACK");lock.release(); }
    expect((await request(`children?parentKind=notebook&parentId=${notebook}`,"b")).status).toBe(404);
    expect((await request(`children?parentKind=notebook&parentId=${notebook}`)).status).toBe(200);
  });

  it("actual PostgreSQL cancellation reports 57014 under the restricted application role",async()=>{
    const controller=new AbortController();let observed:string|undefined;
    await expect(withTenantContext(a,async(client)=>{
      expect((await client.query("SELECT current_user AS role")).rows[0].role).toBe("factorylm_app");
      const timer=setTimeout(()=>controller.abort(),50);
      try { await client.query("SELECT pg_sleep(20)"); }
      catch(error){observed=(error as {code:string}).code;throw error;}
      finally {clearTimeout(timer);}
    },{signal:controller.signal,readOnly:true})).rejects.toMatchObject({name:"AbortError"});
    expect(observed).toBe("57014");
  });

  it("queued and already-completed HTTP aborts do not leak a pool lease", async () => {
    const lease=await db.app.connect(), controller=new AbortController();
    try {
      const pending=request("children?parentKind=root","a",controller.signal).catch((error)=>error);
      await until(async()=>db.app.waitingCount>0); controller.abort();expect((await pending).name).toBe("AbortError");
    } finally { lease.release(); }
    await until(async()=>db.app.waitingCount===0 && db.app.idleCount===1);
    for (let i=0;i<3;i++) {
      const complete=new AbortController();expect((await request("children?parentKind=root","a",complete.signal)).status).toBe(200);complete.abort();
    }
    expect((await request("children?parentKind=root","b")).status).toBe(200);
  });

  it("retired notebook components stay visible but cannot resolve as an active target (fixture-only retirement)", async () => {
    await db.owner.query("UPDATE notebook_components SET retired_at=now() WHERE id=$1",[secondComponent]);
    const body=await (await request(`children?parentKind=notebook&parentId=${notebook}`)).json();
    expect(body.counts.total).toBe(2);expect(body.items.find((r:{id:string})=>r.id===secondComponent).component.retiredAt).not.toBeNull();
    expect((await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${secondComponent}`)).status).toBe(409);
  });

  it("a valid cursor can exhaust after deletion without losing the current authorized count", async()=>{
    const nb=uuid();await db.owner.query("INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name) VALUES($1,$2,$3,'cursor exhaustion')",[nb,a,uuid()]);
    for(let i=0;i<2;i++) await addComponent(a,nb,users.a.userId,{clientRequestId:uuid(),kind:null,origin:"technician",position:i,revision:null});
    const prefix=`children?parentKind=notebook&parentId=${nb}&limit=1`;
    const first=await(await request(prefix)).json();expect(first.hasMore).toBe(true);
    await db.owner.query("DELETE FROM notebook_components WHERE notebook_id=$1 AND id<>$2",[nb,first.items[0].id]);
    const empty=await(await request(prefix+"&cursor="+first.nextCursor)).json();
    expect(empty.items).toEqual([]);expect(empty.counts.total).toBe(1);expect(empty.hasMore).toBe(false);expect(empty.nextCursor).toBeNull();
    await db.owner.query("DELETE FROM equipment_notebooks WHERE id=$1",[nb]);
  });

  it("20k fixture: SQL-scoped counts, repeated identities and page/cursor boundaries remain isolated", async () => {
    // Reuses BRAVO's b061/f755 definition: 8 x 50 x 50, plus 1 x 50 x 50 foreign;
    // VFD1/MLC repeated, first 10 drives per line share GS11N-20P2, serials differ.
    // Bulk fixture inserts are not qualification of writers; existing store suite proves those.
    const lines=[] as Array<{id:string;tenant:string;line:number}>;
    const machines=[] as Array<{id:string;tenant:string;node:string;name:string;line:number;machine:number}>;
    for (const [tenant,n] of [[a,8],[b,1]] as const) for(let line=1;line<=n;line++) {
      const node=uuid();lines.push({id:node,tenant,line});
      for(let machine=1;machine<=50;machine++) machines.push({id:uuid(),tenant,node,name:`Conveyor ${machine}`,line,machine});
    }
    await db.owner.query("INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path) SELECT id,tenant,'line',id::text,'Line '||line,('enterprise.Line'||line)::ltree FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant uuid,line int)",[JSON.stringify(lines)]);
    await db.owner.query("INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name) SELECT id,tenant,node,name FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant uuid,node uuid,name text)",[JSON.stringify(machines)]);
    await db.owner.query(`INSERT INTO notebook_components(tenant_id,notebook_id,position,kind,origin,created_by,client_request_id)
      SELECT tenant,id,k,CASE k WHEN 1 THEN 'drive' WHEN 2 THEN 'relay' ELSE 'device' END,'inventory','fixture',gen_random_uuid()
      FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant uuid) CROSS JOIN generate_series(1,50) k`,[JSON.stringify(machines)]);
    await db.owner.query(`INSERT INTO notebook_component_revisions(tenant_id,component_id,revision,raw_label,input_kind,manufacturer,family,catalog_number,serial_number,local_tag,identity_status,unresolved,created_by,client_request_id)
      SELECT c.tenant_id,c.id,1,
        CASE c.position WHEN 1 THEN CASE WHEN x.machine<=10 THEN 'GS11N-20P2' ELSE 'GS11N-2'||lpad(x.machine::text,2,'0')||'P2' END WHEN 2 THEN 'CA3KN22BD' ELSE 'K'||c.position END,
        CASE WHEN c.position<=2 THEN 'inventory' ELSE 'schedule' END,
        CASE c.position WHEN 1 THEN 'AutomationDirect' WHEN 2 THEN 'Schneider Electric' END,
        CASE c.position WHEN 1 THEN 'GS10' WHEN 2 THEN 'TeSys K' END,
        CASE c.position WHEN 1 THEN CASE WHEN x.machine<=10 THEN 'GS11N-20P2' ELSE 'GS11N-2'||lpad(x.machine::text,2,'0')||'P2' END WHEN 2 THEN 'CA3KN22BD' END,
        CASE WHEN c.position<=2 THEN 'SN-L'||x.line||'-M'||x.machine||CASE c.position WHEN 1 THEN '-D' ELSE '-R' END END,
        CASE c.position WHEN 1 THEN 'VFD1' WHEN 2 THEN 'MLC' ELSE 'K'||c.position END,
        CASE WHEN c.position<=2 THEN 'candidate' ELSE 'unknown' END,
        CASE WHEN c.position<=2 THEN '[]'::jsonb ELSE '["manufacturer","catalogNumber"]'::jsonb END,'fixture',gen_random_uuid()
      FROM notebook_components c JOIN jsonb_to_recordset($1::jsonb) AS x(id uuid,line int,machine int) ON x.id=c.notebook_id`,[JSON.stringify(machines)]);
    const line=lines[0].id;
    const timings=[] as Array<{case:string;milliseconds:number;bytes:number}>;
    for (const limit of [1,50,100]) {
      const start=performance.now(), response=await request(`children?parentKind=namespace&parentId=${line}&limit=${limit}`),text=await response.text();
      timings.push({case:`line-children-${limit}`,milliseconds:performance.now()-start,bytes:Buffer.byteLength(text)});
      const body=JSON.parse(text);expect(response.status).toBe(200);expect(body.counts.total).toBe(50);expect(body.items).toHaveLength(Math.min(limit,50));
    }
    const own=machines.find((m)=>m.tenant===a)!, foreign=machines.find((m)=>m.tenant===b)!;
    expect((await request(`children?parentKind=notebook&parentId=${foreign.id}`)).status).toBe(404);
    expect((await (await request(`search?scopeKind=namespace&scopeId=${line}&q=GS11N-20P2&kind=notebook_component`)).json()).counts.total).toBe(10);
    expect((await (await request(`search?scopeKind=root&q=CA3KN22BD&kind=notebook_component`)).json()).counts.total).toBe(400);
    expect((await (await request(`search?scopeKind=root&q=CA3KN22BD&kind=notebook_component`,"b")).json()).counts.total).toBe(50);
    const seen=new Set<string>();let cursor: string|null=null;let lastCursor:string|null=null;
    do {
      const start=performance.now(), response=await request(`children?parentKind=notebook&parentId=${own.id}&limit=17${cursor?`&cursor=${cursor}`:""}`),text=await response.text();
      timings.push({case:"component-page-17",milliseconds:performance.now()-start,bytes:Buffer.byteLength(text)});
      const page=JSON.parse(text);expect(response.status).toBe(200);expect(page.counts.total).toBe(50);
      for(const item of page.items){expect(seen.has(item.id)).toBe(false);seen.add(item.id);}
      lastCursor=cursor;cursor=page.nextCursor;
      expect(page.hasMore).toBe(cursor!==null);
    } while(cursor);
    expect(seen.size).toBe(50);expect(lastCursor).not.toBeNull();
    const total=await db.owner.query("SELECT tenant_id::text,count(*)::int AS n FROM notebook_components WHERE notebook_id=ANY($1::uuid[]) GROUP BY tenant_id",[machines.map((m)=>m.id)]);
    expect(Object.fromEntries(total.rows.map((r)=>[r.tenant_id,r.n]))).toEqual({[a]:20000,[b]:2500});
    const explain=await withTenantContext(a,async(client)=>{
      const role=(await client.query("SELECT current_user AS role")).rows[0].role;expect(role).toBe("factorylm_app");
      const plan=await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+equipmentBrowserPageSql(true,false),[a,"namespace",line,"notebook_component","GS11N-20P2",null,null,51]);
      return {role,plan:plan.rows};
    },{readOnly:true});
    if(process.env.EQUIPMENT_BROWSER_MEASUREMENTS) writeFileSync(process.env.EQUIPMENT_BROWSER_MEASUREMENTS,JSON.stringify({fixture:{tenantA:20000,tenantB:2500},timings,explain},null,2));
    console.log("equipment-browser measurements",JSON.stringify({fixture:20000,timings}));
  },60000);
});
