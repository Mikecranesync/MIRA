# Modbus Register Map — Micro820 + GS10 VFD Conveyor System

**PLC:** Micro820 at 192.168.1.100, Modbus TCP port 502
**VFD:** GS10 DURApulse, RS-485 Modbus RTU slave address 1 (9600/8N2)

The PLC reads/writes the GS10 VFD over RS-485 RTU internally, then exposes all data via Modbus TCP for external clients (Ignition, Node-RED, MIRA).

---

## VFD Registers (GS10 RS-485 RTU — PLC ↔ VFD)

### Write Registers (Function Code 06 — single register write)

| Register (hex) | Register (dec) | Description | Values |
|----------------|----------------|-------------|--------|
| 0x2100 | HR8448 | VFD Command | 0x0001 = FWD run, 0x0002 = REV run, 0x0005 = stop, 0x0007 = fault reset |
| 0x2101 | HR8449 | Frequency Setpoint | 0–400 = 0.0–40.0 Hz (value ×10) |

### Read Registers (Function Code 03 — read holding registers)

| Register (hex) | Register (dec) | Description | Units | Scale |
|----------------|----------------|-------------|-------|-------|
| 0x2103 | HR8451 | Output Frequency | Hz | ÷10 |
| 0x2104 | HR8452 | Output Current | Amps | ÷10 |
| 0x2105 | HR8453 | DC Bus Voltage | Volts | ÷10 |
| 0x210F | HR8463 | Fault Code | — | 0 = no fault |

---

## Modbus TCP Coil Map (PLC → External Clients)

Boolean tags exposed via MbSrvConf.xml:

| Coil Address | PLC Variable | Description |
|-------------|-------------|-------------|
| C1 | motor_running | Motor is running (conv_state = 1 or 2) |
| C2 | conveyor_running | Conveyor at speed (conv_state = 2) |
| C3 | fault_alarm | Fault latched |
| C4 | vfd_comm_ok | Modbus RTU communication healthy |
| C5 | system_ready | No fault, no E-stop, running |
| C6 | e_stop_active | E-stop is pressed |
| C7 | dir_fwd | Selector in FWD position |
| C8 | dir_rev | Selector in REV position |
| C9 | heartbeat | Toggles every scan |
| C10 | estop_wiring_fault | E-stop dual-channel XOR violation |
| C11 | dir_fault | Both FWD + REV contacts closed |
| C12 | _IO_EM_DI_00 | Raw I-00 (SelectorFWD) |
| C13 | _IO_EM_DI_01 | Raw I-01 (SelectorREV) |
| C14 | _IO_EM_DI_02 | Raw I-02 (EStopNC) |
| C15 | _IO_EM_DI_03 | Raw I-03 (EStopNO) |
| C16 | _IO_EM_DI_04 | Raw I-04 (PBRun) |
| C17 | _IO_EM_DO_00 | Raw O-00 (LightGreen) |
| C18 | _IO_EM_DO_01 | Raw O-01 (LightRed) |
| C19 | _IO_EM_DO_02 | Raw O-02 (ContactorQ1) |
| C20 | _IO_EM_DO_03 | Raw O-03 (PBRunLED) |

---

## Modbus TCP Holding Register Map (PLC → External Clients)

INT tags exposed via MbSrvConf.xml:

| HR Address | PLC Variable | Description | Scale |
|-----------|-------------|-------------|-------|
| HR400101 | motor_speed | Motor speed command | raw |
| HR400102 | motor_current | Motor current (legacy) | raw |
| HR400103 | temperature | Temperature (spare) | raw |
| HR400104 | pressure | Pressure (spare) | raw |
| HR400105 | conveyor_speed | Conveyor speed (alias) | raw |
| HR400106 | error_code | Active error code | 0=none, 6=estop, 7=wiring, 8=dir, 9=vfd |
| HR400107 | vfd_frequency | VFD output frequency | ÷10 = Hz |
| HR400108 | vfd_current | VFD output current | ÷10 = Amps |
| HR400109 | vfd_voltage | VFD output voltage | ÷10 = Volts |
| HR400110 | vfd_dc_bus | VFD DC bus voltage | ÷10 = Volts |
| HR400111 | item_count | Items counted at exit sensor | count |
| HR400112 | uptime_seconds | PLC uptime | seconds |
| HR400113 | conveyor_speed_cmd | Speed command input (writable) | 0–4095 |
| HR400114 | conv_state | State machine | 0=idle, 1=starting, 2=running, 3=stopping, 4=fault |
| HR400115 | vfd_cmd_word | Current VFD command | 1=fwd, 2=rev, 5=stop |
| HR400116 | vfd_freq_setpoint | Current freq setpoint | ÷10 = Hz |

---

*FactoryLM — Modbus Register Map*
