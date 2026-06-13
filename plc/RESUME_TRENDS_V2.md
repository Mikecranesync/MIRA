# RESUME — Trends V2: full GS10 VFD parameter monitoring

> Paste-able resume prompt after /clear. State as of 2026-06-12 **evening** (PLC laptop).

## ⚡ UPDATE 2026-06-12b — ALL THREE LAYERS BUILT; only the reflash remains

Commits `215f0f2a` (layers 2+3) + `9cda0169` (layer 1 prep), branch
`docs/plc-1668-feed-resume`. 48/48 pytest, 41/41 node tests. What remains is
**Mike's manual CCW flash** — full sequence in `plc/CCW_VARIABLES_v5.1.0_DELTA.md`
(stop historian → `deploy_modbus_map.py` → declare vars → paste
`plc/Micro820_v5.1.0_Program.st` → build/download/Run), then the live acceptance
list in the plan doc (incl. the freq-scale check). Key truths discovered:
- DEPLOYED ladder is **v5.0.0 `Prog2.stf` (Channel 0)** — `Micro820_v4.1.9_Program.st`
  is stale (Channel 2, bogus SM2 bit-13 fault comment). v5.1.0 builds on v5.0.0.
- GS10 warn IDs ≠ fault IDs (CE10: warn 5, fault 58). Real tables live in
  `mira-trend-viewer/js/adapters/gs10.js` + `plc/conv_simple_anomaly/rules.py`.
- Power 0x210F is kW×1000 (manual X.XXX), not the plan's ×100.
The original V2 context below is kept for reference.

## Where V1 stands (DONE, live-verified, tagged)

- **`mira-trend-viewer/`** (MIRA repo): platform-agnostic ISA-101 trend viewer, 33 node
  tests. v2 features shipped: per-VFD `last_fault` register, status-WORD `bits` → derived
  boolean step lanes (decoded once in the store), historian serves the app at
  `:8766/viewer` (same origin). Tag: `trends-v1` (commit `ea9a3c92`).
- **Live Perspective integration** (MIRA_PLC repo `C:\Users\hharp\Documents\CCW\MIRA_PLC`,
  branch `feat/modbus-bench-tooling`, tag `trends-hmi-v1`, commit `a3f79b0`): the REAL
  gateway project is **ConvSimpleLive** — `/trends` page + **≋ TRENDS toggle buttons** on
  Conveyor + home views (exact Ask-MIRA popup pattern: `onActionPerformed → type:"popup",
  config.type:"toggle", viewPath:"Trends"`). Deploy = `gsudo …\ConvSimpleLive\
  APPLY_TRENDS.cmd` (stop→backup→copy→start). Verified: popup opens/closes, DC bus 321.6 V
  GOOD live, Ask MIRA unaffected.
- **Gotchas learned:** monorepo `ignition/project/` (ConveyorMIRA) does NOT load on the
  8.3.4 gateway; `ia.display.webBrowser` is not a Perspective component (`ia.display.iframe`
  is); Claude's own gsudo UAC gets canceled — Mike runs `! gsudo <script>`.
- **Runtime dependency:** `python plc\conv_simple_anomaly\trend_historian.py --bind 0.0.0.0`
  must be running (sole Modbus poller, :8766).

## The V2 task

**Plan:** `docs/plans/2026-06-12-trends-v2-full-vfd-monitoring.md` — read it first.
Add full GS10 parameter monitoring: torque %, motor RPM, power kW, freq command,
Status Monitor 1/2 (`vfd_error_code`/`vfd_warn_code`/`vfd_status_word`), PLC-latched
`vfd_last_fault`. Three layers:

1. **Ladder/slave-map (MIRA_PLC, BLOCKED ON REFLASH):** extend `vfd_poll_step` RS-485 FC03
   cycle to read 0x2100/0x2101/0x2102/0x210B/0x210C/0x210F (table already in
   `plc/GS10_Integration_Guide.md`), mirror to HR117–124, update MbSrvConf +
   `plc/deploy_modbus_map.py`, **Mike reflashes via CCW** (same reflash wakes dormant
   A2/A12 anomaly signals — see `project_conv_simple_anomaly` memory).
2. **Historian (MIRA repo):** `live_logger.py` `HR_SPECS` + `trend_accumulator.py`
   `UNITS`/`THRESHOLDS` additions. No API changes needed.
3. **Viewer (MIRA repo):** `historianAdapter.classify()` — `vfd_status_word` →
   `DataType.WORD` + **real GS10 Status Monitor 2 bits table**, `vfd_error_code`/
   `vfd_last_fault` → ENUM + **real GS10 fault-code table**. Transcribe from the GS10
   manual — GS10 ≠ GS1 (memory `feedback_gs10_not_gs1`); do NOT reuse the mock's
   placeholder maps.

Layers 2+3 can be built + unit-tested before the reflash (tags just stay absent until the
PLC serves them). Acceptance criteria are in the plan doc.

## Verify-first commands

```bash
curl http://127.0.0.1:8766/health                      # historian up?
curl "http://127.0.0.1:8766/trends/summary?window=30"  # which vfd_* tags exist now
# Perspective: http://localhost:8088/data/perspective/client/ConvSimpleLive/conveyor
cd mira-trend-viewer && node --test                    # 33 green
```

Memories: `project_trend_viewer`, `project_trend_capability`, `project_conv_simple_anomaly`,
`feedback_gs10_not_gs1`.
