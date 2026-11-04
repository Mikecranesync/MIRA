/**
 * GET /api/living-sheet/shift-report?from=<ISO>&to=<ISO> — the lead's
 * end-of-shift report (S6): every Living Work Sheet event across this
 * tenant's notebooks in the window, as plain-English lines
 * (capabilities/living-sheet/shift-report.ts).
 *
 * `from`/`to` default to the last 12 hours when omitted. The window is
 * capped at 7 days (`from` to `to`) — a wider request is a 400, not a slow
 * query. Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404, same as every other Living
 * Work Sheet route.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { listJobsActiveBetween, livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { shiftReport } from "@/capabilities/living-sheet/shift-report";

const DISABLED = { error: "living_sheet_disabled" };
const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const now = Date.now();
  const toMs = toParam === null ? now : Date.parse(toParam);
  const fromMs = fromParam === null ? toMs - DEFAULT_WINDOW_MS : Date.parse(fromParam);

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return NextResponse.json({ error: "invalid_window" }, { status: 400 });
  }
  if (toMs < fromMs) {
    return NextResponse.json({ error: "invalid_window", message: "`to` must not be before `from`." }, { status: 400 });
  }
  if (toMs - fromMs > MAX_WINDOW_MS) {
    return NextResponse.json({ error: "window_too_wide", message: "The window cannot exceed 7 days." }, { status: 400 });
  }

  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();

  try {
    const jobs = await listJobsActiveBetween(ctx.tenantId, from, to);
    const report = shiftReport(jobs, { from, to });
    return NextResponse.json({ report });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}
