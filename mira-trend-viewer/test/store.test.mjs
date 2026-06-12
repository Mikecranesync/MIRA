import { test } from "node:test";
import assert from "node:assert/strict";
import { TrendStore } from "../js/store.js";
import { createTag, SourceType, Quality } from "../js/model.js";

function seed() {
  const store = new TrendStore();
  store.setTags([
    createTag({ id: "VFD1.out_freq", sourceType: SourceType.VFD, displayName: "Output Frequency",
      deviceId: "VFD1", engineeringUnits: "Hz", currentValue: 45 }),
    createTag({ id: "VFD1.run_cmd", sourceType: SourceType.VFD, displayName: "Run Command",
      deviceId: "VFD1", currentValue: 1 }),
    createTag({ id: "AI.temp", sourceType: SourceType.ANALOG_INPUT, displayName: "Tank Temp",
      engineeringUnits: "°C", currentValue: 72 }),
    createTag({ id: "AI.locked", sourceType: SourceType.ANALOG_INPUT, currentValue: 1, trendable: false }),
  ]);
  return store;
}

test("selecting a pen sets selectedForTrend and seeds history; bidirectional with isSelected", () => {
  const s = seed();
  assert.equal(s.isSelected("AI.temp"), false);
  s.selectPen("AI.temp");
  assert.equal(s.isSelected("AI.temp"), true);
  assert.equal(s.getTag("AI.temp").selectedForTrend, true);   // checkbox reads this
  assert.equal(s.getPens().length, 1);
  assert.equal(s.getHistory("AI.temp").length, 1, "seeded with current value");
});

test("deselect removes pen + history; pen-list remove == uncheck in browser", () => {
  const s = seed();
  s.selectPen("AI.temp");
  s.deselectPen("AI.temp");
  assert.equal(s.isSelected("AI.temp"), false);
  assert.equal(s.getPens().length, 0);
  assert.equal(s.getHistory("AI.temp").length, 0);
});

test("togglePen flips selection", () => {
  const s = seed();
  s.togglePen("VFD1.out_freq"); assert.equal(s.isSelected("VFD1.out_freq"), true);
  s.togglePen("VFD1.out_freq"); assert.equal(s.isSelected("VFD1.out_freq"), false);
});

test("non-trendable tag cannot be selected", () => {
  const s = seed();
  s.selectPen("AI.locked");
  assert.equal(s.isSelected("AI.locked"), false);
  assert.equal(s.getPens().length, 0);
});

test("pens get distinct colors in selection order", () => {
  const s = seed();
  s.selectPen("AI.temp"); s.selectPen("VFD1.out_freq");
  const pens = s.getPens();
  assert.deepEqual(pens.map((p) => p.tag.id), ["AI.temp", "VFD1.out_freq"]);
  assert.notEqual(pens[0].color, pens[1].color);
});

test("clearPens removes everything and unchecks all", () => {
  const s = seed();
  s.selectPen("AI.temp"); s.selectPen("VFD1.run_cmd");
  s.clearPens();
  assert.equal(s.getPens().length, 0);
  assert.equal(s.isSelected("AI.temp"), false);
  assert.equal(s.isSelected("VFD1.run_cmd"), false);
});

test("updateValues appends history only for selected pens, and not while paused", () => {
  const s = seed();
  s.selectPen("AI.temp");
  s.updateValues([{ id: "AI.temp", currentValue: 73 }, { id: "VFD1.run_cmd", currentValue: 0 }], 1000);
  assert.equal(s.getHistory("AI.temp").length, 2);                 // seed + 1 update
  assert.equal(s.getHistory("VFD1.run_cmd").length, 0);            // not selected
  s.setPaused(true);
  s.updateValues([{ id: "AI.temp", currentValue: 74 }], 2000);
  assert.equal(s.getHistory("AI.temp").length, 2, "paused freezes history");
  assert.equal(s.getTag("AI.temp").currentValue, 74, "live value still updates while paused");
});

test("setTags preserves selection across a re-browse", () => {
  const s = seed();
  s.selectPen("AI.temp");
  s.setTags([createTag({ id: "AI.temp", sourceType: SourceType.ANALOG_INPUT, currentValue: 99 })]);
  assert.equal(s.isSelected("AI.temp"), true);
  assert.equal(s.getPens().length, 1);
});

test("toCSV emits header with units and sample-and-hold aligned rows", () => {
  const s = seed();
  s.selectPen("AI.temp");
  s.updateValues([{ id: "AI.temp", currentValue: 73 }], 1000);
  s.updateValues([{ id: "AI.temp", currentValue: 74 }], 2000);
  const csv = s.toCSV();
  const lines = csv.trim().split("\n");
  assert.match(lines[0], /Tank Temp \(°C\)/);
  assert.equal(lines.length >= 3, true);
  assert.match(lines[lines.length - 1], /,74$/);
});

test("scale/offset applied centrally at ingest (raw counts -> engineering)", () => {
  const s = new TrendStore();
  // a raw-count analog tag: 0..27648 raw -> 0..100% via scale, like a Modbus register
  s.setTags([createTag({ id: "raw.pct", sourceType: SourceType.ANALOG_INPUT,
    scale: 100 / 27648, offset: 0, currentValue: 13824 })]);
  assert.equal(Math.round(s.getTag("raw.pct").currentValue), 50, "setTags scales initial value");
  s.selectPen("raw.pct");
  s.updateValues([{ id: "raw.pct", currentValue: 27648 }], 1000);
  assert.equal(Math.round(s.getTag("raw.pct").currentValue), 100, "updateValues scales raw");
  assert.equal(Math.round(s.getHistory("raw.pct").at(-1).v), 100, "history stores engineering value");
});

test("subscribe fires on mutation and unsubscribe stops it", () => {
  const s = seed();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.selectPen("AI.temp");
  assert.equal(n > 0, true);
  off();
  const before = n;
  s.deselectPen("AI.temp");
  assert.equal(n, before, "no callback after unsubscribe");
});
