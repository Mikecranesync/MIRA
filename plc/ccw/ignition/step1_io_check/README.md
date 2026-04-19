# Ignition setup — Step 1 I/O Check

Ignition 8.3.4 Gateway is already installed and running on this laptop (service: `Ignition`, listening at `http://localhost:8088`). The Modbus Driver v2 and Micro800 Driver modules are both installed. A `ConveyorMIRA` Perspective project already exists.

All that's missing: a device pointing at the PLC, and tags bound to the coils.

## 1. Log in to the Gateway

Open `http://localhost:8088/` in your browser and sign in. (If you don't remember the admin password you set during commissioning, resetting it is covered in the troubleshooting section at the bottom.)

## 2. Add the Modbus TCP device

**Config → Devices → + Create New Device → Modbus TCP**. Fill in:

| Field | Value |
|---|---|
| Name | `MIRA_PLC` |
| Enabled | ✓ |
| Hostname | `192.168.1.100` |
| Port | `502` |
| **Reverse Word Order** | leave default (unchecked) |
| **One-based Addressing** | ✓ **(critical — Micro 820 is one-based)** |
| **Max Holding Registers Per Request** | `125` (default is fine) |
| **Zero-based Addressing** | unchecked |
| Timeout | `2000` ms (default) |

Save. The device status light should go **green** within a few seconds. If it goes yellow/red, skip to troubleshooting.

## 3. Import tags

**Config → OPC UA → Tags** (or just open the Designer and do it there):

- Right-click the tag provider (`default`) → **Import Tags**
- Select `ignition/step1_io_check/tags.json` from this repo
- Confirm

You now have `MIRA_IOCheck/Inputs/DI_00..11`, `MIRA_IOCheck/Outputs/DO_00..07`, `MIRA_IOCheck/Diagnostics/heartbeat`.

## 4. Verify

In the Designer, open the Tag Browser and watch:

- `heartbeat` should be flipping true/false at PLC scan speed.
- Press a physical input on the PLC (e-stop, button) — the corresponding `DI_*` tag should change.
- Right-click `Outputs/DO_00` → **Write...** → `true`. The green lamp on the PLC should light. Write `false` — it should go off.

If all three work, the Ignition ↔ PLC path is proven and you can start wiring tags to Perspective views.

## Troubleshooting

- **Device stays yellow/red**: usually means Modbus server isn't reachable. Test from this terminal: `python -c "import socket; socket.create_connection(('192.168.1.100',502),2)"`. Silent = OK. Error = PLC isn't listening (check the CCW project's Modbus TCP server is enabled).
- **Tags show `Bad_NotConnected`**: same root cause — device light is not green. Fix (2) first.
- **Tags show `Bad_Configuration`**: OPC item path doesn't match the device name. If you named the device something other than `MIRA_PLC`, either rename it or edit every tag's `opcItemPath`.
- **Writes to `DO_*` don't land**: the Micro 820 Modbus TCP server must have the coil marked writable in `MbSrvConf.xml`. The Step 1 PLC project (see `../../drive_test/step1_io_check/`) already does this.
- **Forgot the Gateway admin password**: run `"C:\Program Files\Inductive Automation\Ignition\gwcmd.bat" -p` from an elevated shell to reset.

## What this does NOT do

- No Perspective view is auto-built here. The existing `ConveyorMIRA` project has views wired to the old tag paths — rebinding them is out of scope for Step 1.
- No historian. No alarms. No UDTs. Add those once Step 2 (VFD control) is working.
