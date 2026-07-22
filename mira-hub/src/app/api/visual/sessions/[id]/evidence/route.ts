// mira-hub/src/app/api/visual/sessions/[id]/evidence/route.ts
//
// Visual Focus Workspace (PR V2) — evidence for one session.
//   GET  → list evidence items (metadata only — bytes come from .../view).
//   POST → upload one raster image (multipart form, field "file").
//
// Upload discipline (PRD §15): magic-byte sniff (never the client MIME), size
// cap, server-parsed natural dimensions into capture_meta (the geometry
// normalization reference — client dims are never trusted). Original bytes are
// retained verbatim (FR-1); evidence rows are INSERT+UPDATE only (no DELETE).

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } from "@/lib/config";
import { sniffMime } from "@/lib/sniff-mime";
import { imageDims, jpegExifOrientation } from "@/lib/visual/image-dims";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Decompression-bomb caps (PRD §15): generous for 600-dpi print scans, but a
// hard stop on absurd declared dimensions.
const MAX_IMAGE_SIDE_PX = 16384;
const MAX_IMAGE_PIXELS = 80_000_000;

// V2 viewer is raster-only (PdfPageViewer/DeepZoomViewer are V6).
const RASTER_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// Migration 063 evidence_item.source_type CHECK list (no 'equipment' literal).
const SOURCE_TYPES = new Set([
  "print",
  "panel",
  "component",
  "nameplate",
  "terminal",
  "plc",
  "drive",
  "hmi",
  "area",
  "mixed",
  "unknown",
]);

const EVIDENCE_COLUMNS =
  "evidence_id, session_id, source_type, drawing_type, page_ref, original_hash, content_mime, capture_meta, quality_score, created_at";

interface EvidenceRow {
  evidence_id: string;
  session_id: string;
  source_type: string;
  drawing_type: string | null;
  page_ref: string | null;
  original_hash: string | null;
  content_mime: string | null;
  capture_meta: Record<string, unknown>;
  quality_score: string | null;
  created_at: string;
  has_content?: boolean;
}

function shapeEvidence(row: EvidenceRow) {
  const meta = row.capture_meta ?? {};
  return {
    evidence_id: row.evidence_id,
    session_id: row.session_id,
    source_type: row.source_type,
    drawing_type: row.drawing_type,
    page_ref: row.page_ref,
    original_hash: row.original_hash,
    content_mime: row.content_mime,
    width: typeof meta.width === "number" ? meta.width : null,
    height: typeof meta.height === "number" ? meta.height : null,
    has_content: row.has_content ?? false,
    created_at: row.created_at,
  };
}

async function sessionOwned(
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  return withTenantContext(tenantId, async (c) => {
    const res = await c.query(
      `SELECT 1 FROM visual_session WHERE session_id = $1 AND tenant_id = $2`,
      [sessionId, tenantId],
    );
    return res.rows.length > 0;
  });
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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    if (!(await sessionOwned(ctx.tenantId, id))) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    const rows = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS}, (content IS NOT NULL) AS has_content
         FROM evidence_item
         WHERE session_id = $1 AND tenant_id = $2
         ORDER BY created_at ASC`,
        [id, ctx.tenantId],
      );
      return res.rows;
    });
    // NOTE: signed view tokens (src/lib/visual/signed-url.ts) are deliberately
    // NOT minted into these responses in V2 — the auth middleware 401s
    // cookie-less /api/visual requests before the view route could verify one,
    // so a token would be unusable by its only intended (cookie-less)
    // consumers. PR V3 adds the middleware carve-out with the Telegram launch
    // surface; the helper + view-route acceptance stay tested until then.
    return NextResponse.json({ evidence: rows.map(shapeEvidence) });
  } catch (err) {
    console.error("[api/visual/sessions/:id/evidence GET]", err);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart_form_required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_field_required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_UPLOAD_MB} MB limit` },
      { status: 413 },
    );
  }

  const sourceTypeRaw = form.get("source_type");
  const sourceType =
    typeof sourceTypeRaw === "string" && SOURCE_TYPES.has(sourceTypeRaw)
      ? sourceTypeRaw
      : "unknown";
  const pageRefRaw = form.get("page_ref");
  const pageRef =
    typeof pageRefRaw === "string" && pageRefRaw.trim().length > 0
      ? pageRefRaw.trim().slice(0, 100)
      : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(new Uint8Array(buffer));
  if (sniffed !== "png" && sniffed !== "jpeg" && sniffed !== "webp") {
    return NextResponse.json(
      { error: "unsupported_image_type", detail: "PNG, JPEG, or WebP required" },
      { status: 415 },
    );
  }
  const mime = RASTER_MIME[sniffed];
  let dims = imageDims(new Uint8Array(buffer), sniffed);
  if (!dims) {
    return NextResponse.json({ error: "unreadable_image_dimensions" }, { status: 415 });
  }
  // Decompression-bomb guard (PRD §15): a small file can declare enormous
  // dimensions; cap what the browser will be asked to decode.
  if (dims.width > MAX_IMAGE_SIDE_PX || dims.height > MAX_IMAGE_SIDE_PX ||
      dims.width * dims.height > MAX_IMAGE_PIXELS) {
    return NextResponse.json({ error: "image_dimensions_too_large" }, { status: 415 });
  }
  // EXIF orientations 5–8 transpose the decoded raster relative to the JPEG
  // SOF frame. Browsers render the ORIENTED bitmap (image-orientation:
  // from-image is the default), and normalized_original coordinates are
  // fractions of what the technician sees — so the stored normalization
  // reference must be the oriented dimensions. The raw orientation is
  // recorded so non-browser consumers of the verbatim bytes (Python/PIL does
  // NOT auto-apply EXIF) can transform coordinates back to the raw raster.
  const exifOrientation =
    sniffed === "jpeg" ? jpegExifOrientation(new Uint8Array(buffer)) : null;
  if (exifOrientation !== null && exifOrientation >= 5) {
    dims = { width: dims.height, height: dims.width };
  }

  const hash = createHash("sha256").update(buffer).digest("hex");
  const captureMeta = {
    width: dims.width,
    height: dims.height,
    size_bytes: file.size,
    uploaded_via: "hub",
    filename: (file.name || "").slice(0, 200),
    ...(exifOrientation !== null ? { exif_orientation: exifOrientation } : {}),
  };

  try {
    if (!(await sessionOwned(ctx.tenantId, id))) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const ins = await c.query<EvidenceRow>(
        `INSERT INTO evidence_item
            (session_id, tenant_id, source_type, page_ref, original_hash,
             content, content_mime, capture_meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${EVIDENCE_COLUMNS}`,
        [id, ctx.tenantId, sourceType, pageRef, hash, buffer, mime, JSON.stringify(captureMeta)],
      );
      // visual_session has no updated_at trigger — bump it so listings sort
      // by real activity.
      await c.query(
        `UPDATE visual_session SET updated_at = NOW() WHERE session_id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      return ins.rows[0];
    });
    return NextResponse.json(
      { evidence: shapeEvidence({ ...row, has_content: true }) },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/visual/sessions/:id/evidence POST]", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
