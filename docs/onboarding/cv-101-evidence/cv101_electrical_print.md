# CV-101 Garage Conveyor — Maintenance Electrical Print (DRAFT)

**Status:** DRAFT — power side pending photos.
**Built from:** `docs/onboarding/cv-101-evidence/wiring_evidence.md` (the ONLY source for actual
wiring, terminals, and wire colors).
**Photo evidence dated:** 2026-07-02 (Mike's garage bench).
**Standard terminal semantics only** (NOT actual connections) cross-referenced from
`plc/GS10_Integration_Guide.md`, `plc/vars_ConvSimple_v1.9.csv`, `plc/Modbus_ConvSimple_v1.9.ccwmod`.

> HARD RULE applied throughout: nothing here is invented. Anything a photo did not show is marked
> **UNKNOWN**. Do not fill UNKNOWN fields from a "typical" design. The power side (contactor, AC
> supply, GS10 R/S/T + U/V/W) is **not yet photographed** and is marked UNKNOWN on purpose.

---

## 1. System One-Line (Power Flow)

Cite: `wiring_evidence.md` § "Device schedule", § "GS10 control terminals", § "Still needed".

```
   AC SUPPLY                CONTACTOR              GS10 VFD                MOTOR
  (UNKNOWN:               (UNKNOWN:             DURApulse GS10          1 HP, 3-phase
   phase / voltage         not yet              (exact model            230/460 V
   / source)               photographed)         UNKNOWN)               FLA 3.8 A @230V
      |                        |                     |                    / 1.9 A @460V
      |     ????               |     ????            |     ????           1725 rpm
      +----[UNKNOWN]---------->+----[UNKNOWN]------->+---[UNKNOWN]------->[ M ]
       R/S/T feed?            drop-out on          R/S/T in (covered     U/V/W out
                             E-stop? UNKNOWN        by caution label)    (covered - UNKNOWN)

  Legend: [UNKNOWN] = segment not established by any photo.
          ????      = wire colors / gauge / rating not shown.

  KNOWN so far: only the MOTOR nameplate (right end) and the GS10 family (center) are
  photo-confirmed. Everything left of the VFD output — and the VFD power terminals
  themselves — is UNKNOWN pending the power-side photos.
```

**Control/telemetry link (separate from power):** Micro820 PLC <--RS-485 Modbus RTU--> GS10 RJ45.
This link IS photo-confirmed (see § 4, § 5). The GS10 is commanded/monitored over Modbus; hardwired
FWD/REV on the drive may be unused (⚠️ not readable — `wiring_evidence.md` § GS10 control terminals).

---

## 2. Device Schedule

Cite: `wiring_evidence.md` § "Device schedule (nameplates)".

| Ref | Device | Catalog / Model | Key ratings | Network / ID | Status |
|---|---|---|---|---|---|
| PLC | Allen-Bradley Micro820 | `2080-LC20-20QBB` SER C | 24 VDC Class 2, 8.5 W; In 24VDC/24VAC; Out analog 0-10VDC + digital 1A | EtherNet/IP, IP `192.168.1.100`; MAC `5C:88:16:D9:75:DC` (nameplate) | ✅ |
| PLC | (firmware) | FW **12.011** (nameplate) | — | repo CIP read reported rev 14.11 — ⚠️ mismatch, likely field-updated | ⚠️ |
| PLC | (front label MAC) | — | — | MAC `5C:88:16:D?:E4:D7` — differs from nameplate; possible 2nd unit or misread | ⚠️ |
| PLC | (identity) | SN 28556-1379 / PN-509420; Made Singapore 2023-03-18 | — | — | ✅ |
| VFD | AutomationDirect DURApulse GS10 | **UNKNOWN — nameplate not yet photographed** | kW / input-output A rating **UNKNOWN** | RS-485 Modbus RTU (RJ45) | ❓ |
| VFD | (display at capture) | — | `F 30.0` (30.0 Hz) | — | ✅ |
| MOTOR | 3-phase induction (CSA C/US) | Model `108074` / SN `U340156C25040052`; Type SHDC | **1 HP; 230/460 V; FLA 3.8 A @230V / 1.9 A @460V; 1725 rpm**; Frame 56C / TEFC; Ins F / SF 1.15; CONT / CW-CCW / Code L | — | ✅ |

> **KEY FINDING (carried from evidence):** approved model `config.yaml motor_fla_a: 5.0` is a
> placeholder. **Real FLA = 3.8 A @ 230 V.** If GS10 drives this motor at 230 V, the A8 overcurrent
> threshold should be ~3.8 A, not 5.0.

---

## 3. Control Schematic (Operator Station -> Micro820 -> Loads)

Cite: `wiring_evidence.md` § "Operator station", § "Embedded INPUT block", § "Embedded OUTPUT
block", § "RS-485 serial port", § "GS10 control terminals".

```
  PMC STATION (operator panel)                 MICRO820  2080-LC20-20QBB
  ----------------------------                 -----------------------------
  Green START PB (NO) ----------------------->  I-04  (DI:4)   START      [confirmed]
  Selector FWD -------------------------------> I-00  (DI:0)   FWD        [confirmed]
  Selector REV -------------------------------> I-01  (DI:1)   REV        [confirmed]
  Selector center = OFF (no wire)
  E-STOP mushroom (dual-channel) ------------>  I-02 ? / I-03 ?           [NOT label-confirmed]
     contacts 1-2 / 3-4 (cross-wired)             (evidence: I-02/I-03 wired, function inferred)
  Photo-eye (?) ------------------------------> I-05 ?                    [NOT label-confirmed]

  Pilot lights (top row L->R): amber, white/clear, GREEN(lit@capture), blue, red
     -> lamp functions UNKNOWN (panel not labeled)

  MICRO820 OUTPUTS                              LOADS
  ---------------                              -----
  O-00  (wired, black) -----------------------> load UNKNOWN (likely lamp or run cmd - not confirmed)
  O-01  (wired, blue)  -----------------------> load UNKNOWN
  O-02  (wired, black) -----------------------> load UNKNOWN
  O-03  (wired, blue)  -----------------------> load UNKNOWN
  O-04  (wired)        -----------------------> load UNKNOWN
  O-05, O-06          -----------------------> UNKNOWN (wiring not shown)
  VO-0  (analog out)  ----?-------------------> to GS10 AVI? UNKNOWN

     NOTE: which O-0x drives which lamp / contactor / GS10 input is NOT established by
     any photo. All output loads are UNKNOWN. Needs a labeled shot or the ladder logic.

  MODBUS RS-485 LINK (control + telemetry, NOT power)
  ---------------------------------------------------
  Micro820  D+ (blue)  <--------------------->  GS10 RJ45  (purple cable)
  Micro820  D- (white) <--------------------->  GS10 RJ45
  Micro820  G  (green) <--------------------->  GS10 RJ45
     2-wire RS-485 Modbus RTU. GS10 mirrored into Micro820 holding registers.
```

---

## 4. Terminal Connection Tables

Columns: `Terminal | Wire color | Connects to | Status`.
Status: ✅ read directly off photo · ⚠️ partial/inferred · ❓ not shown.

### 4.1 PLC — Embedded INPUT block
Cite: `wiring_evidence.md` § "Embedded INPUT block (photo …146)" + § "Operator station (…142)".
Silkscreen label: `Vref/10 · -DC24 · I-00 · I-01 · I-02 · I-03 · COM0 · I-04 · I-05 · I-06`

| Terminal | Wire color | Connects to | Status |
|---|---|---|---|
| Vref/10 | tan | analog ref | ✅ |
| -DC24 | white | input common / 24 V | ✅ |
| I-00 | blue | selector **FWD** | ✅ |
| I-01 | blue | selector **REV** | ✅ |
| I-02 | blue | function not label-confirmed — likely E-stop ch.1 | ⚠️ |
| I-03 | blue | function not label-confirmed — likely E-stop ch.2 | ⚠️ |
| COM0 | gray | input group common | ✅ |
| I-04 | blue | **START** (NO PB) | ✅ |
| I-05 | blue/green | function not label-confirmed — likely photo-eye | ⚠️ |
| I-06 | — | spare (not wired) | ✅ |

### 4.2 PLC — Embedded OUTPUT block
Cite: `wiring_evidence.md` § "Embedded OUTPUT block (photo …147)".
Silkscreen label: `+DC24 · -DC24 · -DC24 · VO-0 · NU · +CM0 · O-00 · O-01 · O-02 · O-03 · -CM0 · +CM1 · O-04 · O-05 · O-06 · -CM1`

| Terminal | Wire color | Connects to | Status |
|---|---|---|---|
| +DC24 | blue | 24 V supply in | ✅ |
| -DC24 | black | 24 V supply in | ✅ |
| VO-0 | — | analog voltage out — to GS10 AVI? UNKNOWN | ❓ |
| +CM0 | blue | output group-0 common | ✅ |
| O-00 | black | load UNKNOWN (likely pilot lamp or run cmd) | ⚠️ |
| O-01 | blue | load UNKNOWN | ⚠️ |
| O-02 | black | load UNKNOWN | ⚠️ |
| O-03 | blue | load UNKNOWN | ⚠️ |
| -CM0 | — | (group-0 return) | ✅ |
| +CM1 | blue/white | output group-1 common | ✅ |
| O-04 | — | load UNKNOWN | ⚠️ |
| O-05 | — | UNKNOWN | ❓ |
| O-06 | — | UNKNOWN | ❓ |
| -CM1 | blue | (group-1 return) | ✅ |

> All O-0x → load destinations are UNKNOWN — no photo maps outputs to loads.

### 4.3 PLC — RS-485 serial port
Cite: `wiring_evidence.md` § "RS-485 serial port (photo …145; also …144)".
Silkscreen label: `D+ · D- · G · Rx · Tx · G`

| Terminal | Wire color | Connects to | Status |
|---|---|---|---|
| D+ | blue | GS10 RJ45 (RS-485 A) | ✅ |
| D- | white | GS10 RJ45 (RS-485 B) | ✅ |
| G (3rd) | green | GS10 RJ45 (signal ground) | ✅ |
| Rx | — | empty | ✅ |
| Tx | — | empty | ✅ |
| G (6th) | — | empty | ✅ |

> 2-wire RS-485 (Modbus RTU) to the GS10. Standard-semantics note (from `GS10_Integration_Guide.md`
> § 3, NOT a photo): D+ → RJ45 pin 5 SG+, D- → pin 4 SG-, G → pin 3 SGND. Actual GS10-side pin
> landing is NOT photo-confirmed — the cable is a purple patch into the RJ45 jack (§ 4.4).

### 4.4 GS10 — Control terminals
Cite: `wiring_evidence.md` § "GS10 control terminals (photo …152, cover open)".
Digital-input silkscreen row: `FWD · REV · DI3 · DI4 · DI5 · +24V · +24V · DCM · DCM`
Analog/output silkscreen row: `+10V · ACM · AVI(AI) · AFM(AO1) · MO1(DO1) · MCM(DOC) · PE`

| Terminal | Wire color | Connects to | Status |
|---|---|---|---|
| RJ45 (RS-485) | purple cable | back to Micro820 D+/D-/G | ✅ |
| FWD / REV / DI3 / DI4 / DI5 | — | hardwired DI usage hard to read; likely unused (drive commanded over RS-485, repo P00.20=5) | ⚠️ |
| +24V / DCM / +10V / ACM / AVI / AFM / MO1 / MCM / PE | — | not readable from photo | ❓ |

### 4.5 GS10 — Power terminals
Cite: `wiring_evidence.md` § "GS10 control terminals" (caution-label note) + § "Still needed".

| Terminal | Wire color | Connects to | Status |
|---|---|---|---|
| R / S / T (input) | UNKNOWN | AC supply / contactor — covered by caution label | ❓ |
| U/T1 / V/T2 / W/T3 (output) | UNKNOWN | motor — covered by caution label | ❓ |

> GS10 power terminals are **covered by the caution label — UNKNOWN**. Warning on cover: wait 10 min
> after power-off; do NOT feed AC into U/T1, V/T2, W/T3.

### 4.6 Operator station — "PMC STATION"
Cite: `wiring_evidence.md` § "Operator station — 'PMC STATION' (photo …142)".

| Terminal / Device | Wire color | Connects to | Status |
|---|---|---|---|
| Green **START** PB (NO) | — | PLC **DI:4** (I-04) | ✅ |
| Black **selector** FWD (3-pos) | — | PLC **DI:0** (I-00) | ✅ |
| Black **selector** center | — | OFF (no connection) | ✅ |
| Black **selector** REV | — | PLC **DI:1** (I-01) | ✅ |
| Red **E-STOP** mushroom (dual-channel) | — | contact terminals 1-2 / 3-4 (cross-wired); PLC inputs NOT label-confirmed (likely I-02/I-03) | ⚠️ |
| Pilot lamps: amber, white/clear, green (lit@capture), blue, red | — | lamp functions UNKNOWN (not labeled) | ❓ |

---

## 5. Open Items / Pending Photos

Cite: `wiring_evidence.md` § "Still needed (pending photos) to finish the power side of the print".

- ❓ **GS10 nameplate** — exact model, kW/HP, input & output current, input phase/voltage.
- ❓ **GS10 power terminals** R/S/T (in) and U/V/W (out) — wire colors + gauge.
- ❓ **Contactor** + the **3-phase / single-phase supply** feeding the GS10.
- ❓ Confirm **E-stop → which PLC inputs** (I-02/I-03?) and **photo-eye → I-05**.
- ❓ Clean shot of the **2nd Micro820 MAC label** (…E4:D7) to resolve the one-vs-two-PLC question.

### Ambiguities flagged in evidence (do not resolve without a photo)
- PLC firmware: nameplate **FW 12.011** vs repo CIP read **rev 14.11** — ⚠️ mismatch, likely field-updated.
- Two different MACs (nameplate `…D9:75:DC` vs front label `…D?:E4:D7`) — ⚠️ one-vs-two-PLC question open.
- I-02, I-03, I-05 functions and all O-0x → load destinations — ⚠️/❓ inferred or unshown.
- VO-0 → GS10 AVI — ❓ not established.

---

*End of DRAFT. Regenerate the power side (§1 left half, §4.5, most of §4.4) once the pending photos land.*
