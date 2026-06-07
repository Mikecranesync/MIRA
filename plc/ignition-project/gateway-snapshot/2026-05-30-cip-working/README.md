# Gateway snapshot — CIP working state (2026-05-30)

Known-good Ignition gateway config captured **before** any Maker Edition activation,
while the live `ConvSimpleLive` view was confirmed rendering on the **Micro800 CIP**
driver. This is the git-side rollback for the Maker experiment (Option B).

## What's here (verbatim copies of the live gateway, 8.3.4)
- `device/MIRA_PLC-config.json` — the Micro800 device connection
  (`com.inductiveautomation.Micro800DeviceType`, host `192.168.1.100`).
  Lives on the gateway at:
  `data/config/resources/core/com.inductiveautomation.opcua/device/MIRA_PLC/config.json`
- `tags/MIRA_IOCheck/**` — the full default-provider tag tree (Inputs/Outputs/
  Diagnostics/VFD), addressing PLC globals **by name** via `[MIRA_PLC]`.
  Lives on the gateway at:
  `data/config/resources/core/ignition/tag-definition/default/MIRA_IOCheck/`

## Restore (if Maker disables Micro800 and we want CIP back)
1. Preferred: **restore the `.gwbk`** taken at the same time (gateway → Config →
   Backup/Restore → Restore). That also reverts the edition.
2. File-level fallback (gateway STOPPED, elevated): copy these folders back to the
   gateway paths above, then start the service. NOTE: the Micro800 **driver module**
   must still be present/enabled — Maker removes it during commissioning, so a pure
   file restore is not enough to undo a Maker activation; use the `.gwbk` for that.

## Why this exists
IA's 8.3 Maker compatibility table lists OPC-UA, Perspective, Allen-Bradley, Logix
and Modbus drivers as compatible, but **not** the standalone `Micro800 Driver`
module (`com.inductiveautomation.opcua.drivers.micro800`). Strong evidence it is
removed under Maker. Option A (post-verification) re-points these tags onto the
Maker-compatible **Modbus TCP** driver against the PLC's existing slave
(`192.168.1.100:502`).
