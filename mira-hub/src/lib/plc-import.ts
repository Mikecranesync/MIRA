import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";
import { plcReportToSuggestions, insertPlcSuggestions } from "@/lib/plc-proposals";

function isTruthy(v: FormDataEntryValue | null): boolean {
  return ["1", "true", "yes", "on"].includes(((v as string | null) ?? "").trim().toLowerCase());
}

// Parsing is fast + deterministic (stdlib-only), so a generous-but-bounded ceiling is plenty.
const PLC_PARSE_TIMEOUT_MS = 30_000;

// The four UNS levels the parser cannot read from a PLC export (plant context). Forwarded as
// optional overrides; the sidecar seeds sensible defaults (line = controller name) when omitted.
const UNS_LEVELS = ["enterprise", "site", "area", "line"] as const;

/** Resolve the mira-ingest base URL, or throw a legible error (mirrors mira-ingest-client). */
function ingestBase(): string {
  const base = process.env.INGEST_URL;
  if (!base) throw new Error("INGEST_URL not set");
  if (base.startsWith("disabled://")) {
    throw new Error(
      "PLC parsing is disabled in this environment (no ingest service). Use production instead.",
    );
  }
  return base;
}

/**
 * Forward an uploaded PLC program export (L5X / vendor tag CSV) to mira-ingest's
 * `POST /ingest/plc-parse`, which runs the stdlib-only parser and returns
 * `{report, i3x?}` — the report carries proposed UNS candidates (one ISA-95 path per tag).
 *
 * By default (PR-B) the handler passes the sidecar's status + body straight through so the parser
 * stays the single authority:
 *   200  parsed     ·  422  closed/binary project (body.detail = export guidance) / unsupported
 *   413  too large  ·  503  parser not wired into the ingest image yet
 *
 * When the multipart carries `commit=true` (PR-C) AND the parse succeeds, the report's proposed UNS
 * candidates are written to `ai_suggestions` (status `pending`) for `tenantId`, so they surface in
 * the `/proposals` review queue. The response then also carries `committed`, `proposalsCreated`, and
 * `suggestionIds`. Nothing is ever auto-verified — approval is a separate human action.
 */
export async function handlePlcImport(req: NextRequest, tenantId: string): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("[plc-import] formData parse failed", {
      contentLength: req.headers.get("content-length"),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_field_required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "exceeds_size_limit", got: file.size, limitMb: MAX_UPLOAD_MB },
      { status: 400 },
    );
  }
  // Deliberately NO file-type allowlist here: a closed/binary project file (.ACD/.s7p/.project)
  // must reach the parser so its actionable "export to L5X / PLCopen XML" guidance (422) flows
  // back to the user. The parser's detect() is the authority on what is parseable.

  let base: string;
  try {
    base = ingestBase();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }

  const out = new FormData();
  out.append("file", file, file.name);
  out.append("filename", file.name);
  for (const level of UNS_LEVELS) {
    const v = (form.get(level) as string | null)?.trim();
    if (v) out.append(level, v);
  }
  const includeI3x = (form.get("include_i3x") as string | null)?.trim();
  if (includeI3x) out.append("include_i3x", includeI3x);

  let res: Response;
  try {
    res = await fetch(`${base}/ingest/plc-parse`, {
      method: "POST",
      body: out,
      signal: AbortSignal.timeout(PLC_PARSE_TIMEOUT_MS),
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "TimeoutError"
        ? `timeout: mira-ingest plc-parse (${PLC_PARSE_TIMEOUT_MS}ms)`
        : `mira-ingest unreachable: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const body = await res.json().catch(() => ({}));

  // PR-C: on a successful parse with commit=true, persist the proposals to the /proposals queue.
  // Any other status (422/413/503) is passed straight through — there is nothing to commit.
  if (res.ok && isTruthy(form.get("commit"))) {
    const report = (body as { report?: unknown }).report;
    try {
      const rows = plcReportToSuggestions(report as Parameters<typeof plcReportToSuggestions>[0]);
      const suggestionIds = await insertPlcSuggestions(tenantId, rows);
      return NextResponse.json(
        { ...body, committed: true, proposalsCreated: suggestionIds.length, suggestionIds },
        { status: 200 },
      );
    } catch (err) {
      // The parse succeeded; only the DB write failed. Return the report + a non-fatal commit error
      // so the caller still gets the analysis and can retry the commit.
      console.error("[plc-import] proposal commit failed", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { ...body, committed: false, commitError: "proposal_write_failed" },
        { status: 200 },
      );
    }
  }

  // Pass the parser's status + body straight through — the Hub adds no semantics of its own here.
  return NextResponse.json(body, { status: res.status });
}
