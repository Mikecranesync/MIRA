/**
 * Zero-token retrieval check for the frozen 2026-10-25 forum benchmark
 * (docs/evals/forum-batch2-2026-10-25/cases.json, from PR #4790's briefs).
 *
 * For each case it makes the SAME retrieveNodeChunks call the notebook chat
 * route makes (route.ts:2261): validateChatSources for nodeId + docIds, the
 * notebook's manufacturer/model/identity_status, topK 6, doc-scoped, the raw
 * message as rawQuery. It never calls the model and never writes: every query
 * it reaches is a SELECT (getNotebook is avoided because it touches
 * last_opened_at). It answers "did the right page reach the evidence?", the
 * retrieval half of the gate. Answer correctness still needs the chat route.
 *
 * Run (staging Neon, debug pool logged):
 *   NOTEBOOK_RETRIEVAL_DEBUG=1 doppler run -p factorylm -c stg -- \
 *     bun run mira-hub/scripts/eval-forum-retrieval.ts [out.json]
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { withTenantContext } from "@/lib/tenant-context";
import { validateChatSources } from "@/lib/equipment-notebooks";

type Case = {
  id: string; kind: string; question: string; notebookId: string; docId: string;
  expectedPages: number[] | null; expectedFact: string; baseline: string;
};

const url = process.env.NEON_DATABASE_URL;
if (!url) {
  console.error("NEON_DATABASE_URL not set — run via doppler run -p factorylm -c stg -- ...");
  process.exit(1);
}
const casesPath = fileURLToPath(new URL("../../docs/evals/forum-batch2-2026-10-25/cases.json", import.meta.url));
const { cases } = JSON.parse(readFileSync(casesPath, "utf8")) as { cases: Case[] };

async function main() {
  const owner = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await owner.connect();
  const results: unknown[] = [];
  try {
    for (const c of cases) {
      const nb = await owner.query(
        `SELECT tenant_id::text AS tenant_id, manufacturer, model, identity_status
           FROM equipment_notebooks WHERE id = $1::uuid`,
        [c.notebookId],
      );
      if (nb.rows.length === 0) {
        results.push({ id: c.id, error: "notebook_not_found" });
        continue;
      }
      const n = nb.rows[0] as { tenant_id: string; manufacturer: string | null; model: string | null; identity_status: string | null };
      const validated = await validateChatSources(n.tenant_id, c.notebookId, [c.docId]);
      if (!validated.ok) {
        results.push({ id: c.id, error: `sources_${validated.error}` });
        continue;
      }
      const diagnostics: Record<string, unknown> = {};
      const started = Date.now();
      const chunks = await withTenantContext(n.tenant_id, (client) =>
        retrieveNodeChunks(client, n.tenant_id, c.question, {
          nodeId: validated.nodeId,
          unsPath: null,
          topK: 6,
          docIds: validated.docIds,
          rawQuery: c.question,
          identity: { manufacturer: n.manufacturer, model: n.model },
          identityStatus: n.identity_status as never,
          includeQueryRecall: false,
          validatedDocScope: true,
          approvedSourceDocIds: validated.docIds,
          diagnostics: diagnostics as never,
        }),
      );
      const pages = chunks.map((ch) => ch.sourcePage ?? null);
      const hit = c.expectedPages ? pages.some((p) => p !== null && c.expectedPages!.includes(p)) : null;
      const row = {
        id: c.id, kind: c.kind, baseline: c.baseline, expectedPages: c.expectedPages,
        pages, hit, ms: Date.now() - started,
        identity: { manufacturer: n.manufacturer, model: n.model, status: n.identity_status },
        diagnostics,
      };
      results.push(row);
      console.log(`${c.id} ${c.kind.padEnd(6)} hit=${String(hit).padEnd(5)} pages=${JSON.stringify(pages)} expected=${JSON.stringify(c.expectedPages)}`);
    }
  } finally {
    await owner.end();
  }
  const out = process.argv[2];
  if (out) writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 1));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
