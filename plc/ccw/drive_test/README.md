# MIRA drive test — incremental build

Goal: the smallest possible path from a blank Micro 820 project to an Ignition module toggling the AutomationDirect drive and watching it run. Each step is a separately deployable project. You do not move on until the previous one works.

## Steps

| Step | Folder | What it proves |
|---|---|---|
| 1 | [`step1_io_check/`](./step1_io_check/) | Physical DIs read through Modbus TCP, physical DOs write through Modbus TCP, PLC is scanning. **No VFD, no serial port, no logic.** |
| 2 | [`step2_vfd_control/`](./step2_vfd_control/) | A single writable coil starts/stops the GS10 VFD over RS-485; `motor_running` feedback coil goes true when it's spinning. |

Keep the production project (`../Controller/` and `../MIRA/`) backed up before downloading any of these — a download overwrites what's on the PLC.

## Current status (as of 2026-04-17)

- PLC is online at `192.168.1.100`. CCW connects.
- **Production** `Prog2.stf` v5.0.2 is what's currently flashed. 22 read-only status coils, zero writable command coils, full conveyor state machine.
- **Step 1** files exist (this commit). Not yet deployed to the PLC.
- **Step 2** files exist (drafted earlier). Not yet deployed. Will be simplified again once Step 1 is known-good.
