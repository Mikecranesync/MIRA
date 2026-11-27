/**
 * GET    /api/equipment-notebooks/[id] — notebook + sources + conversation.
 * PATCH  /api/equipment-notebooks/[id] — edit identity/metadata.
 * DELETE /api/equipment-notebooks/[id] — permanently delete the notebook and
 *        every notebook-scoped dependent row (see lib deleteNotebook for what
 *        is deliberately preserved: the files themselves and the kg node).
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  deleteNotebook,
  getNotebook,
  listSources,
  listThreads,
  listTurns,
  normalizeNotebookThreadId,
  updateNotebook,
} from "@/lib/equipment-notebooks";
import { listFilesForTarget } from "@/lib/workspace-files";
import type { ManualSearchStatus } from "@/capabilities/notebook-manual-acquisition";
import { isComponentAttributionEntry } from "@/capabilities/bench-components/attribution";
import { TURN_WINDOW, notebookManualStatus, numbersApply, numbersForMachine, subjectMachine, subjectReader } from "@/capabilities/manual-status-subject";
import { readConfirmedNumbers } from "@/capabilities/confirmed-numbers";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestSearchParams(req: NextRequest): URLSearchParams {
  const maybe = req as { nextUrl?: { searchParams?: URLSearchParams }; url?: string };
  if (maybe.nextUrl?.searchParams) return maybe.nextUrl.searchParams;
  return new URL(maybe.url ?? "http://localhost/").searchParams;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const rawThreadId = requestSearchParams(req).get("threadId");
  const threadId = rawThreadId === null ? undefined : normalizeNotebookThreadId(rawThreadId);
  if (rawThreadId !== null && !threadId) {
    return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
  }
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [sources, turns, threads, photos] = await Promise.all([
    listSources(ctx.tenantId, id),
    // 086: history is read AS the authenticated technician — own turns plus
    // labeled legacy rows, never another user's. Same endpoint for Mobile and
    // Web, so this is where "your conversation on any device" is decided.
    listTurns(ctx.tenantId, id, TURN_WINDOW, { viewerUserId: ctx.userId, ...(threadId ? { threadId } : {}) }),
    // 087 / THRD-0: the notebook is the Project; these are its conversations.
    // Derived from rows the same viewer may read, so isolation matches history.
    listThreads(ctx.tenantId, id, 50, { viewerUserId: ctx.userId }),
    // S5 D1 (hub half): linked LOOK photos (workspace_file_links role
    // "photo") as a SEPARATE additive array — reuses listFilesForTarget,
    // touches neither the sources semantics nor the trust gate. A failure
    // here never hides the notebook.
    listFilesForTarget(ctx.tenantId, "equipment_notebook", id)
      .then((files) =>
        files
          .filter((f) => f.link.role === "photo")
          .map((f) => ({
            fileId: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            createdAt: f.createdAt,
            linkedAt: f.link.createdAt,
          })),
      )
      .catch((err) => {
        console.error("[equipment-notebooks] photo listing failed (continuing without it):", err);
        return [];
      }),
  ]);
  // T2 (#4189 F4/F6) — the manual-search status is computed FRESH on every
  // read, never persisted on the turn: a "running" snapshot taken at
  // persist-time would read as permanently stale once the search finishes
  // (the exact reason chat/route.ts's own `manualSearchStatusFrame` comment
  // gives for keeping that frame transient-only). This is the ONE place that
  // recomputes current state, reused by both the Hub (`hub-host.tsx`'s
  // `loadDetail`, called after every send and after a confirm) and mobile
  // (`getNotebookDetail`) on their EXISTING post-turn/post-confirm refetch —
  // never a second acquisition-status path.
  let manualSearch: ManualSearchStatus | null = null;
  try {
    manualSearch = await notebookManualStatus(ctx.tenantId, id, notebook, sources, turns);
  } catch (err) {
    console.error("[equipment-notebooks] manual search status read failed (continuing without it):", err);
  }
  // #5750: the status names the project's machine. A thread that asked about
  // another exact model must not show that machine's ready line and manual
  // link under its own answer. Only a thread-scoped read knows which questions
  // belong to the open conversation; a whole-notebook read keeps the status.
  // The response says why it was withheld (`manualSearchScope`), so a client
  // can tell it apart from a failed read and clear a status it already shows.
  // That holds even when there is no current status to withhold (r2 F1): a
  // client may still be showing one from an earlier read.
  let manualSearchScope: "other_model" | "out_of_reach" | undefined;
  const machine = threadId ? subjectMachine(manualSearch, notebook) : null;
  if (threadId && machine) {
    const statusForSubject = manualSearch;
    const subject = subjectReader({
      tenantId: ctx.tenantId, notebookId: id, viewerUserId: ctx.userId, threadId, turns, machine,
      // #6085: no reader unless confirmed numbers can count; the reader itself runs only
      // when this thread would otherwise be withheld.
      confirmedNumbers: numbersApply(statusForSubject, notebook)
        ? async () => numbersForMachine(await readConfirmedNumbers(ctx.tenantId, id), statusForSubject, notebook)
        : undefined,
    });
    // A failed wider read is inconclusive (r2 F9): the status is withheld
    // without a scope, and the rest of the response still returns.
    try {
      const scope = await subject.shown();
      if (scope === "out_of_reach") manualSearchScope = "out_of_reach";
      if (scope === "other") manualSearchScope = "other_model";
    } catch (err) {
      console.error("[equipment-notebooks] wider thread read failed (withholding the manual status):", err);
      manualSearch = null;
    }
    // #5750 r3 F13: the status is placed under the newest answer. An answer
    // asked under a selected bench component is about that component, not
    // the project's machine, so the project's status is withheld there.
    const newest = turns.at(-1);
    if (newest && (newest.evidence ?? []).some(isComponentAttributionEntry)) manualSearchScope = "other_model";
    if (manualSearchScope) manualSearch = null;
  }
  // #5750 r3 F10/F11/F12: on a thread-scoped read, the saved answer this
  // status was checked against — the newest turn the read saw. Clients show
  // the status under that answer only, and nowhere when it is null (no answer
  // yet) or not in their history yet.
  const manualSearchAnswer = threadId && manualSearch
    ? (turns.length ? { turnId: turns[turns.length - 1]!.id, clientRequestId: turns[turns.length - 1]!.clientRequestId ?? null } : null)
    : undefined;
  return NextResponse.json({
    notebook, sources, turns, threads, photos, manualSearch,
    ...(manualSearchScope ? { manualSearchScope } : {}),
    ...(manualSearchAnswer !== undefined ? { manualSearchAnswer } : {}),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ok = await updateNotebook(ctx.tenantId, id, body);
  if (!ok) return NextResponse.json({ error: "not_found_or_empty_patch" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  // Reject a malformed id before it reaches Postgres: an invalid uuid would
  // raise 22P02 and surface as a 500, when the honest answer is "no such
  // notebook". Same shape a cross-tenant id gets, so this leaks nothing.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await deleteNotebook(ctx.tenantId, id);
    if (!result.deleted) {
      // Covers "never existed", "already deleted", and "belongs to another
      // tenant" identically -- a distinct response for the third would confirm
      // the existence of another tenant's notebook.
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      id,
      deleted: {
        sources: result.sources,
        turns: result.turns,
        fileLinks: result.fileLinks,
      },
    });
  } catch (err) {
    // The whole delete is one transaction, so a throw here means nothing was
    // removed -- the notebook is intact and the client may safely retry.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23503") {
      // A dependant we do not know about still references this notebook.
      // Report it rather than half-deleting: 409 is retry-after-fix, not retry.
      console.error("[api/equipment-notebooks/DELETE] fk conflict", err);
      return NextResponse.json(
        { error: "conflict", detail: "notebook still referenced by another record" },
        { status: 409 },
      );
    }
    console.error("[api/equipment-notebooks/DELETE]", err);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
