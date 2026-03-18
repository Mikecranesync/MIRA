# FactoryLM Master Wiring Guide
## Micro820 + GS10 VFD + Conveyor Motor + Operator Station — Complete End-to-End

> **Consolidates:** 9 previous gists into one authoritative reference
> **PLC:** Allen-Bradley Micro820 2080-LC20-20QBB (12 inputs I-00–I-11 / 7 outputs O-00–O-06 / RS-485 / Ethernet)
> **VFD:** AutomationDirect GS10 DURApulse (RS-485 Modbus RTU slave)
> **Motor:** 3-phase conveyor motor (400V, 10A)
> **Operator Station:** E-stop, 3-pos selector (FWD/OFF/REV), RUN pushbutton, green + red pilot lights
> **Author:** Mike Crane | FactoryLM

---

## Safety First

- **LOTO** the main breaker before touching any power wiring
- Verify zero energy with a meter on BOTH sides of the disconnect
- RS-485 wiring can be done hot but power wiring CANNOT
- Wear appropriate PPE: safety glasses, insulated gloves for >50V
- If you see arc flash labels, follow the rated PPE category

---

## 1. System Overview

```
                    ┌─────────────────────────────┐
                    │     400V 3-Phase Supply      │
                    │         L1  L2  L3           │
                    └──────┬───┬───┬───────────────┘
                           │   │   │
                    ┌──────┴───┴───┴──────┐
                    │    Main Breaker      │
                    │    (size per motor)  │
                    └──────┬───┬───┬──────┘
                           │   │   │
                    ┌──────┴───┴───┴──────┐
                    │  Safety Contactor Q1 │
                    │  (PLC O-02 coil)   │
                    │  DROPS OUT on E-stop │
                    └──────┬───┬───┬──────┘
                           │   │   │
              ┌────────────┴───┴───┴────────────┐
              │         GS10 VFD                │
              │       DURApulse Drive           │
              │                                 │
              │  INPUT:  R/L1  S/L2  T/L3       │
              │  OUTPUT: U/T1  V/T2  W/T3       │
              │                                 │
              │  RS-485: RJ45 port              │
              │    Pin 3 = S+ (RS-485 A)        │
              │    Pin 4 = S- (RS-485 B)        │
              │    Pin 5 = SG (signal ground)   │
              └──┬───┬───┬──────────┬───────────┘
                 │   │   │          │
                 U   V   W      RS-485 cable
                 │   │   │          │
              ┌──┴───┴───┴──┐   ┌──┴──────────────────┐
              │   MOTOR     │   │  Micro820 PLC        │
              │  Conveyor   │   │  192.168.1.100       │
              │  400V 10A   │   │                      │
              └─────────────┘   │  Serial: 6-pin TB    │
                                │   Pin 1 = TXD+ (A)   │
                                │   Pin 2 = TXD- (B)   │
                                │   Pin 5 = COM (GND)   │
                                │                      │
                                │  Ethernet → Switch   │
                                │   → Mac Mini (MIRA)  │
                                └──────────────────────┘
```

---

## 2. Power Wiring (DO THIS FIRST — LOTO REQUIRED)

### 2.1 Incoming Power → Safety Contactor → VFD

| From | To | Wire | Notes |
|------|----|------|-------|
| Breaker L1 | Contactor Q1 line T1 | #10 AWG | 3-phase input |
| Breaker L2 | Contactor Q1 line T2 | #10 AWG | 3-phase input |
| Breaker L3 | Contactor Q1 line T3 | #10 AWG | 3-phase input |
| Contactor Q1 load T1 | GS10 terminal R/L1 | #10 AWG | Contactor feeds VFD |
| Contactor Q1 load T2 | GS10 terminal S/L2 | #10 AWG | Contactor feeds VFD |
| Contactor Q1 load T3 | GS10 terminal T/L3 | #10 AWG | Contactor feeds VFD |
| Breaker GND | GS10 ground lug | #10 AWG green | Equipment ground |

**Safety contactor Q1** sits between the breaker and VFD. When E-stop is pressed, PLC de-energizes O-02, Q1 drops out, VFD loses power. See Section 2.3 for contactor coil wiring.

### 2.2 VFD → Motor

| From | To | Wire | Notes |
|------|----|------|-------|
| GS10 terminal U/T1 | Motor T1 | #10 AWG | Use VFD-rated cable if run >50ft |
| GS10 terminal V/T2 | Motor T2 | #10 AWG | Keep away from signal wiring |
| GS10 terminal W/T3 | Motor T3 | #10 AWG | Route in separate conduit from RS-485 |
| GS10 ground lug | Motor frame ground | #10 AWG green | Bond motor frame to VFD ground |

### 2.3 Controls Architecture (How It All Works Together)

The conveyor has **two independent control paths**:

1. **Safety contactor Q1** (hardwired via PLC O-02) — physically connects/disconnects 3-phase power to the VFD. This is the SAFETY layer. When E-stop is pressed, the PLC de-energizes Q1 and the VFD loses power immediately. This is NOT a software stop — it is a physical disconnect.

2. **VFD Modbus commands** (software via RS-485) — the PLC sends start/stop/direction/speed commands to the GS10 VFD over Modbus RTU. This is the OPERATIONAL layer. Normal start/stop uses Modbus. The selector switch and RUN button control what Modbus commands the PLC sends.

```
┌───────────────────────────────────────────────────────────┐
│                   CONTROLS ARCHITECTURE                   │
│                                                           │
│  OPERATOR STATION              PLC (Micro820)             │
│  ┌─────────────┐              ┌──────────────────┐        │
│  │ [E-STOP] ───┼── I-02/03 ─→│ EStop_OK logic   │        │
│  │             │              │       │          │        │
│  │ [FWD|OFF|REV]── I-00/01 ─→│ Direction logic  │        │
│  │             │              │       │          │        │
│  │ [RUN PB] ──┼── I-04 ────→│ Run command      │        │
│  │             │              │       │          │        │
│  │ (GREEN ●) ←┼── O-00 ←───│ RunCommand       │        │
│  │ (RED ●)   ←┼── O-01 ←───│ Fault detected   │        │
│  │ (RUN LED) ←┼── O-03 ←───│ RunCommand       │        │
│  └─────────────┘              │       │          │        │
│                               │  O-02 ──→ Q1 contactor  │
│                               │       │   (safety power)  │
│                               │  RS-485 ──→ GS10 VFD     │
│                               │       │   (Modbus cmds)   │
│                               └───────┼──────────┘        │
│                                       │                   │
│  POWER PATH:                          │                   │
│  Breaker → Q1 contactor → VFD → Motor │                   │
│           (O-02 enables)  (Modbus     │                   │
│                             controls)  │                   │
└───────────────────────────────────────────────────────────┘
```

#### Safety Contactor Wiring (Q1 on O-02)

| From | To | Wire | Notes |
|------|----|------|-------|
| PLC O-02 | Contactor Q1 coil A1 | #16 AWG | PLC energizes contactor when E-stop OK |
| Contactor Q1 coil A2 | PLC -CM0 (24VDC -) | #16 AWG | Return path |
| Breaker L1 | Contactor Q1 line T1 | #10 AWG | 3-phase input (load side) |
| Breaker L2 | Contactor Q1 line T2 | #10 AWG | 3-phase input |
| Breaker L3 | Contactor Q1 line T3 | #10 AWG | 3-phase input |
| Contactor Q1 load T1 | GS10 terminal R/L1 | #10 AWG | Contactor feeds VFD |
| Contactor Q1 load T2 | GS10 terminal S/L2 | #10 AWG | |
| Contactor Q1 load T3 | GS10 terminal T/L3 | #10 AWG | |

**Updated power path:** Breaker → **Contactor Q1** → GS10 VFD → Motor

When E-stop is OK, the PLC energizes O-02, Q1 pulls in, and the VFD has power. When E-stop is pressed, O-02 de-energizes, Q1 drops out, and the VFD loses power instantly — regardless of Modbus.

#### What Controls What

| Function | Method | Signal | Notes |
|----------|--------|--------|-------|
| **Emergency stop** | Hardwired | O-02 → Q1 contactor | Cuts 3-phase power to VFD |
| **Motor start** | Modbus RTU | Write 0x0001 to reg 0x2100 | Forward run command |
| **Motor stop** | Modbus RTU | Write 0x0005 to reg 0x2100 | Controlled decel stop |
| **Motor reverse** | Modbus RTU | Write 0x0002 to reg 0x2100 | Reverse run command |
| **Speed setpoint** | Modbus RTU | Write value to reg 0x2101 | 0-400 = 0.0-40.0 Hz |
| **Read speed** | Modbus RTU | Read reg 0x2103 | Output frequency ÷10 |
| **Read current** | Modbus RTU | Read reg 0x2104 | Output amps ÷10 |
| **Read faults** | Modbus RTU | Read reg 0x210F | Fault code (0=none) |
| **Green light** | PLC output | O-00 | ON when RunCommand=TRUE |
| **Red light** | PLC output | O-01 | ON when fault or E-stop |
| **RUN button LED** | PLC output | O-03 | ON when RunCommand=TRUE (button illumination) |

### 2.4 Operator Station Wiring

The operator station gives the technician local control of the conveyor.

#### Operator Station Layout

```
┌─────────────────────────────────────────┐
│          OPERATOR STATION               │
│                                         │
│      ┌──────────┐                       │
│      │ [E-STOP] │  Red mushroom head    │
│      │  twist   │  NC + NO contacts     │
│      │  reset   │                       │
│      └──────────┘                       │
│                                         │
│   (GREEN ●)          (RED ●)            │
│   Running light      Fault light        │
│   22mm pilot         22mm pilot         │
│                                         │
│   ┌──────────────────────┐              │
│   │ FWD │ OFF │ REV      │ 3-pos        │
│   │  ←  │  ●  │  →       │ selector     │
│   └──────────────────────┘              │
│                                         │
│      ┌──────────┐                       │
│      │  [RUN]   │  Green illuminated    │
│      │  ●  NO   │  momentary pushbutton │
│      │ Sweideer │  (LED + NO contact)   │
│      └──────────┘                       │
│                                         │
└─────────────────────────────────────────┘
```

#### I/O Assignment Table

**Digital Inputs (24VDC sink — all share COM0):**

| PLC Terminal | CCW Tag | Device | Contact Type | Wire Color | Function |
|-------------|---------|--------|-------------|------------|----------|
| I-00 | SelectorFWD | 3-pos selector | NO (closed in FWD) | White | Forward selected |
| I-01 | SelectorREV | 3-pos selector | NO (closed in REV) | Blue | Reverse selected |
| I-02 | EStopNC | E-stop | NC (opens when pressed) | Red | E-stop healthy = 1 |
| I-03 | EStopNO | E-stop | NO (closes when pressed) | Yellow | E-stop pressed = 1 |
| I-04 | PBRun | Illuminated pushbutton | NO momentary | Green | Rising edge = run |
| I-05 | — | (spare) | — | — | Available |
| I-06 | — | (spare) | — | — | Available |
| I-07 | — | (spare) | — | — | Available |
| I-08 | — | (spare) | — | — | Available |
| I-09 | — | (spare) | — | — | Available |
| I-10 | — | (spare) | — | — | Available |
| I-11 | — | (spare) | — | — | Available |

**Digital Outputs (24VDC transistor sourcing):**

| PLC Terminal | CCW Tag | Device | Function | Common Group |
|-------------|---------|--------|----------|-------------|
| O-00 | LightGreen | Green pilot light (22mm) | ON = motor running | +CM0 / -CM0 |
| O-01 | LightRed | Red pilot light (22mm) | ON = fault or E-stop | +CM0 / -CM0 |
| O-02 | ContactorQ1 | Safety contactor Q1 coil | ON = E-stop OK, power to VFD | +CM0 / -CM0 |
| O-03 | PBRunLED | RUN pushbutton LED (Sweideer) | ON = motor running (button illumination) | +CM0 / -CM0 |
| O-04 | — | (spare) | Available | +CM1 / -CM1 |
| O-05 | — | (spare) | Available | +CM1 / -CM1 |
| O-06 | — | (spare) | Available | +CM1 / -CM1 |

#### E-Stop Wiring (Dual-Channel Supervision)

```
24VDC (+) ──┬──────────────────────────────────────┐
            │                                       │
            │    ┌──────────────────┐               │
            ├────┤ E-STOP NC contact├──── I-02     │
            │    │ (opens on press) │  Red wire     │
            │    └──────────────────┘               │
            │                                       │
            │    ┌──────────────────┐               │
            └────┤ E-STOP NO contact├──── I-03     │
                 │ (closes on press)│  Yellow wire  │
                 └──────────────────┘               │
                                                    │
         COM0 ─────────────────────────────────┘
```

**Supervision truth table:**

| I-02 (NC) | I-03 (NO) | State | Action |
|-----------|-----------|-------|--------|
| 1 | 0 | E-stop OK (released) | Normal operation allowed |
| 0 | 1 | E-stop ACTIVE (pressed) | Immediate stop, red light ON |
| 0 | 0 | WIRING FAULT | Red light ON, lockout |
| 1 | 1 | WIRING FAULT | Red light ON, lockout |

#### 3-Position Selector Switch (FWD / OFF / REV)

```
24VDC (+) ──┬──────────────────────────────────────┐
            │                                       │
            │    ┌──────────────────────┐           │
            ├────┤ FWD contact (NO)     ├──── I-00 │
            │    │ closed when LEFT     │ White wire│
            │    └──────────────────────┘           │
            │                                       │
            │    ┌──────────────────────┐           │
            └────┤ REV contact (NO)     ├──── I-01 │
                 │ closed when RIGHT    │ Blue wire │
                 └──────────────────────┘           │
                                                    │
         COM0 ─────────────────────────────────┘
```

**Selector truth table:**

| Position | I-00 (FWD) | I-01 (REV) | VFD Command |
|----------|------------|------------|-------------|
| OFF (center) | 0 | 0 | 0x0005 (stop) |
| FWD (left) | 1 | 0 | 0x0001 (forward) |
| REV (right) | 0 | 1 | 0x0002 (reverse) |
| INVALID | 1 | 1 | 0x0005 (stop) + fault |

#### RUN Pushbutton

```
24VDC (+) ────┤ RUN PB (NO momentary) ├──── I-04
              │     Green button       │  Green wire
              └────────────────────────┘

         COM0 ─── (shared with all inputs)
```

The RUN button uses **rising-edge detection** in the PLC — press once to start, selector switch to OFF or E-stop to stop. The button does nothing if the selector is in OFF or E-stop is active.

#### Illuminated RUN Pushbutton (Sweideer)

The RUN pushbutton is an **illuminated momentary pushbutton** (Sweideer brand, 250V 50mA LED). It has two separate contact blocks: one NO signal contact and one LED terminal pair. Wiring requires **TWO connections**:

**1. Signal contact (NO momentary) — input to PLC:**

```
24VDC (+) ────┤ RUN PB signal (NO) ├──── I-04
              │  Contact block #1   │  Green wire
              └─────────────────────┘

         COM0 ─── (shared with all inputs)
```

**2. LED illumination terminals — output from PLC:**

```
O-03 ────┤ RUN PB LED (Sweideer)  ├──── -CM0 (24VDC -)
          │  250V 50mA LED         │
          │  Contact block #2      │
          └────────────────────────┘
```

**LED control logic:**
```
O_03 (PBRunLED) := RunCommand;
```

- LED is ON whenever the motor is running, OFF when stopped or faulted
- Gives the operator instant visual confirmation **at the button itself**
- O-03 (PBRunLED) and O-00 (LightGreen) are **separate indicators** — do NOT combine them
- Pressing the button starts the motor AND the button lights up to confirm it is running
- Releasing or stopping turns the button light off

#### Pilot Lights

```
O-00 ────┤ GREEN PILOT LIGHT (22mm) ├──── -CM0 (24VDC -)
          │    ON = motor running     │

O-01 ────┤  RED PILOT LIGHT (22mm)  ├──── -CM0 (24VDC -)
          │    ON = fault/e-stop      │
```

Pilot lights are 24VDC LED type. PLC transistor outputs source 24VDC to the light, return through -CM0. Max 0.5A per output — LED pilot lights draw ~20mA, well within rating.

#### Complete Operator Station Wiring Diagram

```
                    24VDC POWER SUPPLY
                    (+)              (-)
                     │                │
    ┌────────────────┼────────────────┼──────────────────────┐
    │                │                │                      │
    │   ┌────────────┴────────┐      │                      │
    │   │                     │      │                      │
    │   ├─── E-STOP NC ─── I-02    │   O-00 ─── GREEN ●──┤
    │   │                           │                      │
    │   ├─── E-STOP NO ─── I-03    │   O-01 ─── RED ● ──┤
    │   │                           │                      │
    │   ├─── SEL FWD ───── I-00    │   O-03 ─── RUN LED──┤
    │   │                           │                      │
    │   ├─── SEL REV ───── I-01    │                      │
    │   │                           │                      │
    │   └─── RUN PB sig ── I-04    │                      │
    │                               │                      │
    │              COM0 ───────┘   -CM0 ─────────┘
    │
    └── TO PLC 24VDC SUPPLY TERMINALS
```

**Wire count from operator station to PLC: 10 wires**
- 1x 24VDC (+) supply
- 1x COM0 (24VDC -)
- 5x input signals (I-00 through I-04)
- 1x -CM0 (24VDC - return for lights + LED)
- 3x output signals (O-00 green light, O-01 red light, O-03 pushbutton LED)

Use a **12-conductor 18 AWG** control cable or individual #18 AWG THHN wires in conduit (10 active + 2 spare).

#### PLC Control Logic (Ladder Diagrams)

> **Note:** Ladder diagrams below show the operator station I/O logic.
> The full VFD Modbus state machine is in the ST program
> ([Micro820_v3_Program.st](https://gist.github.com/Mikecranesync/ea612e926721bb259eda64dec6da08e4)).
> Legend: `┤ ├` = NO contact, `┤/├` = NC contact, `( )` = coil, `(L)` = latch, `(U)` = unlatch

```
════════════════════════════════════════════════════════════════════════
 RUNG 1 — E-Stop Supervision
 I-02 (NC) must be closed AND I-03 (NO) must be open = healthy
════════════════════════════════════════════════════════════════════════

 ──┤ I-02 ├───┤/I-03 ├─────────────────────────────────( EStop_OK )──
    NC=1       NO=0     Both complementary → E-stop released, OK

 ──┤ I-02 ├───┤ I-03 ├──┬──────────────────────( EStop_WiringFault )──
 ──┤/I-02 ├───┤/I-03 ├──┘  Both same state → WIRING FAULT
    (contacts not complementary → lockout)

════════════════════════════════════════════════════════════════════════
 RUNG 2 — Direction Selection (guarded by E-Stop OK)
 3-position selector: FWD (left) / OFF (center) / REV (right)
════════════════════════════════════════════════════════════════════════

 ──┤ I-00 ├───┤/I-01 ├───┤ EStop_OK ├─────────────────( Dir_FWD )──
    FWD=1      REV=0      E-stop OK

 ──┤/I-00 ├───┤ I-01 ├───┤ EStop_OK ├─────────────────( Dir_REV )──
    FWD=0      REV=1      E-stop OK

 ──┤/I-00 ├───┤/I-01 ├────────────────────────────────( Dir_OFF )──
    FWD=0      REV=0      Selector in center

 ──┤ I-00 ├───┤ I-01 ├────────────────────────────────( Dir_Fault )──
    FWD=1      REV=1      INVALID — both contacts closed

════════════════════════════════════════════════════════════════════════
 RUNG 3 — Run Command (Latch/Unlatch)
 RUN pushbutton (I-04) rising edge starts, selector OFF stops
════════════════════════════════════════════════════════════════════════

             ┌─┤ Dir_FWD ├─┐
 ──┤ I-04 ├──┤             ├──┤ EStop_OK ├────────( L RunCommand )──
    rising   └─┤ Dir_REV ├─┘   E-stop OK    LATCH ON
    edge        direction
                selected

 ──┤ Dir_OFF ├──┬─────────────────────────────( U RunCommand )──
 ──┤ Dir_Fault├─┤                              UNLATCH OFF
 ──┤/EStop_OK├──┘

════════════════════════════════════════════════════════════════════════
 RUNG 4 — Safety Contactor Q1 (hardwired power disconnect)
 O-02 energizes Q1 → 3-phase power flows to VFD
 De-energized → VFD loses power INSTANTLY (not software stop)
════════════════════════════════════════════════════════════════════════

 ──┤/e_stop_active├───┤/EStop_WiringFault├────────────( O-02  Q1 )──
    E-stop released    No wiring fault      Contactor ENERGIZED

════════════════════════════════════════════════════════════════════════
 RUNG 5 — VFD Modbus Commands (state machine)
 See Micro820_v3_Program.st for full CASE logic
════════════════════════════════════════════════════════════════════════

    RunCommand + Dir_FWD  →  Write 0x0001 to reg 0x2100  (forward)
    RunCommand + Dir_REV  →  Write 0x0002 to reg 0x2100  (reverse)
    else                  →  Write 0x0005 to reg 0x2100  (stop)

════════════════════════════════════════════════════════════════════════
 RUNG 6 — Indicator Lights + Pushbutton LED
════════════════════════════════════════════════════════════════════════

 ──┤ motor_running ├──────────────────────────────────( O-00  GRN )──
    Motor is running → GREEN panel pilot light ON

 ──┤ e_stop_active  ├──┬──────────────────────────────( O-01  RED )──
 ──┤ fault_alarm    ├──┤  Any fault condition
 ──┤ Dir_Fault      ├──┤  → RED panel pilot light ON
 ──┤ EStop_WireFlt  ├──┤
 ──┤ VFD_FaultCode>0├──┘

 ──┤ motor_running ├──────────────────────────────────( O-03  LED )──
    Motor is running → RUN pushbutton LED ON (Sweideer illumination)
```

#### Operator Station Wiring Checklist

- [ ] Mount operator station enclosure within reach of conveyor
- [ ] Run 12-conductor control cable from station to PLC panel (10 active + 2 spare)
- [ ] Wire E-stop NC contact → I-02 (red wire)
- [ ] Wire E-stop NO contact → I-03 (yellow wire)
- [ ] Wire selector FWD contact → I-00 (white wire)
- [ ] Wire selector REV contact → I-01 (blue wire)
- [ ] Wire RUN pushbutton signal contact → I-04 (green wire)
- [ ] Wire RUN pushbutton LED (+) → O-03
- [ ] Wire RUN pushbutton LED (-) → -CM0 (24VDC -)
- [ ] Wire 24VDC (+) to common bus in operator station
- [ ] Wire COM0 to 24VDC (-) at PLC
- [ ] Wire O-00 → green pilot light (+) terminal
- [ ] Wire O-01 → red pilot light (+) terminal
- [ ] Wire pilot light (-) terminals → -CM0 at PLC
- [ ] Verify E-stop: press → I-02=0, I-03=1 in CCW monitor
- [ ] Verify E-stop: release → I-02=1, I-03=0
- [ ] Verify selector: FWD → I-00=1, I-01=0
- [ ] Verify selector: OFF → I-00=0, I-01=0
- [ ] Verify selector: REV → I-00=0, I-01=1
- [ ] Verify RUN: press → I-04=1 while held
- [ ] Force O-00 ON in CCW → green light illuminates
- [ ] Force O-01 ON in CCW → red light illuminates
- [ ] Force O-03 ON in CCW → RUN pushbutton LED illuminates
- [ ] Force O-03 OFF → RUN pushbutton LED off
- [ ] Wire contactor Q1 coil A1 → O-02
- [ ] Wire contactor Q1 coil A2 → -CM0 (24VDC -)
- [ ] Force O-02 ON in CCW → contactor Q1 pulls in (audible click)
- [ ] Force O-02 OFF → contactor Q1 drops out

### 2.5 24VDC Control Power Supply

The entire control circuit — PLC, inputs, outputs, operator station — runs on a single 24VDC DIN-rail power supply.

#### Recommended Supply

| Spec | Value |
|------|-------|
| Model | Mean Well MDR-60-24 (or equivalent DIN-rail) |
| Output | 24VDC, 2.5A (60W) |
| Input | 100-240VAC 50/60Hz |
| Mounting | DIN rail, inside PLC panel |
| Protection | Short circuit, overload, over-voltage |

#### 24VDC Distribution Diagram

```
  ┌─────────────────────────────────────────┐
  │     DIN-RAIL 24VDC POWER SUPPLY         │
  │     Mean Well MDR-60-24 (60W, 2.5A)    │
  │                                         │
  │   AC IN: L ← breaker, N, PE → DIN rail │
  │                                         │
  │   DC OUT:                               │
  │     (+) 24VDC ──────────────────────┐   │
  │     (-) 0VDC  ──────────────────┐   │   │
  └─────────────────────────────────┼───┼───┘
                                    │   │
         24VDC (-)                  │   │  24VDC (+)
         ══════════════════════════╪═══╪═══════════════════
         ║                         │   │                  ║
         ║  ┌── PLC POWER ─────────┤   ├────────────┐    ║
         ║  │   -DC24 terminal ←───┘   └──→ +DC24   │    ║
         ║  │   (output strip)          (output strip)│    ║
         ║  │   PLC draws ~250mA                      │    ║
         ║  └─────────────────────────────────────────┘    ║
         ║                         │   │                   ║
         ║  ┌── INPUT CIRCUIT ─────┤   ├────────────┐     ║
         ║  │   COM0 terminal ←────┘   └──→ 24V+ bus│     ║
         ║  │   (input strip)         in operator    │     ║
         ║  │                         station        │     ║
         ║  │   Current path:         │              │     ║
         ║  │   24V+ → device → I-XX → PLC → COM0   │     ║
         ║  │          contact         internal       │     ║
         ║  │                                         │     ║
         ║  │   Devices on bus:                       │     ║
         ║  │     ├── E-stop NC ──→ I-02              │     ║
         ║  │     ├── E-stop NO ──→ I-03              │     ║
         ║  │     ├── Sel FWD ────→ I-00              │     ║
         ║  │     ├── Sel REV ────→ I-01              │     ║
         ║  │     └── RUN PB sig ─→ I-04              │     ║
         ║  └─────────────────────────────────────────┘     ║
         ║                         │   │                    ║
         ║  ┌── OUTPUT GROUP 0 ────┤   ├────────────┐      ║
         ║  │   -CM0 terminal ←────┘   └──→ +CM0    │      ║
         ║  │   (output strip)        (output strip) │      ║
         ║  │                                        │      ║
         ║  │   Current path:                        │      ║
         ║  │   +CM0 → transistor → O-XX → load → -CM0     ║
         ║  │                                        │      ║
         ║  │   Loads on group 0:                    │      ║
         ║  │     O-00 → Green pilot light (20mA)   │      ║
         ║  │     O-01 → Red pilot light (20mA)     │      ║
         ║  │     O-02 → Contactor Q1 coil (100mA)  │      ║
         ║  │     O-03 → RUN pushbutton LED (50mA)  │      ║
         ║  │     All loads return to -CM0           │      ║
         ║  └────────────────────────────────────────┘      ║
         ║                                                  ║
         ║  OUTPUT GROUP 1 (spare — wire when needed):      ║
         ║    24VDC+ → +CM1,  24VDC- → -CM1                ║
         ║    Outputs O-04, O-05, O-06                      ║
         ║                                                  ║
         ═══════════════════════════════════════════════════
```

#### Terminal-by-Terminal Wiring List

**24VDC (+) connects to 3 terminals:**

| # | Terminal | Location | Purpose |
|---|----------|----------|---------|
| 1 | +DC24 | Output strip, leftmost | PLC processor power |
| 2 | +CM0 | Output strip, before O-00 | Output group 0 source |
| 3 | Bus in operator station | Field wiring | Feeds all input devices |

**24VDC (-) connects to 3 terminals:**

| # | Terminal | Location | Purpose |
|---|----------|----------|---------|
| 1 | -DC24 | Output strip, 2nd from left | PLC processor return |
| 2 | -CM0 | Output strip, after O-03 | Output loads return |
| 3 | COM0 | Input strip, between I-03 and I-04 | Input common return |

#### Load Budget

| Load | Current | Notes |
|------|---------|-------|
| PLC processor | 250 mA | Internal logic + I/O |
| 5x DI circuits | 20 mA | ~4mA each, internal pull-down |
| O-00 Green pilot LED | 20 mA | 24VDC LED type |
| O-01 Red pilot LED | 20 mA | 24VDC LED type |
| O-02 Contactor Q1 coil | 100 mA | Typical 24VDC contactor |
| O-03 Pushbutton LED | 50 mA | Sweideer spec (250V 50mA) |
| **TOTAL** | **460 mA** | **18% of 2.5A supply capacity** |

#### 24VDC Wiring Checklist

- [ ] Mount DIN-rail power supply in PLC panel
- [ ] Wire AC input: L from control breaker, N, PE to DIN rail ground
- [ ] Wire 24VDC (+) → +DC24 terminal (output strip)
- [ ] Wire 24VDC (-) → -DC24 terminal (output strip)
- [ ] Wire 24VDC (+) → +CM0 terminal (output strip)
- [ ] Wire 24VDC (-) → -CM0 terminal (output strip)
- [ ] Wire 24VDC (-) → COM0 terminal (input strip)
- [ ] Wire 24VDC (+) → operator station bus (via control cable)
- [ ] Energize AC → verify 24VDC output with multimeter (23.5-24.5V)
- [ ] PLC PWR LED should illuminate solid
- [ ] Measure Vref terminal (input strip) — should read ~24VDC

---

## 3. RS-485 Serial Wiring (Micro820 ↔ GS10 VFD)

This is the critical data link. The PLC talks Modbus RTU to the VFD over RS-485.

### 3.1 Cable Construction

You need a custom cable: **RJ45 plug on the VFD end → bare wire on the PLC end**

**Materials:**
- 1x Cat5e/Cat6 cable (shielded preferred — STP)
- 1x RJ45 connector (or use a pre-made patch cable and cut one end)
- 120Ω termination resistor (only if cable run >30 ft)

### 3.2 Pin Mapping

| Micro820 Terminal Block | Wire | GS10 RJ45 Pin | Signal |
|------------------------|------|---------------|--------|
| Pin 1 (TXD+) | Orange/White or Blue | Pin 3 (S+) | RS-485 A (+) |
| Pin 2 (TXD-) | Orange or Blue/White | Pin 4 (S-) | RS-485 B (-) |
| Pin 5 (COM) | Brown or Green | Pin 5 (SG) | Signal Ground |
| Pin 6 (SHD) | Cable shield drain | RJ45 shell/ground | Shield (optional) |

### 3.3 RJ45 Pinout Detail (T-568B standard)

```
RJ45 plug (looking at contacts, clip down):
 ┌─────────────────────┐
 │ 1 2 3 4 5 6 7 8     │
 └─────────────────────┘
   │ │ │ │ │ │ │ │
   │ │ │ │ │ │ │ └─ not used
   │ │ │ │ │ │ └─── not used
   │ │ │ │ │ └───── SG (signal ground) ──→ Micro820 Pin 5
   │ │ │ │ └─────── S- (RS-485 B) ───────→ Micro820 Pin 2
   │ │ │ └───────── S+ (RS-485 A) ───────→ Micro820 Pin 1
   │ │ └─────────── not used
   │ └───────────── not used
   └─────────────── not used
```

### 3.4 Wiring Checklist

- [ ] Cut Cat5e cable to length (measure PLC panel to VFD panel)
- [ ] Crimp RJ45 on one end (for GS10 port)
- [ ] Strip other end — expose wires for pins 3, 4, 5 only
- [ ] Connect to Micro820 terminal block: Pin 1=S+, Pin 2=S-, Pin 5=SG
- [ ] If cable >30 ft: install 120Ω resistor across S+ and S- at the GS10 end
- [ ] Plug RJ45 into GS10 RS-485 port (NOT the Ethernet port if it has one)
- [ ] Route RS-485 cable AWAY from VFD output power cables (separate conduit)

---

## 4. GS10 VFD Parameter Programming

Do this at the VFD keypad BEFORE attempting Modbus communication.

### 4.1 Communication Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| P09.00 | 1 | Communication protocol = Modbus RTU |
| P09.01 | 1 | Slave address = 1 |
| P09.02 | 3 | Baud rate = 9600 |
| P09.03 | 0 | Data format = 8N2 (8 data, no parity, 2 stop) |
| P09.04 | 0 | Communication response delay = 0ms |

### 4.2 Control Source Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| P00.02 | 3 | Frequency source = RS-485 communication |
| P00.04 | 2 | Run command source = RS-485 communication |

### 4.3 Motor Parameters (set to match your motor nameplate)

| Parameter | Description | Set to |
|-----------|-------------|--------|
| P01.00 | Motor rated power (kW) | [YOUR MOTOR] |
| P01.01 | Motor rated voltage | [YOUR MOTOR] |
| P01.02 | Motor rated current (A) | [YOUR MOTOR] |
| P01.03 | Motor rated frequency (Hz) | 60 (US) |
| P01.04 | Motor rated RPM | [YOUR MOTOR] |

### 4.4 Programming Checklist

- [ ] Power up GS10 (no motor connected yet is fine)
- [ ] Navigate to P09.00, set to 1 (Modbus RTU)
- [ ] Set P09.01 = 1 (slave address)
- [ ] Set P09.02 = 3 (9600 baud)
- [ ] Set P09.03 = 0 (8N2)
- [ ] Set P00.02 = 3 (frequency from RS-485)
- [ ] Set P00.04 = 2 (run command from RS-485)
- [ ] Set motor nameplate values in P01.xx
- [ ] Power cycle the VFD after parameter changes

---

## 5. Micro820 CCW Configuration

### 5.1 Serial Port Settings (in CCW)

| Setting | Value |
|---------|-------|
| Protocol | Modbus RTU Master |
| Baud Rate | 9600 |
| Data Bits | 8 |
| Parity | None |
| Stop Bits | 2 |
| Slave Address | N/A (PLC is master) |

### 5.2 Modbus Register Map (GS10)

**Read Registers (Function Code 03):**

| Register (hex) | Register (dec) | Description | Units | Scale |
|----------------|----------------|-------------|-------|-------|
| 0x2100 | 8448 | Command word | — | — |
| 0x2101 | 8449 | Frequency setpoint | Hz | ÷10 |
| 0x2103 | 8451 | Output frequency | Hz | ÷10 |
| 0x2104 | 8452 | Output current | A | ÷10 |
| 0x2105 | 8453 | DC bus voltage | V | ÷10 |
| 0x210F | 8463 | Fault code | — | — |

**Write Registers (Function Code 06):**

| Register (hex) | Value | Action |
|----------------|-------|--------|
| 0x2100 | 0x0001 | Forward run |
| 0x2100 | 0x0002 | Reverse run |
| 0x2100 | 0x0005 | Stop |
| 0x2100 | 0x0007 | Fault reset |
| 0x2101 | 0-400 | Set frequency (0.0-40.0 Hz) |

### 5.3 Modbus Address Note

**CRITICAL:** Modbus register addresses are **zero-indexed** in CCW.
- Register 0x2100 (8448 decimal) → CCW address: **8448**
- The GS10 manual may show "40001" style — subtract 40001 to get the CCW address

### 5.4 PLC Tag Definitions

| Tag Name | Type | Modbus Address | Description |
|----------|------|----------------|-------------|
| VFD_Command | INT | 0x2100 | Write: run/stop/reverse |
| VFD_FreqSetpoint | INT | 0x2101 | Write: speed command (×10) |
| VFD_OutputFreq | INT | 0x2103 | Read: actual frequency (÷10) |
| VFD_OutputCurrent | INT | 0x2104 | Read: actual current (÷10) |
| VFD_DCBusVoltage | INT | 0x2105 | Read: DC bus voltage (÷10) |
| VFD_FaultCode | INT | 0x210F | Read: active fault code |

---

## 6. Ethernet Wiring (Already Done)

Per network topology, this is complete:

| From | To | Cable | Port |
|------|----|-------|------|
| Micro820 Ethernet | Netgear SG605 | Cat5e patch | Switch port 4 |
| Mac Mini Bravo | Netgear SG605 | Cat5e patch | Switch port 5 |

- PLC IP: 192.168.1.100 (static, set in CCW)
- Mac Mini IP: 192.168.1.11
- Verify: `ping 192.168.1.100` from Mac Mini

---

## 7. Complete Wiring Checklist (Do In This Order)

### Phase A: Power + Operator Station (LOTO REQUIRED)

- [ ] 1. LOTO main breaker — verify zero energy
- [ ] 2. Wire 3-phase supply → GS10 input (R/L1, S/L2, T/L3)
- [ ] 3. Wire GS10 output → motor (U/T1, V/T2, W/T3)
- [ ] 4. Wire equipment grounds (breaker → VFD → motor frame)
- [ ] 5. Mount + wire 24VDC DIN-rail supply (see Section 2.5):
  - 24V+ → +DC24, +CM0, operator station bus
  - 24V- → -DC24, -CM0, COM0
- [ ] 6. Wire 24VDC control circuit (PLC O-02 → Q1 coil → -CM0 return)
- [ ] 6. Mount operator station enclosure
- [ ] 7. Run 12-conductor control cable (station → PLC panel, 10 active + 2 spare)
- [ ] 8. Wire E-stop: NC → I-02, NO → I-03
- [ ] 9. Wire selector: FWD → I-00, REV → I-01
- [ ] 10. Wire RUN pushbutton signal contact → I-04
- [ ] 11. Wire RUN pushbutton LED → O-03, return → -CM0
- [ ] 12. Wire green pilot light → O-00
- [ ] 13. Wire red pilot light → O-01
- [ ] 14. Wire COM0 + -CM0 to 24VDC (-)

### Phase B: RS-485 Serial (Can be done hot)

- [ ] 6. Build RS-485 cable (RJ45 → bare wire)
- [ ] 7. Connect bare end to Micro820 terminal block (Pin 1=S+, Pin 2=S-, Pin 5=GND)
- [ ] 8. Plug RJ45 into GS10 RS-485 port
- [ ] 9. Route cable away from power cables
- [ ] 10. Install 120Ω termination resistor if cable >30 ft

### Phase C: VFD Programming (At the keypad)

- [ ] 11. Program communication parameters (P09.xx)
- [ ] 12. Program control source parameters (P00.02, P00.04)
- [ ] 13. Program motor nameplate values (P01.xx)
- [ ] 14. Power cycle VFD

### Phase D: PLC Programming (In CCW on PLC Laptop)

- [ ] 15. Configure serial port as Modbus RTU Master (9600/8N2)
- [ ] 16. Create MSG_MODBUS function blocks for read/write
- [ ] 17. Create tags for VFD data
- [ ] 18. Download program to PLC
- [ ] 19. Put PLC in RUN mode

### Phase E: Verification

- [ ] 20. Read VFD_OutputFreq register — should return 0 (motor stopped)
- [ ] 21. Read VFD_FaultCode register — should return 0 (no faults)
- [ ] 22. Write VFD_FreqSetpoint = 100 (10.0 Hz)
- [ ] 23. Write VFD_Command = 0x0001 (forward run)
- [ ] 24. Verify motor spins at ~10 Hz
- [ ] 25. Write VFD_Command = 0x0005 (stop)
- [ ] 26. Verify motor stops
- [ ] 27. Check VFD_OutputCurrent reading matches motor nameplate
- [ ] 28. From Mac Mini: `curl http://192.168.1.100:502` — verify Modbus TCP accessible

### Phase F: MIRA Integration

- [ ] 29. Install node-red-contrib-modbus in mira-bridge
- [ ] 30. Create Node-RED flow: poll registers 0x2103-0x210F every 5s
- [ ] 31. Write polled data to equipment_status table in mira.db
- [ ] 32. Test: send "what's the conveyor speed?" to MIRA via Telegram
- [ ] 33. Verify MIRA responds with live VFD data

---

## 8. Troubleshooting

| Symptom | Check | Fix |
|---------|-------|-----|
| No Modbus response | LED on GS10 RS-485 port | Swap S+ and S- (A/B polarity reversed) |
| Intermittent comms | Cable near VFD output | Reroute RS-485 away from power cables |
| CRC errors | Baud rate mismatch | Verify both sides: 9600/8N2 |
| Timeout errors | Wrong slave address | Verify GS10 P09.01 = 1, CCW slave addr = 1 |
| VFD won't run via Modbus | P00.04 not set | Set P00.04 = 2 (RS-485 run source) |
| Motor runs backwards | Phase sequence wrong | Swap any two motor leads (T1↔T2) |
| Overload trip | Motor params wrong | Verify P01.xx matches motor nameplate |
| Can't ping PLC | IP wrong | Verify 192.168.1.100 in CCW, same subnet |

---

## 9. Network Reference

```
Netgear SG605 (192.168.1.1)
├── Port 1: [available]
├── Port 2: [available]
├── Port 3: PLC Laptop (192.168.1.20) — CCW programming
├── Port 4: Micro820 PLC (192.168.1.100) — Modbus TCP :502
└── Port 5: Mac Mini Bravo (192.168.1.11) — MIRA + Ollama

Micro820 PLC (192.168.1.100)
├── Ethernet → Switch port 4 (Modbus TCP to Mac Mini)
└── RS-485 Serial → GS10 VFD (Modbus RTU, 9600/8N2)

GS10 VFD (no IP — RS-485 only)
├── RS-485 RJ45 → Micro820 serial port
├── Power In: R/L1, S/L2, T/L3 (from breaker)
└── Power Out: U/T1, V/T2, W/T3 (to motor)
```

---

## 10. Commissioning — First Power-On Sequence

> **Do these steps IN ORDER.** Each phase builds on the last.
> Do not energize 3-phase power until Phase 5.

### Phase 1 — 24VDC Control Power Only (no 3-phase yet)

**Goal:** Verify PLC boots, Ethernet works, operator station signals read correctly.

- [ ] 1. Verify all 3-phase breakers are **OFF** and locked out
- [ ] 2. Verify 24VDC supply wiring per Section 2.5 checklist
- [ ] 3. Energize AC feed to 24VDC supply
- [ ] 4. Measure DC output with multimeter: should read 23.5–24.5V
- [ ] 5. PLC **PWR** LED illuminates solid green
- [ ] 6. Connect Ethernet cable from PLC to switch
- [ ] 7. From PLC Laptop: `ping 192.168.1.100` — should reply
- [ ] 8. Open CCW → Go Online → Connect to PLC
- [ ] 9. Verify in Online Monitor:
  - E-stop released → I-02=1, I-03=0
  - E-stop pressed → I-02=0, I-03=1
  - Selector FWD → I-00=1, I-01=0
  - Selector OFF → I-00=0, I-01=0
  - Selector REV → I-00=0, I-01=1
  - RUN button → I-04=1 while held
- [ ] 10. Force outputs in CCW:
  - Force O-00 ON → green pilot light illuminates
  - Force O-01 ON → red pilot light illuminates
  - Force O-03 ON → RUN pushbutton LED illuminates
  - Force O-02 ON → contactor Q1 clicks (no 3-phase, so no motor)
  - Remove all forces when done

### Phase 2 — PLC Program Download

**Goal:** Get the v3.1 program running on the PLC.

**Files needed** (from [PLC v3.1 gist](https://gist.github.com/Mikecranesync/ea612e926721bb259eda64dec6da08e4)):
- `Micro820_v3_Program.st` — main program
- `CCW_VARIABLES_v3.txt` — variable list
- `MbSrvConf_v3.xml` — Modbus TCP mapping
- `CCW_DEPLOY_v3.txt` — full deploy instructions

**Steps:**

- [ ] 1. Open CCW project: `Cosmos_Demo_v1.0.ccwsln`
- [ ] 2. Add all new variables from `CCW_VARIABLES_v3.txt`:
  - Global Variables: `dir_fwd`, `dir_rev`, `dir_off`, `dir_fault`, `estop_wiring_fault`, `prev_button`, `vfd_poll_active`, `vfd_poll_step`, `vfd_freq_setpoint`, `vfd_cmd_word`
  - MSG instances: `mb_write_cmd`, `mb_write_freq`
  - Config structs: `write_cmd_local_cfg`, `write_cmd_target_cfg`, `write_freq_local_cfg`, `write_freq_target_cfg`
  - Data arrays: `write_cmd_data INT[1..10]`, `write_freq_data INT[1..10]`
- [ ] 3. Copy `Micro820_v3_Program.st` content into Program → Prog2
- [ ] 4. Copy `MbSrvConf_v3.xml` into `Controller\Controller\MbSrvConf.xml`
- [ ] 5. Configure serial port (Controller → Embedded Serial):
  - Protocol: **Modbus RTU Master**
  - Baud Rate: **9600**
  - Data Bits: **8**
  - Parity: **None**
  - Stop Bits: **2**
- [ ] 6. **Ctrl+Shift+B** to rebuild — fix any compile errors
- [ ] 7. Go Online → Connect to PLC at 192.168.1.100
- [ ] 8. Switch PLC to **PROGRAM** mode
- [ ] 9. **Download** program to PLC
- [ ] 10. Switch PLC to **RUN** mode
- [ ] 11. Verify in Online Monitor:
  - `heartbeat` toggles every scan
  - E-stop released → `e_stop_active = FALSE`
  - E-stop pressed → `e_stop_active = TRUE`, `conv_state = 4`
  - O-02 follows `NOT e_stop_active` (contactor logic)
  - Green light (O-00) OFF (motor not running yet)
  - Red light (O-01) ON if E-stop pressed or fault

### Phase 3 — VFD Parameter Programming (at the GS10 keypad)

**Goal:** Configure VFD for Modbus RTU communication + motor parameters.

> The GS10 VFD has its own control power input separate from the 3-phase motor power.
> With contactor Q1 open (E-stop pressed or PLC forcing O-02 OFF), the VFD has
> no 3-phase power — the motor cannot spin. Safe to program.

**Communication parameters (P09.xx):**

| Step | Key Sequence | Parameter | Set To | Meaning |
|------|-------------|-----------|--------|---------|
| 1 | PROG → P09 → P09.00 | Protocol | **1** | Modbus RTU |
| 2 | P09.01 | Slave address | **1** | Address 1 |
| 3 | P09.02 | Baud rate | **3** | 9600 bps |
| 4 | P09.03 | Data format | **0** | 8 data, no parity, 2 stop (8N2) |
| 5 | P09.04 | Response delay | **0** | No delay |

**Control source parameters (P00.xx):**

| Step | Parameter | Set To | Meaning |
|------|-----------|--------|---------|
| 6 | P00.02 | **3** | Frequency source = RS-485 |
| 7 | P00.04 | **2** | Run command source = RS-485 |

**Motor nameplate parameters (P01.xx):**

| Step | Parameter | Description | Set To |
|------|-----------|-------------|--------|
| 8 | P01.00 | Motor power (kW) | Read from nameplate |
| 9 | P01.01 | Motor voltage | Read from nameplate |
| 10 | P01.02 | Motor current (A) | Read from nameplate |
| 11 | P01.03 | Motor frequency | 60 Hz (US) |
| 12 | P01.04 | Motor RPM | Read from nameplate |

- [ ] Enter all parameters above
- [ ] **Power cycle the VFD** (required for comm parameters to take effect)
- [ ] After restart, VFD display should show `0.0` Hz

### Phase 4 — RS-485 Communication Verify

**Goal:** Confirm PLC can talk to VFD over Modbus RTU before applying motor power.

- [ ] 1. Verify RS-485 cable connected: PLC Pin 1→S+, Pin 2→S-, Pin 5→SG (see Section 3)
- [ ] 2. In CCW Online Monitor, check:
  - `vfd_comm_ok = TRUE` — Modbus reads succeeding
  - `vfd_comm_err = FALSE` — no errors
  - `vfd_frequency = 0` — motor not running (expected)
  - `vfd_current = 0` — no current flow (expected)
  - `vfd_dc_bus` — should show DC bus voltage if VFD control power is on
- [ ] 3. If `vfd_comm_err = TRUE`:
  - **Swap S+ and S-** at the PLC terminal block (most common fix)
  - Verify baud rate: PLC = 9600, VFD P09.02 = 3
  - Verify slave address: PLC target node = 1, VFD P09.01 = 1
  - Check cable routing — away from VFD output power cables
  - Try 120Ω termination resistor across S+/S- at VFD end

### Phase 5 — 3-Phase Power + First Motor Run

**Goal:** Run the motor for the first time under PLC control.

> **SAFETY:** Keep hands clear of conveyor. Have E-stop within reach.
> First run should be at low speed (10 Hz). Motor may run in wrong direction — that's normal, just swap two motor leads after.

- [ ] 1. Verify all motor wiring: VFD U/T1→Motor T1, V/T2→T2, W/T3→T3
- [ ] 2. Verify equipment grounds: breaker→VFD→motor frame
- [ ] 3. **Release E-stop** (twist to reset)
- [ ] 4. In CCW: verify `e_stop_active = FALSE`, `O-02 = TRUE`
- [ ] 5. **Close 3-phase main breaker**
- [ ] 6. Listen for contactor Q1 click — VFD now has power
- [ ] 7. VFD display should show `0.0` Hz (stopped, waiting for Modbus command)
- [ ] 8. In CCW: set `conveyor_speed_cmd = 1000` (≈10 Hz at low speed)
- [ ] 9. Turn selector to **FWD**
- [ ] 10. Press **RUN** pushbutton
- [ ] 11. Verify:
  - `conv_state` goes 0 → 1 → 2
  - Green pilot light (O-00) **ON**
  - RUN pushbutton LED (O-03) **ON**
  - `vfd_cmd_word = 1` (forward run)
  - `vfd_frequency` shows value near 100 (= 10.0 Hz)
  - Motor shaft is spinning
  - `vfd_current` shows motor load current
- [ ] 12. Turn selector to **OFF**
  - `conv_state` goes 2 → 3 → 0
  - Motor decelerates to stop
  - Green light OFF, pushbutton LED OFF
- [ ] 13. Test **reverse**: selector to REV, press RUN
  - `vfd_cmd_word = 2` (reverse)
  - Motor spins opposite direction
  - Selector to OFF to stop
- [ ] 14. **E-STOP TEST** (critical safety verification):
  - Start motor (FWD + RUN)
  - Press E-stop mushroom button
  - Verify **immediately**:
    - `e_stop_active = TRUE`
    - O-02 = FALSE → contactor Q1 drops out (audible click)
    - VFD loses 3-phase power — motor coasts to stop
    - Red pilot light (O-01) **ON**
    - Green light and pushbutton LED **OFF**
    - `conv_state = 4`, `error_code = 6`
  - Twist E-stop to reset
  - Press RUN to clear fault → `conv_state` returns to 0
- [ ] 15. If motor runs backwards in FWD: **LOTO**, swap any two motor leads (T1↔T2)

### Phase 6 — MIRA Integration Test

**Goal:** Verify MIRA can read live PLC/VFD data via Modbus TCP and answer questions.

- [ ] 1. From Mac Mini: `ping 192.168.1.100` — verify PLC reachable
- [ ] 2. Install `node-red-contrib-modbus` in mira-bridge (if not done)
- [ ] 3. Create Node-RED flow: poll Modbus TCP registers every 5s
  - Coils 1-19: motor_running, conveyor_running, fault_alarm, etc.
  - Registers 400107-400110: vfd_frequency, vfd_current, vfd_voltage, vfd_dc_bus
- [ ] 4. Write polled data to `equipment_status` table in mira.db
- [ ] 5. Start motor (FWD + RUN)
- [ ] 6. Send Telegram message: **"what's the conveyor speed?"**
- [ ] 7. MIRA should respond with live VFD frequency data
- [ ] 8. Send: **"is there a fault?"** → MIRA should report no fault
- [ ] 9. Press E-stop → send: **"what happened?"** → MIRA should report E-stop

---

## 11. Previous Gists (Superseded by This Document)

| Gist | Status |
|------|--------|
| 4224dd65 — RS-485 Wiring Diagram | Merged into Section 3 |
| a66e18e7 — Network + VFD Wiring | Merged into Sections 3, 6 |
| ce4d9066 — Private copy of above | Duplicate — archive |
| c7d48a4b — Private copy of above | Duplicate — archive |
| 7dee70a9 — PLC Recovery + Modbus Map | Merged into Section 5 |
| 7d7a7297 — CCW Setup Guide | Merged into Section 5 |
| bc6c1a1b — VFD Modbus RTU Progress | Merged into Section 5 |
| c8707314 — PLC Integration WO | Merged into Section 2 |
| 59d243c7 — Conveyor Wiring WO | Superseded |
| 42bd2612 — Motor Bearing WO | Reference only |
| 889e5d90 — Network Topology | Merged into Section 9 |

---

*FactoryLM — Master Wiring Guide*
*One document. Everything you need. Nothing you don't.*
