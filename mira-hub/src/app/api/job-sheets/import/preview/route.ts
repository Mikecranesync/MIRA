/**
 * POST /api/job-sheets/import/preview — parse pasted spreadsheet text into
 *      an `ImportPreview` (TASK-S4). Writes NOTHING: the preview is the
 *      technician's chance to see every field and warning before anything
 *      is saved (a separate POST to /api/job-sheets or its /revisions route
 *      does the actual save, with its own clientRequestId).
 *
 * Body: { text: string, layout?: "auto" | "five_tab" | "job_card" }.
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { parseJobSheetText } from "@/capabilities/living-sheet/job-sheet-import";

const DISABLED = { error: "living_sheet_disabled" };
const ALLOWED_LAYOUTS = ["auto", "five_tab", "job_card"] as const;

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { text, layout } = raw as { text?: unknown; layout?: unknown };
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "invalid_text", field: "text" }, { status: 400 });
  }
  if (layout !== undefined && !(ALLOWED_LAYOUTS as readonly string[]).includes(layout as string)) {
    return NextResponse.json({ error: "invalid_layout", field: "layout" }, { status: 400 });
  }

  const preview = parseJobSheetText(text, layout === undefined ? {} : { layout: layout as "auto" | "five_tab" | "job_card" });
  return NextResponse.json(preview);
}
