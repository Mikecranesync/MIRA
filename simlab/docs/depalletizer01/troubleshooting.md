# Depalletizer 01 — Troubleshooting Guide

**Asset ID:** `depalletizer01`
**UNS Path:** `enterprise.florida_natural_demo.plant1.juice_bottling.line01.depalletizer01`

## Vacuum Loss / Dropped Bottles

**Condition:** `vacuum_pressure` > -15 in-Hg; bottles dropped or falling on ConveyorZone01.

1. Check AirSystem01 `header_pressure_psi` — vacuum generator requires > 75 PSI supply.
2. Inspect vacuum cup condition — cracked or hardened cups lose sealing force.
3. Inspect vacuum plumbing for leaks at fittings and manifold.
4. **Fault Code:** DP002

## No Pallet at Infeed

**Condition:** `pallet_present` = FALSE; machine pauses waiting for pallet.

1. Contact fork truck operator to stage a full pallet.
2. If pallet is present but sensor reads FALSE, clean pallet-present photoeye lens.
3. **Fault Code:** DP001

## Outfeed Jam

**Condition:** `jam_detected` = TRUE; `bottle_outfeed_rate` drops to 0.

1. Safe-to-enter before reaching into machine.
2. Clear tipped or doubled bottle from outfeed starwheel.
3. Reset jam sensor via HMI and issue PackML RESET.
4. **Fault Code:** DP003

## Low Air Impact (Scenario F)
When AirSystem01 `low_air_alarm` = TRUE, `vacuum_pressure` will degrade.
MIRA should identify AirSystem01 as the root cause — not Depalletizer01 independently.

*Synthetic SimLab fixture — not a real OEM document.*
