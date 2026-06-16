---
title: PLC Laptop
type: node
updated: 2026-04-08
tags: [plc, ccw, rockwell, factory-io]
---

# PLC Laptop (LAPTOP-0KA3C70H)

**Tailscale IP:** 100.72.2.99
**SSH:** `ssh hharp@100.72.2.99` (defaults to PowerShell — use `cmd /c "..."` for cmd syntax)
**Ethernet IP:** 192.168.1.10/24 (static, factory LAN via Netgear SG605)
**WiFi IP:** 192.168.4.103 (Eero mesh, house network)

## Software

| Tool | Path |
|------|------|
| CCW | `C:\Program Files (x86)\Rockwell Automation\CCW\CCW.Shell.exe` |
| RSLinx | `C:\Program Files (x86)\Rockwell Software\RSLinx\` |
| MIRA repo | `C:\Users\hharp\Documents\GitHub\MIRA\` |

## CCW Projects

- **Active:** `C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\` — v3.1 program loaded
- 8 legacy projects (FactoryLM_PLC, FactoryLM_VFD_Final, Demov1, etc.)

## PLC Program Files (SCP'd 2026-03-15)

| File | Content |
|------|---------|
| `Cosmos_Demo_v1.0/Controller/.../Prog2.stf` | v3.1 structured text program |
| `Cosmos_Demo_v1.0/Controller/.../MbSrvConf.xml` | Modbus TCP mapping with DO_03 |
| `Documents/CCW_VARIABLES_v3.txt` | Variable reference |
| `Documents/CCW_DEPLOY_v3.txt` | Deploy instructions |

## Quirks

- **PowerShell over SSH:** Use PowerShell cmdlets, not bash
- **Test-Connection:** Does NOT support `-TimeoutSeconds` (older PS version)
- **gh auth:** Re-authenticated 2026-03-15 (was expired)

## Known Issues

- **PLC at 192.168.1.100 unreachable** — needs physical check (power/switch/cable). Both this laptop and [[nodes/bravo]] are on the same 192.168.1.x subnet.
