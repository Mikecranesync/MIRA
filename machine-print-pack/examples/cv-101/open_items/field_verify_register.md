# Field-Verify Register

28 items; 2 closed, 26 open. Severity is a deterministic, keyword-derived triage aid, not a code-compliance certification.

## OI-01 [OPEN] — sheet E-005 — severity: functional

**Item:** +24 VDC source terminal on PS1 feeding the input rail

**Verify:** Meter PS1 +24V to 0V = 24 VDC; confirm which terminal feeds the input devices.

**Tooling needed:** multimeter

## OI-02 [OPEN] — sheet E-005 — severity: functional

**Item:** Input common (COM0) grouping + sink vs source jumpering on the Micro820

**Verify:** Confirm which embedded input common serves I-00..I-05 and whether inputs are sink or source; meter COM0 to 0V.

**Tooling needed:** multimeter

## OI-03 [OPEN] — sheet E-005 — severity: functional

**Item:** All input wire numbers (W200..W205, W24, W0V are PROPOSED)

**Verify:** Read the actual wire markers on the panel; replace proposed numbers with as-built.

**Tooling needed:** visual inspection

## OI-04 [OPEN] — sheet E-005 — severity: functional

**Item:** Field-device terminal designations (S0 11-12/23-24, SS1 FWD/REV/COM, S2 3-4, B1 BN/BU/BK)

**Verify:** Confirm each device's real terminal markings against its nameplate/datasheet.

**Tooling needed:** visual inspection

## OI-05 [OPEN] — sheet E-005 — severity: safety_code

**Item:** E-stop architecture between S0 and the PLC

**Verify:** Confirm whether S0 lands directly on I-02/I-03 or via a safety relay; a monitored input is NOT a safety stop (see safety note).

**Tooling needed:** visual inspection

## OI-06 [OPEN] — sheet E-005 — severity: functional

**Item:** Photo-eye B1 device (historically 'unmapped') — make/model, PNP/NPN, powered source

**Verify:** Identify the physical sensor; confirm BN/BU/BK to +24V/0V/I-05; PNP sourcing assumed.

**Tooling needed:** visual inspection

## OI-07 [OPEN] — sheet E-005 — severity: functional

**Item:** Direction selector SS1 physical device (2-pos vs 3-pos FWD-OFF-REV)

**Verify:** Confirm selector type and that FWD/REV contacts map to I-00/I-01.

**Tooling needed:** visual inspection

## OI-08 [OPEN] — sheet E-005 — severity: informational

**Item:** Spares I-06..I-11 confirmed unused

**Verify:** Confirm no field wires land on I-06..I-11 (program shows none).

**Tooling needed:** visual inspection

## OI-09 [OPEN] — sheet E-006 — severity: functional

**Item:** Output bank technology + common feeds. +CM0/-CM0/+CM1/-CM1 polarity naming suggests DC transistor banks; devices.yaml io line says 'relay DO' — conflict.

**Verify:** Resolve per 2080-IN009 + meter the bank feed (expect PS1 +24V/0V).

**Tooling needed:** multimeter

## OI-10 [OPEN] — sheet E-006 — severity: functional

**Item:** Q1 contactor identity — part number, coil voltage, pole count; coil terminal ids A1/A2 are PROPOSED.

**Verify:** Meter coil circuit from O-02.

**Tooling needed:** multimeter

## OI-11 [OPEN] — sheet E-006 — severity: functional

**Item:** PL1/PL2 devices + lamp terminal ids (X1/X2 proposed); S2 lamp terminals.

**Verify:** Meter the light circuits and confirm device markings.

**Tooling needed:** multimeter

## OI-12 [OPEN] — sheet E-006 — severity: informational

**Item:** Confirm no field wires on spare O-04..O-06 (+CM1 bank unused).

**Verify:** Trace the PLC output block and verify no wires to O-04, O-05, O-06.

**Tooling needed:** multimeter (continuity)

## OI-13 [OPEN] — sheet E-005, E-006 — severity: functional

**Item:** Re-confirm input AND output map against the live Conv_Simple_1.8 CCW project; v4.0 vintage drift proven on I-05 'Entry sensor' vs live photo-eye.

**Verify:** Open the live Conv_Simple_1.8 CCW project and cross-check every I-xx and O-xx assignment against the drawn functions (I-05 drift already proven; O-02 has independent Prog_init corroboration).

**Tooling needed:** CCW laptop (live project)

## OI-14 [OPEN] — sheet E-003 — severity: functional

**Item:** Q1 contactor placement in the power chain (assumed line side of VFD1 per 'safety power'; could be elsewhere).

**Verify:** Trace conductors on the bench; verify Q1 poles 1-6 actual locations. R-C surge absorber both ends recommended per GS10 manual.

**Tooling needed:** multimeter (continuity)

## OI-15 [OPEN] — sheet E-003 — severity: safety_code

**Item:** Supply voltage/receptacle + CB1 existence/type/rating (2-pole, single-phase 230 V branch breaker).

**Verify:** Identify the bench supply; confirm CB1 device and rating. NEC and GS10 manual require upstream protection.

**Tooling needed:** visual inspection

## OI-16 [OPEN] — sheet E-003 — severity: safety_code

**Item:** GS10 exact model+frame (enables wire-gauge/fuse tables); M1 nameplate; conductor gauges; PE points + ground resistance ≤0.1Ω check.

**Verify:** Photograph GS10 nameplate and motor nameplate; measure PE resistance between drive/motor grounds and supply PE.

**Tooling needed:** camera

## OI-17 [OPEN] — sheet E-003 — severity: safety_code

**Item:** RFI jumper in/out per grounding topology (symmetrical vs corner-grounded unknown).

**Verify:** Determine bench PE bonding strategy; verify RFI jumpers per GS10_UM.txt L1693-1718 if present.

**Tooling needed:** visual inspection

## OI-18 [OPEN] — sheet E-006 — severity: functional

**Item:** Fallback DI wiring physical presence (expected ABSENT — P02.0x factory default).

**Verify:** Trace the PLC output block; confirm zero hardwired leads to any GS10 digital inputs (fallback path should be unpopulated).

**Tooling needed:** multimeter (continuity)

## OI-19 [OPEN] — sheet E-003, E-005, E-006 — severity: functional

**Item:** Wire-numbering convention adopted: W[sheet-digit][line-2d] (see wires.yaml convention + the E-001 key). E-005 renumbered W200..W205 → W500..W505. Rails (W24, W0V) and E-007 mnemonic labels (485+/485-/SGND/SH) are exempt. All numbers PROPOSED until as-built.

**Verify:** Read the actual wire markers on the panel; replace proposed W-numbers with as-built (mirror of OI-03).

**Tooling needed:** visual inspection

## OI-20 [OPEN] — sheet E-007 — severity: functional

**Item:** GS10 comms line params: 2026-05-20 export = 38.4k/8N2 vs 2026-05-26 bench sniff = 9600/8N1 — adjudicate.

**Verify:** Fresh keypad readback of the GS10 serial config; update print if params differ from current 9600/8N1 assumption.

**Tooling needed:** GS10 keypad

## OI-21 [CLOSED] — sheet E-003 — severity: functional

**Item:** RESOLVED (2026-07-11): no separate motor contactor — the MLC control relay IS the single-phase drive-supply switch (2 NO contacts). See E-003.

**Verify:** Confirm whether a separate motor contactor exists between CB1 and VFD1; the device labeled 'MLC' (Q1) is a Schneider TeSys CA3KN22BD CONTROL RELAY — it has no main power poles.

**Tooling needed:** visual inspection

**Closed:** 2026-07-11 — no separate motor contactor — the MLC control relay IS the single-phase drive-supply switch (2 NO contacts). See E-003.

## OI-22 [OPEN] — sheet E-006, E-007 — severity: functional

**Item:** GS10 control map (full-res photo): top run/DI connector (FWD/REV/DI3-5/+24V/DCM) confirmed EMPTY; bottom analog/output row (+10V/ACM/AI/AO1/DO1/DOC) confirmed WIRED. Identify which bottom-row terminals are used (speed reference +10V/AI/ACM vs feedback AO1/DO1/DOC) and to what. Confirm nothing on the top run/DI row.

**Verify:** Map which of FWD/REV/DI3/DI4/DI5/AI/AO1/DO1/DOC are landed and to what; reconcile hybrid Modbus + hardwired-terminal control.

**Tooling needed:** visual inspection

## OI-23 [OPEN] — sheet panel — severity: informational

**Item:** Siemens CPU 1212C AC/DC/RLY (S7-1200) observed on the panel (photo wire_2) — role vs CV-101 unknown.

**Verify:** Confirm whether the Siemens CPU 1212C controls any CV-101 function before referencing it on any CV-101 sheet; not drawn until evidenced.

**Tooling needed:** visual inspection

## OI-24 [OPEN] — sheet panel — severity: informational

**Item:** Device labeled "PMC 192.x" observed on the panel (photo wire_2).

**Verify:** Identify the device (network device / meter?) and its relationship, if any, to CV-101.

**Tooling needed:** multimeter

## OI-25 [OPEN] — sheet E-004 — severity: functional

**Item:** DC +/- distribution block: which color (blue vs white) is +24V vs 0V, circuit count, PS1 branch fusing; PLUS PS1's AC input source — which leg/circuit feeds L and N (120 V leg vs the 230 V 1φ supply) is not documented.

**Verify:** Trace/meter the distribution block conductors against PS1 +V/-V output; confirm color-to-polarity mapping, circuit count, and any branch fusing (photo wire_1/wire_2). Separately, identify the branch circuit feeding PS1.L/PS1.N and its voltage (single leg of the 230 V 1φ supply, or a dedicated 120 V circuit).

**Tooling needed:** multimeter

## OI-26 [OPEN] — sheet E-006 — severity: functional

**Item:** MLC (Q1) aux contacts (full-res photo): coil A1/A2 wired + NO contacts 13-14 & 43-44 in use confirmed; NC 21-22/31-32 appear unused. Trace where 13-14 and 43-44 land in the control circuit.

**Verify:** Trace each aux contact to its destination in the control circuit; confirm function (e.g., interlock feedback, seal-in, indicator).

**Tooling needed:** multimeter (continuity)

## OI-27 [CLOSED] — sheet E-003 — severity: functional

**Item:** RESOLVED (2026-07-11): motor is 230 V (technician-confirmed) — the GS10 is a standard 230 V 1φ-in / 230 V 3φ-out drive; the earlier reported 480 V was a misstatement. E-003 letters 230 V 3φ output.

**Verify:** Closed by technician confirmation — review/PHOTO_EVIDENCE_V7.md §3 ('it's 230'), not PHOTO_EVIDENCE_V6.md (which predates this confirmation and still shows 480 V/pending). Exact GS10 model/frame still tracked under OI-16 (for wire-gauge/fuse tables).

**Tooling needed:** visual inspection

**Closed:** 2026-07-11 — motor is 230 V (technician-confirmed) — the GS10 is a standard 230 V 1φ-in / 230 V 3φ-out drive; the earlier reported 480 V was a misstatement. E-003 letters 230 V 3φ output.

## OI-28 [OPEN] — sheet E-004 — severity: safety_code

**Item:** PS1 enclosure/chassis ground and DC-0V-to-PE bonding not documented — is PS1's DIN-rail/enclosure bonded to PE, and is the 24 VDC 0V rail (DB1 0V-bus) intentionally tied to PE anywhere (SELV/PELV grounding scheme), or left floating?

**Verify:** Meter PS1 enclosure/DIN rail to the PE bus for continuity; meter DB1 0V-bus to the PE bus for continuity/resistance; confirm whether a deliberate 0V-PE bond exists or the 24 VDC system is intentionally floating.

**Tooling needed:** multimeter
