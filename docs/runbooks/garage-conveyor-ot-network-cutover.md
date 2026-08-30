# Garage Conveyor OT Network Cutover

## Goal

Move the Micro820 off the laptop direct Ethernet cable and onto a small isolated OT Ethernet switch.

This makes the laptop optional for engineering, instead of the normal runtime bridge.

## Hardware

- 1 unmanaged industrial Ethernet switch, 5-port is enough.
- Micro820 Ethernet cable to switch.
- Edge gateway/Ignition machine Ethernet cable to switch.
- Optional engineering laptop cable to switch only during maintenance.

## Static IPs

| Device | IP |
|---|---|
| Micro820 | `192.168.1.100/24` |
| Edge gateway / Ignition | `192.168.1.10/24` |
| Engineering laptop, temporary | `192.168.1.50/24` |

No default gateway is required on the PLC OT segment. Do not bridge this network to Wi-Fi, Tailscale, or the public internet.

## Before Cutover

Run on the current PLC laptop:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.1.*" }
Test-NetConnection 192.168.1.100 -Port 502
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8765,8088,502 }
```

Expected current bench state:

- Laptop Ethernet has `192.168.1.50/24`.
- Micro820 answers on `192.168.1.100:502`.
- Ignition listens locally on `8088`.
- Jarvis is not required and does not need to listen on `8765`.

## Cutover

1. Stop any direct Modbus pollers, Jarvis scripts, or Python live monitors.
2. Confirm conveyor stopped and safe.
3. Keep the Micro820 powered, but do not command motion.
4. Move the Micro820 Ethernet cable from laptop direct to the OT switch.
5. Connect edge gateway/Ignition OT NIC to the same switch.
6. Set edge gateway OT NIC to `192.168.1.10/24`.
7. Ping `192.168.1.100` from the edge gateway.
8. Test Modbus TCP port `502` from the edge gateway only.
9. Configure Ignition on the edge gateway to read the Micro820.
10. Keep the engineering laptop unplugged from the switch unless CCW maintenance is needed.

## Engineering Laptop Use After Cutover

When CCW is needed:

1. Plug the engineering laptop into the OT switch.
2. Set its Ethernet NIC to `192.168.1.50/24`.
3. Confirm `ping 192.168.1.100`.
4. Open CCW and connect to the Micro820.
5. Unplug the laptop when maintenance is complete.

## Rollback

1. Stop Ignition polling if it is producing unexpected behavior.
2. Unplug Micro820 from the OT switch.
3. Plug Micro820 directly back into the PLC laptop Ethernet port.
4. Set laptop Ethernet to `192.168.1.50/24`.
5. Confirm:

```powershell
ping 192.168.1.100
Test-NetConnection 192.168.1.100 -Port 502
```

## Done When

- Edge gateway or Ignition reads the PLC without Jarvis.
- The laptop can be disconnected and the telemetry path still works.
- Laptop direct Modbus scripts are not part of normal runtime.
- Any write/control testing remains disabled until PLC v4.2.0 and human acceptance are bench-verified.
