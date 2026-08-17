/**
 * DELETE /api/files/[fileId]/links/[linkId] — detach ONE relationship.
 *
 * Never deletes bytes, chunks, or sibling links: detaching a file from notebook
 * A leaves notebook B's link (and the file itself) exactly as it was. Deleting
 * the bytes is a separate, explicit action (DELETE /api/files/[fileId]).
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { detachLink } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ fileId: string; linkId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { fileId, linkId } = await params;
  try {
    const removed = await detachLink(ctx.tenantId, fileId, linkId);
    if (!removed) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/files/:fileId/links/:linkId DELETE]", err);
    return NextResponse.json({ error: "Detach failed" }, { status: 500 });
  }
}
