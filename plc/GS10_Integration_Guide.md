# GS10 DURApulse + Micro820 Complete Integration Guide

**VFD:** AutomationDirect GS10 DURApulse
**PLC:** Allen-Bradley Micro820 2080-LC20-20QBB
**Protocol:** Modbus RTU over RS-485
**Last Updated:** 2026-03-16

---

## 1. VFD Keypad Parameters — Complete Table

> Set these on the GS10 keypad. Power cycle the VFD after changing P09.xx params.

### Communication Parameters (P09.xx)

| Param | Name | Range | Factory Default | Set To | Notes |
|-------|------|-------|-----------------|--------|-------|
| P09.00 | Communication Address | 1-254 | 1 | **1** | Must match PLC MSG Node=1 |
| P09.01 | Baud Rate | 48/96/192/384 | 384 (38.4K) | **96** | 96 = 9600 baud. Must match PLC serial port |
| P09.02 | Comm Fault Treatment | 0-3 | 3 | **0** | 0=Warn+continue. Prevents F30 lockout on comm gaps |
| P09.03 | Timeout Detection | 0.0-100.0 sec | 0.0 (disabled) | **5.0** | 5 sec. Detects dead master, prevents false trips |
| P09.04 | Communication Protocol | 12-17 | 13 | **13** | 13 = 8 data, No parity, 2 stop bits, RTU mode |
| P09.09 | Response Delay | 0-2000 ms | 20 | **20** | Leave default. Increase if CRC errors |
| P09.10 | Comm Main Frequency | 0.0-599.0 Hz | 60.0 | (leave) | Only used when freq source = serial |
| P09.31 | Internal Comm Protocol | 0 | 0 | **0** | 0 = Modbus 485 |

**P09.04 Protocol Options:**

| Value | Format | Use When |
|-------|--------|----------|
| 12 | 8, N, 1, RTU | PLC set to 8N1 |
| **13** | **8, N, 2, RTU** | **PLC set to 8N2 (Micro820 default)** |
| 14 | 8, E, 1, RTU | PLC set to 8E1 |
| 15 | 8, O, 1, RTU | PLC set to 8O1 |
| 16 | 8, E, 2, RTU | PLC set to 8E2 |
| 17 | 8, O, 2, RTU | PLC set to 8O2 |

**P09.02 Fault Treatment Options:**

| Value | Action on Comm Loss | Recommended |
|-------|-------------------|-------------|
| **0** | **Warn and continue running** | **Use this for commissioning** |
| 1 | Fault and ramp to stop | Use in production |
| 2 | Fault and coast to stop | Use for safety-critical |
| 3 | No warning, no fault, continue | Factory default — not recommended |

### Control Source Parameters (P00.xx)

| Param | Name | Range | Factory Default | Set To | Notes |
|-------|------|-------|-----------------|--------|-------|
| P00.20 | Freq Command Source | 0-9 | 0 (keypad) | (leave) | Not needed if freq set via 0x2001 register |
| P00.21 | Run Command Source | 0-2 | 0 (keypad) | **2** | 2 = RS-485 Modbus. Allows PLC to start/stop motor |

**P00.21 Options:**

| Value | Source | Use When |
|-------|--------|----------|
| 0 | Keypad | Manual operation only |
| 1 | External terminals (DI1/DI2) | Hardwired start/stop |
| **2** | **RS-485 Modbus** | **PLC controls motor via serial** |

### Motor Nameplate Parameters (P01.xx)

| Param | Name | Set To |
|-------|------|--------|
| P01.00 | Rated Power (kW) | Read from motor nameplate |
| P01.01 | Rated Voltage (V) | Read from motor nameplate (230 or 460) |
| P01.02 | Rated Current (A) | Read from motor nameplate |
| P01.03 | Rated Frequency (Hz) | 60 (North America) |
| P01.04 | Rated RPM | Read from motor nameplate |

---

## 2. Modbus Register Map — GS10 DURApulse

### Command Registers (WRITE — Function Code 06)

| Hex Addr | Dec Addr | Name | Format | Values |
|----------|----------|------|--------|--------|
| **0x2000** | **8192** | Control Command | Bit field | See bit table below |
| **0x2001** | **8193** | Frequency Setpoint | Unsigned 16-bit | 0-4000 = 0.0-400.0 Hz (value / 10) |
| **0x2002** | **8194** | Control Code 2 | Bit field | Bit 1 = Fault Reset |

**Control Command (0x2000) Bit Field:**

| Bits | Value | Meaning |
|------|-------|---------|
| 0-1 | 00 | No function |
| 0-1 | **01** | **STOP** |
| 0-1 | **10** | **RUN** |
| 0-1 | 11 | JOG + RUN |
| 3-4 | 00 | No function |
| 3-4 | **01** | **FWD direction** |
| 3-4 | **10** | **REV direction** |
| 3-4 | 11 | Change direction |
| 5-6 | 00-11 | Accel/decel set selection (1st-4th) |
| 8-11 | 0000-1111 | Speed selection (0=master, 1-15=multi-speed) |

**Common Command Words:**

| Command | Hex | Decimal | Bits Set |
|---------|-----|---------|----------|
| **FWD + RUN** | 0x0012 | **18** | Run(bit1) + FWD(bit3) |
| **REV + RUN** | 0x0014 | **20** | Run(bit1) + REV(bit4) |
| **STOP** | 0x0001 | **1** | Stop(bit0) |
| **Fault Reset** | Write 0x0002 to reg 0x2002 | | Reset(bit1) on Control Code 2 |

### Status Registers (READ — Function Code 03)

| Hex Addr | Dec Addr | Name | Scale | Notes |
|----------|----------|------|-------|-------|
| 0x2100 | 8448 | Status Monitor 1 | | High byte=warning, Low byte=error code |
| 0x2101 | 8449 | Status Monitor 2 | | Operation status bits |
| 0x2102 | 8450 | Frequency Command | Hz x10 | What PLC commanded |
| **0x2103** | **8451** | **Output Frequency** | **Hz x10** | Actual motor frequency |
| **0x2104** | **8452** | **Output Current** | **A x10** | Motor amps |
| **0x2105** | **8453** | **DC Bus Voltage** | **V** | ~300-340V when powered |
| **0x2106** | **8454** | **Output Voltage** | **V** | Motor voltage |
| 0x2107 | 8455 | Multi-step Speed Sel | | Current speed step |
| 0x210A | 8458 | Power Factor Angle | | |
| 0x210B | 8459 | Output Torque | % | Motor torque percentage |
| 0x210C | 8460 | Motor Speed | RPM | Actual shaft speed |
| 0x210F | 8463 | Power Output | kW | |

### Parameter Access (READ/WRITE — addresses derived from parameter number)

| Parameter | Hex Addr | Dec Addr | Example |
|-----------|----------|----------|---------|
| P00.00 | 0x0000 | 40001 | |
| P09.00 | 0x0900 | 42305 | Comm address |
| P09.01 | 0x0901 | 42306 | Baud rate |
| P09.04 | 0x0904 | 42309 | Protocol |

Formula: Address = (Group x 256) + Parameter. Example: P09.04 = (9 x 256) + 4 = 0x0904

---

## 3. RS-485 Wiring

### GS10 VFD — RJ45 Jack Pinout

```
RJ45 Pin    Signal          Wire Color (T568B)
────────    ──────────      ─────────────────
Pin 1       Reserved        -
Pin 2       Reserved        -
Pin 3       SGND            Blue/White
Pin 4       SG- (B/neg)     Blue
Pin 5       SG+ (A/pos)     Green/White
Pin 6       Reserved        -
Pin 7       SGND            Brown/White
Pin 8       +10V (keypad)   -
```

### Micro820 PLC — Embedded Serial Terminal Block

```
Terminal    Signal
────────    ──────────
D+          RS-485 A (positive)
D-          RS-485 B (negative)
G           Signal Ground
```

### Cable Connection

```
Micro820 PLC              GS10 VFD (RJ45)
──────────────            ────────────────
D+  (A/positive) ──────── Pin 5  SG+ (A/positive)
D-  (B/negative) ──────── Pin 4  SG- (B/negative)
G   (ground)     ──────── Pin 3  SGND (ground)
```

- Use shielded twisted pair (Cat5e STP works)
- If > 30 ft: add 120 ohm termination resistor across SG+ and SG- at VFD end
- Route RS-485 cable in separate conduit from VFD output power cables

---

## 4. PLC Serial Port Configuration (CCW)

In CCW: Micro820 tab > Controller > Serial Port

| Setting | Value |
|---------|-------|
| Driver | Modbus RTU |
| Baud Rate | 9600 |
| Parity | None |
| Modbus Role | Master |
| Media | RS485 |
| Control Line | No Handshake |
| Data Bits | 8 |
| Stop Bits | 2 |

---

## 5. ST Code — MSG Block Configuration

```
(* Read VFD status: 4 registers starting at 0x2103 *)
read_local_cfg.Channel := 2;       (* Embedded RS-485 *)
read_local_cfg.Cmd := 3;           (* FC03 = Read Holding Registers *)
read_local_cfg.ElementCnt := 4;    (* 4 registers *)
read_target_cfg.Addr := 8451;      (* 0x2103 = Output Frequency *)
read_target_cfg.Node := 1;         (* VFD slave address *)

(* Write VFD command: 1 register at 0x2000 *)
write_cmd_local_cfg.Channel := 2;
write_cmd_local_cfg.Cmd := 6;      (* FC06 = Write Single Register *)
write_cmd_local_cfg.ElementCnt := 1;
write_cmd_target_cfg.Addr := 8192; (* 0x2000 = Control Command *)
write_cmd_target_cfg.Node := 1;

(* Write VFD frequency: 1 register at 0x2001 *)
write_freq_local_cfg.Channel := 2;
write_freq_local_cfg.Cmd := 6;
write_freq_local_cfg.ElementCnt := 1;
write_freq_target_cfg.Addr := 8193; (* 0x2001 = Frequency Setpoint *)
write_freq_target_cfg.Node := 1;
```

**Command values in state machine:**
```
FWD run:  vfd_cmd_word := 18;   (* 0x0012 = Run + FWD *)
REV run:  vfd_cmd_word := 20;   (* 0x0014 = Run + REV *)
STOP:     vfd_cmd_word := 1;    (* 0x0001 = Stop *)
```

---

## 6. Fault Codes

| Error Code | Display | Name | Cause | Fix |
|------------|---------|------|-------|-----|
| 0 | - | No error | - | - |
| 4 | GFF | Ground Fault | Motor/cable short | Check motor wiring |
| 12 | Lvd | Low Voltage Decel | DC bus drop during decel | Check power supply |
| 21 | oL | Overload | Motor overloaded | Reduce load or check motor |
| 49 | EF | External Fault | External fault input active | Check external fault wiring |
| 54 | CE1 | Command Error | Invalid Modbus command | Check function code |
| 55 | CE2 | Address Error | Register out of range | Check register address |
| 56 | CE3 | Data Error | Value out of range | Check data value |
| 57 | CE4 | Slave Error | Internal slave error | Power cycle VFD |
| **58** | **CE10** | **Comm Timeout** | **No Modbus packets received** | **Check baud rate, wiring, P09.03** |
| F30.x | F30 | Comm Fault Latch | Comm loss detected x times | Press STOP/RESET on keypad |

**To clear a fault:**
1. Press **STOP/RESET** key on VFD keypad
2. Or via Modbus: write value **2** to register **8194** (0x2002)
3. If fault won't clear: power cycle the VFD

---

## 7. Commissioning Checklist

### Phase 1: VFD Keypad Programming
- [ ] P09.00 = 1 (comm address)
- [ ] P09.01 = 96 (9600 baud)
- [ ] P09.02 = 0 (warn on comm loss)
- [ ] P09.03 = 5 (5 sec timeout)
- [ ] P09.04 = 13 (8N2 RTU)
- [ ] P00.21 = 2 (run source = RS-485)
- [ ] P01.00-P01.04 set to motor nameplate values
- [ ] Power cycle VFD after param changes

### Phase 2: PLC Program
- [ ] ST code: write_cmd address = 8192 (not 8448)
- [ ] ST code: write_freq address = 8193 (not 8449)
- [ ] ST code: FWD cmd = 18, REV cmd = 20, STOP cmd = 1
- [ ] Build (0 errors)
- [ ] Download to PLC
- [ ] Switch PLC to Run mode

### Phase 3: Verify Communications
- [ ] Run `python plc/live_monitor.py`
- [ ] vfd_comm_ok = TRUE
- [ ] DC Bus voltage > 0 (proves read working)
- [ ] Press STOP/RESET on VFD if F30 fault showing

### Phase 4: First Motor Run
- [ ] Selector to FWD
- [ ] Press RUN button
- [ ] conv_state goes 0 → 1 → 2
- [ ] Green light ON, motor spins
- [ ] VFD display shows frequency
- [ ] Selector to OFF → motor stops (conv_state 2 → 3 → 0)

### Phase 5: Safety Tests
- [ ] Press E-stop during run → motor stops, contactor drops
- [ ] Selector REV + RUN → motor runs reverse
- [ ] Direction change while running → fault state

---

## 8. What Was Wrong (Root Cause Analysis)

The original VFD_Parameters.md was written for the **GS1** drive series. The **GS10 DURApulse** has different parameter numbering:

| What | GS1 (old/wrong) | GS10 (correct) |
|------|-----------------|-----------------|
| Baud rate | P09.01 = enum (1=9600) | P09.01 = baud/100 (96=9600) |
| Protocol | P09.02 = enum | P09.04 = enum (13=8N2 RTU) |
| Fault treatment | P09.03 | P09.02 |
| Timeout | N/A | P09.03 |
| Freq source | P00.02 | P00.20 |
| Run source | P00.04 | P00.21 |
| Command register | 0x2100 (8448) | **0x2000 (8192)** |
| Freq setpoint reg | 0x2101 (8449) | **0x2001 (8193)** |
| Command format | Simple (1=FWD, 2=REV, 5=STOP) | Bit field (18=FWD+RUN, 20=REV+RUN, 1=STOP) |
