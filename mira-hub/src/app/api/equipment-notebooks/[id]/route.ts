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
  listTurns,
  updateNotebook,
} from "@/lib/equipment-notebooks";
import { listFilesForTarget } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [sources, turns, photos] = await Promise.all([
    listSources(ctx.tenantId, id),
    listTurns(ctx.tenantId, id),
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
  return NextResponse.json({ notebook, sources, turns, photos });
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
