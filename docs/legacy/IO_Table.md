# I/O Assignment Table — Micro820 + GS10 VFD Conveyor System

**PLC:** Allen-Bradley Micro820 2080-LC20-20QBB at 192.168.1.100
**VFD:** AutomationDirect GS10 DURApulse on RS-485 Modbus RTU slave address 1

---

## Digital Inputs (24VDC sinking, all share COM0)

| Terminal | CCW Tag | Device | Contact Type | Function |
|----------|---------|--------|-------------|----------|
| I-00 | SelectorFWD | 3-pos selector | NO (closed in FWD) | Forward selected |
| I-01 | SelectorREV | 3-pos selector | NO (closed in REV) | Reverse selected |
| I-02 | EStopNC | E-stop | NC (opens when pressed) | 1 = healthy |
| I-03 | EStopNO | E-stop | NO (closes when pressed) | 1 = pressed |
| I-04 | PBRun | Illuminated momentary pushbutton | NO | Rising edge = run |
| I-05 | — | (spare) | — | Available |
| I-06 | — | (spare) | — | Available |
| I-07 | — | (spare) | — | Available |
| I-08 | — | (spare) | — | Available |
| I-09 | — | (spare) | — | Available |
| I-10 | — | (spare) | — | Available |
| I-11 | — | (spare) | — | Available |

---

## Digital Outputs (24VDC transistor sourcing)

### Group 0 (commons: +CM0 / -CM0)

| Terminal | CCW Tag | Device | Function |
|----------|---------|--------|----------|
| O-00 | LightGreen | Green 22mm pilot light | ON = motor running |
| O-01 | LightRed | Red 22mm pilot light | ON = fault or E-stop |
| O-02 | ContactorQ1 | Safety contactor coil | ON = 3-phase power to VFD |
| O-03 | PBRunLED | Sweideer RUN button LED | ON = motor running |

### Group 1 (commons: +CM1 / -CM1)

| Terminal | CCW Tag | Device | Function |
|----------|---------|--------|----------|
| O-04 | — | (spare) | Available |
| O-05 | — | (spare) | Available |
| O-06 | — | (spare) | Available |

---

## Physical Terminal Strips (silk-screen labels)

**Input strip:**
`Vref | -DC24 | I-00 | I-01 | I-02 | I-03 | COM0 | I-04 | I-05 | I-06 | I-07 | I-08 | I-09 | I-10 | I-11 | NU`

**Output strip:**
`+DC24 | -DC24 | -DC24 | V0-0 | NU | +CM0 | O-00 | O-01 | O-02 | O-03 | -CM0 | +CM1 | O-04 | O-05 | O-06 | -CM1`

**MAC:** `5C:88:16:D8:E4:D7`

---

*FactoryLM — Micro820 I/O Assignment Table*
