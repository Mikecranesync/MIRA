/**
 * Code-level beta-gate proof — the real upload → retrieval → citation chain.
 *
 * The HTTP beta gate (`tests/beta/beta_ready_upload_retrieval_citation.py`) is
 * xfail-by-env: it needs a live Hub + a minted session cookie, so nobody has run
 * the chain end-to-end to learn whether the upload→retrieval gap is actually
 * CLOSED or where it breaks. This script answers that at the CODE level, with no
 * Hub server and no auth plumbing: it drives the SAME functions the real routes
 * call, against the DEV Neon branch, under the SAME `factorylm_app` RLS role.
 *
 *   1. Create a namespace node (`kg_entities`, as owner — bypass RLS for setup).
 *   2. REAL upload ingest of the fixture manual via `ingestPdfToNode`
 *      (createUpload → writePdfChunksForNode: unpdf parse → chunk →
 *      INSERT knowledge_entries, ingest_route='v2', node_id, is_private=true,
 *      content_tsv GENERATED ALWAYS so it's searchable immediately).
 *   3. REAL retrieval via `retrieveNodeChunks` inside `withTenantContext`
 *      (exactly what `/api/namespace/node/[id]/chat` does) for the beta question.
 *   4. Assert: chunks returned, content contains the manual-only answer term
 *      ("overcurrent"), and every chunk is citable (has a title) — the two
 *      conditions the HTTP gate checks (has_content + has_citation).
 *
 * Everything is cleaned up in a finally block, matched by the unique node id.
 *
 * Run: doppler run -p factorylm -c dev -- bun run mira-hub/scripts/verify-upload-retrieval-citation.ts
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { Client } from "pg";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { withTenantContext } from "@/lib/tenant-context";

const url = process.env.NEON_DATABASE_URL;
if (!url) {
  console.error("NEON_DATABASE_URL not set — run via `doppler run -p factorylm -c dev -- ...`");
  process.exit(1);
}

// Same known-good Q/A the HTTP gate uses (tests/beta/_gate.py).
const QUESTION = "What does GS10 fault code oC mean?";
const EXPECTED = "overcurrent"; // content only the uploaded manual supplies
const FIXTURE = fileURLToPath(new URL("../../tests/beta/fixtures/gs10_fault_codes.pdf", import.meta.url));
const STAMP = Date.now();
const ROOT = `betaverify_${STAMP}`; // unique lowercase ltree root

async function main() {
  const owner = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await owner.connect();

  // knowledge_entries.tenant_id FKs to tenants(id) — use a real dev tenant.
  const t = await owner.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
  if (t.rows.length === 0) throw new Error("no tenants on the dev branch");
  const tenantId = t.rows[0].id as string;

  const nodeId = randomUUID();
  const unsPath = `${ROOT}.gs10`;
  let pass = true;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) pass = false;
  };
  console.log(`tenant=${tenantId}\nnode=${nodeId}\nuns=${unsPath}\n`);

  try {
    // 1. Namespace node (owner insert; retrieval resolves the subtree via uns_path).
    await owner.query(
      `INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, uns_path, properties)
       VALUES ($1,$2,'asset',$3,$4,$5::ltree,$6)`,
      [nodeId, tenantId, `betaverify_${STAMP}_gs10`, "GS10", unsPath, JSON.stringify({ mark: ROOT })],
    );

    // 2. REAL upload ingest of the fixture manual.
    const buffer = readFileSync(FIXTURE);
    const res = await ingestPdfToNode({
      tenantId,
      nodeId,
      unsPath,
      filename: "gs10_fault_codes.pdf",
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      buffer,
    });
    check("ingest wrote chunks", res.chunkCount > 0, `chunkCount=${res.chunkCount} uploadId=${res.uploadId}`);

    const wrote = await owner.query(
      `SELECT count(*)::int AS n FROM knowledge_entries
        WHERE tenant_id = $1 AND (metadata->>'node_id') = $2 AND ingest_route = 'v2'`,
      [tenantId, nodeId],
    );
    check("knowledge_entries rows landed (ingest_route=v2, node-scoped)", wrote.rows[0].n > 0, `${wrote.rows[0].n} rows`);

    // 3. REAL retrieval — exactly what the chat route does.
    const chunks = await withTenantContext(tenantId, (c) =>
      retrieveNodeChunks(c, tenantId, QUESTION, { nodeId, unsPath }),
    );
    check("retrieveNodeChunks returned rows under factorylm_app RLS", chunks.length > 0, `${chunks.length} chunks`);

    const joined = chunks.map((c) => c.content).join(" ").toLowerCase();
    check(`retrieved content answers the question (contains "${EXPECTED}")`, joined.includes(EXPECTED),
      `titles: ${chunks.map((c) => c.title).join(", ")}`);

    check("every retrieved chunk is citable (has a title)", chunks.length > 0 && chunks.every((c) => !!c.title),
      chunks.map((c) => `${c.title}#${c.sourcePage ?? "?"}`).join(", "));
  } finally {
    // Cleanup — matched by the unique node id (+ uns root for the entity).
    try { await owner.query(`DELETE FROM knowledge_entries WHERE (metadata->>'node_id') = $1`, [nodeId]); } catch (e) { console.error("cleanup ke:", e); }
    try { await owner.query(`DELETE FROM hub_uploads WHERE kg_entity_id = $1`, [nodeId]); } catch (e) { console.error("cleanup uploads:", e); }
    try { await owner.query(`DELETE FROM kg_entities WHERE id = $1`, [nodeId]); } catch (e) { console.error("cleanup node:", e); }
    console.log(`\ncleaned up node ${nodeId}`);
    await owner.end();
  }

  console.log(pass ? "\n✅ BETA-GATE CHAIN PROVEN AT CODE LEVEL (upload → retrieval → citable)" : "\n❌ CHAIN BROKEN — see failed checks above");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
