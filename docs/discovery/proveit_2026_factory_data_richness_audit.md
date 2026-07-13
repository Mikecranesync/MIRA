# ProveIt 2026 / Northwind Bottling — Simulated Factory Data-Richness Audit

**Status:** discovery (2026-07-01). **No product features built. Not committed.**
**Method:** enumerated the SimLab line model directly (ground truth), not guessed. Where a
maintenance signal is absent, it is stated as absent — nothing is faked.

> **Bottom line up front.** The simulated factory is **process/quality/state-rich but
> maintenance-electrical-poor.** It exposes fill level, pressure, temperature, reject counts,
> run states, jam/interlock bits — plus a *thin* motor layer (output current on 4 assets,
> output frequency on the filler only, string fault codes). It does **NOT** expose the
> maintenance-grade VFD diagnostics Mike reads on his real conveyor: **torque %, DC bus voltage,
> output voltage, drive/IGBT temperature, kW/power, overload count, numeric decoded fault codes,
> vibration, bearing temp, runtime hours, start/cycle counters.** Several of those exist only as
> *manual text* (citable evidence), not as measurable signals.

---

## 1. Data sources found

- **The sim is CODE-defined, not a data export.** The Northwind/ProveIt factory = SimLab's juice
  bottling line in `simlab/lines/juice_bottling.py` + per-asset physics in `simlab/baselines/*.py`.
  There is **no Northwind/ProveIt CSV, historian dump, or Sparkplug/MQTT capture file** — signals
  are generated deterministically at runtime (`SimEngine`, seed 42).
- **Manuals (evidence):** `simlab/docs/<asset>/{troubleshooting,fault_code_table,plc_tag_description_sheet,
  pm_checklist,operator_quick_guide,spare_parts_notes,electrical_io_notes}.md` — 7 docs × 11 assets.
- **Scenarios:** `simlab/scenarios.py` (A–F) + `tests/simlab/scenarios/*.yaml` (deterministic faults).
- **Difference-engine / flight-recorder pieces (already built):** `demo/factory_difference_engine/*`,
  `demo/factory_difference_engine/flight_report.py`, `tests/simlab/{test_proveit_demo,test_flight_report}.py`,
  and the in-flight `simlab/flight_recorder.py` (PR #2335).
- **Real-conveyor tag exports (the contrast / gold standard):** `plc/ignition-project/.../VFD/tags.json`,
  `plc/ignition-project/tags/MIRA_IOCheck/VFD/tags.json`, `ignition/tags/tags.json`,
  `mira-ignition-exchange/.../MIRA_tags.json`, and the real historian `plc/conv_simple_anomaly/trend_historian.py`.
  These are Mike's GS10-via-Micro820 signals — **maintenance-grade, and richer than the sim.**

## 2. How many signals/tags exist

- **Total: 89 tags across 11 assets** (the juice line).
- **By asset:** filler01 **14**, capper01 10, casepacker01 9, conveyorzone01 8, conveyorzone02 8,
  labeler01 8, palletizer01 8, depalletizer01 7, rinser01 7, cipskid01 6, airsystem01 4.
- **By category:** status **33**, process **25**, faults **10**, production 7, quality 6, **motor 5**, alarms 3.
- **By value type:** float 31, bool 23, int 16, string 10, enum 9.

The shape of the data is clear from the category split: **status (33) + process (25) dominate;
"motor" is only 5 tags for the whole line.**

## 3. What kinds of signals are present (maintenance categories)

| Maintenance category | Present in the sim? | Example tags |
|---|---|---|
| Process values (pressure/level/flow/temp) | ✅ rich | `filler_bowl_pressure`, `fill_level_oz`, `tank_level_percent`, `product_temperature`, `glue_temperature`, `supply_temp`/`return_temp` |
| Machine state (running/stopped/jammed/ready/faulted) | ✅ rich | `run_state`(enum), `jam_detected`, `cap_present`, `cycle_step`, sensor bools |
| Quality signals (rejects/underfills/counts/variance) | ✅ rich | `underfill_reject_count`, `overfill_reject_count`, `reject_count`, `fill_level_variance`, `*_target` |
| Actuator/motor signals | ⚠️ thin | `motor_current_amps` (filler/capper/conv1/conv2), `vfd_speed_hz` (**filler only**) |
| **VFD/drive diagnostics (torque/current/voltage/frequency/DC bus/drive temp/fault code)** | ❌ **mostly ABSENT** | only current + (filler) freq; **no torque%, DC bus, voltage, drive temp, numeric fault code** |
| Electrical (current/voltage/power/energy) | ❌ current only | `motor_current_amps`; **no voltage/power/kW/energy** anywhere |
| Condition monitoring (vibration/bearing temp/runtime/starts/cycles) | ❌ ABSENT as signals | none (vibration/bearing appear only in **manuals**) |
| Safety/interlock (e-stop/guards/permissives) | ✅ partial | palletizer `robot_ready`/E-stop, jam/interlock bools (state category) |
| Maintenance signals (runtime hours/PM counters/fault history) | ❌ ABSENT as signals | fault **counters** exist (`nozzle_fault_count`); **no runtime hours / start counts**; fault history lives in manuals |
| Document/manual evidence | ✅ rich | 7 docs/asset incl. `fault_code_table.md`, `troubleshooting.md`, `plc_tag_description_sheet.md` |

**Important nuance:** "torque" (75 hits), "bearing" (12), "overload" (27), "vibration" (2) appear in
the repo — but **overwhelmingly in the MANUALS (docs), not as tags** (torque: 38 doc vs 16 code;
bearing 11 doc; overload 17 doc). The one "torque" *tag* is `cap_torque_inlb` — the **capper's
cap-application torque** (a process/quality value), **not VFD motor-shaft torque %.** MIRA can *cite*
bearing/overload/torque from manuals; it cannot *measure* them from signals.

## 4. Sim vs Mike's real conveyor (the practical benchmark)

| Mike's conveyor VFD param | In the ProveIt sim? | Notes |
|---|---|---|
| **Torque %** | ❌ **absent** | only capper `cap_torque_inlb` (process, not VFD). Should be added. |
| **Output frequency (Hz)** | ⚠️ **partial** | `vfd_speed_hz` on **filler01 only**. Extend to more assets. |
| **DC bus voltage** | ❌ **absent** | 0 tags. Add. |
| **Output voltage** | ❌ **absent** | 0 tags. Add. |
| **Output current (A)** | ✅ **present** | `motor_current_amps` on filler/capper/conv1/conv2 (4 of 11). |
| **Power / kW** | ❌ **absent** | 0 tags. Add. |
| **IGBT / drive temperature** | ❌ **absent** | 0 tags (only *product/glue/supply* temps). Add. |
| **Overload count** | ❌ **absent as signal** | manual-only. Add as a counter. |
| **Fault codes** | ⚠️ **partial** | `fault_code` is a **string**, not a numeric decoded register like the GS10. Enrich. |
| **Run status** | ✅ **present** | `run_state` enum (Idle/Running/…). |
| **Photoeye / sensor state** | ✅ **present** | jam/occupancy/present bools (state category). |
| **Motor run command vs feedback** | ⚠️ **derivable, not explicit** | `run_state`+`vfd_speed_hz` imply it; no explicit `run_cmd`/`run_fb` pair. Add. |

**Verdict:** of the ~12 maintenance-grade params Mike reads live, the sim has **~3 present
(current, run status, sensor state), 2 partial (frequency filler-only, string fault code, run
cmd/fb derivable), and ~6 outright absent (torque, DC bus, output voltage, kW, drive temp, overload).**

## 5. Maintenance-usefulness score (1–5)

| Capability | Score | Why |
|---|---|---|
| Process troubleshooting | **5** | pressure/level/temp/flow/variance/targets — genuinely rich |
| Mechanical troubleshooting | **3** | jam/cap-torque/state bits + manual evidence, but no vibration/bearing *signals* |
| Electrical troubleshooting | **1–2** | only `motor_current_amps`; no voltage/power/DC bus |
| Controls troubleshooting | **4** | run_state enums, interlocks, cycle_step, string fault codes |
| VFD / motor diagnostics | **1–2** | current + (filler) freq only; the maintenance-grade drive params are absent |
| Quality diagnostics | **5** | reject/underfill/overfill/variance/targets — strong |
| Predictive-maintenance potential | **2** | drift on process values gives *some* early-warning; no runtime/starts/cycles/vibration/bearing |
| Black-box replay usefulness | **5** | fully deterministic, seeded, replayable — excellent |
| MIRA dialogue usefulness | **4** | rich process + manuals + fault-code strings + evidence → strong grounded dialogue; capped by thin electrical/VFD |

## 6. What the current data CAN already prove

- Baseline-vs-current comparison and **drift** on real process signals (bowl pressure 12→5, fill 16→12.6).
- **Pressure drop → underfill → reject increase** causal signature (scenario A), end to end.
- **Event grouping** (many differences → one machine event) and a deterministic timeline.
- **Evidence-backed, cited explanation** (abnormal tags + the asset's manuals) that passes the rubric.
- **Read-only proof** (zero PLC writes) and **deterministic replay** (seed 42 → identical every run).
- Cross-asset cascades (low plant air → downstream symptoms, scenario F).

## 7. What the current data CANNOT prove yet (honest gaps)

- **No motor torque** (VFD %) — can't show a jam/mechanical-load torque climb.
- **No DC bus voltage** — can't show bus sag/over-voltage or ride-through.
- **No output voltage / power (kW) / energy** — no electrical-load or energy story.
- **No drive/IGBT temperature** — no thermal-derate / overheat troubleshooting.
- **No numeric decoded VFD fault code** — only a free-text `fault_code` string (no code→meaning decode like GS10 CE10/ocA).
- **No overload counter, no runtime hours, no start/cycle counters** — weak predictive-maintenance base.
- **No vibration / bearing temperature** — no condition-monitoring signals (only manual references).
- **No real physical feedback** — it's simulated; and **no live historian** feed (the historian exists for the *real* conveyor, not wired to this sim in the demo path).

## 8. Recommended demo improvements (minimum extra simulated tags)

Add a **per-asset VFD diagnostic block** (start with **filler01 = CV-200** to mirror Mike's conveyor),
plus condition/PM counters. All are simulated, deterministic, read-only:

**VFD block (highest value):** `vfd_output_hz`, `vfd_output_current_a`, `vfd_torque_pct`,
`dc_bus_voltage_v`, `output_voltage_v`, `drive_temp_c`, `vfd_fault_code`(int, decoded).
**Motor cmd/feedback:** `motor_run_cmd`(bool), `motor_run_fb`(bool).
**Condition / PM:** `runtime_hours`, `start_count`, `cycle_count`, `overload_count`.
**Already present / keep:** `underfill_reject_count`, `filler_bowl_pressure`, jam/photoeye bools,
air header pressure (`airsystem01`), valve open/closed feedback.

Priority order: **torque% + DC bus + output current/voltage + drive temp + numeric fault code on
filler01**, then extend the VFD block to the two conveyor zones, then runtime/starts/cycles line-wide.

## 9. Black Box / Difference Engine implications

Richer VFD/condition data would materially strengthen every layer already built:
- **Difference cards:** "torque +35% above normal, DC bus sagged 12 V, drive temp climbing" — the
  cards become *mechanically/electrically* diagnostic, not just process.
- **Event timelines:** correlate a torque spike → current climb → bus sag → fault code, in order.
- **MIRA explanations:** move from "bowl pressure low → underfill" to "current-limit + torque climb ⇒
  mechanical drag / bearing / belt" — the kind of answer a maintenance tech actually needs.
- **Evidence panels:** cite a numeric fault code against the manual's `fault_code_table.md` (code→meaning),
  not just a string.
- **Human review:** approve/reject *component-level* inferences (e.g. "signal = VFD DC bus") with real data.
- **Predictive dialogue:** runtime hours + start/cycle counts + drift enable "trending toward failure" talk.
- **Customer demo:** a bottling line that shows *drive diagnostics* looks like a real maintenance tool,
  not a process dashboard.

## 10. Final recommendation

- **Rich enough for a weekend VISUAL demo? YES.** Process + quality + state + manuals + deterministic
  replay already produce a compelling, honest black-box readout (the Phase-1 HTML report proves it).
- **Rich enough for a SERIOUS maintenance-intelligence demo? NOT YET (partial).** The VFD/electrical/
  condition-monitoring layer is too thin to demonstrate drive, motor, or predictive troubleshooting.
- **Signals to add first:** the **filler01 (CV-200) VFD diagnostic block** — torque %, DC bus, output
  current/voltage, drive temp, numeric decoded fault code — then runtime/starts/cycles.
- **Use Mike's real conveyor VFD data as the gold standard? YES.** The GS10-via-Micro820 signals
  (torque, frequency, current, voltage, DC bus, RPM, power, decoded fault codes) — already proven to
  read live and mirrored in `plc/ignition-project/.../VFD/tags.json` — are the maintenance-grade
  benchmark. Enrich the sim *toward* that shape so the demo and the real bench tell the same story.

## Cross-references
- Ground-truth model: `simlab/lines/juice_bottling.py`, `simlab/baselines/*.py`, `simlab/models.py`.
- Generated artifacts: `demo/factory_difference_engine/out/data_richness/` (tag inventory + gap matrix).
- Real-conveyor gold standard: `plc/ignition-project/.../VFD/tags.json`, `plc/conv_simple_anomaly/*`.
- Consumers: `demo/factory_difference_engine/`, `docs/prd/factorylm_flight_recorder_black_box_prd.md`.
