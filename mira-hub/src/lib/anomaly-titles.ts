/**
 * Canonical technician-facing titles for the A0–A12 anomaly rules.
 *
 * PORTED from the single source of truth, plc/conv_simple_anomaly/rules_core.py
 * (the `Anomaly("<RULE_ID>", <sev>, "<title>", …)` literals). Parity is
 * enforced by tests/regime7_ignition/test_anomaly_title_catalog_parity.py:
 * every rule title must match byte-for-byte, and this file may not name a
 * rule the brain does not define. Edit rules_core first, then this.
 *
 * Why this exists (Workstream C, PRD §9.2 / #3470): the historian persists an
 * anomaly's EVIDENCE TOPIC as `run_diff.tag_path` — for A0_OFFLINE that is
 * the pseudo-topic `_stale_s` — and (before this workstream) not its title.
 * Composing a title from the tag leaf produced "offline on _stale_s" in the
 * technician's fault header. The title is a rule property, not a tag property.
 */
export const ANOMALY_TITLES: Readonly<Record<string, string>> = {
  A0_OFFLINE: "PLC/bridge offline",
  A1_COMM_STALE: "GS10 RS-485 link down",
  A2_VFD_FAULT: "GS10 drive fault active",
  A3_ESTOP_WIRING: "E-stop wiring fault",
  A4_DIRECTION_FAULT: "Direction fault",
  A5_ILLEGAL_RUN: "Belt running while not permitted",
  A6_DRIVE_NOT_RESPONDING: "Drive not responding to RUN",
  A7_FREQ_NOT_TRACKING: "Output Hz not tracking setpoint",
  A8_OVERCURRENT: "VFD output over motor FLA",
  A9_DC_BUS: "DC bus voltage out of range",
  A10_FREQ_STUCK_ZERO: "Output frequency stuck at zero",
  A12_PHOTOEYE_JAM: "Photo-eye soft-stop (jam/blockage)",
};

/** The rules' temporal pseudo-topics (derived facts, not PLC tags). A leading
 *  underscore marks them (`_stale_s`, `_freq_frozen_s`, …); they are never a
 *  name a technician should read. */
export function isPseudoTopic(tagPath: string): boolean {
  const leaf = tagPath.split(/[./]/).filter(Boolean).pop() ?? tagPath;
  return leaf.startsWith("_");
}
