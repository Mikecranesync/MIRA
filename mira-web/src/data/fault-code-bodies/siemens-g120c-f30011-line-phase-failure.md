# SINAMICS G120C F30011: line phase failure in the main circuit

**On a SINAMICS G120C, F30011 means "Power unit: Line phase failure in main circuit." The list manual's cause is that the DC link voltage ripple at the power unit has exceeded the permissible limit value. F30011 is not a heatsink or power-module overtemperature. In the same manual, that heat-sink meaning belongs to F30004.** ([A5E33840768B AA, printed p.525 / PDF p.525](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=525); [printed p.524 / PDF p.524](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=524))

> **Before you go further:** checking main-circuit fuses, line connections, or motor feeder cables can expose hazardous voltage. Disconnect power per the manufacturer's manual, and lock out per the site's procedure, before you open covers or touch power wiring. Acknowledging F30011 is not a safety reset and does not prove the machine is safe to restart.

| At a glance | |
|---|---|
| **Observed symptom** | F30011 on a SINAMICS G120C |
| **What the manual establishes** | F30011 is a line phase failure in the main circuit; the recorded cause is excessive DC link voltage ripple, with the possible causes listed below |
| **First evidence to collect** | Exact code and reaction; whether a main-circuit fuse, line phase, or motor feeder is open or badly unbalanced; whether a line reactor is installed; r0949 if you record it (the list manual says this fault value is only for internal Siemens troubleshooting) |
| **Source** | [A5E33840768B AA](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf), SINAMICS G120C List Manual (LH13, 04/2014), valid for firmware 4.7 |

*Manual references checked against A5E33840768B AA (LH13, 04/2014) on Nov 25, 2026. Desk review, not a hardware test. This post is not a MIRA answer for this case.*

## Why this page was rewritten

An earlier FactoryLM article at `/blog/siemens-f30011-heatsink-overtemp` described F30011 as a power-module heatsink overtemperature and did not cite a manual page. It also labeled the equipment "Siemens SINAMICS G120 / S120." That heatsink meaning is the F30004 entry in the G120C list manual used here, not the F30011 entry.

This draft is written only from that official G120C list manual. Whether the same F30011 text applies to SINAMICS S120, to a G120 control unit that is not G120C, or to a later list-manual edition is **UNVERIFIED**.

## What the list manual says F30011 is

The faults-and-alarms list names the message as follows ([printed p.525 / PDF p.525](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=525)):

- **Name:** F30011, Power unit: Line phase failure in main circuit
- **Message class:** Network fault (2)
- **Reaction:** OFF2 (OFF1)
- **Acknowledge:** IMMEDIATELY
- **Cause:** "At the power unit, the DC link voltage ripple has exceeded the permissible limit value."

The same entry then lists possible causes:

- A line phase has failed.
- The 3 line phases are inadmissibly unsymmetrical.
- The capacitance of the DC link capacitor forms a resonance frequency with the line inductance and the reactor integrated in the power unit.
- The fuse of a phase of a main circuit has ruptured.
- A motor phase has failed.

The fault value in r0949 is described as "Only for internal Siemens troubleshooting." This article does not interpret r0949 for F30011.

## Checks the list manual lists

These are the remedy lines from the same F30011 entry, not a site procedure and not a confirmed diagnosis ([printed p.525 / PDF p.525](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=525)):

- Check the main circuit fuses.
- Check whether a single-phase load is distorting the line voltages.
- Detune the resonant frequency with the line inductance by using an upstream line reactor.
- The list manual (p.525) says to "Dampen the resonant frequency with the line inductance by switching over the DC link voltage compensation in the software (see p1810)" or to "increase the smoothing (see p1806)." It adds: "However, this can have a negative impact on the torque ripple at the motor output."
- Check the motor feeder cables.

Do those isolation and wiring checks only after the machine is disconnected and locked out as required above. Changing p1810 or p1806 is a controls decision with a documented side effect; this article does not choose a setting for you.

## Do not confuse F30011 with F30004 or F30001

In the same list manual, **F30004** is "Power unit: Overtemperature heat sink AC inverter." Its cause is: "The temperature of the power unit heat sink has exceeded the permissible limit value." Possible causes listed there are insufficient cooling or fan failure, overload, ambient temperature too high, and pulse frequency too high. The remedy lines are to check whether the fan is running, check the fan elements, check whether the ambient temperature is in the permissible range, check the motor load, and reduce the pulse frequency if it is higher than the rated pulse frequency. The entry points to p1800 (Pulse frequency setpoint) and says the fault can only be acknowledged after the alarm threshold for alarm A05000 has been undershot. ([printed p.524 / PDF p.524](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=524))

**F30001** in the same list is "Power unit: Overcurrent." That entry begins on [printed p.522 / PDF p.522](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=522).

The earlier live article used several details that do not appear in the F30011 entry, and several that also do not appear in the F30004 entry: a 40°C cabinet limit, comparing r0027 to rated current, cleaning dust from heatsink fins with compressed air, and a sentence about protecting IGBT semiconductors from thermal destruction. Those statements are **UNVERIFIED** in the list manual checked here, and they are not restored in this rewrite.

FactoryLM also keeps separate Drive Commander pages for [F30011](https://factorylm.com/drive-commander/siemens-g120/faults/F30011), [F30004](https://factorylm.com/drive-commander/siemens-g120/faults/F30004), and [F30001](https://factorylm.com/drive-commander/siemens-g120/faults/F30001). This article is the blog correction only.

## Evidence to record

- [ ] Exact fault code, reaction (OFF2 or OFF1), and acknowledge behavior as displayed.
- [ ] Drive identity: G120C or another SINAMICS type, and firmware, so you can tell whether this LH13 / firmware 4.7 list applies.
- [ ] Main-circuit fuse state and whether a line phase or motor feeder is open or badly unbalanced, recorded under the site isolation procedure.
- [ ] Whether a line reactor is installed, if resonance is in question.
- [ ] Any change already made to p1810 or p1806, if those parameters were used.
- [ ] If the displayed code is actually F30004 or F30001, stop using this F30011 page and use the matching list entry instead.

## What this can and can't tell you

- **F30011 on G120C, in this edition, is a line phase failure in the main circuit**, with excessive DC link voltage ripple as the stated cause.
- **The possible causes and remedy lines above are the OEM list**, not a ranked diagnosis for a particular machine.
- **Heat-sink overtemperature is F30004**, not F30011, in this manual.
- **Applicability to S120, to other G120 control units, or to a later list-manual edition is UNVERIFIED.**

## When to escalate

The code is not clearly F30011, the unit is not a G120C on firmware this list covers, line or motor-cable work is outside your authorization, or the fault remains after the listed checks. Take the exact code, the nameplate, and the firmware to the responsible qualified person and to the current manual for that unit.

> Publisher's note: this article does not give a lockout sequence, a live-voltage measurement procedure, or permission to restart after F30011. Follow A5E33840768B AA and your site's procedure. Do not treat F30011 acknowledgment as a safety reset.

## Sources

- Siemens, SINAMICS G120C List Manual (LH13, 04/2014, A5E33840768B AA), valid for SINAMICS G120C firmware 4.7: [printed p.522 / PDF p.522 (F30001)](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=522), [printed p.524 / PDF p.524 (F30004)](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=524), [printed p.525 / PDF p.525 (F30011)](https://cache.industry.siemens.com/dl/files/780/99683780/att_863315/v1/G120C_List_Manual_LH13_0414_eng.pdf#page=525)

Related: [Drive Commander F30011](https://factorylm.com/drive-commander/siemens-g120/faults/F30011), [F30004](https://factorylm.com/drive-commander/siemens-g120/faults/F30004), [F30001](https://factorylm.com/drive-commander/siemens-g120/faults/F30001).

Want to try it with your own machine's manual? [Sign up for FactoryLM](https://app.factorylm.com/signup?utm_source=blog&utm_medium=organic&utm_campaign=from-the-manual&utm_content=siemens-g120c-f30011-line-phase-failure), or [talk to Mike](mailto:mike@factorylm.com).
