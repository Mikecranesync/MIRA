/**
 * Machine context packet — the normalized "what is this machine doing right now"
 * object that turns live Machine Memory into an INTELLIGENCE INPUT for MIRA.
 * See docs/discovery/machine_memory_intelligence_bridge.md.
 *
 * Deterministic, read-only, no LLM. It is a THIN wrapper:
 *   buildMachineMemoryResponse (existing — resolves uns_path, fetches machine
 *   memory + live signals, decodes tags, derives current_state)
 *     → deriveContextIntelligence (pure — summary + active_conditions +
 *       changed_recently)
 *     → one MachineContextPacket.
 *
 * No new queries, no new tables, no write path. Everything it reads is already
 * read by the Machine Memory card; this only adds the deterministic reasoning
 * layer and a stable shape the Ask-MIRA bridge can ground on.
 */

import {
  buildMachineMemoryResponse,
  type LiveTag,
  type LatestRun,
  type LatestWindow,
  type EvidenceWindow,
  type MachineMemoryResponse,
} from "./machine-memory-response";
import type { MachineMemoryClient } from "./machine-memory";
import type { ActiveCondition } from "./machine-context-intelligence";
import type { CurrentState } from "./machine-current-state";

export type { ActiveCondition } from "./machine-context-intelligence";

export interface FreshnessSummary {
  /** Roll-up: live > stale > simulated > unknown. */
  overall: "live" | "stale" | "simulated" | "unknown";
  live: number;
  stale: number;
  simulated: number;
  unknown: number;
}

/**
 * One recorded machine observation inside a replay window (Sensor S4, contract
 * §4.3/§4.4). Both clocks ride on every row (D2): `event_timestamp` is when the
 * source observed it, `ingested_at` when the Hub received it — a divergence is
 * the replay signature and is never hidden. `quality` is null for
 * `tag_event_diffs` rows, which carry no quality column (037); nothing is
 * invented for it.
 */
export interface ObservedChange {
  kind: "event" | "diff";
  event_timestamp: string;
  ingested_at: string | null;
  tag: string;
  value: string | null;
  prev_value?: string | null;
  quality: string | null;
}

/** The fault-anchored window the packet is replaying (absent on live turns). */
export interface ReplayWindow {
  anchor_at: string;
  started_at: string;
  stopped_at: string;
  /** Roll-up of the asset's CURRENT signals — "stale" means this is history. */
  freshness: FreshnessSummary["overall"];
  rows: ObservedChange[];
}

export interface MachineContextPacket {
  asset_id: string;
  tenant_id: string;
  uns_path: string | null;
  /** True when at least one live tag was found for the asset subtree. */
  has_live_data: boolean;
  /** running / idle / faulted / comm_down / estopped / unknown (+ since/fresh). */
  machine_state: CurrentState | null;
  /** One deterministic, evidence-referencing sentence. */
  summary: string;
  /** Per-tag decoded live values (value + display + unit + freshness). */
  live_tags: LiveTag[];
  /** Persisted typed anomalies (run_diff), normalized, most-severe first. */
  active_conditions: ActiveCondition[];
  /** Tag paths that changed within the recent-change window. */
  changed_recently: string[];
  freshness: FreshnessSummary;
  /** Evidence anchors: the run/window the conclusion is grounded on. */
  evidence: {
    window: EvidenceWindow | null;
    latest_run: LatestRun | null;
    latest_window: LatestWindow | null;
  };
  /** Sensor REPLAY (S4): the selected fault window's recorded observations.
   *  Optional and additive — a packet without it renders byte-identically to
   *  before, so the asset chat route is untouched. */
  replay?: ReplayWindow;
}

/** Cap replay rows in a prompt for the same reason as MAX_LIVE_TAGS_IN_PROMPT. */
export const MAX_REPLAY_ROWS_IN_PROMPT = 40;

/** Format a replay row's offset from the anchor: "-2.14 s", "+0.16 s". */
function offsetLabel(anchorMs: number, ts: string): string {
  const ms = new Date(ts).getTime();
  if (Number.isNaN(ms) || Number.isNaN(anchorMs)) return "?";
  const s = (ms - anchorMs) / 1000;
  return `${s >= 0 ? "+" : "-"}${Math.abs(s).toFixed(2)} s`;
}

/** Cap live-tag lines in a prompt so a chatty asset can't blow the context budget. */
export const MAX_LIVE_TAGS_IN_PROMPT = 10;

/**
 * Render the packet as a citable "Live Machine Evidence" prompt section for
 * Ask MIRA — the bridge that makes live state an intelligence input. PURE, so
 * it unit-tests without a route. `sanitize` is injected by the caller (the chat
 * route passes its prompt-injection scrub); the default is an identity-ish
 * stringifier for tests. Returns "" when there is nothing to say.
 */
export function renderMachineEvidenceSection(
  packet: MachineContextPacket,
  sanitize: (value: unknown) => string = (v) => (v == null ? "" : String(v)),
): string {
  const lines: string[] = [];

  const st = packet.machine_state;
  if (st) {
    const since = st.since ? ` (since ${sanitize(st.since)})` : "";
    lines.push(`- Machine state: ${sanitize(st.state)}${since} — signals ${st.fresh ? "live" : "stale"}`);
  }
  if (packet.summary) {
    lines.push(`- Assessment: ${sanitize(packet.summary)}`);
  }

  const liveTags = packet.live_tags.slice(0, MAX_LIVE_TAGS_IN_PROMPT);
  if (liveTags.length > 0) {
    lines.push("- Live signals (observed now):");
    for (const t of liveTags) {
      const leaf = t.tag_path.split("/").pop() ?? t.tag_path;
      const changed = packet.changed_recently.includes(t.tag_path) ? ", changed recently" : "";
      const shown = t.display ?? (t.value === null ? "—" : String(t.value));
      lines.push(`  - ${sanitize(leaf)}: ${sanitize(shown)} (${t.freshness}${changed})`);
    }
  }

  const conditions = packet.active_conditions.slice(0, 3);
  if (conditions.length > 0) {
    lines.push("- Active conditions:");
    for (const c of conditions) {
      const next = c.next_check ? ` — next check: ${sanitize(c.next_check)}` : "";
      lines.push(`  - [${sanitize(c.severity)}] ${sanitize(c.title)}${next}`);
    }
  }

  const ev = packet.evidence.window;
  if (ev) {
    lines.push(
      `- Evidence window: tag_events ${sanitize(ev.started_at ?? "?")} → ${sanitize(ev.stopped_at ?? "open")}`,
    );
  }

  // Sensor REPLAY (S4): the recorded observations around the fault anchor,
  // chronological, both clocks on every row, quality never invented. The
  // section header says what it is — a replay of history is never presented
  // as the live state (contract §2.8).
  const replay = packet.replay;
  if (replay) {
    const anchorMs = new Date(replay.anchor_at).getTime();
    const rows = replay.rows.slice(0, MAX_REPLAY_ROWS_IN_PROMPT);
    lines.push(
      `- Replayed observations (${replay.rows.length} recorded around ${sanitize(replay.anchor_at)}; window ${sanitize(replay.started_at)} → ${sanitize(replay.stopped_at)}; current signals ${replay.freshness}):`,
    );
    if (rows.length === 0) {
      lines.push("  - (no recorded observations in this window — do not infer any)");
    }
    for (const r of rows) {
      const leaf = r.tag.split("/").pop() ?? r.tag;
      const prev = r.kind === "diff" && r.prev_value != null ? `${sanitize(r.prev_value)} → ` : "";
      const shown = r.value === null ? "—" : sanitize(r.value);
      const q = r.quality ? `, quality ${sanitize(r.quality)}` : "";
      const ingested =
        r.ingested_at && r.ingested_at !== r.event_timestamp ? `, ingested ${sanitize(r.ingested_at)}` : "";
      lines.push(
        `  - ${offsetLabel(anchorMs, r.event_timestamp)} (${sanitize(r.event_timestamp)}${ingested}) ${sanitize(leaf)}: ${prev}${shown} (${r.kind}${q})`,
      );
    }
    if (replay.rows.length > rows.length) {
      lines.push(`  - … ${replay.rows.length - rows.length} more recorded observations not shown`);
    }
  }

  if (lines.length === 0) return "";
  const heading = replay
    ? `## Machine Evidence (replayed history around ${sanitize(replay.anchor_at)})
The following is MACHINE-OBSERVED evidence from this asset's recorded tag history around the selected fault window (chronological recorded observations with both observed and received timestamps, plus the current decoded tag values, freshness-aware state, a deterministic assessment, and anomaly detections). It is a REPLAY of history: describe it as what was observed at those times, never as the current state unless the current signals are marked live. Cite it as "machine memory" when you use it. Never invent an observation that is not listed.
RULES FOR THE RECORDED ROWS: these rows are RECORDED HISTORY, not live — never use the word "live" for them. Every tag value you state must appear verbatim in the recorded rows listed below. If a tag is absent from the window, say it was not recorded in the window; do not infer, estimate, or assume its value (a tag you do not see is NOT zero).`
    : `## Live Machine Evidence (observed now)
The following is MACHINE-OBSERVED evidence from this asset's live tags and history (current decoded tag values, freshness-aware state, a deterministic assessment, and anomaly detections). Treat it as current, citable observations — cite it as "machine memory" when you use it.`;
  return `${heading} In your answer, clearly separate: (1) this ${replay ? "RECORDED" : "LIVE"} evidence, (2) asset/manual context, (3) your inference, and (4) the recommended next checks.

${lines.join("\n")}`;
}

export function summarizeFreshness(liveTags: LiveTag[]): FreshnessSummary {
  let live = 0;
  let stale = 0;
  let simulated = 0;
  let unknown = 0;
  for (const t of liveTags) {
    if (t.freshness === "live") live++;
    else if (t.freshness === "stale") stale++;
    else if (t.freshness === "simulated") simulated++;
    else unknown++;
  }
  const overall = live > 0 ? "live" : stale > 0 ? "stale" : simulated > 0 ? "simulated" : "unknown";
  return { overall, live, stale, simulated, unknown };
}

/**
 * Build the machine context packet for one asset (tenant + id).
 *
 * `client` is a tenant-scoped query client (the `withTenantContext` callback
 * client). `nowMs` is injectable for deterministic tests; defaults to now.
 * Read-only; empty state (no uns_path / no live tags) is first-class.
 */
export async function buildMachineContextPacket(
  client: MachineMemoryClient,
  tenantId: string,
  assetId: string,
  nowMs: number = Date.now(),
): Promise<MachineContextPacket> {
  // buildMachineMemoryResponse is the single compute site for the deterministic
  // intelligence (summary / active_conditions / changed_recently) — shared with
  // the card + SSE stream. The packet just reshapes it; it does not recompute.
  const response = await buildMachineMemoryResponse(client, tenantId, assetId, nowMs);
  return packetFromMachineMemoryResponse(tenantId, assetId, response);
}

/**
 * Pure reshape of an already-built MachineMemoryResponse into a packet — the
 * seam the Sensor history path uses so a replay turn does not run the
 * machine-memory queries twice (once for the header, once for the packet).
 */
export function packetFromMachineMemoryResponse(
  tenantId: string,
  assetId: string,
  response: MachineMemoryResponse,
): MachineContextPacket {
  const liveTags = response.live_tags ?? [];
  const machineState = response.current_state ?? null;

  return {
    asset_id: assetId,
    tenant_id: tenantId,
    uns_path: response.uns_path,
    has_live_data: liveTags.length > 0,
    machine_state: machineState,
    summary: response.summary ?? "",
    live_tags: liveTags,
    active_conditions: response.active_conditions ?? [],
    changed_recently: response.changed_recently ?? [],
    freshness: summarizeFreshness(liveTags),
    evidence: {
      window: response.evidence_window,
      latest_run: response.latest_run,
      latest_window: response.latest_window,
    },
  };
}
