# Air System 01 — Fault Code Table

**Asset ID:** `airsystem01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.airsystem01`

| Code | Label | Severity | Description | Likely Cause | Recommended Action |
|------|-------|----------|-------------|-------------|-------------------|
| AS001 | Low Header Pressure | CRITICAL | `header_pressure_psi` < 75 PSI; `low_air_alarm` = TRUE. Multi-machine impact: depalletizer vacuum, filler bowl, capper chute, and case packer cylinders all affected. | Compressor offline, major distribution leak, demand surge (CIP simultaneous), isolation valve partially closed. | Check `compressor_running`; if FALSE see AS003. Walk headers for leak; check isolation valves on all machines; verify CIP is not drawing simultaneously. |
| AS002 | Air Dryer Fault | FAULT | `dryer_fault` = TRUE. Moisture enters compressed air distribution. | Refrigerant leak, dryer heater fault, condensate drain blocked, high ambient temperature. | Check dryer fault display; verify condensate drain auto-purge; call refrigeration technician if refrigerant issue. |
| AS003 | Compressor Offline | CRITICAL | `compressor_running` = FALSE. Full plant air loss imminent once receiver drains. | Motor thermal overload tripped, unloader valve stuck, high-temperature shutdown, power loss to compressor panel. | Check compressor control panel fault code; reset thermal overload if tripped (allow cool-down 10 min); if high-temp shutdown, check compressor room ambient < 100 °F. Call compressor technician if fault recurs. |
| AS004 | Low Air Alarm Persistent | WARN | `low_air_alarm` remains TRUE > 5 min with `compressor_running` = TRUE. Major leak or excess demand confirmed. | Ruptured line, open bleed valve, excessive simultaneous demand from multiple machines. | Immediately shut down non-essential pneumatic consumers; walk headers systematically for leak; escalate to maintenance supervisor. |

*Synthetic SimLab fixture — not a real OEM document.*
