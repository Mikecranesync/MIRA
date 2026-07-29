/**
 * Machine-context intelligence — PURE, no DB, no framework imports.
 *
 * The deterministic reasoning layer of the "machine context packet" (see
 * docs/discovery/machine_memory_intelligence_bridge.md). It turns the ALREADY
 * assembled machine-memory response (decoded live tags + freshness-aware
 * current state + persisted run_diff anomalies) into a normalized
 * inferred-condition view:
 *   - `active_conditions`  — the persisted typed anomalies, normalized.
 *   - `changed_recently`   — tag paths that changed within a recent window.
 *   - `summary`            — one deterministic sentence a technician (or MIRA)
 *                            can reason from, e.g. "VFD healthy but stopped".
 *
 * IMPORTANT: this does NOT re-implement the A0–A12 rule engine
 * (plc/conv_simple_anomaly/rules_core.py). `active_conditions` are the OUTPUT of
 * that engine already persisted in run_diff; the summary only COMPOSES decoded
 * live-tag values + current_state + the presence/absence of those conditions.
 * Keeping this a pure function (injected `nowMs`, no imports with side effects)
 * means it unit-tests without the Hub toolchain — same pattern as
 * command-center-freshness.ts / machine-current-state.ts.
 */

import type { LiveTag, LatestDiff } from "./machine-memory-response";
import type { CurrentState } from "./machine-current-state";

/** A persisted typed anomaly (run_diff), normalized for the packet. */
export interface ActiveCondition {
  /** Rule id when the diff is a typed anomaly (e.g. "A2_VFD_FAULT"), else null. */
  rule_id: string | null;
  severity: "info" | "warning" | "critical";
  /** Short human title derived from the diff type + tag. */
  title: string;
  tag_path: string;
  /** The recommended next check carried on the anomaly, if any. */
  next_check: string | null;
}

export interface ContextIntelligence {
  /** One deterministic, evidence-referencing sentence. */
  summary: string;
  /** Normalized persisted anomalies, most-severe first. */
  active_conditions: ActiveCondition[];
  /** Tag paths whose value changed within `recentChangeWindowS`. */
  changed_recently: string[];
}

export interface IntelligenceInput {
  machine_state: CurrentState | null;
  live_tags: LiveTag[];
  latest_diffs: LatestDiff[];
  nowMs: number;
  /** Window for "changed recently" (default 120 s). */
  recentChangeWindowS?: number;
}

const DEFAULT_RECENT_CHANGE_WINDOW_S = 120;
const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

function leafName(tagPath: string): string {
  const s = String(tagPath);
  const i = s.lastIndexOf("/");
  return (i >= 0 ? s.slice(i + 1) : s).toLowerCase();
}

/** "anomaly_A2_VFD_FAULT" -> "A2_VFD_FAULT"; plain diff types -> null. */
function ruleIdFromDiffType(diffType: string | null): string | null {
  if (!diffType) return null;
  return diffType.startsWith("anomaly_") ? diffType.slice("anomaly_".length) : null;
}

/** A readable title from the diff type + tag leaf, no rule catalog needed. */
function conditionTitle(diffType: string | null, tagPath: string): string {
  const leaf = leafName(tagPath);
  const ruleId = ruleIdFromDiffType(diffType);
  if (ruleId) {
    // "A2_VFD_FAULT" -> "vfd fault" (drop the leading rule index, humanize).
    const words = ruleId.replace(/^A\d+_/, "").replace(/_/g, " ").toLowerCase().trim();
    return words ? `${words} on ${leaf}` : `anomaly on ${leaf}`;
  }
  const kind = (diffType ?? "deviation").replace(/_/g, " ");
  return `${kind} on ${leaf}`;
}

function toMs(t: string | null | undefined): number | null {
  if (!t) return null;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Find a live tag by its leaf name (e.g. "vfd_fault_code"). */
function tagByLeaf(liveTags: LiveTag[], leaf: string): LiveTag | undefined {
  return liveTags.find((t) => leafName(t.tag_path) === leaf);
}

const STOPPED_STATES = new Set(["idle", "stopped"]);

/**
 * Decode the VFD's health from the already-formatted live tags. Returns
 * `null` for each fact we can't observe (never guesses — honest absence).
 */
function readVfdHealth(liveTags: LiveTag[]): {
  commsLive: boolean | null;
  faultOk: boolean | null;
  dcBus: LiveTag | undefined;
  freq: LiveTag | undefined;
  cmd: LiveTag | undefined;
  healthy: boolean;
  reasons: string[];
} {
  const fault = tagByLeaf(liveTags, "vfd_fault_code");
  const status = tagByLeaf(liveTags, "vfd_status_word");
  const dcBus = tagByLeaf(liveTags, "vfd_dc_bus") ?? tagByLeaf(liveTags, "vfd_dcbus_v");
  const freq = tagByLeaf(liveTags, "vfd_frequency") ?? tagByLeaf(liveTags, "vfd_hz");
  const cmd = tagByLeaf(liveTags, "vfd_cmd_word");

  // fault OK: formatTagValue renders vfd_fault_code as "OK" when the raw code is 0.
  const faultOk = fault ? fault.display === "OK" || fault.numeric === 0 : null;
  // comms live: prefer the status word's comms bit if present, else the tag's
  // freshness (a live fault/status tag implies the drive is reporting).
  let commsLive: boolean | null = null;
  if (status) commsLive = status.freshness === "live" && /comms/.test(status.display ?? "");
  else if (fault) commsLive = fault.freshness === "live";
  // DC bus present: a positive engineering-unit numeric.
  const dcBusPresent = dcBus && dcBus.numeric != null ? dcBus.numeric > 50 : null;

  const reasons: string[] = [];
  if (faultOk === false) reasons.push("a VFD fault is present");
  if (commsLive === false) reasons.push("VFD comms are not confirmed live");
  if (dcBusPresent === false) reasons.push("DC bus is low/absent");

  const healthy = faultOk === true && commsLive !== false && dcBusPresent !== false;
  return { commsLive, faultOk, dcBus, freq, cmd, healthy, reasons };
}

function vfdEvidencePhrase(v: ReturnType<typeof readVfdHealth>): string {
  const parts: string[] = [];
  if (v.commsLive === true) parts.push("comms OK");
  if (v.faultOk === true) parts.push("fault OK");
  if (v.dcBus?.display && v.dcBus.display !== "—") parts.push(`DC bus ${v.dcBus.display}`);
  if (v.freq?.display && v.freq.display !== "—") parts.push(`output ${v.freq.display}`);
  return parts.join(", ");
}

/**
 * Derive the normalized intelligence view. Deterministic given its inputs.
 */
export function deriveContextIntelligence(input: IntelligenceInput): ContextIntelligence {
  const {
    machine_state,
    live_tags,
    latest_diffs,
    nowMs,
    recentChangeWindowS = DEFAULT_RECENT_CHANGE_WINDOW_S,
  } = input;

  // 1. Normalize persisted anomalies, most-severe first.
  const active_conditions: ActiveCondition[] = latest_diffs
    .map((d) => ({
      rule_id: ruleIdFromDiffType(d.diff_type),
      severity: d.severity,
      title: conditionTitle(d.diff_type, d.tag_path),
      tag_path: d.tag_path,
      next_check: d.next_check,
    }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  // 2. Tags that changed within the recent window (live tags only — a stale
  //    tag's old change is not "recent").
  const changed_recently: string[] = live_tags
    .filter((t) => {
      if (t.freshness !== "live") return false;
      const changed = toMs(t.last_changed_at);
      return changed != null && nowMs - changed <= recentChangeWindowS * 1000;
    })
    .map((t) => t.tag_path);

  // 3. Deterministic summary.
  const summary = buildSummary(machine_state, live_tags, active_conditions);

  return { summary, active_conditions, changed_recently };
}

function buildSummary(
  machine_state: CurrentState | null,
  live_tags: LiveTag[],
  active_conditions: ActiveCondition[],
): string {
  // (a) An active fault/warning dominates — lead with it + its next check.
  const top = active_conditions[0];
  if (top && (top.severity === "critical" || top.severity === "warning")) {
    const word = top.severity === "critical" ? "Active fault" : "Warning";
    const next = top.next_check ? ` Next: ${top.next_check}` : "";
    return `${word}: ${top.title}.${next}`;
  }

  const state = machine_state?.state ?? "unknown";
  const fresh = machine_state?.fresh ?? false;

  // (b) Signals stale / comms down — can't confirm state from live data.
  if (state === "comm_down" || (!fresh && (state === "unknown" || machine_state === null))) {
    return "Signals are stale — the collector or PLC comms may be down; the current machine state cannot be confirmed from live data.";
  }

  const vfd = readVfdHealth(live_tags);
  const evidence = vfdEvidencePhrase(vfd);

  // (c) Stopped/idle — the "VFD healthy but stopped" case the packet exists for.
  if (STOPPED_STATES.has(state)) {
    if (vfd.healthy && evidence) {
      return `Machine ${state}; no active fault detected — the VFD looks healthy (${evidence}). The stop is most likely a command/permissive/interlock, not a drive problem. Next: check operator command, run permissive, E-stop/interlock, and PLC logic.`;
    }
    if (vfd.reasons.length) {
      return `Machine ${state}; no historized anomaly, but drive health is unconfirmed (${vfd.reasons.join("; ")}). Check the VFD comms, fault code, and DC bus before assuming a command issue.`;
    }
    return `Machine ${state}; no active anomalies on the latest diffs. Not enough decoded VFD evidence to isolate the cause — confirm comms, fault code, and DC bus.`;
  }

  // (d) Running.
  if (state === "running") {
    return evidence
      ? `Machine running; ${evidence}. No active anomalies.`
      : "Machine running; no active anomalies on the latest diffs.";
  }

  // (e) Faulted per state window but no typed anomaly surfaced.
  if (state === "faulted") {
    return "State window reports faulted, but no typed anomaly is on the latest diffs — review the fault-window evidence (tag_events around the transition).";
  }

  // (f) Fallback.
  return "Not enough live evidence to determine the machine state — no current window and no active anomalies.";
}
