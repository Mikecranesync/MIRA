# De-energize / lockout safety quotes from OEM manuals (T-058, MIRA #4858)
Written 2026-10-27. **Catalog only:** these are the manufacturers' words, quoted exactly. We have written no procedures of our own.
Text was pulled with `pdftotext -layout`. For all three manuals, the printed page number matches the PDF page number (checked against the page footers).

## 1. PowerFlex 520-series user manual: rockwell/520-um001.pdf
Edition: publication 520-UM001O-EN-E, September 2025 (edition O).

### p.2, Important User Information (definitions of the safety labels)
> SHOCK HAZARD: Labels may be on or inside the equipment, for example, a drive or motor, to alert people that dangerous voltage may be present.

> ARC FLASH HAZARD: Labels may be on or inside the equipment, for example, a motor control center, to alert people to potential Arc Flash. Arc Flash will cause severe injury or death. Wear proper Personal Protective Equipment (PPE). Follow ALL Regulatory requirements for safe work practices and for Personal Protective Equipment (PPE).

> ATTENTION: Identifies information about practices or circumstances that can lead to personal injury or death, property damage, or economic loss.

### p.13, Preface, General Precautions (bus capacitor discharge)
> ATTENTION: The drive contains high-voltage capacitors, which take time to discharge after removal of mains supply. After power has been removed from the drive, wait three minutes to make sure DC bus capacitors are discharged. After three minutes, verify AC voltage L1, L2, L3 (Line to Line and Line to Ground) to ensure mains power has been disconnected. Measure DC voltage across DC- and DC+ bus terminals to verify DC Bus has discharged to zero volts. Measure DC voltage from L1, L2, L3, T1, T2, T3 DC – and DC+ terminals to ground and keep the meter on the terminals until the voltage discharges to zero volts. The discharge process may take several minutes to reach zero volts.
> Darkened display LEDs are not an indication that capacitors have discharged to safe voltage levels.

> ATTENTION: Only qualified personnel familiar with adjustable frequency AC drives and associated machinery should plan or implement the installation, startup and subsequent maintenance of the system. Failure to comply may result in personal injury and/or equipment damage.

> ATTENTION: Risk of injury or equipment damage exists. Drive does not contain user-serviceable components. Do not disassemble drive chassis.

Same page, about overvoltage and braking:
> ATTENTION: The bus regulator function is extremely useful for preventing nuisance overvoltage faults resulting from aggressive decelerations, overhauling loads, and eccentric loads. [...] In addition, installing a properly sized dynamic brake resistor will provide proper stopping requirements based on braking resistor sizing.

### p.33, wiring
> ATTENTION: National Codes and standards (NEC, VDE, BSI, and so on) and local codes outline provisions for safely installing electrical equipment. Installation must comply with specifications regarding wire types, conductor sizes, branch circuit protection, and disconnect devices. Failure to do so may result in personal injury and/or equipment damage.

> ATTENTION: To avoid a possible shock hazard that is caused by induced voltages, unused wires in the conduit must be grounded at both ends. For the same reason, if a drive sharing a conduit is being serviced or installed, all drives using this conduit should be disabled. This helps minimize the possible shock hazard from "cross coupled" power leads.

### p.36, power terminal block (all frame sizes A to E)
> BR+, BR-   Dynamic Brake Resistor Connection
> DC+, DC-   DC Bus Connection (except for 110V 1-phase)

### p.37, I/O wiring
> ATTENTION: The drive start/stop control circuitry includes solid-state components. If hazards due to accidental contact with moving machinery or unintentional flow of liquid, gas or solids exist, an additional hardwired stop circuit may be required to remove the AC line to the drive. When the AC line is removed, there will be a loss of any inherent regenerative braking effect that might be present - the motor will coast to a stop. An auxiliary braking method may be required. Alternatively, use the drive's safety input function.

### p.54, CE/UK conformity
> • When connected, power terminals DC+/BR+, DC-, and BR- must be protected with a DC fuse. See Dynamic Brake Resistors on page 176 for part numbers of the fuses.

> ATTENTION: NEMA/UL Open Type drives must either be installed in a supplementary enclosure or equipped with a "NEMA Type 1 Kit" to be CE and UK compliant with respect to protection against electrical shock.

### p.161, Fault F005
> F005 OverVoltage — DC bus voltage exceeded max value. — Monitor the AC line for high line voltage or transient conditions. Bus overvoltage can also be caused by motor regeneration. Extend the decel time or install dynamic brake option.

### p.176, Dynamic Brake Resistors table, footnotes
> (2) Use of Rockwell Automation resistors is always recommended. [...] Alternative resistors may be used, however, care must be taken when making a selection. See the PowerFlex Dynamic Braking Resistor Calculator Application Technique, publication PFLEX-AT001.
> (3) For IEC applications, DC Fuse is mandatory when these terminals are connected. [...]
> (4) For UL applications, a DC fuse is mandatory at the BR- terminal when used with a dynamic brake resistor.

### A438 [DB Threshold] parameter entry (parameter chapter)
> ATTENTION: Equipment damage may result if this parameter is set to a value that causes the dynamic braking resistor to dissipate excessive power. [...]

**What the PF525 manual doesn't state:**
- The F005 text, "install dynamic brake option", carries no safety note of its own. Its only de-energize wording is the general p.13 precaution.
- The manual has no step-by-step install procedure for the DB resistor. It points to PFLEX-AT001 and the resistor's own instructions, which are not in our library.
- "Lockout" appears only on pp.246–248, where it means a safety-input fault state, not lockout/tagout. The manual never uses the terms "lockout/tagout" or "LOTO".

## 2. Micro820 user manual: rockwell/2080-um005.pdf
Edition: publication 2080-UM005H-EN-E, September 2025.

### p.27, Safety Considerations: Disconnecting Main Power
> WARNING: Explosion Hazard
> Do not replace components, connect equipment, or disconnect equipment unless power has been switched off.

> The main power disconnect switch should be located where operators and maintenance personnel have quick and easy access to it. In addition to disconnecting electrical power, all other sources of power (pneumatic and hydraulic) should be de-energized before working on a machine or process controlled by a controller.

### p.27, Safety Circuits
> WARNING: Explosion Hazard
> Do not connect or disconnect connectors while circuit is live.

### p.29, Master Control Relay
> WARNING: Never alter these circuits to defeat their function since serious injury and/or machine damage could result.

> The master control relay is not a substitute for a disconnect to the controller. It is intended for any situation where the operator must quickly de-energize I/O devices only. When inspecting or installing terminal connections, replacing output fuses, or working on equipment within the enclosure, use the disconnect to shut off power to the rest of the system.

### p.35, communications cable (the same block appears twice on this page)
> WARNING: If you connect or disconnect the communications cable with power applied to this module or any device on the network, an electrical arc can occur. This could cause an explosion in hazardous location installations.
> Be sure that power is removed or the area is nonhazardous before proceeding.

### p.37, Wiring
> WARNING: Before you install and wire any device, disconnect power to the controller system.

> United States Only: If the controller is installed within a potentially hazardous environment, all wiring must comply with the requirements stated in the National Electrical Code 501-10 (b).

**What the Micro820 manual doesn't state:** it never uses "lockout", "tagout" or "LOTO".

## 3. S7-1200 system manual: siemens/siemens-s7-1200-system-manual-A5E02486680-AQ-2024-12-en.pdf
Edition: "System Manual, V4.7 12/2024, A5E02486680-AQ".

### p.3, Warning notice system (definitions)
> WARNING indicates that death or severe personal injury may result if proper precautions are not taken.

### p.46, Installation and removal
> WARNING — Installation or removal of S7-1200 devices with power applied
> Installation or removal of S7-1200 or related equipment with the power applied can cause electric shock or unexpected operation of equipment.
> Always follow appropriate safety precautions and ensure that power to the S7-1200 is disabled before attempting to install or remove S7-1200 CPUs or related equipment.
> Failure to disable all power to the S7-1200 and related equipment during installation or removal procedures can result in death, severe personal injury and/or property damage due to electric shock or unexpected equipment operation.

### p.47, flammable atmosphere
> WARNING — Risks when working in a flammable or combustible atmosphere
> Disconnection of equipment when a flammable or combustible atmosphere is present can cause a fire or explosion.
> Do not disconnect equipment when a flammable or combustible atmosphere is present. [...]

### pp.47–48, procedure step that recurs in the mounting and removal tables
> Ensure that the CPU and all S7-1200 equipment are disconnected from electrical power.

### p.41, Installation guidelines
> WARNING — Risks associated with improper installation. Improper installation of the S7-1200 can result in electrical faults or unexpected operation of machinery. [...]

### p.56, Wiring guidelines
> WARNING — Risk of unexpected equipment operation. Control devices can fail in unsafe conditions, resulting in unexpected equipment operation. Use an emergency stop function, electromechanical overrides, or other redundant safeguards that are independent of the S7-1200. [...]

> WARNING — Risk of electrocution with use of non-isolated or single insulation supplies. [...] Do not use non-isolated or single insulation supplies to supply low voltage circuits from an AC line. [...]

> Isolation boundaries between 24 V DC circuits are functional only, and you should not depend on these boundaries for safety.

**What the S7-1200 manual doesn't state:** it never uses "lockout", "tagout" or "LOTO". The working phrase is "disabled" / "disconnected from electrical power".

## Edition traps
- **PF525 wait time:** the 3-minute wait is from edition O (Sept 2025). We hold no other edition, so we have not checked whether older editions or other PowerFlex families give a different time. Large PowerFlex drives use longer waits, so don't carry the 3-minute figure over to them. Within edition O, the p.13 text does not vary by frame size, and the manual says the discharge "may take several minutes". The manual itself puts the measurement to zero volts ahead of the timer.
- **PF525 page numbers:** cite them with edition O. Page numbers can shift in other editions.
- **PF525 110V 1-phase drives:** they have no DC bus terminals (p.36).
- **Micro820:** quotes are from edition H. Its explosion-hazard wording applies to hazardous-location installations.
- **S7-1200:** these quotes are from the classic V4.7 (12/2024) manual only. Re-check page numbers in the G2 manual (A5E52923928), which is a different document.
- **None of the three manuals uses "LOTO" or "lockout/tagout".** If an answer mentions lockout/tagout, it has to cite site or regulatory rules, not these OEM manuals.
