/**
 * Pure view-model for the PLC-import wizard (`/plc-import`).
 *
 * Turns the raw `POST /api/connectors/plc/import` response (the mira-plc-parser `report@1` shape,
 * forwarded from the mira-ingest sidecar) into a small, render-ready discriminated union. Kept
 * deterministic + side-effect-free so the page stays thin and this logic is unit-testable without a
 * DB, a browser, or the running app (the page itself is covered by e2e on the real Hub).
 *
 * Read-only by construction: this only *describes* what the parser found — it never writes.
 */

export type PlcConfidence = "high" | "medium" | "low" | string;

export interface PlcCandidate {
  tag: string;
  dataType: string;
  /** Proposed ISA-95 UNS path, slash-joined (enterprise/site/area/line/asset/signal). */
  path: string;
  signal: string;
  asset: string;
  standardized: boolean;
  confidence: PlcConfidence;
  evidence: string;
}

export interface PlcCounts {
  tags: number;
  programs: number;
  routines: number;
  faultCandidates: number;
  assetCandidates: number;
  vfdSignalCandidates: number;
  reviewRequired: number;
  unsCandidates: number;
}

export interface PlcReviewItem {
  name: string;
  detail: string;
}

/** Parsed OK — the meaty state: counts + proposed UNS paths to review. */
export interface PlcParsedView {
  kind: "parsed";
  controller: string;
  vendor: string;
  fmt: string;
  detectionConfidence: string;
  counts: PlcCounts;
  candidates: PlcCandidate[];
  reviewRequired: PlcReviewItem[];
  warnings: string[];
}

/** A closed/binary vendor PROJECT file — the parser can't read it; show the export steps. */
export interface PlcExportNeededView {
  kind: "export_needed";
  fmt: string;
  guidance: string;
}

/** Unsupported / too large / sidecar problem — a friendly, actionable message. */
export interface PlcUnsupportedView {
  kind: "unsupported";
  reason: string;
}

export type PlcImportView = PlcParsedView | PlcExportNeededView | PlcUnsupportedView;

type Json = Record<string, unknown>;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Three confidence bands → a UI tone key (the parser emits high/medium/low). */
export function confidenceTone(c: PlcConfidence): "high" | "medium" | "low" {
  const k = (c || "").toLowerCase();
  return k === "high" ? "high" : k === "low" ? "low" : "medium";
}

function candidatesFrom(report: Json): PlcCandidate[] {
  const raw = Array.isArray(report.uns_candidates) ? (report.uns_candidates as Json[]) : [];
  return raw.map((c) => ({
    tag: str(c.tag),
    dataType: str(c.data_type),
    path: str(c.path),
    signal: str(c.signal),
    asset: str(c.asset),
    standardized: Boolean(c.standardized),
    confidence: str(c.confidence, "medium"),
    evidence: str(c.evidence),
  }));
}

function countsFrom(report: Json): PlcCounts {
  const c = (report.counts as Json) ?? {};
  return {
    tags: num(c.tags),
    programs: num(c.programs),
    routines: num(c.routines),
    faultCandidates: num(c.fault_candidates),
    assetCandidates: num(c.asset_candidates),
    vfdSignalCandidates: num(c.vfd_signal_candidates),
    reviewRequired: num(c.review_required),
    unsCandidates: num(c.uns_candidates),
  };
}

/**
 * Map an import response to a render-ready view. `status` is the HTTP status; `body` is the parsed
 * JSON (the sidecar `{report, ...}` envelope, or an error shape). Never throws.
 */
export function viewFromImportResponse(status: number, body: unknown): PlcImportView {
  const env = (body as Json) ?? {};
  const report = (env.report as Json) ?? env; // sidecar wraps under `report`; tolerate either
  const detection = (report.detection as Json) ?? {};
  const fmt = str(detection.fmt) || str(env.fmt) || "unknown";

  // A closed/binary vendor project → the parser returns actionable export guidance, not a parse.
  const needsExport = str(detection.needs_export) || str(env.detail);
  if (status === 422 || report.handled === false) {
    if (needsExport) return { kind: "export_needed", fmt, guidance: needsExport };
    const warnings = Array.isArray(report.warnings) ? (report.warnings as string[]) : [];
    return { kind: "unsupported", reason: warnings[0] || str(env.error) || "Unsupported or unrecognized file." };
  }

  if (status === 413) {
    return { kind: "unsupported", reason: "That file is over the upload size limit. Export a smaller program or a tag CSV." };
  }
  if (status === 503) {
    return { kind: "unsupported", reason: "The PLC parsing service isn't available in this environment yet." };
  }
  if (status < 200 || status >= 300 || report.handled !== true) {
    return { kind: "unsupported", reason: str(env.error) || str(env.detail) || `Import failed (HTTP ${status}).` };
  }

  return {
    kind: "parsed",
    controller: str(report.controller) || "(unnamed controller)",
    vendor: str(report.vendor) || "unknown",
    fmt,
    detectionConfidence: str(detection.confidence) || "medium",
    counts: countsFrom(report),
    candidates: candidatesFrom(report),
    reviewRequired: (Array.isArray(report.review_required) ? (report.review_required as Json[]) : []).map((f) => ({
      name: str(f.name),
      detail: str(f.detail),
    })),
    warnings: Array.isArray(report.warnings) ? (report.warnings as string[]) : [],
  };
}

/** Pull the committed-proposal count out of a commit response (`commit=true`). */
export function proposalsCreated(body: unknown): number | null {
  const env = (body as Json) ?? {};
  if (env.committed === true) return num(env.proposalsCreated);
  return null;
}
