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
import {
  currentManualSearchStatus,
  threadStatusScope,
  type ManualSearchStatus,
} from "@/capabilities/notebook-manual-acquisition";
import { confirmedCatalogNumber } from "@/capabilities/notebook-manual-identity";
import { DOCUMENT_BASES, SUBJECT_READ_STEPS } from "@/capabilities/conversation-subject";
import { isComponentAttributionEntry } from "@/capabilities/bench-components/attribution";

export const dynamic = "force-dynamic";

/** The conversation history the GET returns. */
const TURN_WINDOW = 50;
/** How far back the manual-status subject is read when the window settles nothing. */
const WIDEST_SUBJECT_READ = SUBJECT_READ_STEPS[SUBJECT_READ_STEPS.length - 1];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the Hub's send wait reads of a lookup: never a message or link, so it is never shown. */
function sendWaitStatus(status: ManualSearchStatus): ManualSearchStatus {
  return {
    manufacturer: status.manufacturer,
    model: status.model,
    running: status.running,
    ...(status.sourceState ? { sourceState: status.sourceState } : {}),
    ...(status.readySourceDocId ? { readySourceDocId: status.readySourceDocId } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
  };
}

/**
 * #5746 r5 F1: the questions that decide, for the send wait, whether the thread moved to another
 * model. One asked under a selected bench component is about that component (#5750 r3 F13), even
 * when it names the component's own model, so it never decides that. The turn's component stamp
 * covers every turn asked under a selection; the saved attribution entry only the paths that
 * stream a component frame, so a safety stop or an off-topic reply carries the stamp alone.
 */
function wholeMachineQuestions(
  rows: readonly { question: string; evidence?: readonly unknown[] | null; componentId?: string | null }[],
): string[] {
  return rows.filter((t) => !t.componentId && !(t.evidence ?? []).some(isComponentAttributionEntry)).map((t) => t.question);
}

function requestSearchParams(req: NextRequest): URLSearchParams {
  const maybe = req as { nextUrl?: { searchParams?: URLSearchParams }; url?: string };
  if (maybe.nextUrl?.searchParams) return maybe.nextUrl.searchParams;
  return new URL(maybe.url ?? "http://localhost/").searchParams;
}

/**
 * The most recently PROPOSED (not yet confirmed) identity on this notebook's
 * turns, read straight off the raw `evidence[]` the same way
 * `mira-hub/src/factorylm-ui/to-interaction.ts`'s `identityProposalOf` does
 * (duplicated here, not imported: that file is a client component and this
 * is a server-only route). `turns` is chronological, so the LAST match wins.
 */
function latestIdentityProposal(
  turns: readonly { evidence: unknown[] }[],
): { manufacturer: string; model: string } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (const e of turns[i]!.evidence) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      if (r.kind !== "identity_proposal") continue;
      if (typeof r.manufacturer === "string" && typeof r.model === "string") {
        return { manufacturer: r.manufacturer, model: r.model };
      }
    }
  }
  return null;
}

/** True when the newest turn is an answer that came from a document. */
function latestTurnIsGrounded(
  turns: readonly { answerStatus?: string | null; basis?: string | null }[],
): boolean {
  const last = turns[turns.length - 1];
  return !!last && last.answerStatus === "answered" && !!last.basis && DOCUMENT_BASES.has(last.basis);
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
    manualSearch = await currentManualSearchStatus(
      ctx.tenantId,
      id,
      {
        identityStatus: notebook.identityStatus,
        manufacturer: notebook.manufacturer,
        model: notebook.model,
        catalogNumber: notebook.catalogNumber,
      },
      latestIdentityProposal(turns),
      sources,
      ...(latestTurnIsGrounded(turns) ? [{ groundedTurn: true }] : []),
    );
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
  let wholeMachineManualSearch: ManualSearchStatus | undefined;
  const machineModel = manualSearch?.model ?? notebook.model;
  if (threadId && (machineModel || notebook.catalogNumber)) {
    const machine = {
      manufacturer: manualSearch?.manufacturer ?? notebook.manufacturer,
      model: machineModel,
      catalogNumber: machineModel === notebook.model ? notebook.catalogNumber : null,
      recordCatalog: confirmedCatalogNumber(notebook),
    };
    // The newest 50 turns settle nothing, and older ones exist: read further
    // back (the same widest step the chat path's subject read uses) before
    // trusting that the thread never named another model. Still nothing past
    // that bound: the subject is out of reach. The wider read runs at most once.
    let wider: Promise<typeof turns> | undefined;
    const scopeOf = async (questionsOf: (rows: typeof turns) => string[]) => {
      const scope = threadStatusScope(questionsOf(turns), machine);
      if (scope !== "undecided" || turns.length < TURN_WINDOW) return scope;
      const rows = await (wider ??= listTurns(ctx.tenantId, id, WIDEST_SUBJECT_READ, { viewerUserId: ctx.userId, threadId }));
      const widest = threadStatusScope(questionsOf(rows), machine);
      return widest === "undecided" && rows.length >= WIDEST_SUBJECT_READ ? "out_of_reach" : widest;
    };
    // A failed wider read is inconclusive (r2 F9): the status is withheld
    // without a scope, and the rest of the response still returns.
    try {
      const scope = await scopeOf((rows) => rows.map((t) => t.question));
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
    // #5746 r4 F1 + r5 F1: a status withheld only for questions asked under a component is
    // withheld from display only. A question about the whole machine still waits for this
    // lookup, so the send wait gets it, without the message or link it would show. A
    // whole-machine question that named another model, a subject out of reach, or a failed
    // read sends nothing.
    if (manualSearch && manualSearchScope === "other_model") {
      try {
        const scope = await scopeOf(wholeMachineQuestions);
        if (scope !== "other" && scope !== "out_of_reach") wholeMachineManualSearch = sendWaitStatus(manualSearch);
      } catch (err) {
        console.error("[equipment-notebooks] wider thread read failed (the send wait gets no lookup):", err);
      }
    }
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
    ...(wholeMachineManualSearch ? { wholeMachineManualSearch } : {}),
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
