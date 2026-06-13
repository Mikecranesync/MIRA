// GS10 DURApulse register decode tables — transcribed from the DURApulse GS10 AC Drive
// User Manual, 1st Ed. Rev B (NOT the GS1 — different numbering throughout):
//   fault codes:  p5-4 "Status Addresses", register 0x2100 low byte (= P06.17 fault record)
//   warn codes:   p6-8..6-16 "Warning Codes" ID No. column, register 0x2100 high byte
//   status bits:  p4-196 / p5-5, register 0x2101 "Status Monitor 2"
// Pure data — no DOM, no fetch — so the adapter mapping is unit-testable (gs10.test.mjs).
// The Python twin of the fault table lives in plc/conv_simple_anomaly/rules.py.

// 0x2100 low byte — fault/error codes.
export const GS10_FAULT_CODES = Object.freeze({
  0: "No fault",
  1: "ocA (overcurrent accel)", 2: "ocd (overcurrent decel)", 3: "ocn (overcurrent run)",
  4: "GFF (ground fault)", 6: "ocS (overcurrent at stop)",
  7: "ovA (overvoltage accel)", 8: "ovd (overvoltage decel)", 9: "ovn (overvoltage run)",
  10: "ovS (overvoltage stop)",
  11: "LvA (low voltage accel)", 12: "Lvd (low voltage decel)", 13: "Lvn (low voltage run)",
  14: "LvS (low voltage stop)",
  15: "OrP (input phase loss)", 16: "oH1 (IGBT overheat)", 18: "tH1o (IGBT temp sensor)",
  21: "oL (overload 150%/1min)", 22: "EoL1 (motor 1 thermal)", 23: "EoL2 (motor 2 thermal)",
  24: "oH3 (motor overheat PTC)", 26: "ot1 (over-torque 1)", 27: "ot2 (over-torque 2)",
  28: "uc (under current)", 31: "cF2 (EEPROM read)",
  33: "cd1 (U current sensor)", 34: "cd2 (V current sensor)", 35: "cd3 (W current sensor)",
  36: "Hd0 (cc hardware)", 37: "Hd1 (oc hardware)",
  40: "AuE (motor auto-tune)", 41: "AFE (PID feedback loss)", 48: "ACE (analog input loss)",
  49: "EF (external fault)", 50: "EF1 (emergency stop)", 51: "bb (base block)",
  52: "Pcod (password error)",
  54: "CE1 (PC command error)", 55: "CE2 (PC address error)", 56: "CE3 (PC data error)",
  57: "CE4 (PC slave error)", 58: "CE10 (comm timeout)",
  63: "oSL (over slip)",
  82: "UPHL (U phase loss)", 83: "VPHL (V phase loss)", 84: "WPHL (W phase loss)",
  87: "oL3 (low-freq overload)",
  140: "Hd6 (oc hardware)", 141: "b4GF (GFF before run)",
  142: "AUE1 (auto-tune 1)", 143: "AUE2 (auto-tune 2)", 144: "AUE3 (auto-tune 3)",
  149: "AUE5 (total resistance)", 150: "AUE6 (no-load current)", 151: "AUE7 (dq inductance)",
  152: "AUE8 (HF injection)", 157: "dEv (pump PID feedback)", 159: "Hd7 (gate driver)",
});

// 0x2100 high byte — warning codes ("ID No." column of the manual's Warning Codes table).
export const GS10_WARN_CODES = Object.freeze({
  0: "No warning",
  3: "CE3 (Modbus illegal data value)", 4: "CE4 (write to read-only address)",
  5: "CE10 (Modbus transmission timeout)",
  7: "SE1 (keypad copy timeout)", 8: "SE2 (keypad copy write error)",
  9: "oH1 (IGBT overheating)", 11: "PID (PID feedback error)",
  12: "AnL (analog signal loss)", 13: "uC (under current)",
  20: "ot1 (over-torque 1)", 21: "ot2 (over-torque 2)", 22: "oH3 (motor overheating)",
  24: "oSL (over slip)", 25: "tUn (auto-tuning in process)",
  28: "oPHL (output phase loss)", 30: "SE3 (copy model error)",
  102: "dEb (decel energy backup)", 103: "dEv (PID feedback fault)",
});

// 0x2101 Status Monitor 2 — genuinely single-bit flags (manual p4-196). The store derives
// each into a trendable boolean step lane.
export const GS10_STATUS_BITS = Object.freeze({
  2: "JOG Active",
  8: "Freq From Comms",
  9: "Freq From Analog/Terminal",
  10: "Run Cmd From Comms",
  11: "Parameters Locked",
  12: "Keypad Copy Enabled",
});

// 0x2101 multi-bit fields — operation status (bits 1–0) and direction (bits 4–3) are 2-bit
// enums, NOT independent flags; decoding them per-bit would lie to the operator. Each field
// becomes a derived ENUM child tag: value = (word >> shift) & mask, displayed via states.
export const GS10_STATUS_FIELDS = Object.freeze([
  {
    key: "op_status", label: "Operation Status", shift: 0, mask: 0b11,
    states: { 0: "Stopped", 1: "Decelerating", 2: "Standby", 3: "Operating" },
  },
  {
    key: "direction", label: "Direction", shift: 3, mask: 0b11,
    states: { 0: "FWD", 1: "REV→FWD", 2: "FWD→REV", 3: "REV" },
  },
]);
