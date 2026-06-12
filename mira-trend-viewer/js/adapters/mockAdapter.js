// MockAdapter — a self-contained simulated factory so the trend viewer is fully usable
// before any live PLC/SCADA is connected. Three VFDs (full register sets), analog inputs +
// outputs, digital inputs + outputs, plus one STALE and one BAD tag to exercise quality.
// tick(now) advances the sim and returns the update batch (deterministic & testable);
// subscribe() drives tick() on an interval.

import { DataSourceAdapter } from "./adapter.js";
import { createTag, SourceType, DataType, Quality } from "../model.js";

// GS10 DURApulse fault MNEMONICS (display-correct, GS10 not GS1). NOTE: the integer keys are
// DEMO placeholders — a real GS10 fault register maps different numbers; a live adapter must
// take the numeric→mnemonic table from the GS10 manual, not this map.
const GS10_FAULTS = { 0: "No fault", 1: "oc (overcurrent)", 2: "ov (overvoltage)",
  6: "oH (overheat)", 9: "ocA (accel oc)", 12: "Lv (undervoltage)", 16: "CE (comm err)" };

function vfdRegisters(dev) {
  const a = dev.assetId;
  const r = (suffix, o) => createTag({ id: `${a}.${suffix}`, assetId: a, assetName: dev.assetName,
    deviceId: a, deviceName: dev.assetName, sourceType: SourceType.VFD, ...o });
  return [
    r("freq_cmd",   { name: "Frequency Command", dataType: DataType.FLOAT, engineeringUnits: "Hz", min: 0, max: 60 }),
    r("out_freq",   { name: "Output Frequency",  dataType: DataType.FLOAT, engineeringUnits: "Hz", min: 0, max: 60 }),
    r("out_current",{ name: "Output Current",    dataType: DataType.FLOAT, engineeringUnits: "A", min: 0, max: 12 }),
    r("dc_bus",     { name: "DC Bus Voltage",    dataType: DataType.FLOAT, engineeringUnits: "V", min: 0, max: 420 }),
    r("out_voltage",{ name: "Output Voltage",    dataType: DataType.FLOAT, engineeringUnits: "V", min: 0, max: 240 }),
    r("motor_rpm",  { name: "Motor RPM",         dataType: DataType.FLOAT, engineeringUnits: "rpm", min: 0, max: 1800 }),
    r("torque",     { name: "Torque",            dataType: DataType.FLOAT, engineeringUnits: "%", min: 0, max: 150 }),
    r("heatsink",   { name: "Heat Sink Temp",    dataType: DataType.FLOAT, engineeringUnits: "°C", min: 0, max: 90 }),
    r("fault_code", { name: "Fault Code",        dataType: DataType.ENUM, states: GS10_FAULTS }),
    r("status_word",{ name: "Drive Status Word", dataType: DataType.WORD, engineeringUnits: "" }),
    r("run_cmd",    { name: "Run Command",       dataType: DataType.BOOLEAN, states: { 0: "STOP", 1: "RUN" } }),
    r("direction",  { name: "Direction",         dataType: DataType.BOOLEAN, states: { 0: "FWD", 1: "REV" } }),
    r("comm_ok",    { name: "Communication OK",  dataType: DataType.BOOLEAN, states: { 0: "FAULT", 1: "OK" } }),
  ];
}

export class MockAdapter extends DataSourceAdapter {
  constructor() {
    super();
    this._timer = null;
    this._t0 = 0;
    const vfds = [
      { assetId: "VFD1", assetName: "VFD 1 — Infeed Conveyor", running: true,  base: 45 },
      { assetId: "VFD2", assetName: "VFD 2 — Wash Pump",       running: true,  base: 58 },
      { assetId: "VFD3", assetName: "VFD 3 — Discharge",       running: false, base: 0 },
    ];
    this._vfdMeta = new Map(vfds.map((v) => [v.assetId, v]));
    const tags = [];
    for (const v of vfds) tags.push(...vfdRegisters(v));

    const ai = (id, o) => createTag({ id, sourceType: SourceType.ANALOG_INPUT,
      assetId: "AI", assetName: "Field Analog Inputs", deviceName: "Field I/O", ...o });
    tags.push(
      ai("AI.tank_temp",  { name: "Tank Temperature", engineeringUnits: "°C", min: 0, max: 120, dataType: DataType.FLOAT }),
      ai("AI.line_press", { name: "Line Pressure",    engineeringUnits: "psi", min: 0, max: 150, dataType: DataType.FLOAT }),
      ai("AI.tank_level", { name: "Tank Level",       engineeringUnits: "%", min: 0, max: 100, dataType: DataType.FLOAT }),
      ai("AI.flow",       { name: "Product Flow",     engineeringUnits: "L/min", min: 0, max: 200, dataType: DataType.FLOAT }),
      ai("AI.ambient",    { name: "Ambient Temp", engineeringUnits: "°C", min: -40, max: 85,
        dataType: DataType.FLOAT, quality: Quality.STALE }),
    );

    const ao = (id, o) => createTag({ id, sourceType: SourceType.ANALOG_OUTPUT,
      assetId: "AO", assetName: "Field Analog Outputs", deviceName: "Field I/O", ...o });
    tags.push(
      ao("AO.valve_pos",  { name: "Valve Position Cmd", engineeringUnits: "%", min: 0, max: 100, dataType: DataType.FLOAT }),
      ao("AO.speed_sp",   { name: "Line Speed Setpoint", engineeringUnits: "%", min: 0, max: 100, dataType: DataType.FLOAT }),
      ao("AO.heater_cmd", { name: "Heater Output Cmd", engineeringUnits: "%", min: 0, max: 100,
        dataType: DataType.FLOAT, quality: Quality.UNCERTAIN }),
    );

    const di = (id, o) => createTag({ id, sourceType: SourceType.DIGITAL_INPUT,
      assetId: "DI", assetName: "Field Digital Inputs", deviceName: "Field I/O", ...o });
    tags.push(
      di("DI.estop",      { name: "E-Stop OK", states: { 0: "TRIPPED", 1: "OK" } }),
      di("DI.photo_eye",  { name: "Photo Eye PE-101" }),
      di("DI.limit_hi",   { name: "Level Hi Limit" }),
      di("DI.guard_door", { name: "Guard Door Closed" }),
      di("DI.start_pb",   { name: "Start Pushbutton" }),
    );

    const dout = (id, o) => createTag({ id, sourceType: SourceType.DIGITAL_OUTPUT,
      assetId: "DO", assetName: "Field Digital Outputs", deviceName: "Field I/O", ...o });
    tags.push(
      dout("DO.contactor", { name: "Main Contactor" }),
      dout("DO.run_lamp",  { name: "Run Lamp (green)" }),
      dout("DO.fault_lamp",{ name: "Fault Lamp (red)" }),
      dout("DO.horn",      { name: "Warning Horn" }),
    );

    this._tags = tags;
    this._byId = new Map(tags.map((t) => [t.id, t]));
  }

  async connect() { this._t0 = Date.now(); }
  async browse() { return this._tags; }

  /** Advance the simulation to `now`; return the value-update batch. Pure & deterministic
   *  given `now` (no Math.random — uses smooth/seeded oscillators), so tests can drive it. */
  tick(now = Date.now()) {
    const s = (now - this._t0) / 1000;
    const wave = (period, phase = 0) => Math.sin((2 * Math.PI * s) / period + phase);
    const updates = [];
    const put = (id, currentValue, quality = Quality.GOOD, changed = undefined) =>
      updates.push({ id, currentValue, quality, timestamp: now, lastChangedTimestamp: changed });

    for (const [aid, v] of this._vfdMeta) {
      if (v.running) {
        const f = v.base + 1.5 * wave(20, aid.length);
        put(`${aid}.freq_cmd`, +v.base.toFixed(1));
        put(`${aid}.out_freq`, +f.toFixed(2));
        put(`${aid}.out_current`, +(3.2 + 0.6 * wave(7) + 0.2 * wave(2)).toFixed(2));
        put(`${aid}.dc_bus`, +(318 + 2 * wave(31)).toFixed(1));
        put(`${aid}.out_voltage`, +(120 + f).toFixed(1));
        put(`${aid}.motor_rpm`, +(f * 30).toFixed(0));
        put(`${aid}.torque`, +(42 + 8 * wave(11)).toFixed(1));
        put(`${aid}.heatsink`, +(38 + 4 * wave(120)).toFixed(1));
        put(`${aid}.fault_code`, 0);
        put(`${aid}.status_word`, 0x0007);
        put(`${aid}.run_cmd`, 1);
        put(`${aid}.direction`, aid === "VFD2" ? 1 : 0);
        put(`${aid}.comm_ok`, 1);
      } else {
        for (const k of ["freq_cmd", "out_freq", "out_current", "out_voltage", "motor_rpm", "torque"]) put(`${aid}.${k}`, 0);
        put(`${aid}.dc_bus`, +(322 + 1 * wave(31)).toFixed(1));
        put(`${aid}.heatsink`, +(30 + 1 * wave(120)).toFixed(1));
        put(`${aid}.fault_code`, 6);                 // a parked drive showing an overheat fault
        put(`${aid}.status_word`, 0x0020);
        put(`${aid}.run_cmd`, 0);
        put(`${aid}.direction`, 0);
        put(`${aid}.comm_ok`, 1);
      }
    }

    put("AI.tank_temp", +(72 + 6 * wave(90)).toFixed(1));
    put("AI.line_press", +(64 + 10 * wave(13)).toFixed(1));
    put("AI.tank_level", +(55 + 20 * wave(140)).toFixed(1));
    put("AI.flow", +(120 + 25 * wave(9)).toFixed(1));
    put("AI.ambient", null, Quality.STALE);          // sensor offline — stays stale

    put("AO.valve_pos", +(50 + 30 * wave(140)).toFixed(1));
    put("AO.speed_sp", 75);
    put("AO.heater_cmd", +(40 + 10 * wave(60)).toFixed(1), Quality.UNCERTAIN);

    const sq = (period) => (wave(period) >= 0 ? 1 : 0);
    put("DI.estop", 1);
    put("DI.photo_eye", sq(4));                       // toggles as product passes
    put("DI.limit_hi", 0);
    put("DI.guard_door", 1);
    put("DI.start_pb", 0);

    put("DO.contactor", 1);
    put("DO.run_lamp", 1);
    put("DO.fault_lamp", 0);
    put("DO.horn", sq(30) && 0);                      // normally off

    // reflect into the catalog tags too (so browse() values stay live)
    for (const u of updates) {
      const t = this._byId.get(u.id);
      if (t) { t.currentValue = u.currentValue; t.quality = u.quality; t.timestamp = u.timestamp; }
    }
    return updates;
  }

  subscribe(onUpdate, intervalMs = 1000, onStatus = null) {
    onStatus?.("ok", "Mock data (demo)");
    onUpdate(this.tick());
    this._timer = setInterval(() => onUpdate(this.tick()), intervalMs);
    return () => { clearInterval(this._timer); this._timer = null; };
  }

  async disconnect() { if (this._timer) clearInterval(this._timer); }
}
