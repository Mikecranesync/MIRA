// Best-effort equipment-type inference for the Knowledge page UNS
// drill-down. The `equipment_type` column is populated for newly-ingested
// manuals but most legacy rows are NULL — so we infer from model number /
// title / source_url, falling back to manufacturer hints.
//
// Order matters: more specific patterns must run before generic fallbacks
// (e.g. "S7-1200" must match PLC before "1200" matches anything else).
//
// UNS categories follow the canonical labels referenced in the Hub UI
// (VFDs/Drives, PLCs, Motors, Sensors, HMIs, Servos, Robots, Software, Other).

const NORMALIZE = (s: string | null | undefined) => (s ?? "").toLowerCase();

type Hint = { test: RegExp; type: string };

const MODEL_HINTS: Hint[] = [
  // VFDs / drives
  { test: /\bpowerflex\b/i, type: "VFDs" },
  { test: /\bsinamics\b/i, type: "VFDs" },
  { test: /\bmicromaster\b/i, type: "VFDs" },
  { test: /\bsimovert\b/i, type: "VFDs" },
  { test: /\bgs[1-9]\b|\bga500\b|\bgz500\b|\bv1000\b|\ba1000\b|\bz1000\b|\bcimr\b/i, type: "VFDs" },
  { test: /\bacs\d{2,3}\b|\bacs5[0-9]{2}\b|\bacs8[0-9]{2}\b|\bacs10\d\b/i, type: "VFDs" },
  { test: /\baltivar\b|\batv\d{2,4}\b/i, type: "VFDs" },
  { test: /\bvfd[a-z\d-]*\b/i, type: "VFDs" },
  { test: /\bvariable[ -]?frequency\b/i, type: "VFDs" },
  { test: /\bdrive\b.*\b(ac|vfd|inverter)\b/i, type: "VFDs" },

  // PLCs
  { test: /\bcompactlogix\b|\bcontrollogix\b|\bmicrologix\b|\bflexlogix\b|\bsoftlogix\b/i, type: "PLCs" },
  { test: /\bmicro8[0-9]{2}\b|\bmicro1400\b|\bmicro820\b|\bmicro850\b|\bmicro870\b/i, type: "PLCs" },
  { test: /\bplc-?\d/i, type: "PLCs" },
  { test: /\bs7-?\d{3,4}\b/i, type: "PLCs" },
  { test: /\bsimatic\b/i, type: "PLCs" },
  { test: /\bdo-?more\b|\bproductivity\d{3,4}\b|\bclick\b|\bdl\d{2,3}\b/i, type: "PLCs" },
  { test: /\bfx[1-9][a-z]?\b|\bq\d{2}\b|\bl-?series\b/i, type: "PLCs" }, // Mitsubishi
  { test: /\bcj[12][a-z]?\b|\bcp1[a-z]?\b|\bcs1\b|\bnj\d{3}\b/i, type: "PLCs" }, // Omron

  // HMIs / panels
  { test: /\bpanelview\b|\bcompactview\b/i, type: "HMIs" },
  { test: /\btia[ -]?portal\b/i, type: "Software" },
  { test: /\bktp\d{2,4}\b|\btp\d{3,4}\b|\bcomfort\s*panel\b/i, type: "HMIs" },
  { test: /\bgot\d{4}\b|\bnb\d[a-z]?\b|\bns\d[a-z]?\b/i, type: "HMIs" }, // Mitsu/Omron

  // Servos / motion
  { test: /\bkinetix\b|\bultra\d{4}\b|\bmp-?series\b/i, type: "Servos" },
  { test: /\bsigma-?[0-9a-z]+\b/i, type: "Servos" },
  { test: /\bmr-?j[2-5][a-z]?\b/i, type: "Servos" },

  // Sensors / IO
  { test: /\bproximity\s+sensor\b|\bphotoelectric\b|\bencoder\b|\bload\s*cell\b/i, type: "Sensors" },
  { test: /\b1734-[a-z0-9]+\b|\b1769-[a-z0-9]+\b|\b1756-[a-z0-9]+\b/i, type: "I/O" },
  { test: /\bpoint\s*i\/?o\b|\bflex\s*i\/?o\b|\bcompact\s*i\/?o\b/i, type: "I/O" },

  // Motors
  { test: /\binduction\s+motor\b|\bservo\s*motor\b|\bstepper\s*motor\b|\bgearmotor\b/i, type: "Motors" },
  { test: /\bnema\s*\d{2}\b/i, type: "Motors" },

  // Robots
  { test: /\bfanuc\b.*\br[ -]?\d{4}\b/i, type: "Robots" },
  { test: /\bkuka\b/i, type: "Robots" },

  // Network / industrial comms
  { test: /\bstratix\b|\bcisco\s+ie\d{3,4}\b/i, type: "Networking" },
  { test: /\bethernet\/?ip\b|\bprofinet\b|\bmodbus\b|\bdevicenet\b/i, type: "Networking" },
];

const MANUFACTURER_DEFAULTS: Record<string, string> = {
  "allen-bradley": "PLCs",
  "rockwell": "PLCs",
  "siemens": "PLCs",
  "mitsubishi": "PLCs",
  "omron": "PLCs",
  "automationdirect": "PLCs",
  "abb": "VFDs",
  "yaskawa": "VFDs",
  "schneider": "VFDs",
  "schneider electric": "VFDs",
  "danfoss": "VFDs",
  "fanuc": "Robots",
  "kuka": "Robots",
  "wago": "I/O",
  "phoenix contact": "I/O",
  "turck": "Sensors",
  "banner": "Sensors",
  "ifm": "Sensors",
  "keyence": "Sensors",
  "pepperl+fuchs": "Sensors",
};

export function inferEquipmentType(opts: {
  equipmentType?: string | null;
  modelNumber?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  manufacturer?: string | null;
}): string {
  // Trust the column when it's populated.
  const explicit = (opts.equipmentType ?? "").trim();
  if (explicit) return normalizeTypeLabel(explicit);

  const haystack = [opts.modelNumber, opts.title, opts.sourceUrl]
    .filter(Boolean)
    .join(" ");

  for (const hint of MODEL_HINTS) {
    if (hint.test.test(haystack)) return hint.type;
  }

  const mfrKey = NORMALIZE(opts.manufacturer);
  for (const key of Object.keys(MANUFACTURER_DEFAULTS)) {
    if (mfrKey.includes(key)) return MANUFACTURER_DEFAULTS[key];
  }

  return "Other";
}

// Map varied DB labels to the canonical UNS bucket names used in the UI.
function normalizeTypeLabel(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/^(vfd|drive|inverter|ac[\s-]?drive)/.test(s)) return "VFDs";
  if (/^(plc|programmable|controller)/.test(s)) return "PLCs";
  if (/^(hmi|panel|touch)/.test(s)) return "HMIs";
  if (/^(servo|motion)/.test(s)) return "Servos";
  if (/^(sensor|prox|photoeye)/.test(s)) return "Sensors";
  if (/^(motor|gearmotor)/.test(s)) return "Motors";
  if (/^(robot)/.test(s)) return "Robots";
  if (/^(io|i\/o|i-o)/.test(s)) return "I/O";
  if (/^(network|switch|router)/.test(s)) return "Networking";
  if (/^(software|firmware|tool)/.test(s)) return "Software";
  // Title-case anything else so UI has a stable label.
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
