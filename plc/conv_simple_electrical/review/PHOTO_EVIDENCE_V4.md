# CV-101 — Real-Wiring Photo Evidence vs. the Drawn Package (V4 input)

Source: 4 photos sent by Mike to `@Mira_stagong_bot` 2026-07-11, retrieved read-only from the
staging bot's durable photo queue (`stg-mira-bot-telegram:/mira-db/photo_batches.db`, batch id=1),
decoded to `review/photos/wire_1..4.jpg` (768×1024, vision-resized). Caption: *"These are pictures
of the actual devices. The block with all the wires coming out of it. Blue and white is just a
distribution block for positive and negative of the DC from the power supply. The MW 120 to 24 volt
DC power supply."*

**Confidence key:** HIGH = large printed device/terminal text, read directly. MED = legible but
partly obscured. LOW/UNREAD = present in frame but not resolvable at this resolution.

## Photo → what it shows → sheet impact

### wire_2.jpg — the control panel (PS1 + PLC1 + a surprise)
| Reading | Conf | Was in model | Verdict |
|---|---|---|---|
| **Mean Well power supply**: "24V/1.0A", "100-240VAC 0.55A 50/60Hz", terminals +V / −V / DC-OK (top), ⏚ N L (bottom), "+V ADJ" pot, green "DC OK" LED lit | HIGH | PS1 = "24 VDC control supply", `evidence: field_verify` | **CONFIRM + upgrade.** PS1 is a Mean Well ~24V/1A DIN supply; device identity + ratings now verified. (Matches caption "MW 120 to 24 volt DC power supply".) → E-004 groundwork. |
| **Allen-Bradley Micro820 2080-LC20-20QBB** + "MAC ID 5C:88:16:D8:E4:D7", IN 0-11 / OUT 0-7 LEDs | HIGH | PLC1, `verified` | **CONFIRM.** Exact model match; MAC captured. |
| **Siemens CPU 1212C AC/DC/RLY (S7-1200)** on the same panel, with analog-input block | HIGH | *absent* | **NEW / UNEXPLAINED.** A second controller. Not referenced anywhere in the model or repo. → OI-23 (role unknown; do NOT wire into CV-101 sheets without evidence). |
| Device with sticky note **"PMC 192.x"** + green Ethernet "P1" | MED | *absent* | **NEW.** Unknown (network device / meter?). → OI-24. |

### wire_1.jpg — the DC distribution block
| Reading | Conf | Verdict |
|---|---|---|
| DIN-rail **push-in spring terminal blocks** (orange levers, ~7-8 poles, two levels); blue + white/gray conductors; one red feed top-right; a wire printed "…600V (UL)…" | HIGH (device) / LOW (wire IDs) | **CONFIRM the caption:** a DC +/− distribution block fed from PS1. Blue = one polarity, white = the other (caption). Exact circuit count + which color is +24 vs 0V = UNREAD → OI-25. → E-004 / E-008 groundwork. A second empty DIN rail is present. |

### wire_3.jpg — the "MLC" device  ⚠ MAJOR CORRECTION
| Reading | Conf | Was in model | Verdict |
|---|---|---|---|
| **Schneider Electric TeSys, hand-labeled "MLC"**, part **CA3KN22BD**, "24V ⎓", coil terminals **A1 / A2**, aux contacts **13-14 (NO), 21-22 (NC), 31-32 (NC), 43-44 (NO)** | HIGH | Q1 = "SAFETY POWER **CONTACTOR** (MC/'MLC')", `type: contactor`, "power poles on E-003", pole/coil ids *proposed*, coil V *field_verify* | **CONTRADICT + correct.** The device labeled MLC is a **CONTROL RELAY** (TeSys CA3K, 2NO+2NC), **not a 3-phase motor contactor** — it has **no main power poles**. So: (a) coil **A1(+)/A2(−) + 24VDC now VERIFIED** (were proposed); (b) part number captured; (c) **E-003's 3-pole "Q1 power contactor" in the R/S/T line is not supported** — remove it; (d) the relay + its aux contacts belong on the **control** side (E-006). Reconciles WI-001's loose "safety contactor" wording: it's a drive-enable *control relay*, coil = O-02. |

### wire_4.jpg — the GS10 VFD  ⚠ MAJOR CORRECTION
| Reading | Conf | Was in model | Verdict |
|---|---|---|---|
| **AutomationDirect GS10** keypad (RUN/FWD/REV, "H0.00", STOP-RESET/MENU/ENTER, speed pot) | HIGH | VFD1, `verified` | **CONFIRM.** |
| GS10 **control terminal legend read directly**: top `FWD REV DI3 DI4 DI5 +24V DCM DCM`, bottom `+10V ACM AI AO1 DO1 DOC PE` | HIGH | not modeled | **CONFIRM the GS10 control-terminal names** (matches manual §6). Add as a verified terminal group. |
| **Conductors landed on the GS10 control connector** (ferruled wires on the bottom analog/output row at minimum; likely the top run/DI row too) | MED (wires present) / UNREAD (which→where) | E-006/E-007 assert **"GS10 control = Modbus only, NO GS10 DI wiring"** | **CONTRADICT.** The GS10 control connector **is populated** — the "Modbus-only, no control wiring" premise is wrong on the real bench. It's a **hybrid** (Modbus + hardwired control I/O). Exact map (which of FWD/REV/DI3-5/AI/AO1/DO1 is used, to what) = UNREAD → OI-22. |
| **Purple RJ45 cable plugged into the GS10 RS-485 jack** | HIGH | E-007 RS-485 via RJ45 | **CONFIRM** the RS-485/Modbus link is physically present. |

## Net corrections for V4
1. **Q1 → control relay** (Schneider TeSys CA3KN22BD, 24VDC coil A1/A2, aux 13-14/43-44 NO + 21-22/31-32 NC). Coil↔O-02 holds and is now verified. It is NOT a motor contactor.
2. **E-003 power path** loses the invented 3-pole contactor: SUPPLY → CB1 → GS10 `R/S/T` → M1 (+ PE). A prominent note explains the MLC is a control relay (E-006), and a **separate motor contactor was NOT observed** → OI-21 (presence = FIELD VERIFY; don't invent one).
3. **E-006** gains the real relay: coil A1(+)/A2(−) 24VDC (verified), aux contacts, part number; and a note that **the GS10 control connector is wired** (hybrid, not Modbus-only) → OI-22.
4. **PS1 → verified device** (Mean Well 24V/1A); real E-004 content.
5. **New open items:** OI-21 motor-contactor presence · OI-22 GS10 control-terminal wiring map (contradicts Modbus-only) · OI-23 Siemens CPU 1212C role · OI-24 "PMC 192" device · OI-25 DC block polarity/circuit count · OI-26 MLC aux-contact destinations.
6. **Not asserted:** the Siemens 1212C and PMC device are logged as observed but NOT wired into the CV-101 sheets — no evidence links them to this asset yet.
