# Ask MIRA — Line is line blocked. Most likely cause: Photoeye blocked / fouled on Conveyor01 — high confidence (ranked hypothesis).

_line: `synthetic_beverage_co.demo_site.bottling.bottlingline1` · symptom: `line_blocked`_

## 1. Most likely cause: Photoeye blocked / fouled
**Confidence: High**
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: photoeye)

**Why (chain of effects):**
- Photoeye is blocked or fouled (sees a permanent target)
- Conveyor logic believes product is present and stops feeding
- Product backs up / accumulation fills upstream
- Machine asserts Blocked state
- Outfeed counts flatline; OEE availability drops

**Evidence:**
- _Tag Evidence:_
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.production.counts_outfeed_value_value = rate dropped to 0/min
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value = TRUE
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.photoeye_blocked_value_value = TRUE
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name = Down / Fault
- _Asset Evidence:_
    - [Asset] Conveyor01 hosts the photoeye (inferred component)
    - [Asset] Conveyor01 feeds CapLoader01
- _Documentation Evidence:_
    - [Manual] Conveyor O&M Manual (synthetic), p.42 — 7.3 Photoeye Sensors
    - [Manual] Sensor Maintenance Guide (synthetic), p.11 — Cleaning diffuse-reflective sensors
- _Historical Evidence:_
    - [History] Similar fault occurred 3 time(s); avg 11 min; last action: Cleaned sensor lens

**Recommended checks:**
- Visually inspect the photoeye lens for product debris, condensation, or label adhesive.
- Clear the target and confirm the sensor output toggles (LED off).
- Verify alignment to the reflector / confirm sensing distance.
- Check the photoeye wiring/connector for damage.

**Reference procedures:**
- Clean & verify a photoeye sensor (`clean_photoeye`)

## 2. Also possible: Conveyor mechanical jam
**Confidence: Medium**
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: conveyor_motor)

**Why (chain of effects):**
- Mechanical jam on the conveyor
- Drive sees rising load / overcurrent and faults or stalls
- Product backs up upstream
- Machine asserts Blocked state
- Outfeed counts flatline; OEE availability drops

**Evidence:**
- _Tag Evidence:_
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.production.counts_outfeed_value_value = rate dropped to 0/min
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value = TRUE
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name = Down / Fault
- _Asset Evidence:_
    - [Asset] Conveyor01 hosts the conveyor_motor (inferred component)
    - [Asset] Conveyor01 feeds CapLoader01
- _Documentation Evidence:_
    - [Manual] Conveyor O&M Manual (synthetic), p.58 — 9.1 Mechanical Jams
- _Historical Evidence:_
    - [History] Similar fault occurred 2 time(s); avg 23 min; last action: Cleared jammed product, reset drive

**Recommended checks:**
- Lock out the drive, then inspect the belt/chain path for a jammed product or foreign object.
- Check for a seized roller or failed bearing (spin by hand under LOTO).
- Inspect the drive for an overcurrent fault code before resetting.

**Reference procedures:**
- Clear a conveyor mechanical jam (`clear_conveyor_jam`)

## 3. Also possible: Motor overload / thermal trip
**Confidence: Medium**
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: motor)

**Why (chain of effects):**
- Motor draws excessive current (binding load / failing bearing)
- Overload relay / drive trips on thermal or overcurrent
- Motor stops; machine halts
- Machine asserts Blocked/Fault state
- Counts flatline; OEE availability drops

**Evidence:**
- _Tag Evidence:_
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value = TRUE
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name = Down / Fault
- _Asset Evidence:_
    - [Asset] Conveyor01 hosts the motor (inferred component)
    - [Asset] Conveyor01 feeds CapLoader01
- _Documentation Evidence:_
    - [Manual] Motor & Drive Handbook (synthetic), p.23 — Thermal Overload
- _Historical Evidence:_
    - [History] Similar fault occurred 2 time(s); avg 41 min; last action: Replaced failing bearing

**Recommended checks:**
- Read the overload relay / drive trip code and the last current peak.
- Under LOTO, rotate the shaft by hand to feel for binding or bearing roughness.
- Verify the load is free (no jam) before resetting the overload.

**Reference procedures:**
- Investigate a motor overload trip (`clear_motor_overload`)

## 4. Also possible: Low plant air pressure
**Confidence: Low**
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: air_supply)

**Why (chain of effects):**
- Plant air header pressure drops (compressor / dryer / leak)
- Pneumatic actuators move sluggishly or stall across machines
- Multiple machines degrade together
- Stations assert Blocked/Starved
- Counts fall across the line; OEE drops

**Evidence:**
- _Tag Evidence:_
    - [Tag] synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value = TRUE
- _Asset Evidence:_
    - [Asset] Conveyor01 hosts the air_supply (inferred component)
    - [Asset] Conveyor01 feeds CapLoader01
- _Documentation Evidence:_
    - [Manual] Plant Air System Manual (synthetic), p.15 — Header Pressure
- _Historical Evidence:_
    - [History] Similar fault occurred 1 time(s); avg 33 min; last action: Repaired air leak at header

**Recommended checks:**
- Read the air header pressure gauge against the spec (e.g. 85-100 psi).
- Check the compressor run state and the dryer fault status.
- Walk the line for an audible leak or a stuck/dumping actuator.

**Reference procedures:**
- Restore plant air pressure (`restore_plant_air`)

_Every claim above shows its receipts: each line traces to a tag, asset edge, manual page, or historical event in the evidence graph. Ranked hypotheses, not asserted facts._
