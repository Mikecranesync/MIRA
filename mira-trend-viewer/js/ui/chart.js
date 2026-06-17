// TrendChart — industrial canvas trend. Analog pens render as continuous auto-scaled lines
// in the upper plot (the first two analog pens get labeled left/right Y axes in their own
// color; current value is pinned at the right "now" edge); digital/boolean pens render as
// stacked 0/1 step lanes in a distinct strip at the bottom so they stay readable against the
// analog lines. Time on X (right = now in live mode), grid, hairline cursor with a per-pen
// readout, wheel-zoom + drag-pan over history, and a loud PAUSED/historical indicator.
// Reads only the TrendStore + model helpers — no vendor or DOM-framework coupling.

import { isDigitalTag, formatValue, unitLabel } from "../model.js";

const PAD = { l: 54, r: 54, t: 14, b: 22 };   // l/r gutters hold the two analog Y axes
const LANE_H = 30;
const COL = { grid: "#363c43", gridMinor: "#2a2f35", axis: "#9aa3ad", strip: "#20242800",
  laneBand: "#23272b", baseline: "#4a525b", warn: "#d99a2b" };

export class TrendChart {
  constructor(canvas, store, cursorEl) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.store = store; this.cursorEl = cursorEl;
    this.viewEndOverride = null;   // null = live (right edge = now)
    this._drag = null; this._cursorX = null;
    canvas.addEventListener("mousemove", (e) => this._onMove(e));
    canvas.addEventListener("mouseleave", () => { this._cursorX = null; this.cursorEl.style.display = "none"; });
    canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    canvas.addEventListener("mousedown", (e) => this._onDown(e));
    window.addEventListener("mouseup", () => (this._drag = null));
    window.addEventListener("mousemove", (e) => this._onPan(e));
  }

  goLive() { this.viewEndOverride = null; }
  isLive() { return this.viewEndOverride === null; }

  _domain(now) {
    const tEnd = this.viewEndOverride ?? now;
    return { tEnd, tStart: tEnd - this.store.rangeMs };
  }
  _plot(pens) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    const nDig = pens.filter((p) => isDigitalTag(p.tag)).length;
    const digH = nDig * LANE_H;
    const digTop = h - PAD.b - digH;
    return { w, h, x0: PAD.l, x1: w - PAD.r, yA0: PAD.t,
             yA1: digTop - (nDig ? 8 : 0), digTop, nDig };
  }

  render(now = Date.now()) {
    const { ctx, cv } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pens = this.store.getPens();
    if (!pens.length) return;

    const { tStart, tEnd } = this._domain(now);
    const P = this._plot(pens);
    const X = (t) => P.x0 + (t - tStart) / (tEnd - tStart) * (P.x1 - P.x0);

    this._grid(P, tStart, tEnd, X);

    const analog = pens.filter((p) => !isDigitalTag(p.tag));
    const digital = pens.filter((p) => isDigitalTag(p.tag));

    analog.forEach((p, i) => {
      const [lo, hi] = this._scale(p);
      const Y = (v) => P.yA1 - (v - lo) / (hi - lo) * (P.yA1 - P.yA0);
      this._line(p, tStart, tEnd, X, Y);
      if (i < 2) this._valueTag(p, P, Y);             // pin current value at the right edge
    });
    if (analog[0]) this._yAxis(P, analog[0], "left");
    if (analog[1]) this._yAxis(P, analog[1], "right");

    if (P.nDig) {                                      // digital strip separator
      ctx.strokeStyle = COL.grid; ctx.beginPath();
      ctx.moveTo(P.x0, P.digTop - 4); ctx.lineTo(P.x1, P.digTop - 4); ctx.stroke();
    }
    digital.forEach((p, i) => this._lane(p, tStart, tEnd, X, P.digTop + i * LANE_H, P));

    if (this._cursorX !== null) this._drawCursor(P, tStart, tEnd, X, now);
    if (this.viewEndOverride !== null || this.store.paused) this._historicalOverlay(P);
  }

  _scale(pen) {
    const t = pen.tag;
    let lo = t.min, hi = t.max;
    const vals = pen.history.filter((s) => s.v !== null).map((s) => s.v);
    if (lo === null || hi === null || lo === hi) {
      if (vals.length) { lo = Math.min(...vals); hi = Math.max(...vals); }
      else { lo = 0; hi = 1; }
      const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    }
    return [lo, hi];
  }

  _grid(P, tStart, tEnd, X) {
    const { ctx } = this;
    ctx.lineWidth = 1; ctx.fillStyle = COL.axis; ctx.font = "10px Consolas, monospace";
    for (let i = 0; i <= 4; i++) { const y = P.yA0 + (P.yA1 - P.yA0) * i / 4;
      ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(P.x0, y); ctx.lineTo(P.x1, y); ctx.stroke(); }
    const divs = 6;
    ctx.textAlign = "center";
    for (let i = 0; i <= divs; i++) {
      const t = tStart + (tEnd - tStart) * i / divs; const x = X(t);
      ctx.strokeStyle = COL.gridMinor; ctx.beginPath(); ctx.moveTo(x, P.yA0); ctx.lineTo(x, P.digTop); ctx.stroke();
      ctx.fillText(new Date(t).toLocaleTimeString([], { hour12: false }), x, P.h - 7);
    }
    // date stamp once, bottom-left
    ctx.textAlign = "left"; ctx.fillStyle = "#69707a";
    ctx.fillText(new Date(tEnd).toLocaleDateString(), 4, P.h - 7);
  }

  _yAxis(P, pen, side) {
    const { ctx } = this; const [lo, hi] = this._scale(pen);
    const x = side === "left" ? P.x0 - 5 : P.x1 + 5;
    ctx.fillStyle = pen.color; ctx.font = "10px Consolas, monospace";
    ctx.textAlign = side === "left" ? "right" : "left";
    for (let i = 0; i <= 4; i++) { const v = hi - (hi - lo) * i / 4; const y = P.yA0 + (P.yA1 - P.yA0) * i / 4;
      ctx.fillText(this._fmt(v), x, y + 3); }
    if (side === "left") {
      ctx.textAlign = "left";
      ctx.fillText(`${pen.tag.displayName}${unitLabel(pen.tag) ? " (" + unitLabel(pen.tag) + ")" : ""}`, P.x0 + 3, P.yA0 + 9);
    }
  }
  _fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1); }

  _valueTag(pen, P, Y) {
    const last = [...pen.history].reverse().find((s) => s.v !== null);
    if (!last) return;
    const { ctx } = this; const y = Math.max(P.yA0 + 6, Math.min(P.yA1 - 2, Y(last.v)));
    const txt = formatValue({ ...pen.tag, currentValue: last.v });
    ctx.font = "11px Consolas, monospace"; ctx.textAlign = "right";
    const tw = ctx.measureText(txt).width + 8;
    ctx.fillStyle = "#181b1e"; ctx.fillRect(P.x1 - tw, y - 8, tw, 15);
    ctx.fillStyle = pen.color; ctx.fillText(txt, P.x1 - 3, y + 3);
  }

  _line(pen, tStart, tEnd, X, Y) {
    const { ctx } = this; ctx.lineWidth = 2; ctx.strokeStyle = pen.color;
    let prevX = null, prevY = null, prevBad = null;
    for (const s of pen.history) {
      if (s.v === null) { prevX = null; continue; }
      const x = X(s.t), y = Y(s.v);
      const bad = s.q === "bad" || s.q === "uncertain" || s.q === "stale";
      if (prevX !== null) {                            // one stroke per segment so dash is per-segment
        ctx.setLineDash(bad ? [3, 3] : []);
        ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(x, y); ctx.stroke();
      }
      prevX = x; prevY = y; prevBad = bad;
    }
    ctx.setLineDash([]);
  }

  _lane(pen, tStart, tEnd, X, top, P) {
    const { ctx } = this; const yOn = top + 8, yOff = top + LANE_H - 8;
    // lane background band + name + 0/1 ticks
    ctx.fillStyle = COL.laneBand; ctx.fillRect(P.x0, top + 2, P.x1 - P.x0, LANE_H - 4);
    ctx.fillStyle = pen.color; ctx.font = "10px Consolas, monospace"; ctx.textAlign = "left";
    ctx.fillText(pen.tag.displayName, P.x0 + 4, top + 12);
    ctx.fillStyle = "#69707a"; ctx.textAlign = "right";
    ctx.fillText("1", P.x0 - 5, yOn + 3); ctx.fillText("0", P.x0 - 5, yOff + 3);
    // visible OFF baseline
    ctx.strokeStyle = COL.baseline; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(tStart), yOff); ctx.lineTo(X(tEnd), yOff); ctx.stroke();
    // step trace + subtle ON-band fill
    ctx.strokeStyle = pen.color; ctx.lineWidth = 2;
    const hist = pen.history.filter((s) => s.v !== null);
    let prevX = null, prevY = null;
    const drawSeg = (x0, x1, y) => {
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (y === yOn) { ctx.fillStyle = pen.color + "22"; ctx.fillRect(x0, yOn, x1 - x0, yOff - yOn); ctx.strokeStyle = pen.color; }
    };
    for (const s of hist) {
      const x = X(s.t); const y = Number(s.v) ? yOn : yOff;
      if (prevX !== null) { drawSeg(prevX, x, prevY);
        if (prevY !== y) { ctx.beginPath(); ctx.moveTo(x, prevY); ctx.lineTo(x, y); ctx.stroke(); } }
      prevX = x; prevY = y;
    }
    if (prevX !== null && prevX < X(tEnd)) drawSeg(prevX, X(tEnd), prevY);   // hold to now
  }

  _historicalOverlay(P) {
    const { ctx } = this;
    ctx.strokeStyle = COL.warn; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, P.w - 2, P.h - 2);
    const label = this.store.paused ? "PAUSED" : "VIEWING HISTORY";
    ctx.font = "bold 11px Segoe UI"; ctx.textAlign = "center";
    const tw = ctx.measureText(label).width + 18;
    ctx.fillStyle = COL.warn; ctx.fillRect((P.w - tw) / 2, 0, tw, 18);
    ctx.fillStyle = "#1c1f22"; ctx.fillText(label, P.w / 2, 13);
  }

  // ── interaction ───────────────────────────────────────────────────────────────
  _xToTime(x, now = Date.now()) {
    const P = this._plot(this.store.getPens()); const { tStart, tEnd } = this._domain(now);
    return tStart + (x - P.x0) / (P.x1 - P.x0) * (tEnd - tStart);
  }
  _onMove(e) { const r = this.cv.getBoundingClientRect(); this._cursorX = e.clientX - r.left; }
  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    this.store.rangeMs = Math.max(10_000, Math.min(8 * 3600_000, this.store.rangeMs * factor));
    this.store._notify();
  }
  _onDown(e) { this._drag = { x: e.clientX, end0: this.viewEndOverride ?? Date.now() }; }
  _onPan(e) {
    if (!this._drag) return;
    const P = this._plot(this.store.getPens()); const dx = e.clientX - this._drag.x;
    const msPerPx = this.store.rangeMs / (P.x1 - P.x0);
    this.viewEndOverride = this._drag.end0 - dx * msPerPx;     // drag right = into the past
    this.store._notify();
  }
  _drawCursor(P, tStart, tEnd, X, now) {
    const { ctx } = this; const x = Math.max(P.x0, Math.min(P.x1, this._cursorX));
    const t = this._xToTime(x, now);
    ctx.strokeStyle = "#5a636d"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x, P.yA0); ctx.lineTo(x, P.h - PAD.b); ctx.stroke(); ctx.setLineDash([]);
    const rows = this.store.getPens().map((p) => {
      let s = null; for (const h of p.history) { if (h.t <= t) s = h; else break; }
      return { color: p.color, name: p.tag.displayName,
        val: s && s.v !== null ? formatValue({ ...p.tag, currentValue: s.v }) : "—", unit: unitLabel(p.tag) };
    });
    const el = this.cursorEl;
    el.innerHTML = `<div class="ct">${new Date(t).toLocaleTimeString([], { hour12: false })}</div>` +
      rows.map((r) => `<div class="cr"><span class="sw" style="background:${r.color}"></span>${r.name}: ${r.val} ${r.unit}</div>`).join("");
    el.style.display = "block";
    const rect = this.cv.getBoundingClientRect();
    el.style.left = Math.min(x + 12, rect.width - 210) + "px";
    el.style.top = Math.min(P.yA0 + 6, rect.height - el.offsetHeight - 30) + "px";
  }
}
