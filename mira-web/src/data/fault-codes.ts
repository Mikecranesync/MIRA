/**
 * Structured fault code data for programmatic SEO blog pages.
 * Each entry generates a /blog/:slug page targeting maintenance technician searches.
 */

export interface FaultCode {
  slug: string;
  title: string;
  equipment: string;
  manufacturer: string;
  faultCode: string;
  description: string;
  commonCauses: string[];
  recommendedFix: string;
  relatedCodes: string[];
  metaDescription: string;
}

export const FAULT_CODES: FaultCode[] = [
  // ── Allen-Bradley CompactLogix / ControlLogix ──
  {
    slug: "allen-bradley-fault-01-watchdog",
    title: "Allen-Bradley Fault 01 — Watchdog Timeout",
    equipment: "Allen-Bradley CompactLogix / ControlLogix",
    manufacturer: "Allen-Bradley",
    faultCode: "Fault 01",
    description:
      "A watchdog timeout fault indicates the controller's scan time exceeded the configured watchdog timer. The controller halts execution to prevent unpredictable outputs.",
    commonCauses: [
      "Program scan time exceeds watchdog timer setting",
      "Excessive math or loop operations in a single scan",
      "Communication module consuming too many resources",
      "Firmware bug or corrupted project file",
    ],
    recommendedFix:
      "1. Check the watchdog timer setting in Controller Properties — increase if the scan time legitimately needs more time.\n2. Profile the task scan times in RSLogix 5000 / Studio 5000 under Task Properties → Scan Time.\n3. Break heavy computations into multiple scans using state machines.\n4. If the fault persists after tuning, reflash the controller firmware and reload the project.",
    relatedCodes: ["allen-bradley-fault-16-io-not-responding"],
    metaDescription:
      "Allen-Bradley Fault 01 watchdog timeout: common causes, step-by-step fix, and when to increase your scan time. Free diagnostic help from FactoryLM.",
  },
  {
    slug: "allen-bradley-fault-16-io-not-responding",
    title: "Allen-Bradley Fault 16 — I/O Not Responding",
    equipment: "Allen-Bradley CompactLogix / ControlLogix",
    manufacturer: "Allen-Bradley",
    faultCode: "Fault 16",
    description:
      "I/O Not Responding means one or more I/O modules on the backplane or remote rack have lost communication with the controller. Outputs on the affected module go to their configured fault state.",
    commonCauses: [
      "Loose or damaged backplane connection",
      "I/O module hardware failure",
      "EtherNet/IP network interruption to remote rack",
      "RPI (Requested Packet Interval) set too aggressively for the network",
      "Power supply droop causing module brownout",
    ],
    recommendedFix:
      "1. Open I/O tree in Studio 5000 — identify which module shows a red X.\n2. Reseat the module firmly into the backplane.\n3. Check the power supply voltage at the backplane (24VDC within ±10%).\n4. For remote I/O, verify the EtherNet/IP cable and switch port LEDs.\n5. If a single module repeatedly faults, swap it with a known-good spare.",
    relatedCodes: ["allen-bradley-fault-01-watchdog"],
    metaDescription:
      "Allen-Bradley Fault 16 I/O Not Responding: how to find the faulted module, check the backplane, and restore communication. Free help from FactoryLM.",
  },
  {
    slug: "allen-bradley-fault-04-recoverable",
    title: "Allen-Bradley Fault 04 — Recoverable I/O Fault",
    equipment: "Allen-Bradley CompactLogix / ControlLogix",
    manufacturer: "Allen-Bradley",
    faultCode: "Fault 04",
    description:
      "A recoverable I/O fault signals that an I/O module reported an error that does not require a full controller reset. The controller continues to run but the affected module data may be stale.",
    commonCauses: [
      "Momentary communication loss to an I/O module",
      "Module firmware version mismatch with controller",
      "Intermittent cable or connector issue",
      "Module configuration changed while online",
    ],
    recommendedFix:
      "1. Check the module fault code in the I/O tree for the specific error.\n2. Verify firmware compatibility between the module and controller (use Rockwell Compatibility Matrix).\n3. Inspect cables and connectors for intermittent physical issues.\n4. Clear the fault via the CLR Major Fault routine or a GSV/SSV instruction in your logic.",
    relatedCodes: ["allen-bradley-fault-16-io-not-responding"],
    metaDescription:
      "Allen-Bradley Fault 04 recoverable I/O fault: causes, how to check module status, and clearing the fault without a full reset.",
  },

  // ── PowerFlex VFDs ──
  {
    slug: "powerflex-f012-overcurrent",
    title: "PowerFlex Fault F012 — HW Overcurrent",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F012",
    description:
      "F012 indicates the drive's hardware overcurrent protection tripped. The instantaneous current exceeded the drive's rating, shutting down the output to protect the IGBTs.",
    commonCauses: [
      "Short circuit in motor cables or motor windings",
      "Ground fault between motor leads and conduit",
      "Drive undersized for the motor load",
      "Acceleration time set too aggressively",
      "Damaged or degraded IGBT module inside the drive",
    ],
    recommendedFix:
      "1. Disconnect the motor cables at the drive output terminals and megger-test the motor (should read >1 MΩ to ground).\n2. Check motor cable insulation for damage, especially at conduit entries.\n3. If motor and cables pass, increase the acceleration time (Parameter 42 on PF525).\n4. Verify the drive's rated current matches or exceeds the motor FLA on the nameplate.\n5. If F012 recurs with no motor connected, the drive's IGBT module has failed — replace the drive.",
    relatedCodes: [
      "powerflex-f013-ground-fault",
      "powerflex-f002-auxiliary-input",
    ],
    metaDescription:
      "PowerFlex F012 overcurrent fault: motor megger test, cable inspection, accel time tuning, and when to replace the drive. Step-by-step guide.",
  },
  {
    slug: "powerflex-f013-ground-fault",
    title: "PowerFlex Fault F013 — Ground Fault",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F013",
    description:
      "F013 means the drive detected current leaking to ground on the output side. This protects personnel and equipment from insulation breakdown.",
    commonCauses: [
      "Damaged motor cable insulation (especially in wet or corrosive environments)",
      "Motor winding insulation breakdown",
      "Condensation inside the motor junction box",
      "Output cable too long without an output reactor",
    ],
    recommendedFix:
      "1. Disconnect motor cables at the drive and megger each phase to ground (expect >1 MΩ).\n2. If megger fails, isolate whether the fault is in the cable run or the motor by testing each separately.\n3. Inspect the motor junction box for moisture or contamination.\n4. For cable runs over 100m, install an output reactor (dV/dt filter) at the drive output.\n5. Repair or replace the faulted cable/motor.",
    relatedCodes: ["powerflex-f012-overcurrent"],
    metaDescription:
      "PowerFlex F013 ground fault: how to megger-test motor cables, find insulation breakdown, and fix ground current leakage.",
  },
  {
    slug: "powerflex-f002-auxiliary-input",
    title: "PowerFlex Fault F002 — Auxiliary Input",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F002",
    description:
      "F002 indicates an external fault signal was received on one of the drive's digital inputs configured as a fault input. This is typically wired to an external safety device or overload relay.",
    commonCauses: [
      "External overload relay tripped",
      "E-stop circuit opened",
      "Safety interlock opened (guard door, pull cord, light curtain)",
      "Wiring fault on the digital input circuit",
    ],
    recommendedFix:
      "1. Identify which digital input is configured as the auxiliary fault (check Parameter 361–366 on PF525).\n2. Trace the wiring back to the external device.\n3. Reset the external device (overload relay, E-stop) if the condition has cleared.\n4. Verify 24VDC is present at the digital input when the external device is in the run-permissive state.\n5. If the wiring checks out and the external device is healthy, check for a loose terminal or broken wire.",
    relatedCodes: ["powerflex-f012-overcurrent"],
    metaDescription:
      "PowerFlex F002 auxiliary input fault: trace the external fault wiring, identify the tripped device, and restore the drive to run.",
  },
  {
    slug: "powerflex-f033-auto-manual",
    title: "PowerFlex Fault F033 — Auto/Manual Fault",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F033",
    description:
      "F033 occurs when the drive's command source or speed reference source changes unexpectedly, or a conflict exists between the configured source and the actual input state.",
    commonCauses: [
      "Speed reference source parameter changed while drive is running",
      "Communication loss to PLC providing speed reference over EtherNet/IP",
      "Conflicting start commands from multiple sources (keypad + network)",
      "Incorrect parameter configuration after a parameter reset",
    ],
    recommendedFix:
      "1. Check Parameter 545 (Start Inhibit) — clear any active inhibit.\n2. Verify the command source (P046) and speed reference (P047) match your intended control method.\n3. If using network control, confirm EtherNet/IP adapter is connected and the PLC is writing to the correct assembly instance.\n4. If the fault appeared after a parameter reset, reconfigure the drive from your saved parameter file.",
    relatedCodes: ["powerflex-f002-auxiliary-input"],
    metaDescription:
      "PowerFlex F033 auto/manual fault: fix command source conflicts, restore network control, and clear start inhibits.",
  },
  {
    slug: "powerflex-f041-heatsink-overtemp",
    title: "PowerFlex Fault F041 — Heatsink Overtemp",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F041",
    description:
      "F041 means the drive's internal heatsink temperature exceeded the safe operating threshold. The drive shuts down to prevent thermal damage to the power electronics.",
    commonCauses: [
      "Blocked or dirty cooling fan / air filter",
      "Ambient temperature above drive rating (typically 40°C / 104°F)",
      "Enclosure ventilation inadequate for heat dissipation",
      "Drive operating above rated current continuously",
      "Failed internal cooling fan",
    ],
    recommendedFix:
      "1. Check and clean the drive's cooling fan and air intake. Replace the fan if it's not spinning.\n2. Measure ambient temperature inside the enclosure — add ventilation or A/C if above 40°C.\n3. Verify the motor FLA does not exceed the drive's continuous current rating.\n4. Allow the drive to cool, then reset. If F041 recurs immediately, the temperature sensor may be faulty.",
    relatedCodes: ["powerflex-f012-overcurrent"],
    metaDescription:
      "PowerFlex F041 heatsink overtemp: clean the fan, check enclosure ventilation, verify current ratings. Step-by-step cooling fix.",
  },

  // ── AutomationDirect GS20 VFDs ──
  {
    slug: "gs20-eoc-overcurrent",
    title: "GS20 Fault E.OC — Overcurrent During Operation",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.OC",
    description:
      "E.OC indicates the drive's output current exceeded the overcurrent trip level during normal operation. Unlike E.OCA (acceleration) or E.OCD (deceleration), this trips during steady-state running.",
    commonCauses: [
      "Sudden mechanical load increase (jam, binding, slug loading)",
      "Motor winding degradation causing higher current draw",
      "Incorrect motor parameters (P01.01 rated current set too low)",
      "V/Hz curve mismatch for the motor type",
    ],
    recommendedFix:
      "1. Check the mechanical load — look for jammed product, seized bearings, or broken couplings.\n2. Clamp-meter the motor current and compare to the nameplate FLA.\n3. Verify P01.01 (motor rated current) matches the motor nameplate.\n4. If the load is legitimate, consider upsizing the drive or motor.\n5. Reset with the STOP/RESET key after clearing the mechanical issue.",
    relatedCodes: ["gs20-eou-overvoltage", "gs20-eoh-overheating"],
    metaDescription:
      "GS20 E.OC overcurrent during operation: check the mechanical load, verify motor parameters, and clear the fault. Free diagnostic guide.",
  },
  {
    slug: "gs20-eou-overvoltage",
    title: "GS20 Fault E.OU — DC Bus Overvoltage",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.OU",
    description:
      "E.OU means the internal DC bus voltage exceeded the overvoltage threshold. This typically happens during deceleration when the motor acts as a generator and pumps energy back into the drive.",
    commonCauses: [
      "Deceleration time too short for the load inertia",
      "No braking resistor installed on a high-inertia load",
      "Incoming power voltage above drive rating (check with multimeter)",
      "Regenerative energy from an overhauling load (crane, elevator, downhill conveyor)",
    ],
    recommendedFix:
      "1. Increase the deceleration time (P01.13) — try doubling it first.\n2. If the load has high inertia (fans, centrifuges, flywheels), install a dynamic braking resistor on the DB terminals.\n3. Measure incoming line voltage — should be within ±10% of drive rating.\n4. Enable stall prevention if available (P07.12) to auto-extend decel on overvoltage.\n5. For overhauling loads, a braking resistor is mandatory.",
    relatedCodes: ["gs20-eoc-overcurrent"],
    metaDescription:
      "GS20 E.OU overvoltage fault: increase decel time, install a braking resistor, and check your line voltage. Complete troubleshooting guide.",
  },
  {
    slug: "gs20-eoh-overheating",
    title: "GS20 Fault E.OH — Drive Overheating",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.OH",
    description:
      "E.OH indicates the drive's internal temperature sensor detected excessive heat. The drive trips to protect the power electronics from thermal damage.",
    commonCauses: [
      "Ambient temperature above 40°C (104°F)",
      "Blocked ventilation around the drive",
      "Drive mounted too close to other heat-generating equipment",
      "Internal fan failure (on frame sizes with active cooling)",
      "Continuous operation above rated current",
    ],
    recommendedFix:
      "1. Verify the ambient temperature inside the enclosure is below 40°C.\n2. Ensure minimum clearances: 50mm above/below, 25mm sides.\n3. Check that the internal fan spins freely (applicable to larger frame sizes).\n4. Reduce the load or upgrade to a higher-rated drive if continuously overloading.\n5. Allow the drive to cool before resetting.",
    relatedCodes: ["gs20-eoc-overcurrent", "gs20-eou-overvoltage"],
    metaDescription:
      "GS20 E.OH overheating fault: check ambient temp, enclosure ventilation, and fan operation. Cooling troubleshooting for AutomationDirect drives.",
  },
  {
    slug: "gs20-eoca-overcurrent-accel",
    title: "GS20 Fault E.OCA — Overcurrent During Acceleration",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.OCA",
    description:
      "E.OCA means the output current exceeded the trip level specifically during motor acceleration. The high inrush required to accelerate the load tripped the drive's protection.",
    commonCauses: [
      "Acceleration time too short (P01.12) for the load inertia",
      "Motor shaft mechanically locked or heavily loaded at startup",
      "Incorrect V/Hz boost setting (P01.07) causing excessive magnetizing current",
      "Drive undersized for the starting torque requirement",
    ],
    recommendedFix:
      "1. Increase acceleration time (P01.12) — start by doubling the current setting.\n2. Check that the motor shaft rotates freely by hand.\n3. Reduce the torque boost (P01.07) if set above factory default.\n4. Verify drive rated current ≥ motor FLA × 1.1.\n5. For high-inertia loads, consider S-curve acceleration (P01.16/P01.17).",
    relatedCodes: ["gs20-eoc-overcurrent"],
    metaDescription:
      "GS20 E.OCA overcurrent during acceleration: extend accel time, check torque boost, and verify drive sizing for your motor.",
  },

  // ── FANUC CNC ──
  {
    slug: "fanuc-414-servo-alarm-n-axis-excess-error",
    title: "FANUC Alarm 414 — Servo Alarm: N-Axis Excess Error",
    equipment: "FANUC CNC (Series 0i / 30i / 31i)",
    manufacturer: "FANUC",
    faultCode: "Alarm 414",
    description:
      "Alarm 414 (SV0414) triggers when the difference between the commanded position and actual position of a servo axis exceeds the threshold set in parameter 1828. The CNC halts axis motion.",
    commonCauses: [
      "Mechanical binding or collision on the axis",
      "Servo motor encoder cable damaged or disconnected",
      "Servo amplifier fault or low bus voltage",
      "Ball screw wear causing excessive backlash",
      "Gains too low for the axis load (parameter 1825/1826)",
    ],
    recommendedFix:
      "1. Jog the axis slowly — if it moves but alarms at speed, check the servo gains and mechanical resistance.\n2. Inspect the encoder cable for damage, especially at flex points.\n3. Check the servo amplifier for alarm LEDs (refer to amplifier manual for codes).\n4. Measure backlash on the ball screw and compare to machine specification.\n5. Temporarily increase the excess error threshold (parameter 1828) to diagnose, but restore it after.",
    relatedCodes: ["fanuc-410-servo-alarm-excess-error-decel"],
    metaDescription:
      "FANUC Alarm 414 servo excess error: check encoder cables, servo gains, and mechanical binding. CNC troubleshooting guide.",
  },
  {
    slug: "fanuc-410-servo-alarm-excess-error-decel",
    title: "FANUC Alarm 410 — Servo Alarm: Excess Error (Deceleration)",
    equipment: "FANUC CNC (Series 0i / 30i / 31i)",
    manufacturer: "FANUC",
    faultCode: "Alarm 410",
    description:
      "Alarm 410 (SV0410) occurs when the position error exceeds the threshold during deceleration or stop. The axis failed to reach its commanded position within the allowed following error window.",
    commonCauses: [
      "Mechanical resistance or obstruction during deceleration",
      "Servo motor or amplifier failure",
      "Encoder feedback noise or intermittent signal loss",
      "Deceleration parameter mismatch with actual axis dynamics",
    ],
    recommendedFix:
      "1. Check for physical obstruction or excessive friction on the axis.\n2. Swap the encoder cable with a known-good one to rule out signal noise.\n3. Monitor the servo amplifier alarm display for additional codes.\n4. Verify the in-position width (parameter 1826) and servo loop gain (parameter 1825).\n5. If mechanical and electrical checks pass, back up parameters and reload servo configuration.",
    relatedCodes: ["fanuc-414-servo-alarm-n-axis-excess-error"],
    metaDescription:
      "FANUC Alarm 410 excess error during deceleration: troubleshoot servo feedback, encoder cables, and axis friction.",
  },

  // ── Siemens S7 / SINAMICS ──
  {
    slug: "siemens-f07011-motor-overtemp",
    title: "Siemens SINAMICS Fault F07011 — Motor Overtemperature",
    equipment: "Siemens SINAMICS G120 / S120",
    manufacturer: "Siemens",
    faultCode: "F07011",
    description:
      "F07011 indicates the motor temperature calculated by the drive's I²t thermal model (or measured by a PTC/KTY sensor) exceeded the warning/trip threshold. The drive shuts down to prevent motor insulation damage.",
    commonCauses: [
      "Motor operating above rated current for extended periods",
      "Ambient temperature above motor nameplate rating",
      "Blocked motor cooling fan (on TEFC motors, external fan failure)",
      "Incorrect motor thermal data in drive parameters (P0335, P0340)",
      "Motor PTC sensor wiring fault giving a false overtemp signal",
    ],
    recommendedFix:
      "1. Check the motor temperature using an IR thermometer — compare to motor nameplate max temp.\n2. Verify the external cooling fan is running (common failure on 1LA7 motors).\n3. Check drive parameters P0335 (motor cooling type) and P0340 (motor thermal time constant) match the motor.\n4. If using a PTC/KTY sensor, measure the sensor resistance — PTC should read <1.5kΩ when cool.\n5. Reduce the load or duty cycle if the motor is genuinely overheating.",
    relatedCodes: ["siemens-f30011-heatsink-overtemp"],
    metaDescription:
      "Siemens SINAMICS F07011 motor overtemp: check cooling fans, thermal model parameters, and PTC sensor wiring. Troubleshooting guide.",
  },
  {
    slug: "siemens-f30011-heatsink-overtemp",
    title: "Siemens SINAMICS Fault F30011 — Power Module Overtemperature",
    equipment: "Siemens SINAMICS G120 / S120",
    manufacturer: "Siemens",
    faultCode: "F30011",
    description:
      "F30011 means the power module's heatsink temperature exceeded the maximum allowed value. The drive trips to protect the IGBT power semiconductors from thermal destruction.",
    commonCauses: [
      "Blocked or failed cooling fan on the power module",
      "Ambient temperature inside the cabinet exceeds 40°C",
      "Switching frequency set too high (P1800) for the load",
      "Continuous operation above rated output current",
      "Dust accumulation on heatsink fins",
    ],
    recommendedFix:
      "1. Check the power module fan — it should spin freely and produce airflow. Replace if stalled.\n2. Measure cabinet internal temperature and add ventilation if above 40°C.\n3. Reduce the switching frequency (P1800) — lower values reduce IGBT losses.\n4. Clean dust from heatsink fins with compressed air (de-energized).\n5. Verify the drive is not continuously overloaded — check r0027 (motor current) vs rated current.",
    relatedCodes: ["siemens-f07011-motor-overtemp"],
    metaDescription:
      "Siemens SINAMICS F30011 power module overtemp: fan check, cabinet cooling, and switching frequency tuning.",
  },

  // ── Hydraulic Systems ──
  {
    slug: "hydraulic-high-oil-temperature",
    title: "Hydraulic System Fault — High Oil Temperature",
    equipment: "Hydraulic Power Units (HPU)",
    manufacturer: "General",
    faultCode: "High Oil Temp",
    description:
      "A high oil temperature alarm indicates the hydraulic fluid has exceeded the safe operating range (typically 60°C / 140°F). Hot oil degrades seals, reduces viscosity, and accelerates wear on pumps and valves.",
    commonCauses: [
      "Clogged or undersized heat exchanger (oil cooler)",
      "Low reservoir fluid level reducing heat dissipation",
      "Relief valve cracked or set too low, causing constant bypass heating",
      "Pump running at excessive pressure with internal leakage",
      "Wrong oil viscosity grade for the operating conditions",
    ],
    recommendedFix:
      "1. Check the oil cooler — clean fins, verify coolant flow (water or air), and confirm fan/pump operation.\n2. Verify reservoir oil level is at or above the minimum mark.\n3. Check the main relief valve setting against the circuit design pressure.\n4. Look for excessive internal leakage by checking pump case drain flow (should be <5% of pump output).\n5. Verify the oil viscosity grade matches the manufacturer's spec for ambient conditions.",
    relatedCodes: ["hydraulic-low-oil-level"],
    metaDescription:
      "Hydraulic high oil temperature: check the cooler, relief valve, reservoir level, and pump leakage. Complete troubleshooting for HPUs.",
  },
  {
    slug: "hydraulic-low-oil-level",
    title: "Hydraulic System Fault — Low Oil Level",
    equipment: "Hydraulic Power Units (HPU)",
    manufacturer: "General",
    faultCode: "Low Oil Level",
    description:
      "A low oil level fault means the reservoir fluid dropped below the minimum sensor threshold. Running the pump with low oil risks cavitation, aeration, and catastrophic pump failure.",
    commonCauses: [
      "External leak at a hose fitting, cylinder seal, or valve body",
      "Internal leak filling a cylinder or accumulator beyond normal volume",
      "Oil cooler leak (oil mixing with coolant water)",
      "Reservoir drain valve left open after maintenance",
      "Normal consumption not replenished on schedule",
    ],
    recommendedFix:
      "1. STOP the pump immediately — cavitation damage is irreversible.\n2. Visually inspect all hoses, fittings, and cylinders for external leaks.\n3. Check the oil cooler for oil-in-water contamination (milky coolant).\n4. Verify the reservoir drain valve is closed.\n5. Top off with the correct fluid to the proper level, then restart and monitor.",
    relatedCodes: ["hydraulic-high-oil-temperature"],
    metaDescription:
      "Hydraulic low oil level fault: find the leak, stop the pump, and prevent cavitation damage. Step-by-step troubleshooting guide.",
  },

  // ── Motor/Pump General ──
  {
    slug: "motor-high-vibration",
    title: "Motor Fault — High Vibration Alarm",
    equipment: "AC Induction Motors / Pumps",
    manufacturer: "General",
    faultCode: "High Vibration",
    description:
      "A high vibration alarm from a vibration sensor or PLC monitoring point indicates the motor or driven equipment is exceeding acceptable vibration levels (typically >7.1 mm/s RMS per ISO 10816).",
    commonCauses: [
      "Shaft misalignment between motor and driven equipment",
      "Unbalanced rotating element (impeller, coupling, fan)",
      "Worn or failed bearings (inner/outer race defect)",
      "Loose mounting bolts or soft foot condition",
      "Resonance at operating speed",
    ],
    recommendedFix:
      "1. Take vibration readings in horizontal, vertical, and axial directions at both bearings.\n2. Check mounting bolt torque and shim for soft foot.\n3. Laser-align the motor to the driven equipment.\n4. If bearing defect frequencies are present, plan a bearing replacement.\n5. For imbalance, have the rotating element dynamically balanced.",
    relatedCodes: ["motor-bearing-temperature-high"],
    metaDescription:
      "Motor high vibration alarm: check alignment, bearing condition, mounting bolts, and balance. ISO 10816 troubleshooting guide.",
  },
  {
    slug: "motor-bearing-temperature-high",
    title: "Motor Fault — Bearing Temperature High",
    equipment: "AC Induction Motors / Pumps",
    manufacturer: "General",
    faultCode: "Bearing Temp High",
    description:
      "A bearing temperature alarm indicates the motor bearing housing temperature (measured by RTD or thermocouple) exceeded the warning threshold, typically 80°C (176°F) for standard bearings.",
    commonCauses: [
      "Insufficient or degraded lubrication (grease dried out or wrong type)",
      "Over-greasing causing churning and heat buildup",
      "Bearing wear or spalling from fatigue",
      "Excessive belt tension or shaft misalignment increasing radial load",
      "Ambient temperature plus motor heat exceeding bearing rating",
    ],
    recommendedFix:
      "1. Check the grease condition — if dry or discolored, re-grease per the motor manufacturer's schedule and quantity.\n2. Do NOT over-grease — use the calculated volume (V = 0.005 × D × B where D = OD, B = width in mm).\n3. Listen for bearing noise with a stethoscope — rough, growling sound indicates damage.\n4. Check shaft alignment and belt tension.\n5. If the bearing is damaged (noise, excessive play), plan a replacement during the next scheduled downtime.",
    relatedCodes: ["motor-high-vibration"],
    metaDescription:
      "Motor bearing temperature high: check lubrication, alignment, belt tension, and bearing condition. Prevent bearing failure.",
  },

  // ── Allen-Bradley Micro820 ──
  {
    slug: "micro820-err-user-program",
    title: "Allen-Bradley Micro820 Fault — User Program Error",
    equipment: "Allen-Bradley Micro820 / Micro850",
    manufacturer: "Allen-Bradley",
    faultCode: "User Program Error",
    description:
      "A user program error on the Micro820 means the controller detected an invalid instruction or runtime error in the user program. The controller stops executing and all outputs go to their fault state.",
    commonCauses: [
      "Division by zero in math instruction",
      "Array index out of bounds",
      "Invalid pointer or indirect address reference",
      "Program corruption after incomplete download",
    ],
    recommendedFix:
      "1. Connect with Connected Components Workbench (CCW) and check the fault log for the specific instruction address.\n2. Review the flagged rung for division operations — add a pre-check for zero divisors.\n3. Verify array sizes match the index range used in your logic.\n4. Re-download the program from your saved project file.\n5. Clear the fault in CCW and switch to Run mode.",
    relatedCodes: ["allen-bradley-fault-01-watchdog"],
    metaDescription:
      "Micro820 user program error: find the faulted instruction in CCW, fix division by zero or array bounds, and re-download.",
  },
  {
    slug: "micro820-comms-timeout",
    title: "Allen-Bradley Micro820 Fault — Communication Timeout",
    equipment: "Allen-Bradley Micro820 / Micro850",
    manufacturer: "Allen-Bradley",
    faultCode: "Comms Timeout",
    description:
      "A communication timeout indicates the Micro820 lost contact with a configured peer device (Modbus TCP slave, EtherNet/IP target, or serial Modbus RTU device) for longer than the configured timeout period.",
    commonCauses: [
      "Network cable disconnected or damaged",
      "Modbus slave device powered off or not responding",
      "IP address conflict on the network",
      "Serial wiring fault (RS-485 A/B swap, missing termination resistor)",
      "Timeout parameter too short for the network latency",
    ],
    recommendedFix:
      "1. Ping the target device IP from a laptop on the same network to confirm reachability.\n2. For Modbus RTU, verify RS-485 wiring: A↔A, B↔B, and 120Ω termination at both ends.\n3. Check the Micro820's IP configuration and subnet mask in CCW.\n4. Increase the communication timeout in the MSG instruction configuration.\n5. Check for duplicate IP addresses using an ARP scan.",
    relatedCodes: ["allen-bradley-fault-16-io-not-responding"],
    metaDescription:
      "Micro820 communication timeout: check network cables, Modbus wiring, IP conflicts, and timeout settings. Troubleshooting guide.",
  },

  // ── ABB VFDs ──
  {
    slug: "abb-acs880-fault-2310-overcurrent",
    title: "ABB ACS880 Fault 2310 — Overcurrent",
    equipment: "ABB ACS880 / ACS580",
    manufacturer: "ABB",
    faultCode: "Fault 2310",
    description:
      "Fault 2310 indicates the drive output current exceeded the hardware overcurrent limit. The drive trips immediately to protect the power semiconductors.",
    commonCauses: [
      "Short circuit in motor cables",
      "Motor winding failure (phase-to-phase or phase-to-ground)",
      "Acceleration time too short for the mechanical load",
      "Drive undersized for the motor",
      "IGBT failure inside the drive",
    ],
    recommendedFix:
      "1. Disconnect motor cables at the drive U2/V2/W2 terminals.\n2. Megger-test the motor windings phase-to-phase and phase-to-ground (expect >1 MΩ).\n3. If motor passes, check cable insulation for damage.\n4. Increase the acceleration ramp time (parameter 22.02).\n5. If the fault trips with no motor connected, the drive has an internal IGBT failure.",
    relatedCodes: ["abb-acs880-fault-3220-earth-fault"],
    metaDescription:
      "ABB ACS880 Fault 2310 overcurrent: megger test motor, check cables, adjust accel ramp. Step-by-step troubleshooting.",
  },
  {
    slug: "abb-acs880-fault-3220-earth-fault",
    title: "ABB ACS880 Fault 3220 — Earth Fault",
    equipment: "ABB ACS880 / ACS580",
    manufacturer: "ABB",
    faultCode: "Fault 3220",
    description:
      "Fault 3220 means the drive detected leakage current to ground on the output phase. This is a safety-critical fault protecting against insulation breakdown.",
    commonCauses: [
      "Motor cable insulation damage (abrasion, rodent damage, heat)",
      "Motor winding insulation breakdown",
      "Moisture ingress into the motor or junction box",
      "Long cable runs causing capacitive leakage exceeding detection threshold",
    ],
    recommendedFix:
      "1. Disconnect motor cables from the drive and megger each phase to ground.\n2. If using long cables (>100m), check if the earth fault detection level (parameter 30.10) needs adjustment.\n3. Inspect motor junction box for moisture — dry and re-seal if wet.\n4. Test cable insulation separately from the motor by disconnecting at the motor terminal box.\n5. Replace any cable section that tests below 1 MΩ.",
    relatedCodes: ["abb-acs880-fault-2310-overcurrent"],
    metaDescription:
      "ABB ACS880 Fault 3220 earth fault: megger test, check cable insulation, inspect motor junction box for moisture.",
  },
  {
    slug: "abb-acs880-fault-7121-ai-supervision",
    title: "ABB ACS880 Fault 7121 — Analog Input Supervision",
    equipment: "ABB ACS880 / ACS580",
    manufacturer: "ABB",
    faultCode: "Fault 7121",
    description:
      "Fault 7121 triggers when an analog input (4-20mA or 0-10V) drops below the configured minimum supervision level. This typically means the sensor or transmitter has failed or lost its wiring.",
    commonCauses: [
      "Broken wire to the 4-20mA transmitter",
      "Transmitter power supply failure",
      "Sensor failure causing signal to drop below 4mA",
      "Loose terminal connection at the drive or transmitter",
    ],
    recommendedFix:
      "1. Measure the current at the drive's analog input terminal with a clamp meter (should be 4-20mA in normal operation).\n2. If <4mA, trace the wiring back to the transmitter.\n3. Verify 24VDC power at the transmitter.\n4. If the transmitter and wiring are healthy, check the analog input supervision parameters (12.03, 12.04).\n5. To temporarily bypass, set the AI supervision mode to 'Warning' instead of 'Fault' (parameter 30.06).",
    relatedCodes: ["abb-acs880-fault-2310-overcurrent"],
    metaDescription:
      "ABB ACS880 Fault 7121 analog input supervision: check 4-20mA wiring, transmitter power, and supervision parameters.",
  },

  // ── Yaskawa VFDs ──
  {
    slug: "yaskawa-oc-overcurrent",
    title: "Yaskawa Fault oC — Overcurrent",
    equipment: "Yaskawa GA800 / GA700 / A1000",
    manufacturer: "Yaskawa",
    faultCode: "oC",
    description:
      "The oC fault indicates the drive output current exceeded 200% of the drive's rated current. The drive shuts down immediately to protect the output transistors.",
    commonCauses: [
      "Motor cable short circuit",
      "Motor winding failure",
      "Sudden mechanical overload or jam",
      "Acceleration time too aggressive (C1-01 too low)",
      "Motor auto-tune not performed after motor replacement",
    ],
    recommendedFix:
      "1. Check motor and cable insulation with a megger (>1 MΩ to ground).\n2. Inspect the mechanical load — clear any jams.\n3. Increase the acceleration time (C1-01).\n4. Run motor auto-tune (T1-01) to update the drive's motor model.\n5. If oC trips at start with no load, the drive may have an internal fault.",
    relatedCodes: ["yaskawa-gf-ground-fault"],
    metaDescription:
      "Yaskawa oC overcurrent fault: check motor insulation, clear mechanical jams, increase accel time, and run auto-tune.",
  },
  {
    slug: "yaskawa-gf-ground-fault",
    title: "Yaskawa Fault GF — Ground Fault",
    equipment: "Yaskawa GA800 / GA700 / A1000",
    manufacturer: "Yaskawa",
    faultCode: "GF",
    description:
      "The GF fault means the drive detected a ground fault on the output side. Current is leaking from the motor circuit to ground, indicating an insulation failure.",
    commonCauses: [
      "Damaged motor cable insulation (conduit rub, chemical exposure)",
      "Motor winding failure to ground",
      "Moisture inside the motor or cable",
      "Long output cable without dV/dt filter",
    ],
    recommendedFix:
      "1. Disconnect motor cables from the drive.\n2. Megger each phase to ground — expect >1 MΩ.\n3. If the cable fails, isolate cable from motor and test each separately.\n4. For cable runs >50m, install a dV/dt filter or output reactor.\n5. Check the motor junction box for moisture and re-seal.",
    relatedCodes: ["yaskawa-oc-overcurrent", "yaskawa-ov-overvoltage"],
    metaDescription:
      "Yaskawa GF ground fault: megger test motor cables, check for moisture, and install output filters for long cable runs.",
  },
  {
    slug: "yaskawa-ov-overvoltage",
    title: "Yaskawa Fault oV — DC Bus Overvoltage",
    equipment: "Yaskawa GA800 / GA700 / A1000",
    manufacturer: "Yaskawa",
    faultCode: "oV",
    description:
      "The oV fault means the internal DC bus voltage exceeded the trip threshold. During deceleration, the motor's kinetic energy pumps voltage back into the drive faster than it can dissipate.",
    commonCauses: [
      "Deceleration time too short (C1-02) for the load inertia",
      "No dynamic braking resistor on a high-inertia load",
      "Input power voltage above the drive's rated range",
      "Regenerative load (downhill conveyors, cranes, centrifuges)",
    ],
    recommendedFix:
      "1. Increase the deceleration time (C1-02) — double it as a first step.\n2. Enable the stall prevention function during deceleration (L3-04 = 1).\n3. If inertia demands fast stops, install a dynamic braking resistor.\n4. Measure incoming line voltage with a multimeter — must be within ±10% of nameplate.\n5. For constant regeneration, consider a regen unit instead of a braking resistor.",
    relatedCodes: ["yaskawa-gf-ground-fault", "yaskawa-oc-overcurrent"],
    metaDescription:
      "Yaskawa oV overvoltage: increase decel time, enable stall prevention, install braking resistor. Complete troubleshooting guide.",
  },

  // ── Compressors ──
  {
    slug: "compressor-high-discharge-temperature",
    title: "Air Compressor Fault — High Discharge Temperature",
    equipment: "Rotary Screw Air Compressors",
    manufacturer: "General",
    faultCode: "High Discharge Temp",
    description:
      "A high discharge temperature fault means the compressed air leaving the compressor element exceeded the safe operating limit (typically 100–110°C / 212–230°F). The compressor shuts down to prevent oil degradation and element damage.",
    commonCauses: [
      "Dirty or clogged oil cooler (air or oil side)",
      "Low oil level in the sump",
      "Failed thermal bypass valve (oil bypasses the cooler permanently)",
      "Ambient temperature too high for the cooler capacity",
      "Clogged air intake filter restricting cooling airflow",
    ],
    recommendedFix:
      "1. Clean the oil cooler — blow compressed air through the fins opposite to normal airflow direction.\n2. Check the oil level through the sight glass and top off if low.\n3. Verify the thermal bypass valve opens when the oil is cool and routes through the cooler when hot.\n4. Replace the air intake filter if restricted.\n5. Ensure minimum 1m clearance around the compressor for ventilation.",
    relatedCodes: ["compressor-high-current"],
    metaDescription:
      "Air compressor high discharge temperature: clean the oil cooler, check oil level, verify thermal valve, and ensure ventilation.",
  },
  {
    slug: "compressor-high-current",
    title: "Air Compressor Fault — Motor High Current",
    equipment: "Rotary Screw Air Compressors",
    manufacturer: "General",
    faultCode: "High Current",
    description:
      "A high current fault indicates the compressor motor is drawing more current than the overload setting allows. The motor protector or VFD trips to prevent winding damage.",
    commonCauses: [
      "Low voltage supply (causing higher current to maintain load)",
      "Worn compressor element bearings increasing mechanical drag",
      "Oil separator element clogged (high backpressure on the element)",
      "Minimum pressure valve stuck closed",
      "Loose or corroded power connections causing voltage drop",
    ],
    recommendedFix:
      "1. Measure voltage at the motor terminals under load — should be within ±10% of nameplate.\n2. Check the differential pressure across the oil separator — replace if >1 bar / 15 psi above baseline.\n3. Verify the minimum pressure valve opens above its set point (~4.5 bar / 65 psi).\n4. Inspect motor terminal connections for corrosion or looseness.\n5. If current is high at unloaded state, suspect compressor element bearing wear.",
    relatedCodes: ["compressor-high-discharge-temperature"],
    metaDescription:
      "Air compressor high current fault: check supply voltage, oil separator, minimum pressure valve, and motor connections.",
  },
  {
    slug: "compressor-low-oil-pressure",
    title: "Air Compressor Fault — Low Oil Pressure",
    equipment: "Rotary Screw Air Compressors",
    manufacturer: "General",
    faultCode: "Low Oil Pressure",
    description:
      "A low oil pressure fault means the oil pressure sensor detected insufficient lubrication pressure for the compressor element. Without adequate oil, the screw elements can seize within seconds.",
    commonCauses: [
      "Low oil level (consumption, leak, or foaming)",
      "Clogged oil filter restricting flow",
      "Failed oil pump (on pressure-lubricated models)",
      "Oil pressure sensor malfunction",
      "Wrong oil type causing excessive foaming",
    ],
    recommendedFix:
      "1. STOP immediately — low oil damages the element within seconds.\n2. Check the oil level through the sight glass. Top off with the manufacturer-specified oil.\n3. Replace the oil filter if the pressure differential exceeds spec.\n4. Inspect for external oil leaks at fittings, hoses, and the separator tank.\n5. If oil is foaming, drain and replace with the correct compressor oil grade.",
    relatedCodes: ["compressor-high-discharge-temperature"],
    metaDescription:
      "Air compressor low oil pressure: stop immediately, check oil level, replace filter, inspect for leaks. Prevent element seizure.",
  },

  // ── Conveyor Systems ──
  {
    slug: "conveyor-belt-slip-fault",
    title: "Conveyor Fault — Belt Slip Detected",
    equipment: "Belt Conveyors",
    manufacturer: "General",
    faultCode: "Belt Slip",
    description:
      "A belt slip fault indicates the speed sensor detected a difference between the drive pulley speed and belt speed exceeding the configured threshold. This means the belt is sliding on the drive pulley instead of tracking properly.",
    commonCauses: [
      "Insufficient belt tension",
      "Wet or contaminated drive pulley (oil, dust, ice)",
      "Worn or glazed pulley lagging",
      "Overloaded conveyor exceeding drive traction capacity",
      "Speed sensor malfunction or misalignment",
    ],
    recommendedFix:
      "1. Check belt tension — adjust the take-up (gravity or screw type) to manufacturer specification.\n2. Clean the drive pulley surface and remove any contamination.\n3. Inspect the pulley lagging (rubber or ceramic) for wear — replace if smooth or detached.\n4. Reduce the load if the conveyor is consistently overloaded.\n5. Verify the speed sensor alignment and gap to the target wheel.",
    relatedCodes: ["conveyor-belt-tracking-fault"],
    metaDescription:
      "Conveyor belt slip fault: check tension, clean the drive pulley, inspect lagging, and verify speed sensor alignment.",
  },
  {
    slug: "conveyor-belt-tracking-fault",
    title: "Conveyor Fault — Belt Tracking / Misalignment",
    equipment: "Belt Conveyors",
    manufacturer: "General",
    faultCode: "Belt Misalignment",
    description:
      "A belt tracking fault means the belt has moved laterally off-center, triggering a misalignment switch or sensor. If uncorrected, the belt edge can damage the frame, spill material, or derail completely.",
    commonCauses: [
      "Uneven loading (material not centered on the belt)",
      "Misaligned idler rollers or return rollers",
      "Splice not square to the belt direction of travel",
      "Seized or stuck roller causing the belt to walk",
      "Frame or structure not level",
    ],
    recommendedFix:
      "1. Check where the belt is tracking off — observe from the tail to the head.\n2. Adjust the idler closest to where mistracking starts: pivot the upstream end of the idler toward the direction the belt is running off.\n3. Verify the material is loading centered on the belt — adjust the chute or skirtboard.\n4. Check for seized rollers and replace them.\n5. Verify the conveyor frame is level and square using a string line.",
    relatedCodes: ["conveyor-belt-slip-fault"],
    metaDescription:
      "Conveyor belt tracking fault: adjust idlers, center the load, check for seized rollers, and level the frame. Alignment guide.",
  },

  // ── Pneumatic Systems ──
  {
    slug: "pneumatic-low-air-pressure",
    title: "Pneumatic System Fault — Low Air Pressure",
    equipment: "Pneumatic Systems / Air Preparation Units",
    manufacturer: "General",
    faultCode: "Low Air Pressure",
    description:
      "A low air pressure fault means the system pressure dropped below the minimum threshold required for reliable actuator operation. Pneumatic cylinders and valves may operate slowly, weakly, or not at all.",
    commonCauses: [
      "Air leak in supply lines, fittings, or cylinders",
      "Compressor unable to keep up with demand",
      "Clogged air filter/regulator at the FRL unit",
      "Regulator set too low or failed",
      "Drain valve on the receiver tank stuck open",
    ],
    recommendedFix:
      "1. Check the main air receiver pressure — if low, the compressor can't keep up (see compressor faults).\n2. Perform a leak audit: pressurize the system, shut off supply, monitor the pressure drop rate.\n3. Use an ultrasonic leak detector to pinpoint leaks at fittings and cylinders.\n4. Inspect and clean the FRL filter element — replace if clogged.\n5. Verify the regulator output pressure matches the system requirement (typically 6 bar / 90 psi).",
    relatedCodes: ["compressor-high-discharge-temperature"],
    metaDescription:
      "Pneumatic low air pressure: check for leaks, inspect the FRL, verify compressor capacity, and audit the system. Troubleshooting guide.",
  },

  // ── More Siemens ──
  {
    slug: "siemens-f01001-overcurrent",
    title: "Siemens SINAMICS Fault F01001 — Overcurrent",
    equipment: "Siemens SINAMICS G120 / S120",
    manufacturer: "Siemens",
    faultCode: "F01001",
    description:
      "F01001 indicates the drive's output current exceeded the hardware overcurrent limit. The Control Unit shuts down the pulse pattern immediately to protect the IGBTs.",
    commonCauses: [
      "Short circuit in motor cables or motor windings",
      "Ground fault on the output side",
      "Motor auto-identification (P1910) not completed after motor replacement",
      "Ramp time (P1120) too short for the load inertia",
      "IGBT module failure inside the power module",
    ],
    recommendedFix:
      "1. Disconnect the motor cables from U, V, W terminals and megger-test.\n2. If motor and cables pass, re-run motor identification (P1910 = 1, commission).\n3. Increase the ramp-up time (P1120).\n4. Check for ground faults in the cable run.\n5. If F01001 persists with no motor connected, the power module needs replacement.",
    relatedCodes: [
      "siemens-f30011-heatsink-overtemp",
      "siemens-f07011-motor-overtemp",
    ],
    metaDescription:
      "Siemens SINAMICS F01001 overcurrent: megger test motor, re-run identification, increase ramp time. Troubleshooting guide.",
  },
  {
    slug: "siemens-f07900-motor-locked-rotor",
    title: "Siemens SINAMICS Fault F07900 — Motor Stall / Locked Rotor",
    equipment: "Siemens SINAMICS G120 / S120",
    manufacturer: "Siemens",
    faultCode: "F07900",
    description:
      "F07900 triggers when the drive detects the motor is stalled (rotor not turning despite current flowing). This protects the motor from thermal damage due to locked-rotor current.",
    commonCauses: [
      "Mechanical blockage preventing motor rotation",
      "Coupling or gearbox failure locking the shaft",
      "Bearing seizure",
      "Overload exceeding the motor's breakdown torque",
      "Incorrect motor data in the drive causing false detection",
    ],
    recommendedFix:
      "1. Disconnect the motor from the load and try to start it unloaded.\n2. Rotate the motor shaft by hand — it should turn freely.\n3. Inspect the coupling, gearbox, and driven equipment for binding.\n4. Verify motor nameplate data matches drive parameters (P0304 voltage, P0305 current, P0307 power, P0310 frequency).\n5. If the motor runs freely but faults when coupled, the mechanical load is too high.",
    relatedCodes: ["siemens-f01001-overcurrent"],
    metaDescription:
      "Siemens SINAMICS F07900 motor stall: check for mechanical blockage, verify motor data, and inspect the coupling and gearbox.",
  },

  // ── More PowerFlex ──
  {
    slug: "powerflex-f064-software-overcurrent",
    title: "PowerFlex Fault F064 — Software Overcurrent",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F064",
    description:
      "F064 is a software-level overcurrent fault, distinct from F012 (hardware). The drive's firmware calculated that the output current exceeded 150% of the rated current for the configured time, and tripped before the hardware limit.",
    commonCauses: [
      "Sustained overload condition just under hardware trip level",
      "Motor nameplate current parameter (P041) set lower than actual FLA",
      "Marginal motor cable insulation causing intermittent leakage",
      "Application exceeding the drive's duty cycle rating",
    ],
    recommendedFix:
      "1. Compare P041 (motor rated current) with the actual motor nameplate FLA — adjust if wrong.\n2. Clamp-meter the output current during normal operation — if consistently >100% of drive rating, upsize the drive.\n3. Check if the application is cyclic — the drive may need to be rated for heavy-duty instead of normal-duty.\n4. Inspect motor cable insulation for marginal faults that don't trip F012 but cause elevated current.",
    relatedCodes: ["powerflex-f012-overcurrent", "powerflex-f041-heatsink-overtemp"],
    metaDescription:
      "PowerFlex F064 software overcurrent: check motor parameter settings, measure actual load current, and verify drive duty rating.",
  },
  {
    slug: "powerflex-f070-power-loss",
    title: "PowerFlex Fault F070 — Power Loss",
    equipment: "PowerFlex 525 / 753 / 755",
    manufacturer: "Allen-Bradley",
    faultCode: "F070",
    description:
      "F070 indicates the drive detected a drop in the DC bus voltage below the minimum operating level, typically caused by a momentary or sustained loss of input AC power.",
    commonCauses: [
      "Incoming power interruption (utility sag, transfer switch)",
      "Loose input power connections",
      "Blown input fuse or tripped breaker",
      "Contactor in the power feed opening unexpectedly",
      "Power supply voltage too low for the drive rating",
    ],
    recommendedFix:
      "1. Check the incoming power — measure voltage at the drive's L1/L2/L3 terminals.\n2. Inspect input fuses and the upstream breaker.\n3. Tighten all input power connections.\n4. If using a contactor ahead of the drive, verify it stays closed during operation.\n5. For frequent sags, consider enabling the ride-through function (kinetic buffering) if supported.",
    relatedCodes: ["powerflex-f012-overcurrent"],
    metaDescription:
      "PowerFlex F070 power loss: check incoming voltage, inspect fuses and connections, verify upstream contactor. Troubleshooting guide.",
  },

  // ── More FANUC ──
  {
    slug: "fanuc-401-servo-alarm-vrdy-off",
    title: "FANUC Alarm 401 — Servo Alarm: VRDY Off",
    equipment: "FANUC CNC (Series 0i / 30i / 31i)",
    manufacturer: "FANUC",
    faultCode: "Alarm 401",
    description:
      "Alarm 401 (SV0401) indicates the servo amplifier's VRDY (Voltage Ready) signal is off. The amplifier is not ready to drive the motor, typically due to a power supply or hardware issue in the servo system.",
    commonCauses: [
      "Servo amplifier internal fault (LED alarm on the amplifier unit)",
      "DC bus power supply failure",
      "Emergency stop circuit not fully released",
      "Contactor for servo power not closing",
      "Servo amplifier fuse blown",
    ],
    recommendedFix:
      "1. Check the servo amplifier LED display for an alarm code — refer to the amplifier maintenance manual.\n2. Verify the emergency stop circuit is fully released and the servo-on relay is energized.\n3. Check the magnetic contactor for servo power — it should close when the machine is enabled.\n4. Measure the DC bus voltage at the power supply module — should be ~300VDC for 200V class.\n5. If a specific axis amplifier has a blown fuse, replace and investigate the root cause.",
    relatedCodes: ["fanuc-414-servo-alarm-n-axis-excess-error"],
    metaDescription:
      "FANUC Alarm 401 VRDY off: check servo amplifier LEDs, E-stop circuit, power contactor, and DC bus voltage.",
  },
  {
    slug: "fanuc-300-series-overheat-alarm",
    title: "FANUC Alarm 306 — Servo Overheating",
    equipment: "FANUC CNC (Series 0i / 30i / 31i)",
    manufacturer: "FANUC",
    faultCode: "Alarm 306",
    description:
      "Alarm 306 (OVH) triggers when the servo motor's built-in thermal sensor detects excessive temperature. The axis is disabled to prevent motor demagnetization and winding damage.",
    commonCauses: [
      "Continuous operation at or near maximum torque",
      "Machine cutting parameters too aggressive (feed rate, depth of cut)",
      "Servo motor cooling fan failed or blocked",
      "Axis mechanical resistance too high (tight gibs, contaminated ways)",
      "Ambient temperature in the machine enclosure too high",
    ],
    recommendedFix:
      "1. Let the motor cool — alarm will auto-clear when temperature drops.\n2. Check the servo motor cooling fan if equipped.\n3. Reduce cutting parameters (lower feed rate, reduce depth of cut).\n4. Lubricate the axis ways and check gib adjustment — excessive tightness increases motor effort.\n5. If the alarm trips during light cuts, the motor may need replacement (demagnetized magnets).",
    relatedCodes: ["fanuc-414-servo-alarm-n-axis-excess-error"],
    metaDescription:
      "FANUC Alarm 306 servo overheating: cool the motor, check the fan, reduce cutting parameters, and lubricate ways.",
  },

  // ── More GS20 ──
  {
    slug: "gs20-ecf-communication-fault",
    title: "GS20 Fault E.CF — Communication Fault",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.CF",
    description:
      "E.CF triggers when the drive loses communication with the master device (PLC or HMI) over Modbus RTU or Modbus TCP for longer than the configured communication timeout.",
    commonCauses: [
      "RS-485 cable disconnected or damaged",
      "PLC communication program stopped or faulted",
      "Baud rate or parity mismatch between drive and master",
      "Network collision from too many devices on the RS-485 bus",
      "Communication timeout (P09.01) set too tight",
    ],
    recommendedFix:
      "1. Verify the PLC communication program is running and actively polling the drive.\n2. Check RS-485 wiring: shield grounded at one end only, A↔A and B↔B, 120Ω termination at both ends of the bus.\n3. Confirm baud rate (P09.00) and data format (P09.04) match the PLC configuration.\n4. Increase the communication timeout (P09.01) if the PLC poll cycle is slow.\n5. For Modbus TCP, verify the IP address, subnet mask, and gateway in P09.30–P09.33.",
    relatedCodes: ["gs20-eoc-overcurrent"],
    metaDescription:
      "GS20 E.CF communication fault: check RS-485 wiring, baud rate, PLC program status, and communication timeout setting.",
  },
  {
    slug: "gs20-eol-overload",
    title: "GS20 Fault E.OL — Drive Overload",
    equipment: "AutomationDirect GS20 Series",
    manufacturer: "AutomationDirect",
    faultCode: "E.OL",
    description:
      "E.OL indicates the drive's electronic thermal overload protection tripped. The drive calculated that the motor has been operating above its thermal capacity based on the I²t model using the programmed motor current (P01.01).",
    commonCauses: [
      "Sustained load above motor rated current",
      "P01.01 (motor rated current) set lower than actual motor FLA",
      "Duty cycle too demanding (frequent starts/stops building heat)",
      "Ambient temperature reducing the drive/motor derating",
      "Motor cooling inadequate at low speeds (TEFC motor below 30Hz)",
    ],
    recommendedFix:
      "1. Compare P01.01 with the motor nameplate FLA — set to match.\n2. Clamp-meter the motor current during peak load — if consistently >FLA, the motor is undersized for the application.\n3. For TEFC motors running below 30Hz, add a forced-cooling fan to maintain airflow.\n4. If the duty cycle has heavy start/stop, consider upgrading to a motor with a higher thermal class (Class H).\n5. Reset by pressing STOP/RESET after the motor has cooled.",
    relatedCodes: ["gs20-eoc-overcurrent", "gs20-eoh-overheating"],
    metaDescription:
      "GS20 E.OL overload: check motor current parameter, measure actual load, add cooling for low-speed operation. Troubleshooting guide.",
  },

  // ── Pump Specific ──
  {
    slug: "pump-cavitation-noise",
    title: "Pump Fault — Cavitation Detected",
    equipment: "Centrifugal Pumps / Process Pumps",
    manufacturer: "General",
    faultCode: "Cavitation",
    description:
      "Cavitation occurs when the pressure at the pump suction drops below the fluid's vapor pressure, causing vapor bubbles that violently collapse inside the impeller. It sounds like gravel or marbles inside the pump and rapidly destroys the impeller.",
    commonCauses: [
      "Suction strainer or filter clogged",
      "Suction line too long, too small, or has too many elbows",
      "Fluid temperature too high (reduces NPSH available)",
      "Pump running too far right on the curve (excessive flow)",
      "Suction isolation valve partially closed",
    ],
    recommendedFix:
      "1. Check and clean the suction strainer.\n2. Measure suction pressure with a gauge — compare to the pump's NPSH required (from the pump curve).\n3. Verify the suction valve is fully open.\n4. If the fluid is hot, lower the temperature or increase the static head on the suction side.\n5. Throttle the discharge slightly to move the operating point left on the pump curve.",
    relatedCodes: ["pump-seal-leak-fault"],
    metaDescription:
      "Pump cavitation: check suction strainer, measure NPSH, verify suction valve, and adjust the operating point. Prevent impeller damage.",
  },
  {
    slug: "pump-seal-leak-fault",
    title: "Pump Fault — Mechanical Seal Leak",
    equipment: "Centrifugal Pumps / Process Pumps",
    manufacturer: "General",
    faultCode: "Seal Leak",
    description:
      "A mechanical seal leak indicates fluid is escaping past the rotating seal faces. Minor weepage is normal, but visible dripping or streaming indicates seal failure that will worsen and can lead to bearing contamination.",
    commonCauses: [
      "Seal face wear from normal service life",
      "Dry running (pump ran without fluid, destroying the seal faces)",
      "Abrasive particles in the fluid scoring the seal faces",
      "Shaft misalignment or excessive vibration cracking the seal",
      "Thermal shock from sudden temperature changes",
    ],
    recommendedFix:
      "1. Confirm the leak location — mechanical seal or gasket?\n2. If the seal is weeping steadily, plan a seal replacement during the next scheduled downtime.\n3. If the seal is streaming, shut down the pump to prevent bearing contamination.\n4. When replacing, inspect the shaft sleeve for scoring — replace if grooved.\n5. Ensure the seal flush line is flowing (if equipped) to keep the seal faces cool and clean.",
    relatedCodes: ["pump-cavitation-noise"],
    metaDescription:
      "Pump mechanical seal leak: assess severity, plan replacement, inspect shaft sleeve, and verify seal flush. Maintenance guide.",
  },

  // ── Boiler / Burner ──
  {
    slug: "boiler-low-water-cutoff",
    title: "Boiler Fault — Low Water Cutoff",
    equipment: "Steam / Hot Water Boilers",
    manufacturer: "General",
    faultCode: "Low Water Cutoff",
    description:
      "A low water cutoff (LWCO) fault shuts down the burner when the boiler water level drops below the safe minimum. Operating a boiler with low water risks catastrophic overheating and pressure vessel failure.",
    commonCauses: [
      "Feedwater pump failure or low feedwater supply",
      "Steam leak or blowdown valve left open",
      "LWCO probe fouled with scale or sediment",
      "LWCO float stuck in the up position (mechanical type)",
      "Feedwater control valve malfunction",
    ],
    recommendedFix:
      "1. DO NOT attempt to add cold water to an overheated boiler — this can cause thermal shock.\n2. Verify the sight glass water level visually.\n3. Check the feedwater pump operation and supply tank level.\n4. Inspect and clean the LWCO probe or float per manufacturer schedule.\n5. Test the LWCO by slowly draining water until it trips — it should shut the burner before the sight glass goes empty.",
    relatedCodes: [],
    metaDescription:
      "Boiler low water cutoff: check feedwater pump, clean the LWCO probe, verify the sight glass. Safety-critical troubleshooting.",
  },

  // ── Chiller / HVAC ──
  {
    slug: "chiller-high-head-pressure",
    title: "Chiller Fault — High Head Pressure",
    equipment: "Air-Cooled / Water-Cooled Chillers",
    manufacturer: "General",
    faultCode: "High Head Pressure",
    description:
      "A high head pressure fault means the condenser-side refrigerant pressure exceeded the high-pressure cutout setting. The compressor shuts down to prevent mechanical damage and excessive power consumption.",
    commonCauses: [
      "Dirty condenser coils (air-cooled) or fouled tubes (water-cooled)",
      "Condenser fan failure or reduced airflow",
      "Cooling tower water temperature too high",
      "Refrigerant overcharge",
      "Non-condensable gases (air) in the refrigerant circuit",
    ],
    recommendedFix:
      "1. Clean the condenser coils with a coil cleaner and low-pressure water (air-cooled).\n2. Verify all condenser fans are running and rotating in the correct direction.\n3. For water-cooled, check the cooling tower performance and condenser water flow rate.\n4. Check the refrigerant charge level — if overcharged, recover excess to a cylinder.\n5. If subcooling is low and head pressure is high, suspect non-condensables — purge the system.",
    relatedCodes: [],
    metaDescription:
      "Chiller high head pressure: clean condenser coils, check fans, verify cooling tower, and check refrigerant charge.",
  },

  // ── Electrical Distribution ──
  {
    slug: "ground-fault-relay-trip",
    title: "Electrical Fault — Ground Fault Relay Trip (50G/51G)",
    equipment: "Switchgear / Motor Control Centers",
    manufacturer: "General",
    faultCode: "Ground Fault Trip",
    description:
      "A 50G (instantaneous) or 51G (time-overcurrent) ground fault relay trip indicates current flowing through the ground return path, meaning insulation has failed somewhere in the protected circuit.",
    commonCauses: [
      "Cable insulation failure (age, heat, mechanical damage)",
      "Motor winding failure to ground",
      "Equipment flooded or exposed to moisture",
      "Vermin damage to cable insulation",
      "Failed surge protector shorting to ground",
    ],
    recommendedFix:
      "1. Lock out / tag out the faulted circuit per NFPA 70E.\n2. Megger-test each branch cable and motor on the circuit to isolate the faulted segment.\n3. Visually inspect cables for obvious damage, burn marks, or moisture ingress.\n4. Repair or replace the faulted cable/motor.\n5. Before re-energizing, verify the ground fault relay resets and the megger reading is >1 MΩ.",
    relatedCodes: [],
    metaDescription:
      "Ground fault relay trip (50G/51G): lock out, megger test to isolate, inspect cables and motors. NFPA 70E compliant guide.",
  },

  // ── Welding Equipment ──
  {
    slug: "mig-welder-wire-feed-fault",
    title: "MIG Welder Fault — Wire Feed Jam / Birdnest",
    equipment: "MIG / GMAW Welders",
    manufacturer: "General",
    faultCode: "Wire Feed Fault",
    description:
      "A wire feed fault occurs when the welding wire tangles at the drive roll, inside the liner, or at the contact tip. The wire motor stalls or the wire fails to feed, stopping the weld.",
    commonCauses: [
      "Contact tip worn or undersized for the wire diameter",
      "Drive roll tension too high or too low",
      "Kinked or worn liner in the torch cable",
      "Wire spool tangled or cross-wound",
      "Wrong drive roll groove type for the wire (V for solid, U/knurled for flux-core)",
    ],
    recommendedFix:
      "1. Cut the wire, remove the birdnest from the drive rolls.\n2. Replace the contact tip — use the correct size for your wire diameter.\n3. Check the liner for kinks — replace if the wire doesn't push through freely.\n4. Set drive roll tension: tight enough to feed, loose enough that the wire slips if the tip jams (prevents birdnesting).\n5. Verify the wire spool is mounted correctly and the brake tension prevents overrun.",
    relatedCodes: [],
    metaDescription:
      "MIG welder wire feed fault / birdnest: replace the contact tip, check liner, set drive roll tension. Quick fix guide.",
  },

  // ── Packaging / Labeling ──
  {
    slug: "labeler-no-label-detected",
    title: "Labeler Fault — No Label Detected",
    equipment: "Pressure-Sensitive Label Applicators",
    manufacturer: "General",
    faultCode: "No Label Detected",
    description:
      "A no-label-detected fault means the label sensor did not detect a label passing through within the expected time window. The machine stops to prevent unlabeled product from passing downstream.",
    commonCauses: [
      "Label roll ran out or loaded incorrectly",
      "Label sensor dirty or misaligned",
      "Label gap or black mark not matching sensor type (gap vs. mark sensor)",
      "Web broken between the unwind and the peel plate",
      "Label adhesive buildup on the peel plate preventing clean separation",
    ],
    recommendedFix:
      "1. Check the label supply — reload if empty.\n2. Clean the label sensor lens with a dry cloth.\n3. Verify the sensor type matches the label style: gap sensor for clear-gap labels, mark sensor for black-mark labels.\n4. Re-thread the web through the peel plate and applicator.\n5. Clean adhesive residue from the peel plate edge with isopropyl alcohol.",
    relatedCodes: [],
    metaDescription:
      "Labeler no-label-detected fault: check the label roll, clean the sensor, match sensor type, and clean the peel plate.",
  },

  // ── PLC I/O General ──
  {
    slug: "plc-analog-input-out-of-range",
    title: "PLC Fault — Analog Input Out of Range",
    equipment: "PLC Analog I/O Modules (all brands)",
    manufacturer: "General",
    faultCode: "AI Out of Range",
    description:
      "An analog input out-of-range fault means the PLC received a signal outside the expected bounds (e.g., <4mA or >20mA on a 4-20mA input, or <1V / >5V on a voltage input). This typically indicates a field wiring or transmitter problem.",
    commonCauses: [
      "Broken wire between the transmitter and the PLC analog input",
      "Transmitter power supply failure (no 24VDC to the loop)",
      "Transmitter sensor failure (RTD open, thermocouple burnout)",
      "Incorrect wiring (2-wire vs 4-wire loop mismatch)",
      "Analog input module channel configured for wrong signal type",
    ],
    recommendedFix:
      "1. Measure the signal at the PLC analog input terminal with a multimeter (mA or V).\n2. If <4mA or open, trace the wiring back to the transmitter.\n3. Verify 24VDC power at the transmitter.\n4. Check the transmitter sensor — use the transmitter's local display or HART communicator.\n5. Confirm the PLC analog module channel configuration matches the field wiring (2-wire/4-wire, mA/V).",
    relatedCodes: ["allen-bradley-fault-16-io-not-responding"],
    metaDescription:
      "PLC analog input out of range: check field wiring, transmitter power, sensor health, and module configuration. Universal guide.",
  },
];
