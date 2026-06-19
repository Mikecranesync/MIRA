import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { readZipEntries } from "@/lib/contextualization/unzip";
import { parseBundle } from "@/lib/contextualization/bundle-import";

export const dynamic = "force-dynamic";

const SRC_STATUS = new Set(["pending", "processing", "done", "error"]);

/**
 * POST /api/contextualization/import
 *
 * Closes the floor→cloud loop: ingest a Factory Context Bundle (bundle@1) produced offline by the
 * desktop FactoryLM Contextualizer, recreating a project + ctx_sources + ctx_extractions (preserving
 * the offline accept/reject status). The existing /promote flow then lands accepted signals in the
 * knowledge graph for admin review.
 *
 * Multipart: file=<bundle>.zip. Document/knowledge_entries seeding is intentionally out of scope here
 * (that hybrid table has tenant-scoping footguns — see .claude/rules/knowledge-entries-tenant-scoping);
 * a follow-up wires it behind is_private=true once validated on staging.
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }

  let parsed;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const entries = readZipEntries(buf);
    const files: Record<string, string> = {};
    for (const [name, data] of Object.entries(entries)) {
      files[name] = data.toString("utf-8");
    }
    parsed = parseBundle(files);
  } catch (err) {
    return NextResponse.json(
      { error: `invalid bundle: ${err instanceof Error ? err.message : "parse failed"}` },
      { status: 400 },
    );
  }

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const proj = await c
        .query<{ id: string }>(
          `INSERT INTO contextualization_projects (tenant_id, name, description)
             VALUES ($1::uuid, $2, $3) RETURNING id`,
          [ctx.tenantId, `${parsed.projectName} (imported)`, parsed.description],
        )
        .then((r) => r.rows[0]);
      const projectId = proj.id;

      // sources → id map
      const fileToSource = new Map<string, string>();
      for (const s of parsed.sources) {
        const status = SRC_STATUS.has(s.status) ? s.status : "done";
        const row = await c
          .query<{ id: string }>(
            `INSERT INTO ctx_sources (tenant_id, project_id, source_type, file_name, status)
               VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id`,
            [ctx.tenantId, projectId, s.sourceType, s.fileName, status],
          )
          .then((r) => r.rows[0]);
        fileToSource.set(s.fileName, row.id);
      }
      // a default source so extractions with no/unknown source still attach
      let defaultSource = fileToSource.values().next().value as string | undefined;
      if (!defaultSource) {
        defaultSource = await c
          .query<{ id: string }>(
            `INSERT INTO ctx_sources (tenant_id, project_id, source_type, file_name, status)
               VALUES ($1::uuid, $2, 'other', 'imported', 'done') RETURNING id`,
            [ctx.tenantId, projectId],
          )
          .then((r) => r.rows[0].id);
      }

      let inserted = 0;
      for (const e of parsed.extractions) {
        const sid = (e.sourceFile && fileToSource.get(e.sourceFile)) || defaultSource;
        await c.query(
          `INSERT INTO ctx_extractions
             (tenant_id, project_id, source_id, tag_name, roles, uns_path_proposed,
              i3x_element_id, evidence_json, confidence, status)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
          [
            ctx.tenantId, projectId, sid, e.tagName, e.roles, e.unsPathProposed,
            e.i3xElementId, JSON.stringify(e.evidenceJson), e.confidence, e.status,
          ],
        );
        inserted++;
      }

      return { projectId, sources: parsed.sources.length, extractions: inserted };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    console.error("[api/contextualization/import POST]", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
