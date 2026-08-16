/**
 * POST /api/files/[fileId]/links — attach one canonical file to one or more
 * targets (equipment_notebook | cmms_asset | namespace_node | work_order).
 *
 * Body: { targets: AttachTarget[] } — a single bare target object is accepted
 * and normalized to a one-element array.
 *
 * Idempotency: this endpoint is naturally idempotent. The unique constraint
 * `uq_workspace_file_links_relationship` (migration 075) makes a replay an
 * upsert that returns the SAME link id, so an `Idempotency-Key` header needs no
 * server-side key store — replaying the request is already safe. The header is
 * accepted and ignored.
 *
 * Ownership: a file or target belonging to another tenant is indistinguishable
 * from one that does not exist — both 404, never a different status.
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { attachFileToTargets, isLinkTargetType, type AttachTarget } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

type ParsedTargets = { ok: true; targets: AttachTarget[] } | { ok: false; error: string };

/** Normalize `{targets:[...]}` or a single bare target into a validated array. */
function parseTargets(body: Record<string, unknown>): ParsedTargets {
  const raw = Array.isArray(body.targets)
    ? (body.targets as unknown[])
    : typeof body.targetType === "string"
      ? [body]
      : null;
  if (raw === null || raw.length === 0) return { ok: false, error: "targets_required" };

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
      // Trust is SERVER-owned (Codex P1, 2026-08-16): a public attach is by
      // definition a user action, so the source row it creates is
      // user_confirmed — the client cannot request "verified" (that state is
      // earned by server-side applicability proof in the confirm route) and
      // cannot inject match_evidence (evidence describes server-derived
      // provenance, not caller assertions).
      matchState: "user_confirmed" as const,
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

  const parsed = parseTargets(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  try {
    const res = await attachFileToTargets(ctx.tenantId, fileId, parsed.targets, {
      createdBy: ctx.userId ?? null,
    });
    if (res.ok) return NextResponse.json({ links: res.links });
    if (res.error === "file_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Deliberately does NOT echo which target failed — that would confirm the
    // existence (or not) of another tenant's row.
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  } catch (err) {
    console.error("[api/files/:fileId/links POST]", err);
    return NextResponse.json({ error: "Attach failed" }, { status: 500 });
  }
}
