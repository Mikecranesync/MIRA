/** #5218: real migration SQL, isolated schemas and disposable Postgres only. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";
const url = process.env.TEST_DATABASE_URL;
if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE" || !url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw Error("Confirmed disposable loopback DB required");
const dir = path.resolve(__dirname, "../../../../db");
const sql = {
  111: readFileSync(path.join(dir, "migrations/111_notebook_domain_events_outbox.sql"), "utf8"),
  113: readFileSync(path.join(dir, "proposed/113_asset_observations.sql"), "utf8"),
  114: readFileSync(path.join(dir, "migrations/114_living_work_sheet.sql"), "utf8"),
};
const kinds = ["fix_recorded", "observation_recorded", "job_finished", "work_order_requested"];
for (const order of [[113,114], [114,113]] as const) for (const populated of [false,true]) {
  it(`${order.join(" then ")} / ${populated ? "populated" : "empty"}: preserves rows and both sheet operations`, async () => {
    const c = new Client({connectionString:url}), schema = `compat_${uuid().replaceAll("-", "")}`;
    const tenant = uuid(), notebook = uuid();
    await c.connect();
    try {
      await c.query(`CREATE SCHEMA ${schema}`);
      await c.query(`SET search_path TO ${schema}, public`);
      await c.query(`GRANT USAGE ON SCHEMA ${schema} TO factorylm_app`);
      // Only prerequisite FK targets are fixtures; all tested checks/tables use canonical SQL.
      await c.query("CREATE TABLE equipment_notebooks(id uuid PRIMARY KEY)");
      await c.query("CREATE TABLE tenant_cmms_config(tenant_id text PRIMARY KEY)");
      await c.query("INSERT INTO equipment_notebooks VALUES($1)",[notebook]);
      await c.query(sql[111]);
      const insert = (kind:string,seq:number) => c.query(
        `INSERT INTO notebook_domain_events(tenant_id,notebook_id,aggregate_key,sequence,event_type,
         occurred_at,information_status,correlation_id,policy_version,subject_ref)
         VALUES($1,$2,$3,$4,$5,now(),'technician_reported',$6,'compat',$7) RETURNING event_id`,
        [tenant,notebook,schema,seq,kind,uuid(),`compat:${seq}`]);
      if (populated) {
        // A previously deployed 114 already holds sheet rows before sibling migration replay.
        await c.query(sql[114]);
        for (const [i,k] of kinds.entries()) await insert(k,i+1);
      }
      const before = (await c.query("SELECT * FROM notebook_domain_events ORDER BY sequence")).rows;
      for (const n of order) await c.query(sql[n]);
      expect((await c.query("SELECT * FROM notebook_domain_events ORDER BY sequence")).rows).toEqual(before);
      await c.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.current_tenant_id',$1,false)",[tenant]);
      await c.query("SET ROLE factorylm_app");
      for (const [i,k] of kinds.entries()) {
        const event = await insert(k,i+10);
        if (k === "job_finished" || k === "work_order_requested") await c.query(
          `INSERT INTO notebook_event_deliveries(tenant_id,event_id,aggregate_key,destination,connection_key,operation,dedupe_key)
           VALUES($1,$2,$3,'cmms','atlas',$4,$5)`,
          [tenant,event.rows[0].event_id,schema,k === "job_finished" ? "append_work_log" : "create_work_order",`compat:${i}`]);
      }
      expect((await c.query("SELECT count(*)::int AS n FROM notebook_domain_events")).rows[0].n).toBe(before.length+4);
      expect((await c.query("SELECT count(*)::int AS n FROM notebook_event_deliveries")).rows[0].n).toBe(2);
      await expect(insert("invented_type",99)).rejects.toMatchObject({code:"23514"});
      await c.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.current_tenant_id',$1,false)",[uuid()]);
      expect((await c.query("SELECT count(*)::int AS n FROM notebook_domain_events")).rows[0].n).toBe(0);
    } finally {
      await c.query("ROLLBACK"); await c.query("RESET ROLE"); await c.query("RESET search_path");
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await c.end();
    }
  });
}
