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
import { NextRequest } from "next/server";
import { POST as confirmIdentity } from "@/app/api/equipment-notebooks/[id]/identity/confirm/route";
import * as manualAcquisition from "../manual-acquisition";
import { runManualAcquisition, startManualAcquisition } from "../notebook-manual-acquisition";
import type { ManualAcquisitionInput, ManualAcquisitionOutcome } from "../manual-acquisition";
import { reviewedManualFor } from "../reviewed-manual-library";
import { attachFileToTargetsTx } from "@/lib/workspace-files";

// The real attach needs the full workspace schema; the F7 proof stubs it (same
// as race-4118.local.test.ts) — the checkpoint under test is written by
// fencedAttach itself, in the same transaction, after this call.
vi.mock("@/lib/workspace-files", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-files")>("@/lib/workspace-files");
  return { ...actual, attachFileToTargetsTx: vi.fn(actual.attachFileToTargetsTx) };
});

// Keep the confirmation route and its claims real while isolating session and
// Sources reads that otherwise require the full Hub fixture.
vi.mock("@/lib/session", () => ({
  sessionOr401: async () => ({ tenantId: TENANT, userId: input.userId }),
}));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/equipment-notebooks")>(),
  getNotebook: async () => ({ nodeId: input.nodeId }),
  listSources: async () => [],
}));

const run = process.env.PG_104 === "1" ? describe : describe.skip;
const DOC = "33333333-3333-4333-8333-333333333333";
const FILE = "55555555-5555-4555-8555-555555555555";
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
      ALTER TABLE equipment_notebooks ADD COLUMN IF NOT EXISTS identity_source_type text;
      ALTER TABLE equipment_notebooks ADD COLUMN IF NOT EXISTS updated_at timestamptz;
      CREATE TABLE IF NOT EXISTS equipment_notebook_sources (tenant_id uuid NOT NULL, notebook_id uuid NOT NULL,
        doc_id uuid NOT NULL, match_state text, enabled_by_default boolean NOT NULL DEFAULT false, match_evidence jsonb,
        source_role text, added_by text, origin_file_id uuid, PRIMARY KEY (notebook_id, doc_id));
      CREATE TABLE IF NOT EXISTS workspace_file_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        file_id uuid NOT NULL, target_type text NOT NULL, target_id uuid NOT NULL);
      GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_notebooks, equipment_notebook_sources, workspace_file_links TO factorylm_app;
    `);
    await c.query(readFileSync(join(MIGRATIONS, "100_notebook_manual_acquisition.sql"), "utf8"));
  });
  beforeEach(async () => {
    vi.mocked(attachFileToTargetsTx).mockReset();
    await c.query(`DELETE FROM equipment_notebook_sources; DELETE FROM workspace_file_links;`);
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

  const reviewedIdentity = {
    identityStatus: "user_confirmed",
    manufacturer: "AutomationDirect",
    model: "GS11N-20P2",
    catalogNumber: "",
  };
  const reviewedKey = "AUTOMATIONDIRECT|GS11N20P2|";

  const seedReviewedRecord = async (data: Record<string, unknown>) => {
    await c.query(
      `UPDATE equipment_notebooks
          SET manufacturer = $2, model = $3, manual_acquisition = $4::jsonb
        WHERE id = $1`,
      [NB, reviewedIdentity.manufacturer, reviewedIdentity.model, JSON.stringify({ key: reviewedKey, ...data })],
    );
  };

  it.each([
    { state: "no_manual_found", basis: "candidate" },
    { state: "candidate_review", basis: "confirmed" },
    { state: "candidate_review", basis: "candidate", reviewed_digest: "a".repeat(64) },
    { state: "search_unavailable", basis: "candidate", retries: 3 },
    { state: "search_limit_reached", basis: "candidate" },
  ] as const)("refreshes an unattached $state once for $basis after a new reviewed digest", async ({ basis, ...oldRecord }) => {
    const { rows: [{ now }] } = await c.query<{ now: Date }>("SELECT now() as now");
    await seedReviewedRecord({ ...oldRecord, finished_at: now });
    const acquire = vi.fn(async (): Promise<ManualAcquisitionOutcome> => ({ status: "candidate_review", payload: {} }));
    const attempt = () => startManualAcquisition({ ...input, identity: reviewedIdentity, basis }, { acquire, env: ON });

    const claimed = await Promise.all([attempt(), attempt()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    await vi.waitFor(async () => expect((await record()).state).toBe("candidate_review"));
    expect(await attempt()).toBe(false);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect((await record()).reviewed_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    { state: "no_manual_found", repeatsAs: "candidate_review", retries: 0 },
    { state: "candidate_review", repeatsAs: "candidate_review", retries: 0 },
    { state: "search_unavailable", repeatsAs: "search_unavailable", retries: 3 },
    { state: "search_limit_reached", repeatsAs: "search_limit_reached", retries: 0 },
  ] as const)("confirmation reuses one reviewed search after an unattached $state", async ({ state, repeatsAs, retries }) => {
    const { rows: [{ now }] } = await c.query<{ now: Date }>("SELECT now() as now");
    await seedReviewedRecord({ state, retries, finished_at: now });
    let resolveAcquisition!: (outcome: ManualAcquisitionOutcome) => void;
    const pending = new Promise<ManualAcquisitionOutcome>((resolve) => {
      resolveAcquisition = resolve;
    });
    const acquire = vi.spyOn(manualAcquisition, "acquireManualForIdentity").mockReturnValue(pending);
    const confirm = () => confirmIdentity(new NextRequest("http://test/identity/confirm", {
      method: "POST",
      body: JSON.stringify({ manufacturer: reviewedIdentity.manufacturer, model: reviewedIdentity.model }),
    }), { params: Promise.resolve({ id: NB }) });

    try {
      const first = await confirm();
      expect(await first.json()).toMatchObject({ ok: true, searching: true });
      const second = await confirm();
      expect(await second.json()).toMatchObject({ ok: true, searching: true });
      expect(acquire).toHaveBeenCalledTimes(1);

      resolveAcquisition({ status: repeatsAs, payload: {} });
      await vi.waitFor(async () => expect((await record()).state).toBe(repeatsAs));
      expect((await record()).reviewed_digest).toMatch(/^[0-9a-f]{64}$/);

      const settled = await confirm();
      expect(await settled.json()).toMatchObject({ ok: true, searching: false });
      if (state === "search_unavailable") {
        await ageFinished(31);
        const exhausted = await confirm();
        expect(await exhausted.json()).toMatchObject({ ok: true, searching: false });
      }
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      resolveAcquisition({ status: repeatsAs, payload: {} });
      acquire.mockRestore();
    }
  });

  it.each([
    { linked: true },
    { attached_indexed: true },
    { doc_id: DOC },
    { file_id: FILE },
    { prior_doc_id: DOC },
    { prior_file_id: FILE },
    { source_removed: true },
    { match_state: "rejected" },
  ])("preserves a terminal record with acquisition history %j", async (history) => {
    await seedReviewedRecord({ state: "candidate_review", ...history });
    const acquire = vi.fn(outage);
    const started = await startManualAcquisition({ ...input, identity: reviewedIdentity }, { acquire, env: ON });
    expect(started).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(await record()).toMatchObject(history);
  });

  it.each([
    { model: "6AV2124-0GC01-0AX0", catalogNumber: "" },
    { model: "TP700 Comfort", catalogNumber: "6AV2124‑0GC01‑0AX0" },
  ])("claims the same reviewed Siemens publication on confirmation (%j)", async (fields) => {
    await c.query(
      "UPDATE equipment_notebooks SET identity_status = 'unknown', manufacturer = NULL, model = NULL WHERE id = $1",
      [NB],
    );
    const identity = { manufacturer: "Siemens", ...fields };
    const reviewed = reviewedManualFor({ manufacturer: identity.manufacturer, model: "6AV2124-0GC01-0AX0" });
    expect(reviewed).not.toBeNull();
    const acquire = vi.spyOn(manualAcquisition, "acquireManualForIdentity")
      .mockResolvedValue({ status: "candidate_review", payload: {} });
    try {
      const response = await confirmIdentity(new NextRequest("http://test/identity/confirm", {
        method: "POST",
        body: JSON.stringify(identity),
      }), { params: Promise.resolve({ id: NB }) });
      expect(await response.json()).toMatchObject({ ok: true, searching: true, ...identity });
      await vi.waitFor(async () => expect(await record()).toMatchObject({
        state: "candidate_review",
        reviewed_digest: reviewed!.sha256,
      }));
      expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
        identity: { ...identity, catalogNumber: identity.catalogNumber || undefined },
      }));
    } finally {
      acquire.mockRestore();
    }
  });

  it.each([
    { state: "search_unavailable", retries: 3, source_removed: true },
    { state: "search_unavailable", retries: 3, match_state: "rejected" },
    { state: "search_limit_reached", retries: 0, source_removed: true },
    { state: "search_limit_reached", retries: 0, match_state: "rejected" },
  ])("preserves a historical provider record with removal or rejection %j", async (history) => {
    const { rows: [{ now }] } = await c.query<{ now: Date }>("SELECT now() as now");
    await seedReviewedRecord({ ...history, finished_at: now });
    const acquire = vi.fn(outage);
    expect(await startManualAcquisition({ ...input, identity: reviewedIdentity }, { acquire, env: ON })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(await record()).toMatchObject(history);
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

  // Codex r5 F7 (#4177): the inline runner's attachment is checkpointed in the
  // attach transaction (fenced by its generation), so a crash after the attach
  // commits but before finish cannot lose it — and a removal the technician
  // makes afterwards is honored by stale-running recovery, never undone.
  const bgIdentity = { identityStatus: "user_confirmed" as const, manufacturer: "SMC", model: "VQ1000-FPG-C6C6-D", catalogNumber: null };
  const confirmTimeAttach = async () => {
    vi.mocked(attachFileToTargetsTx).mockImplementation(async () => ({ ok: true, links: [] }) as never);
    let checkpoint: Record<string, unknown> | null = null;
    const inline = vi.fn(async (inp: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> => {
      const attached = await inp.attach!(TENANT, NB, FILE, DOC, [], null);
      // Read the record BEFORE finish runs: this is what a crash would leave.
      checkpoint = { attached, ...(await record()) };
      return { status: "complete", payload: {} };
    });
    expect((await runManualAcquisition(input, { acquire: inline, env: ON })).started).toBe(true);
    expect(checkpoint).toMatchObject({ attached: true, prior_doc_id: DOC, prior_file_id: FILE });
    // The source row the (stubbed) attach would have created, then the "crash":
    // the record is frozen at running, older than the stale window.
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, 'candidate', false, '{}'::jsonb)`,
      [TENANT, NB, DOC],
    );
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = manual_acquisition || jsonb_build_object('state', 'running',
         'started_at', to_jsonb((now() - interval '30 minutes')::text), 'finished_at', null) WHERE id = $1`,
      [NB],
    );
  };
  const recover = async () => {
    const seen: unknown[] = [];
    const bg = vi.fn(async (inp: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> => {
      seen.push(await inp.attach!(TENANT, NB, FILE, DOC, [], null));
      return { status: "no_manual_found", payload: {} };
    });
    expect(await startManualAcquisition({ ...input, identity: bgIdentity }, { acquire: bg, env: ON })).toBe(true);
    await vi.waitFor(() => expect(seen.length).toBe(1));
    return seen[0];
  };

  it("Codex r5 F7: confirm-time attach is checkpointed before finish; after a crash and a removal, recovery does NOT re-attach", async () => {
    await confirmTimeAttach();
    await c.query(`DELETE FROM equipment_notebook_sources WHERE doc_id = $1`, [DOC]); // the technician removes it
    expect(await recover()).toBe("removed");
    expect(vi.mocked(attachFileToTargetsTx)).toHaveBeenCalledTimes(1); // only the confirm-time attach, never again
    expect((await c.query(`SELECT 1 FROM equipment_notebook_sources WHERE doc_id = $1`, [DOC])).rowCount).toBe(0);
    expect((await c.query(`SELECT 1 FROM workspace_file_links WHERE file_id = $1`, [FILE])).rowCount).toBe(0);
  });

  it("Codex r5 F7 control: with the source retained, recovery resumes on it (no second attach)", async () => {
    await confirmTimeAttach();
    expect(await recover()).toBe("resume");
    expect(vi.mocked(attachFileToTargetsTx)).toHaveBeenCalledTimes(1);
  });

  // Codex r6 F8 (#4177): removal history binds AUTOMATIC retries, never a
  // fresh EXPLICIT request. A retryable record remembers what an earlier
  // attempt attached; the technician removed that manual; then they confirm
  // the same nameplate again and ask for the manual — that request attaches
  // what discovery returns now (the same document or a different one). The
  // automatic path still honors the removal.
  const DOC2 = "44444444-4444-4444-8444-444444444444";
  const FILE2 = "66666666-6666-4666-8666-666666666666";
  const removedHistory = async () => {
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = jsonb_build_object('key', 'SMC|VQ1000FPGC6C6D|', 'state', 'search_unavailable',
         'gen', 'g-old', 'retries', 1, 'started_at', to_jsonb((now() - interval '2 hours')::text),
         'finished_at', to_jsonb((now() - interval '90 minutes')::text), 'prior_doc_id', $2::text, 'prior_file_id', $3::text)
       WHERE id = $1`,
      [NB, DOC, FILE],
    );
    // No equipment_notebook_sources row for DOC: the technician removed it.
    vi.mocked(attachFileToTargetsTx).mockImplementation(async () => ({ ok: true, links: [] }) as never);
  };
  const explicitAttach = async (fileId: string, docId: string) => {
    let attached: unknown = null;
    const inline = vi.fn(async (inp: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> => {
      attached = await inp.attach!(TENANT, NB, fileId, docId, [], null);
      return { status: "complete", payload: {} };
    });
    expect((await runManualAcquisition(input, { acquire: inline, env: ON })).started).toBe(true);
    return attached;
  };

  it("Codex r6 F8: after a removal, an explicit confirmation attaches a DIFFERENT document discovery returns now", async () => {
    await removedHistory();
    expect(await explicitAttach(FILE2, DOC2)).toBe(true);
    expect(vi.mocked(attachFileToTargetsTx)).toHaveBeenCalledTimes(1);
    const rec = await record();
    expect(rec.prior_doc_id).toBe(DOC2);
    expect(rec.prior_file_id).toBe(FILE2);
  });

  it("Codex r6 F8: after a removal, an explicit confirmation attaches even the SAME document again", async () => {
    await removedHistory();
    expect(await explicitAttach(FILE, DOC)).toBe(true);
    expect(vi.mocked(attachFileToTargetsTx)).toHaveBeenCalledTimes(1);
  });

  it("Codex r6 F8: the new explicit attachment is itself checkpointed — a crash, then a removal, is honored by automatic recovery", async () => {
    await removedHistory();
    expect(await explicitAttach(FILE2, DOC2)).toBe(true);
    await c.query(
      `INSERT INTO equipment_notebook_sources (tenant_id, notebook_id, doc_id, match_state, enabled_by_default, match_evidence)
       VALUES ($1, $2, $3, 'candidate', false, '{}'::jsonb)`,
      [TENANT, NB, DOC2],
    );
    await c.query(
      `UPDATE equipment_notebooks SET manual_acquisition = manual_acquisition || jsonb_build_object('state', 'running',
         'started_at', to_jsonb((now() - interval '30 minutes')::text), 'finished_at', null) WHERE id = $1`,
      [NB],
    );
    await c.query(`DELETE FROM equipment_notebook_sources WHERE doc_id = $1`, [DOC2]);
    const seen: unknown[] = [];
    const bg = vi.fn(async (inp: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> => {
      seen.push(await inp.attach!(TENANT, NB, FILE2, DOC2, [], null));
      return { status: "no_manual_found", payload: {} };
    });
    expect(await startManualAcquisition({ ...input, identity: bgIdentity }, { acquire: bg, env: ON })).toBe(true);
    await vi.waitFor(() => expect(seen).toEqual(["removed"]));
    expect(vi.mocked(attachFileToTargetsTx)).toHaveBeenCalledTimes(1);
  });

  it("Codex r6 F8 control: the AUTOMATIC retry after a removal is still refused", async () => {
    await removedHistory();
    const seen: unknown[] = [];
    const bg = vi.fn(async (inp: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> => {
      seen.push(await inp.attach!(TENANT, NB, FILE2, DOC2, [], null));
      return { status: "no_manual_found", payload: {} };
    });
    expect(await startManualAcquisition({ ...input, identity: bgIdentity }, { acquire: bg, env: ON })).toBe(true);
    await vi.waitFor(() => expect(seen).toEqual(["removed"]));
    expect(vi.mocked(attachFileToTargetsTx)).not.toHaveBeenCalled();
  });
});
