/**
 * Machine history (Sensor REPLAY, contract §4.3) — the ONE fault-anchored
 * window reader shared by GET /api/assets/[id]/history and the notebook chat
 * route's `machineEvidence` grounding (§4.4). Read-only: SELECT against
 * tag_events (033), tag_event_diffs (037) and machine_state_window (040).
 *
 * Honesty rules (contract §2.8, D2):
 *   - The anchor is the technician's `at`, or the latest faulted/estopped
 *     machine_state_window. There is NO synthesized anchor: no window → the
 *     caller returns 404 `no_fault_window`.
 *   - Every row carries BOTH `event_timestamp` (observed) and `ingested_at`
 *     (received); rows are ordered by `event_timestamp`. A divergence between
 *     the clocks is rendered, never hidden.
 *   - Missing tables degrade to `rows: [] + reason: "unavailable"`, which is
 *     distinct from a real empty window (`rows: []` with no reason). Nothing
 *     is ever invented to fill a timeline.
 *   - Freshness comes from the EXISTING model (classifyTagFreshness /
 *     rollupFreshness via buildMachineMemoryResponse + summarizeFreshness) —
 *     never re-derived here.
 */

import { isUndefinedRelationOrColumn, type MachineMemoryClient } from "@/lib/machine-memory";
import { resolveAssetUnsPath } from "@/lib/asset-uns-path";
import { buildMachineMemoryResponse, type MachineMemoryResponse } from "@/lib/machine-memory-response";
import { summarizeFreshness, type FreshnessSummary, type ObservedChange } from "@/lib/machine-context-packet";
import { classifyProvenance } from "@/lib/machine-history-provenance";

export { classifyProvenance } from "@/lib/machine-history-provenance";

export const DEFAULT_PRE_SECONDS = 5;
export const DEFAULT_POST_SECONDS = 2;
export const MAX_WINDOW_SECONDS = 120;
/** Row caps: a chatty asset at 2 s/tag over a 120 s window stays bounded. */
const MAX_EVENT_ROWS = 2000;
const MAX_DIFF_ROWS = 500;

/** Clamp a requested pre/post span to [0, MAX_WINDOW_SECONDS]; NaN → default. */
export function clampSpan(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_WINDOW_SECONDS, Math.max(0, n));
}

/** Strict ISO-8601 (or anything `Date` parses) → canonical ISO, else null. */
export function parseAnchor(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export interface HistoryAnchor {
  at: string;
  source: "state_window" | "explicit";
  windowId?: string;
  runId?: string;
  /** The window's recorded state when the anchor came from a state window. */
  state?: string;
}

export interface MachineHistoryRow extends ObservedChange {
  uns_path: string | null;
  /** Provenance, carried verbatim from the row (033 / 037). `null` means the
   *  source did not say — which is NEVER treated as physical. */
  source_system: string | null;
  /** 033 only; 037 records no connection on a diff → always null there. */
  source_connection_id: string | null;
  simulated: boolean | null;
}

/**
 * The ONE admissibility rule (PRD §9.2): a raw `tag_events` observation whose
 * quality is exactly `good` and whose provenance is positively physical
 * (`classifyProvenance` in machine-history-provenance: recognised producer +
 * `simulated === false` + non-empty connection id). Diffs (037 carries no
 * quality and no connection), bad/null quality, simulated rows and unknown
 * provenance never unlock Ask MIRA.
 */
export function isAdmissibleObservation(row: MachineHistoryRow): boolean {
  return row.kind === "event" && row.quality === "good" && classifyProvenance(row) === "physical";
}

/**
 * What the asset's CURRENT signal cache says right now (PRD §9.2). Derived
 * ONLY from `summary.live_tags` — it is a fact about the connection, never
 * about the replayed window.
 */
export interface CurrentConnection {
  freshness: FreshnessSummary;
}

/**
 * What the served historical window actually covered (PRD §9.2). Derived ONLY
 * from the rows served. `available:false` (the history tables are missing)
 * carries `observationCount:null` — nothing could be counted — which is a
 * different fact from a valid quiet window's `observationCount:0`.
 */
export interface HistoricalCoverage {
  available: boolean;
  /** Everything serialized in `rows`: raw events PLUS diffs. */
  returnedRowCount: number | null;
  /** Raw `tag_events` rows only. physical + simulated + unknown = this. */
  observationCount: number | null;
  /** Raw good-quality physical events only — the ONLY number that may unlock
   *  Ask MIRA (`isAdmissibleObservation`). Diffs never count here. */
  admissibleObservationCount: number | null;
  physicalObservationCount: number | null;
  simulatedObservationCount: number | null;
  /** PHYSICAL raw events whose quality is not exactly `good` (null counts). */
  badQualityObservationCount: number | null;
  unknownProvenanceCount: number | null;
  /** The RETURNED window bounds (`[at-pre, at+post]`, clamped). */
  from: string;
  to: string;
  /** The OBSERVED bounds — earliest/latest served row — or null when none. */
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export interface MachineHistory {
  anchor: HistoryAnchor;
  pre: number;
  post: number;
  /** The replayed window bounds `[at-pre, at+post]` (canonical ISO). */
  from: string;
  to: string;
  uns_path: string;
  rows: MachineHistoryRow[];
  /** @deprecated compatibility alias for `currentConnection.freshness`. */
  freshness: FreshnessSummary;
  currentConnection: CurrentConnection;
  historicalCoverage: HistoricalCoverage;
  /** The Machine Memory header ("what MIRA thinks now") — same builder as the card. */
  summary: MachineMemoryResponse;
  provenance: "machine_memory";
  /** Present ONLY when tag_events itself is missing in this env. */
  reason?: "unavailable";
  /** False when tag_event_diffs (037) is not applied — events still returned. */
  diffsAvailable: boolean;
}

export type MachineHistoryResult =
  | { ok: true; history: MachineHistory }
  | { ok: false; error: "no_uns_path" }
  | {
      ok: false;
      error: "no_fault_window";
      latestWindow: { state: string; started_at: string; ended_at: string | null } | null;
      /** True when machine_state_window (040) is not applied — the anchor
       *  could not even be looked up. */
      windowsAvailable: boolean;
    };

export interface FetchMachineHistoryOptions {
  /** Explicit anchor (canonical ISO). Null → latest faulted/estopped window. */
  at?: string | null;
  pre?: number;
  post?: number;
  nowMs?: number;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const ms = new Date(String(v)).getTime();
  return Number.isNaN(ms) ? String(v) : new Date(ms).toISOString();
}

/**
 * Fetch the fault-anchored replay window for one asset. `client` is a
 * tenant-scoped query client (withTenantContext); every query still filters
 * `tenant_id = $1::uuid` explicitly, same discipline as fetchMachineMemory.
 */
export async function fetchMachineHistory(
  client: MachineMemoryClient,
  tenantId: string,
  assetId: string,
  opts: FetchMachineHistoryOptions = {},
): Promise<MachineHistoryResult> {
  const pre = clampSpan(opts.pre, DEFAULT_PRE_SECONDS);
  const post = clampSpan(opts.post, DEFAULT_POST_SECONDS);
  const nowMs = opts.nowMs ?? Date.now();

  const unsPath = await resolveAssetUnsPath(client, tenantId, assetId);
  if (!unsPath) return { ok: false, error: "no_uns_path" };

  // ── Anchor ───────────────────────────────────────────────────────────────
  let anchor: HistoryAnchor;
  if (opts.at) {
    anchor = { at: opts.at, source: "explicit" };
    // S5 D4: an explicit anchor still names the machine_state_window that
    // CONTAINS it (same tenant / uns_path) when one exists — SELECT only, the
    // same table the fault-window anchor reads. No window → no windowId; a
    // missing 040 table is not an error here (the anchor is already known).
    try {
      const containing = await client
        .query(
          `SELECT window_id::text AS window_id, state, started_at, ended_at
             FROM machine_state_window
            WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              AND started_at <= $3::timestamptz
              AND (ended_at IS NULL OR ended_at >= $3::timestamptz)
            ORDER BY started_at DESC
            LIMIT 1`,
          [tenantId, unsPath, opts.at],
        )
        .then((r) => r.rows[0] ?? null);
      if (containing) {
        anchor.windowId = String(containing.window_id);
        anchor.state = String(containing.state);
      }
    } catch (err) {
      if (!isUndefinedRelationOrColumn(err)) throw err;
      console.error("[lib/machine-history] machine_state_window unavailable (040 not applied?)", err);
    }
  } else {
    let faultWindow: Record<string, unknown> | null = null;
    let latestWindow: Record<string, unknown> | null = null;
    try {
      faultWindow = await client
        .query(
          `SELECT window_id::text AS window_id, state, started_at, ended_at
             FROM machine_state_window
            WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              AND state IN ('faulted', 'estopped')
            ORDER BY started_at DESC
            LIMIT 1`,
          [tenantId, unsPath],
        )
        .then((r) => r.rows[0] ?? null);
      if (!faultWindow) {
        latestWindow = await client
          .query(
            `SELECT window_id::text AS window_id, state, started_at, ended_at
               FROM machine_state_window
              WHERE tenant_id = $1::uuid AND uns_path = $2::ltree
              ORDER BY started_at DESC
              LIMIT 1`,
            [tenantId, unsPath],
          )
          .then((r) => r.rows[0] ?? null);
      }
    } catch (err) {
      if (!isUndefinedRelationOrColumn(err)) throw err;
      console.error("[lib/machine-history] machine_state_window unavailable (040 not applied?)", err);
      return { ok: false, error: "no_fault_window", latestWindow: null, windowsAvailable: false };
    }
    if (!faultWindow) {
      return {
        ok: false,
        error: "no_fault_window",
        latestWindow: latestWindow
          ? {
              state: String(latestWindow.state),
              started_at: iso(latestWindow.started_at) ?? String(latestWindow.started_at),
              ended_at: iso(latestWindow.ended_at),
            }
          : null,
        windowsAvailable: true,
      };
    }
    anchor = {
      at: iso(faultWindow.started_at) ?? String(faultWindow.started_at),
      source: "state_window",
      windowId: String(faultWindow.window_id),
      state: String(faultWindow.state),
    };
  }

  const anchorMs = new Date(anchor.at).getTime();
  const from = new Date(anchorMs - pre * 1000).toISOString();
  const to = new Date(anchorMs + post * 1000).toISOString();

  // ── Rows: tag_events (both clocks + quality) ─────────────────────────────
  let reason: "unavailable" | undefined;
  let eventRows: Array<Record<string, unknown>> = [];
  try {
    eventRows = await client
      .query(
        `SELECT event_timestamp, ingested_at, uns_path::text AS uns_path,
                tag_path, value, quality, source_system, source_connection_id, simulated
           FROM tag_events
          WHERE tenant_id = $1::uuid
            AND uns_path IS NOT NULL
            AND uns_path <@ $2::ltree
            AND event_timestamp >= $3::timestamptz
            AND event_timestamp <= $4::timestamptz
          ORDER BY event_timestamp ASC
          LIMIT ${MAX_EVENT_ROWS}`,
        [tenantId, unsPath, from, to],
      )
      .then((r) => r.rows);
  } catch (err) {
    if (!isUndefinedRelationOrColumn(err)) throw err;
    console.error("[lib/machine-history] tag_events unavailable (033 not applied?)", err);
    reason = "unavailable";
  }

  // ── Rows: tag_event_diffs (prev → new; no quality column in 037) ─────────
  let diffRows: Array<Record<string, unknown>> = [];
  let diffsAvailable = true;
  if (!reason) {
    try {
      diffRows = await client
        .query(
          `SELECT event_timestamp, detected_at, uns_path::text AS uns_path,
                  tag_path, prev_value, new_value, diff_type, source_system, simulated
             FROM tag_event_diffs
            WHERE tenant_id = $1::uuid
              AND uns_path IS NOT NULL
              AND uns_path <@ $2::ltree
              AND event_timestamp >= $3::timestamptz
              AND event_timestamp <= $4::timestamptz
            ORDER BY event_timestamp ASC
            LIMIT ${MAX_DIFF_ROWS}`,
          [tenantId, unsPath, from, to],
        )
        .then((r) => r.rows);
    } catch (err) {
      if (!isUndefinedRelationOrColumn(err)) throw err;
      console.error("[lib/machine-history] tag_event_diffs unavailable (037 not applied?)", err);
      diffsAvailable = false;
    }
  }

  const rows: MachineHistoryRow[] = [
    ...eventRows.map(
      (r): MachineHistoryRow => ({
        kind: "event",
        event_timestamp: iso(r.event_timestamp) ?? String(r.event_timestamp),
        ingested_at: iso(r.ingested_at),
        uns_path: (r.uns_path as string | null) ?? null,
        tag: String(r.tag_path),
        value: r.value == null ? null : String(r.value),
        quality: r.quality == null ? null : String(r.quality),
        source_system: r.source_system == null ? null : String(r.source_system),
        source_connection_id: r.source_connection_id == null ? null : String(r.source_connection_id),
        simulated: typeof r.simulated === "boolean" ? r.simulated : null,
      }),
    ),
    ...diffRows.map(
      (r): MachineHistoryRow => ({
        kind: "diff",
        event_timestamp: iso(r.event_timestamp) ?? String(r.event_timestamp),
        ingested_at: iso(r.detected_at),
        uns_path: (r.uns_path as string | null) ?? null,
        tag: String(r.tag_path),
        value: r.new_value == null ? null : String(r.new_value),
        prev_value: r.prev_value == null ? null : String(r.prev_value),
        // 037 records no quality on a diff; null, never guessed.
        quality: null,
        source_system: r.source_system == null ? null : String(r.source_system),
        // 037 carries no connection id.
        source_connection_id: null,
        simulated: typeof r.simulated === "boolean" ? r.simulated : null,
      }),
    ),
  ].sort((a, b) => {
    const d = new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime();
    if (d !== 0) return d;
    // Same instant: the raw observation precedes the transition it produced.
    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
    return a.tag.localeCompare(b.tag);
  });

  // ── Header + freshness: the EXISTING Machine Memory builder ──────────────
  const summary = await buildMachineMemoryResponse(client, tenantId, assetId, nowMs);
  const freshness = summarizeFreshness(summary.live_tags ?? []);

  // Run anchor: only when the latest run demonstrably covers the anchor.
  const run = summary.latest_run;
  if (run && !anchor.runId) {
    const startMs = new Date(run.started_at).getTime();
    const stopMs = run.stopped_at ? new Date(run.stopped_at).getTime() : Number.POSITIVE_INFINITY;
    if (!Number.isNaN(startMs) && startMs <= anchorMs && anchorMs <= stopMs) anchor.runId = run.run_id;
  }

  // Coverage comes from the served rows only (already ordered by
  // event_timestamp). An unavailable window has nothing to count: null, not 0.
  const historicalCoverage: HistoricalCoverage = reason
    ? {
        available: false,
        returnedRowCount: null,
        observationCount: null,
        admissibleObservationCount: null,
        physicalObservationCount: null,
        simulatedObservationCount: null,
        badQualityObservationCount: null,
        unknownProvenanceCount: null,
        from,
        to,
        firstObservedAt: null,
        lastObservedAt: null,
      }
    : summarizeCoverage(rows, from, to);

  return {
    ok: true,
    history: {
      anchor,
      pre,
      post,
      from,
      to,
      uns_path: unsPath,
      rows,
      freshness,
      currentConnection: { freshness },
      historicalCoverage,
      summary,
      provenance: "machine_memory",
      ...(reason ? { reason } : {}),
      diffsAvailable,
    },
  };
}

/**
 * Count what the served rows actually are (PRD §9.2). Server-owned: the
 * client never derives admissibility. `returnedRowCount` is everything
 * serialized (events + diffs); every other count is over RAW EVENTS ONLY —
 * a diff is a derived transition, not an observation, so it enters no
 * provenance or admission partition. Provenance buckets partition the raw
 * events exactly (physical + simulated + unknown = observationCount); bad
 * quality is counted within the physical bucket only.
 */
export function summarizeCoverage(rows: MachineHistoryRow[], from: string, to: string): HistoricalCoverage {
  let observations = 0;
  let admissible = 0;
  let physical = 0;
  let simulated = 0;
  let unknown = 0;
  let badQuality = 0;
  for (const r of rows) {
    if (r.kind !== "event") continue;
    observations += 1;
    const p = classifyProvenance(r);
    if (p === "simulated") {
      simulated += 1;
    } else if (p === "physical") {
      physical += 1;
      if (r.quality === "good") admissible += 1;
      else badQuality += 1;
    } else {
      unknown += 1;
    }
  }
  return {
    available: true,
    returnedRowCount: rows.length,
    observationCount: observations,
    admissibleObservationCount: admissible,
    physicalObservationCount: physical,
    simulatedObservationCount: simulated,
    badQualityObservationCount: badQuality,
    unknownProvenanceCount: unknown,
    from,
    to,
    firstObservedAt: rows.length ? rows[0].event_timestamp : null,
    lastObservedAt: rows.length ? rows[rows.length - 1].event_timestamp : null,
  };
}

/** The wire shape of GET /api/assets/[id]/history (contract §4.3). */
export function historyResponseBody(h: MachineHistory): Record<string, unknown> {
  return {
    anchor: h.anchor,
    window: { from: h.from, to: h.to, pre: h.pre, post: h.post },
    rows: h.rows,
    // Compatibility alias (PRD §9.2): first-party clients read the two
    // explicit objects below; `freshness` stays for older consumers only.
    freshness: h.freshness,
    currentConnection: h.currentConnection,
    historicalCoverage: h.historicalCoverage,
    summary: h.summary,
    provenance: h.provenance,
    ...(h.reason ? { reason: h.reason } : {}),
    diffsAvailable: h.diffsAvailable,
  };
}
