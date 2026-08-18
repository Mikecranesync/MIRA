/**
 * GET    /api/files/[fileId] — one canonical file + every relationship it has.
 * DELETE /api/files/[fileId] — destructive delete (bytes). NOT detach.
 *
 * Delete refuses while any relationship remains (409 has_links: "detach
 * everywhere, then delete") and honours verified-file retention (409
 * verified_retained). A missing id and another tenant's id are indistinguishable:
 * both are 404 { error: "not_found" }.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getFile, deleteFile } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { fileId } = await params;
  try {
    const found = await getFile(ctx.tenantId, fileId);
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // `file` already carries the derived capability + the `indexed` boolean.
    return NextResponse.json({ file: found.file, links: found.links });
  } catch (err) {
    console.error("[api/files/:fileId GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { fileId } = await params;
  try {
    const res = await deleteFile(ctx.tenantId, fileId);
    if (res.ok) return NextResponse.json({ ok: true });
    if (res.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (res.error === "has_links") {
      return NextResponse.json(
        {
          error: "has_links",
          message:
            "This file is still attached somewhere. Detach it from every location first, then delete it.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: "verified_retained",
        message: "Verified files are retained and cannot be deleted.",
      },
      { status: 409 },
    );
  } catch (err) {
    console.error("[api/files/:fileId DELETE]", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
