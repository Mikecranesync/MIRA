/**
 * Canonical anomaly catalog — PURE, no DB, no framework imports.
 *
 * The ONE place a persisted `run_diff` anomaly (`diff_type='anomaly_<RULE_ID>'`)
 * is turned into a technician-facing title. Mirrors the titles the rule engine
 * itself emits (plc/conv_simple_anomaly/rules_core.py — the vendored A0–A12
 * brain historized by mira-crawler/run_engine/machine_memory.py). The known
 * set is A0–A10 plus A12; there is NO A11.
 *
 * Resolution order (PRD §9.2 — no one-off `_stale_s` string replacements):
 *   1. a KNOWN rule id → the catalog title, always. Persisted metadata can
 *      never override it (a row's `metadata.title` is additive producer
 *      context for historical readers, not an authority).
 *   2. an UNKNOWN anomaly rule → the sanitized persisted title when one exists,
 *      else the humanized rule words (+ the humanized tag leaf when the leaf
 *      is a real tag, never an internal pseudo-topic).
 *   3. a non-anomaly diff → "<kind> on <leaf>", deterministically.
 *
 * Internal fragments — `_stale_s` and other `_`-prefixed pseudo-topics,
 * `[default]` provider prefixes, raw `enterprise.…` UNS paths — never enter a
 * title on any branch.
 */

export const ANOMALY_CATALOG: Readonly<Record<string, string>> = Object.freeze({
  A0_OFFLINE: "PLC/bridge offline",
  A1_COMM_STALE: "GS10 RS-485 link down",
  A2_VFD_FAULT: "GS10 drive fault active",
  A3_ESTOP_WIRING: "E-stop wiring fault",
  A4_DIRECTION_FAULT: "Direction fault",
  A5_ILLEGAL_RUN: "Belt running while not permitted",
  A6_DRIVE_NOT_RESPONDING: "Drive not responding to RUN",
  A7_FREQ_NOT_TRACKING: "Output Hz not tracking setpoint",
  A8_OVERCURRENT: "VFD output over motor FLA",
  A9_DC_BUS: "DC bus voltage out of range",
  A10_FREQ_STUCK_ZERO: "Output frequency stuck at zero",
  A12_PHOTOEYE_JAM: "Photo-eye soft-stop (jam/blockage)",
});

const ANOMALY_PREFIX = "anomaly_";
const MAX_TITLE_LENGTH = 120;

/** Anything that reads as an internal identifier rather than a label. */
const INTERNAL_FRAGMENT = /(^|[\s/.])_[a-z0-9_]*|\[default\]|\benterprise\.[a-z0-9_.]+/i;

/** "anomaly_A2_VFD_FAULT" -> "A2_VFD_FAULT"; plain diff types -> null. */
export function ruleIdFromDiffType(diffType: string | null | undefined): string | null {
  if (!diffType) return null;
  return diffType.startsWith(ANOMALY_PREFIX) ? diffType.slice(ANOMALY_PREFIX.length) : null;
}

export function isKnownAnomalyRule(ruleId: string | null | undefined): boolean {
  return ruleId != null && Object.prototype.hasOwnProperty.call(ANOMALY_CATALOG, ruleId);
}

/** Last path segment of a tag path, or null when it is an internal pseudo-topic. */
function tagLeaf(tagPath: string): string | null {
  const s = String(tagPath ?? "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("."));
  const leaf = (i >= 0 ? s.slice(i + 1) : s).trim();
  if (!leaf || leaf.startsWith("_") || leaf.startsWith("[")) return null;
  return leaf;
}

function humanizeToken(token: string): string {
  return token.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Collapse whitespace, cap length, and refuse anything internal-looking. */
function sanitizePersistedTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || INTERNAL_FRAGMENT.test(t)) return null;
  return t.length > MAX_TITLE_LENGTH ? `${t.slice(0, MAX_TITLE_LENGTH - 1)}…` : t;
}

/**
 * Resolve the technician-facing title for one persisted diff.
 *
 * @param ruleId        "A0_OFFLINE" etc. (from `ruleIdFromDiffType`), or null
 *                      for a plain (non-anomaly) diff; a plain diff type such
 *                      as "baseline_deviation" may also be passed as the
 *                      `fallbackKind` via `canonicalDiffTitle`.
 * @param fallbackTagPath the row's tag_path — only its humanized leaf is ever
 *                      used, and never when it is an internal pseudo-topic.
 * @param persistedTitle the row's `metadata.title`, honoured ONLY for unknown
 *                      rules and only after sanitization.
 */
export function canonicalAnomalyTitle(
  ruleId: string | null,
  fallbackTagPath: string,
  persistedTitle?: string | null,
): string {
  if (ruleId && isKnownAnomalyRule(ruleId)) return ANOMALY_CATALOG[ruleId];
  const leaf = tagLeaf(fallbackTagPath);
  if (ruleId) {
    const persisted = sanitizePersistedTitle(persistedTitle);
    if (persisted) return persisted;
    const words = humanizeToken(ruleId.replace(/^A\d+_/, ""));
    const head = words || "anomaly";
    return leaf ? `${head} on ${humanizeToken(leaf)}` : head;
  }
  return leaf ? `deviation on ${humanizeToken(leaf)}` : "deviation";
}

/**
 * Title for any `run_diff` row from its raw `diff_type`: anomalies go through
 * `canonicalAnomalyTitle`; plain diff kinds degrade to "<kind> on <leaf>".
 */
export function canonicalDiffTitle(
  diffType: string | null | undefined,
  tagPath: string,
  persistedTitle?: string | null,
): string {
  const ruleId = ruleIdFromDiffType(diffType);
  if (ruleId) return canonicalAnomalyTitle(ruleId, tagPath, persistedTitle);
  const safeKind = sanitizePersistedTitle(diffType);
  const kind = safeKind ? humanizeToken(safeKind) : "deviation";
  const leaf = tagLeaf(tagPath);
  return leaf ? `${kind} on ${humanizeToken(leaf)}` : kind;
}
