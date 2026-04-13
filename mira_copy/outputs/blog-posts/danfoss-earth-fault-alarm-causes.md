# Danfoss VFD Earth Fault Alarm: Causes and Field Troubleshooting Guide

*Danfoss VFD earth fault alarm? Check motor insulation, grounding, and cable damage. Diagnose faster with AI troubleshooting at app.factorylm.com.*
**Tags:** Danfoss VFD troubleshooting | earth fault alarm | ground fault VFD | megger motor test | VFD motor insulation | industrial drive fault | Danfoss FC302 fault | VFD maintenance
**Words:** ~980

## What is a Danfoss VFD Earth Fault Alarm?

An earth fault alarm (sometimes labeled 'E-earth', 'EF', or 'Ground Fault') on a Danfoss VFD means current is leaking from a phase conductor to ground. The drive detects an imbalance between outgoing and returning current—more than 1-2% mismatch typically triggers the fault. This isn’t just a nuisance: it can damage motors, harm personnel, or kill the drive. On Danfoss models like the VLT 5000, 6000, or FC 302, this stops output instantly. You’ll see the fault on the keypad or in the drive’s event log. It’s not the same as an overload or short circuit—the issue is insulation breakdown or improper grounding. Most VFDs monitor this via an internal current transformer. If it trips, don’t reset and walk away. You’re risking rewind costs or safety incidents. The root cause is usually in the motor, cable, or grounding path. Find it before restarting.

## Common Causes of Earth Fault on Danfoss VFDs

1. Motor winding insulation failure – Most common. A megger test at 500VDC should show >1 MΩ; <0.5 MΩ is red flag. Moisture, heat, or age kills insulation over time.

2. Deteriorated motor cable – Shielded cables between VFD and motor degrade. Look for cuts, crushed sections, or water ingress. The shield must be 360° terminated, not 'pigtailed'. Poor termination causes ground leakage.

3. Loose grounding lug at drive or motor – Check the grounding bar inside the VFD panel. Danfoss drives require low-impedance ground—under 1 ohm. Use a clamp meter to verify grounding continuity.

4. Internal drive IGBT failure – Rare, but possible. If the IGBT shorts to ground, it trips EF immediately on startup. Disconnect motor and power cycle—if fault returns, suspect drive.

5. Aftermarket filters or reactors – Improperly installed dV/dt or sine filters can introduce capacitive leakage. Verify manufacturer grounding specs.

6. Shared ground with other equipment – If hydraulic units or A-B PLCs share a noisy ground, leakage can couple into the VFD. Isolate ground paths where possible.

## Step-by-Step Fix: Diagnose Earth Fault in 30 Minutes

Step 1: Power down and lock out. Disconnect the motor leads (U, V, W) from the Danfoss VFD output. Do not skip isolation.

Step 2: Megger the motor. Use a 500VDC megger between each phase and ground. Record values. Anything below 1 MΩ needs investigation. Below 0.5 MΩ? Replace or recondition the motor.

Step 3: Test the cable. With motor disconnected, megger the cable run from VFD to motor box. Look for <1 MΩ readings or erratic drops—indicates nicked shield or moisture.

Step 4: Inspect grounding. At the VFD, verify the ground bus is bonded to the enclosure with star washers. Check the motor frame ground with a multimeter—resistance to plant ground should be <1 ohm.

Step 5: Test drive alone. With motor and cables disconnected, power up the Danfoss drive. If the earth fault returns, the drive’s output stage is compromised. Contact Danfoss support or consider repair.

Step 6: Reconnect and verify. Once clear, reconnect, ensure no floating grounds, and power up. Monitor first 10 seconds—listen for hum, check for immediate trip.

## When to Escalate Beyond Field Troubleshooting

If you’ve meggered the motor and cable above 1 MΩ, verified grounding, and the fault persists with no load, escalate to controls engineer or Danfoss support. Internal faults in the drive’s inverter module require bench testing. Don’t waste 2 hours poking at a failed IGBT stack. If the motor is old and you see any black, sticky residue inside the conduit or junction box, involve rotating equipment specialists—this is advanced degradation. If this VFD feeds a hydraulic power unit with solenoid valves and you’re seeing intermittent tripping, log the event times. Correlate with machine cycles—could be voltage transients from valve coils coupling through shared wiring. In plants with Allen-Bradley PLCs, pull the output logs to see if VFD EN signal drops align with earth faults. If you're troubleshooting a GS20 or PowerFlex drive downstream, remember Danfoss drives can influence grounding topology—use isolated ground rods if needed.

---
*Stop digging through binders or waiting on hold. Snap a photo of your Danfoss VFD fault—Mira diagnoses it in seconds using your manuals. Try it at app.factorylm.com.*