# CV-101 Evidence — photo drop folder

Drop conveyor photos here (or in any folder and tell Claude the path). These close the gaps found in
`docs/discovery/conveyor_document_context_audit.md` so a **real, evidence-grounded** wiring diagram can be
built — not a synthesized one.

**Safety:** LOTO the main + verify zero voltage before removing any cover or shooting near line terminals.
Nameplates, keypads, sensors, and RS-485/PLC wiring can be shot live.

## Shot list (name files as shown — dated is fine, e.g. `01_conveyor_overview_2026-07-02.jpg`)

### A. Nameplates (straight-on, fill the frame, in focus — these are the #1 gap)
- [ ] `01_conveyor_overview` — whole machine, both ends, in one frame
- [ ] `02_motor_nameplate` — the motor's nameplate (FLA, HP/kW, RPM, V, SF, frame)
- [ ] `03_vfd_nameplate` — GS10 nameplate (model, kW/HP, input/output ratings)
- [ ] `04_photoeye_label` — the photo-eye body + its **part-number label** (brand/model)

### B. Wiring — shoot WIDE first, then CLOSE-UP of each block (overlap so terminals can be traced)
- [ ] `05_panel_overview` — full control panel, door open, everything visible
- [ ] `06_plc_terminals` — Micro820 I/O terminal block(s), close enough to read terminal numbers + wire labels
- [ ] `07_vfd_power_terminals` — GS10 R/S/T (in) and U/V/W (out) terminals
- [ ] `08_contactor` — the safety contactor + its coil wiring
- [ ] `09_estop_station` — E-stop button wiring / control station (both channels if visible)
- [ ] `10_rs485_run` — the RS-485 cable between PLC and GS10 (routing + both end terminals)
- [ ] `11_any_existing_legend` — any existing wiring label, legend, or schematic taped in the panel

### C. Drive parameters (optional but high-value — closes the "live GS10 params" gap)
- [ ] `12_gs10_keypad_*` — GS10 keypad showing key params if easy: P00.20, P00.21, P09.00, P09.01

## What Claude does with these
1. Reads each photo, transcribes nameplate + terminal data as **cited evidence**.
2. Builds a wiring diagram grounded only in what the photos show (marks anything unreadable as UNKNOWN,
   never invented).
3. Cross-checks against the verified register map in `plc/conv_simple_anomaly/context_model.cv101.json`
   and flags any mismatch.
4. Can then promote `motor` (FLA) and `photo_eye` from `proposed` → verified in a follow-up.

> Not sure a shot is legible? Take it twice — one wide, one macro. More overlap = better trace.
