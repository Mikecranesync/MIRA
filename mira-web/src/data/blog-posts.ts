/**
 * Blog article data for content marketing SEO.
 * Each entry generates a /blog/:slug page targeting maintenance search queries.
 */

export interface BlogSection {
  type: "paragraph" | "heading" | "list" | "callout" | "quote";
  text?: string;
  items?: string[];
  ordered?: boolean;
  variant?: "tip" | "warning" | "info";
  attribution?: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  category: string;
  readingTime: string;
  heroEmoji: string;
  sections: BlogSection[];
  relatedPosts: string[];
  relatedFaultCodes: string[];
}

export const BLOG_POSTS: BlogPost[] = [
  // ── 1 ──
  {
    slug: "how-to-read-vfd-fault-codes",
    title: "How to Read VFD Fault Codes: A Beginner's Guide",
    description:
      "Learn how to read and interpret VFD fault codes from PowerFlex, Yaskawa, ABB, Siemens, and AutomationDirect drives. Step-by-step guide for maintenance technicians.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Guides",
    readingTime: "6 min read",
    heroEmoji: "F",
    sections: [
      {
        type: "paragraph",
        text: "Variable Frequency Drives (VFDs) are the workhorses of modern industrial automation. They control motor speed, save energy, and protect equipment. But when something goes wrong, they communicate through fault codes — and if you don't know how to read them, you're stuck staring at a blinking display while the line is down.",
      },
      { type: "heading", text: "What Is a VFD Fault Code?" },
      {
        type: "paragraph",
        text: "A fault code is the drive's way of telling you what went wrong and why it stopped. Every major VFD manufacturer uses a different naming convention, but they all follow the same basic idea: a letter-number combination that maps to a specific failure condition.",
      },
      {
        type: "list",
        items: [
          "Allen-Bradley PowerFlex: \"F\" prefix followed by a number (F012, F013, F041)",
          "Yaskawa: Two-letter codes (oC, GF, oV, oH)",
          "ABB ACS880: Four-digit numbers (2310, 3220, 7121)",
          "Siemens SINAMICS: \"F\" prefix with five digits (F07011, F30011, F01001)",
          "AutomationDirect GS20: \"E.\" prefix followed by two letters (E.OC, E.OU, E.OH)",
        ],
      },
      { type: "heading", text: "The 5 Most Common VFD Fault Categories" },
      {
        type: "paragraph",
        text: "Regardless of manufacturer, VFD faults fall into five categories. Learning these categories lets you troubleshoot any drive, even one you've never seen before.",
      },
      {
        type: "list",
        ordered: true,
        items: [
          "Overcurrent (F012, oC, 2310, F01001, E.OC) — The output current exceeded the drive's limit. Usually caused by a motor short, ground fault, or mechanical overload.",
          "Overvoltage (F070, oV, E.OU) — The DC bus voltage spiked, typically during deceleration when the motor pumps energy back into the drive.",
          "Overtemperature (F041, oH, F30011, E.OH) — The drive's heatsink or motor exceeded its thermal limit. Check cooling fans and ventilation.",
          "Ground Fault (F013, GF, 3220, E.OC) — Current is leaking to ground through damaged cable or motor insulation.",
          "Communication Loss (F033, E.CF, 7121) — The drive lost contact with the PLC or the analog signal dropped out.",
        ],
      },
      { type: "heading", text: "Step-by-Step: How to Diagnose a VFD Fault" },
      {
        type: "list",
        ordered: true,
        items: [
          "Read the fault code from the drive display or keypad. Write it down — some drives only show the code briefly.",
          "Look up the code in the drive manual. Every manual has a fault code table. If you don't have the manual, search our Fault Code Library.",
          "Check the fault history. Most drives store the last 3–8 faults. A pattern (same fault repeating) tells you more than a single occurrence.",
          "Check the basics first: input power voltage, motor cable connections, cooling fan operation, ambient temperature.",
          "Use a megger to test motor insulation if the fault is overcurrent or ground fault related.",
          "Clear the fault and restart. If it returns immediately, the root cause is still present. If it takes hours to return, suspect a thermal or intermittent issue.",
        ],
      },
      {
        type: "callout",
        variant: "tip",
        text: "Pro tip: Take a photo of the drive's fault history screen with your phone before you clear it. This evidence is invaluable for root cause analysis later.",
      },
      { type: "heading", text: "When to Replace vs. Repair" },
      {
        type: "paragraph",
        text: "If the fault persists with no motor connected (disconnect the output cables and try to start), the drive itself has failed — typically an IGBT or power module issue. For drives under 25HP, replacement is usually cheaper than repair. For larger drives (50HP+), send it to an authorized repair center.",
      },
      {
        type: "callout",
        variant: "info",
        text: "FactoryLM's MIRA AI can diagnose VFD fault codes from any manufacturer in seconds. Just type or paste the fault code and MIRA searches your equipment manuals for the exact fix.",
      },
    ],
    relatedPosts: ["vfd-troubleshooting-checklist", "how-to-megger-test-a-motor"],
    relatedFaultCodes: [
      "powerflex-f012-overcurrent",
      "yaskawa-oc-overcurrent",
      "abb-acs880-fault-2310-overcurrent",
      "gs20-eoc-overcurrent",
    ],
  },

  // ── 2 ──
  {
    slug: "predictive-vs-preventive-maintenance",
    title: "Predictive vs Preventive Maintenance: What Every Technician Should Know",
    description:
      "Understand the difference between predictive and preventive maintenance, when to use each, and how modern AI tools are changing the game for small maintenance teams.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Industry",
    readingTime: "7 min read",
    heroEmoji: "P",
    sections: [
      {
        type: "paragraph",
        text: "Every maintenance team debates the same question: do we fix things on a schedule, or do we wait for the data to tell us when something is about to break? The answer, like most things in maintenance, is \"it depends.\" But understanding the trade-offs is what separates a reactive team from a strategic one.",
      },
      { type: "heading", text: "Preventive Maintenance (PM)" },
      {
        type: "paragraph",
        text: "Preventive maintenance means servicing equipment on a fixed schedule — regardless of condition. Change the oil every 500 hours. Replace the belt every 6 months. Grease the bearings every quarter. The schedule comes from the OEM manual, industry standards, or hard-won experience.",
      },
      {
        type: "list",
        items: [
          "Pros: Simple to plan, easy to train, predictable parts budget, well-understood by management",
          "Cons: You'll replace parts that still have life left (waste), and you'll miss failures that don't follow the schedule",
          "Best for: Simple, low-cost components (filters, belts, lubricants) where the cost of replacement is much less than the cost of failure",
        ],
      },
      { type: "heading", text: "Predictive Maintenance (PdM)" },
      {
        type: "paragraph",
        text: "Predictive maintenance uses condition monitoring data — vibration, temperature, oil analysis, motor current — to detect degradation before failure. You replace the bearing when the vibration signature shows an inner race defect, not when the calendar says to.",
      },
      {
        type: "list",
        items: [
          "Pros: Longer component life, fewer unplanned breakdowns, maintenance happens when actually needed",
          "Cons: Requires sensors, data collection, and analysis skills. Upfront investment in monitoring equipment.",
          "Best for: Expensive, critical assets where unplanned downtime costs thousands per hour (turbines, large motors, compressors, CNC machines)",
        ],
      },
      { type: "heading", text: "The Real-World Answer: Use Both" },
      {
        type: "paragraph",
        text: "The best maintenance programs aren't purely preventive or purely predictive. They're hybrid. Use PM for the cheap, consumable stuff (filters, oil, belts). Use PdM for the expensive, critical stuff (bearings, gearboxes, large motors). And use reactive maintenance for the things that are genuinely cheaper to run to failure (light bulbs, door handles, non-critical small pumps).",
      },
      {
        type: "quote",
        text: "The goal isn't to eliminate all failures. It's to eliminate the failures that matter.",
        attribution: "Every seasoned reliability engineer",
      },
      { type: "heading", text: "Where AI Fits In" },
      {
        type: "paragraph",
        text: "AI doesn't replace PM or PdM — it accelerates both. When a fault code fires on a VFD at 2 AM, you don't need to flip through a 400-page manual. You need the answer now. AI tools like Mira can search your equipment manuals, cross-reference fault histories, and suggest the most likely root cause in seconds. That's not replacing your expertise — it's giving you the right information faster.",
      },
      {
        type: "paragraph",
        text: "For small teams especially, AI bridges the knowledge gap. You can't have a vibration analyst, a PLC programmer, and an electrician on staff at a 20-person plant. But you can have an AI assistant that knows every manual you've ever uploaded.",
      },
    ],
    relatedPosts: ["what-is-cmms"],
    relatedFaultCodes: ["motor-high-vibration", "motor-bearing-temperature-high"],
  },

  // ── 3 ──
  {
    slug: "how-to-megger-test-a-motor",
    title: "How to Megger Test a Motor: Step-by-Step Guide",
    description:
      "Complete guide to megger testing (insulation resistance testing) electric motors. Learn when to test, how to interpret readings, and what values mean pass or fail.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Guides",
    readingTime: "8 min read",
    heroEmoji: "M",
    sections: [
      {
        type: "paragraph",
        text: "A megger test (insulation resistance test) is the single most useful diagnostic you can perform on an electric motor. It tells you whether the motor's winding insulation is healthy, degraded, or failed. Every maintenance electrician should know how to do this — and more importantly, how to interpret the results.",
      },
      {
        type: "callout",
        variant: "warning",
        text: "Safety first: Always lock out and tag out the motor and disconnect it from the VFD or starter before megger testing. A megger applies high voltage (typically 500V or 1000V DC) to the windings. Verify zero energy with a voltmeter before connecting the megger.",
      },
      { type: "heading", text: "What You Need" },
      {
        type: "list",
        items: [
          "Insulation resistance tester (megger) — 500V DC for motors up to 480V, 1000V DC for medium voltage",
          "Multimeter for verifying zero energy",
          "Motor leads disconnected from the drive/starter",
          "Clean, dry conditions (moisture will affect readings)",
        ],
      },
      { type: "heading", text: "Step-by-Step Procedure" },
      {
        type: "list",
        ordered: true,
        items: [
          "Lock out / tag out the motor circuit. Verify zero energy with a multimeter at the motor terminals.",
          "Disconnect the motor leads from the VFD or starter. You're testing the motor and its cable, not the drive.",
          "Set the megger to the correct test voltage: 500V DC for motors rated 480V and below, 1000V DC for higher voltages.",
          "Connect the megger's ground lead to the motor frame (a clean, unpainted surface). Connect the line lead to one motor phase lead (T1/U).",
          "Press the test button and hold for 60 seconds. Record the reading at 60 seconds — this is your insulation resistance value in megohms (MΩ).",
          "Repeat for each phase to ground (T1→GND, T2→GND, T3→GND).",
          "Test phase-to-phase: T1→T2, T2→T3, T1→T3. These readings should be relatively equal.",
          "After testing, discharge each winding to ground before reconnecting (the megger charges capacitance in the winding).",
        ],
      },
      { type: "heading", text: "How to Interpret the Results" },
      {
        type: "paragraph",
        text: "The IEEE 43 standard and general industry practice give these guidelines for motor insulation resistance (phase-to-ground, 500V DC test, at 40°C ambient):",
      },
      {
        type: "list",
        items: [
          "Above 100 MΩ — Excellent. Motor insulation is in great shape.",
          "10–100 MΩ — Good. Normal for older motors or humid environments. No action needed.",
          "2–10 MΩ — Marginal. Schedule a rewind or replacement. Monitor frequently.",
          "1–2 MΩ — Poor. Plan replacement soon. Do not put back in service without investigation.",
          "Below 1 MΩ — Failed. Motor insulation has broken down. Do not energize.",
        ],
      },
      {
        type: "callout",
        variant: "tip",
        text: "Temperature matters: insulation resistance halves for every 10°C increase. If you're testing a hot motor, the readings will be lower than a cold motor. IEEE 43 provides correction factors, or simply test the motor at ambient temperature for the most reliable baseline.",
      },
      { type: "heading", text: "When to Megger Test" },
      {
        type: "list",
        items: [
          "After any VFD overcurrent (F012, oC) or ground fault (F013, GF) trip",
          "Before re-energizing a motor that has been sitting idle for months",
          "After a motor has been exposed to moisture (flood, washdown, outdoor rain)",
          "As part of annual PM on critical motors",
          "Before and after a motor rewind to verify quality",
        ],
      },
      { type: "heading", text: "Common Mistakes" },
      {
        type: "list",
        items: [
          "Testing with the motor connected to the VFD — the megger voltage can damage the drive's output stage",
          "Not waiting 60 seconds — capacitive charging in large motors takes time to stabilize",
          "Testing in humid conditions without accounting for surface leakage",
          "Forgetting to discharge windings after the test — stored charge can shock you",
        ],
      },
    ],
    relatedPosts: ["how-to-read-vfd-fault-codes"],
    relatedFaultCodes: [
      "powerflex-f012-overcurrent",
      "powerflex-f013-ground-fault",
      "yaskawa-gf-ground-fault",
    ],
  },

  // ── 4 ──
  {
    slug: "common-allen-bradley-plc-faults",
    title: "5 Most Common Allen-Bradley PLC Faults and How to Fix Them",
    description:
      "The 5 most frequent Allen-Bradley CompactLogix and ControlLogix PLC faults, what causes them, and step-by-step fixes for each one.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Guides",
    readingTime: "6 min read",
    heroEmoji: "5",
    sections: [
      {
        type: "paragraph",
        text: "Allen-Bradley PLCs from Rockwell Automation are the most widely used controllers in North American manufacturing. CompactLogix and ControlLogix run everything from simple conveyor logic to complex batch processes. When they fault, the line stops. Here are the five faults you'll see most often and how to fix each one.",
      },
      { type: "heading", text: "1. Fault 01 — Watchdog Timeout" },
      {
        type: "paragraph",
        text: "The watchdog timer monitors how long the controller takes to complete one scan of your program. If the scan exceeds the configured limit, the controller faults to prevent unpredictable output behavior. This is the PLC equivalent of \"your program is taking too long.\"",
      },
      {
        type: "paragraph",
        text: "Fix: Open Task Properties in Studio 5000 and check the actual scan time vs. the watchdog setting. If the scan time legitimately needs to be longer, increase the watchdog timer. If the scan time spiked, look for a runaway loop or an instruction that's processing a large data set in a single scan.",
      },
      { type: "heading", text: "2. Fault 16 — I/O Not Responding" },
      {
        type: "paragraph",
        text: "This is the most common fault in any CompactLogix or ControlLogix system. It means one or more I/O modules lost communication with the controller. The faulted module's outputs go to their configured fault state (typically off).",
      },
      {
        type: "paragraph",
        text: "Fix: Expand the I/O tree in Studio 5000 — the faulted module will have a red X. Reseat it firmly into the backplane. Check 24VDC power at the module. For remote I/O over EtherNet/IP, verify the network cable and switch port LEDs.",
      },
      { type: "heading", text: "3. Fault 04 — Recoverable I/O Fault" },
      {
        type: "paragraph",
        text: "Less severe than Fault 16, a recoverable I/O fault means a module reported an error but the controller keeps running. The data from that module may be stale, which can cause subtle logic errors downstream.",
      },
      {
        type: "paragraph",
        text: "Fix: Check the specific module's fault code in the I/O tree. Common causes are firmware mismatches and momentary cable disconnections. The fault auto-clears when the module recovers, or you can clear it with a CLR Major Fault instruction.",
      },
      { type: "heading", text: "4. Communication Timeout (Micro820)" },
      {
        type: "paragraph",
        text: "The Micro820 and Micro850 are budget-friendly controllers used on smaller machines. A communication timeout means the controller lost contact with a Modbus TCP or RTU slave device. Unlike the CompactLogix, the Micro820 doesn't have an I/O tree — it uses MSG instructions for communication.",
      },
      {
        type: "paragraph",
        text: "Fix: Ping the target device from a laptop. For Modbus RTU, check the RS-485 wiring: A to A, B to B, with 120Ω termination resistors at both ends of the bus. Verify baud rate and parity settings match.",
      },
      { type: "heading", text: "5. User Program Error (Micro820)" },
      {
        type: "paragraph",
        text: "A user program error means your ladder logic hit a runtime error — typically a division by zero or an array index out of bounds. The controller stops, and all outputs go to their fault state.",
      },
      {
        type: "paragraph",
        text: "Fix: Connect with Connected Components Workbench (CCW) and check the fault log for the specific instruction address. Add guard logic before math operations (check for zero before dividing) and validate array indices before using them.",
      },
      {
        type: "callout",
        variant: "tip",
        text: "Keep a backup of your PLC program on a USB drive in the control panel. When Fault 01 or a program error locks up the controller, you can re-download from the backup much faster than waiting for engineering to remote in.",
      },
    ],
    relatedPosts: ["understanding-4-20ma-signals"],
    relatedFaultCodes: [
      "allen-bradley-fault-01-watchdog",
      "allen-bradley-fault-16-io-not-responding",
      "allen-bradley-fault-04-recoverable",
      "micro820-err-user-program",
      "micro820-comms-timeout",
    ],
  },

  // ── 5 ──
  {
    slug: "understanding-4-20ma-signals",
    title: "Understanding 4-20mA Signals: A Maintenance Technician's Guide",
    description:
      "Everything a maintenance technician needs to know about 4-20mA analog signals — how they work, how to measure them, and how to troubleshoot common problems.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Fundamentals",
    readingTime: "7 min read",
    heroEmoji: "4",
    sections: [
      {
        type: "paragraph",
        text: "The 4-20mA current loop is the backbone of industrial instrumentation. Pressure transmitters, level sensors, temperature transmitters, flow meters — they all talk to your PLC or VFD using this simple, reliable analog signal. If you work in maintenance, understanding 4-20mA is non-negotiable.",
      },
      { type: "heading", text: "Why 4-20mA Instead of 0-20mA?" },
      {
        type: "paragraph",
        text: "The \"4\" in 4-20mA is what makes this standard brilliant. At 0% of the measured range, the signal is 4mA — not 0mA. This means a broken wire (0mA) is distinguishable from a legitimate zero reading (4mA). If your PLC reads 0mA, you know the wire is broken. If it reads 4mA, the sensor is working and reporting the minimum value.",
      },
      {
        type: "callout",
        variant: "info",
        text: "This is called a \"live zero\" — and it's the reason 4-20mA has survived for 60+ years despite digital alternatives like HART, Foundation Fieldbus, and IO-Link.",
      },
      { type: "heading", text: "How to Calculate the Process Value" },
      {
        type: "paragraph",
        text: "The math is linear. 4mA = 0% of range. 20mA = 100% of range. For a pressure transmitter ranged 0-100 PSI:",
      },
      {
        type: "list",
        items: [
          "4mA = 0 PSI",
          "8mA = 25 PSI",
          "12mA = 50 PSI",
          "16mA = 75 PSI",
          "20mA = 100 PSI",
          "Formula: PSI = (mA - 4) / 16 × 100",
        ],
      },
      { type: "heading", text: "2-Wire vs 4-Wire Transmitters" },
      {
        type: "paragraph",
        text: "A 2-wire (loop-powered) transmitter gets its power from the same two wires that carry the signal. The PLC or power supply provides 24VDC, and the transmitter modulates the current. This is the most common type and uses the fewest wires.",
      },
      {
        type: "paragraph",
        text: "A 4-wire transmitter has separate power wires (24VDC+ and ground) and separate signal wires (4-20mA output and signal ground). These are used for transmitters that need more power than a 2-wire loop can provide, like radar level sensors.",
      },
      { type: "heading", text: "How to Measure 4-20mA with a Multimeter" },
      {
        type: "list",
        ordered: true,
        items: [
          "Set your multimeter to DC milliamps (mA).",
          "For the easiest measurement, disconnect one wire at the PLC analog input terminal and put your meter in series.",
          "A healthy reading will be between 4.0mA and 20.0mA, proportional to the process value.",
          "Below 3.8mA: suspect a wiring fault or transmitter failure.",
          "Above 20.5mA: sensor may be over-ranged, or there's a wiring error.",
          "If you have a clamp-on mA meter, you can measure without breaking the circuit — these work on the wire without disconnecting anything.",
        ],
      },
      { type: "heading", text: "Common 4-20mA Problems and Fixes" },
      {
        type: "list",
        items: [
          "0mA (open circuit): Broken wire, loose terminal, or dead transmitter. Trace the wiring from the PLC back to the transmitter.",
          "Stuck at 4mA: Transmitter powered but sensor failed, or the process is genuinely at 0%. Check the transmitter local display.",
          "Erratic/noisy signal: Electromagnetic interference from VFDs or large motors. Route signal cables away from power cables. Use shielded cable with the shield grounded at the PLC end only.",
          "Reading 20.9mA+: The transmitter is saturated (process value exceeds the configured range). Re-range the transmitter or investigate the process.",
          "Slight offset (e.g., reads 4.2mA when process is at zero): Transmitter needs re-zeroing. Use the transmitter's zero/span adjustment or a HART communicator.",
        ],
      },
      {
        type: "callout",
        variant: "tip",
        text: "Always carry a mA loop calibrator in your tool bag. It lets you simulate a 4-20mA signal at the PLC end to verify your analog input card is reading correctly — isolating whether the problem is the transmitter/wiring or the PLC.",
      },
    ],
    relatedPosts: ["common-allen-bradley-plc-faults"],
    relatedFaultCodes: [
      "abb-acs880-fault-7121-ai-supervision",
      "plc-analog-input-out-of-range",
    ],
  },

  // ── 6 ──
  {
    slug: "vfd-troubleshooting-checklist",
    title: "VFD Troubleshooting Checklist: 10 Things to Check Before Calling Support",
    description:
      "A practical 10-step VFD troubleshooting checklist for maintenance technicians. Diagnose the most common VFD problems before escalating to the manufacturer.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Guides",
    readingTime: "5 min read",
    heroEmoji: "10",
    sections: [
      {
        type: "paragraph",
        text: "Before you call the drive manufacturer's support line and spend 45 minutes on hold, run through this checklist. Eight out of ten VFD faults can be resolved with these checks — and you'll look like a hero for getting the line back up in minutes instead of hours.",
      },
      { type: "heading", text: "The 10-Point VFD Checklist" },
      {
        type: "list",
        ordered: true,
        items: [
          "Read and record the fault code. Check the fault history for patterns — is it the same fault repeating, or different faults? Write it down before clearing.",
          "Check input power. Measure L1-L2, L2-L3, L1-L3 at the drive terminals. All three should be within ±10% of the drive's rated voltage and within 3% of each other.",
          "Check the cooling fan. Is it spinning? Is there airflow out the top of the drive? A dead fan is the #1 cause of overtemperature faults.",
          "Check the ambient temperature. Hold your hand inside the enclosure — if it's uncomfortable, it's too hot for the drive. Max is typically 40°C (104°F).",
          "Inspect motor cables. Look for physical damage, especially at conduit entries and junction boxes. Damaged insulation causes overcurrent and ground fault trips.",
          "Megger the motor. Disconnect motor cables from the drive. 500V DC, 60 seconds, phase-to-ground. Must be >1 MΩ. If it fails, the problem is the motor or cable, not the drive.",
          "Check motor cable connections. Loose output terminals cause intermittent faults. Torque all terminals to spec.",
          "Check the drive parameters. Was anything changed recently? Most drives have a \"parameter change log\" or you can compare against a saved parameter file.",
          "Clear the fault and restart. If the fault returns immediately, the problem is still present. If it takes minutes/hours, suspect a thermal or intermittent issue.",
          "Disconnect the motor and restart the drive. If it runs fault-free with no motor connected, the problem is in the motor or cables. If it still faults, the drive has an internal failure.",
        ],
      },
      {
        type: "callout",
        variant: "warning",
        text: "Never megger test with the motor cables connected to the VFD. The megger's test voltage (500V DC) will destroy the drive's output IGBT transistors.",
      },
      { type: "heading", text: "When to Call Support" },
      {
        type: "paragraph",
        text: "Call the manufacturer when: the drive faults with no motor connected, the drive won't power up at all, the display is blank or showing garbled characters, or you've been through all 10 checks and the fault keeps recurring. Have the drive model number, serial number, firmware version, and fault history ready — this will cut your call time in half.",
      },
    ],
    relatedPosts: ["how-to-read-vfd-fault-codes", "how-to-megger-test-a-motor"],
    relatedFaultCodes: [
      "powerflex-f041-heatsink-overtemp",
      "gs20-eoh-overheating",
      "siemens-f30011-heatsink-overtemp",
    ],
  },

  // ── 7 ──
  {
    slug: "why-your-air-compressor-keeps-shutting-down",
    title: "Why Your Air Compressor Keeps Shutting Down",
    description:
      "Diagnose why your rotary screw air compressor keeps tripping. Common causes: high temperature, high current, low oil, and how to fix each one.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Troubleshooting",
    readingTime: "6 min read",
    heroEmoji: "C",
    sections: [
      {
        type: "paragraph",
        text: "A compressor that keeps shutting down is one of the most frustrating problems in a plant. Every machine on the floor needs air, and when the compressor trips, everything stops. The good news: rotary screw compressors trip for a small number of well-understood reasons, and most of them are fixable without a service call.",
      },
      { type: "heading", text: "Reason 1: High Discharge Temperature" },
      {
        type: "paragraph",
        text: "This is the most common compressor trip. The discharge air/oil temperature exceeded the safety limit (typically 100–110°C). The compressor's thermal switch or controller shuts it down to protect the element and oil from degradation.",
      },
      {
        type: "list",
        items: [
          "Dirty oil cooler — The #1 cause. Blow the cooler fins with compressed air from the clean side. If it's heavily fouled, use a coil cleaner spray.",
          "Low oil — Check the sight glass. If the oil is below the minimum mark, top off with the correct compressor oil. Never mix oil brands.",
          "Failed thermal bypass valve — This valve routes oil around the cooler when it's cold and through the cooler when it's hot. If it's stuck in the bypass position, oil never gets cooled.",
          "Hot room — The compressor room needs adequate ventilation. If the room heats up, the compressor can't reject enough heat. Add ducting to bring in outside air.",
        ],
      },
      { type: "heading", text: "Reason 2: High Motor Current / Overload" },
      {
        type: "paragraph",
        text: "The motor overload relay or VFD trips because the compressor motor is drawing too much current. This usually means the compressor is working harder than it should.",
      },
      {
        type: "list",
        items: [
          "Clogged oil separator — High differential pressure across the separator element forces the motor to work harder. Replace the separator when the ΔP exceeds 1 bar (15 PSI).",
          "Low voltage — Measure voltage at the motor terminals under load. Low voltage = higher current for the same power output. Common with long cable runs or undersized transformers.",
          "Minimum pressure valve stuck closed — This valve maintains 4.5 bar (65 PSI) in the oil circuit for lubrication. If stuck closed, the motor fights against full backpressure.",
        ],
      },
      { type: "heading", text: "Reason 3: Low Oil Pressure / Level" },
      {
        type: "paragraph",
        text: "If the compressor trips on low oil pressure, stop immediately. Running a rotary screw element without adequate oil even briefly can cause catastrophic damage to the rotors — a multi-thousand-dollar repair.",
      },
      {
        type: "paragraph",
        text: "Check the oil level first. Then look for external leaks at fittings, hoses, and the separator tank. If the oil is foaming (visible through the sight glass), the wrong oil type is the likely cause.",
      },
      { type: "heading", text: "Reason 4: Phase Loss or Phase Reversal" },
      {
        type: "paragraph",
        text: "If the compressor won't start at all (trips immediately on attempt), check for a phase loss or phase reversal fault. A blown fuse, tripped breaker, or loose connection on one phase will cause this. Phase reversal (running backward) happens after electrical maintenance when leads get swapped — the compressor controller detects this and refuses to start to protect the element.",
      },
      {
        type: "callout",
        variant: "tip",
        text: "Keep a maintenance log on the compressor. Note the discharge temperature, oil level, and separator ΔP weekly. Trending these three numbers will warn you before the compressor trips — that's predictive maintenance at zero sensor cost.",
      },
    ],
    relatedPosts: ["predictive-vs-preventive-maintenance"],
    relatedFaultCodes: [
      "compressor-high-discharge-temperature",
      "compressor-high-current",
      "compressor-low-oil-pressure",
    ],
  },

  // ── 8 ──
  {
    slug: "what-is-cmms",
    title: "What Is CMMS? A Simple Guide for Small Maintenance Teams",
    description:
      "What a CMMS is, why small maintenance teams need one, and how to choose the right one. No jargon, just practical advice from teams who've been there.",
    date: "2026-04-08",
    author: "FactoryLM Engineering",
    category: "Product",
    readingTime: "5 min read",
    heroEmoji: "W",
    sections: [
      {
        type: "paragraph",
        text: "CMMS stands for Computerized Maintenance Management System. In plain English, it's software that tracks your work orders, equipment, parts, and PM schedules so you don't have to rely on whiteboards, spreadsheets, or memory.",
      },
      { type: "heading", text: "Why You Need One (Even If You're a Small Team)" },
      {
        type: "paragraph",
        text: "If your maintenance team is 1–10 people, you might think a CMMS is overkill. It's not. Here's why: when knowledge lives in one person's head, it walks out the door when they retire, get sick, or go on vacation. A CMMS captures that knowledge — every work order, every repair note, every PM schedule — so the next person can pick up where they left off.",
      },
      {
        type: "list",
        items: [
          "No more lost work orders. Every request gets logged, assigned, and tracked to completion.",
          "PM compliance goes up. The system reminds you when PMs are due — no more missed oil changes or expired inspections.",
          "You build a repair history. When the same motor fails again in 6 months, you can see what was done last time.",
          "Parts tracking. Know what you have in the storeroom and what needs to be ordered before you need it.",
          "Management reporting. Show your boss how many WOs you completed, your PM compliance rate, and your mean time to repair. Numbers get you budget.",
        ],
      },
      { type: "heading", text: "What to Look For in a CMMS" },
      {
        type: "list",
        items: [
          "Mobile-friendly. Your technicians are on the floor, not at a desk. If the CMMS doesn't work on a phone, they won't use it.",
          "Fast work order creation. If it takes 5 minutes to create a WO, people will stop using it. One tap or one line of text should be enough.",
          "Simple PM scheduling. Calendar-based or meter-based triggers. Bonus points if it auto-generates the WO when a PM is due.",
          "Asset hierarchy. Organize equipment by location → line → machine → component. This makes it easy to find the repair history for any asset.",
          "Low per-user cost. Many CMMS tools charge $50–$150/user/month. For a small team, that adds up fast. Look for free tiers or flat-rate pricing.",
        ],
      },
      { type: "heading", text: "Where AI Changes the Game" },
      {
        type: "paragraph",
        text: "Traditional CMMS tools are databases — they store information but don't help you diagnose. AI-powered CMMS tools like FactoryLM add a diagnostic layer: you type a fault code or describe a symptom, and the system searches your uploaded equipment manuals to give you the fix. It even auto-creates the work order from the diagnosis.",
      },
      {
        type: "paragraph",
        text: "For small teams without deep specialist knowledge on staff, this is transformative. Instead of Googling a fault code and hoping the forum post from 2014 applies to your drive model, you get the answer from your actual manual in seconds.",
      },
      {
        type: "callout",
        variant: "info",
        text: "FactoryLM offers a free CMMS tier: work orders, asset tracking, PM scheduling, and 5 AI diagnostic queries per day. No credit card required.",
      },
    ],
    relatedPosts: ["predictive-vs-preventive-maintenance"],
    relatedFaultCodes: [],
  },
];
