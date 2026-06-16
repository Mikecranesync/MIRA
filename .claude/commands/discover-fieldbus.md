---
description: Read-only scan for industrial field devices (PLC/VFD/sensors) on the network + RS-485, identified against device-profiles.
---

Run the read-only fieldbus discovery tool and report what's on the network/bus.

**This is strictly read-only** (`.claude/rules/fieldbus-readonly.md`) — scan, identify,
read. Never write, set IPs, or send commands. For the full knowledge + flags, the
`fieldbus-discovery` skill is the reference.

## Steps

1. Decide targets from the user's args (`$ARGUMENTS`):
   - A CIDR like `192.168.1.0/24` → `--subnet`.
   - A single IP → `--host`.
   - A serial port (`COM3`, `/dev/tty.usbserial-*`) → `--serial`. **RS-485 is
     single-master**: only sweep a bus whose PLC master is offline (or this adapter is
     the sole master) — otherwise it can fault-stop the cell. The tool requires
     `--serial-bus-idle` to proceed; confirm with the user before passing it.
   - Nothing → auto-detect the subnet from local interfaces.

2. Show the plan first (no surprises on a live plant):
   ```bash
   python plc/discover.py <targets> --dry-run
   ```

3. Run the real scan:
   ```bash
   python plc/discover.py <targets> --json inventory.json
   ```
   Add `--deep-only` to limit to Modbus/TCP + EtherNet/IP, `--thorough` to widen the
   serial address sweep to 1-247, `--gentle` for fragile/old networks.

4. Report the `rich` table and summarize `inventory.json`:
   - Devices identified (with profile), protocol-confirmed, and merely port-open.
   - For any **unknown** that speaks a protocol but matched no profile, offer to add a
     `device-profiles/<id>.yaml` (the way to teach the system a new device).
   - Surface each identified device's `next_actions` (the profile gotchas) if the user
     is commissioning.

## Notes

- Deps are already in the repo (`pymodbus`, `rich`, PyYAML). No nmap binary needed.
- If a Micro820 answers TCP 502 but every read fails (exception 1), the Modbus map isn't
  deployed — point the user at `python plc/deploy_modbus_map.py --auto`.
- `inventory.json` is resume-shaped for the future commissioning loop and carries a
  `uns_hint` per device for MIRA onboarding.
