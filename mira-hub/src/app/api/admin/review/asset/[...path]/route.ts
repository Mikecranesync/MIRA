import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sessionOr401 } from "@/lib/session";
import { isReviewAdmin, resolveAssetPath } from "@/lib/review-queue";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!isReviewAdmin(ctx.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { path: parts } = await params;
  const relPath = parts.map(decodeURIComponent).join("/");
  const abs = resolveAssetPath(relPath);
  if (!abs) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  let s;
  try {
    s = await stat(abs);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!s.isFile()) {
    return NextResponse.json({ error: "not a file" }, { status: 400 });
  }
  const ext = path.extname(abs).toLowerCase();
  const ct = MIME[ext];
  if (!ct) {
    return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(abs);
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}
