# Ignition Tags — Micro820 Conveyor System

**Ignition Gateway Device:** `Micro820_Conveyor`
**PLC IP:** 192.168.1.100 | **Port:** 502 | **Unit ID:** 1
**Tag Folder:** `Conveyor/`

---

## Boolean OPC Tags (bind to Modbus TCP Coil addresses)

| Tag Path | OPC Item Path | Description |
|----------|-------------|-------------|
| Conveyor/Motor_Running | [Micro820_Conveyor]C1 | Motor is running |
| Conveyor/Conveyor_Running | [Micro820_Conveyor]C2 | Conveyor at speed |
| Conveyor/Fault_Alarm | [Micro820_Conveyor]C3 | Fault latched |
| Conveyor/VFD_Comm_OK | [Micro820_Conveyor]C4 | Modbus RTU healthy |
| Conveyor/System_Ready | [Micro820_Conveyor]C5 | Ready to run |
| Conveyor/EStop_Active | [Micro820_Conveyor]C6 | E-stop pressed |
| Conveyor/Dir_FWD | [Micro820_Conveyor]C7 | Selector = FWD |
| Conveyor/Dir_REV | [Micro820_Conveyor]C8 | Selector = REV |
| Conveyor/Heartbeat | [Micro820_Conveyor]C9 | PLC scan heartbeat |
| Conveyor/EStop_Wiring_Fault | [Micro820_Conveyor]C10 | Dual-channel violation |
| Conveyor/Dir_Fault | [Micro820_Conveyor]C11 | Invalid selector state |
| Conveyor/Raw_I00 | [Micro820_Conveyor]C12 | Raw I-00 (SelectorFWD) |
| Conveyor/Raw_I01 | [Micro820_Conveyor]C13 | Raw I-01 (SelectorREV) |
| Conveyor/Raw_I02 | [Micro820_Conveyor]C14 | Raw I-02 (EStopNC) |
| Conveyor/Raw_I03 | [Micro820_Conveyor]C15 | Raw I-03 (EStopNO) |
| Conveyor/Raw_I04 | [Micro820_Conveyor]C16 | Raw I-04 (PBRun) |
| Conveyor/Raw_O00 | [Micro820_Conveyor]C17 | Raw O-00 (LightGreen) |
| Conveyor/Raw_O01 | [Micro820_Conveyor]C18 | Raw O-01 (LightRed) |
| Conveyor/Raw_O02 | [Micro820_Conveyor]C19 | Raw O-02 (ContactorQ1) |
| Conveyor/Raw_O03 | [Micro820_Conveyor]C20 | Raw O-03 (PBRunLED) |

---

## INT16 OPC Tags (bind to Modbus TCP Holding Register addresses)

| Tag Path | OPC Item Path | Description | Scale |
|----------|-------------|-------------|-------|
| Conveyor/VFD_OutputFreq_Raw | [Micro820_Conveyor]HR400107 | VFD output frequency | ÷10 = Hz |
| Conveyor/VFD_OutputCurrent_Raw | [Micro820_Conveyor]HR400108 | VFD output current | ÷10 = A |
| Conveyor/VFD_DCBusVoltage_Raw | [Micro820_Conveyor]HR400109 | VFD output voltage | ÷10 = V |
| Conveyor/VFD_DCBus_Raw | [Micro820_Conveyor]HR400110 | VFD DC bus voltage | ÷10 = V |
| Conveyor/VFD_FaultCode | [Micro820_Conveyor]HR400110 | VFD fault code | 0 = none |
| Conveyor/VFD_FreqSetpoint_Raw | [Micro820_Conveyor]HR400116 | Frequency setpoint | ÷10 = Hz |
| Conveyor/Conv_State | [Micro820_Conveyor]HR400114 | State machine | 0–4 |
| Conveyor/Error_Code | [Micro820_Conveyor]HR400106 | Error code | 0=none, 6=estop, 7=wiring |
| Conveyor/Item_Count | [Micro820_Conveyor]HR400111 | Exit sensor item count | count |
| Conveyor/Uptime_Seconds | [Micro820_Conveyor]HR400112 | PLC uptime | seconds |
| Conveyor/Speed_Cmd | [Micro820_Conveyor]HR400113 | Speed command (writable) | 0–4095 |

---

## Expression Tags (scaling — create as Expression Tag type)

| Tag Path | Expression | Units |
|----------|-----------|-------|
| Conveyor/VFD_Hz | `{Conveyor/VFD_OutputFreq_Raw} / 10.0` | Hz |
| Conveyor/VFD_Amps | `{Conveyor/VFD_OutputCurrent_Raw} / 10.0` | A |
| Conveyor/VFD_DCBus_V | `{Conveyor/VFD_DCBusVoltage_Raw} / 10.0` | V |
| Conveyor/VFD_Setpoint_Hz | `{Conveyor/VFD_FreqSetpoint_Raw} / 10.0` | Hz |

---

## Perspective Status Banner Expression

Bind to a label or container background color property:

```python
if({Conveyor/EStop_Active},
    color(220, 53, 69),          # Red — E-stop active
    if({Conveyor/Fault_Alarm},
        color(255, 165, 0),      # Orange — fault
        if({Conveyor/Motor_Running},
            color(40, 167, 69),  # Green — running
            color(108, 117, 125) # Gray — idle
        )
    )
)
```

| Color | Hex | Meaning |
|-------|-----|---------|
| Red | #DC3545 | E-stop active |
| Orange | #FFA500 | Fault alarm |
| Green | #28A745 | Motor running |
| Gray | #6C757D | Idle / stopped |

---

## Conv_State Lookup (for display labels)

| Value | State | Display Text | Color |
|-------|-------|-------------|-------|
| 0 | IDLE | Stopped | Gray |
| 1 | STARTING | Starting... | Yellow |
| 2 | RUNNING | Running | Green |
| 3 | STOPPING | Stopping... | Yellow |
| 4 | FAULT | FAULT | Red |

---

*FactoryLM — Ignition Tag Configuration*
