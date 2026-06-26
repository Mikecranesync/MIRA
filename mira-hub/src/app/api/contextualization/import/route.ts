import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import { readZipEntries } from "@/lib/contextualization/unzip";
import { parseBundle } from "@/lib/contextualization/bundle-import";
import {
  validateIntakeContract,
  intakeContractToImport,
  type ContractImport,
} from "@/lib/contextualization/intake-contract";

export const dynamic = "force-dynamic";

const SRC_STATUS = new Set(["pending", "processing", "done", "error"]);

/**
 * POST /api/contextualization/import
 *
 * Two intake shapes, chosen by content-type (HubV3 — Hub is system of record):
 *  - application/json  → the shared Intake Contract (ADR-0023, PRD §2). Dedups
 *    project/batch by bundle_sha256 and sources by source_sha256; everything
 *    lands proposed (batch review_status='proposed', extractions 'pending').
 *  - multipart/form-data (file=<bundle>.zip) → the offline Factory Context
 *    Bundle (bundle@1), recreated into a project + ctx_sources + ctx_extractions
 *    (legacy path; P5 migrates the offline client onto the contract).
 *
 * Document/knowledge_entries seeding stays out of scope here (that hybrid table
 * has tenant-scoping footguns — see .claude/rules/knowledge-entries-tenant-scoping).
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return importFromContract(ctx.tenantId, req);
  }
  return importFromBundle(ctx.tenantId, req);
}

// ── Intake Contract path (HubV3 §2) ─────────────────────────────────────────

async function importFromContract(tenantId: string, req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON intake contract body" }, { status: 400 });
  }

  const { ok, errors, value } = validateIntakeContract(raw);
  if (!ok || !value) {
    return NextResponse.json({ error: "invalid intake contract", details: errors }, { status: 400 });
  }
  const imp = intakeContractToImport(value);

  try {
    const result = await withTenantContext(tenantId, async (c) => {
      const projectId = await upsertProject(c, tenantId, imp);
      const { batchId, isNew } = await upsertBatch(c, tenantId, projectId, imp);

      // Re-import of an already-staged bundle is an idempotent no-op: the source
      // ON CONFLICT below would dedup anyway, but skipping avoids re-inserting
      // extractions (which have no natural unique key).
      if (!isNew) {
        return {
          projectId,
          importBatchId: batchId,
          sources: imp.sources.length,
          extractions: imp.extractions.length,
          deduped: true,
        };
      }

      // Insert sources (sha256 dedup), mapping each sha → its source row id so
      // extractions attach to the right source even when a source was deduped.
      const shaToSource = new Map<string, string>();
      for (const s of imp.sources) {
        const status = SRC_STATUS.has(s.status) ? s.status : "done";
        const ins = await c.query<{ id: string }>(
          `INSERT INTO ctx_sources
             (tenant_id, project_id, import_batch_id, source_type, file_name, source_sha256, status)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, source_sha256) WHERE source_sha256 IS NOT NULL DO NOTHING
           RETURNING id`,
          [tenantId, projectId, batchId, s.sourceType, s.fileName, s.sourceSha256, status],
        );
        let sid = ins.rows[0]?.id;
        if (!sid) {
          const sel = await c.query<{ id: string }>(
            `SELECT id FROM ctx_sources WHERE tenant_id = $1::uuid AND source_sha256 = $2`,
            [tenantId, s.sourceSha256],
          );
          sid = sel.rows[0].id;
        }
        shaToSource.set(s.sourceSha256, sid);
      }
      const defaultSource = shaToSource.values().next().value as string;

      let extractions = 0;
      for (const e of imp.extractions) {
        const sid = (e.sourceSha256 && shaToSource.get(e.sourceSha256)) || defaultSource;
        await c.query(
          `INSERT INTO ctx_extractions
             (tenant_id, project_id, source_id, tag_name, roles, uns_path_proposed,
              i3x_element_id, evidence_json, confidence, status)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
          [
            tenantId, projectId, sid, e.tagName, e.roles, e.unsPathProposed,
            e.i3xElementId, JSON.stringify(e.evidenceJson), e.confidence, e.status,
          ],
        );
        extractions++;
      }

      await c.query(
        `UPDATE ctx_import_batches SET source_count = $2, extraction_count = $3 WHERE id = $1`,
        [batchId, imp.sources.length, extractions],
      );

      return { projectId, importBatchId: batchId, sources: imp.sources.length, extractions, deduped: false };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    console.error("[api/contextualization/import POST contract]", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

/** Upsert a project by (tenant_id, bundle_sha256); returns its id. */
async function upsertProject(c: PoolClient, tenantId: string, imp: ContractImport): Promise<string> {
  const name = `${imp.projectName} (imported)`;
  if (imp.bundleSha256) {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO contextualization_projects (tenant_id, name, description, bundle_sha256)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (tenant_id, bundle_sha256) WHERE bundle_sha256 IS NOT NULL DO NOTHING
         RETURNING id`,
      [tenantId, name, imp.description, imp.bundleSha256],
    );
    if (ins.rows[0]) return ins.rows[0].id;
    const sel = await c.query<{ id: string }>(
      `SELECT id FROM contextualization_projects WHERE tenant_id = $1::uuid AND bundle_sha256 = $2`,
      [tenantId, imp.bundleSha256],
    );
    return sel.rows[0].id;
  }
  const ins = await c.query<{ id: string }>(
    `INSERT INTO contextualization_projects (tenant_id, name, description)
       VALUES ($1::uuid, $2, $3) RETURNING id`,
    [tenantId, name, imp.description],
  );
  return ins.rows[0].id;
}

/** Upsert an import batch by (tenant_id, bundle_sha256); isNew=false means the bundle was already imported. */
async function upsertBatch(
  c: PoolClient,
  tenantId: string,
  projectId: string,
  imp: ContractImport,
): Promise<{ batchId: string; isNew: boolean }> {
  if (imp.bundleSha256) {
    const ins = await c.query<{ id: string }>(
      `INSERT INTO ctx_import_batches (tenant_id, project_id, ingest_route, bundle_sha256)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (tenant_id, bundle_sha256) WHERE bundle_sha256 IS NOT NULL DO NOTHING
         RETURNING id`,
      [tenantId, projectId, imp.ingestRoute, imp.bundleSha256],
    );
    if (ins.rows[0]) return { batchId: ins.rows[0].id, isNew: true };
    const sel = await c.query<{ id: string }>(
      `SELECT id FROM ctx_import_batches WHERE tenant_id = $1::uuid AND bundle_sha256 = $2`,
      [tenantId, imp.bundleSha256],
    );
    return { batchId: sel.rows[0].id, isNew: false };
  }
  const ins = await c.query<{ id: string }>(
    `INSERT INTO ctx_import_batches (tenant_id, project_id, ingest_route)
       VALUES ($1::uuid, $2, $3) RETURNING id`,
    [tenantId, projectId, imp.ingestRoute],
  );
  return { batchId: ins.rows[0].id, isNew: true };
}

// ── Offline bundle path (legacy, multipart) ─────────────────────────────────

async function importFromBundle(tenantId: string, req: Request) {
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
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Request Entity Too Large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
  }

  // Optional: import into an existing project instead of creating a new one
  // (the import target-picker). Empty/absent → create a new project.
  const rawTarget = form.get("project_id");
  const targetProjectId = typeof rawTarget === "string" && rawTarget.trim() ? rawTarget.trim() : null;
  if (targetProjectId && !/^[0-9a-f-]{36}$/i.test(targetProjectId)) {
    return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
  }

  let parsed;
  let bundleSha256 = "";
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    bundleSha256 = createHash("sha256").update(buf).digest("hex");
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
    const result = await withTenantContext(tenantId, async (c) => {
      // Target an existing project (RLS scopes the lookup to this tenant) or create one.
      let projectId: string;
      if (targetProjectId) {
        const existing = await c
          .query<{ id: string }>(
            `SELECT id FROM contextualization_projects WHERE id = $1::uuid`,
            [targetProjectId],
          )
          .then((r) => r.rows[0]);
        if (!existing) {
          throw Object.assign(new Error("target project not found"), { httpStatus: 404 });
        }
        projectId = existing.id;
      } else {
        projectId = await upsertBundleProject(c, tenantId, parsed.projectName, parsed.description, bundleSha256);
      }

      // sources → id map
      const { batchId, isNew } = await upsertBundleBatch(c, tenantId, projectId, bundleSha256);

      // Re-importing the same legacy bundle should stay idempotent, matching
      // the JSON intake path. Existing staged rows remain in human review.
      if (!isNew) {
        return {
          projectId,
          importBatchId: batchId,
          sources: parsed.sources.length,
          extractions: parsed.extractions.length,
          deduped: true,
        };
      }

      const fileToSource = new Map<string, string>();
      for (const s of parsed.sources) {
        const status = SRC_STATUS.has(s.status) ? s.status : "done";
        const row = await c
          .query<{ id: string }>(
            `INSERT INTO ctx_sources (tenant_id, project_id, import_batch_id, source_type, file_name, status)
               VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id`,
            [tenantId, projectId, batchId, s.sourceType, s.fileName, status],
          )
          .then((r) => r.rows[0]);
        fileToSource.set(s.fileName, row.id);
      }
      // a default source so extractions with no/unknown source still attach
      let defaultSource = fileToSource.values().next().value as string | undefined;
      if (!defaultSource) {
        defaultSource = await c
          .query<{ id: string }>(
            `INSERT INTO ctx_sources (tenant_id, project_id, import_batch_id, source_type, file_name, status)
               VALUES ($1::uuid, $2, $3, 'other', 'imported', 'done') RETURNING id`,
            [tenantId, projectId, batchId],
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
            tenantId, projectId, sid, e.tagName, e.roles, e.unsPathProposed,
            e.i3xElementId, JSON.stringify(e.evidenceJson), e.confidence, e.status,
          ],
        );
        inserted++;
      }

      await c.query(
        `UPDATE ctx_import_batches SET source_count = $2, extraction_count = $3 WHERE id = $1`,
        [batchId, parsed.sources.length, inserted],
      );

      return {
        projectId,
        importBatchId: batchId,
        sources: parsed.sources.length,
        extractions: inserted,
        deduped: false,
      };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const status = (err as { httpStatus?: number }).httpStatus;
    if (status === 404) {
      return NextResponse.json({ error: "target project not found" }, { status: 404 });
    }
    console.error("[api/contextualization/import POST]", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

async function upsertBundleProject(
  c: PoolClient,
  tenantId: string,
  projectName: string,
  description: string | null,
  bundleSha256: string,
): Promise<string> {
  const ins = await c.query<{ id: string }>(
    `INSERT INTO contextualization_projects (tenant_id, name, description, bundle_sha256)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (tenant_id, bundle_sha256) WHERE bundle_sha256 IS NOT NULL DO NOTHING
       RETURNING id`,
    [tenantId, `${projectName} (imported)`, description, bundleSha256],
  );
  if (ins.rows[0]) return ins.rows[0].id;
  const sel = await c.query<{ id: string }>(
    `SELECT id FROM contextualization_projects WHERE tenant_id = $1::uuid AND bundle_sha256 = $2`,
    [tenantId, bundleSha256],
  );
  return sel.rows[0].id;
}

async function upsertBundleBatch(
  c: PoolClient,
  tenantId: string,
  projectId: string,
  bundleSha256: string,
): Promise<{ batchId: string; isNew: boolean }> {
  const ins = await c.query<{ id: string }>(
    `INSERT INTO ctx_import_batches (tenant_id, project_id, ingest_route, bundle_sha256)
       VALUES ($1::uuid, $2, 'offline', $3)
       ON CONFLICT (tenant_id, bundle_sha256) WHERE bundle_sha256 IS NOT NULL DO NOTHING
       RETURNING id`,
    [tenantId, projectId, bundleSha256],
  );
  if (ins.rows[0]) return { batchId: ins.rows[0].id, isNew: true };
  const sel = await c.query<{ id: string }>(
    `SELECT id FROM ctx_import_batches WHERE tenant_id = $1::uuid AND bundle_sha256 = $2`,
    [tenantId, bundleSha256],
  );
  return { batchId: sel.rows[0].id, isNew: false };
}
