import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";

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

    return NextResponse.json({ files });
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
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
