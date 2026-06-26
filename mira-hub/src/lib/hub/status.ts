export type HubZoneState = "running" | "idle" | "blocked" | "faulted" | "unknown";

export type SignalRow = {
  plc_tag: string;
  value: string | number | boolean | null;
  last_changed_at: string | null;
};

export type HubZoneStatus = {
  id: string;
  label: string;
  kind: "coaster_zone" | "conveyor_cell";
  state: HubZoneState;
  stale: boolean;
  metrics: Record<string, string | number | boolean | null>;
  updatedAt: string | null;
};

const STALE_MS = 60_000;

const ZONE_LABELS: Record<string, { label: string; kind: HubZoneStatus["kind"] }> = {
  conv_simple: { label: "Conveyor Cell", kind: "conveyor_cell" },
  "stardust.launch_1": { label: "Stardust Launch 1", kind: "coaster_zone" },
  "stardust.launch_2": { label: "Stardust Launch 2", kind: "coaster_zone" },
  "stardust.station_load": { label: "Stardust Station Load", kind: "coaster_zone" },
  "stardust.station_unload": { label: "Stardust Station Unload", kind: "coaster_zone" },
};

function zoneIdForTag(tag: string): string | null {
  if (tag.startsWith("conv_simple.")) return "conv_simple";
  const stardust = /^stardust\.([^.]+)\./.exec(tag);
  return stardust ? `stardust.${stardust[1]}` : null;
}

function rowValue(rows: SignalRow[], tag: string) {
  return rows.find((r) => r.plc_tag === tag)?.value ?? null;
}

function newest(rows: SignalRow[]) {
  const times = rows
    .map((r) => r.last_changed_at)
    .filter((time): time is string => Boolean(time));
  return times.sort().at(-1) ?? null;
}

function isStale(updatedAt: string | null, now: Date) {
  if (!updatedAt) return true;
  return now.getTime() - new Date(updatedAt).getTime() > STALE_MS;
}

function truthy(value: string | number | boolean | null) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on", "running"].includes(value.toLowerCase());
  return false;
}

function numeric(value: string | number | boolean | null) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function conveyorState(rows: SignalRow[], stale: boolean): HubZoneState {
  if (stale) return "unknown";
  if (rowValue(rows, "conv_simple.comm_ok") === false) return "faulted";
  if (truthy(rowValue(rows, "conv_simple.faulted"))) return "faulted";
  if (truthy(rowValue(rows, "conv_simple.blocked"))) return "blocked";

  const motorRun = truthy(rowValue(rows, "conv_simple.motor_run"));
  const speedHz = numeric(rowValue(rows, "conv_simple.vfd_speed_hz")) ?? 0;
  if (motorRun && speedHz > 0) return "running";
  return "idle";
}

function stardustState(zoneId: string, rows: SignalRow[], stale: boolean): HubZoneState {
  if (stale) return "unknown";
  if (
    truthy(rowValue(rows, `${zoneId}.fault_latched`)) ||
    truthy(rowValue(rows, `${zoneId}.faulted`))
  ) return "faulted";
  if (
    truthy(rowValue(rows, `${zoneId}.brake_fault`)) ||
    rowValue(rows, `${zoneId}.brake_ready`) === false
  ) return "faulted";
  if (truthy(rowValue(rows, `${zoneId}.block_occupied`))) return "blocked";
  if (truthy(rowValue(rows, `${zoneId}.lsm_ready`))) return "idle";
  return "unknown";
}

function summarizeZone(zoneId: string, rows: SignalRow[], now: Date): HubZoneStatus {
  const updatedAt = newest(rows);
  const stale = isStale(updatedAt, now);
  const config = ZONE_LABELS[zoneId] ?? { label: zoneId, kind: "coaster_zone" as const };
  const metrics = Object.fromEntries(
    rows.map((row) => [row.plc_tag.slice(`${zoneId}.`.length), row.value]),
  );

  return {
    id: zoneId,
    label: config.label,
    kind: config.kind,
    state:
      zoneId === "conv_simple"
        ? conveyorState(rows, stale)
        : stardustState(zoneId, rows, stale),
    stale,
    metrics,
    updatedAt,
  };
}

export function summarizeHubSignals(rows: SignalRow[], now = new Date()): HubZoneStatus[] {
  const byZone = new Map<string, SignalRow[]>();

  for (const row of rows) {
    const zoneId = zoneIdForTag(row.plc_tag);
    if (!zoneId) continue;
    const zoneRows = byZone.get(zoneId) ?? [];
    zoneRows.push(row);
    byZone.set(zoneId, zoneRows);
  }

  return [...byZone.entries()]
    .map(([zoneId, zoneRows]) => summarizeZone(zoneId, zoneRows, now))
    .sort((a, b) => a.id.localeCompare(b.id));
}
