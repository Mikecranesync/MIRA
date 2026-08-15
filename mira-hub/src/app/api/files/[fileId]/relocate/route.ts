/**
 * POST /api/files/[fileId]/relocate — move / re-file a canonical file.
 *
 * Body: { add: AttachTarget[], removeLinkIds: string[] }
 *
 * All-or-nothing: the adds and the named removals happen in ONE transaction
 * (relocateFile). Nothing implicit is removed — only the link ids the caller
 * names. Bytes are never touched.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { relocateFile, isLinkTargetType, type AttachTarget } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

type ParsedTargets = { ok: true; targets: AttachTarget[] } | { ok: false; error: string };

function parseTargets(raw: unknown[]): ParsedTargets {
  const targets: AttachTarget[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "invalid_target" };
    const t = item as Record<string, unknown>;
    if (!isLinkTargetType(t.targetType)) return { ok: false, error: "invalid_target_type" };
    if (typeof t.targetId !== "string" || t.targetId.length === 0) {
      return { ok: false, error: "invalid_target_id" };
    }
    targets.push({
      targetType: t.targetType,
      targetId: t.targetId,
      role: typeof t.role === "string" ? t.role : null,
      displayLabel: typeof t.displayLabel === "string" ? t.displayLabel : null,
      isPrimary: t.isPrimary === true,
      ...(t.matchState === "candidate" || t.matchState === "verified" || t.matchState === "user_confirmed"
        ? { matchState: t.matchState }
        : {}),
      ...(t.matchEvidence !== undefined ? { matchEvidence: t.matchEvidence } : {}),
    });
  }
  return { ok: true, targets };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { fileId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const addRaw = body.add === undefined ? [] : body.add;
  const removeRaw = body.removeLinkIds === undefined ? [] : body.removeLinkIds;
  if (!Array.isArray(addRaw) || !Array.isArray(removeRaw)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 422 });
  }
  if (!removeRaw.every((x) => typeof x === "string" && x.length > 0)) {
    return NextResponse.json({ error: "invalid_link_id" }, { status: 422 });
  }
  const parsed = parseTargets(addRaw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  try {
    const res = await relocateFile(
      ctx.tenantId,
      fileId,
      { add: parsed.targets, removeLinkIds: removeRaw as string[] },
      { createdBy: ctx.userId ?? null },
    );
    if (res.ok) return NextResponse.json({ links: res.links, removed: res.removed });
    if (res.error === "file_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  } catch (err) {
    console.error("[api/files/:fileId/relocate POST]", err);
    return NextResponse.json({ error: "Relocate failed" }, { status: 500 });
  }
}
