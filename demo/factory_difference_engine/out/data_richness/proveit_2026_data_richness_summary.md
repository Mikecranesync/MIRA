# ProveIt 2026 / Northwind — Data-Richness Summary (generated)

Deterministic snapshot of the SimLab juice line. See the full audit at
`docs/discovery/proveit_2026_factory_data_richness_audit.md`.

- Total tags: **89** across **11** assets.
- By category: {'alarms': 3, 'faults': 10, 'motor': 5, 'process': 25, 'production': 7, 'quality': 6, 'status': 33}
- By value type: {'bool': 23, 'enum': 9, 'float': 31, 'int': 16, 'string': 10}

## Maintenance benchmark vs Mike's conveyor VFD (16 params)
- PRESENT: **3** · PARTIAL/DERIVABLE: **3** · ABSENT: **10**
- VFD diagnostics present: `motor_current_amps` (4 assets), `vfd_speed_hz` (filler only), `fault_code` (string).
- VFD diagnostics ABSENT: torque %, DC bus, output voltage, kW, drive/IGBT temp, overload count, numeric fault code, vibration, bearing temp, runtime hours, start/cycle counts.

Verdict: process/quality/state-rich, **VFD/electrical/condition-monitoring-poor**. Good for a visual
demo; add the filler01 VFD block to reach a serious maintenance-intelligence demo.
