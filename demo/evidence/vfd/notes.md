# VFD — AutomationDirect DURApulse GS10

**Asset:** the variable-frequency drive that runs the conveyor motor in the Conv_Simple bench.
**Identity (confirmed in repo):** AutomationDirect **DURApulse GS10**, Modbus RTU over RS-485 to the
Micro820 (`plc/GS10_Integration_Guide.md`).

## Documents

- **`gs10-user-manual.url`** → the official GS10 (GS10M) user manual PDF
  `https://cdn.automationdirect.com/static/manuals/gs10m/gs10m.pdf`
  (this exact URL is the one the bench KB already cites). Covers wiring, P00–P09 parameters,
  keypad, Modbus comms, and operation.
- **`gs10-fault-codes-ch06.url`** → Chapter 6 (fault & warning codes) PDF
  `https://cdn.automationdirect.com/static/manuals/gs10m/ch06.pdf` — the fault-code table the
  anomaly engine decodes (E07, CE/CF comm faults, etc.).
- Product page: `https://www.automationdirect.com/adc/shopping/catalog/drives/gs10_drives`

## Why it supports this asset

The bench's GS10 comm setup (P09.00 addr=1, P09.01 9600 baud, P09.04=13 → 8N2 RTU, P09.02=0 warn,
P09.03=5 s timeout) and the monitored registers (`vfd_freq_cmd`, `vfd_torque`, `vfd_motor_rpm`,
`vfd_power`, DC-bus, fault/warn words) all come straight from this manual. The fault-code chapter is
the reference MIRA grounds GS10 fault explanations against.

> Note: the repo also contains a **GS11** comparison surface (`feat/gs11-grounding-test-surface`), but
> the **deployed** Conv_Simple drive is the **GS10** (the integration guide header + the only VFD
> manual cited). GS11 is a sibling, not this demo's asset.
