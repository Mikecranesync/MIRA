// TrendStore — the pure, DOM-free state for the trend viewer. Owns the tag catalog, the
// selected pens (with palette colors + history buffers), live/pause, time range, and CSV
// export. The browser, chart, and pen list all read/observe this one store, which is what
// keeps a checkbox in the browser and a pen in the pen list in sync. Fully unit-testable.

import { PEN_PALETTE, formatValue, unitLabel, qualityLabel, isDigitalTag } from "./model.js";

const HISTORY_CAP = 6000; // max samples per pen kept in memory (ring buffer)

// Engineering scaling applied ONCE, centrally, at ingest: eng = raw*scale + offset. Adapters
// may report raw counts (Modbus/OPC-UA) + set scale/offset, OR report engineering values with
// the default scale=1/offset=0 (a no-op). Skips non-numeric (enum/state strings already mapped).
function applyScale(tag, raw) {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "number" || (tag.scale === 1 && tag.offset === 0)) return raw;
  return raw * tag.scale + tag.offset;
}

export class TrendStore {
  constructor() {
    this.tags = new Map();       // id -> Tag
    this.penOrder = [];          // ids, in selection order
    this.colors = new Map();     // id -> hex
    this.history = new Map();    // id -> [{t, v, q}]
    this.paused = false;
    this.rangeMs = 5 * 60 * 1000;
    this.refreshMs = 1000;
    this._subs = new Set();
    this._colorCursor = 0;
  }

  // ── catalog ────────────────────────────────────────────────────────────────
  /** Replace/merge the tag catalog (from an adapter). Preserves selection + history. */
  setTags(tagList) {
    const next = new Map();
    for (const t of tagList) {
      const prev = this.tags.get(t.id);
      const scaled = { ...t, currentValue: applyScale(t, t.currentValue) };
      next.set(t.id, prev ? { ...scaled, selectedForTrend: prev.selectedForTrend } : scaled);
    }
    this.tags = next;
    // drop pens whose tag vanished
    this.penOrder = this.penOrder.filter((id) => this.tags.has(id));
    this._notify();
  }

  getTag(id) { return this.tags.get(id); }
  allTags() { return [...this.tags.values()]; }

  /** Apply a batch of live updates: [{id, currentValue, quality, timestamp, lastChangedTimestamp}].
   *  Appends to history for SELECTED pens only (chart data) unless paused. */
  updateValues(updates, now = Date.now()) {
    for (const u of updates) {
      const tag = this.tags.get(u.id);
      if (!tag) continue;
      if (u.currentValue !== undefined) tag.currentValue = applyScale(tag, u.currentValue);
      if (u.quality !== undefined) tag.quality = u.quality;
      if (u.timestamp !== undefined) tag.timestamp = u.timestamp;
      if (u.lastChangedTimestamp !== undefined) tag.lastChangedTimestamp = u.lastChangedTimestamp;
      if (!this.paused && tag.selectedForTrend) {
        const buf = this.history.get(u.id);
        if (buf) {
          buf.push({ t: u.timestamp ?? now, v: tag.currentValue === null ? null : Number(tag.currentValue), q: tag.quality });
          if (buf.length > HISTORY_CAP) buf.splice(0, buf.length - HISTORY_CAP);
        }
      }
    }
    this._notify();
  }

  // ── pen selection (the bidirectional sync source of truth) ──────────────────
  isSelected(id) { return this.tags.get(id)?.selectedForTrend === true; }

  selectPen(id) {
    const tag = this.tags.get(id);
    if (!tag || !tag.trendable || tag.selectedForTrend) return;
    tag.selectedForTrend = true;
    this.penOrder.push(id);
    if (!this.colors.has(id)) {
      this.colors.set(id, PEN_PALETTE[this._colorCursor % PEN_PALETTE.length]);
      this._colorCursor++;
    }
    if (!this.history.has(id)) this.history.set(id, []);
    // seed history with the current value so a new pen draws immediately
    if (tag.currentValue !== null && tag.currentValue !== undefined) {
      this.history.get(id).push({ t: tag.timestamp ?? Date.now(),
        v: Number(tag.currentValue), q: tag.quality });
    }
    this._notify();
  }

  deselectPen(id) {
    const tag = this.tags.get(id);
    if (!tag || !tag.selectedForTrend) return;
    tag.selectedForTrend = false;
    this.penOrder = this.penOrder.filter((p) => p !== id);
    this.history.delete(id);
    this._notify();
  }

  togglePen(id) { this.isSelected(id) ? this.deselectPen(id) : this.selectPen(id); }

  clearPens() {
    for (const id of [...this.penOrder]) {
      const t = this.tags.get(id); if (t) t.selectedForTrend = false;
      this.history.delete(id);
    }
    this.penOrder = [];
    this._notify();
  }

  /** Ordered selected pens, each a {tag, color, history}. */
  getPens() {
    return this.penOrder.map((id) => ({
      tag: this.tags.get(id),
      color: this.colors.get(id),
      history: this.history.get(id) || [],
    })).filter((p) => p.tag);
  }

  getHistory(id) { return this.history.get(id) || []; }

  // ── view state ──────────────────────────────────────────────────────────────
  setPaused(p) { this.paused = !!p; this._notify(); }
  setRange(ms) { this.rangeMs = ms; this._notify(); }
  setRefresh(ms) { this.refreshMs = ms; this._notify(); }

  // ── CSV export (sample-and-hold aligned over the union of timestamps) ────────
  toCSV() {
    const pens = this.getPens();
    if (!pens.length) return "timestamp\n";
    const header = ["timestamp", ...pens.map((p) =>
      `${p.tag.displayName}${unitLabel(p.tag) ? " (" + unitLabel(p.tag) + ")" : ""}`)];
    const stamps = [...new Set(pens.flatMap((p) => p.history.map((s) => s.t)))].sort((a, b) => a - b);
    const idx = pens.map(() => 0);
    const last = pens.map(() => "");
    const rows = [header.join(",")];
    for (const ts of stamps) {
      pens.forEach((p, i) => {
        while (idx[i] < p.history.length && p.history[idx[i]].t <= ts) {
          const s = p.history[idx[i]];
          last[i] = s.v === null ? "" : s.v;
          idx[i]++;
        }
      });
      rows.push([new Date(ts).toISOString(), ...last].join(","));
    }
    return rows.join("\n") + "\n";
  }

  // ── observer ─────────────────────────────────────────────────────────────────
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _notify() { for (const fn of this._subs) fn(this); }
}

// Small helpers re-exported for UI convenience (keep model the single source).
export { formatValue, unitLabel, qualityLabel, isDigitalTag };
