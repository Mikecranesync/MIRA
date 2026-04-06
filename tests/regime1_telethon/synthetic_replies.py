"""Equipment-type-aware Turn 2/3 reply templates for the survey batch driver.

Turn 2: simulate a technician providing operational context after the bot
        identifies the equipment.
Turn 3: inject a fault code when has_fault_code=True (conditional).
"""
from __future__ import annotations

TURN2_TEMPLATES: dict[str, list[str]] = {
    "motor": [
        "Running continuously for 12 hours. Started making noise last shift.",
        "Drew higher current than normal this morning. Still spinning but vibrating.",
    ],
    "vfd": [
        "Drive shows a fault on the display. Was running at 60Hz before the error.",
        "Switched to manual bypass. Drive faulted after a brief power dip.",
    ],
    "pump": [
        "Discharge pressure dropped below spec. Inlet side seems normal.",
        "Ran 8 hours then cavitated. Restarted but pressure is still low.",
    ],
    "panel": [
        "Main breaker tripped last night. Reset held for a few hours then tripped again.",
        "Heard a pop and smelled burning from inside the cabinet.",
    ],
    "transformer": [
        "Secondary voltage readings are low across all phases. Primary looks normal.",
        "Unit is running hot. Getting a smell from the tank area.",
    ],
    "plc": [
        "Status LEDs are showing errors. Program was running fine yesterday.",
        "Inputs stopped responding about an hour ago. Power is on.",
    ],
    "breaker": [
        "Keeps tripping under normal load. Had been stable for over a year.",
        "Getting warm to the touch even at partial load.",
    ],
    "relay": [
        "Coil is energized but contacts won't close consistently.",
        "Chattering badly when load increases.",
    ],
    "sensor": [
        "Reading is stuck at a constant value. Used to fluctuate with the process.",
        "Controller is showing a sensor fault on that channel.",
    ],
    "contactor": [
        "Coil energizes but contacts aren't picking up reliably.",
        "Audible chattering under load when we bump it.",
    ],
    "wiring": [
        "Found corrosion on the terminals. Some insulation looks cracked.",
        "Noticed a loose lug on the main disconnect.",
    ],
    "compressor": [
        "Pressure isn't building past 80 PSI. Unloads normally but bleeds down fast.",
        "Loud knock at startup. Runs but sounds rough.",
    ],
    "generator": [
        "Output voltage is about 10% low. Ran fine on last test a month ago.",
        "Governor hunting — speed surges up and down under load.",
    ],
    "valve": [
        "Valve won't fully close. Flow continues even at 0% command.",
        "Actuator cycles but the disc doesn't seem to be moving.",
    ],
    "starter": [
        "Starter engages but motor doesn't reach full speed before it times out.",
        "Overload relay trips within seconds of start under normal load.",
    ],
    "other": [
        "Equipment isn't responding as expected. Status indicators look wrong.",
        "Intermittent failures over the last two shifts.",
    ],
}


def pick_turn2(equipment_type: str) -> str:
    """Return a deterministic Turn 2 reply for the given equipment type.

    Deterministic across runs: hash(equipment_type) % len(templates).
    Unknown types fall back to 'other'.
    """
    key = equipment_type.lower() if equipment_type else "other"
    templates = TURN2_TEMPLATES.get(key, TURN2_TEMPLATES["other"])
    return templates[hash(key) % len(templates)]


def turn3_message(fault_codes: str) -> str:
    """Return a Turn 3 fault code injection message.

    Takes the first code from a pipe-delimited fault_codes string.
    """
    first = fault_codes.split("|")[0].strip()
    return f"I can see {first} on the display right now. What does that mean?"
