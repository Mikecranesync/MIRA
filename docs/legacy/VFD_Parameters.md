# VFD Parameters — GS10 DURApulse Keypad Programming

**VFD:** AutomationDirect GS10 DURApulse
**Connection:** RS-485 Modbus RTU to Micro820 PLC serial port

> **Program these parameters at the VFD keypad BEFORE attempting Modbus communication.**
> Power cycle the VFD after changing communication parameters.

---

## Communication Parameters (P09.xx)

| Step | Parameter | Set To | Meaning |
|------|-----------|--------|---------|
| 1 | P09.00 | **1** | Modbus RTU protocol |
| 2 | P09.01 | **1** | Slave address = 1 |
| 3 | P09.02 | **3** | Baud rate = 9600 bps |
| 4 | P09.03 | **0** | Data format = 8N2 (8 data, no parity, 2 stop) |
| 5 | P09.04 | **0** | Response delay = 0 ms |

---

## Control Source Parameters (P00.xx)

| Step | Parameter | Set To | Meaning |
|------|-----------|--------|---------|
| 6 | P00.02 | **3** | Frequency source = RS-485 communication |
| 7 | P00.04 | **2** | Run command source = RS-485 communication |

---

## Motor Nameplate Parameters (P01.xx)

> Set these to match the physical motor nameplate exactly.

| Step | Parameter | Description | Set To |
|------|-----------|-------------|--------|
| 8 | P01.00 | Motor rated power (kW) | Read from nameplate |
| 9 | P01.01 | Motor rated voltage | 400V (or nameplate) |
| 10 | P01.02 | Motor rated current (A) | 10A (or nameplate) |
| 11 | P01.03 | Motor rated frequency | 60 Hz (US) |
| 12 | P01.04 | Motor rated RPM | Read from nameplate |

---

## RS-485 Wiring (PLC ↔ VFD)

```
  Micro820 Serial Terminal Block        GS10 RJ45 Port
  ┌──────────────────────┐              ┌─────────────┐
  │ Pin 1 (TXD+) ───────┼── wire ──────┤ Pin 3 (S+)  │  RS-485 A (+)
  │ Pin 2 (TXD-) ───────┼── wire ──────┤ Pin 4 (S-)  │  RS-485 B (-)
  │ Pin 5 (COM)  ───────┼── wire ──────┤ Pin 5 (SG)  │  Signal Ground
  │ Pin 6 (SHD)  ───────┼── shield ────┤ Shell/GND   │  Optional
  └──────────────────────┘              └─────────────┘
```

- Use shielded twisted pair (Cat5e STP works)
- If cable run > 30 ft: install **120Ω termination resistor** across S+ and S- at the VFD end
- Route RS-485 cable **away** from VFD output power cables (separate conduit)

---

## Micro820 Serial Port Settings (in CCW)

| Setting | Value |
|---------|-------|
| Protocol | Modbus RTU Master |
| Baud Rate | 9600 |
| Data Bits | 8 |
| Parity | None |
| Stop Bits | 2 |

---

## Troubleshooting

| Symptom | Most Likely Cause | Fix |
|---------|------------------|-----|
| No Modbus response | A/B polarity swapped | Swap S+ and S- at PLC terminal block |
| CRC errors | Baud mismatch | Verify both sides: 9600/8N2 |
| Timeout errors | Wrong slave address | VFD P09.01 must = PLC target node (both = 1) |
| VFD ignores commands | P00.04 not set | Set P00.04 = 2 (RS-485 run source) |
| Intermittent comms | EMI from power cables | Reroute RS-485 away from VFD output cables |

---

*FactoryLM — GS10 VFD Parameter Guide*
