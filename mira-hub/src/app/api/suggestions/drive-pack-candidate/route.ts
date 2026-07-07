import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  candidateToSuggestion,
  insertDrivePackSuggestion,
  InvalidCandidateError,
} from "@/lib/drive-pack-suggestion";

export const dynamic = "force-dynamic";

/**
 * POST /api/suggestions/drive-pack-candidate — ingest a drive-pack update
 * candidate (produced by `mira-crawler/drive_pack_bridge.py`) into the Hub
 * `ai_suggestions` review queue as a `drive_pack_update` suggestion (mig 062).
 *
 * Body: the candidate record JSON (build_candidate_record) — at minimum
 * { registry_manual_id, pdf_sha256, change_state, manual_source?, next_step? }.
 *
 * Creating a proposal is a normal authenticated action (mirrors the PLC-import
 * `commit=true` path — any session may propose; only an admin may *decide* it
 * at /api/suggestions/[id]/decide). Idempotent on (manual_id, pdf_sha256).
 *
 * This does NOT extract, grade, or promote a pack — see
 * `.claude/rules/train-before-deploy.md` and `src/lib/drive-pack-suggestion.ts`.
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "candidate record must be an object" }, { status: 400 });
  }

  let suggestion;
  try {
    suggestion = candidateToSuggestion(body as Record<string, unknown>);
  } catch (err) {
    if (err instanceof InvalidCandidateError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const { id, created } = await insertDrivePackSuggestion(ctx.tenantId, suggestion);
    return NextResponse.json({ ok: true, id, created });
  } catch (err) {
    console.error("[api/suggestions/drive-pack-candidate POST]", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
