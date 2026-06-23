# Ask MIRA — Line is line blocked. Most likely cause: Photoeye blocked / fouled on Conveyor01 (high confidence, ranked hypothesis).

_line: `synthetic_beverage_co.demo_site.bottling.bottlingline1` · symptom: `line_blocked`_

## 1. Most likely — Photoeye blocked / fouled (high confidence)
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: photoeye)
- **Why (chain of effects):**
    - Photoeye is blocked or fouled (sees a permanent target)
    - Conveyor logic believes product is present and stops feeding
    - Product backs up / accumulation fills upstream
    - Machine asserts Blocked state
    - Outfeed counts flatline; OEE availability drops
- **Supporting tags (4):**
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.production.counts_outfeed_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.photoeye_blocked_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name`
- **Related manual pages:**
    - Conveyor O&M Manual (synthetic), p.42 — 7.3 Photoeye Sensors ("A fouled or misaligned photoeye latches a permanent 'product present' signal, halting the feed logic.")
    - Sensor Maintenance Guide (synthetic), p.11 — Cleaning diffuse-reflective sensors ("Wipe the lens; verify the indicator LED toggles when the target clears.")
- **Technician checks I would perform:**
    - Visually inspect the photoeye lens for product debris, condensation, or label adhesive.
    - Clear the target and confirm the sensor output toggles (LED off).
    - Verify alignment to the reflector / confirm sensing distance.
    - Check the photoeye wiring/connector for damage.

## 2. Also possible — Conveyor mechanical jam (medium confidence)
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: conveyor_motor)
- **Why (chain of effects):**
    - Mechanical jam on the conveyor
    - Drive sees rising load / overcurrent and faults or stalls
    - Product backs up upstream
    - Machine asserts Blocked state
    - Outfeed counts flatline; OEE availability drops
- **Supporting tags (3):**
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.production.counts_outfeed_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name`
- **Related manual pages:**
    - Conveyor O&M Manual (synthetic), p.58 — 9.1 Mechanical Jams ("Rising drive current with no outfeed indicates a mechanical jam; clear before resetting the drive.")
- **Technician checks I would perform:**
    - Lock out the drive, then inspect the belt/chain path for a jammed product or foreign object.
    - Check for a seized roller or failed bearing (spin by hand under LOTO).
    - Inspect the drive for an overcurrent fault code before resetting.

## 3. Also possible — Motor overload / thermal trip (medium confidence)
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: motor)
- **Why (chain of effects):**
    - Motor draws excessive current (binding load / failing bearing)
    - Overload relay / drive trips on thermal or overcurrent
    - Motor stops; machine halts
    - Machine asserts Blocked/Fault state
    - Counts flatline; OEE availability drops
- **Supporting tags (2):**
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value`
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.state_name`
- **Related manual pages:**
    - Motor & Drive Handbook (synthetic), p.23 — Thermal Overload ("Repeated overcurrent trips indicate a binding load or a degrading motor/bearing.")
- **Technician checks I would perform:**
    - Read the overload relay / drive trip code and the last current peak.
    - Under LOTO, rotate the shaft by hand to feel for binding or bearing roughness.
    - Verify the load is free (no jam) before resetting the overload.

## 4. Also possible — Low plant air pressure (low confidence)
- **Where:** `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01` (component: air_supply)
- **Why (chain of effects):**
    - Plant air header pressure drops (compressor / dryer / leak)
    - Pneumatic actuators move sluggishly or stall across machines
    - Multiple machines degrade together
    - Stations assert Blocked/Starved
    - Counts fall across the line; OEE drops
- **Supporting tags (1):**
    - `synthetic_beverage_co.demo_site.bottling.bottlingline1.conveyor01.status.blocked_value_value`
- **Related manual pages:**
    - Plant Air System Manual (synthetic), p.15 — Header Pressure ("Header pressure below spec causes sluggish actuators plant-wide; check compressor, dryer, and leaks.")
- **Technician checks I would perform:**
    - Read the air header pressure gauge against the spec (e.g. 85-100 psi).
    - Check the compressor run state and the dryer fault status.
    - Walk the line for an audible leak or a stuck/dumping actuator.

_These are ranked hypotheses grounded in the factory's own tags + documentation — not asserted facts. Confirm on the floor; promote the confirmed cause for the work order._
