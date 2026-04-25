import { NextRequest, NextResponse } from "next/server";
import { getUpload, updateUploadStatus, deleteUpload } from "@/lib/uploads";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

const TERMINAL: ReadonlyArray<string> = ["parsed", "failed", "cancelled"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const row = await getUpload(id, ctx.tenantId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!TERMINAL.includes(row.status)) {
    await updateUploadStatus(id, "cancelled", "user cancelled");
    return NextResponse.json({ ok: true, action: "cancelled" });
  }

  if (row.status === "parsed" && row.kbFileId) {
    try {
      await deleteFromOpenWebUi(row.kbFileId);
    } catch (err) {
      console.error(`[uploads/${id}] OpenWebUI delete failed`, err);
    }
  }

  await deleteUpload(id, ctx.tenantId);
  return NextResponse.json({ ok: true, action: "deleted" });
}

async function deleteFromOpenWebUi(fileId: string): Promise<void> {
  const base = process.env.OPENWEBUI_BASE_URL;
  const apiKey = process.env.OPENWEBUI_API_KEY;
  if (!base || !apiKey) return;
  const res = await fetch(`${base}/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`openwebui delete ${res.status}`);
  }
}
