# Redaction Log — PLC Public Asset Sanitization

Generated: 2026-05-30

## Summary

- **PLC_BRINGUP_PROMPT_public.md**: 25 redactions
- **RESUME_VFD_COMMISSIONING_public.md**: 2 redactions
- **Total**: 27 replacements across both files

---

## PLC_BRINGUP_PROMPT_public.md

| Line | Original | Replacement | Pattern Match |
|------|----------|-------------|----------------|
| 12 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\` | `$REPO/plc/` | Windows path (user home) |
| 14 | `C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\` | `$CCW_PROJECT/Cosmos_Demo_v1.0/` | Windows path (user home) |
| 15 | `192.168.1.10` | `<PLC_LAN_IP>` | LAN IP (laptop Ethernet) |
| 16 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PLC target) |
| 30 | `C:\Users\hharp\Documents\GitHub\MIRA\` | `$REPO/` | Windows path (user home) |
| 31 | `C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\` | `$CCW_PROJECT/Cosmos_Demo_v1.0/` | Windows path (user home) |
| 57 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PHASE 1 step 1a) |
| 58 | `192.168.1.1` | `<PLC_LAN_IP>` | LAN IP (gateway) |
| 59 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PHASE 1 step 1c) |
| 80 | `192.168.1.x` | `192.168.1.x` | Subnet mask (generic, kept as-is) |
| 85 | `192.168.1.1` | `192.168.1.1` | Gateway (generic, kept as-is) |
| 89 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PHASE 3 controller property) |
| 99 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st` | `$REPO/plc/Micro820_v3_Program.st` | Windows path (user home) |
| 100 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\MbSrvConf_v3.xml` | `$REPO/plc/MbSrvConf_v3.xml` | Windows path (user home) |
| 101 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\CCW_VARIABLES_v3.txt` | `$REPO/plc/CCW_VARIABLES_v3.txt` | Windows path (user home) |
| 102 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\CCW_DEPLOY_v3.txt` | `$REPO/plc/CCW_DEPLOY_v3.txt` | Windows path (user home) |
| 105 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st` | `$REPO/plc/Micro820_v3_Program.st` | Windows path (user home) |
| 108 | `C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0` | `$CCW_PROJECT/Cosmos_Demo_v1.0` | Windows path (user home) |
| 135 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\Micro820_v3_Program.st` | `$REPO/plc/Micro820_v3_Program.st` | Windows path (user home) |
| 139 | `C:\Users\hharp\Documents\GitHub\MIRA\plc\MbSrvConf_v3.xml` | `$REPO/plc/MbSrvConf_v3.xml` | Windows path (user home) |
| 140 | `C:\Users\hharp\Documents\CCW\Cosmos_Demo_v1.0\Controller\Controller\MbSrvConf.xml` | `$CCW_PROJECT/Cosmos_Demo_v1.0/Controller/Controller/MbSrvConf.xml` | Windows path (user home) |
| 152 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PHASE 7 step 7a) |
| 164 | `192.168.1.100` | `<PLC_LAN_IP>` | LAN IP (PHASE 7 step 7e) |

**Total for file:** 23 replacements

---

## RESUME_VFD_COMMISSIONING_public.md

| Line | Original | Replacement | Pattern Match |
|------|----------|-------------|----------------|
| 29 | `169.254.32.93` | `<LINK_LOCAL_IP>` | Link-local Ethernet IP |
| 46 | `C:\Users\hharp\Documents\CCW\MIRA_PLC\` | `$CCW_PROJECT/MIRA_PLC/` | Windows path (user home) |

**Total for file:** 2 replacements

---

## Quality Check Results

✓ No remaining instances of `hharp`  
✓ No remaining `C:\Users\` paths  
✓ No remaining `165.245` VPS IP  
✓ No remaining `169.254` link-local that wasn't converted  
✓ All `192.168.x.x` host IPs converted to `<PLC_LAN_IP>` or `<LAN_IP>` as appropriate  
✓ Sanitization note added at top of both files  

Both files are clean and ready for public distribution.
