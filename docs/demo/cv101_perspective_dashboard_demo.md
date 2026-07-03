# Demo runbook — CV-101 Perspective dashboard powered by the MIRA capability layer

**Thesis:** the Perspective dashboard shows *"what the conveyor is doing"*; **Ask MIRA** explains
*"what the data means, what evidence supports it, what tests are valid, and what MIRA refuses to
claim"* — both driven by the SAME context/capability contract from `plc/litmus/demo_context_model.py`.

**Runs without cloud, without the WebDev module, without live PLC** (replay default). No Litmus
`:8094`. No PLC writes.

---

## Architecture (one picture)

```
plc/litmus/demo_context_model.py   (the ONE source of truth: mapped/declined signals,
        │  build_contract()          capability matrix, generated/skipped tests, claim boundary)
        ▼
plc/litmus/dashboard_api.py  ── bench-local, read-only HTTP on 127.0.0.1:8770 ──┐
   GET /api/demo/cv101/context | /capabilities | /ask   (JSON)                   │
   GET /trends   (honesty panel: available + UNAVAILABLE signals + live chart)   │  webBrowser
   GET /ask      (Ask MIRA bench panel)                                          │  iframes
        ▲                                                                        ▼
  (optional) trend historian :8766 live chart  ◄── iframed inside /trends   Ignition Perspective
                                                                             Trends tab + Ask MIRA
```

## 1. What to start

```bash
# REQUIRED — the read-only dashboard adapter (replay default; no PLC needed)
python plc/litmus/dashboard_api.py
#   -> CV-101 dashboard adapter (read-only) on http://127.0.0.1:8770  [replay default, no cloud]

# OPTIONAL — the live trend chart (only if you want the moving chart inside the Trends tab)
#   needs the bench PLC; the honesty tables work without it.
python plc/conv_simple_anomaly/trend_historian.py     # serves :8766
```

## 2. Verify the adapter (before opening Ignition)

```bash
curl http://127.0.0.1:8770/health
curl http://127.0.0.1:8770/api/demo/cv101/capabilities   # capability matrix + trend availability
curl -X POST http://127.0.0.1:8770/api/demo/cv101/ask     # grounded answer + boundary
# open the panels a browser (and Perspective) will show:
#   http://127.0.0.1:8770/trends      http://127.0.0.1:8770/ask
```

## 3. What screen to open

Open the Perspective conveyor project (bench gateway URL, e.g. `http://<gateway>:8088/data/perspective/client/FactoryLM`):
- **Conveyor** page — live state (unchanged; OPC/expression bindings).
- **Trends** tab (`/trends` view) — now shows the **honesty panel** from the adapter: a table of
  **available** signals (latest value + unit) and a table of **unavailable / not mapped** signals
  (torque %, motor RPM, output power, webcam) each with a reason, plus the reused live historian
  chart embedded below.
- **Ask MIRA** panel (`/mira` view) — now points at the bench adapter `/ask`.

## 4. What button to click

In the **Ask MIRA** panel, click **"Why is CV-101 stopped?"**.

## 5. Expected output

**Trends tab** (honest):
- Available: `vfd_dc_bus 321.5 V`, `vfd_frequency 0.00 Hz`, `vfd_current 0.00 A`, `vfd_voltage`,
  `vfd_cmd_word 1 (STOP)`, `vfd_status_word`, `vfd_fault_code 0`, `motor_running`, `vfd_comm_ok`,
  `e_stop_active`, `estop_wiring_fault`.
- **Unavailable / not mapped (not hidden):** `torque`, `motor RPM`, `output power`,
  `visual confirmation (webcam)` — each with a reason.

**Ask MIRA** answer (idle-healthy replay):
> **Answer:** CV-101 is stopped because it is **not being commanded to run** — the GS10 command word
> reads STOP and the motor-running signal is OFF. This is a normal idle stop, **not a fault**:
> PLC↔GS10 link healthy, DC bus ~321.5 V, no GS10 fault (code 0), e-stop clear.
- **Evidence used:** the mapped signals above.
- **Valid tests:** comm-trust/stale-suppression, idle-vs-commanded-run, electrical-vs-mechanical
  separation, current-based load-proxy.
- **Skipped tests:** torque/over-torque, output-power, RPM/slip, visual confirmation, load
  drift/spike (single snapshot).
- **MIRA will NOT claim:** torque/over-torque, output power, RPM/slip, a visually-confirmed root
  cause, or load drift/spikes from a single snapshot.

To show a fault cleanly (no PLC needed), point the panels at the comm-down fixture:
`http://127.0.0.1:8770/ask?source=replay&fixture=cv101_comm_down` → MIRA flags **A1 GS10 RS-485 link
down (CRITICAL)** and refuses to diagnose the (stale) VFD values.

## 6. Prove the same capability matrix powered it

```bash
python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy --contract --no-write
```
The printed contract (`capability_matrix`, `trend_signals`, `generated_tests`, `skipped_tests`,
`claim_boundary`, `answer`) is byte-for-byte what the adapter serves — one source of truth.

## 7. Switch from replay to live PLC (if the bench is connected)

The adapter and CLI both accept `?source=plc` (reuses the existing read-only Modbus read in
`demo_context_model.read_raw_plc`). To switch the dashboard, change the query on the two view
`webBrowser` sources:
- Trends: `http://127.0.0.1:8770/trends?source=plc`
- Ask MIRA: `http://127.0.0.1:8770/ask?source=plc`
If the PLC is unreachable the adapter returns `503 {"error":"source_unreachable"}` — fall back to
`source=replay`. Live PLC read is **read-only**; no writes.

## What changed to wire this (rollback)

- `ignition/.../Mira/MiraPanel/resource.json` — `webBrowser.source`
  `/system/webdev/FactoryLM/mira?asset=conveyor_demo` (404 on bench) → `http://127.0.0.1:8770/ask?...`.
- `ignition/.../Trends/TrendPanel/resource.json` — `view.params.trendUrl` + fallback `source`
  `http://127.0.0.1:8766/viewer/index.html?source=historian` → `http://127.0.0.1:8770/trends?...`
  (the historian chart is preserved — it is iframed inside the adapter's `/trends` page).
- To roll back: restore those two URL strings.

## Out of scope (unchanged)

- Litmus internal `:8094`; editing Litmus DBs. PLC writes. Cloud services / WebDev-module redeploy.
- Inventing torque / RPM / output-power / webcam / time-series drift-spike (reported UNAVAILABLE).
- Rebuilding the CLI or a second context-model system. Native Perspective trend charts (reuse the
  existing historian chart).

## Cross-references
- Discovery + decision: `docs/discovery/cv101_perspective_mira_dashboard_integration.md`
- Contract + capability layer: `plc/litmus/demo_context_model.py` (`build_contract`)
- Adapter: `plc/litmus/dashboard_api.py`
- Tests: `plc/litmus/test_demo_context_model.py`, `plc/litmus/test_dashboard_api.py`
