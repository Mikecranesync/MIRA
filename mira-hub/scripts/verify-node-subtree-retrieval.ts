/**
 * Live verification for folder=brain Slice 3 — subtree-grounded node retrieval.
 *
 * Proves the discriminating behaviour on the DEV Neon branch, under the SAME
 * `factorylm_app` RLS role the route uses (withTenantContext), against the real
 * schema:
 *   1. retrieveNodeChunks returns rows AT ALL under factorylm_app (the RLS/role
 *      silent-failure risk — chunk→node address read via knowledge_entries
 *      metadata, never the un-RLS'd hub_uploads).
 *   2. Ask at CV-101 (parent) cites BOTH the GS10 + M101 docs (subtree gather).
 *   3. Ask at GS10 cites ONLY the GS10 doc (scoping).
 *   4. Reparent GS10 → new parent: asking at the new parent now includes it
 *      (link survives because node_id is stable; uns_path recompute is what we
 *      simulate here — the route relies on the recompute worker in prod).
 *   5. No tenant-wide fallback: a query with no subtree match returns [].
 *
 * Fixtures are inserted as owner (bypass RLS for setup) under a unique uns_path
 * root + marker, then READ under factorylm_app. Everything is cleaned up in a
 * finally block, matched by the unique marker.
 *
 * Run: doppler run -p factorylm -c dev -- npx tsx mira-hub/scripts/verify-node-subtree-retrieval.ts
 */
import { Client } from "pg";
import { randomUUID } from "crypto";

const MARK = `nodebrain_verify_${Date.now()}`;
const ROOT = `verify_${Date.now()}`; // unique ltree segment root (lowercase, no dashes)

const url = process.env.NEON_DATABASE_URL;
if (!url) {
  console.error("NEON_DATABASE_URL not set (run via doppler -c dev)");
  process.exit(1);
}

// Mirror lib/manual-rag.ts::retrieveNodeChunks exactly, run on a client that is
// already inside a factorylm_app tenant transaction.
async function retrieveNodeChunks(
  client: Client,
  tenantId: string,
  query: string,
  opts: { nodeId: string; unsPath: string | null; topK?: number },
): Promise<{ title: string; page: number | null }[]> {
  const q = query.trim();
  if (!q) return [];
  const topK = opts.topK ?? 6;

  let nodeIds: string[];
  if (opts.unsPath) {
    const { rows } = await client.query(
      `SELECT id::text AS id FROM kg_entities WHERE tenant_id = $1 AND uns_path <@ $2::ltree`,
      [tenantId, opts.unsPath],
    );
    nodeIds = rows.map((r) => String(r.id));
    if (!nodeIds.includes(opts.nodeId)) nodeIds.push(opts.nodeId);
  } else {
    nodeIds = [opts.nodeId];
  }
  if (nodeIds.length === 0) return [];

  const { rows } = await client.query(
    `SELECT metadata->>'filename' AS filename, page_start, source_page,
            ts_rank_cd(content_tsv, plainto_tsquery('english', $2)) AS rank
       FROM knowledge_entries
      WHERE tenant_id = $1 AND ingest_route = 'v2'
        AND (metadata->>'node_id') = ANY($3::text[])
        AND content_tsv @@ plainto_tsquery('english', $2)
      ORDER BY rank DESC LIMIT $4`,
    [tenantId, q, nodeIds, topK],
  );
  return rows.map((r) => ({
    title: String(r.filename ?? "doc"),
    page: r.page_start != null ? Number(r.page_start) : r.source_page == null ? null : Number(r.source_page),
  }));
}

// Run fn inside the route's tenant context (factorylm_app + app.tenant_id).
async function inTenantCtx<T>(client: Client, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE factorylm_app");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
  try {
    const r = await fn();
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

function titles(rows: { title: string }[]): Set<string> {
  return new Set(rows.map((r) => r.title));
}

async function main() {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Use an existing tenant (knowledge_entries.tenant_id is UUID FK → tenants).
  const t = await client.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
  if (t.rows.length === 0) throw new Error("no tenants on dev branch");
  const tenantId = t.rows[0].id as string;
  console.log(`tenant: ${tenantId}`);

  const cvId = randomUUID();
  const gs10Id = randomUUID();
  const m101Id = randomUUID();
  const newParentId = randomUUID();
  let pass = true;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) pass = false;
  };

  try {
    // ── Fixtures (as owner) ──────────────────────────────────────────────
    // Subtree: ROOT.cv101 ← ROOT.cv101.gs10, ROOT.cv101.m101 ; plus a sibling ROOT.other
    const ent = async (id: string, name: string, path: string) =>
      client.query(
        `INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, uns_path, properties)
         VALUES ($1,$2,'asset',$3,$4,$5::ltree,$6)`,
        [id, tenantId, `${MARK}_${name}`, name, path, JSON.stringify({ mark: MARK })],
      );
    await ent(cvId, "CV-101", `${ROOT}.cv101`);
    await ent(gs10Id, "GS10", `${ROOT}.cv101.gs10`);
    await ent(m101Id, "M101", `${ROOT}.cv101.m101`);
    await ent(newParentId, "OTHER", `${ROOT}.other`);

    const chunk = async (nodeId: string, filename: string, content: string) =>
      client.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, source_type, content, source_url, source_page, doc_id, ingest_route, page_start, page_end, metadata)
         VALUES ($1,$2,'node_attachment',$3,$4,$5,$6,'v2',$5,$5,$7)`,
        [
          randomUUID(), tenantId, content,
          `node-doc/${MARK}/${filename}`, 7, randomUUID(),
          JSON.stringify({ filename, node_id: nodeId, chunk_index: 0, mark: MARK }),
        ],
      );
    // GS10 doc: VFD undervoltage fault content. M101 doc: motor bearing content.
    await chunk(gs10Id, "GS10_manual.pdf", "GS10 drive fault F0004 indicates a DC bus undervoltage condition on the VFD.");
    await chunk(m101Id, "M101_datasheet.pdf", "The M101 motor bearing requires regreasing; undervoltage at the drive can also stall it.");

    // ── 1+2: Ask at CV-101 → both docs, under factorylm_app ──────────────
    const atCv = await inTenantCtx(client, tenantId, () =>
      retrieveNodeChunks(client, tenantId, "undervoltage", { nodeId: cvId, unsPath: `${ROOT}.cv101` }),
    );
    check("retrieveNodeChunks returns rows under factorylm_app (RLS visible)", atCv.length > 0, `${atCv.length} chunks`);
    const cvT = titles(atCv);
    check("Ask at CV-101 cites BOTH GS10 + M101 docs", cvT.has("GS10_manual.pdf") && cvT.has("M101_datasheet.pdf"), [...cvT].join(", "));

    // ── 3: Ask at GS10 → only GS10 doc ──────────────────────────────────
    const atGs10 = await inTenantCtx(client, tenantId, () =>
      retrieveNodeChunks(client, tenantId, "undervoltage", { nodeId: gs10Id, unsPath: `${ROOT}.cv101.gs10` }),
    );
    const gsT = titles(atGs10);
    check("Ask at GS10 cites ONLY the GS10 doc", gsT.has("GS10_manual.pdf") && !gsT.has("M101_datasheet.pdf"), [...gsT].join(", "));

    // ── 4: Reparent GS10 → ROOT.other; ask at OTHER includes GS10 ────────
    await client.query(`UPDATE kg_entities SET uns_path = $2::ltree WHERE id = $1`, [gs10Id, `${ROOT}.other.gs10`]);
    const atOther = await inTenantCtx(client, tenantId, () =>
      retrieveNodeChunks(client, tenantId, "undervoltage", { nodeId: newParentId, unsPath: `${ROOT}.other` }),
    );
    const otherT = titles(atOther);
    check("After reparent, asking at new parent includes GS10 (node_id stable)", otherT.has("GS10_manual.pdf"), [...otherT].join(", "));
    // And CV-101 no longer sees GS10 (it moved out of the subtree)
    const atCv2 = await inTenantCtx(client, tenantId, () =>
      retrieveNodeChunks(client, tenantId, "undervoltage", { nodeId: cvId, unsPath: `${ROOT}.cv101` }),
    );
    check("After reparent, CV-101 no longer cites GS10", !titles(atCv2).has("GS10_manual.pdf"), [...titles(atCv2)].join(", "));

    // ── 5: No tenant-wide fallback — empty subtree → [] ─────────────────
    const empty = await inTenantCtx(client, tenantId, () =>
      retrieveNodeChunks(client, tenantId, "undervoltage", { nodeId: randomUUID(), unsPath: `${ROOT}.nonexistent` }),
    );
    check("No tenant-wide fallback (empty subtree → 0 chunks)", empty.length === 0, `${empty.length} chunks`);
  } finally {
    // ── Cleanup (as owner) ──────────────────────────────────────────────
    await client.query(`DELETE FROM knowledge_entries WHERE metadata->>'mark' = $1`, [MARK]);
    await client.query(`DELETE FROM kg_entities WHERE properties->>'mark' = $1`, [MARK]);
    console.log(`cleaned up ${MARK}`);
    await client.end();
  }

  console.log(pass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
