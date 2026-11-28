import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { oemSourceBytes } from "@/capabilities/oem-source-bytes";

export const dynamic = "force-dynamic";
// Node runtime: the fetch guards resolve DNS and hash with node:crypto.
export const runtime = "nodejs";

/**
 * GET /api/oem-sources/{entryId}/ — #6119. The Hub's own copy of the public
 * manufacturer manual behind one shared knowledge_entries row, so the cited-page
 * viewer can draw the cited page on Android. The id is the only input: the URL is
 * resolved on the server from a non-private row, and nothing the client sends is
 * ever fetched. A caller's own uploads are not served here (/api/namespace/files/).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  try {
    const result = await oemSourceBytes(id);
    if (result.kind === "not_found") return NextResponse.json({ error: "source not found" }, { status: 404 });
    if (result.kind === "unavailable") return NextResponse.json({ error: "source_unavailable" }, { status: 502 });
    const safeFilename = encodeURIComponent(result.filename).replace(/%20/g, " ");
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/oem-sources/:id GET]", err instanceof Error ? err.message : "error");
    return NextResponse.json({ error: "source_unavailable" }, { status: 502 });
  }
}
