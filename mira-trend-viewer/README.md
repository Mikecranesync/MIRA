# MIRA Industrial Trend Viewer

A platform-agnostic, ISA-101 / High-Performance-HMI trend viewer for FactoryLM/MIRA — built to
feel like a real PLC/SCADA trend tool (Ignition / FactoryTalk / WinCC / AVEVA), not a SaaS
dashboard. Dependency-free static web app (vanilla ES modules) + a vendor-neutral data-source
adapter layer. Works fully on mock data before any live PLC/SCADA is connected.

![trend viewer](../docs/promo-screenshots/2026-06-12_industrial-trend-viewer_desktop.png)

## Run

```bash
# any static server (ES modules need http://, not file://)
cd mira-trend-viewer && python -m http.server 8791
# open http://127.0.0.1:8791/index.html        (defaults to mock data)
```

Adapter is chosen by query string:
- `?source=mock` (default) — simulated factory: 3 VFDs, analog IO, digital IO.
- `?source=historian&base=http://<plc-laptop>:8766` — the real MIRA bench trend historian
  (`plc/conv_simple_anomaly/trend_historian.py`). Proves the same UI on a different real source.

**Embedded (no separate server):** the trend historian mounts this directory at `/viewer`, so
`http://<plc-laptop>:8766/viewer/?source=historian` serves the viewer same-origin (the adapter
auto-targets the serving origin — no `base=` needed). The Ignition Perspective
`Trends/TrendPanel` view (route `/trends`, NavBar **TRENDS** button) embeds exactly that URL,
alongside Ask MIRA.

## What it does

- **Grouped source browser** (left): VFDs · Analog Inputs · Analog Outputs · Digital Inputs ·
  Digital Outputs. VFDs are expandable device cards with child registers. Analog rows show a live
  value + bar + units + range; digital rows show a read-only ON/OFF indicator. **Every trendable
  row has a checkbox** — the trend-selection control (multi-select; never radio).
- **Trend chart** (center): analog pens = continuous auto-scaled lines (first two get labeled
  left/right Y-axes in their pen color + a value tag at the live edge); digital pens = stacked 0/1
  **step lanes** in a distinct strip so they read clearly against analog lines. Time X-axis, grid,
  hairline cursor readout, wheel-zoom + drag-pan, live/pause with a loud **VIEWING HISTORY /
  PAUSED** indicator.
- **VFD fault intelligence**: each drive exposes `fault_code` (active) **and** `last_fault` —
  the register that survives a reset, the workhorse for chasing intermittent trips. Status
  WORDs that declare a `bits` map (`{0:"Running", 5:"Faulted", …}`) are decoded once in the
  store into named boolean child tags — each bit is its own checkbox + digital step lane.
- **Selected-pen list** (bottom): every checked signal with source, value, units/state, quality,
  timestamp, and a Remove button. Remove unchecks the browser box (and vice-versa) — one source of
  truth, the store.
- **Toolbar**: Live/Pause · jump-to-now · time range (1m–8h) · refresh rate · clear pens · export
  CSV · connection/health chip.

## ISA-101 / HP-HMI discipline

Neutral gray canvas; **red/amber/green reserved for state only** (alarm/warn/ok); muted pen
colors for data; minimal decoration, no gradients/3D; bad/stale quality shown honestly (dashed
trace segments, STALE/UNCERTAIN badges, "—" not a fake number, "timestamp unavailable" when
absent). The data is the boldest thing on screen.

## Architecture (platform-agnostic)

```
 adapter (vendor-specific) ──normalized Tag[]──▶ TrendStore ──▶ UI (browser / chart / penlist / toolbar)
   connect / browse / subscribe / disconnect            the UI knows ONLY the store + model
```

- **`js/model.js`** — the vendor-neutral `Tag` (`createTag`) + enums + display helpers + grouping.
- **`js/store.js`** — DOM-free state: catalog, pen selection (bidirectional checkbox↔pen sync),
  per-pen history ring buffers, live/pause, CSV, observer. **Engineering scaling (`value =
  raw*scale + offset`) is applied once here at ingest** — a raw-count adapter (Modbus/OPC-UA) just
  reports raw + sets `scale`/`offset`.
- **`js/adapters/adapter.js`** — the `DataSourceAdapter` contract (`connect`/`browse`/`subscribe`/
  `disconnect`, plus an optional `onStatus` feed-health callback). Implement this to plug in:
  **Ignition · Allen-Bradley · Modbus · MQTT/Sparkplug · OPC-UA · Factory I/O · OpenPLC · CSV**.
- **`js/adapters/mockAdapter.js`** — the tested reference implementation (simulated factory).
- **`js/adapters/historianAdapter.js`** — a real second source (the bench trend historian).
- **`js/ui/*`** — browser, chart, penlist, toolbar. No vendor coupling.

To add a real source: implement `DataSourceAdapter`, return `createTag(...)` objects from
`browse()`, push `[{id, currentValue, quality, timestamp}]` from `subscribe()`. Nothing else
changes. **Read-only by design** (no write path) per `.claude/rules/fieldbus-readonly.md` +
train-before-deploy.

## Tests

```bash
node --test            # 33 tests: grouping, pen select/remove, checkbox sync, VFD expansion,
                       # analog-vs-digital, stale/bad quality, scale/offset, WORD/hex, mock updates,
                       # CSV, last-fault persistence, status-word bit decode + fan-out
```

## Shipped in v2 (2026-06-12)

- ✅ **VFD "last/previous fault" register** — `last_fault` per drive; persists the trip cause
  after the active `fault_code` clears on reset (mock: VFD1 runs clean, last fault `ocA`).
- ✅ **Status-word bit decode** — a WORD tag declaring `bits` gets named boolean child tags
  (Running / At Speed / Faulted / …), each a trendable digital step lane; decode happens once
  in the store (like scaling), so adapters and UI stay unchanged.
- ✅ **Ignition Perspective wiring** — the historian serves this app at `/viewer`; the
  `Trends/TrendPanel` view embeds it alongside Ask MIRA.

## Deferred to v3 (from the controls/PLC · architecture · QA · HMI review)

- **Contactor command-vs-feedback** pairing (catch a sticking/dropping contactor).
- **History backfill** — an optional `history(id, from, to)` on the adapter so a historian /
  Ignition tagHistory / timestamped CSV pre-seeds the chart instead of drawing from "now".
- **Pen-list patch-render** (avoid full rebuild each tick) and a head-pointer history ring (drop
  the O(n) splice) for high-frequency, many-pen sources.
- **Live engineering reasoning hand-off to MIRA** — "discuss this trend with MIRA" deep-link.
