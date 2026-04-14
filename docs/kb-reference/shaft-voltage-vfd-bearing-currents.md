# Shaft Voltage and Bearing Currents on VFD-Driven Motors

## The problem

Modern PWM inverter drives (VFDs) produce a common-mode voltage at the motor terminals that induces a shaft voltage on the rotor. When this shaft voltage discharges through the bearing grease film to ground, it creates a micro-arc — electrical discharge machining (EDM) — that pits the bearing race. Repeated discharges produce a characteristic "fluting" pattern: evenly spaced grooves across the race surface.

Symptoms of VFD-induced bearing damage include premature bearing failure (often within months of VFD installation), audible whine or growl increasing with runtime, and visible fluting/frosting on bearing race when the motor is disassembled.

## Shaft voltage threshold

**Industry guidance is to keep peak shaft voltage below approximately 1 V (1,000 mV peak)** to prevent EDM discharge through the bearing. Above this level, the grease film dielectric strength is insufficient to prevent arc discharge.

Sources of this guidance:
- Aegis / Electro Static Technology application notes (shaft grounding ring manufacturer)
- Baldor / ABB VFD motor application guides
- NEMA Application Guide for AC Adjustable Speed Drive Systems (MG 7)

Peak shaft voltages above 5–15 V are common on VFD-driven motors without mitigation — well above the 1 V threshold.

## How to measure shaft voltage

1. Run the motor at normal speed under a VFD.
2. Use a high-bandwidth oscilloscope (100 MHz+) with a differential probe or a carbon-brush shaft probe kit.
3. Measure between the shaft and the motor frame (ground reference).
4. Read peak voltage during steady-state operation (not just startup transients).

## Mitigation options

**Fit a shaft grounding ring when peak shaft voltage exceeds ~1 V.** Options in order of cost-effectiveness:

1. **Shaft grounding ring (brush)** — Aegis SGR, Inpro/Seal MGS, or equivalent. Mounts on the shaft, conducts shaft voltage to the frame before it can discharge through the bearing. ~$100–300. Simplest retrofit for installed motors.

2. **Insulated non-drive-end bearing** — ceramic or hybrid bearing on the opposite end from the grounding ring. Breaks the circuit by forcing current through a single path (the grounding ring). Required on large motors (>100 HP / 75 kW) where induced voltage is severe. Typically specified with the grounding ring, not instead of it.

3. **Common-mode choke (dV/dt filter)** at the VFD output — reduces the common-mode voltage reaching the motor. Effective but adds cost and losses. Best for long cable runs (>50 ft) where reflected-wave issues also apply.

4. **Shielded motor cable with three-conductor grounding** — provides a low-impedance path for common-mode current back to the VFD. Reduces shaft voltage but rarely enough on its own.

5. **Output sine-wave filter** — highest-cost option, eliminates PWM entirely at the motor. Used when other methods are insufficient or when motor is in a hazardous/sensitive location.

## Practical rules of thumb

- Always fit a shaft grounding ring on motors ≥10 HP driven by a PWM VFD if the installation is new. Retrofit existing motors only if failures occur or measurements confirm >1 V peak.
- On motors >75 kW / 100 HP: shaft grounding ring PLUS insulated non-drive-end bearing is standard practice.
- Shaft grounding rings wear out — inspect brushes annually and replace when worn. A failed ring offers no protection.
- Running a grease-lubricated bearing at low speed (<200 RPM) makes it more vulnerable to EDM because the grease film is thinner. Low-speed applications benefit most from mitigation.

## References

- Aegis / Electro Static Technology — Shaft Grounding Ring Technical Guide
- ABB Technical Guide No. 5 — Bearing currents in modern AC drive systems
- NEMA MG 7 — Application Guide for AC Adjustable Speed Drive Systems
- IEEE 1349 — Guide for Applying Motors in Chemical Industry (Class I, Div 2)
- SKF technical bulletin — Electric motor bearings and VFD operation
