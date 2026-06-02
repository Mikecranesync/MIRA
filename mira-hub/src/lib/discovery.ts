// Fieldbus discovery — shared types + payload validation.
//
// Mirrors the `inventory.json` contract emitted by `plc/discover.py`
// (`write_inventory`) and documented in docs/specs/fieldbus-discovery-spec.md §8.
// The Hub only *displays* this payload; it never runs a scan (env boundary —
// the cloud Hub can't reach a plant LAN) and does not write the discovered
// devices into the KG (that is the v1.5 uns_hint → ai_suggestions work, §12).

export const INVENTORY_SCHEMA = "fieldbus-inventory/1";

export type DeviceTier = "port_open" | "protocol_confirmed" | "device_identified";

export interface FieldbusIdentity {
  vendor?: string;
  product?: string;
  serial?: string;
  raw?: Record<string, unknown>;
}

export interface FieldbusDevice {
  transport: "ethernet" | "serial";
  address: string;
  tier: DeviceTier;
  protocol: string;
  profile: string | null;
  identity: FieldbusIdentity;
  evidence: string[];
  uns_hint: string | null;
  next_actions: string[];
}

export interface FieldbusUnknown {
  address: string;
  open_ports: number[];
  note: string;
}

export interface FieldbusScanMeta {
  subnets?: string[];
  serial?: Record<string, unknown> | null;
  ports?: number[];
  gentle?: boolean;
  [key: string]: unknown;
}

export interface FieldbusInventory {
  schema: typeof INVENTORY_SCHEMA;
  scanned_at: string | null;
  scan: FieldbusScanMeta;
  devices: FieldbusDevice[];
  unknowns: FieldbusUnknown[];
}

export type ValidationResult =
  | { ok: true; inventory: FieldbusInventory }
  | { ok: false; error: string };

const TIERS: ReadonlySet<string> = new Set<DeviceTier>([
  "port_open",
  "protocol_confirmed",
  "device_identified",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted payload (uploaded file or POST body) against the
 * `fieldbus-inventory/1` contract. Defensive but lenient on optional fields:
 * `identity`, `evidence`, `next_actions`, `unknowns`, and `scan` all default
 * to empty rather than failing, so a slightly older `discover.py` still renders.
 * The hard requirements are the schema tag and a `devices` array of well-shaped rows.
 */
export function validateInventory(data: unknown): ValidationResult {
  if (!isObject(data)) return { ok: false, error: "payload is not an object" };
  if (data.schema !== INVENTORY_SCHEMA) {
    return {
      ok: false,
      error: `unsupported schema: expected "${INVENTORY_SCHEMA}", got ${JSON.stringify(data.schema)}`,
    };
  }
  if (!Array.isArray(data.devices)) {
    return { ok: false, error: "`devices` must be an array" };
  }

  const devices: FieldbusDevice[] = [];
  for (let i = 0; i < data.devices.length; i++) {
    const d = data.devices[i];
    if (!isObject(d)) return { ok: false, error: `devices[${i}] is not an object` };
    if (typeof d.address !== "string") {
      return { ok: false, error: `devices[${i}].address must be a string` };
    }
    if (typeof d.tier !== "string" || !TIERS.has(d.tier)) {
      return { ok: false, error: `devices[${i}].tier is not a known tier: ${JSON.stringify(d.tier)}` };
    }
    devices.push({
      transport: d.transport === "serial" ? "serial" : "ethernet",
      address: d.address,
      tier: d.tier as DeviceTier,
      protocol: typeof d.protocol === "string" ? d.protocol : "unknown",
      profile: typeof d.profile === "string" ? d.profile : null,
      identity: isObject(d.identity) ? (d.identity as FieldbusIdentity) : {},
      evidence: toStringArray(d.evidence),
      uns_hint: typeof d.uns_hint === "string" ? d.uns_hint : null,
      next_actions: toStringArray(d.next_actions),
    });
  }

  const unknowns: FieldbusUnknown[] = Array.isArray(data.unknowns)
    ? data.unknowns.filter(isObject).map((u) => ({
        address: typeof u.address === "string" ? u.address : "unknown",
        open_ports: Array.isArray(u.open_ports)
          ? u.open_ports.filter((p): p is number => typeof p === "number")
          : [],
        note: typeof u.note === "string" ? u.note : "",
      }))
    : [];

  return {
    ok: true,
    inventory: {
      schema: INVENTORY_SCHEMA,
      scanned_at: typeof data.scanned_at === "string" ? data.scanned_at : null,
      scan: isObject(data.scan) ? (data.scan as FieldbusScanMeta) : {},
      devices,
      unknowns,
    },
  };
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Display label for a tier (used in the UI legend + badges). */
export function tierLabel(tier: DeviceTier): string {
  switch (tier) {
    case "device_identified":
      return "Identified";
    case "protocol_confirmed":
      return "Protocol confirmed";
    case "port_open":
      return "Port open";
  }
}
