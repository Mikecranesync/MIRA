# RESUME — Trends V2: full GS10 VFD parameter monitoring

> Paste-able resume prompt after /clear. State as of 2026-06-12 **evening** (PLC laptop).

## ⚡ UPDATE 2026-06-13 — layer-1 CORRECTED; only the flash remains

**The 2026-06-12b layer-1 was built on the WRONG base and has been replaced.**
Verified against the live CCW project (Mike confirms Conv_Simple_1.8 is on the PLC):

- **Live structure:** `Conv_Simple_1.8` = **Prog1 (ladder I/O) + Prog_init (ST comms,
  internal V1.8), Channel 2.** There is **no "Prog2."** The repo `plc/Prog2.stf` and
  `plc/Micro820_v4.1.9_Program.st` are a dead pre-1.8 lineage — do NOT use them. The
  earlier "deployed = Channel 0" note was **backwards**; live is Channel 2.
- **Use these (committed after `35c0549b`):**
  `plc/Prog_init_ConvSimple_v1.9.st` (extends real V1.8, Option C tiered polling),
  `plc/MbSrvConf_ConvSimple_v1.9.xml` (surgical superset of the live map),
  `plc/CCW_VARIABLES_ConvSimple_v1.9_DELTA.md` (the deploy sequence — 17 new vars,
  real CCW types). The v5.1.0 files were deleted.
- **Flash:** double-click `plc/BUILD_CONV_SIMPLE_1.9.cmd` → produces
  `CCW/MIRA_PLC/Conv_Simple_1.9` = clone of 1.8 + slave map BAKED + **pre-injected** 9 V1.9
  vars (via `inject_vars_accdb.py` cloning `vfd_status_word`/`poll_phase` rows in
  `PrjLibrary.accdb`) + V1.9 program written to `Prog_init.stf`. **Intended flow: open
  `Conv_Simple_1.9.ccwsln` → Build → Download** (Build+Download irreducible = PLC physics).
  V1.9 was redesigned to a **single reconfigured read FB** (reuses mb_read_status/read_data),
  so only **9 scalar** new vars (no FB/struct/array) — makes injection + manual fallback easy.
  **UNVERIFIED until Mike opens CCW:** the `.acfproj` names `PrjLibrary.accdb` as the project
  file (vars likely load); program-via-`.stf` less certain. If CCW shows missing vars / old
  program (binary caches `GlobalVariable.rtc`/`.xtc` overrode), fall back: `build_conv_simple_1_9.py
  --force` for a clean clone, then export-clone-import vars + paste `Prog_init_ConvSimple_v1.9.st`
  (manual steps in `_V1.9_APPLY/INSTALL_ConvSimple_v1.9.md`). 1.8 + live PLC never touched.
- Still-true facts: GS10 warn IDs ≠ fault IDs (CE10 warn 5 / fault 58); power 0x210F is
  kW×1000; Addr = wire+1 (AB firmware off-by-one, bench-proven). Real decode tables in
  `mira-trend-viewer/js/adapters/gs10.js` + `plc/conv_simple_anomaly/rules.py`.

The original V2 context below is kept for reference (note its layer-1 register/HR plan
was superseded by the V1.9 work above).

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
