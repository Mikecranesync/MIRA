# Discovery — CV-101 Perspective ↔ MIRA capability/context dashboard integration

Phase 0 (discovery only, no code) for wiring the existing CV-101 context-model / capability-matrix
work into the Ignition Perspective conveyor dashboard. Two parallel Explore passes + direct
verification of the load-bearing files.

**Thesis:** the Perspective dashboard shows *"what the conveyor is doing"*; the **Ask MIRA** button
explains *"what the data means, what evidence supports it, what tests are valid, and what MIRA
refuses to claim"* — powered by the SAME context/capability layer already built in
`plc/litmus/demo_context_model.py`. **Integration, not reinvention.**

## Files inspected
- `plc/litmus/demo_context_model.py` — the existing CLI: `run_demo`, `map_to_signals`,
  `answer_question`, `summarize_capabilities`, `generate_test_plan`, `build_derived`, `load_model`.
  Writes artifacts to `out/demo/garage_conveyor_context_model/` (incl. `capability_and_test_plan.md`).
- `plc/conv_simple_anomaly/context_model.cv101.json` — approved signals/components/evidence/approval
  + `unmapped` (photo-eye, freq-setpoint, **torque_pct, motor_rpm, output_power_kw** now declined).
- `plc/conv_simple_anomaly/trend_historian.py` — **bench-local Python HTTP service** (FastAPI/uvicorn,
  `TREND_HTTP_PORT=8766`): `/health`, `/trend`, `/trends/summary`, `/chart`, `/viewer/`. Owns the PLC
  Modbus poll; SQLite backend. **This is how a Perspective view already consumes bench-local data.**
- `ignition/project/com.inductiveautomation.perspective/views/`:
  - `Trends/TrendPanel/resource.json` — an `ia.display.webBrowser` whose **`source` =
    `http://127.0.0.1:8766/viewer/index.html?source=historian`** (iframes the historian).
  - `Mira/MiraPanel/resource.json` — an `ia.display.webBrowser` whose **`source` =
    `/system/webdev/FactoryLM/mira?asset=conveyor_demo`** (the WebDev "Ask MIRA" HTML).
  - `ConveyorStatus/resource.json` — live OPC/expression bindings (state banner, VFD metrics).
- `ignition/webdev/FactoryLM/` — WebDev endpoints: `mira/doGet.py` (chat HTML), `api/chat/doPost.py`
  (POST → cloud `/api/v1/ignition/chat`, HMAC-signed), `api/diagnose/doGet.py` (in-gateway A0–A12).
- `mira-hub/src/app/api/demo/*` — cloud Next.js demo routes (`/api/demo/signals/summary`, `.../context`).

## Existing architecture (how a Perspective view gets data here)
1. **Live tags** — Perspective **expression bindings** read OPC tags from the Micro820 Modbus driver
   (allowlist `ignition/project/approved_tags.json`). Synchronous, always-on.
2. **Bench-local HTTP service (iframe)** — the **Trends** view iframes `trend_historian.py` on
   `127.0.0.1:8766`. No cloud, no WebDev module. *This is the proven bench pattern.*
3. **WebDev + cloud (iframe → POST)** — the **Ask MIRA** (MiraPanel) view iframes
   `/system/webdev/FactoryLM/mira`, whose JS POSTs to `/system/webdev/FactoryLM/api/chat` → cloud.

## What is already built (reuse — do NOT rebuild)
- The entire **context/capability layer** in `demo_context_model.py`: mapped signals, declined
  signals (with reasons), capability matrix, generated/skipped test plan, claim boundary, grounded
  answer. Replay + PLC sources. Zero third-party deps. Tests green (16 demo + 27 rules).
- A **bench-local HTTP + Perspective-iframe pattern** to copy verbatim (`trend_historian.py` +
  `TrendPanel`).

## What is missing (the integration gap)
- No **stable JSON contract** the dashboard can consume off the capability layer (the CLI writes
  markdown/artifacts, not a single dashboard JSON).
- No **bench-local endpoint** serving that contract (the historian serves trends, not capabilities;
  the WebDev/cloud Ask MIRA path **404s on the bench** — module not deployed — and needs an HMAC key
  + cloud, so it is NOT reliable for a weekend bench demo).
- The **Trends** view shows a live chart but **does not surface unavailable/declined signals**
  (torque/RPM/power/webcam) — the honesty point of the demo.

## Smallest safe integration path (chosen)
**A bench-local, stdlib-only, read-only adapter** — `plc/litmus/dashboard_api.py` — that reuses
`demo_context_model` as the single source of truth and serves the contract. Mirrors the proven
`trend_historian.py` + Perspective-iframe pattern; **no cloud, no WebDev module, no `:8094`, no PLC
writes**. Port **8770** (historian owns 8766).
- `GET  /api/demo/cv101/context`      → full contract JSON
- `GET  /api/demo/cv101/capabilities` → capability matrix + trend availability JSON
- `GET|POST /api/demo/cv101/ask`      → grounded answer + evidence + boundary JSON
- `GET  /trends`                      → minimal HTML: available (value/unit) + **unavailable** signals
- `GET  /ask`                         → minimal HTML "Ask MIRA (bench, local)" panel calling `/ask`
- `GET  /health`
- `?source=replay&fixture=cv101_idle_healthy` (default) or `?source=plc` (reuses existing PLC read).

**Why not mira-hub `/api/demo/context` (Explore B's pick):** it is the **cloud** Next.js stack (Neon +
tenant auth), cannot cleanly call the Python CLI, and violates the "works without cloud / bench-local"
guardrail. Good as a *future* SaaS surface; wrong for the weekend bench demo.

**Perspective wiring:** repoint the **Ask MIRA** (MiraPanel) `webBrowser.source` from the 404 WebDev
path to `http://127.0.0.1:8770/ask` (strict improvement — the current path is dead on the bench).
For **Trends**, keep the existing historian chart and add the honesty panel
(`http://127.0.0.1:8770/trends`) — documented in the runbook (one-line `source`), so the live chart
is preserved.

## Tests to add
- Contract: producible from `cv101_idle_healthy`; contains asset/source/timestamp, mapped signals,
  declined signals (torque/RPM/power with reasons), available+unavailable trend signals, capability
  matrix, generated + skipped tests, claim boundary, answer summary; no `:8094`; no PLC write path.
- Adapter: `/api/demo/cv101/context|capabilities|ask` return the contract fields; replay default;
  `/trends` HTML lists unavailable signals (not silently hidden); `/health` ok; handler is read-only.

## Out of scope (explicit)
- Litmus internal `:8094` read API; editing Litmus DBs.
- PLC writes.
- Inventing torque / RPM / output-power / webcam / time-series drift-spike behavior (reported
  UNAVAILABLE, never faked).
- Rebuilding the CLI or creating a second context-model system.
- The mira-hub cloud endpoint / cloud "Ask MIRA" / WebDev-module redeploy (deferred; not needed).
- Full native Perspective trend charts (reuse the existing historian chart).

## Integration path clear? YES — proceed to Phase 1.
