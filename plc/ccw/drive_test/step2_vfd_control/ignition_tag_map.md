# Ignition Tag Map — drive_test

Tag structure for the Ignition module monitoring this PLC. Assumes a Modbus TCP device configured at `192.168.1.100:502` with default one-based addressing.

```
[MIRA]
└── DriveTest
    ├── Command
    │   └── run            (Bool, R/W)     [1]C100      ← writes coil 100
    ├── Feedback
    │   ├── motor_running  (Bool, R)       [1]C1
    │   ├── vfd_comm_ok    (Bool, R)       [1]C2
    │   ├── system_ready   (Bool, R)       [1]C3
    │   ├── e_stop_active  (Bool, R)       [1]C4
    │   ├── estop_wiring_fault (Bool, R)   [1]C5
    │   └── heartbeat      (Bool, R)       [1]C9
    ├── Telemetry
    │   ├── frequency_dHz  (Int16, R)      [1]HR1       ← Hz × 10
    │   ├── current_dA     (Int16, R)      [1]HR2
    │   ├── dc_bus_V       (Int16, R)      [1]HR3
    │   ├── voltage_dV     (Int16, R)      [1]HR4
    │   └── cmd_word       (Int16, R)      [1]HR5
    └── Diagnostics
        ├── poll_count     (Int32, R)      [1]HR10      ← uses HR10+HR11 pair
        ├── err_count      (Int32, R)      [1]HR12
        └── uptime_s       (Int32, R)      [1]HR14
```

## Derived/expression tags worth adding

| Tag name | Expression | Purpose |
|---|---|---|
| `frequency_Hz` | `{frequency_dHz} / 10` | Human-readable Hz. |
| `current_A` | `{current_dA} / 10` | Human-readable amps. |
| `voltage_V` | `{voltage_dV} / 10` | Human-readable volts. |
| `plc_alive` | `toggled({heartbeat}, 5000)` | Alarm if no heartbeat change for 5s. |
| `ok_to_run` | `{vfd_comm_ok} && !{e_stop_active} && !{estop_wiring_fault}` | HMI button enable. |

## Safety UX rules

- Disable the HMI Run button when `ok_to_run` is false.
- Always drive `Command/run` from a momentary/maintained HMI widget that writes `True` to start and `False` to stop — never issue pulses, the PLC already maintains state.
- Show `e_stop_active`, `estop_wiring_fault` prominently. If either is true, display a red banner and suppress any animation that suggests motion.
- Put a "VFD comm lost" banner bound to `!{vfd_comm_ok}` — this catches RS-485 cable disconnects from the drive.

## Testing the tag map with no Ignition

Bring up a quick read/write test from this laptop:

```powershell
python -m pip install pymodbus
python -c @'
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient('192.168.1.100'); c.connect()
print('heartbeat coil 9 =', c.read_coils(8, 1).bits[0])
print('freq HR1 =', c.read_holding_registers(0, 1).registers[0])
c.write_coil(99, True)   # start
import time; time.sleep(3)
c.write_coil(99, False)  # stop
c.close()
'@
```
