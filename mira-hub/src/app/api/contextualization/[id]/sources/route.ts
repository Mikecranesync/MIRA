import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import {
  parsePlcViaIngest,
  reportToExtractions,
  type ExtractionRow,
} from "@/lib/contextualization/parse-source";

export const dynamic = "force-dynamic";

// Maps a file extension to a ctx_sources.source_type enum value
// (CHECK: 'l5x' | 'st' | 'plcopen' | 'csv' | 'manual' | 'other'). mira-ingest
// detects the real format from the bytes, so the stored type is advisory — but
// keep it accurate for the review UI's "Source" column.
export function sourceTypeFor(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".l5x":
      return "l5x";
    case ".st":
      return "st";
    case ".xml":
      return "plcopen";
    case ".csv":
      return "csv";
    case ".pdf":
    case ".txt":
    case ".md":
      return "manual";
    default:
      return "other";
  }
}

// Where uploaded source files land on disk. Kept for audit / re-parse and to
// populate ctx_sources.file_path; parsing itself uses the in-memory bytes (the
// file is POSTed to mira-ingest, not read back from here).
function sourcesDir(): string {
  const fromEnv = process.env.CTX_SOURCES_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(tmpdir(), "mira-ctx-sources");
}

// Postgres caps bound parameters at 65535; each extraction row binds 10. Chunk
// well under that so a large tag dictionary still inserts.
const INSERT_CHUNK = 500;

/** Bulk-insert extraction rows under an already-tenant-scoped client. */
async function insertExtractions(
  c: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  rows: ExtractionRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const values = chunk
      .map((_, j) => {
        const b = j * 10;
        return (
          `($${b + 1}::uuid,$${b + 2}::uuid,$${b + 3}::uuid,$${b + 4}::uuid,` +
          `$${b + 5},$${b + 6}::text[],$${b + 7},$${b + 8},$${b + 9}::jsonb,$${b + 10})`
        );
      })
      .join(",");
    const params = chunk.flatMap((r) => [
      r.id,
      r.tenantId,
      r.projectId,
      r.sourceId,
      r.tagName,
      r.roles,
      r.unsPath,
      r.i3xElementId,
      JSON.stringify(r.evidence),
      r.confidence,
    ]);
    await c.query(
      `INSERT INTO ctx_extractions
         (id, tenant_id, project_id, source_id, tag_name, roles,
          uns_path_proposed, i3x_element_id, evidence_json, confidence)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

/**
 * POST /api/contextualization/[id]/sources
 *
 * Multipart upload of a single PLC export / manual into a contextualization
 * project. Inserts a pending ctx_sources row, parses the file via mira-ingest
 * `/ingest/plc-parse`, writes the resulting ctx_extractions, and flips the source
 * to `done` (or `error` with a message on any parse failure — a non-PLC upload
 * lands `error`, never stuck `pending`). Returns the source row with its final
 * status; parsing is inline (sub-second, stdlib parser), so the response is
 * terminal — no async worker to poll.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id: projectId } = await params;
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_UPLOAD_MB} MB limit` },
      { status: 413 },
    );
  }

  const fileName = file.name || "upload";
  const sourceType = sourceTypeFor(fileName);
  const sourceId = randomUUID();
  const filePath = join(sourcesDir(), `${sourceId}${extname(fileName).toLowerCase()}`);

  // Read the bytes once: persisted to disk (file_path / audit) and POSTed to the
  // parser. A write failure means no DB row is created.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(sourcesDir(), { recursive: true });
    await writeFile(filePath, bytes);
  } catch (err) {
    console.error("[api/contextualization/[id]/sources POST] write", err);
    return NextResponse.json({ error: "Could not store upload" }, { status: 500 });
  }

  // 1) Insert the pending source row (verifying the project is this tenant's).
  let inserted: {
    id: string;
    source_type: string;
    file_name: string;
    status: string;
    created_at: string;
  } | null;
  try {
    inserted = await withTenantContext(ctx.tenantId, async (c) => {
      const proj = await c.query<{ id: string }>(
        `SELECT id FROM contextualization_projects
          WHERE id = $1 AND tenant_id = $2::uuid`,
        [projectId, ctx.tenantId],
      );
      if (proj.rows.length === 0) return null;

      return c
        .query<{
          id: string;
          source_type: string;
          file_name: string;
          status: string;
          created_at: string;
        }>(
          `INSERT INTO ctx_sources
             (id, tenant_id, project_id, source_type, file_name, file_path)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
           RETURNING id, source_type, file_name, status, created_at`,
          [sourceId, ctx.tenantId, projectId, sourceType, fileName, filePath],
        )
        .then((r) => r.rows[0]);
    });
  } catch (err) {
    console.error("[api/contextualization/[id]/sources POST] insert", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  if (!inserted) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // 2) Parse via mira-ingest (HTTP, no DB held open), then 3) write the result.
  // EVERY parse failure flips the source to 'error' so it never sticks at 'pending'.
  const parsed = await parsePlcViaIngest(file);

  let finalStatus = "done";
  let extractionsCreated = 0;
  let parseError: string | undefined;
  try {
    await withTenantContext(ctx.tenantId, async (c) => {
      if (!parsed.ok) {
        finalStatus = "error";
        parseError = parsed.error;
        await c.query(
          `UPDATE ctx_sources SET status='error', error_message=$2, updated_at=now()
            WHERE id=$1`,
          [sourceId, parsed.error.slice(0, 2000)],
        );
        return;
      }
      const rows = reportToExtractions(parsed.report, {
        tenantId: ctx.tenantId,
        projectId,
        sourceId,
      });
      if (rows.length > 0) {
        await insertExtractions(c, rows);
      }
      extractionsCreated = rows.length;
      await c.query(
        `UPDATE ctx_sources SET status='done', updated_at=now() WHERE id=$1`,
        [sourceId],
      );
    });
  } catch (err) {
    // The parse may have succeeded but the DB write failed — mark error so the
    // source doesn't linger at pending, and surface it.
    console.error("[api/contextualization/[id]/sources POST] store", err);
    finalStatus = "error";
    parseError = "could not store parse result";
    try {
      await withTenantContext(ctx.tenantId, (c) =>
        c.query(
          `UPDATE ctx_sources SET status='error', error_message=$2, updated_at=now()
            WHERE id=$1`,
          [sourceId, parseError!.slice(0, 2000)],
        ),
      );
    } catch (err2) {
      console.error("[api/contextualization/[id]/sources POST] error-mark", err2);
    }
  }

  return NextResponse.json(
    {
      source: {
        id: inserted.id,
        sourceType: inserted.source_type,
        fileName: inserted.file_name,
        status: finalStatus,
        createdAt: inserted.created_at,
      },
      extractionsCreated,
      ...(parseError ? { error: parseError } : {}),
    },
    { status: 201 },
  );
}
