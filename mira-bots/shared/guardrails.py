"""MIRA Guardrails — Intent classification, output validation, query expansion.

Pure Python, zero external dependencies.
"""

import re

SAFETY_KEYWORDS = [
    "exposed wire", "energized conductor", "arc flash", "lockout", "tagout",
    "loto", "smoke", "burn mark", "melted insulation", "electrical fire",
    "shock hazard", "rotating hazard", "pinch point", "entanglement",
    "confined space", "pressurized", "caught in", "crush hazard",
    "fall hazard", "chemical spill", "gas leak",
]

INTENT_KEYWORDS = {
    "fault", "error", "fail", "trip", "alarm", "down", "not working",
    "broken", "stopped", "issue", "warning", "faulting", "tripping",
    "wrong", "problem", "diagnose", "analyze",
    "vibration", "noise", "leak", "hot", "cold", "smell", "spark",
    "reading", "pressure", "temperature", "speed", "current", "voltage",
    "nameplate", "model", "serial", "reset", "calibrate", "replace",
    "code", "showing", "display", "mean",
    "not respond", "not activat", "not working", "not turning", "not start",
    "output", "input", "no power", "no signal", "no output", "no response",
}

# Regex for common fault code patterns (F-201, CE2, OC, OL, etc.)
_FAULT_CODE_RE = re.compile(
    r"\b[A-Z]{1,3}[-]?\d{1,4}\b"  # e.g. F-201, CE2, OC1, EF
)

GREETING_PATTERNS = {
    "hello", "hi", "hey", "howdy", "good morning", "good afternoon",
    "good evening", "what's up", "sup", "yo", "thanks", "thank you",
    "bye", "goodbye", "see you", "later",
}

HELP_PATTERNS = {
    "what can you do", "help me", "how do you work", "what do you do",
    "can you help", "who are you", "what are you",
}

MAINTENANCE_ABBREVIATIONS = {
    "mtr": "motor", "vfd": "variable frequency drive", "oc": "overcurrent",
    "trpd": "tripped", "dwn": "down", "brk": "breaker", "xfmr": "transformer",
    "pnl": "panel", "sw": "switch", "cb": "circuit breaker", "ol": "overload",
    "uv": "undervoltage", "ov": "overvoltage", "gf": "ground fault",
    "plc": "programmable logic controller", "hmi": "human machine interface",
    "dcs": "distributed control system", "rtd": "resistance temperature detector",
    "tc": "thermocouple", "psi": "pounds per square inch", "rpm": "revolutions per minute",
    "hp": "horsepower", "kw": "kilowatt", "amp": "ampere",
    "hz": "hertz", "gpm": "gallons per minute", "cfm": "cubic feet per minute",
    "loto": "lockout tagout", "ppe": "personal protective equipment",
    "sop": "standard operating procedure", "pm": "preventive maintenance",
    "wo": "work order", "cmms": "computerized maintenance management system",
    "conv": "conveyor", "comp": "compressor", "gen": "generator", "xfer": "transfer",
    "msg": "message", "pwr": "power", "flt": "fault", "tmp": "temperature",
    "spd": "speed", "freq": "frequency", "ctrl": "control", "sys": "system",
    "seq": "sequencer", "e-stop": "emergency stop", "estop": "emergency stop",
    "pneu": "pneumatic", "hyd": "hydraulic", "cont": "contactor", "act": "actuator",
    "blk": "black", "wht": "white", "red": "red", "grn": "green", "blu": "blue",
    "prox": "proximity sensor", "sol": "solenoid", "vlv": "valve", "cyl": "cylinder",
    "brgn": "bearing", "brg": "bearing", "enc": "encoder", "srv": "servo",
    "io": "input output", "di": "digital input", "do": "digital output",
    "ai": "analog input", "ao": "analog output", "pid": "proportional integral derivative",
    "scr": "screen", "disp": "display", "pmp": "pump", "fdr": "feeder",
    "acc": "accumulator", "dmp": "damper", "exh": "exhaust", "intlk": "interlock",
}

_MENTION_RE = re.compile(r"<@[A-Z0-9]+>\s*")

SESSION_FOLLOWUP_SIGNALS = [
    "you said", "you mentioned", "you told me", "link", "url", "website",
    "manufacturer", "datasheet", "manual", "document", "earlier", "before",
    "last time", "again", "repeat", "what was", "where did",
]


def detect_session_followup(message: str, session_context: dict, fsm_state: str) -> bool:
    """Return True if message is a follow-up to an active diagnostic session.

    Fires when: state is not IDLE, session_context exists, and message
    contains a signal word suggesting the technician is continuing the session
    (e.g. asking for a link, referencing something MIRA said earlier).
    """
    if fsm_state == "IDLE":
        return False
    if not session_context:
        return False
    msg_lower = message.lower()
    return any(sig in msg_lower for sig in SESSION_FOLLOWUP_SIGNALS)


def strip_mentions(message: str) -> str:
    """Remove Slack-style @mention tags from message text."""
    return _MENTION_RE.sub("", message).strip()


def classify_intent(message: str) -> str:
    """Classify message intent.

    Returns: 'greeting' | 'help' | 'industrial' | 'safety' | 'off_topic'
    """
    msg = strip_mentions(message).lower().strip()
    # Expand abbreviations so "mtr trpd" → "motor tripped" matches intent keywords
    msg_expanded = expand_abbreviations(msg)

    if any(kw in msg for kw in SAFETY_KEYWORDS):
        return "safety"

    if any(pat in msg for pat in HELP_PATTERNS):
        return "help"

    if any(kw in msg_expanded for kw in INTENT_KEYWORDS):
        return "industrial"

    # Fault code pattern match (F-201, CE2, OC1, etc.)
    if _FAULT_CODE_RE.search(message):
        return "industrial"

    if len(msg) > 60:
        return "off_topic"

    words = set(msg.split())
    if words & GREETING_PATTERNS or len(msg) < 4:
        return "greeting"

    return "off_topic"


def check_output(response: str, intent: str, has_photo: bool = False) -> str:
    """Validate LLM response for hallucination. Returns cleaned response."""
    resp_lower = response.lower()

    # No "Transcribing" on text-only messages
    if not has_photo and "transcribing" in resp_lower:
        response = re.sub(r"(?i)transcribing[^.]*\.\s*", "", response).strip()

    # No industrial jargon in greeting/help responses
    if intent in ("greeting", "help"):
        hallucination_markers = [
            "soft starter", "modbus", "overcurrent",
            "variable frequency",
        ]
        if any(marker in resp_lower for marker in hallucination_markers):
            if intent == "greeting":
                return (
                    "Hey \u2014 I'm MIRA, your maintenance copilot. "
                    "Send me a photo of equipment, a fault code, or describe what's "
                    "going on and I'll help you diagnose it."
                )
            return (
                "I help maintenance technicians diagnose equipment issues. "
                "Send me a photo of a fault screen, a fault code like "
                "'OC' or 'F-201', or describe what's happening with your equipment."
            )

    # No system prompt leakage
    if intent != "industrial" and "system prompt" in resp_lower:
        return (
            "I help maintenance technicians diagnose equipment issues. "
            "What can I help you with?"
        )

    return response


def expand_abbreviations(message: str) -> str:
    """Expand maintenance technician shorthand before vector search."""
    words = message.split()
    expanded = []
    for word in words:
        key = word.lower().strip(".,!?;:")
        if key in MAINTENANCE_ABBREVIATIONS:
            expanded.append(MAINTENANCE_ABBREVIATIONS[key])
        else:
            expanded.append(word)
    return " ".join(expanded)


def rewrite_question(message: str, asset_identified: str = None) -> str:
    """Reformulate vague questions into precise technical queries."""
    message = expand_abbreviations(message)
    rewrites = {
        "acting weird": "intermittent fault behavior",
        "not working": "failure to operate",
        "making noise": "abnormal vibration or acoustic emission",
        "running hot": "elevated temperature above rated specification",
        "won't start": "failure to start on command",
        "keeps stopping": "intermittent shutdown or trip",
    }
    result = message
    msg_lower = message.lower()
    for vague, precise in rewrites.items():
        if vague in msg_lower:
            result = msg_lower.replace(vague, precise)

    if asset_identified:
        result = f"{asset_identified} \u2014 {result}"
    return result
