/**
 * LOCAL-ONLY concurrency proof for Codex #4118 F3 (not committed). Runs the REAL
 * fencedWriter / revokeStaleAutoAcquiredSources against a throwaway postgres:16.
 * Requires PG_RACE=1 and NEON_DATABASE_URL pointing at that container.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { fencedWriter, revokeStaleAutoAcquiredSources } from "../notebook-manual-acquisition";

const run = process.env.PG_RACE === "1" ? describe : describe.skip;
const T = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const KEY_A = "SMC|VQ1000FPGC6C6D|";

async function raw(): Promise<Client> {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function source(c: Client) {
  const r = await c.query("SELECT enabled_by_default, match_state, match_evidence FROM equipment_notebook_sources WHERE doc_id = $1", [DOC]);
  return r.rows[0];
}

run("Codex #4118 F3 — real Postgres, real functions", () => {
  beforeEach(async () => {
    const c = await raw();
    await c.query("DELETE FROM equipment_notebook_sources; DELETE FROM equipment_notebooks;");
    await c.query(
      `INSERT INTO equipment_notebooks (id, tenant_id, manufacturer, model, identity_status, manual_acquisition)
       VALUES ($1, $2, 'SMC', 'VQ1000-FPG-C6C6-D', 'user_confirmed', jsonb_build_object('key', $3::text, 'state', 'running'))`,
      [NB, T, KEY_A],
    );
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, 'candidate', false, '{}'::jsonb)`,
      [T, NB, DOC],
    );
    await c.end();
  });

  const promote = () =>
    fencedWriter(KEY_A)(T, NB, DOC, { matchState: "verified", enabledByDefault: true, matchEvidence: { reason: "r" } });

  it("control: nothing changed → the write lands and is stamped with the search key", async () => {
    expect(await promote()).toBe(true);
    const c = await raw();
    const s = await source(c);
    await c.end();
    expect(s.enabled_by_default).toBe(true);
    expect(s.match_evidence.autoAcquisitionKey).toBe(KEY_A);
  });

  it("a rebind holding the row lock → the writer BLOCKS, then re-checks the new version and REFUSES", async () => {
    const rebind = await raw();
    await rebind.query("BEGIN");
    await rebind.query("UPDATE equipment_notebooks SET model = 'VQ1000-XYZ' WHERE id = $1", [NB]);
    let settled = false;
    const pending = promote().then((v) => {
      settled = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(settled).toBe(false); // blocked on FOR UPDATE
    await rebind.query("COMMIT");
    await rebind.end();
    expect(await pending).toBe(false);
    const c = await raw();
    const s = await source(c);
    await c.end();
    expect(s.enabled_by_default).toBe(false);
    expect(s.match_state).toBe("candidate");
  });

  it("the write commits first → a later rebind + revoke turns the manual off", async () => {
    expect(await promote()).toBe(true);
    const c = await raw();
    await c.query("UPDATE equipment_notebooks SET model = 'VQ1000-XYZ' WHERE id = $1", [NB]);
    expect(await revokeStaleAutoAcquiredSources(T, NB)).toBe(1);
    const s = await source(c);
    await c.end();
    expect(s.enabled_by_default).toBe(false);
    expect(s.match_evidence.revokedBecause).toBe("notebook identity changed");
  });

  it("revoke leaves a manual alone when the identity still matches", async () => {
    expect(await promote()).toBe(true);
    expect(await revokeStaleAutoAcquiredSources(T, NB)).toBe(0);
  });
});
