// Source browser — the left tag tree. Browse by asset/device, not raw tag names:
//   • VFDs are expandable device cards with child registers (analog + status), each checkbox.
//   • Analog In/Out are live value rows with a mini bar + units + range.
//   • Digital In/Out are ON/OFF state rows (read-only indicator, NOT a command button).
// Every trendable row has a checkbox = the trend-selection control, bound to the store.
// Structure is built once; refresh() patches values/states/quality/selection (no flicker).

import { groupTags, SourceType, isDigitalTag, formatValue, unitLabel, rangeLabel,
  qualityLabel, Quality } from "../model.js";

export class SourceBrowser {
  constructor(root, store) {
    this.root = root; this.store = store;
    this.collapsed = new Set();         // collapsed GROUP types (groups start expanded)
    this.expanded = new Set();          // expanded DEVICE ids (VFD cards start collapsed)
    this.refs = new Map();              // tagId -> {row, cb, val, unit, state, q, bar, swatch}
    this._deviceHeads = new Map();
  }

  render() {
    const groups = groupTags(this.store.allTags());
    this.refs.clear();
    this._deviceHeads.clear();
    this.root.innerHTML = "";
    for (const g of groups) this.root.appendChild(this._group(g));
    this.refresh();
  }

  _group(g) {
    const el = document.createElement("div");
    el.className = "group" + (this.collapsed.has(g.type) ? " collapsed" : "");
    const head = document.createElement("div");
    head.className = "ghead";
    head.innerHTML = `<span class="caret">▾</span><span>${g.label}</span>` +
      `<span class="gcount">${g.tags.length}</span>`;
    head.onclick = () => { el.classList.toggle("collapsed");
      this.collapsed.has(g.type) ? this.collapsed.delete(g.type) : this.collapsed.add(g.type); };
    el.appendChild(head);
    const body = document.createElement("div"); body.className = "gbody";
    if (g.type === SourceType.VFD) {
      for (const dev of g.devices) body.appendChild(this._device(dev));
    } else {
      for (const t of g.tags) body.appendChild(this._row(t));
    }
    el.appendChild(body);
    return el;
  }

  _device(dev) {
    const el = document.createElement("div");
    const key = dev.deviceId;
    el.className = "dev" + (this.expanded.has(key) ? "" : " collapsed");  // VFD cards start collapsed
    const head = document.createElement("div"); head.className = "dhead";
    head.innerHTML = `<span class="caret">▾</span><span class="dname">${dev.deviceName}</span>` +
      `<span class="dstate" data-devstate="${dev.deviceId}"></span>`;
    head.onclick = () => { el.classList.toggle("collapsed");
      this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key); };
    el.appendChild(head);
    const body = document.createElement("div"); body.className = "dbody";
    for (const t of dev.tags) body.appendChild(this._row(t));
    el.appendChild(body);
    this._deviceHeads.set(dev.deviceId, head.querySelector("[data-devstate]"));
    return el;
  }

  _row(tag) {
    const row = document.createElement("div");
    row.className = "row" + (tag.trendable ? "" : " inactive");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.disabled = !tag.trendable;
    cb.onchange = () => this.store.togglePen(tag.id);
    const swatch = document.createElement("span"); swatch.className = "swatch";
    const name = document.createElement("span"); name.className = "rname";
    name.textContent = tag.displayName; name.title = `${tag.assetName} · ${tag.address || tag.id}`;
    row.append(cb, swatch, name);

    let val, unit, state, bar, q;
    if (isDigitalTag(tag)) {
      state = document.createElement("span"); state.className = "rstate";
      row.appendChild(state);
    } else {
      bar = document.createElement("span"); bar.className = "bar";
      bar.innerHTML = "<span></span>";
      val = document.createElement("span"); val.className = "rval";
      unit = document.createElement("span"); unit.className = "runit";
      row.append(bar, val, unit);
    }
    q = document.createElement("span"); q.className = "q"; row.appendChild(q);

    this.refs.set(tag.id, { row, cb, val, unit, state, bar, q, swatch });
    return row;
  }

  /** Patch live values/states/quality/selection without rebuilding the DOM. */
  refresh() {
    for (const [id, r] of this.refs) {
      const tag = this.store.getTag(id); if (!tag) continue;
      const selected = this.store.isSelected(id);
      r.cb.checked = selected;
      r.swatch.style.background = selected ? (this.store.colors.get(id) || "transparent") : "transparent";
      if (r.state) {                                  // digital ON/OFF indicator
        const on = Number(tag.currentValue) === 1;
        const txt = formatValue(tag);
        r.state.textContent = txt;
        r.state.className = "rstate " + (txt === "TRIPPED" || txt === "FAULT" ? "state-alarm" : on ? "state-on" : "state-off");
      } else if (r.val) {                             // analog value + bar
        r.val.textContent = formatValue(tag);
        r.unit.textContent = unitLabel(tag);
        const bs = r.bar.firstChild;
        if (tag.min !== null && tag.max !== null && tag.currentValue !== null) {
          const pct = Math.max(0, Math.min(100, (tag.currentValue - tag.min) / (tag.max - tag.min) * 100));
          bs.style.width = pct + "%";   // neutral fill — quality is carried by the q badge, not color
        } else { bs.style.width = "0%"; }
      }
      r.q.textContent = tag.quality === Quality.GOOD ? "" : qualityLabel(tag);
      r.q.className = "q " + (tag.quality === Quality.STALE ? "q-stale" :
        tag.quality === Quality.GOOD ? "q-good" : "q-bad");
    }
    // VFD device header state badge (run/comm)
    if (this._deviceHeads) {
      for (const [devId, badge] of this._deviceHeads) {
        const run = this.store.getTag(devId + ".run_cmd");
        const comm = this.store.getTag(devId + ".comm_ok");
        const fault = this.store.getTag(devId + ".fault_code");
        if (comm && Number(comm.currentValue) === 0) { badge.textContent = "COMM FAULT"; badge.style.color = "var(--alarm)"; }
        else if (fault && Number(fault.currentValue) > 0) { badge.textContent = "FAULT"; badge.style.color = "var(--alarm)"; }
        else if (run && Number(run.currentValue) === 1) { badge.textContent = "RUN"; badge.style.color = "var(--ok)"; }
        else { badge.textContent = "STOP"; badge.style.color = "var(--muted)"; }
      }
    }
  }
}
