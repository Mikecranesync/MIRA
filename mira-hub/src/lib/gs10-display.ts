/**
 * GS10 raw-register → display formatting for the CV-101 live-signal tags.
 * PURE, no framework imports.
 *
 * Source of truth for divisors: ignition/webdev/FactoryLM/api/diagnose/
 * tag_topic_map.py LEAF_MAP (parity-pinned by gs10-display.test.ts — edit
 * that file first, then mirror here).
 *
 * The `status_bits`/`cmd_word`/register-scaling FACTS (which numeric codes
 * exist, what they mean, and the scaling factor) are sourced from the shared
 * `durapulse_gs10` drive pack (`packs/durapulse_gs10/pack.json`) via
 * `./drive-packs/loader`, the same pack `mira-bots/shared/live_snapshot.py`
 * loads — ADR-0025 §1 (one pack file, both Python and TS). This file still
 * owns its own DISPLAY WORDING ("RUN FWD" vs the pack's raw "FWD+RUN") via the
 * `*_LABELS` translation tables below; the pack's job is the enum *domain*
 * (which codes are valid), not this component's presentation copy. A pack
 * code with no translation entry throws at import — fail loud, not a silent
 * fallback to the raw pack string.
 *
 * `direction` (FWD/REV, bits 4–3) has no pack equivalent — DURApulse GS10
 * register 0x2101 packs direction and operation-status into the same word,
 * but the pack schema's `status_bits` only models operation status. Kept
 * hardcoded here until the pack schema grows a direction table.
 *
 * ⚠️ plc/live_monitor.py divides freq/current by 10 — that is WRONG for the
 * V2.1 MIRA_IOCheck tags (÷100); do not "fix" this file against it.
 *
 * Static map by design (phase decision 2026-07-04): tag_entities.units/
 * scaling (migration 025) is the eventual DB-driven home; nothing writes it
 * yet, so a lookup there would render nothing.
 */
import { GS10_PACK } from "./drive-packs/loader";

interface ScaleSpec {
  divisor: number;
  unit: string;
}

/** The 4 raw MIRA_IOCheck leaves the pack's `live_decode.registers` covers. */
const PACK_REGISTER_LEAVES = [
  "vfd_dc_bus",
  "vfd_frequency",
  "vfd_freq_sp",
  "vfd_current",
] as const;

const _missingPackRegisters = PACK_REGISTER_LEAVES.filter(
  (leaf) => !(leaf in GS10_PACK.live_decode.registers),
);
if (_missingPackRegisters.length > 0) {
  throw new Error(
    `gs10-display: durapulse_gs10 pack is missing required register key(s) ` +
      `${_missingPackRegisters.join(", ")} — this module decodes these directly`,
  );
}

/** `divisor` is the inverse of the pack's `scaling` (e.g. scaling 0.01 → ÷100). */
function scaleSpecFromPack(leaf: (typeof PACK_REGISTER_LEAVES)[number]): ScaleSpec {
  const reg = GS10_PACK.live_decode.registers[leaf];
  return { divisor: 1 / reg.scaling, unit: reg.unit };
}

/** Leaf tag name (last "/" segment, as-is) → divisor + unit. */
const SCALE_BY_LEAF: Record<string, ScaleSpec> = {
  // MIRA_IOCheck/VFD raw V2.1 registers — sourced from the durapulse_gs10 pack.
  vfd_dc_bus: scaleSpecFromPack("vfd_dc_bus"),
  vfd_frequency: scaleSpecFromPack("vfd_frequency"),
  vfd_freq_sp: scaleSpecFromPack("vfd_freq_sp"), // raw V2.1 setpoint mirror of freq_cmd
  vfd_current: scaleSpecFromPack("vfd_current"),
  // Not in the pack's register table (yet) — stays hardcoded.
  vfd_freq_cmd: { divisor: 100, unit: "Hz" },
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

/**
 * GS10 0x2101 op_status bits 1–0 (2-bit enum) — codes sourced from the pack's
 * `live_decode.status_bits`; display wording is this component's own copy.
 */
const OP_STATUS_LABELS: Record<string, string> = {
  STOPPED: "Stopped",
  DECEL: "Decelerating",
  STANDBY: "Standby",
  RUNNING: "Operating",
};

function buildOpStatus(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [code, raw] of Object.entries(GS10_PACK.live_decode.status_bits)) {
    const label = OP_STATUS_LABELS[raw];
    if (!label) {
      throw new Error(
        `gs10-display: no display label mapped for pack status_bits value '${raw}' (code ${code})`,
      );
    }
    out[Number(code)] = label;
  }
  return out;
}

const OP_STATUS: Record<number, string> = buildOpStatus();

/** GS10 0x2101 direction bits 4–3 (2-bit enum) — no pack equivalent, see header. */
const DIRECTION: Record<number, string> = {
  0: "FWD",
  1: "REV→FWD",
  2: "FWD→REV",
  3: "REV",
};

/**
 * GS10 0x2000 command word — codes sourced from the pack's `live_decode.cmd_word`
 * ({1: STOP, 18: FWD+RUN, 34: REV+RUN}); display wording is this component's
 * own copy. `0` ("no command word seen yet") has no pack entry — kept as a
 * local default.
 */
const CMD_WORD_LABELS: Record<string, string> = {
  STOP: "STOP",
  "FWD+RUN": "RUN FWD",
  "REV+RUN": "RUN REV",
};

function buildCmdWord(): Record<number, string> {
  const out: Record<number, string> = { 0: "—" };
  for (const [code, raw] of Object.entries(GS10_PACK.live_decode.cmd_word)) {
    const label = CMD_WORD_LABELS[raw];
    if (!label) {
      throw new Error(
        `gs10-display: no display label mapped for pack cmd_word value '${raw}' (code ${code})`,
      );
    }
    out[Number(code)] = label;
  }
  return out;
}

const CMD_WORD: Record<number, string> = buildCmdWord();

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
