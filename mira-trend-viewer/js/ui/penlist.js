// Selected-pen list — every checked signal with its live value, units/state, quality, and
// timestamp, plus a Remove button. Remove calls store.deselectPen, which also unchecks the
// matching box in the source browser (single source of truth = the store).

import { formatValue, unitLabel, qualityLabel, formatTimestamp, isDigitalTag, Quality } from "../model.js";

export class PenList {
  constructor(root, store) { this.root = root; this.store = store; }

  render() {
    const pens = this.store.getPens();
    this.root.innerHTML = "";
    const head = document.createElement("div");
    head.className = "pphead";
    head.innerHTML = `<span>SELECTED PENS</span><span style="margin-left:auto">${pens.length}</span>`;
    this.root.appendChild(head);

    if (!pens.length) {
      const e = document.createElement("div"); e.className = "empty";
      e.textContent = "No pens selected — check signals in the browser to trend them.";
      this.root.appendChild(e); return;
    }
    const tbl = document.createElement("table"); tbl.className = "pentbl";
    tbl.innerHTML = `<thead><tr>
      <th>Pen</th><th>Source</th><th>Value</th><th>Quality</th><th>Timestamp</th><th></th>
    </tr></thead>`;
    const tb = document.createElement("tbody");
    for (const p of pens) {
      const t = p.tag;
      const tr = document.createElement("tr");
      const valTxt = isDigitalTag(t)
        ? `<span class="pval">${formatValue(t)}</span>`
        : `<span class="pval">${formatValue(t)}</span> <span class="punit">${unitLabel(t)}</span>`;
      const qcls = t.quality === Quality.GOOD ? "q-good" : t.quality === Quality.STALE ? "q-stale" : "q-bad";
      tr.innerHTML =
        `<td><span class="swatch" style="background:${p.color}"></span> ${t.displayName}</td>` +
        `<td>${t.deviceName || t.assetName || "—"}</td>` +
        `<td>${valTxt}</td>` +
        `<td><span class="q ${qcls}">${qualityLabel(t)}</span></td>` +
        `<td class="ptime">${formatTimestamp(t.timestamp)}</td>` +
        `<td><button class="premove" title="Remove pen">✕</button></td>`;
      tr.querySelector(".premove").onclick = () => this.store.deselectPen(t.id);
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    this.root.appendChild(tbl);
  }
}
