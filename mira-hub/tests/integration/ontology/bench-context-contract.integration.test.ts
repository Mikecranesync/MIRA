// Bench runtime context contract: drive + supply relay, on a REAL PostgreSQL
// built from the real Hub migrations, through the Hub's real code.
//
//   cd mira-hub
//   TEST_DATABASE_URL=postgres://... MIRA_TEST_DB_CONFIRM=DISPOSABLE \
//   MIRA_INTEGRATION_EXTRA_MIGRATIONS=018_relationship_proposals.sql,021_namespace_builder.sql,\
//   028_drives_relationship_type.sql,032_inferred_relationship_types.sql,\
//   038_relationship_type_asset_graph.sql,043_has_work_order_relationship_type.sql,\
//   050_kg_relationships_proposal_id.sql node scripts/setup-integration-db.mjs
//   node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/ontology
//
// EVIDENCE CLASS: local, disposable PostgreSQL. No CI job runs this file today,
// so nothing here is "enforced"; it is an executable contract. It makes no
// provider call: "used in an answer" below means the formatted context block
// the asset chat route prepends to the prompt, not a model's reply.
//
// WHAT IS REAL
//   installed machine  -> a cmms_equipment row inserted by the test, then the real
//                         mintAssetBridgeNode (the function asset-create calls)
//   propose            -> mapToCanonicalEdge + upsertInferredProposal, the exact
//                         sequence relationship-extractor / cmms-sync /
//                         hierarchy-backfill run
//   approve / reject   -> the POST handler of /api/proposals/[id]/decide with the
//                         real capability check and the real withTenantContext
//   read               -> buildGraphContext (what /api/assets/[id]/chat calls),
//                         impactAnalysis / maintenanceContext (traversal.ts), and
//                         the POST handler of /api/internal/kg with the request
//                         body mira-bots/shared/engine.py sends
//   supersede          -> applyHubProposalTransition (ADR-0017 helper). NO route
//                         fires it for a graph edge; the test calls it directly
//                         and says so.
// WHAT IS MOCKED: the session cookie lookup (sessionOr401) and the pg pool
// (pointed at the disposable database). Nothing else.
//
// THE BENCH FACT: one-line sheet E-002 (plc/conv_simple_electrical/model/
// e002_oneline.yaml) draws Q1 -> VFD1: the relay hand-labelled "MLC" switches
// the drive's supply. The Hub's lowercase name for that is `feeds`.
//
// KNOWN GAPS are written with `knownGap`: it first pins today's exact behaviour
// (so a schema or permission error cannot pass for the defect), then requires
// the wanted assertion to fail. When the owning issue is repaired the test
// fails loudly and tells the repairer to convert it to a plain assertion.
// Owners: #5519 (reader/writer relationship names), #5523 (superseded facts
// stay verified), #5524 (dedup blocks a revised proposal), #5527 (answer
// context loses edge identity and provenance). This file repairs none of them.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { applyHubProposalTransition } from "@/lib/proposal-transition";
import { mintAssetBridgeNode } from "@/lib/knowledge-graph/asset-bridge";
import { mapToCanonicalEdge, upsertInferredProposal } from "@/lib/knowledge-graph/proposals-writer";
import { buildGraphContext, classifyKgIntent, formatMaintenanceContext } from "@/lib/knowledge-graph/context-builder";
import { flagPmMismatches } from "@/lib/knowledge-graph/plan-vs-actual";
import { impactAnalysis, maintenanceContext, rootCauseChain, traverseChain } from "@/lib/knowledge-graph/traversal";
import { POST as decidePOST } from "@/app/api/proposals/[id]/decide/route";
import { POST as internalKgPOST } from "@/app/api/internal/kg/route";

const TENANT_A = "00000000-0000-0000-0000-00000be2c401";
const TENANT_B = "00000000-0000-0000-0000-00000be2c402";
const ADMIN_A = "user-admin-a";
const INTERNAL_KEY = "bench-contract-internal-key";
const IMPACT_QUESTION = "What is affected downstream if the supply relay drops out?";

/**
 * Strict, non-vacuous expected failure. `pinned` must pass (today's exact
 * behaviour); `wanted` must throw an assertion error. Any other outcome fails.
 */
function knownGap(issue: string, pinned: () => void, wanted: () => void): void {
  pinned();
  let failure: unknown = null;
  try {
    wanted();
  } catch (err) {
    failure = err;
  }
  if (failure === null) {
    throw new Error(
      `${issue} looks REPAIRED: the wanted assertion now passes. Convert this knownGap into a plain assertion.`,
    );
  }
  expect((failure as Error).name).toBe("AssertionError");
}

interface Installed {
  assetId: string; // cmms_equipment.id, the id the asset chat route is called with
  nodeId: string; // kg_entities.id
  unsPath: string;
}

let admin: PoolClient;
// Ids carried between the ordered steps below.
const S: { feeds: string; feedsEdge: string; rejected: string } = { feeds: "", feedsEdge: "", rejected: "" };
const A: Record<string, Installed> = {};
const B: Record<string, Installed> = {};

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  await admin.query("BEGIN");
  try {
    const out = await fn();
    await admin.query("COMMIT");
    return out;
  } catch (err) {
    await admin.query("ROLLBACK");
    throw err;
  }
}

async function install(
  tenant: string,
  tag: string,
  description: string,
  manufacturer: string,
  model: string,
): Promise<Installed> {
  return inTx(async () => {
    const { rows } = await admin.query(
      `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, slug, path)
       VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id::text AS id`,
      [tenant, tag, manufacturer, tag.toLowerCase(), `/${tag.toLowerCase()}`],
    );
    const assetId = String(rows[0].id);
    const res = await mintAssetBridgeNode(admin, tenant, { assetId, tag, description, manufacturer, model });
    if (!res.ok) throw new Error(`mintAssetBridgeNode refused ${tag}: ${res.reason}`);
    return { assetId, nodeId: res.nodeId, unsPath: res.unsPath };
  });
}

/** The writers' sequence: lowercase name -> canonical edge (maybe flipped) -> proposal. */
async function propose(
  tenant: string,
  lowercaseType: string,
  from: Installed,
  to: Installed,
  reasoning: string,
): Promise<string | null> {
  const mapped = mapToCanonicalEdge(lowercaseType);
  if (!mapped) throw new Error(`no canonical edge for ${lowercaseType}`);
  const [src, tgt] = mapped.flip ? [to, from] : [from, to];
  return withTenantContext(tenant, (c) =>
    upsertInferredProposal(c, tenant, {
      sourceEntityId: src.nodeId,
      sourceEntityType: "equipment",
      targetEntityId: tgt.nodeId,
      targetEntityType: "equipment",
      relationshipType: mapped.type,
      confidence: 0.8,
      reasoning,
      evidence: [
        {
          evidenceType: "document_page",
          sourceDescription: "CV-101 one-line E-002 rev A",
          excerpt: "Q1/MLC supply switch -> VFD1 (GS10)",
          confidenceContribution: 0.8,
        },
      ],
    }),
  );
}

async function decide(
  proposalId: string,
  decision: "verify" | "reject",
  who: { tenantId: string; userId: string; role: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: who.userId,
    tenantId: who.tenantId,
    email: "bench@example.local",
    status: "active",
    trialExpiresAt: null,
    role: who.role,
  } as never);
  const res = await decidePOST(
    new Request(`http://hub.test/api/proposals/${proposalId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: "bench contract" }),
    }),
    { params: Promise.resolve({ id: proposalId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function edgeRows(tenant: string, proposalId: string) {
  const { rows } = await admin.query(
    `SELECT id::text AS id, source_id::text AS source_id, target_id::text AS target_id,
            relationship_type, approval_state, proposed_by, evidence_summary,
            relationship_proposal_id::text AS relationship_proposal_id
       FROM kg_relationships WHERE tenant_id = $1::uuid AND relationship_proposal_id = $2::uuid`,
    [tenant, proposalId],
  );
  return rows as Array<Record<string, string | null>>;
}

async function proposalRow(proposalId: string) {
  const { rows } = await admin.query(
    `SELECT status, relationship_type, source_entity_id::text AS source_entity_id,
            target_entity_id::text AS target_entity_id, created_by, reviewed_by,
            reviewed_at, reasoning
       FROM relationship_proposals WHERE id = $1::uuid`,
    [proposalId],
  );
  return rows[0] as Record<string, string | null> | undefined;
}

/** Positive control only: store the edge under the name the reader asks for, run, restore. */
async function withStoredName<T>(edgeId: string, name: string, fn: () => Promise<T>): Promise<T> {
  const before = await admin.query(`SELECT relationship_type FROM kg_relationships WHERE id = $1::uuid`, [edgeId]);
  await admin.query(`UPDATE kg_relationships SET relationship_type = $2 WHERE id = $1::uuid`, [edgeId, name]);
  try {
    return await fn();
  } finally {
    await admin.query(`UPDATE kg_relationships SET relationship_type = $2 WHERE id = $1::uuid`, [
      edgeId,
      before.rows[0].relationship_type,
    ]);
  }
}

const downstreamNodeIds = async (tenant: string, from: Installed) =>
  (await impactAnalysis(tenant, from.nodeId)).downstream.map((n) => n.entity.id);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required: see this file's header.");
  }
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE: this suite writes and deletes rows.");
  }
  // The route handlers and buildGraphContext only check that these are set; the pool is mocked.
  process.env.NEON_DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.INTERNAL_KG_API_KEY = INTERNAL_KEY;

  admin = await testPool.connect();
  // Production grants these in 023_grant_app_namespace_tables.sql (lines 34-35). That file
  // cannot be applied to the integration schema: it also grants on tables that only the
  // engine-side base schema creates. The two statements below are copied from it verbatim.
  await admin.query("GRANT SELECT, INSERT, UPDATE ON relationship_proposals TO factorylm_app");
  await admin.query("GRANT SELECT, INSERT ON relationship_evidence TO factorylm_app");

  for (const t of [TENANT_A, TENANT_B]) {
    await admin.query(`DELETE FROM kg_relationships WHERE tenant_id = $1::uuid`, [t]);
    await admin.query(`DELETE FROM relationship_proposals WHERE tenant_id = $1::uuid`, [t]);
    await admin.query(`DELETE FROM kg_entities WHERE tenant_id = $1::uuid`, [t]);
    await admin.query(`DELETE FROM cmms_equipment WHERE tenant_id = $1::uuid`, [t]);
    await admin.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1::uuid, $2, $2) ON CONFLICT (id) DO NOTHING`,
      [t, `bench-contract-${t.slice(-4)}`],
    );
  }
  await admin.query(`DELETE FROM relationship_proposals WHERE tenant_id IS NULL AND reasoning = 'bench contract: global row'`);

  A.CV101 = await install(TENANT_A, "CV-101", "CV-101 belt conveyor", "FactoryLM bench", "CV-101");
  A.Q1 = await install(TENANT_A, "Q1", "Q1 supply relay (hand-labelled MLC)", "Schneider Electric", "CA3KN22BD");
  A.VFD1 = await install(TENANT_A, "VFD1", "VFD1 conveyor drive", "AutomationDirect", "GS11N-20P2");
  A.VFD2 = await install(TENANT_A, "VFD2", "VFD2 second drive of the same model", "AutomationDirect", "GS11N-20P2");
  B.Q1 = await install(TENANT_B, "Q1", "Q1 supply relay (hand-labelled MLC)", "Schneider Electric", "CA3KN22BD");
  B.VFD1 = await install(TENANT_B, "VFD1", "VFD1 conveyor drive", "AutomationDirect", "GS11N-20P2");
});

afterAll(async () => {
  admin?.release();
  await testPool.end();
});

describe("0. the disposable database carries the real schema", () => {
  it("has the proposal, evidence and graph tables and the proposal-link column from the real migrations", async () => {
    const { rows } = await admin.query(
      `SELECT to_regclass('public.relationship_proposals') IS NOT NULL AS proposals,
              to_regclass('public.relationship_evidence') IS NOT NULL AS evidence,
              to_regclass('public.kg_relationships') IS NOT NULL AS edges,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'kg_relationships' AND column_name = 'relationship_proposal_id') AS link`,
    );
    expect(rows[0]).toEqual({ proposals: true, evidence: true, edges: true, link: true });
  });
});

describe("1. installed instance is not the catalog model", () => {
  it("two installed drives of one model are two verified machines with their own ids and paths", async () => {
    expect(A.VFD1.nodeId).not.toBe(A.VFD2.nodeId);
    expect(A.VFD1.assetId).not.toBe(A.VFD2.assetId);
    expect(A.VFD1.unsPath).not.toBe(A.VFD2.unsPath);
    const { rows } = await admin.query(
      `SELECT entity_id, approval_state, properties->>'model_number' AS model, uns_path::text AS uns_path
         FROM kg_entities WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY name`,
      [TENANT_A, [A.VFD1.nodeId, A.VFD2.nodeId]],
    );
    expect(rows.map((r) => r.model)).toEqual(["GS11N-20P2", "GS11N-20P2"]);
    expect(rows.every((r) => r.approval_state === "verified" && r.uns_path)).toBe(true);
    expect(new Set(rows.map((r) => r.entity_id)).size).toBe(2);
  });

  it("OBSERVED, not a pass: asset create records the model as text; no catalog-model node or instance_of link exists", async () => {
    const types = await admin.query(
      `SELECT DISTINCT entity_type FROM kg_entities WHERE tenant_id = $1::uuid ORDER BY 1`,
      [TENANT_A],
    );
    expect(types.rows.map((r) => r.entity_type)).toEqual(["equipment", "site"]);
    const links = await admin.query(`SELECT count(*)::int AS n FROM kg_relationships WHERE tenant_id = $1::uuid`, [
      TENANT_A,
    ]);
    expect(links.rows[0].n).toBe(0);
  });
});

describe("2. a proposed relationship is evidence, not an answer", () => {
  it("the writer stores Q1 feeds VFD1 as a proposed UPSTREAM_OF edge with its evidence, direction kept", async () => {
    const id = await propose(TENANT_A, "feeds", A.Q1, A.VFD1, "E-002: the MLC relay switches the drive supply");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    S.feeds = id as string;
    const p = await proposalRow(S.feeds);
    expect(p).toMatchObject({
      status: "proposed",
      relationship_type: "UPSTREAM_OF",
      source_entity_id: A.Q1.nodeId,
      target_entity_id: A.VFD1.nodeId,
      created_by: "rule",
      reviewed_by: null,
    });
    const ev = await admin.query(
      `SELECT evidence_type, source_description, excerpt FROM relationship_evidence WHERE proposal_id = $1::uuid`,
      [S.feeds],
    );
    expect(ev.rows).toEqual([
      {
        evidence_type: "document_page",
        source_description: "CV-101 one-line E-002 rev A",
        excerpt: "Q1/MLC supply switch -> VFD1 (GS10)",
      },
    ]);
  });

  it("before approval nothing is in the graph and no reader serves it", async () => {
    expect(await edgeRows(TENANT_A, S.feeds)).toEqual([]);
    expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([]);
    const block = await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId);
    expect(block).toContain(`[GRAPH CONTEXT for ${A.Q1.assetId}]`);
    expect(block).not.toContain(A.VFD1.assetId);
  });
});

describe("3. approval is explicit, human, role-gated and tenant-bound", () => {
  it("a non-admin role is refused and the proposal stays proposed", async () => {
    const res = await decide(S.feeds, "verify", { tenantId: TENANT_A, userId: "user-tech-a", role: "technician" });
    expect(res.status).toBe(403);
    expect((await proposalRow(S.feeds))?.status).toBe("proposed");
    expect(await edgeRows(TENANT_A, S.feeds)).toEqual([]);
  });

  it("an admin of another tenant cannot see or decide it", async () => {
    const res = await decide(S.feeds, "verify", { tenantId: TENANT_B, userId: "user-admin-b", role: "admin" });
    expect(res.status).toBe(404);
    expect((await proposalRow(S.feeds))?.status).toBe("proposed");
    expect(await edgeRows(TENANT_A, S.feeds)).toEqual([]);
  });

  it("rejected evidence never reaches the graph, and the rejection is kept", async () => {
    const wrong = await propose(TENANT_A, "feeds", A.VFD2, A.CV101, "misread sheet: drive 2 feeds the conveyor frame");
    expect(wrong).toMatch(/^[0-9a-f-]{36}$/);
    S.rejected = wrong as string;
    const res = await decide(S.rejected, "reject", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" });
    expect(res.status).toBe(200);
    const p = await proposalRow(S.rejected);
    expect(p).toMatchObject({ status: "rejected", reviewed_by: `human:${ADMIN_A}` });
    expect(p?.reviewed_at).not.toBeNull();
    expect(await edgeRows(TENANT_A, S.rejected)).toEqual([]);
    const ev = await admin.query(`SELECT count(*)::int AS n FROM relationship_evidence WHERE proposal_id = $1::uuid`, [
      S.rejected,
    ]);
    expect(ev.rows[0].n).toBe(1);
  });

  it("an admin's approval writes one verified edge that links back to the proposal, its proposer and its reason", async () => {
    const res = await decide(S.feeds, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" });
    expect(res.status).toBe(200);
    const p = await proposalRow(S.feeds);
    expect(p).toMatchObject({ status: "verified", reviewed_by: `human:${ADMIN_A}` });
    expect(p?.reviewed_at).not.toBeNull();
    const rows = await edgeRows(TENANT_A, S.feeds);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_id: A.Q1.nodeId,
      target_id: A.VFD1.nodeId,
      relationship_type: "UPSTREAM_OF",
      approval_state: "verified",
      proposed_by: "rule",
      evidence_summary: "E-002: the MLC relay switches the drive supply",
      relationship_proposal_id: S.feeds,
    });
    S.feedsEdge = rows[0].id as string;
  });

  it("an approved proposal cannot be decided again through the route (there is no correction route)", async () => {
    const res = await decide(S.feeds, "reject", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" });
    expect(res.status).toBe(409);
    expect((await edgeRows(TENANT_A, S.feeds))[0].approval_state).toBe("verified");
  });
});

describe("4. the approved relationship read through the application's own traversal", () => {
  it("preconditions: the reader finds the relay, and the question is an impact question", async () => {
    const mc = await maintenanceContext(TENANT_A, A.Q1.assetId);
    expect(mc?.equipment.id).toBe(A.Q1.nodeId);
    expect(classifyKgIntent(IMPACT_QUESTION)).toBe("impact");
  });

  it("positive control: stored under the reader's own name, the edge is read and lands in the answer context", async () => {
    await withStoredName(S.feedsEdge, "feeds", async () => {
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD1.nodeId]);
      const block = await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId);
      expect(block).toContain(`[IMPACT ANALYSIS for ${A.Q1.assetId}]\nDownstream: ${A.VFD1.assetId}`);
      // The other installed drive of the same model is a different machine: not implicated.
      expect(block).not.toContain(A.VFD2.assetId);
    });
  });

  it("#5519 repaired: as approval actually stores it (UPSTREAM_OF), the impact reader and the answer context see it", async () => {
    expect((await edgeRows(TENANT_A, S.feeds))[0].relationship_type).toBe("UPSTREAM_OF"); // nothing renamed
    expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD1.nodeId]);
    const block = await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId);
    expect(block).toContain(`[IMPACT ANALYSIS for ${A.Q1.assetId}]\nDownstream: ${A.VFD1.assetId}`);
    expect(block).not.toContain(A.VFD2.assetId); // the other drive of the same model is not implicated
  });

  it("#5519: an edge present under BOTH names for the same pair is read once, not twice", async () => {
    await admin.query(
      `INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, approval_state)
       SELECT tenant_id, source_id, target_id, 'feeds', 'verified' FROM kg_relationships WHERE id = $1::uuid`,
      [S.feedsEdge],
    );
    try {
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD1.nodeId]);
    } finally {
      await admin.query(
        `DELETE FROM kg_relationships WHERE relationship_type = 'feeds' AND tenant_id = $1::uuid
           AND (source_id, target_id) IN (SELECT source_id, target_id FROM kg_relationships WHERE id = $2::uuid)`,
        [TENANT_A, S.feedsEdge],
      );
    }
  });

  // The same mismatch, per reader, for the other bench relationships.
  const readerCases = [
    {
      lowercase: "has_component",
      stored: "HAS_COMPONENT",
      from: () => A.CV101,
      to: () => A.VFD1,
      read: async () => (await maintenanceContext(TENANT_A, A.CV101.assetId))?.components.map((e) => e.id) ?? null,
      reader: "maintenanceContext.components",
    },
    {
      lowercase: "similar_to",
      stored: "SIMILAR_TO",
      from: () => A.VFD1,
      to: () => A.VFD2,
      read: async () =>
        (await maintenanceContext(TENANT_A, A.VFD1.assetId, { includeSimilar: true }))?.similarEquipment.map(
          (e) => e.id,
        ) ?? null,
      reader: "maintenanceContext.similarEquipment",
    },
  ];
  for (const c of readerCases) {
    it(`#5519 repaired: ${c.reader} asks for '${c.lowercase}', approval stores '${c.stored}', and the reader sees it`, async () => {
      const id = (await propose(TENANT_A, c.lowercase, c.from(), c.to(), `bench: ${c.lowercase}`)) as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await decide(id, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
      const rows = await edgeRows(TENANT_A, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ relationship_type: c.stored, approval_state: "verified" });

      const controlled = await withStoredName(rows[0].id as string, c.lowercase, c.read);
      expect(controlled).toEqual([c.to().nodeId]); // the reader works when the name matches

      expect(await c.read()).toEqual([c.to().nodeId]); // as stored, without renaming
    });
  }

  it("the engine's own request (internal route, by plant path) finds the machine with its approved component (#5519 repaired)", async () => {
    const res = await internalKgPOST(
      new Request("http://hub.test/api/internal/kg", {
        method: "POST",
        headers: { authorization: `Bearer ${INTERNAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          op: "maintenance_context",
          tenantId: TENANT_A,
          args: { unsPath: A.CV101.unsPath, maxWorkOrders: 3 },
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: { equipment: { id: string }; components: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.result.equipment.id).toBe(A.CV101.nodeId);
    expect(body.result.components).toHaveLength(1);
  });

  it("KNOWN GAP #5527: even when read, the answer context names no edge id, proposal, approver or source", async () => {
    const block = await withStoredName(S.feedsEdge, "feeds", () =>
      buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId),
    );
    knownGap(
      "#5527",
      () => {
        expect(block).toContain(`Downstream: ${A.VFD1.assetId}`);
        expect(block).not.toContain("E-002");
      },
      () => {
        // the whole of #5527, not one field: proposal, approver and cited source
        expect(block).toContain(S.feeds);
        expect(block).toContain(ADMIN_A);
        expect(block).toContain("E-002");
      },
    );
  });
});

describe("4b. the rest of the bench's relationship names, through the real name mapper", () => {
  // Executed above end to end: feeds, has_component, similar_to. This sweep runs the real
  // mapToCanonicalEdge over every name a traversal.ts reader filters on, plus the names the
  // bench one-line needs. It does NOT propose/approve each one; it shows the outcome is the
  // same for all of them, because approval stores what the mapper returns.
  const READER_NAMES = [
    "feeds", "caused_by", "parent_of", "has_component", "had_fault",
    "has_work_order", "requires_part", "has_pm", "similar_to",
  ];

  it("no name a reader filters on is the name approval stores — which is why readers go through the shared read view (#5519)", () => {
    for (const n of READER_NAMES) {
      const type = mapToCanonicalEdge(n)?.type ?? null;
      expect(type, n).not.toBeNull();
      expect(type, n).not.toBe(n);
    }
  });

  it("OBSERVED: 'controls' and 'protects' (PLC -> drive, breaker -> supply) cannot be proposed at all", () => {
    expect(mapToCanonicalEdge("controls")).toBeNull();
    expect(mapToCanonicalEdge("protects")).toBeNull();
  });

  it("OBSERVED: a wired connection maps to WIRED_TO, which no traversal reader filters on", () => {
    expect(mapToCanonicalEdge("electrically_connected")).toEqual({ type: "WIRED_TO", flip: false });
    expect(READER_NAMES).not.toContain("electrically_connected");
  });
});

describe("5. correcting a fact: old fact out of current answers, kept in history", () => {
  it("positive control, before any correction: a row that leaves 'verified' does drop out of the reader", async () => {
    // Runs BEFORE the supersede step and restores the state it found, so it can never
    // re-verify an edge that a repaired supersede has just taken out of the verified set.
    const prior = (await edgeRows(TENANT_A, S.feeds))[0].approval_state;
    expect(prior).toBe("verified");
    await withStoredName(S.feedsEdge, "feeds", async () => {
      await admin.query(`UPDATE kg_relationships SET approval_state = 'rejected' WHERE id = $1::uuid`, [S.feedsEdge]);
      try {
        expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([]);
      } finally {
        await admin.query(`UPDATE kg_relationships SET approval_state = $2 WHERE id = $1::uuid`, [S.feedsEdge, prior]);
      }
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD1.nodeId]);
    });
  });

  it("supersede through the canonical helper marks the proposal deprecated and keeps its history", async () => {
    // No route or job fires `supersede` for a graph edge; this calls the ADR-0017 helper directly.
    await withTenantContext(TENANT_A, (c) =>
      applyHubProposalTransition(c, {
        trigger: "supersede",
        relationshipProposalId: S.feeds,
        reviewerLabel: `human:${ADMIN_A}`,
        reason: "corrected on the bench: the relay feeds the second drive",
      }),
    );
    const p = await proposalRow(S.feeds);
    expect(p).toMatchObject({
      status: "deprecated",
      reviewed_by: `human:${ADMIN_A}`,
      reasoning: "corrected on the bench: the relay feeds the second drive",
    });
    const ev = await admin.query(`SELECT count(*)::int AS n FROM relationship_evidence WHERE proposal_id = $1::uuid`, [
      S.feeds,
    ]);
    expect(ev.rows[0].n).toBe(1);
    // History is retained: the graph row and its link to the superseded proposal still exist.
    expect(await edgeRows(TENANT_A, S.feeds)).toHaveLength(1);
  });

  it("#5523 repaired: the superseded edge has left the verified set (row kept, state 'rejected')", async () => {
    const rows = await edgeRows(TENANT_A, S.feeds);
    expect(rows).toHaveLength(1);
    expect(rows[0].approval_state).toBe("rejected");
    // a reader that queries the table directly with the usual predicate no longer finds it
    const direct = await admin.query(
      `SELECT count(*)::int AS n FROM kg_relationships
        WHERE tenant_id = $1::uuid AND source_id = $2::uuid AND approval_state = 'verified'`,
      [TENANT_A, A.Q1.nodeId],
    );
    expect(direct.rows[0].n).toBe(0);
  });

  it("#5523 read-side guard: after the supersede, no reader serves the old fact — and the answer context drops it", async () => {
    // As stored (UPSTREAM_OF); nothing renamed.
    expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([]);
    const block = await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId);
    expect(block).not.toContain(`Downstream: ${A.VFD1.assetId}`);
    expect(block).not.toContain("[IMPACT ANALYSIS");
    // a caller that passes the stored canonical name does not get it either
    expect((await traverseChain(TENANT_A, A.Q1.nodeId, ["UPSTREAM_OF"])).map((h) => h.entity.id)).toEqual([]);
    // history: the row, its proposal link and the deprecated proposal are all still there
    expect(await edgeRows(TENANT_A, S.feeds)).toHaveLength(1);
    expect((await proposalRow(S.feeds))?.status).toBe("deprecated");
  });

  it("control: the two protections are independent — the row state alone, and the read guard alone, each keep it out", async () => {
    // (a) row back to 'verified', proposal still deprecated: the read-side guard alone hides it
    await admin.query(`UPDATE kg_relationships SET approval_state = 'verified' WHERE id = $1::uuid`, [S.feedsEdge]);
    try {
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([]);
      // (b) and with the supersede lifted as well, the fact is read again — so the reader works
      await admin.query(`UPDATE relationship_proposals SET status = 'verified' WHERE id = $1::uuid`, [S.feeds]);
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD1.nodeId]);
    } finally {
      await admin.query(`UPDATE relationship_proposals SET status = 'deprecated' WHERE id = $1::uuid`, [S.feeds]);
      await admin.query(`UPDATE kg_relationships SET approval_state = 'rejected' WHERE id = $1::uuid`, [S.feedsEdge]);
    }
    // (c) proposal lifted but row still 'rejected': the row state alone hides it
    await admin.query(`UPDATE relationship_proposals SET status = 'verified' WHERE id = $1::uuid`, [S.feeds]);
    try {
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([]);
    } finally {
      await admin.query(`UPDATE relationship_proposals SET status = 'deprecated' WHERE id = $1::uuid`, [S.feeds]);
    }
  });

  // Pins the literal 'deprecated' (the ontology's word, and the proposal's). A repair that
  // adds a differently named state leaves this green: re-read it when #5523 lands.
  it("KNOWN GAP #5523: a graph edge cannot hold the 'deprecated' state its proposal moves to", async () => {
    let refused: string | null = null;
    await admin.query("BEGIN");
    try {
      await admin.query(`UPDATE kg_relationships SET approval_state = 'deprecated' WHERE id = $1::uuid`, [S.feedsEdge]);
    } catch (err) {
      refused = (err as { constraint?: string }).constraint ?? "unknown";
    } finally {
      await admin.query("ROLLBACK");
    }
    knownGap(
      "#5523",
      () => expect(refused).toBe("kg_relationships_approval_state_check"),
      () => expect(refused).toBeNull(),
    );
  });

  it("the corrected fact can be proposed and approved; #5523 repaired: only the corrected one is verified", async () => {
    const id = (await propose(TENANT_A, "feeds", A.Q1, A.VFD2, "bench correction: relay feeds drive 2")) as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await decide(id, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
    const { rows } = await admin.query(
      `SELECT target_id::text AS target_id FROM kg_relationships
        WHERE tenant_id = $1::uuid AND source_id = $2::uuid
          AND relationship_type = 'UPSTREAM_OF' AND approval_state = 'verified' ORDER BY created_at`,
      [TENANT_A, A.Q1.nodeId],
    );
    const current = rows.map((r) => r.target_id);
    expect(current).toEqual([A.VFD2.nodeId]);
  });

  it("the complete path: after the correction, the reader and the answer name the corrected drive only", async () => {
    expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD2.nodeId]);
    const block = await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.Q1.assetId);
    expect(block).toContain(`[IMPACT ANALYSIS for ${A.Q1.assetId}]\nDownstream: ${A.VFD2.assetId}`);
    expect(block).not.toContain(A.VFD1.assetId);
  });

  it("a superseded fact that a human approves AGAIN is current again (the row keeps its first proposal link)", async () => {
    // The writer cannot re-propose this pair today (#5524, pinned below), so the second
    // proposal is inserted directly — the shape a #5524 repair would produce — and then
    // approved through the real route.
    const { rows } = await admin.query(
      `INSERT INTO relationship_proposals
         (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type,
          relationship_type, confidence, created_by, reasoning)
       VALUES ($1::uuid, $2::uuid, 'equipment', $3::uuid, 'equipment', 'UPSTREAM_OF', 0.8, 'human',
               'bench contract: re-approved after a supersede')
       RETURNING id::text AS id`,
      [TENANT_A, A.Q1.nodeId, A.VFD1.nodeId],
    );
    const again = String(rows[0].id);
    try {
      expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD2.nodeId]); // proposed only: still out
      expect((await decide(again, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
      const link = await admin.query(
        `SELECT relationship_proposal_id::text AS p FROM kg_relationships WHERE id = $1::uuid`,
        [S.feedsEdge],
      );
      expect(link.rows[0].p).toBe(S.feeds); // still linked to the deprecated proposal
      expect((await downstreamNodeIds(TENANT_A, A.Q1)).sort()).toEqual([A.VFD1.nodeId, A.VFD2.nodeId].sort());
      const state = await admin.query(`SELECT approval_state FROM kg_relationships WHERE id = $1::uuid`, [S.feedsEdge]);
      expect(state.rows[0].approval_state).toBe("verified"); // approval puts the row back
      // REPLAY: the old supersede is applied again (a retry). The later approval outranks it.
      const replay = await withTenantContext(TENANT_A, (c) =>
        applyHubProposalTransition(c, { trigger: "supersede", relationshipProposalId: S.feeds }),
      );
      expect(replay.kgEdgesDemoted).toBe(0);
      expect((await downstreamNodeIds(TENANT_A, A.Q1)).sort()).toEqual([A.VFD1.nodeId, A.VFD2.nodeId].sort());
      expect((await traverseChain(TENANT_A, A.Q1.nodeId, ["UPSTREAM_OF"])).map((h) => h.entity.id).sort()).toEqual(
        [A.VFD1.nodeId, A.VFD2.nodeId].sort(),
      );
    } finally {
      await admin.query(`DELETE FROM relationship_proposals WHERE id = $1::uuid`, [again]);
      await admin.query(`UPDATE kg_relationships SET approval_state = 'rejected' WHERE id = $1::uuid`, [S.feedsEdge]);
    }
    expect(await downstreamNodeIds(TENANT_A, A.Q1)).toEqual([A.VFD2.nodeId]);
  });

  it("KNOWN GAP #5524: a revised proposal for the superseded pair is silently dropped", async () => {
    const again = await propose(TENANT_A, "feeds", A.Q1, A.VFD1, "re-proposed with a new sheet revision");
    knownGap(
      "#5524",
      () => expect(again).toBeNull(),
      () => expect(typeof again).toBe("string"),
    );
  });
});

describe("6. tenant isolation", () => {
  it("another tenant's readers return nothing for this tenant's machine, by asset id or by graph id", async () => {
    // Its own freshly approved edge (the drive feeds the conveyor), so this test does not
    // depend on what a repaired supersede does to the corrected fact in section 5.
    const id = (await propose(TENANT_A, "feeds", A.VFD1, A.CV101, "E-002: the drive output runs the conveyor motor")) as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await decide(id, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
    const edge = (await edgeRows(TENANT_A, id))[0].id as string;
    await withStoredName(edge, "feeds", async () => {
      expect(await downstreamNodeIds(TENANT_A, A.VFD1)).toEqual([A.CV101.nodeId]); // visible to its owner
      expect(await maintenanceContext(TENANT_B, A.VFD1.assetId)).toBeNull();
      expect(await maintenanceContext(TENANT_B, A.VFD1.nodeId)).toBeNull();
      expect(await downstreamNodeIds(TENANT_B, A.VFD1)).toEqual([]);
      expect(await buildGraphContext(TENANT_B, IMPACT_QUESTION, A.VFD1.assetId)).toBe("");
    });
  });

  it("the same plant path in two tenants resolves to each tenant's own machine", async () => {
    expect(B.VFD1.unsPath).toBe(A.VFD1.unsPath);
    const res = await internalKgPOST(
      new Request("http://hub.test/api/internal/kg", {
        method: "POST",
        headers: { authorization: `Bearer ${INTERNAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ op: "maintenance_context", tenantId: TENANT_B, args: { unsPath: A.VFD1.unsPath } }),
      }) as never,
    );
    const body = (await res.json()) as { ok: boolean; result: { equipment: { id: string; tenantId: string } } };
    expect(body.result.equipment.id).toBe(B.VFD1.nodeId);
    expect(body.result.equipment.tenantId).toBe(TENANT_B);
    // and the other way round, so "first row wins" could not pass this
    const resA = await internalKgPOST(
      new Request("http://hub.test/api/internal/kg", {
        method: "POST",
        headers: { authorization: `Bearer ${INTERNAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ op: "maintenance_context", tenantId: TENANT_A, args: { unsPath: A.VFD1.unsPath } }),
      }) as never,
    );
    const bodyA = (await resA.json()) as { result: { equipment: { id: string; tenantId: string } } };
    expect(bodyA.result.equipment.id).toBe(A.VFD1.nodeId);
    expect(bodyA.result.equipment.tenantId).toBe(TENANT_A);
  });

  it("row-level security hides this tenant's edges, proposals and evidence from the other tenant's session", async () => {
    const counts = await withTenantContext(TENANT_B, async (c) => {
      const q = async (sql: string) => Number((await c.query<{ n: number }>(sql, [TENANT_A])).rows[0].n);
      return {
        edges: await q(`SELECT count(*)::int AS n FROM kg_relationships WHERE tenant_id = $1::uuid`),
        entities: await q(`SELECT count(*)::int AS n FROM kg_entities WHERE tenant_id = $1::uuid`),
        proposals: await q(`SELECT count(*)::int AS n FROM relationship_proposals WHERE tenant_id = $1::uuid`),
        evidence: await q(
          `SELECT count(*)::int AS n FROM relationship_evidence e
             JOIN relationship_proposals p ON p.id = e.proposal_id WHERE p.tenant_id = $1::uuid`,
        ),
      };
    });
    expect(counts).toEqual({ edges: 0, entities: 0, proposals: 0, evidence: 0 });
    const own = await admin.query(`SELECT count(*)::int AS n FROM kg_relationships WHERE tenant_id = $1::uuid`, [
      TENANT_A,
    ]);
    expect(own.rows[0].n).toBeGreaterThan(0); // the zeros above are isolation, not an empty table
  });

  it("the wrong internal key is refused before any read", async () => {
    const res = await internalKgPOST(
      new Request("http://hub.test/api/internal/kg", {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ op: "maintenance_context", tenantId: TENANT_A, args: { unsPath: A.VFD1.unsPath } }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});

describe("7. provenance the served row can and cannot answer for", () => {
  it("from a verified edge you can reach who proposed it, who approved it, when, and the cited source", async () => {
    const { rows } = await admin.query(
      `SELECT r.proposed_by, p.reviewed_by, p.reviewed_at IS NOT NULL AS has_time,
              e.evidence_type, e.source_description
         FROM kg_relationships r
         JOIN relationship_proposals p ON p.id = r.relationship_proposal_id
         JOIN relationship_evidence e ON e.proposal_id = p.id
        WHERE r.id = $1::uuid`,
      [S.feedsEdge],
    );
    expect(rows).toEqual([
      {
        proposed_by: "rule",
        reviewed_by: `human:${ADMIN_A}`,
        has_time: true,
        evidence_type: "document_page",
        source_description: "CV-101 one-line E-002 rev A",
      },
    ]);
  });

  it("OBSERVED, not a pass: nothing structured records the source revision, a validity window, or what replaced a fact", async () => {
    const { rows } = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('kg_relationships', 'relationship_evidence', 'relationship_proposals')
          AND column_name ~ '(revision|superseded|replaced|valid_(from|to|until)|source_sha|content_sha)'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("8. the same contract across more of the bench (provisional inventory, graph path)", () => {
  // The inventory on #5504 is provisional. These are the machine-to-machine links its one-line
  // implies, run through the SAME propose -> decide -> reader sequence as Q1 -> VFD1. This is
  // second-consumer (graph path) evidence only; the pilot's notebook chat reads none of it.
  const LINKS = [
    { name: "feeds", from: "CB1", to: "PS1", stored: "UPSTREAM_OF", flipped: false },
    { name: "feeds", from: "PS1", to: "PLC1", stored: "UPSTREAM_OF", flipped: false },
    { name: "feeds", from: "VFD1", to: "M1", stored: "UPSTREAM_OF", flipped: false },
    { name: "electrically_connected", from: "VFD1", to: "M1", stored: "WIRED_TO", flipped: false },
    { name: "parent_of", from: "CV101", to: "M1", stored: "LOCATED_IN", flipped: true },
    { name: "has_component", from: "CV101", to: "PLC1", stored: "HAS_COMPONENT", flipped: false },
  ] as const;
  const made: Record<string, string> = {};

  beforeAll(async () => {
    A.CB1 = await install(TENANT_A, "CB1", "CB1 supply breaker", "FactoryLM bench", "CB-1");
    A.PS1 = await install(TENANT_A, "PS1", "PS1 24 V power supply", "FactoryLM bench", "PS-1");
    A.PLC1 = await install(TENANT_A, "PLC1", "PLC1 controller", "FactoryLM bench", "PLC-1");
    A.M1 = await install(TENANT_A, "M1", "M1 conveyor motor", "FactoryLM bench", "M-1");
  });

  for (const l of LINKS) {
    const key = `${l.from} ${l.name} ${l.to}`;
    it(`${key}: not in the graph while proposed; approval writes one verified ${l.stored} edge, direction ${l.flipped ? "flipped" : "kept"}`, async () => {
      const id = (await propose(TENANT_A, l.name, A[l.from], A[l.to], `bench: ${key}`)) as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await edgeRows(TENANT_A, id)).toEqual([]);
      expect((await decide(id, "verify", { tenantId: TENANT_B, userId: "user-admin-b", role: "admin" })).status).toBe(404);
      expect((await decide(id, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
      const rows = await edgeRows(TENANT_A, id);
      expect(rows).toHaveLength(1);
      const [src, tgt] = l.flipped ? [A[l.to], A[l.from]] : [A[l.from], A[l.to]];
      expect(rows[0]).toMatchObject({
        source_id: src.nodeId,
        target_id: tgt.nodeId,
        relationship_type: l.stored,
        approval_state: "verified",
        relationship_proposal_id: id,
      });
      made[key] = rows[0].id as string;
    });
  }

  it("rejected evidence for a bench link (PLC1 feeds VFD1) writes no edge", async () => {
    const id = (await propose(TENANT_A, "feeds", A.PLC1, A.VFD1, "bench: wrong reading of the one-line")) as string;
    expect((await decide(id, "reject", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
    expect(await edgeRows(TENANT_A, id)).toEqual([]);
    expect((await proposalRow(id))?.status).toBe("rejected");
  });

  it("positive control: under the reader's own name CB1 -> PS1 -> PLC1 and VFD1 -> M1 are each read downstream", async () => {
    const seen = await withStoredName(made["CB1 feeds PS1"], "feeds", () =>
      withStoredName(made["PS1 feeds PLC1"], "feeds", () => downstreamNodeIds(TENANT_A, A.CB1)),
    );
    expect(seen).toContain(A.PS1.nodeId);
    expect(seen).toContain(A.PLC1.nodeId);
    const motor = await withStoredName(made["VFD1 feeds M1"], "feeds", () => downstreamNodeIds(TENANT_A, A.VFD1));
    expect(motor).toContain(A.M1.nodeId);
  });

  it("#5519 repaired: as approved, the supply chain is read downstream — CB1 -> PS1 -> PLC1, and VFD1 -> M1", async () => {
    const fromBreaker = await downstreamNodeIds(TENANT_A, A.CB1);
    expect(fromBreaker).toEqual(expect.arrayContaining([A.PS1.nodeId, A.PLC1.nodeId]));
    expect(fromBreaker).not.toContain(A.M1.nodeId); // the breaker does not feed the motor
    expect(await downstreamNodeIds(TENANT_A, A.VFD1)).toContain(A.M1.nodeId);
    // the REJECTED link (PLC1 feeds VFD1) wrote no edge, so the drive is not downstream of the breaker
    expect(fromBreaker).not.toContain(A.VFD1.nodeId);
  });

  it("#5519 repaired: the conveyor's approved controller is in its component list", async () => {
    const read = async () => (await maintenanceContext(TENANT_A, A.CV101.assetId))?.components.map((e) => e.id) ?? [];
    expect(await withStoredName(made["CV101 has_component PLC1"], "has_component", read)).toContain(A.PLC1.nodeId);
    expect(await read()).toContain(A.PLC1.nodeId);
  });

  it("#5519 repaired, FLIPPED name: walking 'parent_of' from the conveyor reaches the motor (stored as motor LOCATED_IN conveyor)", async () => {
    const down = await traverseChain(TENANT_A, A.CV101.nodeId, ["parent_of"]);
    expect(down.map((h) => h.entity.id)).toContain(A.M1.nodeId);
    // direction is respected: the conveyor is not below the motor
    const wrongWay = await traverseChain(TENANT_A, A.M1.nodeId, ["parent_of"]);
    expect(wrongWay.map((h) => h.entity.id)).not.toContain(A.CV101.nodeId);
    // and the stored canonical name still works for a caller that passes it
    const stored = await traverseChain(TENANT_A, A.M1.nodeId, ["LOCATED_IN"]);
    expect(stored.map((h) => h.entity.id)).toContain(A.CV101.nodeId);
  });

  it("#5519 repaired, FLIPPED name: 'VFD1 caused_by CB1' is stored as CB1 CAUSES VFD1 and read as a cause of VFD1, not of CB1", async () => {
    const id = (await propose(TENANT_A, "caused_by", A.VFD1, A.CB1, "bench: drive trip traced to the breaker")) as string;
    expect((await decide(id, "verify", { tenantId: TENANT_A, userId: ADMIN_A, role: "admin" })).status).toBe(200);
    const row = (await edgeRows(TENANT_A, id))[0];
    expect(row).toMatchObject({ relationship_type: "CAUSES", source_id: A.CB1.nodeId, target_id: A.VFD1.nodeId });
    const causesOfDrive = await rootCauseChain(TENANT_A, A.VFD1.nodeId);
    expect(causesOfDrive.chain.map((c) => c.entity.id)).toContain(A.CB1.nodeId);
    const causesOfBreaker = await rootCauseChain(TENANT_A, A.CB1.nodeId);
    expect(causesOfBreaker.chain.map((c) => c.entity.id)).not.toContain(A.VFD1.nodeId);
  });

  it("OBSERVED: the parent link is stored reversed AND renamed (what the read view undoes)", async () => {
    // maintenanceContext walks edges named 'parent_of' whose target is the child. Approval
    // stored child -> parent as LOCATED_IN; the test above shows the reader sees it anyway.
    const before = await admin.query(
      `SELECT source_id::text AS s, target_id::text AS t, relationship_type AS r FROM kg_relationships WHERE id = $1::uuid`,
      [made["CV101 parent_of M1"]],
    );
    expect(before.rows[0]).toEqual({ s: A.M1.nodeId, t: A.CV101.nodeId, r: "LOCATED_IN" });
    expect(mapToCanonicalEdge("parent_of")).toEqual({ type: "LOCATED_IN", flip: true });
  });

  it("row-level security hides these bench links from the other tenant's session; this tenant sees all of them", async () => {
    const ids = Object.values(made);
    expect(ids).toHaveLength(LINKS.length);
    const seenByB = await withTenantContext(TENANT_B, async (c) =>
      Number((await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM kg_relationships WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    );
    const seenByA = await withTenantContext(TENANT_A, async (c) =>
      Number((await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM kg_relationships WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    );
    expect(seenByB).toBe(0);
    expect(seenByA).toBe(LINKS.length);
  });
});

describe("9. findings from the independent review of the repair (#5543 round 1)", () => {
  it("superseding a fact also retires its legacy-named duplicate, so the duplicate cannot keep it current", async () => {
    const { rows } = await admin.query(
      `SELECT k.id::text AS edge, k.relationship_proposal_id::text AS proposal
         FROM kg_relationships k
        WHERE k.tenant_id = $1::uuid AND k.source_id = $2::uuid AND k.target_id = $3::uuid
          AND k.relationship_type = 'UPSTREAM_OF' AND k.approval_state = 'verified'`,
      [TENANT_A, A.VFD1.nodeId, A.M1.nodeId],
    );
    expect(rows).toHaveLength(1);
    const dup = await admin.query(
      `INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, approval_state)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'feeds', 'verified') RETURNING id::text AS id`,
      [TENANT_A, A.VFD1.nodeId, A.M1.nodeId],
    );
    const beforeIds = await downstreamNodeIds(TENANT_A, A.VFD1);
    expect(beforeIds.filter((id) => id === A.M1.nodeId)).toHaveLength(1); // read once while current
    const out = await withTenantContext(TENANT_A, (c) =>
      applyHubProposalTransition(c, { trigger: "supersede", relationshipProposalId: String(rows[0].proposal) }),
    );
    expect(out.kgEdgesDemoted).toBe(2);
    expect(await downstreamNodeIds(TENANT_A, A.VFD1)).not.toContain(A.M1.nodeId);
    expect(await buildGraphContext(TENANT_A, IMPACT_QUESTION, A.VFD1.assetId)).not.toContain(A.M1.assetId);
    const kept = await admin.query(
      `SELECT approval_state FROM kg_relationships WHERE id = ANY($1::uuid[]) ORDER BY approval_state`,
      [[rows[0].edge, dup.rows[0].id]],
    );
    expect(kept.rows.map((r) => r.approval_state)).toEqual(["rejected", "rejected"]); // history kept
  });

  it("an approved fault relationship is not counted as one more fault occurrence in the PM check", async () => {
    const mk = async (type: string, name: string, props: Record<string, unknown> = {}) =>
      String(
        (
          await admin.query(
            `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, approval_state, properties)
             VALUES ($1::uuid, $2, $3, $3, 'verified', $4::jsonb) RETURNING id::text AS id`,
            [TENANT_A, type, name, JSON.stringify(props)],
          )
        ).rows[0].id,
      );
    const fault = await mk("fault_code", "BENCH-F9");
    const pm = await mk("pm_task", "bench pm 30d", { interval_days: 30 });
    const edge = (type: string, target: string, state: string, daysAgo?: number) =>
      admin.query(
        `INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, approval_state, properties)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)`,
        [
          TENANT_A,
          A.VFD2.nodeId,
          target,
          type,
          state,
          JSON.stringify(daysAgo == null ? {} : { occurred_at: new Date(Date.now() - daysAgo * 86400000).toISOString() }),
        ],
      );
    await edge("had_fault", fault, "proposed", 30);
    await edge("had_fault", fault, "proposed", 15);
    await edge("has_pm", pm, "verified");
    const count = async () =>
      (await flagPmMismatches(TENANT_A)).filter((m) => m.faultCode === "BENCH-F9").map((m) => m.occurrences);
    const before = await count();
    await edge("HAS_FAILURE_MODE", fault, "verified"); // the approval
    expect(await count()).toEqual(before); // approval alone changes nothing
    await edge("had_fault", fault, "proposed", 1); // a real third occurrence does
    expect(await count()).not.toEqual(before);
  });
});

describe("10. findings from the second review of the repair (#5543 round 2)", () => {
  it("an approved failure-mode fact is not shown as a recent fault; a real dated occurrence is", async () => {
    const fault = String(
      (
        await admin.query(
          `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, approval_state)
           VALUES ($1::uuid, 'fault_code', 'BENCH-F10', 'BENCH-F10', 'verified') RETURNING id::text AS id`,
          [TENANT_A],
        )
      ).rows[0].id,
    );
    const edge = (type: string, props: Record<string, unknown>) =>
      admin.query(
        `INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, approval_state, properties)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'verified', $5::jsonb)`,
        [TENANT_A, A.VFD2.nodeId, fault, type, JSON.stringify(props)],
      );
    const read = async () => {
      const mc = await maintenanceContext(TENANT_A, A.VFD2.assetId);
      if (!mc) throw new Error("maintenanceContext returned null");
      return { faults: mc.recentFaults.filter((f) => f.code === "BENCH-F10"), text: formatMaintenanceContext(mc) };
    };

    await edge("HAS_FAILURE_MODE", {}); // the approved fact, no occurrence recorded
    const none = await read();
    expect(none.faults).toEqual([]);
    expect(none.text).not.toContain("BENCH-F10");
    expect(none.text).not.toContain("1970-01-01");

    const when = new Date(Date.now() - 2 * 86400000);
    // NOTE: no application writer stores a row literally named 'had_fault' today (writers
    // propose it and approval stores HAS_FAILURE_MODE, one row per pair). This row is the
    // shape the reader was written for; the missing occurrence writer is a recorded gap.
    await edge("had_fault", { occurred_at: when.toISOString() }); // a real occurrence
    const one = await read();
    expect(one.faults).toHaveLength(1);
    expect(one.faults[0].count).toBe(1); // the fact is still not a second occurrence
    expect(one.faults[0].lastSeen.toISOString().slice(0, 10)).toBe(when.toISOString().slice(0, 10));
    expect(one.text).toContain("BENCH-F10");
  });

  it("two supersedes of one fact running at once take turns, and the edge leaves the verified set", async () => {
    A.RACE = await install(TENANT_A, "RACE1", "race fixture load", "FactoryLM bench", "RACE-1");
    const proposal = async () =>
      String(
        (
          await admin.query(
            `INSERT INTO relationship_proposals
               (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type,
                relationship_type, confidence, created_by, reasoning, status)
             VALUES ($1::uuid, $2::uuid, 'equipment', $3::uuid, 'equipment', 'UPSTREAM_OF', 0.8, 'human',
                     'bench contract: concurrent supersede', 'verified')
             RETURNING id::text AS id`,
            [TENANT_A, A.VFD2.nodeId, A.RACE.nodeId],
          )
        ).rows[0].id,
      );
    const [p1, p2] = [await proposal(), await proposal()];
    const edgeId = String(
      (
        await admin.query(
          `INSERT INTO kg_relationships
             (tenant_id, source_id, target_id, relationship_type, approval_state, relationship_proposal_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'UPSTREAM_OF', 'verified', $4::uuid) RETURNING id::text AS id`,
          [TENANT_A, A.VFD2.nodeId, A.RACE.nodeId, p1],
        )
      ).rows[0].id,
    );
    expect(await downstreamNodeIds(TENANT_A, A.VFD2)).toContain(A.RACE.nodeId);

    // Two REAL connections, each in its own transaction, as two concurrent requests would be.
    const [c1, c2] = [await testPool.connect(), await testPool.connect()];
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const first = await applyHubProposalTransition(c1, { trigger: "supersede", relationshipProposalId: p1 });
      expect(first.kgEdgesDemoted).toBe(0); // p2 is still verified: correctly not demoted yet
      let secondDone = false;
      const second = applyHubProposalTransition(c2, { trigger: "supersede", relationshipProposalId: p2 }).then(
        (r) => ((secondDone = true), r),
      );
      await new Promise((r) => setTimeout(r, 400));
      expect(secondDone).toBe(false); // it waits for the first decision instead of reading around it
      await c1.query("COMMIT");
      expect((await second).kgEdgesDemoted).toBe(1); // and then sees the first one's result
      await c2.query("COMMIT");
    } finally {
      await c1.query("ROLLBACK").catch(() => undefined);
      await c2.query("ROLLBACK").catch(() => undefined);
      c1.release();
      c2.release();
    }
    const state = await admin.query(`SELECT approval_state FROM kg_relationships WHERE id = $1::uuid`, [edgeId]);
    expect(state.rows[0].approval_state).toBe("rejected");
    expect(await downstreamNodeIds(TENANT_A, A.VFD2)).not.toContain(A.RACE.nodeId);
  });
  it("an approval and a supersede of one fact running at once take turns, and the newly approved fact stays current", async () => {
    A.RACE2 = await install(TENANT_A, "RACE2", "race fixture load 2", "FactoryLM bench", "RACE-2");
    const proposal = async (status: string) =>
      String(
        (
          await admin.query(
            `INSERT INTO relationship_proposals
               (tenant_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type,
                relationship_type, confidence, created_by, reasoning, status)
             VALUES ($1::uuid, $2::uuid, 'equipment', $3::uuid, 'equipment', 'UPSTREAM_OF', 0.8, 'human',
                     'bench contract: approval racing a supersede', $4)
             RETURNING id::text AS id`,
            [TENANT_A, A.VFD2.nodeId, A.RACE2.nodeId, status],
          )
        ).rows[0].id,
      );
    const [older, newer] = [await proposal("verified"), await proposal("proposed")];
    const edgeId = String(
      (
        await admin.query(
          `INSERT INTO kg_relationships
             (tenant_id, source_id, target_id, relationship_type, approval_state, relationship_proposal_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'UPSTREAM_OF', 'verified', $4::uuid) RETURNING id::text AS id`,
          [TENANT_A, A.VFD2.nodeId, A.RACE2.nodeId, older],
        )
      ).rows[0].id,
    );

    const [c1, c2] = [await testPool.connect(), await testPool.connect()];
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      await applyHubProposalTransition(c1, { trigger: "accept", relationshipProposalId: newer }); // not committed yet
      let secondDone = false;
      const second = applyHubProposalTransition(c2, { trigger: "supersede", relationshipProposalId: older }).then(
        (r) => ((secondDone = true), r),
      );
      await new Promise((r) => setTimeout(r, 400));
      expect(secondDone).toBe(false); // without the lock it would read "no other approval" and retire the edge
      await c1.query("COMMIT");
      expect((await second).kgEdgesDemoted).toBe(0); // the fresh approval outranks the older supersede
      await c2.query("COMMIT");
    } finally {
      await c1.query("ROLLBACK").catch(() => undefined);
      await c2.query("ROLLBACK").catch(() => undefined);
      c1.release();
      c2.release();
    }
    const state = await admin.query(`SELECT approval_state FROM kg_relationships WHERE id = $1::uuid`, [edgeId]);
    expect(state.rows[0].approval_state).toBe("verified");
    expect(await downstreamNodeIds(TENANT_A, A.VFD2)).toContain(A.RACE2.nodeId);
  });
});
