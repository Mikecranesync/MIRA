/**
 * Rockwell SMC Flex Smart Motor Controller — Chapter 9 Troubleshooting, compiled as a workflow
 * template (WP-1). Every string a technician sees is quoted from the manual (publication
 * 150-UM008J-EN-P, April 2025, pp.103–106) and every step and table row carries its page.
 *
 * Provenance: hand-encoded from the rendered pages, then independently checked against the page
 * images (`.planning/engineering-harness/verify/`). A different manual revision is a new version of
 * this file — the revision check compares the notebook's manual against `source.fileSha256`.
 */

import type { StepGuidance, WorkflowTemplate } from "../types";

const PUB = "150-UM008J-EN-P";

function g(page: number, ref: string, causes: string[], solutions: string[]): StepGuidance {
  return { causes, solutions, cite: { page, ref } };
}

const T44 = "Table 44 - SMC Fault Display Explanation";
const T45 = "Table 45 - Motor Will Not Start — No Output Voltage to the Motor";
const T46 = "Table 46 - Motor Rotates (but does not accelerate to full speed)";
const T47 = "Table 47 - Motor Stops While Running";
const T48 = "Table 48 - Miscellaneous Situations";
/** Table 44 p.105, V24 Recovery (F44). Rows F45 and F46 say "Same as F44", so they carry these too. */
const F44_SOLUTIONS = [
  "Check control power. Make sure it is within the operating parameters of the SMC Flex controller",
  "Check control power connections, including ground, to the control module",
  "Replace control module",
];
const SEE_44 = g(105, T45, ["See fault description"], ["See Table 44 addressing fault conditions"]);

/** p.103 — the intro paragraph, the SHOCK HAZARD box and the IR-test ATTENTION box, verbatim. */
export const SMC_FLEX_P103_SAFETY =
  "For safety of maintenance personnel and others who might be exposed to electrical hazards associated with " +
  "maintenance activities, follow the local safety related work practices (for example, NFPA 70E, Part II in the " +
  "United States). Maintenance personnel must be trained in the safety practices, procedures, and requirements that " +
  "pertain to their respective job assignments.\n\n" +
  "SHOCK HAZARD: Hazardous voltage is present in the motor circuit even when the SMC Flex™ controller is off. To avoid " +
  "shock hazard, disconnect main power before working on the controller, motor, and control devices (for example, " +
  "Start-Stop push buttons). Procedures that require parts of the equipment to be energized during troubleshooting, " +
  "testing, etc., must be performed by properly qualified personnel using appropriate local safety work practices and " +
  "precautionary measures.\n\n" +
  "ATTENTION: Disconnect the controller from the motor before measuring insulation resistance (IR) of the motor " +
  "windings. Voltages used for insulation resistance testing can cause SCR failure. Do not make any measurements on " +
  "the controller with an IR tester (megger).";

/** p.106 — the two ATTENTION boxes that open the Power Module Check, verbatim. */
export const SMC_FLEX_P106_SAFETY =
  "ATTENTION: To avoid shock hazard, disconnect main power before working on the controller, motor, or control " +
  "devices such as Start/Stop push buttons.\n\n" +
  "ATTENTION: Make sure that wires are properly marked and programmed parameter values are recorded.";

export const SMC_FLEX_TROUBLESHOOTING: WorkflowTemplate = {
  id: "rockwell_smc_flex_ch9",
  title: "SMC Flex troubleshooting (Rockwell 150-UM008J, Chapter 9)",
  version: "1.1.0",
  appliesTo: ["Soft_Starter", "SMC_Flex"],
  source: {
    manufacturer: "Rockwell Automation",
    product: "SMC Flex Smart Motor Controller",
    publication: PUB,
    revisionDate: "2025-04",
    fileSha256: "a81650d0bd31773979ffb93b3cb601c5bca0422fd69a2206df52eea451912cbd",
    chapter: "Chapter 9 - Troubleshooting",
  },
  steps: [
    {
      id: "hazards",
      action: "ASSESS_HAZARDS",
      executor: "technician",
      prompt: "Read the manufacturer's safety notices for this chapter before you start.",
      safetyWording: SMC_FLEX_P103_SAFETY,
      cite: { page: 103, ref: "Chapter 9 - Troubleshooting (safety notices)" },
    },
    {
      id: "fault_displayed",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "Fault Displayed?",
      cite: { page: 103, ref: "Figure 77 - Troubleshooting Flowchart" },
      options: {
        yes: { label: "Yes", next: "t44" },
        no: { label: "No", next: "nature" },
      },
    },
    {
      id: "nature",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "Define Nature of Trouble",
      cite: { page: 103, ref: "Figure 77 - Troubleshooting Flowchart" },
      options: {
        no_start: { label: "Motor will not start. There is no output voltage to the motor.", next: "t45" },
        no_accel: { label: "Motor starts but does not accelerate to full speed.", next: "t46" },
        stops_running: { label: "Motor stops while running.", next: "t47" },
        misc: { label: "Miscellaneous situations", next: "t48" },
      },
    },
    {
      id: "t44",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "Which fault is shown on the display?",
      cite: { page: 104, ref: T44 },
      options: {
        line_loss: {
          label: "Line Loss (with phase indication) — 1, 2, 3 (prestart fault indication)",
          next: "checks",
          guidance: g(104, T44, ["Missing supply phase", "Motor not connected properly"], [
            "Check for line and load loose connections",
            "Check for open line (for example, blown fuse)",
            "Check for open line lead(s)",
            "Verify power quality",
          ]),
        },
        shorted_scr: {
          label: "Shorted SCR — 4, 5, 6",
          next: "scr_isolate",
          guidance: g(104, T44, ["Shorted Power Module"], ["Check for shorted SCR, replace power module if necessary"]),
        },
        open_gate: {
          label: "Open Gate (with phase indication) — 7, 8, 9",
          next: "checks",
          guidance: g(104, T44, ["Open gate circuitry", "Loose gate lead"], [
            "Perform resistance check; replace power module if necessary",
            "Check gate lead connections to the control module",
          ]),
        },
        ptc_power_pole: {
          label: "PTC Power Pole / SCR Overtemp — 10, 11",
          next: "checks",
          guidance: g(
            104,
            T44,
            [
              "Controller ventilation blocked",
              "Controller duty cycle exceeded",
              "Fan failure",
              "Ambient temperature limit exceeded",
              "Failed thermistor",
              "Failed power or control module",
            ],
            [
              "Check for proper ventilation",
              "Check application duty cycle",
              "Check for fan operation. Replace fan if necessary.",
              "Wait for controller to cool or provide external cooling",
              "Replace power module or control module as needed",
            ],
          ),
        },
        motor_ptc: {
          label: "Motor PTC — 12",
          next: "checks",
          guidance: g(104, T44, ["Motor ventilation blocked", "Motor duty cycle exceeded", "PTC open or shorted"], [
            "Check for proper ventilation",
            "Check application duty cycle",
            "Wait for motor to cool or provide external cooling",
            "Check resistance of PTC",
          ]),
        },
        open_bypass: {
          label: "Open Bypass — 13, 14, 15",
          next: "checks",
          guidance: g(104, T44, ["Control voltage is low", "Inoperable power module bypass"], [
            "Check control voltage power supply",
            "Replace power module",
            "Check control module TB2…TB4 and TB5…TB7 for proper connection and secureness",
            "Check Aux 1, 2, 3, 4 configurations are not set to External Bypass",
          ]),
        },
        no_load: {
          label: "No Load — 16, 17, 18, 40",
          next: "checks",
          guidance: g(104, T44, ["Loss of load side power wiring"], ["Check all load side power connections and motor windings"]),
        },
        line_unbalance: {
          label: "Line Unbalance — 19",
          next: "checks",
          guidance: g(
            104,
            T44,
            ["Power line unbalance is greater than the user-programmed value", "The delay time is too short for the application"],
            ["Check power system and correct if necessary", "Extend the delay time to match the application requirements"],
          ),
        },
        overvoltage: {
          label: "Overvoltage — 20",
          next: "checks",
          guidance: g(
            104,
            T44,
            [
              "Power line grid voltage is greater than the programmed value",
              "Abnormal voltage regulation",
              "The parameter settings and/or delay time programmed are not suited for the application",
            ],
            ["Check power system and correct if necessary, or change the programmed value", "Correct the user-programmed value"],
          ),
        },
        undervoltage: {
          label: "Undervoltage — 21",
          next: "checks",
          guidance: g(
            104,
            T44,
            [
              "Power line grid voltage is less than the programmed value",
              "Abnormal voltage regulation",
              "The parameter settings and or delay time programmed are not suited for the application",
            ],
            [
              "Check power system and correct if necessary",
              "Modify the parameter and/or extend the delay time to match the application requirements.",
            ],
          ),
        },
        overload: {
          label: "Overload — 22",
          next: "checks",
          guidance: g(104, T44, ["Motor overloaded", "Overload parameters are not matched to the motor"], [
            "Check motor overload condition",
            "Check programmed values for overload class and motor FLC",
          ]),
        },
        underload: {
          label: "Underload — 23",
          next: "checks",
          guidance: g(104, T44, ["Broken motor shaft", "Broken belts, toolbits, etc.", "Pump cavitation"], [
            "Repair or replace motor",
            "Check machine",
            "Check pump system",
          ]),
        },
        jam: {
          label: "Jam — 24",
          next: "checks",
          guidance: g(104, T44, ["Motor current has exceeded the user programmed jam level."], [
            "Correct source of jam",
            "Check programmed time value",
          ]),
        },
        stall: {
          label: "Stall — 25",
          next: "checks",
          guidance: g(104, T44, ["Motor has not reached full speed by the end of the programmed ramp time"], [
            "Check pump system, machine drive components, and loading; repair or replace motor, if necessary.",
            "Check programmed settings",
          ]),
        },
        phase_reversal: {
          label: "Phase Reversal — 26",
          next: "checks",
          guidance: g(104, T44, ["Incoming supply voltage is not in the expected ABC sequence"], [
            "Check power wiring and correct if necessary",
          ]),
        },
        coms_loss: {
          label: "Coms Loss — 27, 28, 29",
          next: "checks",
          guidance: g(104, T44, ["Communication disconnection at the serial port"], [
            "Check for a communication cable disconnection to the SMC Flex controller",
          ]),
        },
        network: {
          label: "Network — 30, 31, 32",
          next: "checks",
          guidance: g(104, T44, ["DPI network loss"], ["Reconnect for each DPI connected device"]),
        },
        ground_fault: {
          label: "Ground Fault — 33",
          next: "checks",
          guidance: g(104, T44, ["Ground fault current level has exceeded programmed value"], [
            "Check power system and motor; correct if necessary",
            "Check programmed ground fault levels to match application requirements",
          ]),
        },
        excess_starts: {
          label: "Excess Starts/Hr. — 34",
          next: "checks",
          guidance: g(104, T44, ["Number of starts in a one hour period has exceeded the value programmed"], [
            "Wait an appropriate amount of time to restart",
            "Reduce the actual number of starts per hour or increase the programmed start time (if allowed by the application) and controller thermal limits",
            "Turn off the Starts/Hr. feature",
          ]),
        },
        power_loss: {
          label: "Power Loss (with phase indication) — 35, 36, 37 (prestart fault indication)",
          next: "checks",
          guidance: g(104, T44, ["Missing supply phase (as indicated)"], ["Check for open line (blown line fuse)"]),
        },
        hall_id: {
          label: "Hall ID — 38",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, [
            "Loose cables between the controller and power section",
            "Incorrect power module has been installed",
          ], [
            "Remove the control module from the power section; verify connectors are firmly seated to the control module",
            "Check power module and replace if necessary",
          ]),
        },
        nvs_error: {
          label: "NVS Error — 39",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Controller memory corrupted"], [
            "Modify a parameter or load parameter defaults (preferred) and reload the customer-specific parameters.",
            "Replace control module if necessary",
          ]),
        },
        line_loss_41: {
          label: "Line Loss — 41, 42, 43",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Line distortion", "High impedance connection"], [
            "Check supply voltage for capability to start/stop motor",
            "Check for loose connections on line side or motor side of power wires",
          ]),
        },
        v24_recovery: {
          label: "V24 Recovery — F44",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, [
            "Control module internal 24V control power stays low after closing bypass contactor",
          ], F44_SOLUTIONS),
        },
        v24_loss: {
          label: "V24 Loss — F45",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Control module internal 24V supply out of normal range"], ["Same as F44", ...F44_SOLUTIONS]),
        },
        v_control: {
          label: "V Control — F46",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Sense of control voltage in error"], ["Same as F44", ...F44_SOLUTIONS]),
        },
        option_input: {
          label: "Option Input 1, 2 — F48, F49",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Fault occurs based on the user configuration of the option input"], [
            "Review the option input fault configuration and clear the fault condition",
          ]),
        },
        system_faults: {
          label: "Varies (control module system faults) — F128…F209",
          next: "checks",
          guidance: g(105, `${T44} (Continued)`, ["Control module wiring", "Control module defective"], [
            "Review the control module wiring. Ensure ground terminal is secure connected to system earth ground. Ensure an RC snubber is connected to all inductive loads in the control circuit (refer to input wiring)",
            "Replace the control module",
          ]),
        },
      },
    },
    {
      id: "t45",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "What does the display show?",
      cite: { page: 105, ref: T45 },
      options: {
        fault_displayed: { label: "Fault displayed", next: "t44", guidance: SEE_44 },
        blank: {
          label: "Display is blank",
          next: "checks",
          guidance: g(105, T45, ["Control voltage is absent", "Failed control module"], [
            "Check control wiring and correct if necessary",
            "Replace control module",
            "Cycle control power",
          ]),
        },
        stopped_0a: {
          label: "Stopped 0.0 Amps",
          next: "checks",
          guidance: g(
            105,
            T45,
            [
              "Pilot devices",
              "SMC Enable input is open at terminal 13",
              "Input terminals are not wired correctly",
              "Start-Stop control has not been enabled for the human interface module",
              "Control voltage",
              "Failed control module",
            ],
            ["Check wiring", "Follow the instructions on page 92 to enable control capability", "Check control voltage", "Replace control module"],
          ),
        },
        starting: {
          label: "Starting",
          next: "checks",
          guidance: g(105, T45, ["Two or three power phases are missing"], ["Check power system"]),
        },
      },
    },
    {
      id: "t46",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "What does the display show?",
      cite: { page: 105, ref: T46 },
      options: {
        fault_displayed: { label: "Fault displayed", next: "t44", guidance: { ...SEE_44, cite: { page: 105, ref: T46 } } },
        starting: {
          label: "Starting",
          next: "checks",
          guidance: g(105, T46, ["Mechanical problems", "Inadequate Current Limit setting", "Failed control module"], [
            "Check for binding or external loading and correct",
            "Check motor",
            "Adjust the Current Limit Level to a higher setting",
            "Replace control module",
          ]),
        },
      },
    },
    {
      id: "t47",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "What does the display show?",
      cite: { page: 105, ref: T47 },
      options: {
        fault_displayed: { label: "Fault displayed", next: "t44", guidance: { ...SEE_44, cite: { page: 105, ref: T47 } } },
        blank: {
          label: "Display is blank",
          next: "checks",
          guidance: g(105, T47, ["Control voltage is absent", "Failed control module"], [
            "Check control wiring and correct if necessary",
            "Replace control module",
          ]),
        },
        stopped_0a: {
          label: "Stopped 0.0 Amps",
          next: "checks",
          guidance: g(105, T47, ["Pilot devices", "Failed control module"], [
            "Check control wiring and correct if necessary",
            "Replace control module",
          ]),
        },
        starting: {
          label: "Starting",
          next: "checks",
          guidance: g(105, T47, ["Two or three power phases are missing", "Failed control module"], [
            "Check power system",
            "Replace control module",
          ]),
        },
      },
    },
    {
      id: "t48",
      action: "OBSERVE_STATE",
      executor: "technician",
      prompt: "Which situation matches?",
      cite: { page: 106, ref: T48 },
      options: {
        fluctuates: {
          label: "Motor current and voltage fluctuates with steady load",
          next: "checks",
          guidance: g(106, T48, ["Motor", "Erratic Load"], [
            "Verify type of motor as a standard squirrel cage induction motor",
            "Check load conditions",
          ]),
        },
        erratic: {
          label: "Erratic operation",
          next: "checks",
          guidance: g(106, T48, ["Loose connections"], ["Shut off all power to controller and check for loose connections"]),
        },
        accel_fast: {
          label: "Accelerates too fast",
          next: "checks",
          guidance: g(106, T48, ["Starting time", "Initial torque", "Current limit setting", "Kickstart"], [
            "Increase starting time",
            "Lower initial torque setting",
            "Decrease current limit setting",
            "Lower kickstart time or turn off",
            "Confirm Motor FLC (Parameter 46) is set properly",
          ]),
        },
        accel_slow: {
          label: "Accelerates too slow",
          next: "checks",
          guidance: g(106, T48, ["Starting time", "Initial torque", "Current limit setting", "Kickstart"], [
            "Decrease starting time",
            "Increase initial torque setting",
            "Increase current limit setting",
            "Increase kickstart time or turn off",
            "Confirm Motor FLC (Parameter 46) is set properly",
          ]),
        },
        fan: {
          label: "Fan does not operate",
          next: "checks",
          guidance: g(106, T48, ["Wiring", "Failed fan(s)"], ["Check wiring and correct if necessary", "Replace fan module"]),
        },
        stops_quick: {
          label: "Motor stops too quickly with Soft Stop option",
          next: "checks",
          guidance: g(106, T48, ["Time setting"], ["Verify the programmed stopping time and correct if necessary"]),
        },
        stops_slow: {
          label: "Motor stops too slowly with Soft Stop option",
          next: "checks",
          guidance: g(106, T48, ["Stopping time setting", "Misapplication"], [
            "Verify the programmed stopping time and correct if necessary",
            "The Soft Stop option is intended to extend the stopping time for loads that stop suddenly when power is removed from the motor",
          ]),
        },
        pump_surge: {
          label: "Fluid surges with pumps still occur with the Soft Stop option",
          next: "checks",
          guidance: g(106, T48, ["Misapplication"], [
            "Soft Stop ramps voltage down over a set period of time. In the case of pumps, the voltage may drop too rapidly to prevent surges. A closed loop system such as Pump Control would be more appropriately suited.",
            "See publication 150-TD009",
          ]),
        },
        overheats: {
          label: "Motor overheats",
          next: "checks",
          guidance: g(106, T48, ["Duty cycle"], [
            "Preset Slow Speed and Accu-Stop options: Extended operation at slow speeds reduces motor cooling efficiency. Consult motor manufacturer for motor limitations.",
            "Smart Motor Braking option: Check duty cycle. Consult motor manufacturer for motor limitations.",
          ]),
        },
        short_circuit: {
          label: "Motor short circuit",
          next: "scr_isolate",
          guidance: g(106, T48, ["Winding fault"], [
            "Identify fault and correct.",
            "Check for shorted SCR; replace if necessary.",
            "Ensure power terminals are secure.",
          ]),
        },
      },
    },
    {
      id: "checks",
      action: "RECORD_FINDING",
      executor: "technician",
      prompt: "Work through the manufacturer's possible causes and solutions above. Did they fix the problem?",
      cite: { page: 103, ref: "Figure 77 - Troubleshooting Flowchart (the table chosen above)" },
      on: { PASS: { stop: "resolved" }, FAIL: { stop: "escalate" } },
    },
    {
      id: "scr_isolate",
      action: "CONFIRM_ISOLATION",
      executor: "technician",
      prompt: "Power Module Check: confirm main power is disconnected before the Shorted SCR Test.",
      safetyWording: SMC_FLEX_P106_SAFETY,
      cite: { page: 106, ref: "Power Module Check" },
    },
    {
      id: "scr_test",
      action: "MEASURE",
      executor: "technician",
      prompt:
        "Shorted SCR Test: Using an ohmmeter, measure the resistance between the line and load terminals of each phase on the controller. (L1-T1, L2-T2, & L3-T3)",
      expected: "The resistance should be greater than 5,000 Ω.",
      cite: { page: 106, ref: "Shorted SCR Test" },
      measure: {
        quantity: "resistance",
        unit: "ohm",
        points: ["L1-T1", "L2-T2", "L3-T3"],
        passIf: { op: ">", value: 5000 },
        failGuidance: g(104, T44, ["Shorted Power Module"], ["Check for shorted SCR, replace power module if necessary"]),
      },
      // FAIL: a shorted SCR is FOUND, not fixed. Show the manual's own action for it (Table 44: replace
      // the power module if necessary), then ask whether that fixed the problem — the same check every
      // other row ends on. Ending here as "resolved" claimed a repair nobody had made (1.1.0).
      // PASS: no shorted SCR on any phase; the chapter documents nothing further, so it escalates.
      on: { PASS: { stop: "escalate" }, FAIL: { next: "checks" } },
    },
  ],
};
