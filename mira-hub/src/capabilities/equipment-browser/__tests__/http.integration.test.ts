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
import { createAndBindNotebookTx } from "@/lib/equipment-notebooks";
import { withTenantContext } from "@/lib/tenant-context";
import { equipmentBrowserPageSql, readEquipmentBrowserTopology, equipmentBrowserTopology } from "../browser";

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
  return new Storage() as AsyncLocalStorage<{ tenantId: string; userId: string; status?: string; trialExpiresAt?: string } | Response | null>;
});
vi.mock("@/lib/session", () => ({ sessionOr401: async () => auth.getStore() ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }));

describe("direct equipment API HTTP/PostgreSQL contract", () => {
  const a = uuid(), b = uuid(), notebook = uuid(), otherNotebook = uuid();
  let componentId: string, secondComponent: string;
  const installed = uuid(), assignedInstalled=uuid(), asset=uuid(), foreignAsset=uuid();
  const legacyAsset = uuid();
  let server: Server, base: string;
  const users = { a: { tenantId: a, userId: "browser-a" }, b: { tenantId: b, userId: "browser-b" }, second: { tenantId: a, userId: "browser-a2" } };
  const request = (route: string, token = "a", signal?: AbortSignal) => fetch(base + route, { headers: { authorization: token }, signal });
  async function until(check: () => Promise<boolean>) {
    const deadline=Date.now()+5000;
    while (!(await check())) { if (Date.now()>deadline) throw new Error("Database observation deadline exceeded"); await new Promise((resolve)=>setTimeout(resolve,10)); }
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET = "disposable-equipment-browser-cursor-fixture";
    process.env.MIRA_EQUIPMENT_NAV = "1";
    const schema = await db.owner.query(`SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cmms_equipment' AND column_name = 'tenant_id'`);
    expect(schema.rows[0]?.data_type).toBe("text");
    await db.owner.query("DO $$ BEGIN CREATE ROLE api_runtime_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'disposable_api_fixture'; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await db.owner.query("ALTER ROLE api_runtime_owner PASSWORD 'disposable_api_fixture'; GRANT factorylm_app TO api_runtime_owner");
    await db.owner.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'API fixture A'),($2,$2::uuid::text,'API fixture B')",[a,b]);
    await db.owner.query("INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path) VALUES($1,$2,'Conveyor 7','conveyor7','enterprise.line.machine'),($3,$4,'Conveyor 7','conveyor7','enterprise.line.machine')",[asset,a,foreignAsset,b]);
    await db.owner.query("INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path) VALUES($1,'legacy-slug','Legacy Conveyor','legacy-conveyor','enterprise.line.legacy')",[legacyAsset]);
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
      const session = token === "expired"
        ? NextResponse.json({error:"Trial ended"}, {status:403})
        : token === "unavailable"
          ? NextResponse.json({error:"Session unavailable"}, {status:503, headers:{"Retry-After":"30"}})
          : users[token as keyof typeof users] ?? null;
      const currentSession = token === "pending-account" ? {...users.a,status:"pending"}
        : token === "completed-trial" ? {...users.a,status:"trial",trialExpiresAt:"2000-01-01T00:00:00Z"} : session;
      auth.run(currentSession, async () => {
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
    await db.owner.query("DELETE FROM namespace_versions WHERE tenant_id = ANY($1::uuid[])",[[a,b]]);
    await db.owner.query("DELETE FROM kg_entities WHERE tenant_id = ANY($1::uuid[])",[[a,b]]);
    await db.owner.query("DELETE FROM cmms_equipment WHERE tenant_id::text=ANY($1::text[]) OR id=$2::uuid",[[a,b],legacyAsset]);
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
    for (const [token,status,error] of [
      ["anonymous",401,"Unauthorized"], ["expired",403,"Trial ended"], ["unavailable",503,"Session unavailable"],
    ] as const) {
      const response = await request("children?parentKind=root",token);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("retry-after")).toBe(status === 503 ? "30" : null);
      expect(await response.json()).toEqual({error});
    }
    for (const query of ["", "parentKind=notebook", "parentKind=root&parentId="+notebook,"parentKind=root&limit=1&limit=2","parentKind=root&tenantId="+b]) {
      expect((await request("children?"+query)).status).toBe(400);
    }
  });

  it("enforces current equipment entitlements at each read handler", async () => {
    for (const endpoint of ["children","search","resolve"]) {
      for (const session of ["pending-account","completed-trial"]) {
        const response = await request(endpoint,session);
        expect(response.status).toBe(403);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(response.headers.get("Location")).toBeNull();
        expect(await response.json()).toMatchObject({error:expect.any(String)});
      }
    }
  });

  it("rejects empty paging inputs and accepts omitted filters", async () => {
    for (const path of [`children?parentKind=notebook&parentId=${notebook}`,
      `search?scopeKind=notebook&scopeId=${notebook}&q=VFD1`]) {
      for (const [parameter,error] of [["cursor","invalid_cursor"],["kind","invalid_request"]]) {
        const response=await request(`${path}&${parameter}=`);
        expect(response.status).toBe(400);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.json()).toEqual({error});
      }
      const first=await request(path);
      expect(first.status).toBe(200);
      expect((await first.json()).counts.total).toBe(2);
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
    const root = await request("children?parentKind=root&kind=asset");
    expect(root.status).toBe(200);
    expect((await root.json()).items.map((row: { id: string }) => row.id)).toEqual([asset]);
    expect((await request(`children?parentKind=notebook&parentId=${notebook}`)).status).toBe(200);
    const listed=await(await request(`children?parentKind=asset&parentId=${asset}`)).json();
    expect(listed.counts.total).toBe(1);expect(listed.items[0]).toMatchObject({id:assignedInstalled,kind:"installed_instance",resolution:{reason:"no_link",target:null}});
    const found=await(await request(`search?scopeKind=asset&scopeId=${asset}&q=MLC`)).json();expect(found.counts.total).toBe(1);
    for(const id of [foreignAsset,legacyAsset,uuid()]) {
      expect((await request(`children?parentKind=asset&parentId=${id}`)).status).toBe(404);
      expect((await request(`search?scopeKind=asset&scopeId=${id}&q=MLC`)).status).toBe(404);
    }
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
    const withoutSelection = route.replace("selectionVersion=1", "selectionVersion=none");
    for (const key of ["browser-thread", "  browser-thread  "]) {
      expect((await request(withoutSelection.replace("browser-thread", encodeURIComponent(key)))).status).toBe(409);
    }
    for (const key of ["", " ", "malformed/thread", "x".repeat(121)]) {
      expect((await request(withoutSelection.replace("browser-thread", encodeURIComponent(key)))).status).toBe(400);
    }
    expect((await request(withoutSelection.replace("&threadKey=browser-thread", ""))).status).toBe(400);
    for (const key of ["legacy", "new-thread"]) {
      expect((await request(withoutSelection.replace("browser-thread", key))).status).toBe(200);
    }
    expect((await request(route,"second")).status).toBe(409);
    const correction=readRevisionInput({ rawLabel:"Needs clarification",inputKind:"typed",unresolved:["catalogNumber"] },false);
    if ("error" in correction) throw new Error(correction.error);
    await reviseComponent(a,notebook,secondComponent,users.a.userId,{clientRequestId:uuid(),expectedRevision:1,revision:correction});
    for (const key of ["browser-thread", "%20browser-thread%20"]) {
      expect((await request(route.replace("browser-thread", key))).status).toBe(409);
    }
    const raw=await (await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${secondComponent}`)).json();
    expect(raw.identityUsable).toBe(false);
    await setSelection(a,notebook,users.a.userId,"browser-thread",{ componentId:null,via:"picker",expectedVersion:1,clientRequestId:uuid() });
    for (const key of ["browser-thread", "%20browser-thread%20"]) {
      expect((await request(route.replace("selectionVersion=1","selectionVersion=2").replace("browser-thread", key))).status).toBe(409);
    }
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
    // If socket close races the late acquisition/preamble, destroying that
    // connection is also safe. There must be no waiter or checked-out lease.
    await until(async()=>db.app.waitingCount===0 && (db.app.totalCount===0 || db.app.idleCount===db.app.totalCount));
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

  it("canonical asset binding, live source counts and normalized labels survive scoped browsing", async () => {
    const line = uuid(), assetNode = uuid(), backing = uuid();
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path,approval_state)
      VALUES ($1,$2,'line',NULL,'Binding line','enterprise.binding.line','verified'),
             ($3,$2,'equipment',$4,'Binding machine','enterprise.binding.line.machine','verified'),
             ($5,$2,'equipment',NULL,'Private backing',NULL,'verified')`,[line,a,assetNode,asset,backing]);
    await db.owner.query("UPDATE cmms_equipment SET uns_path='enterprise.binding.line.machine' WHERE id=$1",[asset]);
    const bound = await createAndBindNotebookTx(a, asset, { selectedVia:"asset_picker", createdBy:users.a.userId });
    if (!bound.ok) throw new Error(bound.error);
    const boundId = bound.notebook.id, unboundId = uuid();
    await db.owner.query("INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name) VALUES($1,$2,$3,'Unplaced notebook')",[unboundId,a,backing]);
    const revision = readRevisionInput({ rawLabel:"ＭＬＣ  starter",inputKind:"typed",unresolved:["catalogNumber"] },false);
    if ("error" in revision) throw new Error(revision.error);
    const added = await addComponent(a,boundId,users.a.userId,{clientRequestId:uuid(),kind:"relay",origin:"technician",position:0,revision});
    if (added.status !== "created") throw new Error(added.status);
    await db.owner.query(`INSERT INTO equipment_notebook_sources(notebook_id,doc_id,tenant_id,match_state)
      VALUES ($1,$2,$3,'verified'),($1,$4,$3,'rejected')`,[boundId,uuid(),a,uuid()]);
    await db.owner.query("UPDATE kg_entities SET name='Current machine', properties=jsonb_build_object('asset_tag','CV binding') WHERE id=$1",[assetNode]);

    const machinePage = await (await request(`children?parentKind=namespace&parentId=${line}`)).json();
    const machines = machinePage.items.filter((row:{id:string}) => row.id === asset || row.id === assetNode);
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({kind:"asset",id:asset,name:"Current machine"});
    const fromDisplayedMachine = await (await request(`children?parentKind=${machines[0].kind}&parentId=${machines[0].id}&kind=notebook`)).json();
    expect(fromDisplayedMachine.items).toMatchObject([{id:boundId}]);
    // Existing KG references remain usable after duplicate machine entries are coalesced.
    const kgChildren = await (await request(`children?parentKind=namespace&parentId=${assetNode}&kind=notebook`)).json();
    expect(kgChildren.items).toMatchObject([{id:boundId}]);
    const listed = await (await request(`children?parentKind=asset&parentId=${asset}&kind=notebook`)).json();
    const expected = { id:boundId, sourceCount:1, asset:{ name:"Current machine", assetTag:"CV binding" } };
    expect(listed.items).toMatchObject([{ id:boundId, placement:"placed", notebook:expected }]);
    const resolved = await (await request(`resolve?targetKind=notebook_component&notebookId=${boundId}&componentId=${added.component.id}`)).json();
    expect(resolved.notebook).toMatchObject(expected);
    const roots = await (await request("children?parentKind=root")).json();
    expect(roots.items).toContainEqual(expect.objectContaining({id:unboundId,placement:"unplaced"}));
    expect(roots.items.map((row:{id:string})=>row.id)).not.toContain(backing);
    for (const scope of [`asset&scopeId=${asset}`,`namespace&scopeId=${assetNode}`,`namespace&scopeId=${line}`]) {
      for (const query of ["ＭＬＣ  starter","MLC starter"]) {
        const found = await (await request(`search?scopeKind=${scope}&kind=notebook_component&q=${encodeURIComponent(query)}`)).json();
        expect(found.counts.total).toBe(1);
        expect(found.items).toMatchObject([{id:added.component.id,component:{current:{rawLabel:"ＭＬＣ  starter"}}}]);
      }
    }

    const newLine = uuid();
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,name,uns_path,approval_state)
      VALUES ($1,$2,'line','Moved line','enterprise.binding.moved','verified')`, [newLine,a]);
    const { PUT } = await import("@/app/api/namespace/node/[id]/route");
    const move = () => auth.run({...users.a,userId:uuid()}, () => PUT(new Request("http://localhost", {
      method: "PUT", body: JSON.stringify({newParentId:newLine}),
    }), {params:Promise.resolve({id:assetNode})}));
    vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL);
    let movedPath: string;
    try {
      const response = await move();
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      movedPath = payload.unsPath;
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await db.owner.query("SELECT uns_path::text FROM cmms_equipment WHERE id=$1",[asset])).rows[0].uns_path).toBe("enterprise.binding.line.machine");
    for (const [parent, count] of [[line,0],[newLine,1]] as const) {
      const page = await (await request(`children?parentKind=namespace&parentId=${parent}&kind=asset&limit=1`)).json();
      expect(page.counts.total).toBe(count);
      if (count === 1) expect(page.items).toMatchObject([{id:asset,unsPath:movedPath,childrenCount:2}]);
      const search = await (await request(`search?scopeKind=namespace&scopeId=${parent}&kind=notebook_component&q=MLC%20starter`)).json();
      expect(search.counts.total).toBe(count);
      if (count === 1) expect(search.items).toMatchObject([{id:added.component.id}]);
    }
    const alias = await (await request(`children?parentKind=namespace&parentId=${assetNode}&kind=notebook`)).json();
    expect(alias.items).toMatchObject([{id:boundId}]);
    const explicitParent = uuid();
    await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path,uns_path)
      VALUES ($1,$2,'Explicit parent','explicit-parent','binding','enterprise.binding.line.explicit_parent')`, [explicitParent,a]);
    try {
      await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[explicitParent,asset]);
      const underAsset = await (await request(`children?parentKind=asset&parentId=${explicitParent}&kind=asset`)).json();
      expect(underAsset.items).toMatchObject([{id:asset,unsPath:movedPath}]);
      const underLine = await (await request(`children?parentKind=namespace&parentId=${newLine}&kind=asset`)).json();
      expect(underLine.counts.total).toBe(0);
      expect((await request(`children?parentKind=namespace&parentId=${assetNode}`,"b")).status).toBe(404);
    } finally {
      await db.owner.query("DELETE FROM cmms_equipment WHERE id=$1",[explicitParent]);
    }
    await db.owner.query("DELETE FROM equipment_notebook_sources WHERE notebook_id=$1",[boundId]);
  });

  it.each(["proposed", "unrelated"])("does not merge a %s bridge from coincident paths or UUIDs", async (mode) => {
    const parent = uuid(), machine = uuid();
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path,approval_state)
      VALUES ($1,$2,'line',$1::uuid::text,'Independent line ' || $1::uuid::text,('enterprise.independent.' || replace($1::uuid::text,'-',''))::ltree,'verified'),
        ($3::uuid,$2::uuid,'equipment',$4::text,'Independent machine ' || $3::uuid::text,('enterprise.independent.' || replace($1::uuid::text,'-','') || '.machine')::ltree,$5)`,
      [parent,a,machine,mode === "proposed" ? machine : uuid(),mode === "proposed" ? "proposed" : "verified"]);
    await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path,uns_path)
      VALUES ($1,$2,'Independent machine ' || $1::uuid::text,$1::uuid::text,'independent',('enterprise.independent.' || replace($3::uuid::text,'-','') || '.machine')::ltree)`,[machine,a,parent]);
    const response = await request(`children?parentKind=namespace&parentId=${parent}`);
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.map((row:{kind:string,id:string})=>[row.kind,row.id])).toEqual([["asset",machine],["namespace",machine]]);
    const namespace = await (await request(`children?parentKind=namespace&parentId=${machine}`)).json();
    expect(namespace.scope).toEqual({kind:"namespace",id:machine});
  });

  it("excludes historical namespace branches and keeps genuine equipment unplaced", async () => {
    const historical = uuid(), child = uuid(), unpathed = uuid(), orphan = uuid(), privateNode = uuid(), book = uuid();
    const prefix = "audit_" + historical.replaceAll("-", "");
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,name,uns_path)
      VALUES ($1,$2,'line','Eligibility history',$3::ltree),($4,$2,'equipment','Eligibility history child',($3::text || '.child')::ltree),
      ($5,$2,'area','Eligibility unpathed',NULL),($6,$2,'equipment','Eligibility private backing',NULL)`,[historical,a,prefix,child,unpathed,privateNode]);
    await db.owner.query("UPDATE kg_entities SET approval_state='verified' WHERE id=$1",[child]);
    await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path,uns_path)
      VALUES ($1,$2,'Eligibility physical',$1::uuid::text,$3,($3::text || '.physical')::ltree)`,[orphan,a,prefix]);
    await db.owner.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id)
      VALUES ($1,$2,$3,'Eligibility notebook',$4::uuid::text)`,[book,a,privateNode,child]);
    const roots = await (await request("children?parentKind=root")).json();
    expect(roots.items).toEqual(expect.arrayContaining([
      expect.objectContaining({id:unpathed,kind:"namespace"}),
      expect.objectContaining({id:orphan,placement:"unplaced"}),
      expect.objectContaining({id:book,placement:"unplaced"}),
    ]));
    expect(roots.items.map((row: {id:string}) => row.id)).not.toEqual(expect.arrayContaining([historical]));
    const matches = await (await request("search?scopeKind=root&q=Eligibility")).json();
    expect(matches.counts.total).toBe(3);
    for (const id of [historical,child,privateNode]) {
      expect((await request(`children?parentKind=namespace&parentId=${id}`)).status).toBe(404);
      expect((await request(`search?scopeKind=namespace&scopeId=${id}&q=Eligibility`)).status).toBe(404);
    }
    expect((await request(`children?parentKind=namespace&parentId=${unpathed}`)).status).toBe(200);
  });

  it("places notebooks only through an eligible unambiguous binding", async () => {
    for (const competing of [false,true]) {
      const machine=uuid(), book=uuid(), other=uuid(), key=machine.replaceAll("-","");
      await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path)
        VALUES($1,$2,$1::uuid::text,$1::uuid::text,'binding')`,[machine,a]);
      await db.owner.query(`INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,uns_path,approval_state)
        VALUES($1,'equipment',$2,'Binding control ' || $2,('audit_' || $3)::ltree,'verified')`,[a,machine,key]);
      if (competing) {
        await db.owner.query(`INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,uns_path,approval_state)
          VALUES($1,'asset',$2,'Binding candidate ' || $2,('enterprise.binding_' || $3)::ltree,'verified')`,[a,machine,key]);
      }
      await db.owner.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id)
        VALUES($1,$2,$3,'Unique notebook placement probe',$4)`,[book,a,other,machine]);
      const root=await (await request("children?parentKind=root&kind=notebook")).json();
      expect(root.items).toContainEqual(expect.objectContaining({id:book,placement:"unplaced"}));
      const children=await (await request(`children?parentKind=asset&parentId=${machine}&kind=notebook`)).json();
      expect(children.counts.total).toBe(0);
      const search=await (await request(`search?scopeKind=asset&scopeId=${machine}&q=Unique%20notebook`)).json();
      expect(search.counts.total).toBe(0);
    }
  });

  it("keeps a mixed parent cycle reachable after a real namespace move", async () => {
    const line = uuid(), first = uuid(), second = uuid(), third = uuid();
    const firstKg = uuid(), secondKg = uuid(), thirdKg = uuid(), firstBook = uuid(), secondBook = uuid();
    await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path)
      SELECT id,$1,'Cycle fixture ' || id::text,id::text,'cycle' FROM unnest($2::uuid[]) AS id`,[a,[first,second,third]]);
    await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[second,first]);
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path,approval_state) VALUES
      ($1,$2,'line',NULL,'Cycle line','enterprise.cycle','verified'),
      ($3,$2,'equipment',$4,'Cycle first','enterprise.cycle.first','verified'),
      ($5,$2,'equipment',$6,'Cycle second','enterprise.cycle.second','verified'),
      ($7,$2,'equipment',$8,'Cycle third','enterprise.cycle.third','verified')`,[line,a,firstKg,first,secondKg,second,thirdKg,third]);
    await db.owner.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id) VALUES
      ($1,$2,$3,'Cycle first notebook',$4),($5,$2,$6,'Cycle second notebook',$7)`,[firstBook,a,uuid(),first,secondBook,uuid(),second]);
    const { PUT } = await import("@/app/api/namespace/node/[id]/route");
    async function move(node: string, parent: string) {
      vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL);
      try {
        const response = await auth.run({...users.a,userId:uuid()}, () => PUT(new Request("http://localhost",{
          method:"PUT",body:JSON.stringify({newParentId:parent}),
        }),{params:Promise.resolve({id:node})}));
        expect(response.status,await response.text()).toBe(200);
      } finally { vi.unstubAllEnvs(); }
    }
    await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[foreignAsset,third]);
    const lineChildren = await (await request(`children?parentKind=namespace&parentId=${line}`)).json();
    expect(lineChildren.items).toContainEqual(expect.objectContaining({id:third}));
    await move(secondKg,firstKg);
    for (const pass of [0,1,2]) {
      if (pass === 1) {
        await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[third,first]);
        await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[second,third]);
      }
      if (pass === 2) {
        await move(secondKg,line);
        await db.owner.query("UPDATE cmms_equipment SET parent_asset_id=$1 WHERE id=$2",[first,second]);
      }
      const rootAsset = pass === 2 ? [first,second,third].sort()[0] : second;
      const root = await (await request("children?parentKind=root&kind=asset")).json();
      expect(root.items).toContainEqual(expect.objectContaining({id:rootAsset,placement:"unplaced",childrenCount:rootAsset === third ? 1 : 2}));
      const otherAssets = [first,second,third].filter(id => id !== rootAsset && (pass !== 0 || id !== third));
      const scope = `search?scopeKind=asset&scopeId=${rootAsset}&q=Cycle`;
      const scoped = await (await request(scope)).json();
      expect(scoped.items.map((row:{id:string})=>row.id).sort()).toEqual([...otherAssets,firstBook,secondBook].sort());
      const kgAlias = rootAsset === first ? firstKg : rootAsset === second ? secondKg : thirdKg;
      const alias = await (await request(`search?scopeKind=namespace&scopeId=${kgAlias}&q=Cycle`)).json();
      expect(alias).toEqual(scoped);
      const firstPage = await (await request(scope+"&limit=1")).json();
      const rest = await (await request(scope+"&cursor="+firstPage.nextCursor)).json();
      expect(rest.counts).toEqual(firstPage.counts);
      expect([...firstPage.items,...rest.items]).toEqual(scoped.items);
    }
  });

  it("keeps generated placement graphs acyclic and reachable", async () => {
    const namespace = uuid();
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,name,uns_path)
      VALUES ($1,$2,'area','Placement property area','enterprise.placement_property')`,[namespace,a]);
    const groups = Array.from({length:16}, (_,mask) => {
      const ids = Array.from({length:4}, () => uuid());
      return ids.map((id,index) => ({
        id,
        path: `enterprise.placement_property.case_${mask}.${ids.slice(0,index+1).map((_,depth)=>"node_"+depth).join(".")}`,
        explicit: (mask & (1 << index)) ? ids[(index+1)%ids.length] : null,
      }));
    });
    const assets = groups.flat();
    const fixture = JSON.stringify(assets);
    await db.owner.query(`INSERT INTO cmms_equipment(id,tenant_id,equipment_number,slug,path)
      SELECT id,$1,id::text,id::text,path FROM jsonb_to_recordset($2::jsonb) AS f(id uuid,path text)`, [a,fixture]);
    await db.owner.query(`INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,uns_path,approval_state)
      SELECT $1,'equipment',id::text,'Placement property machine ' || id::text,path::ltree,'verified'
      FROM jsonb_to_recordset($2::jsonb) AS f(id uuid,path text)`,[a,fixture]);
    await db.owner.query(`UPDATE cmms_equipment e SET parent_asset_id=f.explicit
      FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,explicit uuid) WHERE f.id=e.id`,[fixture]);

    type Result = { id:string; parent:{kind:string;id:string|null}; childrenCount:number };
    const result = await (await request("search?scopeKind=root&kind=asset&q=Placement%20property&limit=100")).json();
    const rows = new Map<string,Result>(result.items.map((item:Result)=>[item.id,item]));
    expect(result.counts.total).toBe(assets.length);
    expect(rows.size).toBe(assets.length);

    for (const [mask,group] of groups.entries()) {
      const groupIds = new Set<string>(group.map(item => item.id));
      const explicitOnlyCut = mask === 15 ? [...groupIds].sort()[0] : null;
      for (const item of group) {
        const row = rows.get(item.id)!;
        if (item.explicit && item.id !== explicitOnlyCut) {
          expect(row.parent).toEqual({kind:"asset",id:item.explicit});
        }
        const seen = new Set<string>([item.id]);
        let parent = row.parent;
        while (parent.kind === "asset") {
          const id = parent.id!;
          expect(groupIds.has(id)).toBe(true);
          expect(seen.has(id),`cycle in generated group ${mask}`).toBe(false);
          seen.add(id);
          parent = rows.get(id)!.parent;
        }
        expect(parent).toEqual(parent.kind === "namespace"
          ? {kind:"namespace",id:namespace}
          : {kind:"root",id:null});
        const direct = group.filter(({id}) => rows.get(id)?.parent.id === item.id).map(({id}) => id).sort();
        expect(row.childrenCount).toBe(direct.length);
        const page = await (await request(`children?parentKind=asset&parentId=${item.id}`)).json();
        expect(page.items.map((child:Result)=>child.id)).toEqual(direct);
      }
    }
    const roots = await (await request("children?parentKind=root&kind=asset&limit=100")).json();
    for (const row of rows.values()) {
      expect(roots.items.some((root:Result)=>root.id===row.id)).toBe(row.parent.kind==="root");
    }
  });

  it("finalizes a large typed placement graph and keeps independent branches reachable", () => {
    const ids = Array.from({length:20_000},(_,i) => `asset-${String(i).padStart(5,"0")}`);
    const edges = ids.map((id,index) => ({
      kind:"asset" as const,id,parent_kind:"asset" as const,
      parent_id:ids[(index+1)%ids.length],explicit_parent:true,
    }));
    const independent = {kind:"namespace" as const,id:ids[0],parent_kind:"root" as const,parent_id:null,explicit_parent:false};
    const mixed = {kind:"asset" as const,id:"attached",parent_kind:"namespace" as const,parent_id:independent.id,explicit_parent:false};
    const graph = [...edges,independent,mixed];
    const cycle = equipmentBrowserTopology(graph,{kind:"asset",id:ids[0]},true);
    expect(cycle.cuts).toEqual([{kind:"asset",id:ids[0]}]);
    expect(cycle.assets).toEqual(ids.slice(1).reverse());
    const healthy = equipmentBrowserTopology(graph,{kind:"namespace",id:ids[0]},true);
    expect(healthy.assets).toEqual([mixed.id]);
    expect(healthy.namespaces).toEqual([]);
  });

  it("uses identical component timestamps in children, search, and exact resolve", async () => {
    const raw = "2026-11-18T12:35:45.125719+00:00", expected = "2026-11-18T12:35:45.125Z";
    await db.owner.query("UPDATE notebook_components SET created_at=$1::timestamptz WHERE id=$2",[raw,componentId]);
    await db.owner.query("UPDATE notebook_component_revisions SET created_at=$1::timestamptz,confirmed_at=$1::timestamptz WHERE component_id=$2",[raw,componentId]);
    const children = await (await request(`children?parentKind=notebook&parentId=${notebook}`)).json();
    const found = await (await request(`search?scopeKind=notebook&scopeId=${notebook}&q=VFD1`)).json();
    const resolved = await (await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${componentId}`)).json();
    expect(resolved.component).toMatchObject({createdAt:expected,retiredAt:null,current:{createdAt:expected,confirmedAt:expected}});
    for (const page of [children, found]) {
      expect(page.items.find((row:{id:string})=>row.id===componentId).component).toEqual(resolved.component);
    }
    const draft = await addComponent(a,notebook,users.a.userId,{
      clientRequestId:uuid(),kind:"timestamp fixture",origin:"technician",position:10,revision:null,
    });
    if (draft.status !== "created") throw new Error(draft.status);
    await db.owner.query("UPDATE notebook_components SET retired_at=$1::timestamptz WHERE id=$2",[raw,draft.component.id]);
    const after = await (await request(`children?parentKind=notebook&parentId=${notebook}`)).json();
    expect(after.items).toContainEqual(expect.objectContaining({id:draft.component.id,
      component:expect.objectContaining({current:null,retiredAt:expected}),
    }));
    expect((await request(`resolve?targetKind=notebook_component&notebookId=${notebook}&componentId=${draft.component.id}`)).status).toBe(409);
  });

  it("20k fixture: SQL-scoped counts, repeated identities and page/cursor boundaries remain isolated", async () => {
    const smallNotebookPage = async () => {
      const response = await request(`children?parentKind=notebook&parentId=${notebook}&limit=1`);
      expect(response.status).toBe(200);
      return response.json();
    };
    const smallPageBefore = await smallNotebookPage();
    // Reuses BRAVO's b061/f755 definition: 8 x 50 x 50, plus 1 x 50 x 50 foreign;
    // VFD1/MLC repeated, first 10 drives per line share GS11N-20P2, serials differ.
    // Bulk fixture inserts are not qualification of writers; existing store suite proves those.
    const lines=[] as Array<{id:string;tenant:string;line:number}>;
    const machines=[] as Array<{id:string;tenant:string;node:string;asset:string;name:string;line:number;machine:number}>;
    for (const [tenant,n] of [[a,8],[b,1]] as const) for(let line=1;line<=n;line++) {
      const node=uuid();lines.push({id:node,tenant,line});
      for(let machine=1;machine<=50;machine++) machines.push({id:uuid(),tenant,node:uuid(),asset:uuid(),name:`Conveyor ${machine}`,line,machine});
    }
    await db.owner.query("INSERT INTO kg_entities(id,tenant_id,entity_type,entity_id,name,uns_path) SELECT id,tenant,'line',id::text,'Line '||line,('enterprise.Line'||line)::ltree FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant uuid,line int)",[JSON.stringify(lines)]);
    await db.owner.query(`INSERT INTO kg_entities(id,tenant_id,entity_type,name,uns_path,approval_state)
      SELECT asset,tenant,'equipment',name||' on line '||line,('enterprise.Line'||line||'.Machine'||machine)::ltree,'verified'
      FROM jsonb_to_recordset($1::jsonb) AS x(asset uuid,tenant uuid,name text,line int,machine int)`,[JSON.stringify(machines)]);
    await db.owner.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id)
      SELECT id,tenant,node,name,asset::text FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,tenant uuid,node uuid,name text,asset uuid)`,[JSON.stringify(machines)]);
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
    await db.owner.query("ANALYZE kg_entities; ANALYZE equipment_notebooks; ANALYZE notebook_components; ANALYZE notebook_component_revisions");
    const smallPageAfter = await smallNotebookPage();
    expect(smallPageAfter).toEqual(smallPageBefore);
    expect(smallPageAfter.items).toMatchObject([{ childrenCount: 0 }]);
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
    const rootSearchStart = performance.now();
    const rootSearchResponse = await request("search?scopeKind=root&q=CA3KN22BD&kind=notebook_component");
    const rootSearch = await rootSearchResponse.text();
    timings.push({case:"root-component-search",milliseconds:performance.now()-rootSearchStart,bytes:Buffer.byteLength(rootSearch)});
    expect(rootSearchResponse.status).toBe(200);
    expect(JSON.parse(rootSearch).counts.total).toBe(400);
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
      const scope = {kind:"namespace",id:line} as const;
      const topology = await readEquipmentBrowserTopology(client,a,scope,true);
      const plan=await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+equipmentBrowserPageSql(true,false),
        [a,scope.kind,scope.id,"notebook_component","GS11N-20P2",null,null,51,JSON.stringify(topology.cuts),topology.namespaces,topology.assets]);
      const small = await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+equipmentBrowserPageSql(false,false,true),
        [a,"notebook",notebook,null,"",null,null,2]);
      const smallPlan = JSON.stringify(small.rows);
      expect(smallPlan).toContain("idx_notebook_components_notebook");
      expect(smallPlan).not.toContain("child_counts");
      return {role,plan:plan.rows,smallNotebookPlan:small.rows};
    },{readOnly:true});
    if(process.env.EQUIPMENT_BROWSER_MEASUREMENTS) writeFileSync(process.env.EQUIPMENT_BROWSER_MEASUREMENTS,JSON.stringify({fixture:{tenantA:20000,tenantB:2500},timings,explain},null,2));
    console.log("equipment-browser measurements",JSON.stringify({fixture:20000,timings}));
  },60000);
});
