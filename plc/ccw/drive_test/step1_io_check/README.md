# Step 1 — I/O check

Absolute minimum project. Purpose: prove the 2080-LC20-20QBB's physical I/O is correctly wired and that Ignition can see inputs change and toggle outputs over Modbus TCP. Nothing else.

**Nothing touches the VFD in this step.** The RS-485 port stays silent. All we do is read the 12 embedded DIs and let Modbus write the 8 embedded DOs.

## Before you download

Downloading this project **overwrites the production conveyor program** currently on the PLC. Back it up first:
- In CCW, with the production project open: `File → Save As → MIRA_PLC_production_backup.ccwarc`
- Or copy the repo folder: `cp -r Controller Controller.backup_2026-04-17`

## Build it

1. **File → New Project** → `2080-LC20-20QBB` → name `MIRA_IO_Check`.
2. **Controller Properties → Ethernet**: IP `192.168.1.100`, mask `255.255.255.0`, gateway blank, auto-negotiate on, DHCP/BootP OFF.
3. **Controller Properties → Modbus TCP server**: enabled, port `502`.
4. **Do NOT configure Channel 0 / Serial Port.** Leave it disabled.
5. Add a **Structured Text** program named `PROG_IO`. Paste `Prog_io_check.stf`.
6. Open **Global Variables**. Add only `heartbeat : BOOL`.
7. Open **Device Toolbox → Modbus Mapping**. Add every row in `modbus_coils.md`. All the `_IO_EM_*` variables are already declared by CCW — you're only mapping them to coil addresses.
8. Build, Download, Run.

## Verify it

From this laptop (Ethernet is already on `192.168.1.50/24`, same subnet as PLC):

```powershell
python -m pip install pymodbus==3.6.9
```

Liveness — the program scans, `heartbeat` flips every scan:

```powershell
python -c "from pymodbus.client import ModbusTcpClient; c=ModbusTcpClient('192.168.1.100'); c.connect(); print([c.read_coils(99,1).bits[0] for _ in range(5)]); c.close()"
# expect alternating True/False
```

Inputs — read all 12 DIs, press the e-stop / run button / selector, re-read, observe bits change:

```powershell
python -c "from pymodbus.client import ModbusTcpClient; c=ModbusTcpClient('192.168.1.100'); c.connect(); print(c.read_coils(0,12).bits[:12]); c.close()"
```

Outputs — turn each lamp on for 1 s, off, confirm physically:

```powershell
python - <<'PY'
from pymodbus.client import ModbusTcpClient
import time
c = ModbusTcpClient('192.168.1.100'); c.connect()
for coil in range(12, 16):                # DO_00..DO_03
    print(f"writing True  to coil {coil+1}"); c.write_coil(coil, True);  time.sleep(1)
    print(f"writing False to coil {coil+1}"); c.write_coil(coil, False); time.sleep(0.3)
c.close()
PY
```

If all three tests pass, Step 1 is complete. The next step (Step 2, not yet built) layers in VFD Modbus RTU over Channel 0. We won't touch Channel 0 until Step 1 is solid.

## Troubleshooting

- **No response on port 502**: Modbus TCP server not enabled on Controller Properties, or firewall — confirm with `python -c "import socket; print(socket.create_connection(('192.168.1.100',502),2))"`.
- **Heartbeat never flips**: program not running. Check Controller Status in CCW — it should say `Run`, not `Program` or `Fault`.
- **Input bits never change when you press buttons**: physical wiring issue, not a software issue. Double-check with a multimeter that the input terminal is pulled to 24 V by the contact.
- **Output toggles but lamp doesn't light**: external wiring or power. Check L.E.D. on the PLC module itself — if the on-board LED changes but the lamp doesn't, it's in the field wiring.
