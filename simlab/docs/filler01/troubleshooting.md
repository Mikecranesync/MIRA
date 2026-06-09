# Filler 01 — Troubleshooting Guide

## Symptom Index
- [Underfill / Low Fill Weights](#underfill--low-fill-weights)
- [Overfill / Product Overflow](#overfill--product-overflow)
- [Filler Not Starting](#filler-not-starting)
- [Erratic Fill Levels (High Variance)](#erratic-fill-levels-high-variance)
- [Nozzle Fault Count Rising](#nozzle-fault-count-rising)
- [Motor Overload / High Current](#motor-overload--high-current)
- [Product Temperature Out of Range](#product-temperature-out-of-range)

---

## Underfill / Low Fill Weights

**Condition:** `fill_level_oz` consistently below `fill_level_target_oz`; `underfill_reject_count` increasing; `fill_level_variance` negative.

### Step 1 — Check Filler Bowl Pressure (Primary Cause)
- **Tag:** `filler_bowl_pressure`
- **Expected:** 10–18 PSI during production
- **Action:** If bowl pressure < 10 PSI:
  - Low bowl pressure is the most common root cause of systematic underfill.
  - Insufficient headspace pressure in the product bowl reduces product flow rate through each fill nozzle, causing every valve to deliver less product per dwell time.

### Step 2 — Check Product Supply Tank Level
- **Tag:** `tank_level_percent`
- **Expected:** > 20% during production; > 30% preferred
- **Action:** If tank level < 15%:
  - Notify product supply operator to replenish batch tank.
  - A low tank level reduces the hydrostatic head pressure feeding the bowl, which in turn lowers bowl pressure.
  - Do not resume production until tank_level_percent > 25%.

### Step 3 — Check Pressure Regulator on Bowl Supply Line
- **Location:** Bowl supply manifold, upstream of the bowl pressure gauge.
- **Action:**
  - Inspect the pressure regulator set-point — should be set to 14 PSI nominal.
  - Check for blockage or partial closure on the manual isolation valve upstream of the regulator.
  - A failed-closed or partially-closed regulator is the most common mechanical cause of low bowl pressure.
  - Replace regulator if set-point cannot be achieved even with full-open adjustment.

### Step 4 — Inspect Clogged Fill Nozzles
- **Tag:** `nozzle_fault_count`
- **Action:** If `nozzle_fault_count` > 0:
  - Identify which nozzle(s) are faulted via the HMI valve diagnostic screen.
  - A single clogged nozzle raises the fill level on surrounding valves but drops overall throughput; multiple clogged nozzles will drive systematic underfill.
  - Clear nozzle obstructions following the nozzle cleaning SOP.
  - Common causes: product pulp/fiber particles, dried product residue from incomplete prior CIP, or foreign material.
  - After clearing, confirm `nozzle_fault_count` drops to 0 and `fill_level_variance` returns to ±0.15 oz.

### Step 5 — Verify Fill Valve Air Supply
- **Linked utility:** AirSystem 01
- **Tag (AirSystem01):** `header_pressure_psi`
- **Expected:** 85–100 PSI
- **Action:** Confirm air system header pressure is within range.
  - Fill valves are pneumatically actuated; insufficient air pressure causes valves to open partially or inconsistently.
  - Check AirSystem01 `compressor_running` = TRUE and `low_air_alarm` = FALSE.
  - If air pressure is low, address root cause at AirSystem 01 before returning Filler 01 to production (see AirSystem01 troubleshooting guide).

### Step 6 — Verify VFD Speed and Motor Overload Status
- **Tags:** `vfd_speed_hz`, `motor_current_amps`
- **Expected:** VFD speed 45–60 Hz; motor current 4.0–7.5 A
- **Action:**
  - If VFD speed is lower than setpoint (e.g., running at 30 Hz), the rotary filler dwell time per station increases, but bowl-pressure-driven flow is still inadequate if pressure is low.
  - Confirm the VFD has no active fault — check the VFD keypad for fault codes F001–F006.
  - If motor current exceeds 8.5 A, a mechanical drag issue (e.g., a seized rotary seal) may be slowing the carousel and contributing to inconsistent fill timing.
  - Do not increase VFD speed to compensate for low bowl pressure — this shortens dwell time and worsens the underfill.

---

## Overfill / Product Overflow

**Condition:** `fill_level_oz` > `fill_level_target_oz`; `overfill_reject_count` increasing.

- Check bowl pressure is not too high (> 20 PSI). Reduce regulator set-point.
- Check VFD speed — if rotating too slowly, each valve stays open longer than designed.
- Check fill valve timing on HMI; confirm open/close solenoid response is within spec.
- **Fault Code:** F004

---

## Filler Not Starting

**Condition:** START command issued, filler stays in IDLE or transitions to ABORTING.

- Confirm E-STOP circuit is not latched (check E-stop OK signal in PLC I/O status).
- Confirm CIP is not active (`cipskid01.process.cip_active` must be FALSE).
- Confirm `fault_code` tag is clear (= empty or "NONE").
- Confirm downstream Capper 01 is READY (interlocked).
- Check motor overload relay (reset required after thermal trip).
- **Fault Code:** F001

---

## Erratic Fill Levels (High Variance)

**Condition:** `fill_level_variance` oscillates > ±0.5 oz; some bottles underfill while others overfill.

- Inspect bowl level — should remain at 55–65% full during steady-state production.
- Check for air entrainment in the product supply line (bubbles at bowl sight glass).
- Inspect bowl float valve — if float is stuck, bowl level swings cause pressure swings.
- **Fault Code:** F005

---

## Nozzle Fault Count Rising

**Condition:** `nozzle_fault_count` increments steadily.

- Execute nozzle diagnostic via HMI → Valve Test → Individual Valve Cycle.
- Remove and inspect nozzle tips for orifice blockage or worn tip seals.
- Review last CIP cycle completion log — incomplete rinse can leave residue.
- **Fault Code:** F003

---

## Motor Overload / High Current

**Condition:** `motor_current_amps` > 8.5 A sustained; overload relay may trip.

- Check for jam in the rotary carousel — inspect infeed starwheel for jammed bottles.
- Confirm all lubrication points are serviced per PM schedule.
- Check rotary seal condition — a worn or swollen seal increases drag torque.
- If overload relay has tripped, allow motor to cool 10 minutes before reset.
- **Fault Code:** F002

---

## Product Temperature Out of Range

**Condition:** `product_temperature` > 42 °F or < 32 °F.

- Check refrigeration supply for the product supply tank.
- Confirm product supply tank insulation is intact.
- For high-temperature alarm: check if production has been paused with product in bowl > 45 minutes.
- Drain and replace bowl product if temperature exceeds 45 °F.
- **Fault Code:** F006

---

## Related Documents
- `fault_code_table.md` — complete fault code listing
- `electrical_io_notes.md` — valve solenoid wiring details
- `pm_checklist.md` — preventive maintenance intervals
- `spare_parts_notes.md` — nozzle tip and seal part numbers

*Synthetic SimLab fixture — not a real OEM document.*
