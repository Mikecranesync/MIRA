# CV-101 Wiring Evidence Log (from bench photos)

**Purpose:** transcribed, **cited** evidence from Mike's garage bench photos, 2026-07-02. This is the ONLY
source for the electrical print — nothing here is invented. Each row cites the photo it came from.
Anything a photo does not show is marked **UNKNOWN / pending photo**, never guessed.

Photos live in `C:\Users\hharp\.claude\uploads\1e1f2e0f-...\` (session uploads). Filenames abbreviated below.

Legend: ✅ = read directly off the photo · ⚠️ = partially legible / inferred · ❓ = not shown.

---

## Device schedule (nameplates)

### PLC — Allen-Bradley Micro820  (photos …142 nameplate, …144 front)
| Field | Value | Src |
|---|---|---|
| Catalog | `2080-LC20-20QBB` SER C | ✅ …142 |
| Firmware | **FW 12.011** (nameplate) — note repo CIP read reported rev 14.11 | ✅ …142 |
| MAC ID | `5C:88:16:D9:75:DC` (nameplate) | ✅ …142 |
| MAC ID (front label) | `5C:88:16:D?:E4:D7` (partly hidden by wire — **differs** from nameplate; possible 2nd unit or misread) | ⚠️ …144 |
| Serial / PN | SN 28556-1379 / PN-509420 | ✅ …142 |
| Power | 24 VDC Class 2, 8.5 W; In 24VDC/24VAC; Out analog 0-10VDC + digital 1A | ✅ …142 |
| Comms | EtherNet/IP; **IP `192.168.1.100`** (sticky note) | ✅ …142/…144 |
| Made | Singapore, 2023-03-18 | ✅ …142 |

### VFD — AutomationDirect DURApulse GS10  (photos …151 front, …152 terminals)
| Field | Value | Src |
|---|---|---|
| Family | **DURApulse GS10** (AutomationDirect); catalog **GS11N-20P2** | ✅ …150/…151 |
| **Model** | **GS11N-20P2** (barcode `GS1120P2+K25310021`), Ver 1.03, made India | ✅ …150 nameplate |
| **Input** | **1-PHASE 200-240 V 50/60 Hz**, VT 5.8 A / CT 5.1 A | ✅ …150 |
| **Output** | **3-PH 0-230 V, VT 1.8 A / CT 1.6 A, 0.25 HP (0.2 kW)**, 0-599 Hz | ✅ …150 |
| SCCR / eff | 100 kA; IE2 4.7%; IP20 UL open-type | ✅ …150 |
| Display at capture | `F 30.0` (30.0 Hz) | ✅ …151/…152 |
| Keypad | RUN, STOP/RESET, MENU, ENTER, ▲, ◄/▼, speed pot | ✅ …151 |
| Warning | wait 10 min after power-off; do NOT feed AC into U/T1,V/T2,W/T3 | ✅ …151 |

> **KEY FINDING (drive/motor sizing mismatch):** the GS11N-20P2 is a **0.25 HP** drive whose max output is
> **1.8 A (VT) / 1.6 A (CT)** — but the motor is **1 HP, FLA 3.8 A** (…153). The drive is **undersized** for
> the motor. Effective current ceiling = the DRIVE's ~1.8 A, not the motor's 3.8 A FLA. ⇒ the A8 overcurrent
> reference should be ~**1.8 A** (drive limit), NOT 3.8 A, and definitely not the `config.yaml` 5.0 placeholder.
> Runs on the bench only because it's unloaded (30 Hz idle).
>
> **Supply RESOLVED:** GS10 input is **1-phase 200-240 V** ⇒ the feed is single-phase 230 V (not 3-phase).
> Corroborates the ~320 V DC-bus baseline (230 x √2 ≈ 325 V). Physical R/S/T landing + any contactor still
> not directly photographed (power terminals covered by the caution label).

### Motor — 3-phase induction  (photo …153 nameplate)
| Field | Value | Src |
|---|---|---|
| Description | THREE PHASE INDUCTION MOTOR (CSA C/US) | ✅ …153 |
| Model / Serial | `108074` / `U340156C25040052` | ✅ …153 |
| Type | SHDC | ✅ …153 |
| **HP** | **1 HP** | ✅ …153 |
| **Voltage** | **230/460 V** (dual, 3-phase) | ✅ …153 |
| **FLA** | **3.8 A @ 230 V / 1.9 A @ 460 V** | ✅ …153 |
| **RPM** | **1725** (4-pole, 60 Hz) | ✅ …153 |
| Frame / Enc | 56C / TEFC | ✅ …153 |
| Ins class / SF | F / 1.15 | ✅ …153 |
| Duty / Rot / Code | CONT / CW-CCW / L | ✅ …153 |
| Made | China | ✅ …153 |

> **KEY FINDING:** the approved model's `config.yaml motor_fla_a: 5.0` is a placeholder. **Real FLA = 3.8 A @ 230 V.**
> If the GS10 drives this motor at 230 V, the A8 overcurrent threshold should be ~3.8 A, not 5.0.

---

## Operator station — "PMC STATION"  (photo …142)

Hand-labeled control panel. Two rows:

**Pilot lights (top, L→R):** amber · white/clear · **green (illuminated at capture)** · blue · red. ✅
Function of each lamp = **UNKNOWN** (not labeled). ❓

**Controls (bottom, L→R):**
| Device | Type | Wired to | Src |
|---|---|---|---|
| Green **START** pushbutton | NO contact | PLC input **DI:4** (= I-04) | ✅ …142 label "NO / DI:4 / START" |
| Black **selector** (3-pos) | FWD-OFF-REV | **FWD → DI:0 (I-00)**, center OFF, **REV → DI:1 (I-01)** | ✅ …142 label "FWD DI:0 / OFF / REV DI:1" |
| Red **E-STOP** mushroom | dual-channel | contact terminals 1-2 / 3-4 (cross-wired); PLC inputs **not label-confirmed** | ✅ …142 label "ESTOP" + terminals 1-4 |

---

## PLC terminal wiring

### RS-485 serial port  (photo …145 close-up; also …144)
Label: `D+ · D- · G · Rx · Tx · G`
| Terminal | Wire | Note | Src |
|---|---|---|---|
| D+ | blue | RS-485 A | ✅ …145 |
| D- | white | RS-485 B | ✅ …145 |
| G (3rd term) | green | signal ground | ✅ …145 |
| Rx, Tx, G(6th) | — | empty | ✅ …145 |

→ 2-wire RS-485 (Modbus RTU) to the GS10. Confirms the context model's "GS10 mirrored into Micro820 HRs."

### Embedded INPUT block  (photo …146)
Label: `Vref/10 · -DC24 · I-00 · I-01 · I-02 · I-03 · COM0 · I-04 · I-05 · I-06`
| Terminal | Wired? | Wire | Function (from panel labels) | Src |
|---|---|---|---|---|
| Vref/10 | yes | tan | analog ref | ✅ …146 |
| -DC24 | yes | white | input common / 24 V | ✅ …146 |
| I-00 | yes | blue | **FWD** (selector) | ✅ …146 + …142 |
| I-01 | yes | blue | **REV** (selector) | ✅ …146 + …142 |
| I-02 | yes | blue | function not label-confirmed — ⚠️ likely E-stop ch.1 | ✅ wired …146 |
| I-03 | yes | blue | function not label-confirmed — ⚠️ likely E-stop ch.2 | ✅ wired …146 |
| COM0 | yes | gray | input group common | ✅ …146 |
| I-04 | yes | blue | **START** (NO PB) | ✅ …146 + …142 |
| I-05 | yes | blue/green | function not label-confirmed — ⚠️ likely photo-eye | ✅ wired …146 |
| I-06 | no | — | spare | ✅ …146 |

### Embedded OUTPUT block  (photo …147)
Label: `+DC24 · -DC24 · -DC24 · VO-0 · NU · +CM0 · O-00 · O-01 · O-02 · O-03 · -CM0 · +CM1 · O-04 · O-05 · O-06 · -CM1`
| Terminal | Wired? | Wire | Load (destination) | Src |
|---|---|---|---|---|
| +DC24 / -DC24 | yes | blue / black | 24 V supply in | ✅ …147 |
| VO-0 | ⚠️ | — | analog voltage out (to GS10 AVI? UNKNOWN) | ❓ |
| +CM0 | yes | blue | output group-0 common | ✅ …147 |
| O-00 | yes | black | load UNKNOWN (⚠️ likely a pilot lamp or run cmd) | ✅ wired …147 |
| O-01 | yes | blue | load UNKNOWN | ✅ wired …147 |
| O-02 | yes | black | load UNKNOWN | ✅ wired …147 |
| O-03 | yes | blue | load UNKNOWN | ✅ wired …147 |
| -CM0 | — | — | | ✅ …147 |
| +CM1 | yes | blue/white | output group-1 common | ✅ …147 |
| O-04 | yes | — | load UNKNOWN | ✅ …147 |
| O-05 / O-06 | ❓ | — | UNKNOWN | ❓ |
| -CM1 | yes | blue | | ✅ …147 |

> Output→load mapping (which O-0x drives which lamp / contactor / GS10 input) is **NOT** established by any
> photo yet. Mark all as UNKNOWN in the print. Needs either a labeled shot or the ladder logic.

## GS10 control terminals  (photo …152, cover open)
Digital-input row (silkscreen `MI1..MI5 / D+24V / DCM`): `FWD · REV · DI3 · DI4 · DI5 · +24V · +24V · DCM · DCM` ✅
Analog/output row (silkscreen): `+10V · ACM · AVI(AI) · AFM(AO1) · MO1(DO1) · MCM(DOC) · PE` ✅
- **RS-485:** RJ45 port (right side) with a **purple cable** plugged in → back to the Micro820 D+/D-/G. ✅ …152
- Which GS10 control terminals are wired = **hard to read** (drive is commanded over RS-485/Modbus, so hardwired FWD/REV may be unused — consistent with repo P00.20=5 "RS-485 command source"). ⚠️
- **GS10 power terminals R/S/T (in) + U/V/W (out): covered by the caution label — UNKNOWN.** ❓

---

## Still needed (pending photos) to finish the power side of the print
- ❓ **GS10 nameplate** (exact model, kW/HP, input & output current, input phase/voltage)
- ❓ **GS10 power terminals** R/S/T (in) and U/V/W (out) — wire colors + gauge
- ❓ **Contactor** + the **3-phase / single-phase supply** feeding the GS10
- ❓ Confirm E-stop → which PLC inputs (I-02/I-03?) and photo-eye → I-05
- ❓ Clean shot of the 2nd Micro820 MAC label (…E4:D7) to resolve the one-vs-two-PLC question

---

## Cross-reference to the approved repo context (`plc/conv_simple_anomaly/context_model.cv101.json`)
| Repo claim | Photo evidence | Verdict |
|---|---|---|
| PLC Micro820 2080-LC20-20QBB @ 192.168.1.100:502 | …142/…144 | ✅ confirmed |
| PLC CIP rev "14.11" | nameplate FW **12.011** | ⚠️ mismatch — likely field-updated firmware |
| Drive = GS10 DURApulse | …151/…152 | ✅ confirmed |
| GS10 telemetry over RS-485 → Micro820 HRs | …145 (PLC D+/D-/G) + …152 (GS10 RJ45) | ✅ confirmed link exists |
| `motor_fla_a: 5.0` (config placeholder) | nameplate **FLA 3.8 A @230V** | ❌ placeholder wrong — use 3.8 A |
