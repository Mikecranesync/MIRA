import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/config";

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
 * PR-B scope: parse + return only. No DB writes, no `ai_suggestions` (that is PR-C). The handler
 * passes the sidecar's status + body straight through so the parser stays the single authority:
 *   200  parsed
 *   422  closed/binary project (body.detail = actionable export guidance) OR unsupported format
 *   413  too large
 *   503  parser not wired into the ingest image yet
 */
export async function handlePlcImport(req: NextRequest): Promise<NextResponse> {
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
  // Pass the parser's status + body straight through — the Hub adds no semantics of its own here.
  return NextResponse.json(body, { status: res.status });
}
