// Toolbar — live/pause, go-to-now, time-range, refresh rate, clear pens, export CSV, plus a
// connection/state indicator. Pure wiring over the store + chart; no business logic.

const RANGES = [
  ["1 min", 60_000], ["5 min", 300_000], ["15 min", 900_000],
  ["1 hr", 3_600_000], ["8 hr", 28_800_000],
];
const REFRESH = [["0.5 s", 500], ["1 s", 1000], ["2 s", 2000], ["5 s", 5000]];

export class Toolbar {
  constructor(root, store, chart, { onRefreshChange }) {
    this.root = root; this.store = store; this.chart = chart; this.onRefreshChange = onRefreshChange;
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = `
      <span class="brand">MIRA · TRENDS <small>industrial trend viewer</small></span>
      <span class="sep"></span>
      <button class="tbtn live" id="tb-live"></button>
      <button class="tbtn" id="tb-now" title="Jump to now / reset zoom">● now</button>
      <span class="sep"></span>
      <label class="fld">Range <select id="tb-range"></select></label>
      <label class="fld">Refresh <select id="tb-refresh"></select></label>
      <span class="sep"></span>
      <button class="tbtn" id="tb-clear" title="Remove all pens">Clear pens</button>
      <button class="tbtn" id="tb-export" title="Export selected pens to CSV">Export CSV</button>
      <span class="spacer"></span>
      <span class="fld"><span class="statedot" id="tb-dot"></span><span id="tb-conn">—</span></span>`;

    const rangeSel = r.querySelector("#tb-range");
    for (const [label, ms] of RANGES) rangeSel.add(new Option(label, ms, ms === this.store.rangeMs, ms === this.store.rangeMs));
    rangeSel.onchange = () => { this.store.setRange(+rangeSel.value); this.chart.goLive(); };

    const refSel = r.querySelector("#tb-refresh");
    for (const [label, ms] of REFRESH) refSel.add(new Option(label, ms, ms === this.store.refreshMs, ms === this.store.refreshMs));
    refSel.onchange = () => { this.store.setRefresh(+refSel.value); this.onRefreshChange?.(+refSel.value); };

    r.querySelector("#tb-live").onclick = () => { this.store.setPaused(!this.store.paused); if (!this.store.paused) this.chart.goLive(); this.refresh(); };
    r.querySelector("#tb-now").onclick = () => { this.chart.goLive(); this.store.setPaused(false); this.store._notify(); this.refresh(); };
    r.querySelector("#tb-clear").onclick = () => this.store.clearPens();
    r.querySelector("#tb-export").onclick = () => this._export();
    this.refresh();
  }

  setConnection(state, label) {
    const dot = this.root.querySelector("#tb-dot"), conn = this.root.querySelector("#tb-conn");
    dot.className = "statedot " + (state === "ok" ? "ok" : state === "warn" ? "warn" : state === "alarm" ? "alarm" : "");
    conn.textContent = label;
  }

  refresh() {
    const live = this.root.querySelector("#tb-live");
    if (this.store.paused) { live.textContent = "▶ Paused"; live.className = "tbtn paused"; }
    else { live.textContent = "⏸ Live"; live.className = "tbtn live"; }
    this.root.querySelector("#tb-export").disabled = this.store.getPens().length === 0;
    this.root.querySelector("#tb-clear").disabled = this.store.getPens().length === 0;
  }

  _export() {
    const csv = this.store.toCSV();
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mira-trend-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }
}
