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

  if (lines.length === 0) return "";
  return `## Live Machine Evidence (observed now)
The following is MACHINE-OBSERVED evidence from this asset's live tags and history (current decoded tag values, freshness-aware state, a deterministic assessment, and anomaly detections). Treat it as current, citable observations — cite it as "machine memory" when you use it. In your answer, clearly separate: (1) this LIVE evidence, (2) asset/manual context, (3) your inference, and (4) the recommended next checks.

${lines.join("\n")}`;
}

function summarizeFreshness(liveTags: LiveTag[]): FreshnessSummary {
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
