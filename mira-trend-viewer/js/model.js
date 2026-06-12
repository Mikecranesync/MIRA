// Platform-agnostic industrial tag model for the MIRA trend viewer.
// Vendor-neutral: an Ignition tag, an Allen-Bradley register, a Modbus point, a Sparkplug
// metric, an OPC-UA node, a Factory I/O / OpenPLC signal, or a CSV column all normalize to
// the same Tag shape via an adapter. The UI never sees vendor specifics.

export const SourceType = Object.freeze({
  VFD: "vfd",
  ANALOG_INPUT: "analog_input",
  ANALOG_OUTPUT: "analog_output",
  DIGITAL_INPUT: "digital_input",
  DIGITAL_OUTPUT: "digital_output",
});

// Display order + labels for the grouped source browser.
export const GROUPS = Object.freeze([
  { type: SourceType.VFD, label: "VFDs" },
  { type: SourceType.ANALOG_INPUT, label: "Analog Inputs" },
  { type: SourceType.ANALOG_OUTPUT, label: "Analog Outputs" },
  { type: SourceType.DIGITAL_INPUT, label: "Digital Inputs" },
  { type: SourceType.DIGITAL_OUTPUT, label: "Digital Outputs" },
]);

export const DataType = Object.freeze({
  BOOLEAN: "boolean", INTEGER: "integer", FLOAT: "float",
  STRING: "string", WORD: "word", ENUM: "enum",
});

export const Quality = Object.freeze({
  GOOD: "good", UNCERTAIN: "uncertain", BAD: "bad", STALE: "stale",
});

// Deterministic, distinct pen palette. Muted by default (HP-HMI); alarm colors (red/amber/
// green) are reserved for state, NOT used as ordinary pen colors.
export const PEN_PALETTE = Object.freeze([
  "#5b9bd5", "#c08a3e", "#8a7fb5", "#4f9d8c", "#b56a7a",
  "#7d9a4f", "#6f8fb0", "#a98b5b", "#9a6f9a", "#5f8a8a",
]);

/** Normalize a partial tag into a complete Tag with safe defaults. */
export function createTag(input) {
  if (!input || !input.id) throw new Error("tag requires an id");
  const sourceType = input.sourceType;
  const digital = isDigitalSource(sourceType);
  return {
    id: String(input.id),
    name: input.name ?? String(input.id),
    displayName: input.displayName ?? input.name ?? String(input.id),
    sourceType,
    assetId: input.assetId ?? "",
    assetName: input.assetName ?? "",
    deviceId: input.deviceId ?? input.assetId ?? "",
    deviceName: input.deviceName ?? input.assetName ?? "",
    address: input.address ?? "",
    dataType: input.dataType ?? (digital ? DataType.BOOLEAN : DataType.FLOAT),
    engineeringUnits: input.engineeringUnits ?? "",
    min: input.min ?? null,
    max: input.max ?? null,
    currentValue: input.currentValue ?? null,
    quality: input.quality ?? Quality.GOOD,
    timestamp: input.timestamp ?? null,
    lastChangedTimestamp: input.lastChangedTimestamp ?? null,
    trendable: input.trendable ?? true,
    selectedForTrend: input.selectedForTrend ?? false,
    scale: input.scale ?? 1,
    offset: input.offset ?? 0,
    description: input.description ?? "",
    category: input.category ?? "",
    // enum/state maps for digital + status words: {0:"OFF",1:"ON"} or fault-code tables.
    states: input.states ?? null,
    metadata: input.metadata ?? {},
  };
}

export function isDigitalSource(sourceType) {
  return sourceType === SourceType.DIGITAL_INPUT || sourceType === SourceType.DIGITAL_OUTPUT;
}

/** A tag renders as a digital/step trace (vs a continuous analog line). VFD status/run/dir/
 *  comm points are digital even though they live under a VFD. */
export function isDigitalTag(tag) {
  if (isDigitalSource(tag.sourceType)) return true;
  return tag.dataType === DataType.BOOLEAN;
}

export function isStale(tag) {
  return tag.quality === Quality.STALE;
}
export function isBad(tag) {
  return tag.quality === Quality.BAD || tag.quality === Quality.UNCERTAIN;
}

/** Human display of the live value. Honors missing units, digital state maps, quality. */
export function formatValue(tag) {
  const v = tag.currentValue;
  if (v === null || v === undefined) return tag.quality === Quality.STALE ? "—" : "n/a";
  if (tag.dataType === DataType.WORD) {            // status/control words: hex, not bare decimal
    return "0x" + Number(v).toString(16).toUpperCase().padStart(4, "0");
  }
  if (isDigitalTag(tag) || tag.dataType === DataType.ENUM) {
    if (tag.states && tag.states[v] !== undefined) return String(tag.states[v]);
    if (tag.dataType === DataType.BOOLEAN || isDigitalSource(tag.sourceType)) {
      return Number(v) ? "ON" : "OFF";
    }
    return String(v);
  }
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Units suffix, or empty when unitless (UI hides it cleanly). */
export function unitLabel(tag) {
  return tag.engineeringUnits && tag.engineeringUnits.length ? tag.engineeringUnits : "";
}

export function rangeLabel(tag) {
  if (tag.min === null || tag.max === null) return "";
  const u = unitLabel(tag);
  return `${tag.min}–${tag.max}${u ? " " + u : ""}`;
}

export function qualityLabel(tag) {
  switch (tag.quality) {
    case Quality.GOOD: return "GOOD";
    case Quality.STALE: return "STALE";
    case Quality.BAD: return "BAD";
    case Quality.UNCERTAIN: return "UNCERTAIN";
    default: return String(tag.quality || "").toUpperCase();
  }
}

/** Epoch-ms or ISO timestamp -> short local time, or the honest "timestamp unavailable". */
export function formatTimestamp(ts) {
  if (ts === null || ts === undefined) return "timestamp unavailable";
  const d = typeof ts === "number" ? new Date(ts) : new Date(String(ts));
  if (isNaN(d.getTime())) return "timestamp unavailable";
  return d.toLocaleTimeString([], { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

/** Group tags by sourceType, then for VFDs sub-group by device (each VFD is a card). */
export function groupTags(tags) {
  const byType = new Map(GROUPS.map((g) => [g.type, []]));
  for (const t of tags) {
    if (!byType.has(t.sourceType)) byType.set(t.sourceType, []);
    byType.get(t.sourceType).push(t);
  }
  return GROUPS.map((g) => {
    const groupTagsList = byType.get(g.type) || [];
    let devices = null;
    if (g.type === SourceType.VFD) {
      const dmap = new Map();
      for (const t of groupTagsList) {
        const key = t.deviceId || t.assetId || t.deviceName || "vfd";
        if (!dmap.has(key)) {
          dmap.set(key, { deviceId: key, deviceName: t.deviceName || t.assetName || key, tags: [] });
        }
        dmap.get(key).tags.push(t);
      }
      devices = [...dmap.values()];
    }
    return { type: g.type, label: g.label, tags: groupTagsList, devices };
  });
}
