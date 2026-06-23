# Wiring / IO map — Modbus RTU register map (GS10 ↔ Micro820)

**Asset:** the wiring + IO/register map that ties the demo together — the Micro820 digital I/O and the
GS10 Modbus registers.

## The authoritative documents are IN THIS REPO

This is the one "asset" whose best document is the bench's own files, not a vendor PDF:

- **`plc/GS10_Integration_Guide.md`** — the complete wiring + comm map: RS-485 wiring, GS10 P09.xx comm
  params, the monitored/written register list (`vfd_freq_cmd`, `vfd_torque`, `vfd_motor_rpm`,
  `vfd_power`, DC-bus, fault/warn words), and the Micro820 serial config.
- **`plc/MbSrvConf_ConvSimple_v1.9.xml`** — the Modbus server config / register map deployed on the PLC
  (coils + holding registers, e.g. `DI_05` photoeye at coil 000023; the v1.9 map is the deployed superset
  that the v2.1 program reuses).
- **`plc/CCW_VARIABLES_ConvSimple_v2.1_DELTA.md`** — the CCW variable ↔ register mapping (the "address +1"
  off-by-one bench convention is documented here).
- **`plc/conv_simple_anomaly/`** — the slave map (`di05_photoeye` → DI_05, HR offsets) the anomaly engine reads.

## Vendor references that back the map

- **Modbus protocol:** the GS10 manual Ch.09 comms section (see `../vfd/gs10-user-manual.url`) +
  the Micro820 user manual's MSG/serial section (see `../plc/micro820-user-manual.url`).
- **Modbus spec (general):** `https://modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf`.

## Why it supports this asset

Every tag the diagnostic layer reads (photoeye on `DI_05`, the VFD HRs, the fault/warn words) is defined
by this map. It is the "IO map" the demo runs on — kept in-repo because it is bench-specific, not a
catalog part.
