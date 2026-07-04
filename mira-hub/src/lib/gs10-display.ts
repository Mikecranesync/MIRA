/**
 * GS10 raw-register → display formatting for the CV-101 live-signal tags.
 * PURE, no framework imports.
 *
 * Source of truth for divisors: ignition/webdev/FactoryLM/api/diagnose/
 * tag_topic_map.py LEAF_MAP (parity-pinned by gs10-display.test.ts — edit
 * that file first, then mirror here). Status/cmd word decode transcribed from
 * mira-trend-viewer/js/adapters/gs10.js (GS10 UM 1st Ed Rev B).
 * ⚠️ plc/live_monitor.py divides freq/current by 10 — that is WRONG for the
 * V2.1 MIRA_IOCheck tags (÷100); do not "fix" this file against it.
 *
 * Static map by design (phase decision 2026-07-04): tag_entities.units/
 * scaling (migration 025) is the eventual DB-driven home; nothing writes it
 * yet, so a lookup there would render nothing.
 */

interface ScaleSpec {
  divisor: number;
  unit: string;
}

/** Leaf tag name (last "/" segment, as-is) → divisor + unit. */
const SCALE_BY_LEAF: Record<string, ScaleSpec> = {
  // MIRA_IOCheck/VFD raw V2.1 registers
  vfd_dc_bus: { divisor: 10, unit: "V" },
  vfd_frequency: { divisor: 100, unit: "Hz" },
  vfd_freq_cmd: { divisor: 100, unit: "Hz" },
  vfd_freq_sp: { divisor: 100, unit: "Hz" }, // raw V2.1 setpoint mirror of freq_cmd
  vfd_current: { divisor: 100, unit: "A" },
  vfd_torque: { divisor: 10, unit: "%" },
  vfd_power: { divisor: 1000, unit: "kW" },
  vfd_motor_rpm: { divisor: 1, unit: "rpm" },
  // Conveyor/ engineering-unit tags (already scaled; unit label only)
  vfd_hz: { divisor: 1, unit: "Hz" },
  vfd_amps: { divisor: 1, unit: "A" },
  vfd_dcbus_v: { divisor: 1, unit: "V" },
  vfd_setpoint_hz: { divisor: 1, unit: "Hz" },
  // Conveyor/ raw fallbacks (÷10 per LEAF_MAP)
  vfd_outputfreq_raw: { divisor: 10, unit: "Hz" },
  vfd_outputcurrent_raw: { divisor: 10, unit: "A" },
  vfd_dcbus_raw: { divisor: 10, unit: "V" },
  vfd_freqsetpoint_raw: { divisor: 10, unit: "Hz" },
};

/** GS10 0x2101 op_status bits 1–0 (2-bit enum). */
const OP_STATUS: Record<number, string> = {
  0: "Stopped",
  1: "Decelerating",
  2: "Standby",
  3: "Operating",
};

/** GS10 0x2101 direction bits 4–3 (2-bit enum). */
const DIRECTION: Record<number, string> = {
  0: "FWD",
  1: "REV→FWD",
  2: "FWD→REV",
  3: "REV",
};

/** GS10 0x2000 command word — run values per rules_core DEFAULT_CFG (18, 34). */
const CMD_WORD: Record<number, string> = {
  0: "—",
  1: "STOP",
  18: "RUN FWD",
  34: "RUN REV",
};

export interface FormattedTag {
  /** Human display string, e.g. "328.6 V", "Stopped · FWD", "true". */
  display: string;
  /** Scaled numeric (engineering units) when the tag is numeric, else null. */
  numeric: number | null;
  unit: string | null;
}

function leafName(tagPath: string): string {
  const s = String(tagPath);
  const i = s.lastIndexOf("/");
  return (i >= 0 ? s.slice(i + 1) : s).toLowerCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Trim trailing zeros but keep meaningful precision (328.6, 30, 0.5). */
function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

export function formatTagValue(tagPath: string, raw: unknown): FormattedTag {
  const leaf = leafName(tagPath);

  if (raw === null || raw === undefined) {
    return { display: "—", numeric: null, unit: null };
  }

  const n = asNumber(raw);

  if (leaf === "vfd_status_word" && n !== null) {
    const word = n | 0;
    const op = OP_STATUS[word & 0b11] ?? `op ${word & 0b11}`;
    const dir = DIRECTION[(word >> 3) & 0b11] ?? "";
    const comms = word & (1 << 10) ? " · comms" : "";
    return { display: `${op} · ${dir}${comms}`, numeric: word, unit: null };
  }
  if (leaf === "vfd_cmd_word" && n !== null) {
    const word = n | 0;
    return { display: CMD_WORD[word] ?? `cmd ${word}`, numeric: word, unit: null };
  }
  if ((leaf === "vfd_fault_code" || leaf === "vfd_warn_code") && n !== null) {
    const code = n | 0;
    return { display: code === 0 ? "OK" : `code ${code}`, numeric: code, unit: null };
  }

  const spec = SCALE_BY_LEAF[leaf];
  if (spec && n !== null) {
    const scaled = n / spec.divisor;
    return { display: `${fmt(scaled)} ${spec.unit}`, numeric: scaled, unit: spec.unit };
  }

  // Booleans / strings / unmapped numerics pass through unchanged.
  if (n !== null) return { display: fmt(n), numeric: n, unit: null };
  return { display: String(raw), numeric: null, unit: null };
}
