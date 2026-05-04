#!/usr/bin/env python3
"""Seed structured fault codes for target VFD families into NeonDB.

Populates the fault_codes table with well-known fault codes from manufacturer
documentation for VFD models that were not covered by extract_fault_codes.py.

Target families (issue #193):
  - Danfoss VLT FC Series
  - Yaskawa A1000
  - ABB ACS580
  - Siemens G120 (supplement existing sparse coverage)
  - AutomationDirect GS10/GS20 (supplement existing sparse coverage)
  - Rockwell PowerFlex 525/40 (supplement existing sparse coverage)

Usage:
    doppler run --project factorylm --config prd -- \
      uv run --with sqlalchemy --with psycopg2-binary \
      python mira-core/scripts/seed_fault_codes.py [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("seed_fault_codes")

NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID")

# ── Fault code definitions by manufacturer/model ────────────────────────────
# Sources: manufacturer public technical manuals and application guides.
# Each entry: (code, description, cause, action, severity)

DANFOSS_VLT: list[tuple[str, str, str, str, str]] = [
    (
        "2",
        "Live Zero Error",
        "Control signal on analog input below 50% of minimum live zero value.",
        "1. Check analog input wiring. 2. Verify signal source is within range. 3. Check parameter setup for analog input scaling.",
        "trip",
    ),
    (
        "4",
        "Mains Phase Loss",
        "A phase is missing on the mains supply side, or the mains voltage imbalance is too high.",
        "1. Check supply voltage on all three phases. 2. Verify fuses. 3. Check input contactor.",
        "trip",
    ),
    (
        "5",
        "DC Link High Voltage",
        "DC link voltage exceeds the overvoltage limit.",
        "1. Check if ramp-down time is too short. 2. Increase ramp-down time or enable overvoltage control. 3. Check for regenerative loads.",
        "trip",
    ),
    (
        "7",
        "DC Link Overvoltage",
        "DC link voltage exceeds the inverter's absolute maximum.",
        "1. Increase deceleration time. 2. Add braking resistor if regenerative load. 3. Check supply voltage for spikes.",
        "trip",
    ),
    (
        "8",
        "DC Link Undervoltage",
        "DC link voltage dropped below the undervoltage limit.",
        "1. Check mains supply voltage. 2. Check for voltage sags. 3. Verify power supply capacity.",
        "trip",
    ),
    (
        "9",
        "Inverter Overload",
        "Inverter thermal protection activated — too much current for too long.",
        "1. Reduce load or duty cycle. 2. Check for mechanical binding. 3. Verify motor sizing matches application.",
        "trip",
    ),
    (
        "10",
        "Motor Overtemperature ETR",
        "Electronic thermal relay estimates motor is overheated.",
        "1. Check if motor is overloaded. 2. Verify motor cooling fan operates. 3. Check ETR parameters match motor thermal capacity.",
        "trip",
    ),
    (
        "11",
        "Motor Thermistor Overtemp",
        "Motor thermistor or KTY sensor has disconnected or signals overtemperature.",
        "1. Check thermistor wiring. 2. Measure thermistor resistance. 3. Allow motor to cool down.",
        "trip",
    ),
    (
        "13",
        "Overcurrent",
        "Inverter peak current limit exceeded (approx. 200% of rated).",
        "1. Check for motor short circuit. 2. Check motor cables. 3. Verify motor size matches drive rating. 4. Check for sudden load impact.",
        "trip",
    ),
    (
        "14",
        "Earth Fault",
        "Ground fault detected between drive output and motor.",
        "1. Megger motor insulation. 2. Check motor cable insulation. 3. Check for moisture in junction box.",
        "trip",
    ),
    (
        "16",
        "Short Circuit",
        "Short circuit detected on motor side.",
        "1. Check motor cables for damage. 2. Megger motor windings. 3. Check motor terminal connections.",
        "trip",
    ),
    (
        "17",
        "Control Word Timeout",
        "No communication with master within timeout period.",
        "1. Check communication cable. 2. Verify master is running. 3. Check timeout parameter setting.",
        "trip",
    ),
    (
        "29",
        "Brake Chopper Short Circuit",
        "Braking transistor is short-circuiting.",
        "1. Replace the drive. 2. Check braking resistor resistance value. 3. Disconnect braking resistor and test.",
        "trip",
    ),
    (
        "33",
        "Brake Resistor Overtemperature",
        "Braking resistor power exceeds calculated thermal limit.",
        "1. Reduce braking duty. 2. Use higher-wattage resistor. 3. Check resistor connections.",
        "warning",
    ),
    (
        "38",
        "Internal Fault",
        "Internal drive hardware error.",
        "1. Cycle power. 2. If persistent, record fault log and contact manufacturer. 3. Replace drive if unrecoverable.",
        "trip",
    ),
    (
        "48",
        "Drive Initialization",
        "Drive initializing after power-up. Not a fault — informational.",
        "1. Wait for initialization to complete. 2. If stuck, cycle power.",
        "info",
    ),
    (
        "52",
        "Motor Low Voltage",
        "Motor voltage too low at current speed — slip too high.",
        "1. Check motor V/Hz curve parameters. 2. Verify motor nameplate data is entered correctly. 3. Check for excessive load.",
        "warning",
    ),
    (
        "53",
        "Motor Full Load",
        "Motor current exceeds rated full-load current.",
        "1. Reduce load. 2. Check for mechanical binding. 3. Verify motor parameters match nameplate.",
        "warning",
    ),
]

YASKAWA_A1000: list[tuple[str, str, str, str, str]] = [
    (
        "OC",
        "Overcurrent",
        "Output current exceeded 200% of drive rated current during acceleration, deceleration, or at constant speed.",
        "1. Extend accel/decel times. 2. Check for motor short circuit. 3. Reduce load. 4. Verify motor parameters.",
        "trip",
    ),
    (
        "GF",
        "Ground Fault",
        "Ground fault current exceeded 50% of drive rated current.",
        "1. Megger motor insulation. 2. Check motor cable insulation. 3. Check for moisture in motor or junction box.",
        "trip",
    ),
    (
        "OV",
        "DC Bus Overvoltage",
        "DC bus voltage exceeded the overvoltage level during operation.",
        "1. Extend deceleration time. 2. Enable overvoltage suppression. 3. Add braking resistor for regenerative loads.",
        "trip",
    ),
    (
        "UV1",
        "DC Bus Undervoltage",
        "Main circuit DC bus voltage dropped below undervoltage level during operation.",
        "1. Check input power supply. 2. Check for voltage sags. 3. Verify supply capacity for load.",
        "trip",
    ),
    (
        "UV2",
        "DC Bus Undervoltage at Powerup",
        "Control circuit power supply voltage too low at startup.",
        "1. Check main circuit power. 2. Verify supply voltage matches drive rating.",
        "trip",
    ),
    (
        "UV3",
        "Undervoltage Transient",
        "Momentary power loss detected — DC bus dropped briefly.",
        "1. Check input power quality. 2. Enable momentary power loss ride-through (L2-01). 3. Check for upstream switching.",
        "trip",
    ),
    (
        "LF",
        "Output Phase Loss",
        "One of three output phases is not connected or is open.",
        "1. Check motor cable connections at drive and motor. 2. Check for blown fuse in output. 3. Measure motor winding resistance phase-to-phase.",
        "trip",
    ),
    (
        "OH",
        "Heatsink Overtemperature",
        "Drive heatsink temperature exceeded the overheat level.",
        "1. Check ambient temperature. 2. Clean heatsink fins and fan. 3. Verify fan is running. 4. Reduce load or duty cycle.",
        "trip",
    ),
    (
        "OH2",
        "Drive Overtemperature",
        "Internal drive temperature exceeded limit.",
        "1. Check ventilation. 2. Clean cooling passages. 3. Check ambient temperature. 4. Reduce carrier frequency.",
        "trip",
    ),
    (
        "OL1",
        "Motor Overload",
        "Electronic thermal overload relay tripped.",
        "1. Reduce load. 2. Extend accel time. 3. Verify motor thermal parameters. 4. Check motor cooling.",
        "trip",
    ),
    (
        "OL2",
        "Drive Overload",
        "Drive overload detected — output current too high for too long.",
        "1. Reduce load or cycle time. 2. Use next larger drive. 3. Check for mechanical issues.",
        "trip",
    ),
    (
        "SC",
        "IGBT Short Circuit",
        "Short circuit detected at IGBT output.",
        "1. Check motor cables for damage. 2. Megger motor windings. 3. Check for loose connections. 4. Replace drive if internal failure.",
        "trip",
    ),
    (
        "PF",
        "Input Phase Loss",
        "One of three input phases is missing.",
        "1. Check all three input phase voltages. 2. Check input fuses. 3. Check input contactor.",
        "trip",
    ),
    (
        "RR",
        "Braking Resistor Fault",
        "Braking transistor or resistor fault detected.",
        "1. Check braking resistor wiring. 2. Measure braking resistor value. 3. Check for short circuit in resistor.",
        "trip",
    ),
    (
        "CPF00",
        "Control Board Fault",
        "Internal control board error detected.",
        "1. Cycle power. 2. If persistent, reset to factory defaults. 3. Replace control board.",
        "trip",
    ),
    (
        "EF0",
        "External Fault Input",
        "External fault signal received on digital input.",
        "1. Check external fault source. 2. Check wiring to external fault input. 3. Clear upstream fault.",
        "trip",
    ),
    (
        "BB",
        "Base Block",
        "Base block command active — output disabled.",
        "1. Check base block digital input. 2. Check parameter for BB function assignment. 3. Remove BB signal to resume.",
        "alarm",
    ),
    (
        "DEV",
        "Speed Deviation",
        "Difference between speed reference and feedback exceeded limit.",
        "1. Check encoder connection. 2. Verify encoder PPR setting. 3. Check for mechanical overload causing stall.",
        "warning",
    ),
    (
        "OS",
        "Overspeed",
        "Motor speed exceeded the overspeed detection level.",
        "1. Check for sudden load removal. 2. Verify overspeed parameter. 3. Check encoder feedback.",
        "trip",
    ),
    (
        "PGO",
        "Encoder Disconnect",
        "Encoder signal lost during closed-loop operation.",
        "1. Check encoder wiring. 2. Check encoder cable shield. 3. Verify encoder 5V supply. 4. Replace encoder if faulty.",
        "trip",
    ),
]

ABB_ACS580: list[tuple[str, str, str, str, str]] = [
    (
        "1",
        "Overcurrent",
        "Output current exceeded trip limit.",
        "1. Check motor cables for short circuit. 2. Megger motor insulation. 3. Check for sudden load changes. 4. Extend accel/decel ramps.",
        "trip",
    ),
    (
        "2",
        "Overvoltage",
        "DC link voltage exceeded maximum.",
        "1. Check supply voltage. 2. Extend decel ramp. 3. Enable overvoltage controller. 4. Add braking chopper and resistor.",
        "trip",
    ),
    (
        "3",
        "Undervoltage",
        "DC link voltage below minimum limit.",
        "1. Check supply voltage. 2. Check for voltage sags. 3. Check mains fuses.",
        "trip",
    ),
    (
        "5",
        "Analog Input Below Minimum",
        "Analog input signal below configured minimum.",
        "1. Check analog input wiring. 2. Verify transmitter output. 3. Check parameter scaling.",
        "trip",
    ),
    (
        "7",
        "AI2 Loss",
        "Analog input 2 signal below minimum.",
        "1. Check AI2 wiring. 2. Verify signal source. 3. Check parameter settings for AI2.",
        "trip",
    ),
    (
        "8",
        "Output Phase Loss",
        "Drive detected missing motor phase.",
        "1. Check motor cable connections. 2. Check for blown fuse. 3. Measure motor winding resistance.",
        "trip",
    ),
    (
        "9",
        "Supply Phase Loss",
        "Input supply phase missing.",
        "1. Check all three supply phase voltages. 2. Check input fuses. 3. Check upstream breaker.",
        "trip",
    ),
    (
        "10",
        "Drive Overtemperature",
        "Drive internal temperature exceeded limit.",
        "1. Check ambient temperature (max 40°C/50°C with derating). 2. Clean cooling fans. 3. Verify fan operation. 4. Reduce load.",
        "trip",
    ),
    (
        "11",
        "Motor Overtemperature",
        "Motor thermal model or PTC/KTY indicates overtemperature.",
        "1. Check if motor is overloaded. 2. Check motor ventilation. 3. Verify motor thermal parameters. 4. Check PTC/KTY wiring.",
        "trip",
    ),
    (
        "16",
        "Earth Fault",
        "Ground leakage current exceeded limit.",
        "1. Megger motor insulation. 2. Check motor cable condition. 3. Check for moisture. 4. Shorten cable if very long.",
        "trip",
    ),
    (
        "22",
        "IGBT Overtemperature",
        "Power module temperature exceeded safe limit.",
        "1. Check cooling air flow. 2. Clean heatsink. 3. Reduce load or switching frequency. 4. Check ambient temperature.",
        "trip",
    ),
    (
        "23",
        "Charging Fault",
        "DC bus did not charge to proper level during startup.",
        "1. Check supply voltage. 2. Check precharge circuit. 3. If persistent, internal hardware may be damaged.",
        "trip",
    ),
    (
        "31",
        "PPCC Link Failure",
        "Communication lost with control panel.",
        "1. Check control panel cable. 2. Reseat panel connector. 3. Try different control panel.",
        "warning",
    ),
    (
        "32",
        "Motor Stall",
        "Motor current at limit but speed is zero or very low.",
        "1. Check for mechanical jam. 2. Reduce load. 3. Check motor coupling. 4. Verify motor sizing.",
        "trip",
    ),
    (
        "52",
        "Safe Torque Off Active",
        "STO input activated — drive output disabled for safety.",
        "1. Check STO input wiring. 2. Verify safety relay output. 3. Clear safety condition upstream. 4. Check jumpers if STO not used.",
        "alarm",
    ),
    (
        "64",
        "Supply Overvoltage",
        "Input supply voltage exceeded maximum rating.",
        "1. Measure supply voltage. 2. Check for transients or power factor correction capacitors. 3. Use line reactor.",
        "trip",
    ),
    (
        "65",
        "Supply Undervoltage",
        "Input supply voltage below minimum rating.",
        "1. Measure supply voltage. 2. Check utility incoming power. 3. Verify transformer tap settings.",
        "trip",
    ),
]

SIEMENS_G120_SUPPLEMENT: list[tuple[str, str, str, str, str]] = [
    (
        "F1",
        "Overcurrent",
        "Motor current exceeded 200% of drive rated current.",
        "1. Check motor cables for short. 2. Megger motor. 3. Extend accel ramp. 4. Check for mechanical jam.",
        "trip",
    ),
    (
        "F2",
        "Overvoltage",
        "DC link voltage exceeded limit during braking.",
        "1. Extend decel time. 2. Enable Vdc controller. 3. Add braking resistor. 4. Check supply voltage.",
        "trip",
    ),
    (
        "F3",
        "Undervoltage",
        "DC link voltage too low.",
        "1. Check mains supply. 2. Check fuses. 3. Check for voltage dips.",
        "trip",
    ),
    (
        "F4",
        "Drive Overtemperature",
        "Power module temperature exceeded limit.",
        "1. Check fan operation. 2. Clean heatsink. 3. Check ambient temperature. 4. Reduce switching frequency.",
        "trip",
    ),
    (
        "F5",
        "IGBT Fault",
        "IGBT desaturation detected — short circuit or ground fault.",
        "1. Check motor cables. 2. Megger motor. 3. Check for ground fault. 4. Replace drive if internal failure.",
        "trip",
    ),
    (
        "F11",
        "Motor Overtemperature",
        "Motor temperature sensor (KTY/PTC) indicates overtemperature.",
        "1. Check motor load. 2. Verify cooling. 3. Check sensor wiring. 4. Allow motor to cool.",
        "trip",
    ),
    (
        "F12",
        "Motor Stall",
        "Motor current at limit, speed near zero.",
        "1. Check for mechanical blockage. 2. Reduce load. 3. Check motor coupling. 4. Verify motor parameters.",
        "trip",
    ),
    (
        "F17",
        "Encoder Fault",
        "Encoder signal lost or implausible.",
        "1. Check encoder cable. 2. Check encoder supply. 3. Verify encoder parameters. 4. Replace encoder.",
        "trip",
    ),
    (
        "F30",
        "Output Phase Fault",
        "Open circuit or asymmetry in motor phases.",
        "1. Check motor cable connections. 2. Check motor terminal box. 3. Measure winding resistance.",
        "trip",
    ),
    (
        "F35",
        "Input Phase Fault",
        "Input supply phase missing or heavily unbalanced.",
        "1. Check supply voltage all three phases. 2. Check input fuses. 3. Check upstream supply.",
        "trip",
    ),
    (
        "F40",
        "Parameter Error",
        "Invalid parameter detected during startup.",
        "1. Factory reset parameters. 2. Re-commission drive. 3. Check parameter file if loaded from card.",
        "trip",
    ),
    (
        "F52",
        "Safe Torque Off",
        "STO function active — safety input open.",
        "1. Check STO terminal wiring. 2. Verify safety relay output. 3. Bridge STO terminals if safety function not used.",
        "alarm",
    ),
    (
        "A501",
        "Current Limit",
        "Motor current has reached the current limit setting.",
        "1. Reduce load. 2. Check for mechanical binding. 3. Increase current limit if motor allows.",
        "warning",
    ),
    (
        "A502",
        "Overvoltage Warning",
        "DC link voltage approaching overvoltage trip level.",
        "1. Extend decel time. 2. Enable Vdc controller. 3. Check for regenerative load.",
        "warning",
    ),
    (
        "A504",
        "Drive Overtemperature Warning",
        "Power module approaching temperature limit.",
        "1. Check cooling. 2. Reduce load. 3. Check ambient temperature.",
        "warning",
    ),
    (
        "A505",
        "Motor Overtemperature Warning",
        "Motor approaching thermal limit per motor model.",
        "1. Reduce load. 2. Check motor ventilation. 3. Check cooling fan.",
        "warning",
    ),
]

GS_SUPPLEMENT: list[tuple[str, str, str, str, str, str, str]] = [
    # (code, description, cause, action, severity, manufacturer, model)
    (
        "OC",
        "Overcurrent at Constant Speed",
        "Output current exceeded 200% at constant speed.",
        "1. Check for sudden load change. 2. Check motor insulation. 3. Reduce load.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "OCA",
        "Overcurrent During Accel",
        "Output current exceeded 200% during acceleration.",
        "1. Extend accel time. 2. Check for mechanical binding. 3. Reduce load.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "OCD",
        "Overcurrent During Decel",
        "Output current exceeded 200% during deceleration.",
        "1. Extend decel time. 2. Add braking resistor. 3. Use coast-to-stop.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "OV",
        "Overvoltage",
        "DC bus voltage exceeded trip level.",
        "1. Extend decel time. 2. Add braking resistor. 3. Check input voltage.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "UV",
        "Undervoltage",
        "DC bus voltage too low.",
        "1. Check input power. 2. Check for sags. 3. Verify supply capacity.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "OH",
        "Drive Overheating",
        "Heatsink temperature exceeded limit.",
        "1. Check ambient temp. 2. Clean heatsink. 3. Verify fan operation. 4. Reduce carrier frequency.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "OL",
        "Overload",
        "Drive overload protection activated.",
        "1. Reduce load. 2. Extend accel time. 3. Use larger drive. 4. Check for mechanical binding.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "GF",
        "Ground Fault",
        "Ground fault detected at output.",
        "1. Megger motor. 2. Check cable insulation. 3. Check for moisture.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "CF1",
        "Communication Error",
        "RS-485 communication timeout.",
        "1. Check comm cable. 2. Check baud rate setting. 3. Check master device.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    (
        "EF",
        "External Fault",
        "External fault signal received on input terminal.",
        "1. Check external fault source. 2. Check input wiring. 3. Clear upstream condition.",
        "trip",
        "AutomationDirect",
        "GS10",
    ),
    # GS20 has similar codes plus additional ones
    (
        "OC",
        "Overcurrent at Constant Speed",
        "Output current exceeded 200% at constant speed.",
        "1. Check for sudden load change. 2. Check motor insulation. 3. Reduce load.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OCA",
        "Overcurrent During Accel",
        "Output current exceeded 200% during acceleration.",
        "1. Extend accel time. 2. Check for mechanical binding. 3. Reduce load.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OCD",
        "Overcurrent During Decel",
        "Output current exceeded 200% during deceleration.",
        "1. Extend decel time. 2. Add braking resistor. 3. Use coast-to-stop.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OV",
        "Overvoltage",
        "DC bus voltage exceeded trip level.",
        "1. Extend decel time. 2. Add braking resistor. 3. Check input voltage.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "UV",
        "Undervoltage",
        "DC bus voltage too low.",
        "1. Check input power. 2. Check for sags. 3. Verify supply capacity.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OH",
        "Drive Overheating",
        "Heatsink temperature exceeded limit.",
        "1. Check ambient temp. 2. Clean heatsink. 3. Verify fan operation. 4. Reduce carrier frequency.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OL",
        "Overload",
        "Drive overload protection activated.",
        "1. Reduce load. 2. Extend accel time. 3. Use larger drive. 4. Check for mechanical binding.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "GF",
        "Ground Fault",
        "Ground fault detected at output.",
        "1. Megger motor. 2. Check cable insulation. 3. Check for moisture.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "PHL",
        "Input Phase Loss",
        "Missing input phase detected.",
        "1. Check all three input phases. 2. Check fuses. 3. Check contactor.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "OPL",
        "Output Phase Loss",
        "Missing output phase to motor.",
        "1. Check motor cable connections. 2. Check for blown fuse. 3. Measure motor windings.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "CF1",
        "Communication Error",
        "RS-485 communication timeout.",
        "1. Check comm cable. 2. Check baud rate setting. 3. Check master device.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "EF",
        "External Fault",
        "External fault signal received on input terminal.",
        "1. Check external fault source. 2. Check input wiring. 3. Clear upstream condition.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
    (
        "STP",
        "Motor Stall Prevention",
        "Motor stall detected during operation.",
        "1. Check for mechanical jam. 2. Reduce load. 3. Verify motor sizing.",
        "warning",
        "AutomationDirect",
        "GS20",
    ),
    (
        "AUF",
        "Auto-tuning Fault",
        "Motor auto-tuning failed.",
        "1. Disconnect load from motor. 2. Verify motor nameplate parameters. 3. Retry auto-tune.",
        "trip",
        "AutomationDirect",
        "GS20",
    ),
]

POWERFLEX_SUPPLEMENT: list[tuple[str, str, str, str, str, str, str]] = [
    # PowerFlex 525 supplements
    (
        "F2",
        "Auxiliary Input",
        "External fault via auxiliary digital input.",
        "1. Check external fault source. 2. Check input wiring. 3. Clear upstream condition.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F4",
        "UnderVoltage",
        "DC bus voltage dropped below threshold.",
        "1. Check input AC voltage all phases. 2. Check for voltage sag. 3. Check input fuses.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F5",
        "OverVoltage",
        "DC bus voltage exceeded maximum limit.",
        "1. Extend decel time. 2. Add DB resistor. 3. Check input voltage for spikes.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F7",
        "Motor Overload",
        "Electronic motor overload relay tripped.",
        "1. Reduce load. 2. Check motor cooling. 3. Verify overload parameters match motor FLA.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F8",
        "Drive Overload",
        "Drive output exceeded rated current for too long.",
        "1. Reduce load. 2. Extend accel time. 3. Use next size drive.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F12",
        "HW OverCurrent",
        "Hardware overcurrent — IGBT protection triggered.",
        "1. Check motor cables. 2. Megger motor. 3. Check for ground fault. 4. Inspect drive IGBTs.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F13",
        "Ground Fault",
        "Ground fault detected on drive output.",
        "1. Megger motor insulation. 2. Check motor cables. 3. Check for moisture in motor.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F33",
        "Auto Rl Timeout",
        "Auto restart attempts exhausted.",
        "1. Investigate root cause of original fault. 2. Clear fault and restart manually.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F38",
        "Phase U to Ground",
        "Short circuit phase U to ground.",
        "1. Megger motor phase U. 2. Check cable U. 3. Inspect motor terminal.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F39",
        "Phase V to Ground",
        "Short circuit phase V to ground.",
        "1. Megger motor phase V. 2. Check cable V. 3. Inspect motor terminal.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F40",
        "Phase W to Ground",
        "Short circuit phase W to ground.",
        "1. Megger motor phase W. 2. Check cable W. 3. Inspect motor terminal.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F41",
        "Heatsink OvrTmp",
        "Drive heatsink overtemperature.",
        "1. Check ambient temperature. 2. Clean heatsink and fan. 3. Verify fan runs. 4. Reduce carrier frequency.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F48",
        "Phase Loss",
        "Input or output phase loss detected.",
        "1. Check all three input phases. 2. Check output connections. 3. Check fuses.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F64",
        "Software Overcurrent",
        "Software current limit exceeded (less severe than F12).",
        "1. Extend accel time. 2. Reduce load. 3. Check motor parameters.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    (
        "F100",
        "Parameter Checksum",
        "Parameter memory corrupted.",
        "1. Reset to factory defaults. 2. Re-enter parameters. 3. Replace drive if persistent.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 525",
    ),
    # PowerFlex 40 supplements
    (
        "F2",
        "Auxiliary Input",
        "External fault via auxiliary digital input.",
        "1. Check external fault source. 2. Check input wiring. 3. Clear upstream condition.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F4",
        "UnderVoltage",
        "DC bus voltage dropped below threshold due to input power loss or line imbalance.",
        "1. Monitor incoming line for phase loss. 2. Check input line fuse. 3. Verify supply voltage.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F5",
        "OverVoltage",
        "DC bus voltage exceeded maximum limit.",
        "1. Extend decel time. 2. Add dynamic braking resistor. 3. Check supply voltage.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F7",
        "Motor Overload",
        "Electronic thermal overload relay tripped.",
        "1. Reduce load. 2. Verify motor FLA parameter. 3. Check motor cooling.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F8",
        "Drive Overload",
        "Drive output current exceeded rating for too long.",
        "1. Reduce load or cycle time. 2. Extend accel time. 3. Use larger drive.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F12",
        "HW OverCurrent",
        "Hardware overcurrent — IGBT overcurrent on output.",
        "1. Megger motor insulation. 2. Check output cable. 3. Check for ground fault.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F13",
        "Ground Fault",
        "Ground fault detected on drive output.",
        "1. Megger motor. 2. Check cable insulation. 3. Check motor junction box for moisture.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F29",
        "Analog Input Loss",
        "4-20mA signal dropped below 4mA.",
        "1. Check transmitter. 2. Check wiring. 3. Verify loop power supply.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F41",
        "Heatsink OvrTmp",
        "Heatsink overtemperature.",
        "1. Check ambient temp. 2. Clean heatsink. 3. Check fan. 4. Reduce load.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F48",
        "Phase Loss",
        "Input or output phase loss.",
        "1. Check input phases. 2. Check output cable connections. 3. Check fuses.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
    (
        "F64",
        "Software Overcurrent",
        "Software current limit exceeded.",
        "1. Extend accel time. 2. Reduce load. 3. Check motor parameters.",
        "trip",
        "Rockwell Automation",
        "PowerFlex 40",
    ),
]


def _insert(
    conn,
    text_fn,
    tenant_id: str,
    code: str,
    description: str,
    cause: str,
    action: str,
    severity: str,
    manufacturer: str,
    model: str,
) -> bool:
    """Insert one fault code with UPSERT."""
    try:
        conn.execute(
            text_fn(
                "INSERT INTO fault_codes "
                "(id, tenant_id, code, description, cause, action, severity, "
                "equipment_model, manufacturer, source_chunk_id, source_url, page_num) "
                "VALUES (:id, :tid, :code, :desc, :cause, :action, :sev, "
                ":model, :mfr, '', 'seed_fault_codes.py', 0) "
                "ON CONFLICT (tenant_id, code, equipment_model) DO UPDATE SET "
                "description = EXCLUDED.description, cause = EXCLUDED.cause, "
                "action = EXCLUDED.action, severity = EXCLUDED.severity"
            ),
            {
                "id": str(uuid.uuid4()),
                "tid": tenant_id,
                "code": code.upper(),
                "desc": description,
                "cause": cause,
                "action": action,
                "sev": severity,
                "model": model,
                "mfr": manufacturer,
            },
        )
        return True
    except Exception as e:
        log.warning("Insert failed for %s %s %s: %s", manufacturer, model, code, e)
        return False


def main() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    parser = argparse.ArgumentParser(description="Seed VFD fault codes into NeonDB")
    parser.add_argument("--dry-run", action="store_true", help="Print codes without inserting")
    args = parser.parse_args()

    if not all([NEON_DATABASE_URL, MIRA_TENANT_ID]):
        sys.exit("ERROR: NEON_DATABASE_URL and MIRA_TENANT_ID required")

    # Build unified list: (code, desc, cause, action, severity, manufacturer, model)
    all_codes: list[tuple[str, str, str, str, str, str, str]] = []

    for code, desc, cause, action, sev in DANFOSS_VLT:
        all_codes.append((code, desc, cause, action, sev, "Danfoss", "VLT FC Series"))

    for code, desc, cause, action, sev in YASKAWA_A1000:
        all_codes.append((code, desc, cause, action, sev, "Yaskawa", "A1000"))

    for code, desc, cause, action, sev in ABB_ACS580:
        all_codes.append((code, desc, cause, action, sev, "ABB", "ACS580"))

    for code, desc, cause, action, sev in SIEMENS_G120_SUPPLEMENT:
        all_codes.append((code, desc, cause, action, sev, "Siemens", "SINAMICS G120"))

    # GS and PowerFlex supplements already have manufacturer/model in each tuple
    all_codes.extend(GS_SUPPLEMENT)
    all_codes.extend(POWERFLEX_SUPPLEMENT)

    log.info("Seeding %d fault codes across 6 VFD families", len(all_codes))

    if args.dry_run:
        for code, desc, cause, action, sev, mfr, model in all_codes:
            print(f"  {mfr:<25} {model:<20} {code:<8} {desc}")
        log.info("Dry run complete — %d codes would be inserted", len(all_codes))
        return

    engine = create_engine(
        NEON_DATABASE_URL,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )

    inserted = 0
    with engine.connect() as conn:
        for code, desc, cause, action, sev, mfr, model in all_codes:
            if _insert(conn, text, MIRA_TENANT_ID, code, desc, cause, action, sev, mfr, model):
                inserted += 1
        conn.commit()

    log.info("Done. %d of %d fault codes inserted/updated.", inserted, len(all_codes))


if __name__ == "__main__":
    main()
