/**
 * LOCAL, OPT-IN proof for migration 104 (#4160 S6, PRD R3/D2) against a REAL
 * throwaway postgres:16 — never runs in CI (see the task report for why: no
 * CI job is added, per instruction). Mirrors race-4118.local.test.ts's
 * minimal-schema pattern and applies migrations 100, 101, 102, 104 verbatim
 * from the repo files, then drives the REAL trigger function with real
 * UPDATEs, and the REAL fencedWriter/fencedAttach (basis="candidate") against
 * the same database.
 *
 * Start a throwaway container (adjust the port if 55433 is taken), then run:
 *
 *   docker run -d --name pg-104-confirm -e POSTGRES_PASSWORD=race -p 127.0.0.1:55433:5432 postgres:16 \
 *     -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
 *   PG_104=1 NEON_DATABASE_URL=postgres://postgres:race@127.0.0.1:55433/postgres \
 *     npx vitest run src/capabilities/__tests__/migration-104-confirm-promotes.local.test.ts
 *
 * Stop it afterwards: docker rm -f pg-104-confirm
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { fencedAttach, fencedWriter } from "../notebook-manual-acquisition";
import { attachFileToTargetsTx } from "@/lib/workspace-files";

vi.mock("@/lib/workspace-files", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-files")>("@/lib/workspace-files");
  return { ...actual, attachFileToTargetsTx: vi.fn(actual.attachFileToTargetsTx) };
});

const run = process.env.PG_104 === "1" ? describe : describe.skip;
const T = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const DOC2 = "44444444-4444-4444-8444-444444444444";
const KEY = "SMC|SS5Y3DUW01302|";
const GEN = "gen-1";
const MIGRATIONS = join(__dirname, "../../../db/migrations");

async function raw(): Promise<Client> {
  const c = new Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

async function source(c: Client, docId = DOC) {
  const r = await c.query(
    "SELECT match_state, enabled_by_default, match_evidence FROM equipment_notebook_sources WHERE doc_id = $1",
    [docId],
  );
  return r.rows[0];
}

run("Migration 104 — confirming an identity promotes a matching candidate-basis manual (real Postgres)", () => {
  beforeAll(async () => {
    const c = await raw();
    await c.query(`
      DO $$ BEGIN CREATE ROLE factorylm_app; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS equipment_notebooks (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, manufacturer text,
        model text, catalog_number text, identity_status text NOT NULL DEFAULT 'unknown', manual_acquisition jsonb);
      CREATE TABLE IF NOT EXISTS equipment_notebook_sources (tenant_id uuid NOT NULL, notebook_id uuid NOT NULL,
        doc_id uuid NOT NULL, match_state text, enabled_by_default boolean NOT NULL DEFAULT false, match_evidence jsonb,
        source_role text, added_by text, origin_file_id uuid, PRIMARY KEY (notebook_id, doc_id));
      CREATE TABLE IF NOT EXISTS namespace_direct_uploads (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, upload_id uuid);
      GRANT SELECT ON namespace_direct_uploads TO factorylm_app;
      CREATE TABLE IF NOT EXISTS workspace_file_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        file_id uuid NOT NULL, target_type text NOT NULL, target_id uuid NOT NULL);
      GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebooks, equipment_notebook_sources, workspace_file_links TO factorylm_app;`);
    await c.query(readFileSync(join(MIGRATIONS, "100_notebook_manual_acquisition.sql"), "utf8"));
    await c.query(readFileSync(join(MIGRATIONS, "101_notebook_manual_acquisition_revoke_trigger.sql"), "utf8"));
    await c.query(readFileSync(join(MIGRATIONS, "102_notebook_manual_acquisition_revoke_spares_confirmed.sql"), "utf8"));
    await c.query(readFileSync(join(MIGRATIONS, "104_notebook_manual_acquisition_confirm_promotes.sql"), "utf8"));
    await c.end();
  });

  beforeEach(async () => {
    const c = await raw();
    await c.query("DELETE FROM equipment_notebook_sources; DELETE FROM equipment_notebooks;");
    // Starts UNBOUND — identity is confirmed WITHIN each test, as the PATCH
    // bind would do, to exercise the trigger's actual firing condition.
    await c.query(
      `INSERT INTO equipment_notebooks (id, tenant_id, manufacturer, model, identity_status, manual_acquisition)
       VALUES ($1, $2, NULL, NULL, 'unknown', jsonb_build_object('key', $3::text, 'gen', $4::text, 'state', 'candidate_review'))`,
      [NB, T, KEY, GEN],
    );
    await c.end();
  });

  const insertCandidateSource = async (
    c: Client,
    opts: { docId?: string; autoAcquisitionKey?: string; candidateApplicability?: string; revokedBecause?: string | null; matchState?: string } = {},
  ) => {
    const evidence: Record<string, unknown> = {
      decisionMethod: "model_exact_with_manufacturer",
      autoAcquisitionKey: opts.autoAcquisitionKey ?? KEY,
      candidateApplicability: opts.candidateApplicability ?? "verified",
    };
    if (opts.revokedBecause) evidence.revokedBecause = opts.revokedBecause;
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, $4, false, $5::jsonb)`,
      [T, NB, opts.docId ?? DOC, opts.matchState ?? "candidate", JSON.stringify(evidence)],
    );
  };

  const confirmSameIdentity = (c: Client) =>
    c.query(
      `UPDATE equipment_notebooks SET manufacturer = 'SMC', model = 'SS5Y3-DUW01302', identity_status = 'user_confirmed' WHERE id = $1`,
      [NB],
    );

  it("promotes a matching candidate-basis source (same key, candidateApplicability='verified') in the SAME transaction as the identity confirm", async () => {
    const c = await raw();
    await insertCandidateSource(c);
    await c.query("BEGIN");
    await confirmSameIdentity(c);
    // Inside the SAME transaction, before commit: already promoted.
    const inside = await source(c);
    expect(inside.match_state).toBe("verified");
    expect(inside.enabled_by_default).toBe(true);
    expect(inside.match_evidence.promotedBecause).toBe("identity confirmed");
    await c.query("COMMIT");
    const after = await source(c);
    expect(after.match_state).toBe("verified");
    expect(after.enabled_by_default).toBe(true);
    await c.end();
  });

  it("does NOT promote a DIFFERENT key — correcting the identity leaves it a disabled candidate", async () => {
    const c = await raw();
    await insertCandidateSource(c, { autoAcquisitionKey: "SMC|SOMEOTHERPART|" });
    await confirmSameIdentity(c); // confirms KEY, not SMC|SOMEOTHERPART|
    const after = await source(c);
    expect(after.match_state).toBe("candidate");
    expect(after.enabled_by_default).toBe(false);
    await c.end();
  });

  it("does NOT promote a 'candidate' applicability verdict — the judge may only reject, never auto-approve (PRD R8)", async () => {
    const c = await raw();
    await insertCandidateSource(c, { candidateApplicability: "candidate" });
    await confirmSameIdentity(c);
    const after = await source(c);
    expect(after.match_state).toBe("candidate");
    expect(after.enabled_by_default).toBe(false);
    await c.end();
  });

  it("does NOT promote a row 101 already revoked (revokedBecause set) — never resurrected by S6", async () => {
    const c = await raw();
    await insertCandidateSource(c, { revokedBecause: "notebook identity changed" });
    await confirmSameIdentity(c);
    const after = await source(c);
    expect(after.match_state).toBe("candidate");
    expect(after.enabled_by_default).toBe(false);
    await c.end();
  });

  it("does NOT touch a row a human already ruled on (rejected) — match_state is no longer 'candidate'", async () => {
    const c = await raw();
    await insertCandidateSource(c, { matchState: "rejected" });
    await confirmSameIdentity(c);
    const after = await source(c);
    expect(after.match_state).toBe("rejected");
    expect(after.enabled_by_default).toBe(false);
    await c.end();
  });

  it("control: 101's revocation still fires for an ENABLED auto-acquired source whose key no longer matches (104 did not regress 101)", async () => {
    const c = await raw();
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, 'verified', true, jsonb_build_object('autoAcquisitionKey', $4::text))`,
      [T, NB, DOC2, KEY],
    );
    // Confirm to a DIFFERENT identity than DOC2's key.
    await c.query(
      `UPDATE equipment_notebooks SET manufacturer = 'SMC', model = 'SOME-OTHER-PART', identity_status = 'user_confirmed' WHERE id = $1`,
      [NB],
    );
    const after = await source(c, DOC2);
    expect(after.enabled_by_default).toBe(false);
    expect(after.match_state).toBe("candidate");
    expect(after.match_evidence.revokedBecause).toBe("notebook identity changed");
    await c.end();
  });

  describe("fencedWriter(basis='candidate') against the real ownership/promotion SQL", () => {
    it("writes a disabled candidate, stamped, while the notebook is still unconfirmed — never enables, even though patch asks for verified/true", async () => {
      const c = await raw();
      await insertCandidateSource(c, { matchState: "candidate", candidateApplicability: "verified" });
      // Reset to the pending-check evidence shape fencedWriter requires.
      await c.query(
        `UPDATE equipment_notebook_sources SET match_evidence = '{"decisionMethod":"pending_applicability_check"}'::jsonb WHERE doc_id = $1`,
        [DOC],
      );
      await c.end();
      const res = await fencedWriter(KEY, GEN, "candidate")(T, NB, DOC, {
        matchState: "verified",
        enabledByDefault: true,
        matchEvidence: { candidateApplicability: "verified", decisionMethod: "model_exact_with_manufacturer" },
      });
      expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
      const c2 = await raw();
      const row = await source(c2);
      expect(row.match_state).toBe("candidate");
      expect(row.enabled_by_default).toBe(false);
      expect(row.match_evidence.autoAcquisitionKey).toBe(KEY);
      await c2.end();
    });

    it("the common race: notebook is ALREADY confirmed to the SAME key by write time — promotes immediately via the fenced writer itself", async () => {
      const c = await raw();
      await c.query(
        `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
         VALUES ($1, $2, $3, 'candidate', false, '{"decisionMethod":"pending_applicability_check"}'::jsonb)`,
        [T, NB, DOC],
      );
      await confirmSameIdentity(c); // confirmed BEFORE the search's write lands
      await c.end();
      const res = await fencedWriter(KEY, GEN, "candidate")(T, NB, DOC, {
        matchState: "verified",
        enabledByDefault: true,
        matchEvidence: { candidateApplicability: "verified", decisionMethod: "model_exact_with_manufacturer" },
      });
      expect(res).toEqual({ matchState: "verified", enabledByDefault: true });
    });

    // Codex r1 F3 (#4172, HIGH): the common race must NOT bypass the
    // unvalidated-download review hold. Even when the notebook is ALREADY
    // confirmed to the matching key, a candidateApplicability of 'candidate'
    // (manual-acquisition.ts stamps this for a probeUnvalidated download,
    // regardless of how exact the text match was) must never promote.
    it("the common race does NOT promote when candidateApplicability is 'candidate' (an unvalidated download) — review hold wins over confirmation timing", async () => {
      const c = await raw();
      await c.query(
        `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
         VALUES ($1, $2, $3, 'candidate', false, '{"decisionMethod":"pending_applicability_check"}'::jsonb)`,
        [T, NB, DOC],
      );
      await confirmSameIdentity(c); // confirmed BEFORE the search's write lands
      await c.end();
      const res = await fencedWriter(KEY, GEN, "candidate")(T, NB, DOC, {
        matchState: "candidate",
        enabledByDefault: false,
        matchEvidence: { candidateApplicability: "candidate", decisionMethod: "catalog_number_exact" },
      });
      expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
      const c2 = await raw();
      const row = await source(c2);
      expect(row.match_state).toBe("candidate");
      expect(row.enabled_by_default).toBe(false);
      await c2.end();
    });

    it("refuses ownership when confirmed to a DIFFERENT identity — writes nothing", async () => {
      const c = await raw();
      await c.query(
        `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
         VALUES ($1, $2, $3, 'candidate', false, '{"decisionMethod":"pending_applicability_check"}'::jsonb)`,
        [T, NB, DOC],
      );
      await c.query(
        `UPDATE equipment_notebooks SET manufacturer = 'SMC', model = 'SOME-OTHER-PART', identity_status = 'user_confirmed' WHERE id = $1`,
        [NB],
      );
      await c.end();
      const res = await fencedWriter(KEY, GEN, "candidate")(T, NB, DOC, {
        matchState: "verified",
        enabledByDefault: true,
        matchEvidence: {},
      });
      expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
    });
  });

  describe("fencedAttach(basis='candidate') against the real ownership SQL", () => {
    it("attaches while the notebook is unconfirmed", async () => {
      const target = [{ targetType: "equipment_notebook" as const, targetId: NB, role: "manual" as const, displayLabel: "m.pdf" }];
      await expect(fencedAttach(KEY, GEN, "candidate")(T, NB, "file-x", DOC, target, null)).rejects.toThrow(/file_not_found/);
      expect(attachFileToTargetsTx).toHaveBeenCalled();
    });

    it("refuses when confirmed to a DIFFERENT identity", async () => {
      const c = await raw();
      await c.query(
        `UPDATE equipment_notebooks SET manufacturer = 'SMC', model = 'SOME-OTHER-PART', identity_status = 'user_confirmed' WHERE id = $1`,
        [NB],
      );
      await c.end();
      const target = [{ targetType: "equipment_notebook" as const, targetId: NB, role: "manual" as const, displayLabel: "m.pdf" }];
      expect(await fencedAttach(KEY, GEN, "candidate")(T, NB, "file-x", DOC, target, null)).toBe(false);
    });
  });
});
