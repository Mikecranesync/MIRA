import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const MIME_ALLOWLIST = [
  "application/pdf",
  "image/",
  "text/",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.",
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function isMimeAllowed(mime: string): boolean {
  return MIME_ALLOWLIST.some((prefix) => mime.startsWith(prefix));
}

interface FileRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  source: "direct" | "upload";
  created_at: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const files = await withTenantContext(ctx.tenantId, async (c) => {
      // Verify node belongs to this tenant.
      const nodeCheck = await c.query(
        `SELECT id FROM kg_entities WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (nodeCheck.rows.length === 0) return null;

      // Direct uploads — never select content.
      const directRes = await c.query<FileRow>(
        `SELECT id, filename, mime_type, size_bytes::text, 'direct' AS source, created_at
         FROM namespace_direct_uploads
         WHERE node_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC`,
        [id, ctx.tenantId],
      );

      return directRes.rows.map((r) => ({ ...r, size_bytes: Number(r.size_bytes) }));
    });

    if (files === null) {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }

    // #1900: also list PDFs indexed into this node (hub_uploads v2 attach) so a
    // folder holding a citable manual doesn't read "0 files / No files attached".
    // hub_uploads is an app-pool table (no RLS) — query on the owner pool. These
    // are read-only here (source 'upload'): no raw bytes are parked in
    // namespace_direct_uploads, so the client renders them as indexed entries with
    // no download/delete. A failure must never break the panel.
    let indexed: Array<Omit<FileRow, "size_bytes"> & { size_bytes: number }> = [];
    try {
      const r = await pool.query<{
        id: string;
        filename: string;
        mime_type: string;
        size_bytes: string;
        created_at: string;
      }>(
        `SELECT id::text AS id,
                filename,
                COALESCE(mime_type, 'application/pdf') AS mime_type,
                COALESCE(size_bytes, 0)::text AS size_bytes,
                created_at
           FROM hub_uploads
          WHERE tenant_id = $1
            AND kg_entity_id = $2
            AND status = 'parsed'
            AND kind = 'document'
          ORDER BY created_at DESC`,
        [ctx.tenantId, id],
      );
      indexed = r.rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        mime_type: row.mime_type,
        size_bytes: Number(row.size_bytes),
        source: "upload" as const,
        created_at: row.created_at,
      }));
    } catch (err) {
      console.warn("[api/namespace/node/:id/files] indexed list skipped", err);
    }

    return NextResponse.json({ files: [...indexed, ...files] });
  } catch (err) {
    console.error("[api/namespace/node/:id/files GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 10 MB limit" }, { status: 413 });
  }

  const mimeRaw = file.type || "application/octet-stream";
  if (!isMimeAllowed(mimeRaw)) {
    return NextResponse.json(
      { error: `file type '${mimeRaw}' is not allowed` },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const isPdf = mimeRaw === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  try {
    // Validate the node belongs to the tenant + read its UNS path.
    const node = await withTenantContext(ctx.tenantId, async (c) => {
      const r = await c.query<{ id: string; uns_path: string | null }>(
        `SELECT id, uns_path::text AS uns_path FROM kg_entities WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      return r.rows[0] ?? null;
    });
    if (!node) {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }

    // Indexable docs (PDF) → mira-ingest-v2 path: chunk into knowledge_entries,
    // attached to this node (folder = brain). Re-readable + citable via node chat.
    if (isPdf) {
      const { uploadId, chunkCount } = await ingestPdfToNode({
        tenantId: ctx.tenantId,
        nodeId: id,
        unsPath: node.uns_path,
        filename: file.name,
        mimeType: mimeRaw,
        sizeBytes: file.size,
        buffer,
      });
      return NextResponse.json(
        {
          ok: true,
          indexed: true,
          uploadId,
          chunkCount,
          file: { filename: file.name, size_bytes: file.size },
        },
        { status: 201 },
      );
    }

    // Non-indexable files (images / CAD / etc.) → park the raw bytes (unchanged).
    const directId = await withTenantContext(ctx.tenantId, async (c) => {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO namespace_direct_uploads
            (tenant_id, node_id, filename, mime_type, size_bytes, content, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [ctx.tenantId, id, file.name, mimeRaw, file.size, buffer, ctx.userId],
      );
      return ins.rows[0].id;
    });

    return NextResponse.json(
      { ok: true, indexed: false, file: { id: directId, filename: file.name, size_bytes: file.size } },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/namespace/node/:id/files POST]", err);
    // #1899: a 500 must NOT render as "nothing happened". Return a specific,
    // actionable message (the client surfaces body.error in a toast + a durable
    // error row), while the full error stays server-side in the log above.
    const msg = (err as Error)?.message ?? "";
    let userError = "Couldn't save this file. The error has been logged — please try again.";
    if (/unpdf\/pdfjs|Serverless PDF\.js bundle|Cannot find module/i.test(msg)) {
      userError = "PDF processing is temporarily unavailable on the server. Please try again shortly.";
    } else if (/Invalid PDF|getDocument|extractText|XRef|FormatError/i.test(msg)) {
      userError = "We couldn't read this PDF — it may be image-only, encrypted, or corrupted. Try a text-based PDF.";
    } else if (/permission denied|does not exist|violates|constraint/i.test(msg)) {
      userError = "Server storage error while saving the document. The error has been logged.";
    }
    return NextResponse.json({ error: userError }, { status: 500 });
  }
}
