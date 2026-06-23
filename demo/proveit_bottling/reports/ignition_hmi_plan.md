# Ignition HMI screen plan — ProveIt bottling

> Ignition does not visualize PLCs; it visualizes **tags**. Bind these screens to the tags in
> `ignition_tag_map.json` (delivered via MQTT Engine, OPC, or Modbus — your choice). This is a plan, not
> an Ignition project; no Ignition API is required to run the demo.

## 1. Main bottling overview
A line schematic left-to-right: Tank → Mixer → Filler → Capper → Labeler → Case Packer, with the
**Conv_Simple** packaging cell shown as a distinct supervised cell. Each block tinted by `status`
(running = normal, fault = alarm color). Top strip: line running count, total bottles, active alarms.

## 2. Asset status cards
One card per asset bound to its tags: `status`, `running`, the primary counter (e.g. `bottles_filled`),
the primary process value (e.g. `bottles_per_min`), and the fault bit. The Conv_Simple card is marked
**LIVE — supervised bench** with `requires_supervision`/`runs_24_7` badges.

## 3. Alarms panel
A table driven by the fault bits (`jam_detected`, `torque_fault`, `downstream_blocked`, `low_level`,
`overload`, `label_low`, and the Conv_Simple `vfd_fault_code` / photoeye). Columns: asset, alarm,
priority, time, state. No blink except an unacked high-priority alarm (ISA-18.2 / HP-HMI).

## 4. Live trends
Trend pens on the process values + counters (filler `bottles_per_min`, capper `cap_torque_inlb`,
case-packer `pack_rate`, tank `level_pct`). Sourced from the same tags the telemetry layer publishes.

## 5. MIRA evidence panel
An "Ask MIRA" panel that, on an alarm, shows the evidence-backed answer card (most-likely cause,
evidence for/against, manuals/receipts, technician checks, human-review). For Conv_Simple faults it
renders the REAL card from the evidence folder; for simulated faults it renders the scenario card.

## 6. Conv_Simple supervised cell panel
A dedicated panel for the real bench: GS10 VFD, Micro820 PLC, PE-101 photoeye, motor. Shows the live
(or snapshot) photoeye/VFD tags, the supervision flags, and a clear "supervised — not 24/7" banner so an
operator never treats it as a 24/7 production line.
