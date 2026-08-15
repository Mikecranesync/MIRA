import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { findDuplicateUpload } from "@/lib/uploads";
import pool from "@/lib/db";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import {
  parkOrReuseFile,
  linkFileToUpload,
  attachFileToTargets,
  fileCapability,
} from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

// Types we recognize well enough to keep their declared MIME. Everything else
// is RETAINED (a maintenance workspace holds arbitrary files) but normalized to
// application/octet-stream so it is parked as capability "stored": never
// indexed, never rendered inline, download-only. The only hard rejection left
// on this door is the size limit.
const KNOWN_MIME_PREFIXES = [
  "application/pdf",
  "image/",
  "text/",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.",
];

const MAX_BYTES = MAX_UPLOAD_BYTES;

function isKnownMime(mime: string): boolean {
  return KNOWN_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
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
  // ARPK 1c: zero extractable text is a property of the file — name it, don't
  // hide it behind the generic "couldn't read" (checked FIRST: the raw message
  // would otherwise be swallowed by broader patterns below).
  if (/no extractable text/i.test(msg)) {
    return "This PDF has no extractable text — it appears to be scanned or image-only. OCR isn't supported yet, so it can't be indexed for chat; the original file is kept.";
  }
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

  // Unknown types are kept, not rejected — normalized to octet-stream so the
  // capability model parks them as "stored" (see KNOWN_MIME_PREFIXES above).
  const declaredMime = file.type || "application/octet-stream";
  const mimeRaw = isKnownMime(declaredMime) ? declaredMime : "application/octet-stream";

  const buffer = Buffer.from(await file.arrayBuffer());
  const isPdf = mimeRaw === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  // Plain text is indexable too (copied-text source door): the bytes ARE the
  // text — no extraction, single-page chunking via writeTextChunksForNode.
  const isText =
    mimeRaw.startsWith("text/plain") ||
    file.name.toLowerCase().endsWith(".txt") ||
    file.name.toLowerCase().endsWith(".md");

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

    // ARPK 1b — content dedup. An exact re-upload of already-indexed bytes to
    // this node returns the EXISTING document instead of chunking a second
    // copy (the 158x-ingest class). Best-effort: a dedup-lookup failure must
    // never block an upload.
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    if (isPdf) {
      try {
        const dup = await findDuplicateUpload(ctx.tenantId, contentSha256, id);
        if (dup) {
          return NextResponse.json(
            {
              ok: true,
              indexed: true,
              duplicate: true,
              uploadId: dup.id,
              chunkCount: dup.kbChunkCount,
              file: { filename: file.name, size_bytes: file.size },
            },
            { status: 200 },
          );
        }
      } catch (err) {
        console.warn("[api/namespace/node/:id/files POST] dedup lookup skipped", err);
      }
    }

    // Filing cabinet: park the original bytes FIRST, for every upload — through
    // the canonical Files service (075), which resolves identical bytes to the
    // EXISTING canonical file instead of parking a second blob. The document is
    // kept even when downstream indexing fails (an image-only PDF used to 500
    // and be lost entirely) — the cabinet never loses a file it accepted.
    const park = await parkOrReuseFile({
      tenantId: ctx.tenantId,
      filename: file.name,
      mimeType: mimeRaw,
      sizeBytes: file.size,
      buffer,
      createdBy: ctx.userId,
      nodeId: id,
    });
    const directId = park.fileId;

    // Every upload files the canonical file at THIS node. Attaching is
    // idempotent (unique relationship constraint), and a link failure must
    // never lose the parked bytes.
    try {
      await attachFileToTargets(
        ctx.tenantId,
        directId,
        [{ targetType: "namespace_node", targetId: id, isPrimary: false }],
        { createdBy: ctx.userId },
      );
    } catch (err) {
      console.warn("[api/namespace/node/:id/files POST] node link skipped", err);
    }

    // Exact bytes already parsed for this tenant → reuse the existing document.
    // No re-parse, no re-chunk, no re-embed; the file is simply now ALSO filed
    // here (the link above did that).
    if (park.reused && park.uploadId !== null) {
      return NextResponse.json(
        {
          ok: true,
          indexed: true,
          duplicate: true,
          uploadId: park.uploadId,
          fileId: directId,
          file: {
            id: directId,
            filename: file.name,
            size_bytes: file.size,
            capability: fileCapability(mimeRaw, file.name),
          },
        },
        { status: 200 },
      );
    }

    // Indexable docs (PDF + plain text) → mira-ingest-v2 path: chunk into
    // knowledge_entries attached to this node. Re-readable + citable via chat.
    if (isPdf || isText) {
      try {
        const ingest = isPdf ? ingestPdfToNode : ingestTextToNode;
        const { uploadId, chunkCount } = await ingest({
          tenantId: ctx.tenantId,
          nodeId: id,
          unsPath: node.uns_path,
          filename: file.name,
          mimeType: mimeRaw,
          sizeBytes: file.size,
          buffer,
          contentSha256,
        });
        // Link the parked original to its indexed upload so the panel shows ONE
        // row per document (downloadable AND citable) and the tree doesn't
        // double-count it.
        await linkFileToUpload(ctx.tenantId, directId, uploadId);
        return NextResponse.json(
          {
            ok: true,
            indexed: true,
            uploadId,
            chunkCount,
            fileId: directId,
            file: {
              id: directId,
              filename: file.name,
              size_bytes: file.size,
              capability: fileCapability(mimeRaw, file.name),
            },
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
            fileId: directId,
            file: {
              id: directId,
              filename: file.name,
              size_bytes: file.size,
              capability: fileCapability(mimeRaw, file.name),
            },
          },
          { status: 201 },
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        indexed: false,
        fileId: directId,
        file: {
          id: directId,
          filename: file.name,
          size_bytes: file.size,
          capability: fileCapability(mimeRaw, file.name),
        },
      },
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
