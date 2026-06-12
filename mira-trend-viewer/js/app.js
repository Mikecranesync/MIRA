// App wiring: pick an adapter, browse its catalog into the store, build the UI, and run a
// smooth live-scroll render loop. The UI is adapter-agnostic — swap MockAdapter for a real
// one (Ignition / Modbus / MQTT / OPC-UA / historian / Factory I/O / OpenPLC / CSV) and
// nothing else changes. Adapter is chosen via ?source= (default: mock).

import { TrendStore } from "./store.js";
import { MockAdapter } from "./adapters/mockAdapter.js";
import { HistorianAdapter } from "./adapters/historianAdapter.js";
import { SourceBrowser } from "./ui/browser.js";
import { TrendChart } from "./ui/chart.js";
import { PenList } from "./ui/penlist.js";
import { Toolbar } from "./ui/toolbar.js";

function pickAdapter() {
  const src = new URLSearchParams(location.search).get("source") || "mock";
  if (src === "historian") {
    // served BY the historian (mounted at /viewer) -> same origin; standalone -> default port
    const sameOrigin = location.pathname.startsWith("/viewer");
    const base = new URLSearchParams(location.search).get("base") ||
      (sameOrigin ? location.origin : "http://127.0.0.1:8766");
    return { adapter: new HistorianAdapter(base), label: "Trend historian", state: "ok" };
  }
  return { adapter: new MockAdapter(), label: "Mock data (demo)", state: "ok" };
}

async function main() {
  const store = new TrendStore();
  const { adapter, label, state } = pickAdapter();

  const chart = new TrendChart(document.getElementById("chart"), store, document.getElementById("cursor"));
  const browser = new SourceBrowser(document.getElementById("browser"), store);
  const penlist = new PenList(document.getElementById("penpanel"), store);
  const toolbar = new Toolbar(document.getElementById("toolbar"), store, chart, {
    onRefreshChange: (ms) => restart(ms),
  });
  toolbar.setConnection(state, label);
  const emptyEl = document.getElementById("chart-empty");

  await adapter.connect();
  const tags = await adapter.browse();
  store.setTags(tags);
  browser.render();
  penlist.render();

  // DOM reacts to store changes (data + selection); canvas scrolls via rAF below.
  store.subscribe(() => { browser.refresh(); penlist.render(); toolbar.refresh();
    emptyEl.style.display = store.getPens().length ? "none" : "flex"; });

  // live data feed (restartable for refresh-rate changes); onStatus keeps the connection
  // chip honest — a dead feed turns it amber/red instead of staying green.
  let unsub = null;
  const onStatus = (state, label) => toolbar.setConnection(state, label);
  function restart(ms) { if (unsub) unsub(); unsub = adapter.subscribe((u) => store.updateValues(u), ms, onStatus); }
  restart(store.refreshMs);

  // smooth render loop — keeps the time axis scrolling in live mode + cursor responsive
  function loop() { chart.render(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  // demo convenience: preselect a couple of pens so the screen isn't empty on first load
  store.selectPen("VFD1.out_freq");
  store.selectPen("VFD1.out_current");
  store.selectPen("DI.photo_eye");
  emptyEl.style.display = "none";

  window.addEventListener("resize", () => chart.render());
}

main().catch((e) => {
  document.getElementById("toolbar").innerHTML =
    `<span class="brand" style="color:var(--alarm)">Trend viewer failed to start: ${e.message}</span>`;
  console.error(e);
});
