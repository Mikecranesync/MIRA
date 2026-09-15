/**
 * The bridge from the running SimLab service to the shared FactoryLM shell.
 *
 * SimLab (`python -m simlab`) is a deterministic juice-bottling line: nine
 * assets, PLC-style tags, PackML labels, declarative alarms, per-asset
 * documents, and six replayable fault scenarios. It has always been reachable
 * over HTTP and no UI has ever consumed it. This module is that missing wire,
 * and nothing more — it does not simulate, diagnose, or decide.
 *
 * Three rules shape every line below.
 *
 * **1. Read only what the demo is allowed to read.** `SIMLAB_ENDPOINTS` is the
 * whole vocabulary; `SimLabClient` cannot express a request outside it. The two
 * endpoints that carry ground truth — `/scenario/{id}/rubric` and
 * `/evidence/{id}` — are absent by construction, not by convention, and
 * `tests/simlab/test_public_demo_trust_boundary.py` proves the allowed ones
 * carry no rubric content for any scenario.
 *
 * **2. Parse fail-closed.** Every parser returns `null` on a shape it does not
 * recognise. There is no default tick, no assumed empty alarm list, no coerced
 * number. A demo that renders a plausible value it did not receive is worse
 * than one that says it lost the connection.
 *
 * **3. Never render a tag the simulator does not drive.** Two tags exist on
 * these assets and never move, in any scenario:
 *
 *   - `status.run_state` is `"Idle"` for every asset always — `SimEngine`
 *     assigns `asset.packml_default` at reset and never transitions it.
 *   - `process.accumulation_percent` is `0.0` for every zone always — nothing
 *     writes it.
 *
 * Showing "Idle" on a conveyor whose belt is visibly turning, or a 0 %
 * accumulation bar beside a zone the same payload calls blocked, would read as
 * a contradiction to the one audience that matters. Both are omitted, and
 * `test_undriven_tags_stay_undriven` in the trust-boundary suite fails if the
 * simulator ever starts driving them — at which point they should be rendered,
 * not kept hidden.
 */

import type { InspectorField, Machine } from "./types";

/** Every endpoint the public demo may call. There are no others. */
export const SIMLAB_ENDPOINTS = Object.freeze({
  health: "/simlab/healthz",
  snapshot: "/simlab/snapshot",
  alarms: "/simlab/alarms",
  history: "/simlab/history",
  assetTags: "/simlab/assets/{assetId}/tags",
  assetDocs: "/simlab/assets/{assetId}/docs",
  doc: "/simlab/docs/{assetId}/{filename}",
  scenarioStart: "/simlab/scenario/{scenarioId}/start",
  scenarioReset: "/simlab/scenario/reset",
  scenarioTick: "/simlab/scenario/tick",
} as const);

/** The canonical UNS root of the SimLab line (`simlab/uns.py`). */
export const SIMLAB_LINE_PATH =
  "enterprise.florida_natural_demo.plant1.juice_bottling.line01";

/**
 * The flagship scenario id.
 *
 * It travels OUT, on the control the visitor presses, and never comes back in:
 * it names the fault in plain English, so it is deliberately absent from
 * `SimLabDemoState` and from anything the conversation can read.
 */
export const JAM_SCENARIO_ID = "casepacker_jam_upstream_block";

export type TagValue = number | boolean | string;

export interface SimLabHealth {
  readonly tick: number;
}

export interface SimLabSnapshot {
  readonly tick: number;
  readonly tags: Readonly<Record<string, TagValue>>;
}

export type AlarmSeverity = "info" | "warn" | "fault" | "critical";

export interface SimLabAlarm {
  readonly assetId: string;
  readonly code: string;
  readonly severity: AlarmSeverity;
  readonly message: string;
  readonly sinceTick: number;
}

export interface SimLabHistoryPoint {
  readonly tick: number;
  readonly value: TagValue;
}

export interface SimLabTagDef {
  readonly tag: string;
  readonly category: string;
  readonly unit: string;
  readonly unsPath: string;
}

/**
 * How a condition was reached — a legend the visitor can check, so the coloured
 * state is never the only thing said.
 */
export type AssetCondition = "running" | "blocked" | "faulted" | "stopped" | "unknown";

export interface DemoSignal {
  readonly tag: string;
  readonly label: string;
  readonly unsPath: string;
  readonly value: TagValue;
  /** Empty string when the tag genuinely carries no unit (booleans, codes). */
  readonly unit: string;
}

export interface DemoAsset {
  readonly assetId: string;
  readonly name: string;
  readonly unsPath: string;
  readonly condition: AssetCondition;
  /** The evidence the condition was read from, in the visitor's words. */
  readonly conditionReason: string;
  /**
   * Belt motion, from `process.speed_fpm` only. `null` where the asset has no
   * belt (the case packer), so a renderer cannot mistake "no belt" for "stopped".
   */
  readonly speedFpm: number | null;
  readonly faultCode: string | null;
  readonly signals: readonly DemoSignal[];
  readonly alarms: readonly SimLabAlarm[];
  readonly documents: readonly string[];
}

/** Whether what is on screen is worth believing right now. */
export type ConnectionState = "connecting" | "live" | "stale" | "offline";

export interface SimLabDemoState {
  readonly tick: number;
  readonly assets: readonly DemoAsset[];
  readonly alarms: readonly SimLabAlarm[];
  readonly connection: ConnectionState;
  /** Wall-clock ms of the last successful read; `null` before the first one. */
  readonly observedAt: number | null;
  /** Age in ms of the data on screen; `null` when nothing has been read yet. */
  readonly ageMs: number | null;
  /** Present only when the last attempt failed, and then always human-readable. */
  readonly error: string | null;
}

/** The three assets the public demo draws. Everything else stays in SimLab. */
export const DEMO_ASSET_IDS = Object.freeze([
  "conveyorzone01",
  "conveyorzone02",
  "casepacker01",
] as const);

export type DemoAssetId = (typeof DEMO_ASSET_IDS)[number];

const ASSET_NAMES: Readonly<Record<DemoAssetId, string>> = Object.freeze({
  conveyorzone01: "Conveyor Zone 01",
  conveyorzone02: "Conveyor Zone 02",
  casepacker01: "Case Packer 01",
});

/**
 * The signals each asset shows, by bare tag name.
 *
 * Deliberately short — four at most. The brief's "no tag wall" and the
 * high-performance-HMI rule are the same instruction: a marketing visitor who
 * is shown thirty values learns nothing, and a technician who is shown thirty
 * values stops reading. These are the ones that explain THIS event.
 *
 * `run_state` and `accumulation_percent` are excluded for the reason in the
 * module docstring: the simulator never drives them.
 */
const ASSET_SIGNALS: Readonly<Record<DemoAssetId, readonly string[]>> = Object.freeze({
  conveyorzone01: Object.freeze(["speed_fpm", "motor_current_amps", "blocked"]),
  conveyorzone02: Object.freeze(["speed_fpm", "motor_current_amps", "blocked"]),
  casepacker01: Object.freeze(["jam_detected", "case_count", "glue_temperature"]),
});

/** Tags this module refuses to render, and why. Asserted by the Python suite. */
export const UNDRIVEN_TAGS = Object.freeze(["run_state", "accumulation_percent"] as const);

const SIGNAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  speed_fpm: "Belt speed",
  motor_current_amps: "Motor current",
  blocked: "Zone blocked",
  jam_detected: "Jam detected",
  case_count: "Cases packed",
  glue_temperature: "Glue temperature",
});

// ---------------------------------------------------------------------------
// Fail-closed parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTagValue(value: unknown): value is TagValue {
  return typeof value === "number" || typeof value === "boolean" || typeof value === "string";
}

const SEVERITIES: readonly AlarmSeverity[] = ["info", "warn", "fault", "critical"];

function parseSeverity(value: unknown): AlarmSeverity | null {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)
    ? (value as AlarmSeverity)
    : null;
}

export function parseHealth(raw: unknown): SimLabHealth | null {
  if (!isRecord(raw) || typeof raw.tick !== "number") return null;
  return { tick: raw.tick };
}

export function parseSnapshot(raw: unknown): SimLabSnapshot | null {
  if (!isRecord(raw) || typeof raw.tick !== "number" || !isRecord(raw.tags)) return null;
  const tags: Record<string, TagValue> = {};
  for (const [path, value] of Object.entries(raw.tags)) {
    // A tag whose value is not a scalar is dropped rather than coerced: a NaN
    // or "[object Object]" on an HMI is worse than a missing reading.
    if (isTagValue(value)) tags[path] = value;
  }
  return { tick: raw.tick, tags };
}

/**
 * One malformed alarm rejects the whole list.
 *
 * Alarms are the one payload where a partial read is actively dangerous: a list
 * silently short by one entry is indistinguishable from a quiet machine. Better
 * to report the read as failed and show the last good state as stale.
 */
export function parseAlarms(raw: unknown): SimLabAlarm[] | null {
  if (!Array.isArray(raw)) return null;
  const alarms: SimLabAlarm[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const severity = parseSeverity(entry.severity);
    if (
      typeof entry.asset_id !== "string"
      || typeof entry.code !== "string"
      || typeof entry.message !== "string"
      || typeof entry.since_tick !== "number"
      || severity === null
    ) return null;
    alarms.push({
      assetId: entry.asset_id,
      code: entry.code,
      severity,
      message: entry.message,
      sinceTick: entry.since_tick,
    });
  }
  return alarms;
}

export function parseHistory(raw: unknown): SimLabHistoryPoint[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.history)) return null;
  const points: SimLabHistoryPoint[] = [];
  for (const entry of raw.history) {
    if (!isRecord(entry) || typeof entry.tick !== "number" || !isTagValue(entry.value)) return null;
    points.push({ tick: entry.tick, value: entry.value });
  }
  return points;
}

export function parseDocNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    names.push(entry);
  }
  return names;
}

export function parseTagDefs(raw: unknown): SimLabTagDef[] | null {
  if (!Array.isArray(raw)) return null;
  const defs: SimLabTagDef[] = [];
  for (const entry of raw) {
    if (
      !isRecord(entry)
      || typeof entry.tag !== "string"
      || typeof entry.category !== "string"
      || typeof entry.uns_path !== "string"
    ) return null;
    defs.push({
      tag: entry.tag,
      category: entry.category,
      unit: typeof entry.unit === "string" ? entry.unit : "",
      unsPath: entry.uns_path,
    });
  }
  return defs;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: { signal?: AbortSignal; method?: string }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface SimLabClientOptions {
  /** Where SimLab is listening. Configurable; never a committed secret. */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
}

/** Thrown for a transport or status failure; parse failures return `null`. */
export class SimLabUnavailable extends Error {
  constructor(readonly detail: string) {
    super(`SimLab unavailable: ${detail}`);
    this.name = "SimLabUnavailable";
  }
}

function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing path parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

export class SimLabClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: SimLabClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch;
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST"; signal?: AbortSignal },
  ): Promise<unknown> {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        ...(init.signal ? { signal: init.signal } : {}),
      });
    } catch (cause) {
      throw new SimLabUnavailable(cause instanceof Error ? cause.message : "network error");
    }
    if (!response.ok) throw new SimLabUnavailable(`HTTP ${response.status} on ${path}`);
    try {
      return await response.json();
    } catch {
      throw new SimLabUnavailable(`unreadable response from ${path}`);
    }
  }

  async health(signal?: AbortSignal): Promise<SimLabHealth | null> {
    return parseHealth(await this.request(SIMLAB_ENDPOINTS.health, { method: "GET", signal }));
  }

  async snapshot(signal?: AbortSignal): Promise<SimLabSnapshot | null> {
    return parseSnapshot(await this.request(SIMLAB_ENDPOINTS.snapshot, { method: "GET", signal }));
  }

  async alarms(signal?: AbortSignal): Promise<SimLabAlarm[] | null> {
    return parseAlarms(await this.request(SIMLAB_ENDPOINTS.alarms, { method: "GET", signal }));
  }

  async history(unsPath: string, signal?: AbortSignal): Promise<SimLabHistoryPoint[] | null> {
    const path = `${SIMLAB_ENDPOINTS.history}?tag=${encodeURIComponent(unsPath)}`;
    return parseHistory(await this.request(path, { method: "GET", signal }));
  }

  async assetTags(assetId: string, signal?: AbortSignal): Promise<SimLabTagDef[] | null> {
    const path = fill(SIMLAB_ENDPOINTS.assetTags, { assetId });
    return parseTagDefs(await this.request(path, { method: "GET", signal }));
  }

  async assetDocs(assetId: string, signal?: AbortSignal): Promise<string[] | null> {
    const path = fill(SIMLAB_ENDPOINTS.assetDocs, { assetId });
    return parseDocNames(await this.request(path, { method: "GET", signal }));
  }

  /** The document viewer's source of truth — plain text, never JSON. */
  documentUrl(assetId: string, filename: string): string {
    return `${this.baseUrl}${fill(SIMLAB_ENDPOINTS.doc, { assetId, filename })}`;
  }

  async startScenario(scenarioId: string, signal?: AbortSignal): Promise<void> {
    await this.request(fill(SIMLAB_ENDPOINTS.scenarioStart, { scenarioId }), { method: "POST", signal });
  }

  async resetScenario(signal?: AbortSignal): Promise<void> {
    await this.request(SIMLAB_ENDPOINTS.scenarioReset, { method: "POST", signal });
  }

  async tick(n: number, signal?: AbortSignal): Promise<void> {
    await this.request(`${SIMLAB_ENDPOINTS.scenarioTick}?n=${encodeURIComponent(String(n))}`, {
      method: "POST",
      signal,
    });
  }
}

// ---------------------------------------------------------------------------
// Mapping SimLab state into what the shell and the machine view render
// ---------------------------------------------------------------------------

export function assetPath(assetId: string): string {
  return `${SIMLAB_LINE_PATH}.${assetId}`;
}

function readTag(
  tags: Readonly<Record<string, TagValue>>,
  assetId: string,
  category: string,
  tag: string,
): TagValue | undefined {
  return tags[`${assetPath(assetId)}.${category}.${tag}`];
}

/** Find a tag by bare name under an asset, whatever category it lives in. */
function findTag(
  tags: Readonly<Record<string, TagValue>>,
  defs: readonly SimLabTagDef[],
  assetId: string,
  tag: string,
): { value: TagValue; def: SimLabTagDef } | null {
  const def = defs.find((candidate) => candidate.tag === tag);
  if (!def) return null;
  const value = readTag(tags, assetId, def.category, tag);
  return value === undefined ? null : { value, def };
}

/**
 * The condition, and the sentence that justifies it.
 *
 * Order matters and is the operator's: a fault outranks a block, a block
 * outranks normal running. The reason string is not decoration — the
 * high-performance-HMI rule is that a colour alone is never the message, so
 * every state carries the evidence it was read from.
 */
function deriveCondition(
  assetId: string,
  tags: Readonly<Record<string, TagValue>>,
  defs: readonly SimLabTagDef[],
  alarms: readonly SimLabAlarm[],
  speedFpm: number | null,
): { condition: AssetCondition; reason: string } {
  const own = alarms.filter((alarm) => alarm.assetId === assetId);
  const fault = own.find((alarm) => alarm.severity === "fault" || alarm.severity === "critical");
  if (fault) return { condition: "faulted", reason: `${fault.code} — ${fault.message}` };

  const blocked = findTag(tags, defs, assetId, "blocked");
  if (blocked?.value === true) {
    const warn = own.find((alarm) => alarm.severity === "warn");
    return {
      condition: "blocked",
      reason: warn ? `${warn.code} — ${warn.message}` : "status.blocked is true",
    };
  }

  const warn = own.find((alarm) => alarm.severity === "warn");
  if (warn) return { condition: "blocked", reason: `${warn.code} — ${warn.message}` };

  if (speedFpm !== null) {
    return speedFpm > 0
      ? { condition: "running", reason: `Belt running at ${speedFpm.toFixed(1)} fpm, no active alarm` }
      : { condition: "stopped", reason: "Belt speed is zero, no active alarm" };
  }

  const jam = findTag(tags, defs, assetId, "jam_detected");
  if (jam?.value === false) return { condition: "running", reason: "No jam detected, no active alarm" };
  if (jam === null) return { condition: "unknown", reason: "No reading for this asset" };
  return { condition: "running", reason: "No active alarm" };
}

export interface BuildDemoStateInput {
  readonly snapshot: SimLabSnapshot;
  readonly alarms: readonly SimLabAlarm[];
  readonly tagDefs: Readonly<Record<string, readonly SimLabTagDef[]>>;
  readonly documents: Readonly<Record<string, readonly string[]>>;
  readonly observedAt: number;
  readonly now: number;
  /** Older than this and the view stops claiming the data is live. */
  readonly staleAfterMs: number;
}

export function buildDemoState(input: BuildDemoStateInput): SimLabDemoState {
  const { snapshot, alarms, tagDefs, documents, observedAt, now, staleAfterMs } = input;
  const ageMs = Math.max(0, now - observedAt);

  const assets: DemoAsset[] = DEMO_ASSET_IDS.map((assetId) => {
    const defs = tagDefs[assetId] ?? [];
    const speed = findTag(snapshot.tags, defs, assetId, "speed_fpm");
    const speedFpm = speed && typeof speed.value === "number" ? speed.value : null;
    const faultTag = findTag(snapshot.tags, defs, assetId, "fault_code");
    const faultCode = faultTag && typeof faultTag.value === "string" && faultTag.value !== ""
      ? faultTag.value
      : null;

    const signals: DemoSignal[] = [];
    for (const tag of ASSET_SIGNALS[assetId]) {
      const found = findTag(snapshot.tags, defs, assetId, tag);
      if (!found) continue; // absent is absent; never substituted
      signals.push({
        tag,
        label: SIGNAL_LABELS[tag] ?? tag,
        unsPath: found.def.unsPath,
        value: found.value,
        unit: found.def.unit,
      });
    }

    const { condition, reason } = deriveCondition(assetId, snapshot.tags, defs, alarms, speedFpm);
    return {
      assetId,
      name: ASSET_NAMES[assetId],
      unsPath: assetPath(assetId),
      condition,
      conditionReason: reason,
      speedFpm,
      faultCode,
      signals,
      alarms: alarms.filter((alarm) => alarm.assetId === assetId),
      documents: documents[assetId] ?? [],
    };
  });

  return {
    tick: snapshot.tick,
    assets,
    alarms: alarms.filter((alarm) => (DEMO_ASSET_IDS as readonly string[]).includes(alarm.assetId)),
    connection: ageMs > staleAfterMs ? "stale" : "live",
    observedAt,
    ageMs,
    error: null,
  };
}

/** The state before the first successful read, and after a failed one. */
export function unavailableDemoState(
  previous: SimLabDemoState | null,
  error: string,
  now: number,
): SimLabDemoState {
  if (!previous) {
    return {
      tick: 0,
      assets: [],
      alarms: [],
      connection: "offline",
      observedAt: null,
      ageMs: null,
      error,
    };
  }
  // Keep the last good readings on screen — but stop calling them live, and say
  // how old they are. Blanking the view would hide the machine; relabelling is
  // the honest half.
  return {
    ...previous,
    connection: "offline",
    ageMs: previous.observedAt === null ? null : Math.max(0, now - previous.observedAt),
    error,
  };
}

export function connectingDemoState(): SimLabDemoState {
  return {
    tick: 0,
    assets: [],
    alarms: [],
    connection: "connecting",
    observedAt: null,
    ageMs: null,
    error: null,
  };
}

/**
 * The demo's assets as shell `Machine` rows.
 *
 * `status` is the shell's own three-value vocabulary, so a blocked or faulted
 * asset reads as `attention` in navigation exactly as a real one would.
 */
export function demoMachines(state: SimLabDemoState): Machine[] {
  return state.assets.map((asset) => ({
    id: asset.assetId,
    canonicalAssetId: asset.unsPath,
    name: asset.name,
    unsPath: asset.unsPath,
    status: asset.condition === "faulted" || asset.condition === "blocked"
      ? "attention"
      : asset.condition === "unknown"
        ? "unknown"
        : "normal",
  }));
}

/**
 * Inspector rows for a surface that has an inspector.
 *
 * The public profile does not (`PROFILES.public.enterpriseInspector === false`),
 * so on the marketing surface this is never rendered — which is the point: the
 * same bridge feeds an internal surface without the public one gaining an
 * enterprise panel by accident.
 */
export function demoInspector(state: SimLabDemoState): InspectorField[] {
  const fields: InspectorField[] = [
    { label: "Simulation tick", value: String(state.tick) },
    { label: "Data", value: state.connection },
    { label: "Line", value: SIMLAB_LINE_PATH },
  ];
  for (const asset of state.assets) {
    fields.push({ label: asset.name, value: `${asset.condition} — ${asset.conditionReason}` });
  }
  return fields;
}
