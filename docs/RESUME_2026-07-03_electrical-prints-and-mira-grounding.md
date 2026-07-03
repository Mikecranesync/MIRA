# RESUME — Conv_Simple electrical prints + MIRA conveyor grounding (2026-07-03)

**Branch:** `feat/litmus-bench-proof` · **All work below is UNCOMMITTED** (untracked).
**One line:** Built a model-first electrical **print set** for CV-101 (E-005 + E-007 drafted, from
recovered prior art), a standards + style reference pack, and **verified MIRA answers CV-101 from
approved evidence** (context model + A0–A12 anomaly log).

---

## Paste-to-resume prompt

> Continue the Conv_Simple / CV-101 electrical-print + MIRA-grounding work on branch
> `feat/litmus-bench-proof` (all uncommitted). Read this resume, then
> `docs/discovery/electrical_print_prior_artifact_recovery.md` and
> `docs/reference/excalidraw_electrical_print_style.md` FIRST. **Rules:** structured YAML is the
> source of truth; one sheet / one circuit family; terminal-to-terminal + wire-numbered +
> field-verified; **search for prior art before drawing** (prior Modbus work lives in the separate
> CCW project `C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\instructions\`); verify premises against
> the running program before asserting (the Channel 0→2 correction is the cautionary tale). Next
> action is one of the "Open items" below — ask which, or take E-003/E-006 (recoverable from
> `Conv_Simple_ControlsToVFD.pdf`). Do NOT redraw the device-map "workbench" style.

---

## What exists now (deliverables + status)

### A. Electrical print package — model-first (`plc/conv_simple_electrical/`)
Source of truth = `model/*.yaml`; renderer = `render_sheet.py` → `sheets/<id>.{svg,pdf,png}`.
- `model/devices.yaml · terminals.yaml · wires.yaml · sheets.yaml · open_items.yaml · e007_rs485.yaml`
- **E-005 PLC Inputs — DRAFTED** (`sheets/E-005_plc_inputs.pdf`). Micro820 2080-LC20-20QBB
  I-00..I-05 grounded in the REAL program (`plc/Prog_init_ConvSimple_v2.1.st`) + Ignition
  `MIRA_IOCheck/Inputs/tags.json` + `LogicalValues.csv`: I-00 fwd, I-01 rev, I-02 e-stop NC,
  I-03 e-stop NO, I-04 run PB, I-05 photo-eye. PLC terminal↔function = **verified/solid**; field
  wiring (wire #s, +24V source, COM) = **FIELD VERIFY/dashed** (no as-built) → `open_items.yaml`.
- **E-007 RS-485 / Modbus — DRAFTED** (`sheets/E-007_rs485_modbus.pdf`). Rebuilt in the RECOVERED
  `CommsToVFD` style (device-to-device, connection table, Belden 3105A + conductor colors, RJ45 pin
  map, shield-at-PLC-end-only, 120Ω at drive, troubleshooting). **Modbus only** (no FWD/REV/VI/ACM/FA).
  Mostly **verified**; shield chassis point = field-verify.
- Run: `python plc/conv_simple_electrical/render_sheet.py E-005` (or `E-007`).
- E-001/2/3/4/6/8/9 = **stub** in `sheets.yaml`.

### B. Reference + recovery docs
- `docs/reference/electrical_print_examples.md` — real-print visual targets (9 categories, verified
  URLs, per-sheet emulation map). Confirms Micro820 terminal names vs Rockwell **2080-IN009**.
- `docs/reference/excalidraw_electrical_print_style.md` — the model-first style rules (the law).
- `docs/references/industrial-wiring-diagram-standards.md` — NFPA79/UL508A/NEMA/IEC/ISA standards
  pack + a MIRA wiring-print **reader/extraction model** (separate from the diagram *generator* in
  `mira-bots/shared/wiring_diagram/`).
- `docs/discovery/electrical_print_prior_artifact_recovery.md` — **READ THIS**: where the prior
  Modbus wiring work lives + what to copy / NOT copy.

### C. MIRA conveyor grounding — VERIFIED (answers from approved evidence)
- `plc/conv_simple_anomaly/context_model.cv101.json` — approved context model (approved_by mike,
  2026-07-01); every signal traced to source + confidence + approval; `vfd_comm_ok` trust-gate;
  explicit `unmapped` list ("say unavailable, don't guess").
- `plc/litmus/demo_context_model.py` — raw registers → approved model → grounded answer with an
  **"Evidence used"** table + **refusals**. Ran offline (replay): idle→"normal idle stop, not a
  fault"; comm-down→`A1_COMM_STALE` + refuses to diagnose stale values. **17 CI tests pass.**
  `python plc/litmus/demo_context_model.py --source replay --fixture cv101_comm_down`.
- Live path (same code, real PLC) = `--source plc` (needs bench LAN to 192.168.1.100 — NOT reachable
  from a code session).

### D. Ask MIRA button + anomaly log — NEW harness
- Button path: `MaintenancePanel`/`MiraAsk` view → `runScript` → `mira_diagnose` gateway script →
  `mira_diagnose_core` (== `rules_core.py`) `evaluate()` → cards (banner + severity + message +
  next-check + askText). Already logs fault-state transitions to gateway logger `FactoryLM.Mira.MaintPanel`.
- `plc/conv_simple_anomaly/anomaly_log.py` — **NEW.** Drives the exact A0–A12 brain over a 14-scenario
  fault battery; writes `out/anomaly_log/anomaly_log.{md,csv,jsonl}`. **All 12 coded rules fire;**
  healthy cases clean; A2 + A12 marked `[reflash]` (need slave-map-v2). `test_rules.py` = 27 pass.
  `python plc/conv_simple_anomaly/anomaly_log.py`.

---

## Key decisions & corrections (do not relitigate)

1. **Device-map style is REJECTED.** The first `plc/conv_simple_wiring_diagram.pdf` (one giant page,
   boxes+colored lines, generic labels) is the regression. Do not reproduce it.
2. **Model-first only.** No solid wire unless it's in `wires.yaml` with both terminals + signal +
   type + evidence; unknown → dashed FIELD VERIFY or `open_items.yaml`. Color ≠ meaning; wire
   numbers + terminal labels carry it.
3. **Search prior art before drawing.** The RS-485 sheet already existed in `CCW/MIRA_PLC`; E-007
   recovered it instead of reinventing.
4. **Channel 0 → 2 correction (verified from the running program).** The May-16 draft said embedded
   RS-485 = "Channel 0" + "SGND pin 1/8" + 8N2. Bench-verified truth (May-26, baked into
   `Prog_init_ConvSimple_v2.1.st` + `Beginner_Verify` p48): **MSG_MODBUS Channel 2**, **SGND = RJ45
   pin 3**, **8N1** (P09.04=12). E-007 uses the corrected values + a red callout. (memory
   `feedback_micro820_channel0`.)
5. **GS10 RJ45 pinout:** pin 5 = SG+ (=D+/485+, white), pin 4 = SG- (=D-/485-, black), pin 3 = SGND;
   shield drain landed **PLC end only**, floated at GS10; 120Ω across SG+/SG- at the drive end.

## Prior artifacts (separate CCW project — the recovered gold)
`C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\instructions\`:
- `Conv_Simple_CommsToVFD.pdf` §2 = the RS-485 **style model** (terminal table, Belden, pin map,
  shield, A/B-polarity troubleshooting).
- `Conv_Simple_GS10_Beginner_Verify_V2.pdf` p48 = the **corrected** pins/channel checklist.
- `Conv_Simple_ControlsToVFD.pdf` = the CONTROL (FWD/REV/command) counterpart → source for E-003/E-006.
- `MIRA_PLC_WorkInstruction_v3.pdf` = **MIRA-WI-001 Rev A** (2026-05-21).

---

## Open items / next actions (pick one)

1. **Draw the next sheet from recovered art (one at a time):**
   - **E-003 VFD power** + **E-006 PLC outputs** — recover from `Conv_Simple_ControlsToVFD.pdf`
     (GS10 R/S/T→U/V/W; O-00..O-06 → run-permit relay → GS10). Add rows to the model, extend
     `render_sheet.py`.
   - E-002 one-line · E-004 24 VDC · E-008 terminal strip/wire list · E-001 cover · E-009 open items.
2. **Live bench verification (Mike drives):** run the real **Ask MIRA button** in the ConvSimpleLive
   Perspective session; inject faults via the `ANOMALY_CATALOG.md` bench loop (`live_logger.py` →
   `live_check.py`); run `demo_context_model.py --source plc` against the live Micro820.
3. **Un-gate A2 + A12:** the slave-map-v2 reflash (DI_05 coil 000023 / GS10 0x2100) unblocks the
   photo-eye family + drive-fault decode (`plc/RESUME_1668_PLC_FEED.md`).
4. **Extend the anomaly log** with the ~30 🔵 candidate rules (B/C/D/F/G groups) from the catalog.
5. **Commit** the print package + docs + harness when ready (currently all uncommitted).

## Relevant memories / rules
- Memories: `feedback_electrical_prints_discipline`, `project_wiring_print_reader`,
  `feedback_micro820_channel0`, `project_conv_simple_anomaly`, `project_maintenance_intelligence_module`.
- Rules: model-first style (`docs/reference/excalidraw_electrical_print_style.md`),
  `.claude/rules/session-discipline.md` (premise-verify, search prior art), `.claude/rules/fieldbus-readonly.md`.
