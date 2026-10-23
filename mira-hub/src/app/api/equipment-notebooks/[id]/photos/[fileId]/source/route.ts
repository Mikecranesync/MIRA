/**
 * POST /api/equipment-notebooks/[id]/photos/[fileId]/source
 *
 * Keep a photo already attached to this notebook (via `/look`) as one of the
 * machine's sources, so a later conversation on the same machine can retrieve
 * and cite it without the technician re-sending the photo. The citation opens
 * the original photograph.
 *
 * The technician's action confirms that the photo belongs to this machine; the
 * stored vision reading stays an unconfirmed transcription. See
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

  // Optional `{ threadId }`: the conversation whose reading the technician saw.
  const body = (await req.json().catch(() => null)) as { threadId?: unknown } | null;
  const rawThread = typeof body?.threadId === "string" ? body.threadId : null;
  const threadId = rawThread === null ? undefined : normalizeNotebookThreadId(rawThread);
  if (rawThread !== null && !threadId) return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });

  try {
    const result = await keepPhotoAsSource({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      notebook,
      fileId,
      ...(threadId ? { threadId } : {}),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ docId: result.docId, alreadyKept: result.alreadyKept, chunkCount: result.chunkCount });
  } catch (err) {
    console.error("[photo-source] keep failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "photo_source_failed" }, { status: 500 });
  }
}
