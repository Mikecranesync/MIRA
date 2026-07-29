import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode } from "@/lib/node-knowledge-ingest";
import pool from "@/lib/db";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";

export const dynamic = "force-dynamic";

const MIME_ALLOWLIST = [
  "application/pdf",
  "image/",
  "text/",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.",
];

const MAX_BYTES = MAX_UPLOAD_BYTES;

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
  upload_id: string | null;
  verified: boolean;
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

      // Parked originals — never select content.
      const directRes = await c.query<FileRow>(
        `SELECT id, filename, mime_type, size_bytes::text, 'direct' AS source,
                created_at, upload_id::text AS upload_id, verified
         FROM namespace_direct_uploads
         WHERE node_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC`,
        [id, ctx.tenantId],
      );

      return directRes.rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mime_type: r.mime_type,
        size_bytes: Number(r.size_bytes),
        source: r.source,
        created_at: r.created_at,
        verified: r.verified === true,
        indexed: r.upload_id !== null,
        upload_id: r.upload_id,
      }));
    });

    if (files === null) {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }

    // #1900: also list PDFs indexed into this node (hub_uploads v2 attach) so a
    // folder holding a citable manual doesn't read "0 files / No files attached".
    // hub_uploads is an app-pool table (no RLS) — query on the owner pool. Since
    // the filing cabinet parks the original bytes alongside ingest, a document
    // usually appears as a `direct` row carrying upload_id; only legacy uploads
    // (pre-parking) surface here as read-only `upload` rows (no bytes to
    // download/delete). A failure must never break the panel.
    const parkedUploadIds = new Set(files.map((f) => f.upload_id).filter(Boolean));
    let indexed: Array<{
      id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      source: "upload";
      created_at: string;
      verified: boolean;
      indexed: boolean;
    }> = [];
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
      indexed = r.rows
        .filter((row) => !parkedUploadIds.has(row.id))
        .map((row) => ({
          id: row.id,
          filename: row.filename,
          mime_type: row.mime_type,
          size_bytes: Number(row.size_bytes),
          source: "upload" as const,
          created_at: row.created_at,
          verified: false,
          indexed: true,
        }));
    } catch (err) {
      console.warn("[api/namespace/node/:id/files] indexed list skipped", err);
    }

    // Strip the internal join key before responding.
    const direct = files.map((f) => ({
      id: f.id,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      source: f.source,
      created_at: f.created_at,
      verified: f.verified,
      indexed: f.indexed,
    }));
    return NextResponse.json({ files: [...indexed, ...direct] });
  } catch (err) {
    console.error("[api/namespace/node/:id/files GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

/** Map a server-side ingest error to a message the panel can show verbatim. */
function friendlyIngestError(msg: string): string {
  if (/unpdf\/pdfjs|Serverless PDF\.js bundle|Cannot find module/i.test(msg)) {
    return "PDF processing is temporarily unavailable on the server. Please try again shortly.";
  }
  if (/Invalid PDF|getDocument|extractText|XRef|FormatError/i.test(msg)) {
    return "We couldn't read this PDF — it may be image-only, encrypted, or corrupted. Try a text-based PDF.";
  }
  if (/permission denied|does not exist|violates|constraint/i.test(msg)) {
    return "Server storage error while saving the document. The error has been logged.";
  }
  return "Couldn't process this file. The error has been logged — please try again.";
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
    return NextResponse.json({ error: `file exceeds ${MAX_UPLOAD_MB} MB limit` }, { status: 413 });
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

    // Filing cabinet: park the original bytes FIRST, for every upload. The
    // document is kept even when downstream indexing fails (an image-only PDF
    // used to 500 and be lost entirely) — the cabinet never loses a file it
    // accepted.
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

    // Indexable docs (PDF) → mira-ingest-v2 path: chunk into knowledge_entries,
    // attached to this node (folder = brain). Re-readable + citable via node chat.
    if (isPdf) {
      try {
        const { uploadId, chunkCount } = await ingestPdfToNode({
          tenantId: ctx.tenantId,
          nodeId: id,
          unsPath: node.uns_path,
          filename: file.name,
          mimeType: mimeRaw,
          sizeBytes: file.size,
          buffer,
        });
        // Link the parked original to its indexed upload so the panel shows ONE
        // row per document (downloadable AND citable) and the tree doesn't
        // double-count it.
        await withTenantContext(ctx.tenantId, async (c) => {
          await c.query(
            `UPDATE namespace_direct_uploads SET upload_id = $1
              WHERE id = $2 AND tenant_id = $3`,
            [uploadId, directId, ctx.tenantId],
          );
        });
        return NextResponse.json(
          {
            ok: true,
            indexed: true,
            uploadId,
            chunkCount,
            file: { id: directId, filename: file.name, size_bytes: file.size },
          },
          { status: 201 },
        );
      } catch (err) {
        // The original is already parked — the file is NOT lost. Report the
        // indexing failure honestly (#1899: visible, durable) without failing
        // the upload.
        console.error("[api/namespace/node/:id/files POST] ingest failed (file kept)", err);
        return NextResponse.json(
          {
            ok: true,
            indexed: false,
            warning: friendlyIngestError((err as Error)?.message ?? ""),
            file: { id: directId, filename: file.name, size_bytes: file.size },
          },
          { status: 201 },
        );
      }
    }

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
    if (/permission denied|does not exist|violates|constraint/i.test(msg)) {
      userError = "Server storage error while saving the document. The error has been logged.";
    }
    return NextResponse.json({ error: userError }, { status: 500 });
  }
}
