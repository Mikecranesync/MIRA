// Trends V2 — real GS10 decode tables + multi-bit field derivation.
// Verifies the manual-transcribed tables are wired end to end: classify() declares them,
// the model derives ENUM field children, and the store fans parent updates out to them.

import test from "node:test";
import assert from "node:assert/strict";

import { GS10_FAULT_CODES, GS10_WARN_CODES, GS10_STATUS_BITS, GS10_STATUS_FIELDS }
  from "../js/adapters/gs10.js";
import { classify } from "../js/adapters/historianAdapter.js";
import { createTag, wordFieldTags, SourceType, DataType, formatValue } from "../js/model.js";
import { TrendStore } from "../js/store.js";

// ── decode tables (spot checks against GS10 UM 1st Ed Rev B) ─────────────────────────────

test("GS10 fault table carries the manual's codes, not the mock placeholders", () => {
  assert.equal(GS10_FAULT_CODES[0], "No fault");
  assert.match(GS10_FAULT_CODES[1], /ocA/);      // overcurrent accel (manual p5-4)
  assert.match(GS10_FAULT_CODES[21], /oL/);      // overload
  assert.match(GS10_FAULT_CODES[49], /EF/);      // external fault
  assert.match(GS10_FAULT_CODES[58], /CE10/);    // comm timeout — the bench classic
  assert.match(GS10_FAULT_CODES[159], /Hd7/);    // gate driver (table tail present)
});

test("GS10 warn table uses the Warning Codes ID numbers (≠ fault numbering)", () => {
  assert.match(GS10_WARN_CODES[5], /CE10/);      // warn id 5 = comm timeout (fault id is 58)
  assert.match(GS10_WARN_CODES[25], /tUn/);      // auto-tuning in process
  assert.match(GS10_WARN_CODES[102], /dEb/);
});

test("GS10 status word: single bits + 2-bit packed fields per Status Monitor 2", () => {
  assert.equal(GS10_STATUS_BITS[2], "JOG Active");
  assert.equal(GS10_STATUS_BITS[10], "Run Cmd From Comms");
  const op = GS10_STATUS_FIELDS.find((f) => f.key === "op_status");
  assert.deepEqual({ shift: op.shift, mask: op.mask }, { shift: 0, mask: 3 });
  assert.equal(op.states[3], "Operating");
  const dir = GS10_STATUS_FIELDS.find((f) => f.key === "direction");
  assert.deepEqual({ shift: dir.shift, mask: dir.mask }, { shift: 3, mask: 3 });
  assert.equal(dir.states[3], "REV");
});

// ── classify() wiring ─────────────────────────────────────────────────────────────────────

test("classify maps the V2 vfd_* tags to ENUM/WORD with the GS10 tables", () => {
  const err = classify("vfd_error_code");
  assert.equal(err.dataType, DataType.ENUM);
  assert.equal(err.states, GS10_FAULT_CODES);
  const last = classify("vfd_last_fault");
  assert.equal(last.states, GS10_FAULT_CODES);
  assert.match(last.description, /persists/);
  const warn = classify("vfd_warn_code");
  assert.equal(warn.states, GS10_WARN_CODES);
  const word = classify("vfd_status_word");
  assert.equal(word.dataType, DataType.WORD);
  assert.equal(word.bits, GS10_STATUS_BITS);
  assert.equal(word.fields, GS10_STATUS_FIELDS);
  // plain analogs stay FLOAT under the GS10 device card
  const rpm = classify("vfd_motor_rpm");
  assert.equal(rpm.dataType, DataType.FLOAT);
  assert.equal(rpm.deviceId, "GS10");
});

// ── field child derivation + store fan-out ───────────────────────────────────────────────

function statusWordTag(value) {
  return createTag({
    id: "vfd_status_word", sourceType: SourceType.VFD, dataType: DataType.WORD,
    deviceId: "GS10", bits: GS10_STATUS_BITS, fields: GS10_STATUS_FIELDS,
    currentValue: value,
  });
}

test("wordFieldTags derives ENUM children decoded from the packed fields", () => {
  // 0b0000_0100_0001_1011: op=11 (Operating), JOG=0, dir bits4-3=11 (REV), bit10=1
  const kids = wordFieldTags(statusWordTag(0b0000010000011011));
  const op = kids.find((k) => k.id === "vfd_status_word.op_status");
  assert.equal(op.dataType, DataType.ENUM);
  assert.equal(op.currentValue, 3);
  assert.equal(formatValue(op), "Operating");
  const dir = kids.find((k) => k.id === "vfd_status_word.direction");
  assert.equal(formatValue(dir), "REV");
});

test("store fans a status-word update out to bit AND field children", () => {
  const store = new TrendStore();
  store.setTags([statusWordTag(0)]);
  assert.equal(formatValue(store.getTag("vfd_status_word.op_status")), "Stopped");
  // drive starts: operating + run-cmd-from-comms (bit 10)
  store.updateValues([{ id: "vfd_status_word", currentValue: (1 << 10) | 0b11,
    quality: "good", timestamp: 1000 }]);
  assert.equal(store.getTag("vfd_status_word.op_status").currentValue, 3);
  assert.equal(formatValue(store.getTag("vfd_status_word.op_status")), "Operating");
  assert.equal(store.getTag("vfd_status_word.b10").currentValue, 1);
  // decelerating: op field steps to 1, bit child unaffected
  store.updateValues([{ id: "vfd_status_word", currentValue: (1 << 10) | 0b01,
    quality: "good", timestamp: 2000 }]);
  assert.equal(formatValue(store.getTag("vfd_status_word.op_status")), "Decelerating");
});

test("field children are selectable pens with decoded history", () => {
  const store = new TrendStore();
  store.setTags([statusWordTag(0)]);
  store.selectPen("vfd_status_word.op_status");
  store.updateValues([{ id: "vfd_status_word", currentValue: 0b11, quality: "good", timestamp: 1000 }]);
  store.updateValues([{ id: "vfd_status_word", currentValue: 0b00, quality: "good", timestamp: 2000 }]);
  const hist = store.getHistory("vfd_status_word.op_status");
  assert.deepEqual(hist.map((s) => s.v).slice(-2), [3, 0]);
});

test("null word value yields null field children (honest, not fake zero)", () => {
  const store = new TrendStore();
  store.setTags([statusWordTag(5)]);
  store.updateValues([{ id: "vfd_status_word", currentValue: null, quality: "stale", timestamp: 3000 }]);
  assert.equal(store.getTag("vfd_status_word.op_status").currentValue, null);
});
