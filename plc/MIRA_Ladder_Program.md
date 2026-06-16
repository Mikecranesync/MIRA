# MIRA Ladder Logic Program — Micro820 2080-LC20-20QBB

**Program:** Prog2 (Ladder Diagram)
**PLC:** Allen-Bradley Micro820 2080-LC20-20QBB
**IP:** 192.168.1.100 (static) / 169.254.32.93 (APIPA)
**Equivalent ST:** Micro820_v3_Program.st v3.2
**Rungs:** 62 total across 7 sections

---

## I/O Assignment

| Terminal | CCW Tag | Function | Type |
|----------|---------|----------|------|
| I-00 | `_IO_EM_DI_00` | SelectorFWD (NO, knob LEFT) | Input |
| I-01 | `_IO_EM_DI_01` | SelectorREV (NO, knob RIGHT) | Input |
| I-02 | `_IO_EM_DI_02` | EStopNC (opens when pressed) | Input |
| I-03 | `_IO_EM_DI_03` | EStopNO (closes when pressed) | Input |
| I-04 | `_IO_EM_DI_04` | PBRun (illuminated momentary NO) | Input |
| I-05 | `_IO_EM_DI_05` | Entry sensor (spare) | Input |
| I-06 | `_IO_EM_DI_06` | Exit sensor (spare) | Input |
| O-00 | `_IO_EM_DO_00` | LightGreen (running) | Output |
| O-01 | `_IO_EM_DO_01` | LightRed (fault/e-stop) | Output |
| O-02 | `_IO_EM_DO_02` | ContactorQ1 (safety power) | Output |
| O-03 | `_IO_EM_DO_03` | PBRunLED (pushbutton light) | Output |

## Variable List

Add this one new variable (all others carry forward from CCW_VARIABLES_v3.txt):

| Name | Type | Initial | Purpose |
|------|------|---------|---------|
| `xor_ok` | BOOL | FALSE | E-stop dual-channel XOR helper |

---

## How to Read the Rung Diagrams

```
  --[ ]--    XIC (Examine If Closed) — TRUE when bit = 1
  --[/]--    XIO (Examine If Open)   — TRUE when bit = 0
  --( )--    OTE (Output Energize)   — set/clear every scan
  --(L)--    OTL (Output Latch)      — set only, stays set
  --(U)--    OTU (Output Unlatch)    — clear only
  --[EQU]--  Equal comparison        — TRUE when A = B
  --[NEQ]--  Not Equal comparison    — TRUE when A != B
  --[GRT]--  Greater Than            — TRUE when A > B
  --[GEQ]--  Greater or Equal        — TRUE when A >= B
  --[LEQ]--  Less or Equal           — TRUE when A <= B
  --[MOV]--  Move                    — copy Source to Dest
  --[ADD]--  Add                     — A + B → Dest
  --[MUL]--  Multiply                — A * B → Dest
  --[DIV]--  Divide                  — A / B → Dest
  --[TON]--  Timer On Delay          — times when IN=TRUE
  --[MSG]--  Message                 — Modbus RTU comm block

  Parallel (OR):
    --[branch 1]--+
                  +--( output )
    --[branch 2]--+

  Series (AND):
    --[cond A]--[cond B]--[cond C]--( output )
```

---

## SECTION 1 — E-STOP SUPERVISION

Dual-channel e-stop: I-02 (NC contact) and I-03 (NO contact) must be complementary.
Healthy = I-02 closed (1), I-03 open (0). Pressed = I-02 open (0), I-03 closed (1).
Both same state = wiring fault.

---

### Rung 0 — E-Stop XOR Check

**Comment:** E-stop dual-channel XOR: TRUE when contacts are complementary (wiring OK)

```
     _IO_EM_DI_02    _IO_EM_DI_03              xor_ok
  +--[ ]-------------[/]------------+--( )--
  |                                 |
  +--[/]-------------[ ]------------+
     _IO_EM_DI_02    _IO_EM_DI_03
```

**Instructions:**
- Branch 1: XIC `_IO_EM_DI_02`, XIO `_IO_EM_DI_03`
- Branch 2: XIO `_IO_EM_DI_02`, XIC `_IO_EM_DI_03`
- Output: OTE `xor_ok`

---

### Rung 1 — E-Stop Wiring Fault

**Comment:** E-stop wiring fault: both contacts same state (XOR failed)

```
     xor_ok          estop_wiring_fault
  --[/]--------------( )--
```

**Instructions:**
- XIO `xor_ok`
- OTE `estop_wiring_fault`

---

### Rung 2 — Latch fault_alarm on Wiring Fault

**Comment:** Latch fault_alarm when wiring fault detected

```
     estop_wiring_fault    fault_alarm
  --[ ]--------------------(L)--
```

**Instructions:**
- XIC `estop_wiring_fault`
- OTL `fault_alarm`

---

### Rung 3 — E-Stop Active

**Comment:** E-stop active: pressed (NC open + NO closed) OR wiring fault

```
     xor_ok    _IO_EM_DI_02    _IO_EM_DI_03
  +--[ ]-------[/]--------------[ ]----------+
  |                                          |     e_stop_active
  +--[ ]-------------------------------------+--( )--
     estop_wiring_fault
```

**Instructions:**
- Branch 1: XIC `xor_ok`, XIO `_IO_EM_DI_02`, XIC `_IO_EM_DI_03`
- Branch 2: XIC `estop_wiring_fault`
- Output: OTE `e_stop_active`

---

## SECTION 2 — OPERATOR STATION I/O MAPPING

Three-position selector: LEFT=FWD, RIGHT=REV, CENTER=OFF.
Both closed = wiring fault.

---

### Rung 4 — Direction FWD

**Comment:** Direction FWD: selector I-00 closed AND I-01 open (knob LEFT)

```
     _IO_EM_DI_00    _IO_EM_DI_01    dir_fwd
  --[ ]--------------[/]-------------( )--
```

**Instructions:** XIC `_IO_EM_DI_00`, XIO `_IO_EM_DI_01` → OTE `dir_fwd`

---

### Rung 5 — Direction REV

**Comment:** Direction REV: selector I-01 closed AND I-00 open (knob RIGHT)

```
     _IO_EM_DI_00    _IO_EM_DI_01    dir_rev
  --[/]--------------[ ]-------------( )--
```

**Instructions:** XIO `_IO_EM_DI_00`, XIC `_IO_EM_DI_01` → OTE `dir_rev`

---

### Rung 6 — Direction OFF

**Comment:** Direction OFF: both selector contacts open (knob CENTER)

```
     _IO_EM_DI_00    _IO_EM_DI_01    dir_off
  --[/]--------------[/]-------------( )--
```

**Instructions:** XIO `_IO_EM_DI_00`, XIO `_IO_EM_DI_01` → OTE `dir_off`

---

### Rung 7 — Direction FAULT

**Comment:** Direction FAULT: both selector contacts closed (invalid wiring)

```
     _IO_EM_DI_00    _IO_EM_DI_01    dir_fault
  --[ ]--------------[ ]-------------( )--
```

**Instructions:** XIC `_IO_EM_DI_00`, XIC `_IO_EM_DI_01` → OTE `dir_fault`

---

### Rung 8 — Entry Sensor

**Comment:** Entry sensor active (I-05)

```
     _IO_EM_DI_05    sensor_1_active
  --[ ]--------------( )--
```

**Instructions:** XIC `_IO_EM_DI_05` → OTE `sensor_1_active`

---

### Rung 9 — Exit Sensor

**Comment:** Exit sensor active (I-06)

```
     _IO_EM_DI_06    sensor_2_active
  --[ ]--------------( )--
```

**Instructions:** XIC `_IO_EM_DI_06` → OTE `sensor_2_active`

---

### Rung 10 — RUN Button Rising Edge

**Comment:** RUN button rising edge: DI_04 high AND prev_button low = button just pressed

```
     _IO_EM_DI_04    prev_button     button_rising
  --[ ]--------------[/]-------------( )--
```

**Instructions:** XIC `_IO_EM_DI_04`, XIO `prev_button` → OTE `button_rising`

---

### Rung 11 — Store Previous Button State

**Comment:** Store previous RUN button state for next scan edge detection

```
     _IO_EM_DI_04    prev_button
  --[ ]--------------( )--
```

**Instructions:** XIC `_IO_EM_DI_04` → OTE `prev_button`

**NOTE:** Rung 11 MUST come AFTER Rung 10 in scan order, or edge detection breaks.

---

## SECTION 3 — SAFETY CONTACTOR Q1

ContactorQ1 (O-02) energizes the 3-phase power to VFD.
De-energized = VFD has no power = motor cannot spin.

---

### Rung 12 — Safety Contactor Q1

**Comment:** Safety contactor Q1: energized when E-stop OK and no wiring fault. When this rung goes FALSE, 3-phase power to VFD is physically cut.

```
     e_stop_active    estop_wiring_fault    _IO_EM_DO_02
  --[/]---------------[/]-------------------( )--
```

**Instructions:** XIO `e_stop_active`, XIO `estop_wiring_fault` → OTE `_IO_EM_DO_02`

---

## SECTION 4 — CONVEYOR STATE MACHINE

States: 0=IDLE, 1=STARTING, 2=RUNNING, 3=STOPPING, 4=FAULT

The state machine uses EQU (Equal) instructions as conditions on the left rail,
and MOV instructions to change `conv_state` for transitions.

---

### Rung 13 — Motor Running Output

**Comment:** Motor running: TRUE in STARTING (1) and RUNNING (2) states

```
     +--[EQU]--+                   motor_running
     | conv_state |--+
     |    1     |  |
     +----------+  +--( )--
     +--[EQU]--+  |
     | conv_state |--+
     |    2     |
     +----------+
```

**Instructions:**
- Branch 1: EQU `conv_state` = 1
- Branch 2: EQU `conv_state` = 2
- Output: OTE `motor_running`

**CCW entry:** Place EQU on left rail, Source A = `conv_state`, Source B = `1`. Add parallel branch below with EQU Source B = `2`. Connect both to OTE `motor_running` on right rail.

---

### Rung 14 — Conveyor Running Output

**Comment:** Conveyor at speed: TRUE only in RUNNING (2) state

```
     +--[EQU]--+     conveyor_running
     | conv_state |
     |    2     |--( )--
     +----------+
```

**Instructions:** EQU `conv_state` = 2 → OTE `conveyor_running`

---

### Rung 15 — Motor Speed (RUNNING)

**Comment:** Motor speed follows speed command in RUNNING state

```
     +--[EQU]--+     +---[MOV]---+
     | conv_state |     | Source:   |
     |    2     |-----| conveyor_ |
     +----------+     | speed_cmd |
                      | Dest:     |
                      | motor_    |
                      | speed     |
                      +-----------+
```

**Instructions:** EQU `conv_state` = 2 → MOV Source=`conveyor_speed_cmd`, Dest=`motor_speed`

---

### Rung 16 — Motor Speed Zero (not RUNNING)

**Comment:** Motor speed zero when not in RUNNING state

```
     +--[NEQ]--+     +---[MOV]---+
     | conv_state |     | Source: 0 |
     |    2     |-----| Dest:     |
     +----------+     | motor_    |
                      | speed     |
                      +-----------+
```

**Instructions:** NEQ `conv_state` != 2 → MOV Source=`0`, Dest=`motor_speed`

---

### Rung 17 — VFD Forward Command

**Comment:** VFD forward run (cmd=1) when STARTING or RUNNING with dir_fwd

```
     +--[EQU]--+               dir_fwd     +---[MOV]---+
     | conv_state |--+                        | Source: 1 |
     |    1     |  +--[ ]-------------------| Dest:     |
     +----------+  |                        | vfd_cmd_  |
     +--[EQU]--+  |                        | word      |
     | conv_state |--+                        +-----------+
     |    2     |
     +----------+
```

**Instructions:**
- Branch 1: EQU `conv_state` = 1
- Branch 2: EQU `conv_state` = 2
- Series: XIC `dir_fwd`
- Output: MOV Source=`1`, Dest=`vfd_cmd_word`

---

### Rung 18 — VFD Reverse Command

**Comment:** VFD reverse run (cmd=2) when STARTING or RUNNING with dir_rev

```
     +--[EQU]--+               dir_rev     +---[MOV]---+
     | conv_state |--+                        | Source: 2 |
     |    1     |  +--[ ]-------------------| Dest:     |
     +----------+  |                        | vfd_cmd_  |
     +--[EQU]--+  |                        | word      |
     | conv_state |--+                        +-----------+
     |    2     |
     +----------+
```

**Instructions:**
- Branch 1: EQU `conv_state` = 1
- Branch 2: EQU `conv_state` = 2
- Series: XIC `dir_rev`
- Output: MOV Source=`2`, Dest=`vfd_cmd_word`

---

### Rung 19 — VFD Stop Command

**Comment:** VFD stop (cmd=5) in IDLE, STOPPING, or FAULT states

```
     +--[EQU]--+
     | conv_state |--+
     |    0     |  |     +---[MOV]---+
     +----------+  |     | Source: 5 |
     +--[EQU]--+  +-----| Dest:     |
     | conv_state |--+     | vfd_cmd_  |
     |    3     |  |     | word      |
     +----------+  |     +-----------+
     +--[EQU]--+  |
     | conv_state |--+
     |    4     |
     +----------+
```

**Instructions:**
- Branch 1: EQU `conv_state` = 0
- Branch 2: EQU `conv_state` = 3
- Branch 3: EQU `conv_state` = 4
- Output: MOV Source=`5`, Dest=`vfd_cmd_word`

---

### Rung 20 — Transition: IDLE → STARTING

**Comment:** IDLE to STARTING: RUN button pressed + direction selected + no faults

```
     +--[EQU]--+  button_    +--dir_fwd--+  e_stop_     fault_      dir_fault   +---[MOV]---+
     | conv_state |  rising     |  [ ]      |  active     alarm                    | Source: 1 |
     |    0     |--[ ]-------+           +--[/]--------[/]----------[/]---------| Dest:     |
     +----------+            |  dir_rev  |                                      | conv_state|
                             +--[ ]------+                                      +-----------+
```

**Instructions:**
- EQU `conv_state` = 0
- XIC `button_rising`
- Branch: XIC `dir_fwd` OR XIC `dir_rev` (parallel)
- XIO `e_stop_active`
- XIO `fault_alarm`
- XIO `dir_fault`
- Output: MOV Source=`1`, Dest=`conv_state`

---

### Rung 21 — Transition: STARTING → RUNNING

**Comment:** STARTING to RUNNING: start timer done (3 sec ramp complete) + no faults

```
     +--[EQU]--+  start_timer  e_stop_     fault_      dir_fault   +---[MOV]---+
     | conv_state |  .Q          active     alarm                    | Source: 2 |
     |    1     |--[ ]----------[/]--------[/]----------[/]---------| Dest:     |
     +----------+                                                   | conv_state|
                                                                    +-----------+
```

**Instructions:** EQU `conv_state` = 1, XIC `start_timer.Q`, XIO `e_stop_active`, XIO `fault_alarm`, XIO `dir_fault` → MOV Source=`2`, Dest=`conv_state`

---

### Rung 22 — Transition: RUNNING → STOPPING

**Comment:** RUNNING to STOPPING: selector moved to OFF position (normal stop)

```
     +--[EQU]--+  dir_off     e_stop_     fault_      +---[MOV]---+
     | conv_state |              active     alarm       | Source: 3 |
     |    2     |--[ ]----------[/]--------[/]---------| Dest:     |
     +----------+                                      | conv_state|
                                                       +-----------+
```

**Instructions:** EQU `conv_state` = 2, XIC `dir_off`, XIO `e_stop_active`, XIO `fault_alarm` → MOV Source=`3`, Dest=`conv_state`

---

### Rung 23 — Transition: STOPPING → IDLE

**Comment:** STOPPING to IDLE: stop timer done (2 sec coast complete)

```
     +--[EQU]--+  stop_timer   +---[MOV]---+
     | conv_state |  .Q          | Source: 0 |
     |    3     |--[ ]----------| Dest:     |
     +----------+               | conv_state|
                                +-----------+
```

**Instructions:** EQU `conv_state` = 3, XIC `stop_timer.Q` → MOV Source=`0`, Dest=`conv_state`

---

### Rung 24 — Transition: Active States → FAULT

**Comment:** Any active state to FAULT: e-stop, fault_alarm, or dir_fault detected

```
     +--[EQU]--+       +--e_stop_active---+                +---[MOV]---+
     | conv_state |--+    |  [ ]             |                | Source: 4 |
     |    1     |  |    +                  +               | Dest:     |
     +----------+  |    +--fault_alarm----+---------------| conv_state|
     +--[EQU]--+  +----+  [ ]             |                +-----------+
     | conv_state |--+    +                  +
     |    2     |  |    +--dir_fault------+
     +----------+  |       [ ]
     +--[EQU]--+  |
     | conv_state |--+
     |    3     |
     +----------+
```

**Instructions:**
- Branch (left): EQU `conv_state` = 1 OR EQU `conv_state` = 2 OR EQU `conv_state` = 3
- Branch (right): XIC `e_stop_active` OR XIC `fault_alarm` OR XIC `dir_fault`
- Output: MOV Source=`4`, Dest=`conv_state`

---

### Rung 25 — Fault Error Code: E-Stop (priority 1)

**Comment:** FAULT error code 6: E-stop active (highest priority)

```
     +--[EQU]--+  e_stop_     +---[MOV]---+
     | conv_state |  active     | Source: 6 |
     |    4     |--[ ]---------| Dest:     |
     +----------+              | error_code|
                               +-----------+
```

**Instructions:** EQU `conv_state` = 4, XIC `e_stop_active` → MOV Source=`6`, Dest=`error_code`

---

### Rung 26 — Fault Error Code: Wiring (priority 2)

**Comment:** FAULT error code 7: E-stop wiring fault (second priority)

```
     +--[EQU]--+  e_stop_     estop_wiring_  +---[MOV]---+
     | conv_state |  active     fault          | Source: 7 |
     |    4     |--[/]---------[ ]------------| Dest:     |
     +----------+                             | error_code|
                                              +-----------+
```

**Instructions:** EQU `conv_state` = 4, XIO `e_stop_active`, XIC `estop_wiring_fault` → MOV Source=`7`, Dest=`error_code`

---

### Rung 27 — Fault Error Code: Direction (priority 3)

**Comment:** FAULT error code 8: Direction selector fault (third priority)

```
     +--[EQU]--+  e_stop_     estop_wiring_  dir_fault   +---[MOV]---+
     | conv_state |  active     fault                      | Source: 8 |
     |    4     |--[/]---------[/]------------[ ]---------| Dest:     |
     +----------+                                         | error_code|
                                                          +-----------+
```

**Instructions:** EQU `conv_state` = 4, XIO `e_stop_active`, XIO `estop_wiring_fault`, XIC `dir_fault` → MOV Source=`8`, Dest=`error_code`

---

### Rung 28 — Fault Error Code: VFD Comm (priority 4)

**Comment:** FAULT error code 9: VFD communication error (lowest priority)

```
     +--[EQU]--+  e_stop_     estop_wiring_  dir_fault   vfd_comm_   +---[MOV]---+
     | conv_state |  active     fault                      err         | Source: 9 |
     |    4     |--[/]---------[/]------------[/]---------[ ]---------| Dest:     |
     +----------+                                                     | error_code|
                                                                      +-----------+
```

**Instructions:** EQU `conv_state` = 4, XIO `e_stop_active`, XIO `estop_wiring_fault`, XIO `dir_fault`, XIC `vfd_comm_err` → MOV Source=`9`, Dest=`error_code`

---

### Rung 29 — Fault Reset

**Comment:** FAULT RESET: RUN button + e-stop clear + wiring OK + direction selected → clear fault, return to IDLE

```
     +--[EQU]--+  button_    e_stop_     estop_wiring_  dir_off     fault_alarm  +---[MOV]---+
     | conv_state |  rising     active     fault                                   | Source: 0 |
     |    4     |--[ ]--------[/]---------[/]------------[/]--------(U)----------| Dest:     |
     +----------+                                                                | error_code|
                                                                                 +-----------+
                                                                                 +---[MOV]---+
                                                                                 | Source: 0 |
                                                                                 | Dest:     |
                                                                                 | conv_state|
                                                                                 +-----------+
```

**Instructions:**
- EQU `conv_state` = 4
- XIC `button_rising`
- XIO `e_stop_active`
- XIO `estop_wiring_fault`
- XIO `dir_off` (must have direction selected, not OFF)
- Outputs (stacked):
  - OTU `fault_alarm`
  - MOV Source=`0`, Dest=`error_code`
  - MOV Source=`0`, Dest=`conv_state`

---

### Rung 30 — Item Counter

**Comment:** Count items at exit sensor: rising edge on sensor_2 while RUNNING

```
     +--[EQU]--+  sensor_2_   SensorEnd_   +---[ADD]---+
     | conv_state |  active     Prev        | Source A:  |
     |    2     |--[ ]---------[/]----------| item_count |
     +----------+                           | Source B:  |
                                            | 1          |
                                            | Dest:      |
                                            | item_count |
                                            +------------+
```

**Instructions:** EQU `conv_state` = 2, XIC `sensor_2_active`, XIO `SensorEnd_Prev` → ADD Source A=`item_count`, Source B=`1`, Dest=`item_count`

---

### Rung 31 — Sensor Previous State (Latch)

**Comment:** Latch exit sensor previous state while RUNNING (for edge detection)

```
     +--[EQU]--+  sensor_2_   SensorEnd_Prev
     | conv_state |  active
     |    2     |--[ ]--------(L)--
     +----------+
```

**Instructions:** EQU `conv_state` = 2, XIC `sensor_2_active` → OTL `SensorEnd_Prev`

---

### Rung 32 — Sensor Previous State (Unlatch)

**Comment:** Unlatch exit sensor previous state when sensor clears in RUNNING

```
     +--[EQU]--+  sensor_2_   SensorEnd_Prev
     | conv_state |  active
     |    2     |--[/]--------(U)--
     +----------+
```

**Instructions:** EQU `conv_state` = 2, XIO `sensor_2_active` → OTU `SensorEnd_Prev`

---

### Rung 33 — Start Timer

**Comment:** Start timer: 3 second ramp delay. Timing when in STARTING state.

```
     +--[EQU]--+     +---[TON]----------+
     | conv_state |     | Timer:           |
     |    1     |-----| start_timer      |
     +----------+     | Preset: 3000 ms  |
                      | Accum: (auto)    |
                      +------------------+
```

**Instructions:** EQU `conv_state` = 1 → TON `start_timer`, Preset=`T#3000ms`

**CCW entry:** Drag TON block, set Timer tag = `start_timer`, Preset = `3000`.

---

### Rung 34 — Stop Timer

**Comment:** Stop timer: 2 second coast delay. Timing when in STOPPING state.

```
     +--[EQU]--+     +---[TON]----------+
     | conv_state |     | Timer:           |
     |    3     |-----| stop_timer       |
     +----------+     | Preset: 2000 ms  |
                      | Accum: (auto)    |
                      +------------------+
```

**Instructions:** EQU `conv_state` = 3 → TON `stop_timer`, Preset=`T#2000ms`

---

## SECTION 5 — LED INDICATORS + PUSHBUTTON ILLUMINATION

ALL_LEDS_ON is a diagnostic override (set via Modbus TCP write for lamp test).

---

### Rung 35 — Green Light (O-00)

**Comment:** Green pilot light: motor running OR ALL_LEDS_ON lamp test

```
     motor_running
  +--[ ]-------------------+     _IO_EM_DO_00
  |                        +--( )--
  +--[ ]-------------------+
     ALL_LEDS_ON
```

**Instructions:**
- Branch 1: XIC `motor_running`
- Branch 2: XIC `ALL_LEDS_ON`
- Output: OTE `_IO_EM_DO_00`

---

### Rung 36 — Red Light (O-01)

**Comment:** Red pilot light: any fault/alarm condition OR ALL_LEDS_ON lamp test

```
     e_stop_active
  +--[ ]-------------------------------------------+
  |                                                |
  +--[ ] fault_alarm-----------------------------------+
  |                                                |
  +--[ ] estop_wiring_fault----------------------------+     _IO_EM_DO_01
  |                                                +--( )--
  +--[ ] dir_fault-------------------------------------+
  |                                                |
  +--[GRT] vfd_fault_code > 0--------------------------+
  |                                                |
  +--[ ] ALL_LEDS_ON-----------------------------------+
```

**Instructions:**
- Branch 1: XIC `e_stop_active`
- Branch 2: XIC `fault_alarm`
- Branch 3: XIC `estop_wiring_fault`
- Branch 4: XIC `dir_fault`
- Branch 5: GRT `vfd_fault_code` > `0`
- Branch 6: XIC `ALL_LEDS_ON`
- Output: OTE `_IO_EM_DO_01`

---

### Rung 37 — PBRun LED (O-03)

**Comment:** RUN pushbutton LED: motor running OR ALL_LEDS_ON lamp test

```
     motor_running
  +--[ ]-------------------+     _IO_EM_DO_03
  |                        +--( )--
  +--[ ]-------------------+
     ALL_LEDS_ON
```

**Instructions:**
- Branch 1: XIC `motor_running`
- Branch 2: XIC `ALL_LEDS_ON`
- Output: OTE `_IO_EM_DO_03`

---

## SECTION 6 — VFD MODBUS RTU COMMUNICATION

Channel 2 = embedded RS-485 serial port on Micro820.
GS10 VFD at slave address 1, 9600 baud, 8 data bits, no parity, 2 stop bits.
Three MSG blocks cycle: read status → write command → write frequency.

---

### Rung 38 — Read MSG Config

**Comment:** Configure Modbus read MSG: FC03, 4 registers from HR8451, slave 1, channel 2

```
                      +---[MOV]---+   +---[MOV]---+   +---[MOV]---+   +---[MOV]---+
                      | Src: 2    |   | Src: 0    |   | Src: 3    |   | Src: 4    |
  --(unconditional)---| Dst: read_|   | Dst: read_|   | Dst: read_|   | Dst: read_|
                      | local_cfg |   | local_cfg |   | local_cfg |   | local_cfg |
                      | .Channel  |   | .Trigger  |   | .Cmd      |   | .Element  |
                      |           |   | Type      |   |           |   | Cnt       |
                      +-----------+   +-----------+   +-----------+   +-----------+

                      +---[MOV]---+   +---[MOV]---+
                      | Src: 8451 |   | Src: 1    |
                      | Dst: read_|   | Dst: read_|
                      | target_cfg|   | target_cfg|
                      | .Addr     |   | .Node     |
                      +-----------+   +-----------+
```

**Instructions (all unconditional — run every scan):**
- MOV `2` → `read_local_cfg.Channel`
- MOV `0` → `read_local_cfg.TriggerType`
- MOV `3` → `read_local_cfg.Cmd` (FC03 = read holding registers)
- MOV `4` → `read_local_cfg.ElementCnt`
- MOV `8451` → `read_target_cfg.Addr`
- MOV `1` → `read_target_cfg.Node`

**CCW entry:** Leave left rail open (always TRUE). Stack 6 MOV instructions.

---

### Rung 39 — Write Command MSG Config

**Comment:** Configure Modbus write_cmd MSG: FC06, 1 register at HR8448, slave 1, channel 2

```
  --(unconditional)---[MOV 2 → write_cmd_local_cfg.Channel]
                      [MOV 0 → write_cmd_local_cfg.TriggerType]
                      [MOV 6 → write_cmd_local_cfg.Cmd]
                      [MOV 1 → write_cmd_local_cfg.ElementCnt]
                      [MOV 8448 → write_cmd_target_cfg.Addr]
                      [MOV 1 → write_cmd_target_cfg.Node]
```

**Instructions (all unconditional):**
- MOV `2` → `write_cmd_local_cfg.Channel`
- MOV `0` → `write_cmd_local_cfg.TriggerType`
- MOV `6` → `write_cmd_local_cfg.Cmd` (FC06 = write single register)
- MOV `1` → `write_cmd_local_cfg.ElementCnt`
- MOV `8448` → `write_cmd_target_cfg.Addr`
- MOV `1` → `write_cmd_target_cfg.Node`

---

### Rung 40 — Write Frequency MSG Config

**Comment:** Configure Modbus write_freq MSG: FC06, 1 register at HR8449, slave 1, channel 2

```
  --(unconditional)---[MOV 2 → write_freq_local_cfg.Channel]
                      [MOV 0 → write_freq_local_cfg.TriggerType]
                      [MOV 6 → write_freq_local_cfg.Cmd]
                      [MOV 1 → write_freq_local_cfg.ElementCnt]
                      [MOV 8449 → write_freq_target_cfg.Addr]
                      [MOV 1 → write_freq_target_cfg.Node]
```

**Instructions (all unconditional):**
- MOV `2` → `write_freq_local_cfg.Channel`
- MOV `0` → `write_freq_local_cfg.TriggerType`
- MOV `6` → `write_freq_local_cfg.Cmd`
- MOV `1` → `write_freq_local_cfg.ElementCnt`
- MOV `8449` → `write_freq_target_cfg.Addr`
- MOV `1` → `write_freq_target_cfg.Node`

---

### Rung 41 — VFD Frequency Setpoint Calculation (speed > 0)

**Comment:** VFD freq setpoint = (motor_speed * 400) / 4095 when speed > 0

```
     +--[GRT]--+     +---[MUL]----------+   +---[DIV]----------+
     | motor_   |     | Source A:         |   | Source A:         |
     | speed    |     |  motor_speed      |   |  vfd_freq_       |
     | >        |-----| Source B: 400     |---| setpoint         |
     | 0        |     | Dest:             |   | Source B: 4095   |
     +----------+     |  vfd_freq_        |   | Dest:             |
                      |  setpoint         |   |  vfd_freq_        |
                      +-------------------+   |  setpoint         |
                                              +-------------------+
```

**Instructions:** GRT `motor_speed` > `0` → MUL Source A=`motor_speed`, Source B=`400`, Dest=`vfd_freq_setpoint` → DIV Source A=`vfd_freq_setpoint`, Source B=`4095`, Dest=`vfd_freq_setpoint`

---

### Rung 42 — VFD Frequency Setpoint Zero (speed = 0)

**Comment:** VFD freq setpoint = 0 when motor speed is zero

```
     +--[LEQ]--+     +---[MOV]---+
     | motor_   |     | Source: 0 |
     | speed    |-----| Dest:     |
     | <=       |     | vfd_freq_ |
     | 0        |     | setpoint  |
     +----------+     +-----------+
```

**Instructions:** LEQ `motor_speed` <= `0` → MOV Source=`0`, Dest=`vfd_freq_setpoint`

---

### Rung 43 — VFD Poll Timer

**Comment:** VFD poll timer: 500ms interval, runs when NOT actively polling

```
     vfd_poll_    +---[TON]----------+
     active       | Timer:           |
  --[/]-----------| vfd_poll_timer   |
                  | Preset: 500 ms   |
                  +------------------+
```

**Instructions:** XIO `vfd_poll_active` → TON `vfd_poll_timer`, Preset=`T#500ms`

---

### Rung 44 — Poll Step Advance

**Comment:** Start new poll cycle: advance step, set active, clear done

```
     vfd_poll_    vfd_poll_                                  +---[ADD]----------+
     timer.Q      active      vfd_poll_active  vfd_msg_done | Source A:         |
  --[ ]-----------[/]--------(L)-------------(U)------------| vfd_poll_step     |
                                                            | Source B: 1       |
                                                            | Dest:             |
                                                            | vfd_poll_step     |
                                                            +-------------------+
```

**Instructions:**
- XIC `vfd_poll_timer.Q`, XIO `vfd_poll_active`
- Outputs (stacked):
  - OTL `vfd_poll_active`
  - OTU `vfd_msg_done`
  - ADD Source A=`vfd_poll_step`, Source B=`1`, Dest=`vfd_poll_step`

---

### Rung 45 — Poll Step Rollover

**Comment:** Reset poll step to 1 when exceeds 3 (cycle: 1→2→3→1)

```
     +--[GRT]--+     +---[MOV]---+
     | vfd_poll_|     | Source: 1 |
     | step     |-----| Dest:     |
     | >        |     | vfd_poll_ |
     | 3        |     | step      |
     +----------+     +-----------+
```

**Instructions:** GRT `vfd_poll_step` > `3` → MOV Source=`1`, Dest=`vfd_poll_step`

---

### Rung 46 — MSG Read Status Call

**Comment:** MSG Modbus read: read VFD status registers (poll step 1)

```
     +--[EQU]--+  vfd_poll_    +---[MSG]------------------+
     | vfd_poll_|  active       | Message: mb_read_status  |
     | step     |--[ ]----------| LocalCfg: read_local_cfg |
     | =        |               | TargetCfg: read_target_  |
     | 1        |               |            cfg           |
     +----------+               | LocalAddr: read_data     |
                                +--------------------------+
```

**Instructions:** EQU `vfd_poll_step` = 1, XIC `vfd_poll_active` → MSG `mb_read_status`

**CCW entry:** Drag MSG block. In properties dialog, set LocalCfg = `read_local_cfg`, TargetCfg = `read_target_cfg`, LocalAddr = `read_data`.

---

### Rung 47 — MSG Write Command Call

**Comment:** MSG Modbus write: write VFD command word (poll step 2)

```
     +--[EQU]--+  vfd_poll_    +---[MSG]------------------+
     | vfd_poll_|  active       | Message: mb_write_cmd    |
     | step     |--[ ]----------| LocalCfg: write_cmd_     |
     | =        |               |          local_cfg       |
     | 2        |               | TargetCfg: write_cmd_    |
     +----------+               |           target_cfg     |
                                | LocalAddr: write_cmd_    |
                                |            data          |
                                +--------------------------+
```

**Instructions:** EQU `vfd_poll_step` = 2, XIC `vfd_poll_active` → MSG `mb_write_cmd`

---

### Rung 48 — MSG Write Frequency Call

**Comment:** MSG Modbus write: write VFD frequency setpoint (poll step 3)

```
     +--[EQU]--+  vfd_poll_    +---[MSG]------------------+
     | vfd_poll_|  active       | Message: mb_write_freq   |
     | step     |--[ ]----------| LocalCfg: write_freq_    |
     | =        |               |          local_cfg       |
     | 3        |               | TargetCfg: write_freq_   |
     +----------+               |           target_cfg     |
                                | LocalAddr: write_freq_   |
                                |            data          |
                                +--------------------------+
```

**Instructions:** EQU `vfd_poll_step` = 3, XIC `vfd_poll_active` → MSG `mb_write_freq`

---

### Rung 49 — Read Success: Extract VFD Data

**Comment:** Read success: copy VFD data from read_data array to named tags

```
     vfd_poll_    +--[EQU]--+  mb_read_     +---[MOV]---+  +---[MOV]---+  +---[MOV]---+  +---[MOV]---+
     active       | vfd_poll_|  status.Q     | Src: read_|  | Src: read_|  | Src: read_|  | Src: read_|
  --[ ]-----------|  step   |--[ ]----------| data(1)   |  | data(2)   |  | data(3)   |  | data(4)   |
                  | =       |               | Dst: vfd_ |  | Dst: vfd_ |  | Dst: vfd_ |  | Dst: vfd_ |
                  | 1       |               | frequency |  | current   |  | dc_bus    |  | voltage   |
                  +----------+               +-----------+  +-----------+  +-----------+  +-----------+

                                             vfd_comm_ok  vfd_comm_err  vfd_msg_done  vfd_poll_active
                                             (L)          (U)           (L)           (U)
```

**Instructions:**
- XIC `vfd_poll_active`, EQU `vfd_poll_step` = 1, XIC `mb_read_status.Q`
- Outputs (stacked):
  - MOV `read_data(1)` → `vfd_frequency`
  - MOV `read_data(2)` → `vfd_current`
  - MOV `read_data(3)` → `vfd_dc_bus`
  - MOV `read_data(4)` → `vfd_voltage`
  - OTL `vfd_comm_ok`
  - OTU `vfd_comm_err`
  - OTL `vfd_msg_done`
  - OTU `vfd_poll_active`

---

### Rung 50 — Read Error

**Comment:** Read error: set comm error, clear polling

```
     vfd_poll_    +--[EQU]--+  mb_read_      vfd_comm_ok  vfd_comm_err  vfd_msg_done  vfd_poll_active
     active       | vfd_poll_|  status.Error
  --[ ]-----------|  step   |--[ ]-----------(U)----------(L)-----------( )------------(U)--
                  | =       |
                  | 1       |
                  +----------+
```

**Instructions:**
- XIC `vfd_poll_active`, EQU `vfd_poll_step` = 1, XIC `mb_read_status.Error`
- Outputs: OTU `vfd_comm_ok`, OTL `vfd_comm_err`, OTE `vfd_msg_done`, OTU `vfd_poll_active`

---

### Rung 51 — Write Command Complete

**Comment:** Write cmd done (success or error): clear polling

```
     vfd_poll_    +--[EQU]--+  +--mb_write_cmd.Q----+     vfd_msg_done  vfd_poll_active
     active       | vfd_poll_|  |  [ ]               |
  --[ ]-----------|  step   |--+                     +---( )------------(U)--
                  | =       |  +--mb_write_cmd.Error-+
                  | 2       |     [ ]
                  +----------+
```

**Instructions:**
- XIC `vfd_poll_active`, EQU `vfd_poll_step` = 2
- Branch: XIC `mb_write_cmd.Q` OR XIC `mb_write_cmd.Error`
- Outputs: OTE `vfd_msg_done`, OTU `vfd_poll_active`

---

### Rung 52 — Write Command Error Flag

**Comment:** Write cmd error: set vfd_comm_err

```
     vfd_poll_    +--[EQU]--+  mb_write_     vfd_comm_err
     active       | vfd_poll_|  cmd.Error
  --[ ]-----------|  step   |--[ ]-----------(L)--
                  | =       |
                  | 2       |
                  +----------+
```

**Instructions:** XIC `vfd_poll_active`, EQU `vfd_poll_step` = 2, XIC `mb_write_cmd.Error` → OTL `vfd_comm_err`

---

### Rung 53 — Write Frequency Complete

**Comment:** Write freq done (success or error): clear polling

```
     vfd_poll_    +--[EQU]--+  +--mb_write_freq.Q----+    vfd_msg_done  vfd_poll_active
     active       | vfd_poll_|  |  [ ]                |
  --[ ]-----------|  step   |--+                      +--( )------------(U)--
                  | =       |  +--mb_write_freq.Error-+
                  | 3       |     [ ]
                  +----------+
```

**Instructions:**
- XIC `vfd_poll_active`, EQU `vfd_poll_step` = 3
- Branch: XIC `mb_write_freq.Q` OR XIC `mb_write_freq.Error`
- Outputs: OTE `vfd_msg_done`, OTU `vfd_poll_active`

---

### Rung 54 — Write Frequency Error Flag

**Comment:** Write freq error: set vfd_comm_err

```
     vfd_poll_    +--[EQU]--+  mb_write_     vfd_comm_err
     active       | vfd_poll_|  freq.Error
  --[ ]-----------|  step   |--[ ]-----------(L)--
                  | =       |
                  | 3       |
                  +----------+
```

**Instructions:** XIC `vfd_poll_active`, EQU `vfd_poll_step` = 3, XIC `mb_write_freq.Error` → OTL `vfd_comm_err`

---

### Rung 55 — VFD Fault Code Capture

**Comment:** Capture error_code as vfd_fault_code when comm error active

```
     vfd_comm_    +---[MOV]------+
     err          | Source:       |
  --[ ]-----------| error_code   |
                  | Dest:         |
                  | vfd_fault_code|
                  +--------------+
```

**Instructions:** XIC `vfd_comm_err` → MOV Source=`error_code`, Dest=`vfd_fault_code`

---

### Rung 56 — VFD Error Auto-Clear Timer

**Comment:** VFD comm error auto-clear: 5 second timeout

```
     vfd_comm_    +---[TON]----------+
     err          | Timer:           |
  --[ ]-----------| vfd_err_timer    |
                  | Preset: 5000 ms  |
                  +------------------+
```

**Instructions:** XIC `vfd_comm_err` → TON `vfd_err_timer`, Preset=`T#5000ms`

---

### Rung 57 — VFD Error Auto-Clear Action

**Comment:** Clear VFD comm error after 5 second timeout

```
     vfd_err_    vfd_comm_err
     timer.Q
  --[ ]----------(U)--
```

**Instructions:** XIC `vfd_err_timer.Q` → OTU `vfd_comm_err`

---

## SECTION 7 — DIAGNOSTICS

---

### Rung 58 — Heartbeat Toggle

**Comment:** Heartbeat: toggles every scan (XIO feeds OTE = NOT each scan)

```
     heartbeat    heartbeat
  --[/]-----------( )--
```

**Instructions:** XIO `heartbeat` → OTE `heartbeat`

**NOTE:** This works because XIO reads the value BEFORE OTE writes. Each scan: if heartbeat=0, XIO=TRUE, OTE sets 1. Next scan: heartbeat=1, XIO=FALSE, OTE sets 0. Toggles every scan.

---

### Rung 59 — Cycle Counter

**Comment:** Cycle count: increment every scan (unconditional)

```
                  +---[ADD]----------+
                  | Source A:         |
  --(uncondit.)---| cycle_count      |
                  | Source B: 1       |
                  | Dest:             |
                  | cycle_count      |
                  +-------------------+
```

**Instructions:** (unconditional) → ADD Source A=`cycle_count`, Source B=`1`, Dest=`cycle_count`

---

### Rung 60 — Uptime Timer

**Comment:** Uptime timer: 1 second interval, resets when done (self-resetting)

```
     uptime_      +---[TON]----------+
     timer.Q      | Timer:           |
  --[/]-----------| uptime_timer     |
                  | Preset: 1000 ms  |
                  +------------------+
```

**Instructions:** XIO `uptime_timer.Q` → TON `uptime_timer`, Preset=`T#1000ms`

**NOTE:** When timer.Q goes TRUE, XIO goes FALSE, IN drops, timer resets, .Q goes FALSE, XIO goes TRUE, timer restarts. Creates a repeating 1-second pulse.

---

### Rung 61 — Uptime Seconds Increment

**Comment:** Increment uptime_seconds on each timer completion

```
     uptime_      +---[ADD]----------+
     timer.Q      | Source A:         |
  --[ ]-----------| uptime_seconds   |
                  | Source B: 1       |
                  | Dest:             |
                  | uptime_seconds   |
                  +-------------------+
```

**Instructions:** XIC `uptime_timer.Q` → ADD Source A=`uptime_seconds`, Source B=`1`, Dest=`uptime_seconds`

---

### Rung 62 — System Ready

**Comment:** System ready: no fault, no e-stop, conveyor at speed (state 2)

```
     fault_alarm  e_stop_active  +--[EQU]--+     system_ready
                                 | conv_state |
  --[/]-----------[/]------------|    2     |--( )--
                                 +----------+
```

**Instructions:** XIO `fault_alarm`, XIO `e_stop_active`, EQU `conv_state` = 2 → OTE `system_ready`

---

### Rung 63 — Motor Stopped

**Comment:** Motor stopped flag: inverse of motor_running

```
     motor_running  motor_stopped
  --[/]-------------( )--
```

**Instructions:** XIO `motor_running` → OTE `motor_stopped`

---

### Rung 64 — Conveyor Speed Alias

**Comment:** Conveyor speed: alias of conveyor_speed_cmd (for Modbus TCP readback)

```
                  +---[MOV]----------+
                  | Source:           |
  --(uncondit.)---| conveyor_speed_  |
                  | cmd              |
                  | Dest:            |
                  | conveyor_speed   |
                  +------------------+
```

**Instructions:** (unconditional) → MOV Source=`conveyor_speed_cmd`, Dest=`conveyor_speed`

---

## CCW Entry Procedure

1. Open CCW project `MIRA_PLC`
2. Under **Organizer → Program**, right-click `Prog2` → Delete
3. Right-click **Program** → Add → **Ladder Diagram** → Name: `Prog2`
4. Add the variable `xor_ok` (BOOL, default FALSE) to **Global Variables**
5. Enter rungs 0-64 in order using the instruction palette
6. For MSG blocks (Rungs 46-48): drag MSG instruction, configure via properties dialog
7. For TON timers: set Timer tag and Preset value in properties
8. **Build** (Ctrl+Shift+B) — expect 0 errors, 0 warnings
9. **Download** to PLC (must be in Program mode)
10. Go to **Run** mode — verify heartbeat toggling and uptime counting

## Quick Verification Checks

| Check | Expected | How to Verify |
|-------|----------|---------------|
| Heartbeat | Toggles every scan | Read Modbus coil C9 |
| Uptime | Increments every second | Read HR400112 |
| E-stop released | e_stop_active = FALSE | Read coil C6 |
| Selector OFF | dir_off = TRUE | Check dir_off |
| conv_state | 0 (IDLE) | Read HR400114 |
| ContactorQ1 | ON (O-02 lit) | Physical check |
| fault_alarm | TRUE (VFD comm) | Read coil C3 — clears after VFD keypad programmed |

## Cross-Reference: ST Line → LD Rung

| ST Line(s) | Section | LD Rung(s) | Description |
|------------|---------|------------|-------------|
| 30-45 | 1. E-Stop | 0-3 | Dual-channel XOR, wiring fault, e-stop active |
| 53-56 | 2. I/O Map | 4-7 | Direction decode |
| 58-59 | 2. I/O Map | 8-9 | Sensor mapping |
| 62-63 | 2. I/O Map | 10-11 | Rising edge detection |
| 70 | 3. Safety | 12 | Contactor Q1 |
| 78-88 | 4. State 0 | 13-14, 19-20 | IDLE outputs + start transition |
| 90-106 | 4. State 1 | 13, 17-18, 21, 24 | STARTING outputs + transitions |
| 108-136 | 4. State 2 | 13-16, 17-18, 22, 24, 30-32 | RUNNING + item count |
| 138-148 | 4. State 3 | 23, 24 | STOPPING |
| 150-176 | 4. State 4 | 24-29 | FAULT + error codes + reset |
| 179-180 | 4. Timers | 33-34 | Start/stop timers |
| 188-197 | 5. LEDs | 35-37 | Green, red, PBRun LED |
| 207-226 | 6. VFD Cfg | 38-40 | MSG config structs |
| 229-233 | 6. VFD Calc | 41-42 | Frequency setpoint |
| 240-265 | 6. VFD Poll | 43-48 | Poll timer + MSG calls |
| 268-310 | 6. VFD Rslt | 49-54 | MSG results handling |
| 313-320 | 6. VFD Err | 55-57 | Error handling + auto-clear |
| 325-333 | 7. Diag | 58-64 | Heartbeat, uptime, system_ready |

---

**Total: 65 rungs (Rung 0 through Rung 64)**
**Functionally equivalent to Micro820_v3_Program.st v3.2**
