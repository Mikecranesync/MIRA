import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTag, groupTags, isDigitalTag, formatValue, unitLabel, rangeLabel,
  formatTimestamp, qualityLabel, SourceType, DataType, Quality,
} from "../js/model.js";

test("createTag fills safe defaults and requires id", () => {
  assert.throws(() => createTag({}));
  const t = createTag({ id: "x", sourceType: SourceType.ANALOG_INPUT });
  assert.equal(t.displayName, "x");
  assert.equal(t.quality, Quality.GOOD);
  assert.equal(t.trendable, true);
  assert.equal(t.selectedForTrend, false);
});

test("groupTags returns the 5 fixed groups and sub-groups VFDs by device", () => {
  const tags = [
    createTag({ id: "VFD1.out_freq", sourceType: SourceType.VFD, deviceId: "VFD1", deviceName: "VFD 1" }),
    createTag({ id: "VFD1.dc_bus", sourceType: SourceType.VFD, deviceId: "VFD1", deviceName: "VFD 1" }),
    createTag({ id: "VFD2.out_freq", sourceType: SourceType.VFD, deviceId: "VFD2", deviceName: "VFD 2" }),
    createTag({ id: "AI.temp", sourceType: SourceType.ANALOG_INPUT }),
    createTag({ id: "DO.lamp", sourceType: SourceType.DIGITAL_OUTPUT }),
  ];
  const groups = groupTags(tags);
  assert.equal(groups.length, 5);
  assert.deepEqual(groups.map((g) => g.type), [
    SourceType.VFD, SourceType.ANALOG_INPUT, SourceType.ANALOG_OUTPUT,
    SourceType.DIGITAL_INPUT, SourceType.DIGITAL_OUTPUT,
  ]);
  const vfd = groups[0];
  assert.equal(vfd.devices.length, 2, "two distinct VFD devices");
  assert.equal(vfd.devices.find((d) => d.deviceId === "VFD1").tags.length, 2);
});

test("isDigitalTag: DI/DO and boolean are digital, analog float is not", () => {
  assert.equal(isDigitalTag(createTag({ id: "a", sourceType: SourceType.DIGITAL_INPUT })), true);
  assert.equal(isDigitalTag(createTag({ id: "b", sourceType: SourceType.DIGITAL_OUTPUT })), true);
  assert.equal(isDigitalTag(createTag({ id: "c", sourceType: SourceType.VFD, dataType: DataType.BOOLEAN })), true);
  assert.equal(isDigitalTag(createTag({ id: "d", sourceType: SourceType.ANALOG_INPUT, dataType: DataType.FLOAT })), false);
  assert.equal(isDigitalTag(createTag({ id: "e", sourceType: SourceType.VFD, dataType: DataType.FLOAT })), false);
});

test("formatValue: digital ON/OFF, enum states, numeric, n/a, stale dash", () => {
  const di = createTag({ id: "x", sourceType: SourceType.DIGITAL_INPUT, currentValue: 1 });
  assert.equal(formatValue(di), "ON");
  di.currentValue = 0; assert.equal(formatValue(di), "OFF");
  const en = createTag({ id: "f", sourceType: SourceType.VFD, dataType: DataType.ENUM,
    states: { 0: "No fault", 6: "oH (overheat)" }, currentValue: 6 });
  assert.equal(formatValue(en), "oH (overheat)");
  const an = createTag({ id: "a", sourceType: SourceType.ANALOG_INPUT, currentValue: 3.14159 });
  assert.equal(formatValue(an), "3.14");
  const none = createTag({ id: "n", sourceType: SourceType.ANALOG_INPUT, currentValue: null });
  assert.equal(formatValue(none), "n/a");
  const stale = createTag({ id: "s", sourceType: SourceType.ANALOG_INPUT, currentValue: null, quality: Quality.STALE });
  assert.equal(formatValue(stale), "—");
});

test("formatValue: WORD renders as 4-digit hex, not bare decimal", () => {
  const w = createTag({ id: "sw", sourceType: SourceType.VFD, dataType: DataType.WORD, currentValue: 7 });
  assert.equal(formatValue(w), "0x0007");
  w.currentValue = 32; assert.equal(formatValue(w), "0x0020");
});

test("unit + range labels handle unitless and missing range cleanly", () => {
  const unitless = createTag({ id: "u", sourceType: SourceType.VFD, dataType: DataType.WORD });
  assert.equal(unitLabel(unitless), "");
  assert.equal(rangeLabel(unitless), "");
  const ranged = createTag({ id: "r", sourceType: SourceType.ANALOG_INPUT, engineeringUnits: "psi", min: 0, max: 150 });
  assert.equal(rangeLabel(ranged), "0–150 psi");
});

test("formatTimestamp returns honest 'timestamp unavailable' on null/invalid", () => {
  assert.equal(formatTimestamp(null), "timestamp unavailable");
  assert.equal(formatTimestamp("not-a-date"), "timestamp unavailable");
  assert.match(formatTimestamp(Date.UTC(2026, 0, 1, 12, 0, 0)), /\d\d:\d\d:\d\d/);
});

test("qualityLabel covers all states", () => {
  assert.equal(qualityLabel(createTag({ id: "g", sourceType: SourceType.ANALOG_INPUT, quality: Quality.GOOD })), "GOOD");
  assert.equal(qualityLabel(createTag({ id: "b", sourceType: SourceType.ANALOG_INPUT, quality: Quality.BAD })), "BAD");
  assert.equal(qualityLabel(createTag({ id: "s", sourceType: SourceType.ANALOG_INPUT, quality: Quality.STALE })), "STALE");
});
