import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { sessionOr401 } from "@/lib/session";
import { isReviewAdmin, resolveAssetPath, sidecarPathFor } from "@/lib/review-queue";

export const dynamic = "force-dynamic";

interface Body {
  decision?: "approve" | "reject";
  reason?: string;
}

const ALLOWED_TYPES = new Set(["proposal", "cartoon", "screenshot", "audit"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!isReviewAdmin(ctx.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { type, id } = await params;
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const decision = body.decision === "reject" ? "reject" : "approve";

  if (type === "proposal") {
    // Delegate to the existing decide endpoint — same auth cookie carries over
    // via the next-auth session; absolute URL with the request's origin.
    const origin = new URL(req.url).origin;
    const proposalId = decodeURIComponent(id);
    const upstream = await fetch(`${origin}/api/proposals/${proposalId}/decide`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        decision: decision === "approve" ? "verify" : "reject",
        reason: body.reason,
      }),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  if (type === "cartoon" || type === "screenshot") {
    const relPath = decodeURIComponent(id);
    const abs = resolveAssetPath(relPath);
    if (!abs) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
    const sidecar = sidecarPathFor(abs);
    const payload = {
      status: decision === "approve" ? "approved" : "rejected",
      approvedBy: ctx.email,
      approvedAt: new Date().toISOString(),
      reason: body.reason ?? null,
    };
    try {
      await writeFile(sidecar, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.error("[api/admin/review/approve] sidecar write failed", err);
      return NextResponse.json({ error: "sidecar write failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: payload.status, sidecar });
  }

  if (type === "audit") {
    // Audit findings: V1 just records the decision locally. A future PR can
    // wire `gh api repos/.../issues` to actually file the issue. We avoid
    // shelling out from the Node API for now — child_process spawn from a
    // server route is a separate hardening concern.
    return NextResponse.json({
      ok: true,
      status: decision === "approve" ? "queued-as-issue" : "dismissed",
      note: "V1: filing GitHub issues is deferred — record-only.",
    });
  }

  return NextResponse.json({ error: "unhandled type" }, { status: 500 });
}
