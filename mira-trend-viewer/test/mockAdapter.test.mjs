import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAdapter } from "../js/adapters/mockAdapter.js";
import { groupTags, SourceType, Quality, isDigitalTag, formatValue } from "../js/model.js";
import { TrendStore } from "../js/store.js";

test("browse returns a catalog spanning all 5 groups with 3 VFD devices", async () => {
  const a = new MockAdapter();
  await a.connect();
  const tags = await a.browse();
  const groups = groupTags(tags);
  for (const g of groups) assert.equal(g.tags.length > 0, true, `${g.type} has tags`);
  assert.equal(groups[0].devices.length, 3, "three VFDs");
  // each VFD exposes the full register set incl. analog + digital/status points
  const vfd1 = groups[0].devices.find((d) => d.deviceId === "VFD1");
  const ids = vfd1.tags.map((t) => t.id.split(".")[1]);
  for (const reg of ["out_freq", "out_current", "dc_bus", "fault_code", "run_cmd", "direction", "comm_ok"]) {
    assert.equal(ids.includes(reg), true, `VFD1 has ${reg}`);
  }
});

test("VFD has both analog (continuous) and digital (step) registers", async () => {
  const a = new MockAdapter();
  const tags = await a.browse();
  const byId = new Map(tags.map((t) => [t.id, t]));
  assert.equal(isDigitalTag(byId.get("VFD1.out_freq")), false, "frequency is analog");
  assert.equal(isDigitalTag(byId.get("VFD1.run_cmd")), true, "run cmd is digital");
  assert.equal(isDigitalTag(byId.get("VFD1.comm_ok")), true, "comm ok is digital");
});

test("tick produces updates that change analog values over time", async () => {
  const a = new MockAdapter();
  await a.connect();
  const u0 = a.tick(a._t0 + 1000);
  const u1 = a.tick(a._t0 + 6000);
  const freq0 = u0.find((u) => u.id === "VFD1.out_freq").currentValue;
  const freq1 = u1.find((u) => u.id === "VFD1.out_freq").currentValue;
  assert.notEqual(freq0, freq1, "output frequency moves between ticks");
});

test("stale and uncertain tags report honest quality (not faked live)", async () => {
  const a = new MockAdapter();
  await a.connect();
  const u = a.tick(a._t0 + 1000);
  const stale = u.find((x) => x.id === "AI.ambient");
  assert.equal(stale.quality, Quality.STALE);
  assert.equal(stale.currentValue, null);
  const uncertain = u.find((x) => x.id === "AO.heater_cmd");
  assert.equal(uncertain.quality, Quality.UNCERTAIN);
});

test("the parked VFD3 reports stopped + a fault code", async () => {
  const a = new MockAdapter();
  await a.connect();
  const u = a.tick(a._t0 + 1000);
  assert.equal(u.find((x) => x.id === "VFD3.run_cmd").currentValue, 0);
  assert.equal(u.find((x) => x.id === "VFD3.fault_code").currentValue, 6);
  const tag = (await a.browse()).find((t) => t.id === "VFD3.fault_code");
  assert.equal(formatValue(tag), "oH (overheat)");
});

test("last_fault persists the previous trip after the active fault clears", async () => {
  const a = new MockAdapter();
  await a.connect();
  const u = a.tick(a._t0 + 1000);
  // VFD1 runs clean now — but the last-fault register still holds the intermittent trip
  assert.equal(u.find((x) => x.id === "VFD1.fault_code").currentValue, 0, "active fault cleared");
  const last = u.find((x) => x.id === "VFD1.last_fault").currentValue;
  assert.notEqual(last, 0, "last fault survives the reset");
  const tag = (await a.browse()).find((t) => t.id === "VFD1.last_fault");
  assert.match(formatValue(tag), /ocA/, "renders the fault mnemonic, not a bare number");
  // the faulted parked drive shows the same code in both registers
  assert.equal(u.find((x) => x.id === "VFD3.last_fault").currentValue,
    u.find((x) => x.id === "VFD3.fault_code").currentValue);
});

test("status word carries a bit map and decodes into trendable bit pens via the store", async () => {
  const a = new MockAdapter();
  await a.connect();
  const tags = await a.browse();
  const sw = tags.find((t) => t.id === "VFD1.status_word");
  assert.equal(sw.bits !== null && typeof sw.bits === "object", true, "status word declares its bits");
  const s = new TrendStore();
  s.setTags(tags);
  assert.notEqual(s.getTag("VFD1.status_word.b0"), undefined, "bit children exist in the catalog");
  s.selectPen("VFD1.status_word.b0");
  s.updateValues(a.tick(a._t0 + 1000));
  assert.equal(s.getTag("VFD1.status_word.b0").currentValue, 1, "running drive: Running bit = 1");
  assert.equal(s.getHistory("VFD1.status_word.b0").at(-1).v, 1, "bit pen trends");
  // the parked, faulted VFD3 decodes its Faulted status bit
  const faultedBit = s.allTags().find((t) =>
    t.metadata?.parentWord === "VFD3.status_word" && t.displayName === "Faulted");
  assert.notEqual(faultedBit, undefined, "VFD3 exposes a named Faulted bit");
  assert.equal(faultedBit.currentValue, 1);
});

test("subscribe pushes an immediate batch then on interval; unsubscribe stops", async () => {
  const a = new MockAdapter();
  await a.connect();
  let batches = 0;
  const off = a.subscribe(() => batches++, 10);
  assert.equal(batches, 1, "immediate first push");
  await new Promise((r) => setTimeout(r, 35));
  off();
  const after = batches;
  assert.equal(after > 1, true, "interval pushed more");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(batches, after, "stopped after unsubscribe");
});
