/**
 * POST /api/equipment-notebooks/[id]/photos/[fileId]/source
 *
 * Keep a photo already attached to this notebook (via `/look`) as one of the
 * machine's sources, so a later conversation on the same machine can retrieve
 * and cite it without the technician re-sending the photo. The citation opens
 * the original photograph.
 *
 * The technician's action confirms that the photo belongs to this machine; the
 * stored vision reading stays unconfirmed unless an explicit reviewed payload
 * confirms corrected text against the original photo. See
 * `@/capabilities/photo-source` for the evidence rules.
 *
 *   200 { docId, alreadyKept, chunkCount }
 *   404 notebook_not_found | photo_not_found
 *   409 asset_not_confirmed | no_photo_reading
 *   503 photo_source_in_progress | attach_source_failed:<reason>
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, normalizeNotebookThreadId } from "@/lib/equipment-notebooks";
import { keepPhotoAsSource } from "@/capabilities/photo-source";
import { photoLinkedToTarget } from "@/lib/workspace-files";
import { withTenantContext } from "@/lib/tenant-context";
import { loadVisualEvidenceForPhoto } from "@/lib/visual-evidence-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id, fileId } = await params;
  // Malformed and cross-tenant ids are indistinguishable from unknown ones.
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  if (!UUID_RE.test(fileId)) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  // Same rule as recorded fixes: a QR/NFC selection is not a confirmation, so
  // nothing is filed as this machine's knowledge until a technician confirms
  // which machine it is. Unbound notebooks keep against themselves.
  if (notebook.asset && !notebook.asset.confirmedAt) {
    return NextResponse.json(
      { error: "asset_not_confirmed", message: "Confirm which machine this is before keeping a photo on it." },
      { status: 409 },
    );
  }

  // Required `{ threadId }` (including "legacy"): the conversation whose reading the technician saw.
  const body = (await req.json().catch(() => null)) as { threadId?: unknown; reviewed?: unknown } | null;
  const rawThread = typeof body?.threadId === "string" ? body.threadId : null;
  const threadId = rawThread === null ? null : normalizeNotebookThreadId(rawThread);
  if (!threadId) return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });

  let reviewed: { observationId: string; text: string } | undefined;
  if (body?.reviewed !== undefined) {
    const review = body.reviewed as { observationId?: unknown; text?: unknown; confirmed?: unknown } | null;
    if (!review || review.confirmed !== true || typeof review.observationId !== "string" || !UUID_RE.test(review.observationId)
      || typeof review.text !== "string" || !review.text.trim() || review.text.trim().length > 20000 || !ctx.userId)
      return NextResponse.json({ error: "invalid_photo_review" }, { status: 400 });
    reviewed = { observationId: review.observationId, text: review.text.trim() };
  }

  try {
    const result = await keepPhotoAsSource({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      notebook,
      fileId,
      threadId,
      ...(reviewed ? { reviewed } : {}),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ docId: result.docId, alreadyKept: result.alreadyKept, chunkCount: result.chunkCount });
  } catch (err) {
    console.error("[photo-source] keep failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "photo_source_failed" }, { status: 500 });
  }
}


/** The review editor receives an exact observation ID, never a tenant-wide latest reading. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id, fileId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(fileId) || !ctx.userId)
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  const raw = new URL(req.url).searchParams.get("threadId");
  const threadId = raw === null ? null : normalizeNotebookThreadId(raw);
  if (raw !== null && !threadId) return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
  try {
    if (!await photoLinkedToTarget(ctx.tenantId, fileId, "equipment_notebook", id))
      return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
    const reading = await withTenantContext(ctx.tenantId, c => loadVisualEvidenceForPhoto(c, ctx.tenantId, fileId,
      { notebookId: id, ownerUserId: ctx.userId!, threadId }));
    if (!reading) return NextResponse.json({ error: "no_photo_reading" }, { status: 409 });
    return NextResponse.json({ observationId: reading.observationId, text: reading.text, reviewed: reading.trust === "verified" });
  } catch {
    return NextResponse.json({ error: "photo_review_unavailable" }, { status: 503 });
  }
}
