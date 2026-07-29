# CV-101 — Evidence & Provenance Report

Every claim below traces to a citation: a photo, a manual page/line, a PLC program file/line, or a dated technician statement. Status `verified` = cited and checked; `field_verify` = a real, located gap, not a guess. Device-identity claims backed by a bundled photo link to its redacted thumbnail below.

## E-002 — Power one-line

**Devices on this sheet:**

- `CB1` (field_verify) — 2-pole branch breaker on the 230 V single-phase supply (existence/type/rating unconfirmed)
- `M1` (field_verify) — Conveyor drive motor — 230 V 3~ from VFD1 U/V/W (voltage technician-confirmed 2026-07-11)
  - citation: review/PHOTO_EVIDENCE_V7.md (technician confirmation 2026-07-11 — "it's 230"; OI-27 resolved). NOT PHOTO_EVIDENCE_V6.md, which predates this confirmation and still shows 480 V/pending.
- `PS1` (verified) — 24 VDC control supply (E-004). Feeds the DC +/- distribution block (blue = one polarity, white = the other) and the +24V/0V control loop.
  ![wire_2.jpg](photos/wire_2.jpg)
  - citation: photo review/photos/wire_2.jpg (2026-07-11 — Mean Well nameplate read directly); caption "MW 120 to 24 volt DC power supply"
- `Q1` (verified) — Control relay (Schneider CA3KN22BD, hand-labeled 'MLC') USED AS THE VFD SUPPLY SWITCH — its two NO contacts 13-14 & 43-44 switch the 230 V single-phase supply into the GS10 (R/L1, S/L2); coil A1(+)/A2(-) 24 VDC driven by PLC O-02. Energizing O-02 closes the contacts and powers the drive. Shown on E-003 (power contacts) + E-006 (coil). NC 21-22/31-32 unused.
  ![wire_3.jpg](photos/wire_3.jpg)
  - citation: photo review/photos/wire_3.jpg (2026-07-11 — device label 'MLC', part no CA3KN22BD, coil A1/A2 24V, aux 13-14/21-22/31-32/43-44 read directly); plc/CCW_VARIABLES_v4.0.txt:80 (O-02 coil); plc/Prog_init_ConvSimple_v2.1.st:214 (vfd_run_permit reads O-02); review/photos/mlc_full.jpg + mlc_top_terminals.jpg + mlc_bottom_terminals.jpg (2026-07-11 — full-resolution terminal read)
- `VFD1` (verified) — Drives conveyor motor. Power input is 230 V single-phase (R/L1, S/L2; T/L3 unused — technician-confirmed 2026-07-11, see E-003). Commanded over Modbus RTU (RJ45, Ch2 node 1) — photo confirms the RS-485 cable is landed. NOTE the GS10 control connector is ALSO wired (hybrid, not Modbus-only) — see OI-22.
  - citation: photo review/photos/wire_4.jpg (2026-07-11 — keypad, control-terminal legend, RJ45 read directly); plc/GS10_Integration_Guide.md; plc/Prog_init_ConvSimple_v2.1.st; review/photos/gs10_full.jpg + gs10_control_terminals.jpg (2026-07-11 — full-resolution control-terminal read)

**Conductors on this sheet:**

- SOURCE -> CB1: 230 V 1φ supply (1φ, 2W) — **field_verify**
  - citation: review/PHOTO_EVIDENCE_V6.md (technician field correction 2026-07-11)
- CB1 -> Q1: protected 230 V 1φ (1φ, 2W) — **field_verify**
  - citation: review/PHOTO_EVIDENCE_V6.md
- Q1 -> VFD1: switched 230 V 1φ (R/L1, S/L2) (1φ, 2W) — **field_verify**
  - citation: plc/GS10_UM.txt (terminals L1971-1986); review/PHOTO_EVIDENCE_V6.md
- VFD1 -> M1: 230 V 3φ motor output (U/T1, V/T2, W/T3) (3φ, 3W) — **field_verify**
  - citation: plc/GS10_UM.txt (terminals L1971-1986); motor voltage technician-confirmed 2026-07-11 (OI-27 resolved) — review/PHOTO_EVIDENCE_V7.md §3, not V6 (which predates this confirmation)
- SOURCE -> PS1: branch tap — 24 VDC control supply (1φ, 2W+PE) — **field_verify**
  - citation: photo review/photos/wire_2.jpg (2026-07-11 — Mean Well nameplate); see E-004
  ![wire_2.jpg](photos/wire_2.jpg)

## E-003 — VFD power

**Devices on this sheet:**

- `CB1` (field_verify) — 2-pole branch breaker on the 230 V single-phase supply (existence/type/rating unconfirmed)
- `M1` (field_verify) — Conveyor drive motor — 230 V 3~ from VFD1 U/V/W (voltage technician-confirmed 2026-07-11)
- `Q1` (verified) — Control relay (Schneider CA3KN22BD, hand-labeled 'MLC') USED AS THE VFD SUPPLY SWITCH — its two NO contacts 13-14 & 43-44 switch the 230 V single-phase supply into the GS10 (R/L1, S/L2); coil A1(+)/A2(-) 24 VDC driven by PLC O-02. Energizing O-02 closes the contacts and powers the drive. Shown on E-003 (power contacts) + E-006 (coil). NC 21-22/31-32 unused.
  ![wire_3.jpg](photos/wire_3.jpg)
- `VFD1` (verified) — Drives conveyor motor. Power input is 230 V single-phase (R/L1, S/L2; T/L3 unused — technician-confirmed 2026-07-11, see E-003). Commanded over Modbus RTU (RJ45, Ch2 node 1) — photo confirms the RS-485 cable is landed. NOTE the GS10 control connector is ALSO wired (hybrid, not Modbus-only) — see OI-22.

**Conductors on this sheet:**

- W300: SUPPLY (source — see E-002) -> CB1.1 (L1 230V 1ph supply) — **field_verify**
- W301: SUPPLY (source — see E-002) -> CB1.3 (L2 230V 1ph supply) — **field_verify**
- W303: CB1.2 -> Q1.13 (L1 protected -> MLC) — **field_verify**
- W304: CB1.4 -> Q1.43 (L2 protected -> MLC) — **field_verify**
- W305: Q1.14 -> VFD1.R/L1 (L1 switched -> drive) — **field_verify**
- W306: Q1.44 -> VFD1.S/L2 (L2 switched -> drive) — **field_verify**
- W310: VFD1.U/T1 -> M1.T1 (motor phase U) — **field_verify**
- W311: VFD1.V/T2 -> M1.T2 (motor phase V) — **field_verify**
- W312: VFD1.W/T3 -> M1.T3 (motor phase W) — **field_verify**
- W315: VFD1.GND -> PE bus (drive PE (≤0.1Ω)) — **field_verify**
- W316: M1.PE -> PE bus (motor frame PE) — **field_verify**
- W317: PE bus -> SUPPLY (source — see E-002) (PE to source) — **field_verify**

## E-004 — 24 VDC control power distribution

**Devices on this sheet:**

- `DB1` (verified) — 24 VDC +/- distribution block (push-in, WAGO-style, 2-level), fed from PS1's +V/-V output — blue = one polarity, white = the other (caption); which color is +24V vs 0V = FIELD VERIFY (OI-25).
  - citation: photo review/photos/dc_block_full.jpg + wire_1.jpg (2026-07-11 — push-in distribution block read directly)
- `PS1` (verified) — 24 VDC control supply (E-004). Feeds the DC +/- distribution block (blue = one polarity, white = the other) and the +24V/0V control loop.
  ![wire_2.jpg](photos/wire_2.jpg)

**Conductors on this sheet:**

- W400: 230 V 1φ (E-002) -> PS1.L (AC line in) — **field_verify**
- W401: 230 V 1φ (E-002) -> PS1.N (AC neutral in) — **field_verify**
- W402: PS1.+V -> DB1.+24V-bus (+24 VDC distribution feed) — **field_verify**
- W403: PS1.-V -> DB1.0V-bus (0V distribution return) — **field_verify**
- W404: DB1.+24V-bus -> control loads (E-005/E-006) (+24V to E-005/E-006 loads) — **field_verify**
- W405: DB1.0V-bus -> control loads (E-005/E-006) (0V to E-005/E-006 loads) — **field_verify**

## E-005 — PLC digital inputs

**Devices on this sheet:**

- `B1` (verified) — Product-present beam to I-05 (blocked -> pe_latched soft stop)
  - citation: plc/Prog_init_ConvSimple_v2.1.st (_IO_EM_DI_05 -> pe_latched)
- `PLC1` (verified) — Conveyor controller; Modbus RTU master to VFD1
  ![wire_2.jpg](photos/wire_2.jpg)
  - citation: photo review/photos/wire_2.jpg (2026-07-11 — model label + MAC ID 5C:88:16:D8:E4:D7 read directly); plc/GS10_Integration_Guide.md; plc/ccw/controller/Controller/LogicalValues.csv
- `PS1` (verified) — 24 VDC control supply (E-004). Feeds the DC +/- distribution block (blue = one polarity, white = the other) and the +24V/0V control loop.
  ![wire_2.jpg](photos/wire_2.jpg)
- `S0` (verified) — Emergency stop, DUAL-CHANNEL (diverse) — NC ch to I-02, NO ch to I-03
- `S2` (verified) — Run / rearm pushbutton to I-04; illuminated — lamp fed by PLC O-03 (PBRunLED)
  - citation: plc/ignition-project/.../Inputs/tags.json ("DI-04 Run pushbutton"); plc/CCW_VARIABLES_v4.0.txt:73 ("I-04 _IO_EM_DI_04 PBRun (illuminated momentary)")
- `SS1` (verified) — Direction selector — FWD contact to I-00, REV contact to I-01 (FWD-OFF-REV)
  - citation: plc/Prog_init_ConvSimple_v2.1.st (dir_fwd/dir_rev)

**Conductors on this sheet:**

- W24: PS1.+24V -> +24V rail (this sheet) (+24 VDC) — **field_verify**
- W500: SS1.FWD -> PLC1.I-00 (dir_fwd) — **field_verify**
- W501: SS1.REV -> PLC1.I-01 (dir_rev) — **field_verify**
- W502: S0.11-12 -> PLC1.I-02 (e_stop_nc (healthy=1)) — **field_verify**
- W503: S0.23-24 -> PLC1.I-03 (e_stop_no (healthy=0)) — **field_verify**
- W504: S2.3-4 -> PLC1.I-04 (run_pb) — **field_verify**
- W505: B1.BK -> PLC1.I-05 (photo_eye) — **field_verify**
- W0V: PLC1.COM0 -> PS1.0V (0V / input common) — **field_verify**

## E-006 — PLC outputs

**Devices on this sheet:**

- `PL1` (verified) — Green RUNNING pilot — load of O-00 (LightGreen)
  - citation: plc/CCW_VARIABLES_v4.0.txt:78
- `PL2` (verified) — Red FAULT/E-STOP pilot — load of O-01 (LightRed)
  - citation: plc/CCW_VARIABLES_v4.0.txt:79; plc/GS10_Integration_Guide.md (Lineage-A fault_lamp)
- `PLC1` (verified) — Conveyor controller; Modbus RTU master to VFD1
  ![wire_2.jpg](photos/wire_2.jpg)
- `PS1` (verified) — 24 VDC control supply (E-004). Feeds the DC +/- distribution block (blue = one polarity, white = the other) and the +24V/0V control loop.
  ![wire_2.jpg](photos/wire_2.jpg)
- `Q1` (verified) — Control relay (Schneider CA3KN22BD, hand-labeled 'MLC') USED AS THE VFD SUPPLY SWITCH — its two NO contacts 13-14 & 43-44 switch the 230 V single-phase supply into the GS10 (R/L1, S/L2); coil A1(+)/A2(-) 24 VDC driven by PLC O-02. Energizing O-02 closes the contacts and powers the drive. Shown on E-003 (power contacts) + E-006 (coil). NC 21-22/31-32 unused.
  ![wire_3.jpg](photos/wire_3.jpg)
- `S2` (verified) — Run / rearm pushbutton to I-04; illuminated — lamp fed by PLC O-03 (PBRunLED)

**Conductors on this sheet:**

- W600: PS1.+24V -> PLC1.+CM0 (output bank 0 feed) — **field_verify**
- W601: PLC1.O-00 -> PL1.X1 (LightGreen (run light)) — **field_verify**
- W602: PLC1.O-01 -> PL2.X1 (LightRed (fault/e-stop light)) — **field_verify**
- W603: PLC1.O-02 -> Q1.A1 (ContactorQ1 coil (safety power)) — **field_verify**
- W604: PLC1.O-03 -> S2.X1 (PBRunLED (run button lamp)) — **field_verify**
- W605: PL1.X2 -> output return rail (E-006) (run light return) — **field_verify**
- W606: PL2.X2 -> output return rail (E-006) (fault light return) — **field_verify**
- W607: Q1.A2 -> output return rail (E-006) (contactor coil return) — **field_verify**
- W608: S2.X2 -> output return rail (E-006) (PB lamp return) — **field_verify**
- W609: PLC1.-CM0 -> PS1.0V (output bank 0 return) — **field_verify**

## E-007 — RS-485 / Modbus RTU communication

**Devices on this sheet:**

- `PLC1` (verified) — Conveyor controller; Modbus RTU master to VFD1
  ![wire_2.jpg](photos/wire_2.jpg)
- `VFD1` (verified) — Drives conveyor motor. Power input is 230 V single-phase (R/L1, S/L2; T/L3 unused — technician-confirmed 2026-07-11, see E-003). Commanded over Modbus RTU (RJ45, Ch2 node 1) — photo confirms the RS-485 cable is landed. NOTE the GS10 control connector is ALSO wired (hybrid, not Modbus-only) — see OI-22.

**Conductors on this sheet:**

- 485+: PLC1.D+ (A) -> VFD1.RJ45 pin 5 / SG+ (RS-485 inverting (D+ = SG+)) — **verified**
  - citation: CommsToVFD 2.2 + Beginner_Verify p48
- 485-: PLC1.D- (B) -> VFD1.RJ45 pin 4 / SG- (RS-485 non-inverting (D- = SG-)) — **verified**
  - citation: CommsToVFD 2.2 + Beginner_Verify p48
- SGND: PLC1.SG -> VFD1.RJ45 pin 3 / SGND (signal ground / common reference) — **verified**
  - citation: Beginner_Verify p48 (SGND -> pin 3; CommsToVFD 'pin 1/8' SUPERSEDED)
- SH: PLC1.shield / chassis -> VFD1.(floated) (cable shield) — **field_verify**
  - citation: shield-one-end rule (both docs); exact PLC chassis point = field verify

## E-008 — Terminal strip (X1) + wire list

## E-009 — Open items / field verification

## Evidence bundle (customer-provided)

| Path | Kind | Provenance |
|---|---|---|
| `plc/conv_simple_electrical/review/photos/wire_2.jpg` | photo | bench photo, 2026-07-11 — Micro820 model label + MAC ID + Mean Well nameplate |
| `plc/conv_simple_electrical/review/photos/wire_3.jpg` | photo | bench photo, 2026-07-11 — Q1 (MLC) aux contacts landed |
| `plc/GS10_Integration_Guide.md` | manual | GS10 integration guide (repo) |
| `plc/conv_simple_electrical/review/PHOTO_EVIDENCE_V7.md` | technician_statement | technician confirmation 'it's 230', 2026-07-11 (OI-27 close-out) |

## QA summary (distilled from the independent review panel)

**Final verdict: APPROVABLE WITH FIELD VERIFICATION**

| Sheet | Technician | Controls | Drafting | Auditor |
|---|---|---|---|---|
| E-001 cover | 99 | 97 | 97 | 99 |
| E-002 one-line | 98 | 99 | 99 | 100 |
| E-003 VFD power | 94 | 92 | 95 | 96 → **98** |
| E-004 24 VDC | 99 | 99 | 96 | 91 → **98** |
| E-005 PLC inputs | 99 | 100 | 97 | 99 |
| E-006 PLC outputs | 99 | 97 | 98 | 90 → **99** |
| E-007 RS-485 | 95 | 95 | 99 | 100 |
| E-008 wire list | 99 | 100 | 100 | 100 |
| E-009 docket | 100 | 100 | 100 | 89 → **99** |

**2 issue(s) found during review, fixed, and independently re-checked before delivery:**

- **HF-A — OI-27 provenance (E-003/E-009).** "230 V motor, technician-confirmed" cited `PHOTO_EVIDENCE_V6.md`, which predated the confirmation and still recorded the 480 V/pending state — a broken citation chain (the *fact* was right; the *paper trail* was stale). FIX: the technician's actual 230 V confirmation is now recorded in `PHOTO_EVIDENCE_V7.md`; every 230 V/OI-27 claim cites V7; V6 retained only where it backs the (separate, legitimate) single-phase-topology/OI-21 facts. Auditor re-audit: **cleared** (V7 read directly, all citations verified, no conflation).
- **HF-B — render-only fact (E-006).** "O-02 do-not-reuse (WI-001 p.4)" was a hardcoded renderer literal (HF6). FIX: the fact moved to `sheets.yaml` E-006 `annotations.safety` with a real cite; the E-006 **and** E-007 title-block `lineage` strings moved to the model; validator Check K blocklist strengthened. Auditor re-audit: **cleared**, mutation-tested (re-inserting the literal correctly fails Check K). A third same-class residual (E-003's "terminals per GS10 UM 1st Ed Rev B" lineage, pre-existing, non-blocking) was also moved to the model and the blocklist widened to catch it.

This summary is distilled from the preparer's internal engineering QA record for a customer-facing read; the full adversarial review ledgers are not reproduced here.
