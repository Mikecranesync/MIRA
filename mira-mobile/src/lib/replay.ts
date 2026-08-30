/**
 * Sensor REPLAY — pure helpers for the Machine Memory timeline (contract §4.3,
 * §4.4, §4.5, decisions D1/D2/D5).
 *
 * Machine Memory owns replay (§2.5): the phone renders what the Hub's
 * `/api/assets/[id]/history` returns and never synthesizes a row. Honesty
 * rules encoded here:
 *   • every row carries BOTH clocks (`event_timestamp`, `ingested_at`); when
 *     they diverge the divergence is rendered — it is the replay signature (D2)
 *   • stale / simulated / unknown is never presented as live: the freshness
 *     label vocabulary is the Hub's (ported constants, cited below) and the
 *     "Live unavailable" banner shows for anything that is not `live`
 *   • no rows / no fault window / tables unavailable are three distinct empty
 *     states, none of which invents a timeline
 */
import { hhmmss } from "./sensor";

/** One recorded observation. `kind` = "event" (a `tag_events` sample) | "diff"
 *  (a `tag_event_diffs` row). Only a "diff" is guaranteed to be a change —
 *  which is why the row count is never called a count of changes. */
export interface HistoryRow {
  event_timestamp: string;
  ingested_at: string;
  uns_path: string;
  tag: string;
  value: string | number | boolean | null;
  prev_value?: string | number | boolean | null;
  quality: string | null;
  kind: "event" | "diff";
}

export type Freshness = "live" | "stale" | "simulated" | "unknown";

/** Mirrors mira-hub/src/lib/machine-context-packet.ts FreshnessSummary. */
export interface FreshnessSummary {
  overall: Freshness;
  live: number;
  stale: number;
  simulated: number;
  unknown: number;
}

export interface HistoryAnchor {
  at: string;
  source: "state_window" | "explicit";
  windowId?: string | null;
  runId?: string | null;
}

/** Mirrors mira-hub/src/lib/machine-history.ts CurrentConnection (PRD §9.2):
 *  what the asset's CURRENT signal cache says now. A fact about the
 *  connection, never about the replayed window. */
export interface CurrentConnection {
  freshness: FreshnessSummary;
}

/** Mirrors mira-hub/src/lib/machine-history.ts HistoricalCoverage (PRD §9.2):
 *  what the served window actually covered. `available:false` means the
 *  history tables were missing and `observationCount` is null — nothing could
 *  be counted. A valid quiet window is `available:true` + `observationCount:0`.
 *  The two are never collapsed into one another. */
export interface HistoricalCoverage {
  available: boolean;
  observationCount: number | null;
  from: string;
  to: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export interface AssetHistory {
  anchor: HistoryAnchor;
  rows: HistoryRow[];
  /** @deprecated compatibility alias for `currentConnection.freshness`. */
  freshness: FreshnessSummary;
  currentConnection: CurrentConnection;
  historicalCoverage: HistoricalCoverage;
  /** MachineMemoryResponse-shaped header; only `summary` is read here. */
  summary: { summary?: string | null; uns_path?: string | null } & Record<string, unknown>;
  provenance: "machine_memory";
  /** Server degradation (§4.3): the tables are missing, not merely empty. */
  reason?: "unavailable" | null;
  /** The window the SERVER actually fetched (`window:{from,to,pre,post}` on the
   *  wire) — not the one the client asked for. The server clamps to §4.3's
   *  120 s cap, so echoing the request would misname both the timeline header
   *  and the window Ask MIRA is handed. */
  pre: number;
  post: number;
  /** Absolute bounds of that same fetched window, when the server names them. */
  from?: string | null;
  to?: string | null;
}

export type HistoryResult =
  | { ok: true; history: AssetHistory }
  /** 404 `no_fault_window`: no faulted/estopped window to anchor on — never a
   *  synthesized one. `windowsAvailable=false` means the state-window table
   *  itself is absent in this environment (a different sentence). */
  | {
      ok: false;
      reason: "no_fault_window";
      windowsAvailable: boolean;
      latest: { state: string; at: string } | null;
    }
  /** 404 `no_uns_path`: the asset has no machine memory at all. */
  | { ok: false; reason: "no_uns_path" };

/**
 * Freshness label vocabulary — PORTED from
 * `mira-hub/src/app/(hub)/command-center/page.tsx` (FRESHNESS_LABEL /
 * FRESHNESS_TITLE, lines ~506-518). One freshness model across surfaces:
 * the phone never re-derives freshness, it labels the Hub's roll-up.
 */
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: "Live",
  stale: "Stale",
  simulated: "Simulated",
  unknown: "No tags",
};

export const FRESHNESS_TITLE: Record<Freshness, string> = {
  live: "Live telemetry — a mapped tag updated within its freshness window",
  stale: "Stale — mapped tags exist but none updated recently",
  simulated: "Simulated data only — no real telemetry for this asset",
  unknown: "No mapped tags under this node",
};

export const LIVE_UNAVAILABLE_BANNER = "Live unavailable — showing recorded history";

/** Stale, simulated, and unknown all mean "not live". Only `live` is live. */
export function liveUnavailable(freshness: Pick<FreshnessSummary, "overall"> | null | undefined): boolean {
  return freshness?.overall !== "live";
}

function ms(t: string | Date): number {
  const v = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return Number.isNaN(v) ? NaN : v;
}

/** "-2.14 s" / "+0.16 s" / "0.00 s" — seconds relative to the anchor, two
 *  decimals, explicit sign either side of the fault. Unparseable → "—". */
export function formatRelativeSeconds(eventTs: string | Date, anchorAt: string | Date): string {
  const d = (ms(eventTs) - ms(anchorAt)) / 1000;
  if (Number.isNaN(d)) return "—";
  const abs = Math.abs(d).toFixed(2);
  if (abs === "0.00") return "0.00 s";
  return `${d < 0 ? "-" : "+"}${abs} s`;
}

/** D2: a divergence between when the machine saw it and when it was ingested
 *  is rendered, never hidden. Report-by-exception freezes event_timestamp
 *  while ingested_at keeps advancing — that gap IS the replay signature. */
export function clocksDiverge(eventTs: string, ingestedAt: string, thresholdMs = 1000): boolean {
  const a = ms(eventTs);
  const b = ms(ingestedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(b - a) > thresholdMs;
}

/** Display value; `prev → value` when the row carries a previous value. */
export function formatValue(v: HistoryRow["value"]): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

/** Last path segment of a tag path — what the technician calls it. */
export function tagShortName(tag: string): string {
  const parts = tag.split(/[./]/).filter(Boolean);
  return parts[parts.length - 1] ?? tag;
}

// --- the window the technician is looking at (S5 D2) -------------------------

/** Client default. The server's own default (5 s / 2 s) is too narrow to
 *  reach a cause that sits seconds before the fault (the S5 e-stop wiring
 *  fault at −7.02 s), so the phone always asks for its window explicitly. */
export const REPLAY_DEFAULT_WINDOW = { pre: 60, post: 10 } as const;

/** Server cap (§4.3): 120 s either side. */
export const REPLAY_WINDOW_CAP = 120;

export interface ReplayWindow {
  pre: number;
  post: number;
}

/** The segmented control in the timeline header. Each press re-fetches. */
export const REPLAY_WINDOW_PRESETS: ReadonlyArray<{ label: string } & ReplayWindow> = [
  { label: "±5 s", pre: 5, post: 5 },
  { label: "60 s", pre: REPLAY_DEFAULT_WINDOW.pre, post: REPLAY_DEFAULT_WINDOW.post },
  { label: "120 s", pre: REPLAY_WINDOW_CAP, post: REPLAY_DEFAULT_WINDOW.post },
];

export function sameWindow(a: ReplayWindow, b: ReplayWindow): boolean {
  return a.pre === b.pre && a.post === b.post;
}

/** "7 recorded observations" / "1 recorded observation" — the ONE phrase for a
 *  row count, shared by the timeline header and the persisted card.
 *
 *  It used to read "observed changes". That overclaimed: `/history` returns
 *  `tag_events` rows (periodic samples of what Machine Memory recorded) as
 *  well as `tag_event_diffs`, so a row is an observation that may or may not
 *  differ from the one before it. Calling every row a "change" told the
 *  technician the machine did something N times when the honest statement is
 *  that N observations were recorded.
 *
 *  Mirrors the hub lane's `machineReplayCaption`
 *  (`mira-hub/src/components/equipment/notebook-chat-utils.ts`, alongside
 *  MACHINE_HISTORY_UNAVAILABLE_CAPTION / MACHINE_NO_CHANGES_CAPTION) so the
 *  two surfaces name the same rows with the same words. */
export function recordedObservations(rowCount: number): string {
  return `${rowCount} recorded observation${rowCount === 1 ? "" : "s"}`;
}

/** "7 recorded observations in −60 s … +10 s" — the header names the window the
 *  rows were fetched for, so what the technician sees and what Ask MIRA sends
 *  are the same numbers. */
export function replayWindowHeader(rowCount: number, w: ReplayWindow): string {
  return `${recordedObservations(rowCount)} in −${w.pre} s … +${w.post} s`;
}

// --- the Ask-MIRA hand-off (§4.4) -------------------------------------------

/** The selected window, sent as `body.machineEvidence`. The server re-fetches
 *  the rows itself and never trusts client rows. */
export interface MachineEvidenceWindow {
  assetId: string;
  anchorAt: string;
  pre: number;
  post: number;
}

export function replayQuestion(anchorAt: string | Date): string {
  return (
    `What happened around the fault at ${hhmmss(anchorAt)}? ` +
    "Walk through the recorded machine changes in order, separate what was observed " +
    "from documentation, history, and inference, and say what I should check next."
  );
}

// --- persisted turns (D5): the {kind:"machine_evidence"} entry in evidence[] ---

export interface MachineEvidenceEntry {
  kind: "machine_evidence";
  assetId: string;
  anchorAt: string;
  pre: number;
  post: number;
  rowCount: number;
  freshness: FreshnessSummary | Freshness | null;
  /** Hub honesty field: the machine-history tables are missing, so `rowCount`
   *  is not a count of "nothing happened" — there was nothing to count. */
  reason?: "unavailable" | null;
  runId?: string | null;
  windowId?: string | null;
}

/** Pull the machine-evidence entries out of a turn's evidence[]. Citations
 *  ({docId,…}) are untouched — they still go through `normalizeCitations`,
 *  which skips anything without a `citationId`, so the two readers are
 *  disjoint by construction. */
export function machineEvidenceEntries(evidence: unknown): MachineEvidenceEntry[] {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "machine_evidence",
    )
    .map((e) => ({
      kind: "machine_evidence" as const,
      assetId: String(e.assetId ?? ""),
      anchorAt: String(e.anchorAt ?? ""),
      pre: Number(e.pre ?? 0),
      post: Number(e.post ?? 0),
      rowCount: Number(e.rowCount ?? 0),
      freshness: (e.freshness as FreshnessSummary | Freshness | null) ?? null,
      reason: e.reason === "unavailable" ? "unavailable" : null,
      runId: e.runId != null ? String(e.runId) : null,
      windowId: e.windowId != null ? String(e.windowId) : null,
    }));
}

function overallOf(f: MachineEvidenceEntry["freshness"]): Freshness | null {
  if (!f) return null;
  if (typeof f === "string") return f in FRESHNESS_LABEL ? (f as Freshness) : null;
  return f.overall in FRESHNESS_LABEL ? f.overall : null;
}

export const REPLAY_CARD_UNAVAILABLE = "Machine history unavailable";
export const REPLAY_CARD_EMPTY = "No machine changes recorded in this window";

/** "Machine Replay · 7 recorded observations around 23:16:31 · Stale" (§4.5) —
 *  but only when there is something to count. Three honest titles, matching the
 *  Hub's `reason` / `rowCount` semantics:
 *    • `reason === "unavailable"` — the machine-history tables are missing, so
 *      neither an observation count nor a freshness label would be a fact.
 *      "0 recorded observations · Stale" would claim the machine was quiet.
 *    • `rowCount === 0` with no reason — the tables answered, and the answer
 *      was "nothing recorded in this window". That IS a finding, so it gets its
 *      own sentence rather than a zero.
 *    • otherwise the count + the Hub's freshness label; a missing freshness is
 *      left out rather than guessed. */
export function replayCardTitle(
  e: Pick<MachineEvidenceEntry, "rowCount" | "anchorAt" | "freshness"> & { reason?: "unavailable" | null },
): string {
  if (e.reason === "unavailable") return REPLAY_CARD_UNAVAILABLE;
  if (e.rowCount === 0) return REPLAY_CARD_EMPTY;
  const overall = overallOf(e.freshness);
  const parts = [
    "Machine Replay",
    `${recordedObservations(e.rowCount)} around ${hhmmss(e.anchorAt)}`,
  ];
  if (overall) parts.push(FRESHNESS_LABEL[overall]);
  return parts.join(" · ");
}

/** Basis caption for the machine-evidence bases (mig 084). Muted, never amber:
 *  amber is reserved for `general_reasoning` (an ungrounded answer). Other
 *  bases return null — a grounded document answer shows its chips instead.
 *
 *  Byte-identical to the hub lane's captions (PR #3461) — trailing period
 *  included — so the same answer reads the same on the phone and in the Hub. */
export function basisCaption(basis: string | null | undefined): string | null {
  switch (basis) {
    case "live_machine_evidence":
      return "Grounded in live machine evidence.";
    case "machine_history":
      return "Grounded in recorded machine history — not live.";
    default:
      return null;
  }
}
