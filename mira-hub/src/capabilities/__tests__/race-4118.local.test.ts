/**
 * LOCAL, OPT-IN concurrency proof for Codex #4118 (never runs in CI). Drives the
 * REAL fencedWriter / fencedBeforeAttach and the REAL migration-101 trigger
 * against a throwaway postgres:16 with TLS (the Hub pool requires it):
 *
 *   docker run -d --name pg-race-4118 -e POSTGRES_PASSWORD=race -p 127.0.0.1:55432:5432 postgres:16 \
 *     -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
 *   PG_RACE=1 NEON_DATABASE_URL=postgres://postgres:race@127.0.0.1:55432/postgres \
 *     npx vitest run src/capabilities/__tests__/race-4118.local.test.ts
 *
 * The schema is the minimal subset these functions touch, then migrations 100,
 * 101 and 102 are applied from the repo files verbatim.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { fencedBeforeAttach, fencedWriter, reconcileAcquisition, startManualAcquisition } from "../notebook-manual-acquisition";
import { upsertNotebookSourceTx } from "@/lib/equipment-notebooks";

const run = process.env.PG_RACE === "1" ? describe : describe.skip;
const T = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const KEY_A = "SMC|VQ1000FPGC6C6D|";
const GEN = "gen-1";
const MIGRATIONS = join(__dirname, "../../../db/migrations");

async function raw(): Promise<Client> {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function source(c: Client) {
  const r = await c.query("SELECT enabled_by_default, match_state, match_evidence FROM equipment_notebook_sources WHERE doc_id = $1", [DOC]);
  return r.rows[0];
}

run("Codex #4118 — real Postgres, real functions, real trigger", () => {
  beforeAll(async () => {
    const c = await raw();
    await c.query(`
      DO $$ BEGIN CREATE ROLE factorylm_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS equipment_notebooks (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, manufacturer text,
        model text, catalog_number text, identity_status text NOT NULL DEFAULT 'unknown');
      CREATE TABLE IF NOT EXISTS equipment_notebook_sources (tenant_id uuid NOT NULL, notebook_id uuid NOT NULL,
        doc_id uuid NOT NULL, match_state text, enabled_by_default boolean NOT NULL DEFAULT false, match_evidence jsonb,
        source_role text, added_by text, origin_file_id uuid, PRIMARY KEY (notebook_id, doc_id));
      GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebooks, equipment_notebook_sources TO factorylm_app;`);
    await c.query(readFileSync(join(MIGRATIONS, "100_notebook_manual_acquisition.sql"), "utf8"));
    if (process.env.PG_RACE_SKIP_101 !== "1") await c.query(readFileSync(join(MIGRATIONS, "101_notebook_manual_acquisition_revoke_trigger.sql"), "utf8"));
    if (process.env.PG_RACE_SKIP_102 !== "1")
      await c.query(readFileSync(join(MIGRATIONS, "102_notebook_manual_acquisition_revoke_spares_confirmed.sql"), "utf8"));
    await c.end();
  });

  beforeEach(async () => {
    const c = await raw();
    await c.query("DELETE FROM equipment_notebook_sources; DELETE FROM equipment_notebooks;");
    await c.query(
      `INSERT INTO equipment_notebooks (id, tenant_id, manufacturer, model, identity_status, manual_acquisition)
       VALUES ($1, $2, 'SMC', 'VQ1000-FPG-C6C6-D', 'user_confirmed',
               jsonb_build_object('key', $3::text, 'gen', $4::text, 'state', 'running'))`,
      [NB, T, KEY_A, GEN],
    );
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, 'candidate', false, '{"decisionMethod":"pending_applicability_check"}'::jsonb)`,
      [T, NB, DOC],
    );
    await c.end();
  });

  const promote = (gen = GEN) =>
    fencedWriter(KEY_A, gen)(T, NB, DOC, { matchState: "verified", enabledByDefault: true, matchEvidence: { reason: "r" } });

  it("control: nothing changed → the write lands, stamped with the search key", async () => {
    expect(await promote()).toEqual({ matchState: "verified", enabledByDefault: true });
    const c = await raw();
    const s = await source(c);
    await c.end();
    expect(s.enabled_by_default).toBe(true);
    expect(s.match_evidence.autoAcquisitionKey).toBe(KEY_A);
  });

  it("F3: a rebind holding the row lock → the writer BLOCKS, then re-checks the new version and REFUSES", async () => {
    const rebind = await raw();
    await rebind.query("BEGIN");
    await rebind.query("UPDATE equipment_notebooks SET model = 'VQ1000-XYZ' WHERE id = $1", [NB]);
    let settled = false;
    const pending = promote().then((v) => {
      settled = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(settled).toBe(false);
    await rebind.query("COMMIT");
    await rebind.end();
    expect(await pending).toEqual({ matchState: "candidate", enabledByDefault: false });
    const c = await raw();
    const s = await source(c);
    await c.end();
    expect(s.enabled_by_default).toBe(false);
  });

  it("F3: the write commits first → the identity change itself revokes it, in the SAME statement's transaction", async () => {
    expect((await promote())?.enabledByDefault).toBe(true);
    const c = await raw();
    await c.query("BEGIN");
    await c.query("UPDATE equipment_notebooks SET model = 'VQ1000-XYZ' WHERE id = $1", [NB]);
    // Inside the identity transaction, before commit: already revoked.
    const inside = await source(c);
    expect(inside.enabled_by_default).toBe(false);
    expect(inside.match_evidence.revokedBecause).toBe("notebook identity changed");
    await c.query("COMMIT");
    await c.end();
  });

  it("F3 control: an unrelated notebook update (display_name) revokes nothing; a matching identity keeps it", async () => {
    expect((await promote())?.enabledByDefault).toBe(true);
    const c = await raw();
    await c.query("UPDATE equipment_notebooks SET model = 'VQ1000-FPG-C6C6-D' WHERE id = $1", [NB]);
    expect((await source(c)).enabled_by_default).toBe(true);
    await c.end();
  });

  it("F6: a stale-claim takeover (new generation) fences out the old worker", async () => {
    const c = await raw();
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = manual_acquisition || jsonb_build_object('gen', 'gen-2') WHERE id = $1`,
      [NB],
    );
    await c.end();
    expect(await promote(GEN)).toEqual({ matchState: "candidate", enabledByDefault: false });
    expect(await promote("gen-2")).toEqual({ matchState: "verified", enabledByDefault: true });
  });

  it("r4 F7: an existing source row does not block the pre-attach check; a lost generation does", async () => {
    expect(await fencedBeforeAttach(KEY_A, GEN)(T, NB, DOC)).toBe(true);
    expect(await fencedBeforeAttach(KEY_A, "gen-other")(T, NB, DOC)).toBe(false);
  });

  const setSource = async (sql: string) => {
    const c = await raw();
    await c.query(sql, [DOC]);
    await c.end();
  };

  it.each([
    ["rejected by the technician", "UPDATE equipment_notebook_sources SET match_state = 'rejected' WHERE doc_id = $1", "rejected", false],
    ["confirmed by the technician", "UPDATE equipment_notebook_sources SET match_state = 'user_confirmed', enabled_by_default = true WHERE doc_id = $1", "user_confirmed", true],
    [
      "verified then disabled by the technician",
      "UPDATE equipment_notebook_sources SET match_state = 'verified', enabled_by_default = false, match_evidence = '{\"decisionMethod\":\"catalog_number_exact\"}'::jsonb WHERE doc_id = $1",
      "verified",
      false,
    ],
  ])("r5 F8: a source %s after attachment is NOT overwritten, and the writer reports it", async (_l, sql, state, enabled) => {
    await setSource(sql);
    const c0 = await raw();
    const before = await source(c0);
    await c0.end();
    expect(await promote()).toEqual({ matchState: state, enabledByDefault: enabled });
    const c = await raw();
    const after = await source(c);
    await c.end();
    expect(after).toEqual(before);
  });

  it("r5 F8: an inconclusive re-assessment cannot demote a user-confirmed source", async () => {
    await setSource("UPDATE equipment_notebook_sources SET match_state = 'user_confirmed', enabled_by_default = true WHERE doc_id = $1");
    const res = await fencedWriter(KEY_A, GEN)(T, NB, DOC, { matchState: "candidate", enabledByDefault: false, matchEvidence: {} });
    expect(res).toEqual({ matchState: "user_confirmed", enabledByDefault: true });
  });

  it("r5 F9: a source deleted after attachment → the writer reports null, and nothing is recreated", async () => {
    await setSource("DELETE FROM equipment_notebook_sources WHERE doc_id = $1");
    expect(await promote()).toBeNull();
    const c = await raw();
    expect(await source(c)).toBeUndefined();
    await c.end();
  });

  it("r5 control: an undecided candidate this acquisition attached is still promoted", async () => {
    expect(await promote()).toEqual({ matchState: "verified", enabledByDefault: true });
  });

  it("r7 F11: a technician-confirmed auto-found manual survives an identity change", async () => {
    expect((await promote())?.enabledByDefault).toBe(true); // auto-enabled, stamped with KEY_A
    await setSource("UPDATE equipment_notebook_sources SET match_state = 'user_confirmed' WHERE doc_id = $1"); // PATCH keeps evidence
    const c = await raw();
    await c.query("UPDATE equipment_notebooks SET model = 'VQ1000-XYZ' WHERE id = $1", [NB]);
    const s = await source(c);
    await c.end();
    expect(s.match_state).toBe("user_confirmed");
    expect(s.enabled_by_default).toBe(true);
    expect(s.match_evidence.revokedBecause).toBeUndefined();
  });

  const acqInput = {
    tenantId: T,
    userId: null,
    notebookId: NB,
    nodeId: "node",
    identity: { identityStatus: "user_confirmed", manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null },
  };
  const setRecord = async (state: string, finishedAgoMinutes: number) => {
    const c = await raw();
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = jsonb_build_object('key', $2::text, 'gen', 'old', 'state', $3::text,
         'started_at', to_jsonb(now() - make_interval(mins => $4 + 1)), 'finished_at', to_jsonb(now() - make_interval(mins => $4)))
        WHERE id = $1`,
      [NB, KEY_A, state, finishedAgoMinutes],
    );
    await c.end();
  };
  const tryStart = () =>
    startManualAcquisition(acqInput, {
      acquire: vi.fn(async () => ({ status: "no_manual_found", payload: {} })) as never,
      env: { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" },
    });

  it("r7 F12: a search that failed on an unavailable service is retried after the backoff", async () => {
    await setRecord("search_unavailable", 45);
    expect(await tryStart()).toBe(true);
  });

  it("r7 F12 controls: not before the backoff; a finished real outcome is never re-run", async () => {
    await setRecord("search_unavailable", 5);
    expect(await tryStart()).toBe(false);
    await setRecord("no_manual_found", 600);
    expect(await tryStart()).toBe(false);
    await setRecord("complete", 600);
    expect(await tryStart()).toBe(false);
  });

  it("r8 F13: a completed acquisition whose source was deleted is reconciled as removed; control: present", async () => {
    const rec = {
      key: KEY_A,
      state: "complete" as const,
      started_at: null,
      finished_at: null,
      candidate_host: null,
      match_state: "verified",
      oem_request_url: null,
      attached_indexed: true,
      doc_id: DOC,
    };
    expect((await reconcileAcquisition(T, NB, rec))?.source_removed).toBeUndefined();
    await setSource("DELETE FROM equipment_notebook_sources WHERE doc_id = $1");
    expect(await reconcileAcquisition(T, NB, rec)).toMatchObject({ source_removed: true, attached_indexed: false });
  });

  it("r4 F5: a stale candidate re-attach cannot overwrite a VERIFIED source's evidence or flags", async () => {
    expect((await promote())?.enabledByDefault).toBe(true); // verified + enabled + autoAcquisitionKey A
    const c = await raw();
    await c.query("BEGIN");
    await upsertNotebookSourceTx(c as never, {
      notebookId: NB,
      docId: DOC,
      tenantId: T,
      matchState: "candidate",
      sourceRole: "manual",
      addedBy: null,
      matchEvidence: { decisionMethod: "pending_applicability_check", from: "stale worker" },
    } as never);
    await c.query("COMMIT");
    const s = await source(c);
    await c.end();
    expect(s.match_state).toBe("verified");
    expect(s.enabled_by_default).toBe(true);
    expect(s.match_evidence.autoAcquisitionKey).toBe(KEY_A);
    expect(s.match_evidence.from).toBeUndefined();
  });

  it("r4 F5 control: a candidate re-attach over a CANDIDATE row still refreshes its evidence", async () => {
    const c = await raw();
    await c.query("BEGIN");
    await upsertNotebookSourceTx(c as never, {
      notebookId: NB,
      docId: DOC,
      tenantId: T,
      matchState: "candidate",
      sourceRole: "manual",
      addedBy: null,
      matchEvidence: { from: "retry" },
    } as never);
    await c.query("COMMIT");
    const s = await source(c);
    await c.end();
    expect(s.match_evidence.from).toBe("retry");
  });
});
