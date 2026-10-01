/**
 * LOCAL, OPT-IN proof (#4177 S7, Codex r2 F4) against a REAL throwaway
 * postgres:16 — never runs in CI (same precedent as
 * migration-104-confirm-promotes.local.test.ts and race-4118.local.test.ts).
 *
 * What it proves, with successive REAL claims against a persisted record:
 *  - an EXPLICIT technician confirmation (runManualAcquisition) that hits an
 *    outage is recorded as search_unavailable but never spends the automatic
 *    retry budget — four in a row leave retries at 0;
 *  - an explicit confirmation takes over a terminal record (no_manual_found)
 *    and persists its real outcome;
 *  - an AUTOMATIC retry (startManualAcquisition) after the backoff still
 *    claims and increments retries, so recovery is intact after any number of
 *    explicit attempts.
 *
 * Start a throwaway container, then run:
 *
 *   docker run -d --name pg-claim -e POSTGRES_PASSWORD=race -p 127.0.0.1:55437:5432 postgres:16 \
 *     -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
 *   PG_104=1 NEON_DATABASE_URL=postgres://postgres:race@127.0.0.1:55437/postgres \
 *     npx vitest run src/capabilities/__tests__/claim-retry-accounting.local.test.ts
 *
 * Stop it afterwards: docker rm -f pg-claim
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { runManualAcquisition, startManualAcquisition } from "../notebook-manual-acquisition";
import type { ManualAcquisitionInput, ManualAcquisitionOutcome } from "../manual-acquisition";

const run = process.env.PG_104 === "1" ? describe : describe.skip;
const MIGRATIONS = join(__dirname, "../../../db/migrations");
const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const ON = { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" };
const input: ManualAcquisitionInput = {
  tenantId: TENANT,
  userId: "u1",
  notebookId: NB,
  nodeId: "33333333-3333-4333-8333-333333333333",
  identity: { manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D" },
};
const outage = async (): Promise<ManualAcquisitionOutcome> => ({ status: "search_unavailable", payload: {} });

function client() {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  return c;
}

run("claim retry accounting on real Postgres (#4177 F4)", () => {
  let c: Client;
  beforeAll(async () => {
    c = client();
    await c.connect();
    await c.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      DO $$ BEGIN CREATE ROLE factorylm_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS equipment_notebooks (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, manufacturer text,
        model text, catalog_number text, identity_status text NOT NULL DEFAULT 'unknown', manual_acquisition jsonb);
      GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebooks TO factorylm_app;
    `);
    await c.query(readFileSync(join(MIGRATIONS, "100_notebook_manual_acquisition.sql"), "utf8"));
  });
  beforeEach(async () => {
    await c.query(`DELETE FROM equipment_notebooks WHERE id = $1`, [NB]);
    await c.query(
      `INSERT INTO equipment_notebooks (id, tenant_id, manufacturer, model, identity_status, manual_acquisition)
       VALUES ($1, $2, 'SMC', 'VQ1000-FPG-C6C6-D', 'user_confirmed', NULL)`,
      [NB, TENANT],
    );
  });
  const record = async () =>
    (await c.query<{ r: Record<string, unknown> }>(`SELECT manual_acquisition AS r FROM equipment_notebooks WHERE id = $1`, [NB])).rows[0].r;
  const ageFinished = async (minutes: number) =>
    c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = jsonb_set(manual_acquisition, '{finished_at}',
         to_jsonb((now() - make_interval(mins => $2))::text)) WHERE id = $1`,
      [NB, minutes],
    );

  it("four explicit confirmations during an outage: recorded each time, retries stays 0", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await runManualAcquisition(input, { acquire: vi.fn(outage), env: ON });
      expect(r.started).toBe(true);
      expect(r.outcome?.status).toBe("search_unavailable");
      const rec = await record();
      expect(rec.state).toBe("search_unavailable");
      expect(Number(rec.retries ?? 0)).toBe(0);
    }
  });

  it("an explicit confirmation takes over a terminal record and persists its real outcome", async () => {
    const done = vi.fn(async (): Promise<ManualAcquisitionOutcome> => ({ status: "no_manual_found", payload: {} }));
    expect((await runManualAcquisition(input, { acquire: done, env: ON })).outcome?.status).toBe("no_manual_found");
    expect((await record()).state).toBe("no_manual_found");
    const r = await runManualAcquisition(input, { acquire: vi.fn(outage), env: ON });
    expect(r.started).toBe(true);
    expect((await record()).state).toBe("search_unavailable");
  });

  it("after explicit attempts, an automatic retry still claims after the backoff and spends ONE retry", async () => {
    for (let i = 0; i < 4; i++) await runManualAcquisition(input, { acquire: vi.fn(outage), env: ON });
    expect(Number((await record()).retries ?? 0)).toBe(0);
    // Inside the backoff: the automatic path is refused.
    expect(await startManualAcquisition({ ...input, identity: { identityStatus: "user_confirmed", manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null } }, { acquire: vi.fn(outage), env: ON })).toBe(false);
    await ageFinished(31);
    expect(await startManualAcquisition({ ...input, identity: { identityStatus: "user_confirmed", manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null } }, { acquire: vi.fn(outage), env: ON })).toBe(true);
    await vi.waitFor(async () => expect((await record()).state).toBe("search_unavailable"));
    expect(Number((await record()).retries)).toBe(1);
  });

  it("a live running search refuses an explicit confirmation (it is not taken over)", async () => {
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = jsonb_build_object('key', 'SMC|VQ1000FPGC6C6D|', 'state', 'running',
         'gen', 'g-live', 'started_at', to_jsonb(now()), 'finished_at', NULL) WHERE id = $1`,
      [NB],
    );
    const r = await runManualAcquisition(input, { acquire: vi.fn(outage), env: ON });
    expect(r.started).toBe(false);
    expect((await record()).gen).toBe("g-live");
  });
});
