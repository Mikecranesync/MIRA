/**
 * PUT /api/equipment-notebooks/[id]/work-packet/drawing-photos/[docId]
 *
 * Work Packet (#4982) — drawing connection packet, Worker Task 2: the technician's review step.
 *
 * `docId` is the CURRENT (unreviewed, `matchState:"candidate"`) drawing source created by
 * `POST ./drawing-photos`. The technician reviews/corrects its canonical LINE text
 * (`sourceText` from that POST's response) and PUTs the corrected text here. This route:
 *
 * 1. Resolves `docId` → its origin photo (`getSourceResolution`, `@/lib/equipment-notebooks`) —
 *    404 if it is not a source of this notebook, 409 if it was already superseded by a later
 *    reading, 422 if it carries no `originFileId` (not a photo-derived source at all).
 * 2. VALIDATES the corrected text actually parses as a drawing transcription
 *    (`parseDrawingSourceText`, `@/capabilities/work-packet/drawing`) — a 422 on anything that does
 *    not parse, with NOTHING materialized and NOTHING superseded. No new model call is made here
 *    (materialized-evidence rule: review is a human correction of existing evidence, not a new
 *    inference) — the text is re-rendered canonically (`renderDrawingSourceText`) before storage so
 *    the stored doc is byte-consistent with every other drawing source regardless of how the
 *    technician's editor reformatted whitespace.
 * 3. Materializes a NEW doc with a server-written header (`buildPhotoSourceText(..., reviewed:
 *    true)` — the "technician-reviewed by" framing lives in that header, written by the server,
 *    never by client-supplied text), marks its chunks verified (`markNameplateDocVerified` — the
 *    same promotion `photo-source.ts::keepPhotoAsSource` performs for a reviewed `/look` reading),
 *    and attaches it with `matchState:"user_confirmed"`.
 * 4. Publishes it and SUPERSEDES the old doc (and any other prior reading of the same photo) in the
 *    SAME transaction, under the notebook lock, and only while `docId` is still the visible reading
 *    (`attachSource({ replacesCurrent })`). Two concurrent reviews of one reading cannot both
 *    publish and hide each other: the second gets 409 (Codex #5204 F3).
 *    Superseded rows are hidden, never deleted (citation-origin resolution + audit survive).
 *
 * Only a server-recorded review (this route) makes a drawing reading "technician-reviewed" — a
 * client cannot set `reviewed:true` by any other path.
 *
 * Flag: 404s unless `NOTEBOOK_WORK_PACKET=1` (`workPacketEnabled`, shared with the sibling routes).
 *
 * Response (200): { docId, originFileId, reviewed:true, sourceText, supersededDocIds }
 * Response (422): { error, message } — unparseable corrected text; nothing changed.
 * Response (409): { error: "source_superseded" } — `docId` is no longer the visible reading (checked
 *   up front, and again atomically at publication).
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  attachSource,
  getNotebook,
  getSourceResolution,
  markNameplateDocVerified,
} from "@/lib/equipment-notebooks";
import { parseDrawingSourceText, renderDrawingSourceText } from "@/capabilities/work-packet/drawing";
import { buildPhotoSourceText, materializeDerivedTextDoc } from "@/capabilities/photo-source";
import { workPacketEnabled } from "../../route";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 40000;

type Params = { params: Promise<{ id: string; docId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!workPacketEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id: notebookId, docId } = await params;
  if (!UUID_RE.test(notebookId)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  if (!UUID_RE.test(docId)) return NextResponse.json({ error: "doc_not_found" }, { status: 404 });

  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>).text : undefined;
  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "invalid_body", message: "A corrected drawing text is required." }, { status: 400 });
  }

  const resolution = await getSourceResolution(ctx.tenantId, notebookId, docId);
  if (!resolution) return NextResponse.json({ error: "doc_not_found" }, { status: 404 });
  if (resolution.superseded) {
    return NextResponse.json(
      { error: "source_superseded", message: "This reading is no longer current. Reload the notebook's sources." },
      { status: 409 },
    );
  }
  if (!resolution.originFileId) {
    return NextResponse.json(
      { error: "not_a_drawing_photo_source", message: "This source was not derived from a photographed drawing." },
      { status: 422 },
    );
  }

  const parsed = parseDrawingSourceText(text);
  if (!parsed) {
    return NextResponse.json(
      { error: "text_unparseable", message: "That text does not parse as a drawing transcription. Nothing was changed." },
      { status: 422 },
    );
  }

  const sourceText = renderDrawingSourceText(parsed);
  const docText = buildPhotoSourceText({
    machineName: notebook.displayName,
    fileId: resolution.originFileId,
    photoSha256: null,
    capturedAt: null,
    observation: sourceText,
    reviewed: true,
  });
  const materialized = await materializeDerivedTextDoc({
    tenantId: ctx.tenantId,
    nodeId: notebook.nodeId,
    filename: `Technician-reviewed drawing reading (${resolution.originFileId}).txt`,
    text: docText,
    createdBy: ctx.userId ?? null,
    source: "drawing_text",
  });
  if (!materialized.docId) {
    return NextResponse.json(
      { error: "drawing_source_in_progress", message: "This review is already being saved. Try again in a moment." },
      { status: 503 },
    );
  }

  await markNameplateDocVerified(ctx.tenantId, materialized.docId);

  const reviewedBy = ctx.email || ctx.userId;
  const att = await attachSource(ctx.tenantId, notebookId, materialized.docId, {
    matchState: "user_confirmed",
    sourceRole: "drawing",
    addedBy: ctx.userId ?? null,
    originFileId: resolution.originFileId,
    matchEvidence: {
      drawing_transcription: { reviewed: true, by: reviewedBy, at: new Date().toISOString() },
    },
    // Publish + supersede in one transaction, only while the reviewed doc is still current: a
    // concurrent or slower review gets 409 instead of hiding the other one (Codex #5204 F3).
    replacesCurrent: docId,
  });
  if (!att.ok && att.error === "stale_source") {
    return NextResponse.json(
      { error: "source_superseded", message: "This reading changed while you were reviewing it. Reload the notebook's sources." },
      { status: 409 },
    );
  }
  if (!att.ok) {
    return NextResponse.json(
      { error: `attach_source_failed:${att.error}`, message: "The reviewed text could not be saved as a source." },
      { status: 503 },
    );
  }
  const newDocId = att.docId ?? materialized.docId;
  const supersededDocIds = att.supersededDocIds ?? [];

  return NextResponse.json({
    docId: newDocId,
    originFileId: resolution.originFileId,
    reviewed: true,
    sourceText,
    supersededDocIds,
  });
}
