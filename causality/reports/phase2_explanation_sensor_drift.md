# Ask MIRA — Line is quality reject. Most likely cause: Process sensor drift / out of calibration on Tank01 (high confidence, ranked hypothesis).

_line: `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1` · symptom: `quality_reject`_

## 1. Most likely — Process sensor drift / out of calibration (high confidence)
- **Where:** `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01` (component: sensor)
- **Why (chain of effects):**
    - Analog sensor drifts out of calibration
    - Process value reads wrong (level / temperature / pressure)
    - Control regulates to the wrong setpoint
    - Product goes out of spec
    - Reject/defect counts rise; OEE quality drops
- **Supporting tags (4):**
    - `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.density_value_value`
    - `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.flow_value_value`
    - `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.level_value_value`
    - `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.temperature_value_value`
- **Related manual pages:**
    - Instrument Calibration SOP (synthetic), p.4 — Drift & Recalibration ("Compare the live process value to a reference; recalibrate if drift exceeds the tolerance band.")
- **Technician checks I would perform:**
    - Compare the sensor reading to an independent reference/handheld.
    - Inspect the sensor for coating, scaling, or a loose fitting.
    - Recalibrate per the SOP and re-verify against the reference.

_These are ranked hypotheses grounded in the factory's own tags + documentation — not asserted facts. Confirm on the floor; promote the confirmed cause for the work order._
