import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";

export const dynamic = "force-dynamic";

// Maps a file extension to a ctx_sources.source_type enum value
// (CHECK: 'l5x' | 'st' | 'plcopen' | 'csv' | 'manual' | 'other'). The worker
// passes file_name to the parser for format detection, so the stored type is
// advisory — but keep it accurate for the review UI's "Source" column.
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

// Where uploaded source files land on disk. The parse worker reads
// ctx_sources.file_path from here, so the worker must run on the same host
// (true for the demo: Hub + worker on the PLC/travel laptop).
function sourcesDir(): string {
  const fromEnv = process.env.CTX_SOURCES_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(tmpdir(), "mira-ctx-sources");
}

/** Fire-and-forget the parse worker. Returns false if the process couldn't be started. */
function launchWorker(sourceId: string): boolean {
  const python = process.env.MIRA_PYTHON || "python";
  const script =
    process.env.CTX_PARSE_WORKER ||
    join(process.cwd(), "workers", "ctx_parse_worker.py");
  try {
    const child = spawn(python, [script, sourceId], {
      detached: true,
      stdio: "ignore",
      env: process.env, // worker needs NEON_DATABASE_URL (and optional MIRA_PARSER_ROOT)
    });
    child.on("error", (err) => {
      console.error("[ctx sources] worker spawn error", err);
    });
    child.unref();
    return true;
  } catch (err) {
    console.error("[ctx sources] worker spawn failed", err);
    return false;
  }
}

/**
 * POST /api/contextualization/[id]/sources
 *
 * Multipart upload of a single PLC export / manual into a contextualization
 * project. Writes the file to disk, inserts a pending ctx_sources row, and
 * launches the parse worker (which fills ctx_extractions and flips the source
 * to done/error). Returns the created source row.
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

  // Write the file to disk before inserting, so the worker never races a
  // missing file. A write failure means no DB row is created.
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(sourcesDir(), { recursive: true });
    await writeFile(filePath, bytes);
  } catch (err) {
    console.error("[api/contextualization/[id]/sources POST] write", err);
    return NextResponse.json({ error: "Could not store upload" }, { status: 500 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      // Verify the project belongs to this tenant (FK alone is not tenant-aware).
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

    if (!row) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    const workerStarted = launchWorker(sourceId);

    return NextResponse.json(
      {
        source: {
          id: row.id,
          sourceType: row.source_type,
          fileName: row.file_name,
          status: row.status,
          createdAt: row.created_at,
        },
        workerStarted,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/contextualization/[id]/sources POST]", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}
