// HistorianAdapter — wires the trend viewer to the MIRA bench trend historian
// (plc/conv_simple_anomaly/trend_historian.py): GET /trends/summary for the catalog + live
// values. Proves the platform-agnostic claim — the same UI, a different real source. The
// historian exposes the conv_simple bench (one GS10 VFD + digital I/O), which this maps into
// the vendor-neutral model. Used via ?source=historian&base=http://<plc-laptop>:8766
//
// (Node tests don't cover this — it needs the live HTTP service; the mock adapter is the
//  tested reference implementation of the same contract.)

import { DataSourceAdapter } from "./adapter.js";
import { createTag, SourceType, DataType, Quality } from "../model.js";

// Map a historian summary key -> {sourceType, deviceId, dataType, name}.
function classify(key) {
  if (key.startsWith("vfd_")) {
    const digital = key === "vfd_comm_ok";
    const word = key === "vfd_cmd_word";
    return { sourceType: SourceType.VFD, deviceId: "GS10", deviceName: "GS10 — Conv_Simple Drive",
      dataType: digital ? DataType.BOOLEAN : word ? DataType.WORD : DataType.FLOAT, name: pretty(key) };
  }
  if (key === "motor_running") return { sourceType: SourceType.VFD, deviceId: "GS10",
    deviceName: "GS10 — Conv_Simple Drive", dataType: DataType.BOOLEAN, name: "Motor Running" };
  if (key.startsWith("do")) return { sourceType: SourceType.DIGITAL_OUTPUT, dataType: DataType.BOOLEAN, name: pretty(key) };
  if (key.startsWith("di") || key.includes("estop") || key.includes("e_stop"))
    return { sourceType: SourceType.DIGITAL_INPUT, dataType: DataType.BOOLEAN, name: pretty(key) };
  return { sourceType: SourceType.ANALOG_INPUT, dataType: DataType.FLOAT, name: pretty(key) };
}
function pretty(k) { return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function mapQuality(q) { return q === "good" ? Quality.GOOD : q === "no_data" ? Quality.BAD : Quality.STALE; }

export class HistorianAdapter extends DataSourceAdapter {
  constructor(base = "http://127.0.0.1:8766") { super(); this.base = base.replace(/\/$/, ""); this._timer = null; }

  async _summary() {
    const res = await fetch(`${this.base}/trends/summary?window=60`, { cache: "no-store" });
    if (!res.ok) throw new Error(`historian ${res.status}`);
    return res.json();
  }

  async connect() { await this._summary(); }

  async browse() {
    const data = await this._summary();
    return Object.entries(data.summaries || {}).map(([key, s]) => {
      const c = classify(key);
      return createTag({
        id: key, name: c.name, sourceType: c.sourceType, dataType: c.dataType,
        deviceId: c.deviceId, deviceName: c.deviceName,
        assetId: c.deviceId || c.sourceType, assetName: c.deviceName || "Conv_Simple Field I/O",
        address: key, engineeringUnits: s.unit || "",
        min: s.threshold_lo ?? null, max: s.threshold_hi ?? null,
        currentValue: s.current, quality: mapQuality(s.quality),
      });
    });
  }

  subscribe(onUpdate, intervalMs = 1000, onStatus = null) {
    const poll = async () => {
      try {
        const data = await this._summary();
        const now = data.ts ? data.ts * 1000 : Date.now();
        onUpdate(Object.entries(data.summaries || {}).map(([key, s]) => ({
          id: key, currentValue: s.current, quality: mapQuality(s.quality), timestamp: now,
        })));
        onStatus?.("ok", "Trend historian");
      } catch (e) {
        // historian down — signal the dead feed (don't leave the chip green over a frozen view)
        onStatus?.("alarm", "Historian unreachable");
      }
    };
    poll();
    this._timer = setInterval(poll, intervalMs);
    return () => { clearInterval(this._timer); this._timer = null; };
  }

  async disconnect() { if (this._timer) clearInterval(this._timer); }
}
