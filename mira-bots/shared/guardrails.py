"""MIRA Guardrails — Intent classification, output validation, query expansion.

Pure Python, zero external dependencies.
"""

from __future__ import annotations

import random
import re

SAFETY_KEYWORDS = [
    "exposed wire",
    "energized conductor",
    "arc flash",
    "lockout tagout",
    "lockout/tagout",
    "loto",
    "visible smoke",
    "smoke from",
    "burn mark",
    "melted insulation",
    "electrical fire",
    "shock hazard",
    "rotating hazard",
    "pinch point",
    "entanglement",
    "confined space",
    "pressurized",
    "caught in",
    "crush hazard",
    "fall hazard",
    "chemical spill",
    "gas leak",
    # Electrical isolation / live-work phrases (added v2.4.1)
    "isolate the power",
    "isolating power",
    "isolating the power",
    "de-energize",
    "de-energizing",
    "pull the fuse",
    "pull the breaker",
    "pulling the fuse",
    "pulling the breaker",
    "removing power",
    "cutting power",
    "pull the power",  # "pull the power feed/cable while running" (added fix/eval)
    "pulling power",
    "live wire",
    "live circuit",
    "live panel",
    "working live",
    "working on live",
    # Temporal live-work phrases — Karpathy loop finding 2026-04-19
    "was live",
    "while live",
]

INTENT_KEYWORDS = {
    # Fault & alarm terms
    "fault",
    "error",
    "fail",
    "trip",
    "alarm",
    "down",
    "not working",
    "broken",
    "stopped",
    "issue",
    "warning",
    "faulting",
    "tripping",
    "wrong",
    "problem",
    "diagnose",
    "analyze",
    # Symptoms
    "vibration",
    "noise",
    "leak",
    "hot",
    "cold",
    "smell",
    "spark",
    "reading",
    "pressure",
    "temperature",
    "speed",
    "current",
    "voltage",
    # Actions
    "nameplate",
    "model",
    "serial",
    "reset",
    "calibrate",
    "replace",
    "code",
    "showing",
    "display",
    "mean",
    # Negation patterns
    "not respond",
    "not activat",
    "not working",
    "not turning",
    "not start",
    "output",
    "input",
    "no power",
    "no signal",
    "no output",
    "no response",
    # Equipment operation
    "parameter",
    "setting",
    "configure",
    "mode",
    "stop",
    "start",
    "run",
    "accel",
    "decel",
    "ramp",
    "frequency",
    "torque",
    "overload",
    # Specifications
    "spec",
    "specification",
    "rating",
    "rated",
    "capacity",
    "range",
    "limit",
    "tolerance",
    "ambient",
    "altitude",
    "enclosure",
    "dimension",
    # Installation
    "wire",
    "wiring",
    "install",
    "mount",
    "connect",
    "terminal",
    "cable",
    "ground",
    "grounding",
    "shield",
    "conduit",
    # General maintenance
    "maintenance",
    "inspect",
    "lubricate",
    "procedure",
    "schedule",
    "troubleshoot",
    "repair",
    "overhaul",
    "manual",
    # Equipment types
    "drive",
    "motor",
    "pump",
    "conveyor",
    "compressor",
    "sensor",
    "switch",
    "relay",
    "breaker",
    "fuse",
    "transformer",
    "contactor",
    "plc",
    "hmi",
    "vfd",
    "servo",
    "encoder",
    "actuator",
}

# Equipment brand/model names — always classify as industrial intent
_EQUIPMENT_NAME_RE = re.compile(
    r"\b("
    r"PowerFlex|CompactLogix|ControlLogix|PanelView|Micro8\d{2}"
    r"|Allen.?Bradley|Rockwell|Siemens|ABB|AutomationDirect"
    r"|SINAMICS|SIMATIC|ACS\d{3,4}|GS[12]\d|DURApulse|SMC-?\d"
    r"|Eaton|Omron|Fanuc|Mitsubishi|Schneider"
    r")\b",
    re.IGNORECASE,
)

# Regex for common fault code patterns (F-201, CE2, OC, OL, etc.)
_FAULT_CODE_RE = re.compile(
    r"\b[A-Z]{1,3}[-]?\d{1,4}\b"  # e.g. F-201, CE2, OC1, EF
)

# Educational question prefixes — messages that start with these are asking *about*
# a safety concept, not reporting an active hazard.  They bypass the safety
# short-circuit so the RAG path can answer them with real procedure info.
# "I need to de-energize this panel, what are the steps?" vs
# "there are exposed wires near the panel" — only the second is an active report.
_EDUCATIONAL_QUESTION_RE = re.compile(
    r"^(what|when|where|why|how|which|who|can you|could you|"
    r"is it|are there|does|do you|the |an |a[\s']|during |per |under |"
    r"define|explain|describe|list|what'?s)\b",
    re.IGNORECASE,
)

GREETING_PATTERNS = {
    "hello",
    "hi",
    "hey",
    "howdy",
    "good morning",
    "good afternoon",
    "good evening",
    "what's up",
    "sup",
    "yo",
    "thanks",
    "thank you",
    "bye",
    "goodbye",
    "see you",
    "later",
}

HELP_PATTERNS = {
    "what can you do",
    "help me",
    "how do you work",
    "what do you do",
    "can you help",
    "who are you",
    "what are you",
}

MAINTENANCE_ABBREVIATIONS = {
    "mtr": "motor",
    "vfd": "variable frequency drive",
    "oc": "overcurrent",
    "trpd": "tripped",
    "dwn": "down",
    "brk": "breaker",
    "xfmr": "transformer",
    "pnl": "panel",
    "sw": "switch",
    "cb": "circuit breaker",
    "ol": "overload",
    "uv": "undervoltage",
    "ov": "overvoltage",
    "gf": "ground fault",
    "plc": "programmable logic controller",
    "hmi": "human machine interface",
    "dcs": "distributed control system",
    "rtd": "resistance temperature detector",
    "tc": "thermocouple",
    "psi": "pounds per square inch",
    "rpm": "revolutions per minute",
    "hp": "horsepower",
    "kw": "kilowatt",
    "amp": "ampere",
    "hz": "hertz",
    "gpm": "gallons per minute",
    "cfm": "cubic feet per minute",
    "loto": "lockout tagout",
    "ppe": "personal protective equipment",
    "sop": "standard operating procedure",
    "pm": "preventive maintenance",
    "wo": "work order",
    "cmms": "computerized maintenance management system",
    "conv": "conveyor",
    "comp": "compressor",
    "gen": "generator",
    "xfer": "transfer",
    "msg": "message",
    "pwr": "power",
    "flt": "fault",
    "tmp": "temperature",
    "spd": "speed",
    "freq": "frequency",
    "ctrl": "control",
    "sys": "system",
    "seq": "sequencer",
    "e-stop": "emergency stop",
    "estop": "emergency stop",
    "pneu": "pneumatic",
    "hyd": "hydraulic",
    "cont": "contactor",
    "act": "actuator",
    "blk": "black",
    "wht": "white",
    "red": "red",
    "grn": "green",
    "blu": "blue",
    "prox": "proximity sensor",
    "sol": "solenoid",
    "vlv": "valve",
    "cyl": "cylinder",
    "brgn": "bearing",
    "brg": "bearing",
    "enc": "encoder",
    "srv": "servo",
    "io": "input output",
    "di": "digital input",
    "do": "digital output",
    "ai": "analog input",
    "ao": "analog output",
    "pid": "proportional integral derivative",
    "scr": "screen",
    "disp": "display",
    "pmp": "pump",
    "fdr": "feeder",
    "acc": "accumulator",
    "dmp": "damper",
    "exh": "exhaust",
    "intlk": "interlock",
}

_MENTION_RE = re.compile(r"<@[A-Z0-9]+>\s*")

# Vendor support URLs — used by both the documentation-intent routing in engine.py
# and the no-KB-coverage honesty signal in rag_worker.py.
VENDOR_SUPPORT_URLS: dict[str, str] = {
    "pilz": "pilz.com/support",
    "yaskawa": "yaskawa.com/service/support",
    "automationdirect": "automationdirect.com/support",
    "automation direct": "automationdirect.com/support",
    "allen-bradley": "rockwellautomation.com/support",
    "allen bradley": "rockwellautomation.com/support",
    "rockwell": "rockwellautomation.com/support",
    "powerflex": "rockwellautomation.com/support",
    "siemens": "siemens.com/support",
    "abb": "abb.com/support",
    "omron": "ia.omron.com/support",
    "schneider": "se.com/support",
    "schneider electric": "se.com/support",
    "mitsubishi": "mitsubishielectric.com/support",
    "danfoss": "danfoss.com/support",
    "eaton": "eaton.com/support",
    "delta": "deltaww.com/support",
    "lenze": "lenze.com/support",
    "bosch rexroth": "boschrexroth.com/support",
    "rexroth": "boschrexroth.com/support",
}


def vendor_support_url(text: str | None) -> str | None:
    """Return the support URL for the first recognized vendor found in text, or None."""
    if not text:
        return None
    text_lower = text.lower()
    for vendor, url in VENDOR_SUPPORT_URLS.items():
        if vendor in text_lower:
            return url
    return None


_VENDOR_DISPLAY_NAMES: dict[str, str] = {
    "pilz": "Pilz",
    "yaskawa": "Yaskawa",
    "automationdirect": "AutomationDirect",
    "automation direct": "AutomationDirect",
    "allen-bradley": "Allen-Bradley",
    "allen bradley": "Allen-Bradley",
    "rockwell": "Rockwell Automation",
    "powerflex": "Rockwell Automation",
    "siemens": "Siemens",
    "abb": "ABB",
    "omron": "Omron",
    "schneider electric": "Schneider Electric",
    "schneider": "Schneider Electric",
    "mitsubishi": "Mitsubishi Electric",
    "danfoss": "Danfoss",
    "eaton": "Eaton",
    "delta": "Delta Electronics",
    "lenze": "Lenze",
    "bosch rexroth": "Bosch Rexroth",
    "rexroth": "Bosch Rexroth",
}


def vendor_name_from_text(text: str | None) -> str | None:
    """Return a display-ready manufacturer name for the first recognized vendor in text."""
    if not text:
        return None
    text_lower = text.lower()
    for vendor, name in _VENDOR_DISPLAY_NAMES.items():
        if vendor in text_lower:
            return name
    return None


# Phrases that unambiguously signal a documentation retrieval request.
# Checked BEFORE the generic industrial check so "manual" in INTENT_KEYWORDS
# does not swallow document requests into the diagnostic RAG path.
_DOCUMENTATION_PHRASES = (
    "do you have the manual",
    "do you have a manual",
    "do you have the datasheet",
    "do you have a datasheet",
    "do you have documentation",
    "have the manual",
    "find the manual",
    "find me the manual",
    "find me a manual",
    "find a manual",  # v2.4.1: "can you find a manual for..."
    "get me the manual",
    "get the manual",
    "get a manual",  # v2.4.1: "get a manual for this"
    "send me the manual",
    "where is the manual",
    "where can i find the manual",
    "where to find the manual",
    "i need the manual",
    "need the manual",
    "need a manual",  # v2.4.1: "I need a manual for..."
    "looking for a manual",  # v2.4.1: "I'm looking for a manual"
    "looking for the manual",
    "find the datasheet",
    "find a datasheet",  # v2.4.1
    "get me the datasheet",
    "get the datasheet",
    "get a datasheet",  # v2.4.1
    "where is the datasheet",
    "where can i find the datasheet",
    "where to find the datasheet",
    "i need the datasheet",
    "need the datasheet",
    "need a datasheet",  # v2.4.1
    "looking for a datasheet",  # v2.4.1
    "looking for the datasheet",
    "pinout",
    "pin out",
    "wiring diagram for",
    "get the documentation",  # v2.4.1: explicit doc retrieval requests
    "find the documentation",
    "get documentation for",
    "find documentation for",
    "is there a manual",  # 2026-04-19 audit: e4ced7d8 phrasing
    "is there a datasheet",
    "is there documentation",
    "got a manual",
    "got the manual",
    "any manual",
    "any documentation",
    "any datasheet",
    "show me the pin",  # "show me the pinout" / "show me the pin out"
    "manual for this",  # fallback broad-match; safe post-v2.4.1 since it requires "for this"
    "datasheet for this",
    "documentation for this",
    # Installation / setup / commissioning (MicroLogix forensic 2026-04-21)
    "how to install",
    "installation steps",
    "install this",
    "installing this",
    "getting ready to install",
    "first steps to install",
    "how do i wire",
    "wiring steps",
    "wiring guide",
    "how to wire",
    "setup guide",
    "set up this",
    "setting up this",
    "how to set up",
    "commissioning steps",
    "commissioning guide",
    "how to commission",
    "startup procedure",
    "startup steps",
    "first time setup",
    "initial setup",
    "getting started with",
)

# Signals that the technician is under time or job pressure.
EMOTIONAL_PRESSURE_SIGNALS = [
    "days",
    "hours",
    "all week",
    "all month",
    "third time",
    "fourth time",
    "fifth time",
    "again and again",
    "keeps faulting",
    "keeps tripping",
    "my boss",
    "the boss",
    "manager",
    "write me up",
    "write up",
    "fired",
    "end of shift",
    "shift ends",
    "deadline",
    "losing my job",
    "my fault",
    "blamed me",
    "shutting down",
    "production down",
    "line's down",
    "line is down",
]

# Signals that the technician is a junior / first-timer.
JUNIOR_SIGNALS = [
    "i'm new",
    "im new",
    "new to this",
    "first time",
    "just started",
    "don't know much",
    "not sure what",
    "i think it might",
    "learning",
    "can you explain",
    "what does that mean",
    "what is a",
]

# Signals that the technician is experienced.
SENIOR_SIGNALS = [
    "fla",
    "oc ",
    "ol ",
    "gf ",
    "uvf",
    "ovf",
    "loto",
    "rms",
    "thd",
    "svc",
    "acr",
    "plc tag",
    "rung",
    "ladder logic",
    "struct text",
]

# Greeting variants — randomized so repeat users don't see the same string.
_GREETING_VARIANTS = [
    (
        "Hey \u2014 I'm MIRA, your maintenance copilot. "
        "Send me a photo of equipment, a fault code, or describe what's "
        "going on and I'll help you diagnose it."
    ),
    (
        "MIRA here. Photo, fault code, or symptom description \u2014 "
        "tell me what you've got and we'll work through it."
    ),
    ("Hey. What's the equipment and what's it doing?"),
]

SESSION_FOLLOWUP_SIGNALS = [
    "you said",
    "you mentioned",
    "you told me",
    "link",
    "url",
    "website",
    "manufacturer",
    "datasheet",
    "manual",
    "document",
    "earlier",
    "before",
    "last time",
    "again",
    "repeat",
    "what was",
    "where did",
    "explain",
    "why",
    "tell me more",
    "go deeper",
    "how does that work",
    "what does that mean",
    "break it down",
    "more detail",
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


_SELECTION_RE = re.compile(r"^\s*(?:option\s+)?(\d+)[.\-,):]?\s*", re.IGNORECASE)


def resolve_option_selection(message: str, last_options: list[str]) -> str | None:
    """If message starts with a numbered selection, return the matching option text.

    Handles natural replies like "2", "2.", "option 2", "2 again", "2 - yes".
    When the user adds a short filler (<20 chars) after the number, the bare
    option text is returned.  When they add a meaningful elaboration (>=20 chars),
    the elaboration is appended: "<option> — <elaboration>".

    Returns None if the message does not start with a valid in-range number.
    """
    m = _SELECTION_RE.match(message)
    if not m:
        return None
    idx = int(m.group(1)) - 1  # 1-indexed to 0-indexed
    if not (0 <= idx < len(last_options)):
        return None
    remainder = message[m.end() :].strip()
    selected = last_options[idx]
    if len(remainder) < 20:
        return selected
    return f"{selected} — {remainder}"


def strip_mentions(message: str) -> str:
    """Remove Slack-style @mention tags from message text."""
    return _MENTION_RE.sub("", message).strip()


def detect_expertise_level(message: str) -> str:
    """Estimate technician expertise from vocabulary.

    Returns: 'senior' | 'junior' | 'unknown'

    Used by the inference layer to hint the prompt (Rule 17).
    Not used for routing — only for context enrichment.
    """
    msg_lower = message.lower()
    junior_hits = sum(1 for s in JUNIOR_SIGNALS if s in msg_lower)
    senior_hits = sum(1 for s in SENIOR_SIGNALS if s in msg_lower)

    # Terse messages with abbreviations lean senior; verbose with uncertainty lean junior
    word_count = len(message.split())
    if word_count < 8 and senior_hits > 0:
        return "senior"
    if junior_hits >= 2:
        return "junior"
    if junior_hits == 1 and senior_hits == 0:
        return "junior"
    if senior_hits >= 2:
        return "senior"
    return "unknown"


def detect_emotional_state(message: str) -> str:
    """Detect emotional pressure signals in the technician's message.

    Returns: 'pressured' | 'neutral'

    'pressured' covers downtime duration, job threat, repeated failure.
    Used by inference layer to trigger Rule 18 acknowledgment.
    """
    msg_lower = message.lower()
    hits = sum(1 for s in EMOTIONAL_PRESSURE_SIGNALS if s in msg_lower)
    return "pressured" if hits >= 1 else "neutral"


def classify_intent(message: str) -> str:
    """Classify message intent.

    Returns: 'greeting' | 'help' | 'industrial' | 'documentation' | 'safety' | 'off_topic'

    'documentation' fires when the technician explicitly asks for a manual,
    datasheet, pinout, or wiring diagram — distinct from a diagnostic question
    that happens to reference a manual.  It routes to an immediate vendor-URL
    response + async KB crawl rather than the standard RAG diagnostic path.

    Industrial intent is broad — any question about equipment, specifications,
    installation, maintenance, or fault diagnosis. The default for unrecognized
    queries is 'industrial' (not 'off_topic') because the cost of blocking a
    real maintenance question is much higher than running RAG on a greeting.
    """
    msg = strip_mentions(message).lower().strip()
    msg_expanded = expand_abbreviations(msg)

    # Safety short-circuit: only fires for active hazard reports, not educational
    # questions about safety concepts.  Educational framing ("what is arc flash",
    # "how do I perform LOTO", "the restricted approach boundary is defined as")
    # routes to industrial so RAG can provide real procedure information.
    if any(kw in msg for kw in SAFETY_KEYWORDS):
        if not _EDUCATIONAL_QUESTION_RE.match(msg):
            return "safety"

    if any(pat in msg for pat in HELP_PATTERNS):
        return "help"

    # Documentation retrieval — checked BEFORE industrial so "manual" in
    # INTENT_KEYWORDS doesn't swallow explicit document requests.
    if any(phrase in msg for phrase in _DOCUMENTATION_PHRASES):
        return "documentation"

    # Industrial signals — check BEFORE greeting to avoid false positives on
    # messages like "hi my vfd is down" (17 chars, contains "hi" greeting word
    # but also has "down" in INTENT_KEYWORDS). The original ordering checked
    # greetings first to avoid "hi" triggering "hmi", but that's not a real
    # risk: expand_abbreviations("hi") stays "hi" and substring matching
    # checks INTENT_KEYWORDS-in-text, not text-in-INTENT_KEYWORDS.
    if any(kw in msg_expanded for kw in INTENT_KEYWORDS):
        return "industrial"

    # Fault code pattern match (F-201, CE2, OC1, etc.)
    if _FAULT_CODE_RE.search(message):
        return "industrial"

    # Equipment brand/model name match (PowerFlex, Micro820, etc.)
    if _EQUIPMENT_NAME_RE.search(message):
        return "industrial"

    # Short greetings — only reached if no industrial signal was found
    words = set(msg.split())
    if (words & GREETING_PATTERNS and len(msg) < 20) or len(msg) < 4:
        return "greeting"

    # Default to industrial — a maintenance bot should attempt to help
    return "industrial"


# 2026-04-19 audit — Rule 21 verbatim-reflection enforcement.
#
# Pattern: LLM opens reply with "You've [verb] [noun]" claiming the technician
# did something they didn't describe. In session b500953b the LLM said
# "You've checked cable labels" three separate times after the user said nothing
# about labels. Similarly "You've removed the main power cable" when the user
# said "I pulled the big one in the middle".
#
# Strategy: detect fabrication reflections and strip the opening sentence when
# the user's last message doesn't contain a matching verb (or common synonym).
# Conservative — only strip when fabrication is clear, never touch questions.
_REFLECTION_OPENER_RE = re.compile(
    r"^\s*(?:So )?(?:You(?:'ve| have)\s+)"
    r"(checked|tried|verified|tested|inspected|measured|removed|pulled|disconnected"
    r"|swapped|replaced|reset|cycled|confirmed|ruled out)\s+"
    r"([^.?!]+)[.?!]\s*",
    re.IGNORECASE,
)

# Map reflection verbs to the set of user-message tokens that justify the
# reflection. If none of these appear in the user message, the reflection is
# fabricated and should be stripped.
_REFLECTION_VERB_JUSTIFIERS = {
    "checked": {
        "check",
        "checked",
        "checking",
        "look",
        "looked",
        "looking",
        "see",
        "saw",
        "verified",
        "verify",
    },
    "tried": {"try", "tried", "trying", "attempt", "attempted"},
    "verified": {"verify", "verified", "check", "checked", "confirm", "confirmed"},
    "tested": {"test", "tested", "testing", "meter", "metered", "measure", "measured"},
    "inspected": {"inspect", "inspected", "look", "looked", "check", "checked"},
    "measured": {"measure", "measured", "meter", "metered", "ohm", "volt", "amp"},
    "removed": {
        "remove",
        "removed",
        "pull",
        "pulled",
        "disconnect",
        "disconnected",
        "take",
        "took",
    },
    "pulled": {"pull", "pulled", "remove", "removed", "disconnect", "disconnected"},
    "disconnected": {
        "disconnect",
        "disconnected",
        "pull",
        "pulled",
        "remove",
        "removed",
        "unplug",
        "unplugged",
    },
    "swapped": {"swap", "swapped", "replace", "replaced", "change", "changed"},
    "replaced": {"replace", "replaced", "swap", "swapped", "change", "changed", "new"},
    "reset": {"reset", "resetting", "cycle", "cycled", "power"},
    "cycled": {"cycle", "cycled", "reset", "restart", "power"},
    "confirmed": {"confirm", "confirmed", "verify", "verified", "yes", "correct"},
    "ruled out": {"rule", "ruled", "eliminate", "eliminated", "not it"},
}


# 2026-04-19 — Rule 19 (DEPTH ON DEMAND) engine-side detection. The prompt
# already instructs the LLM to give a longer answer when these signals appear,
# but the engine needs to know too so it can (a) bump max_tokens for that turn
# and (b) skip ladder-cursor advancement (depth turns are detours, not steps).
_DEPTH_REQUEST_PHRASES = (
    "explain",
    "why",
    "tell me more",
    "go deeper",
    "how does that work",
    "how does it work",
    "what does that mean",
    "what does it mean",
    "break it down",
    "elaborate",
    "in detail",
    "more detail",
)


def detect_depth_request(message: str) -> bool:
    """True when the user asks for a longer, grounded explanation.

    Word-boundary substring check on the _DEPTH_REQUEST_PHRASES list. Skips
    very long messages (>400 chars) so we don't false-positive on prose that
    happens to contain "why" or "explain" — the signal is a short targeted
    ask. Also skips quoted "why" (e.g., "they asked me 'why'") by requiring
    that "why" appear as a whole token with trailing punctuation or sentence
    end, not mid-word.
    """
    if not message:
        return False
    msg = message.strip().lower()
    if len(msg) > 400:
        return False
    for phrase in _DEPTH_REQUEST_PHRASES:
        if phrase in msg:
            return True
    # Additional pattern: lone "why?" or "why?" with short qualifier
    if re.search(r"\bwhy\??$", msg):
        return True
    return False


def scrub_fabricated_reflection(reply: str, user_message: str) -> str:
    """Strip "You've [verb] X" opening sentences when the user never said it.

    2026-04-19 audit: LLM fabricates reflections like "You've checked cable
    labels" to sound like it's following the conversation, even when the user
    said nothing about checking labels. This function drops the fabrication
    clause so the real question/instruction stands alone.

    Returns reply unchanged when:
    - Reply doesn't open with a reflection pattern.
    - The verb IS justified by content in user_message (not fabricated).
    """
    if not reply or not user_message:
        return reply
    match = _REFLECTION_OPENER_RE.match(reply)
    if not match:
        return reply
    verb = match.group(1).lower()
    justifiers = _REFLECTION_VERB_JUSTIFIERS.get(verb, set())
    user_lower = user_message.lower()
    if any(token in user_lower for token in justifiers):
        return reply
    return reply[match.end() :].lstrip()


def check_output(response: str, intent: str, has_photo: bool = False) -> str:
    """Validate LLM response for hallucination. Returns cleaned response."""
    resp_lower = response.lower()

    # No "Transcribing" on text-only messages
    if not has_photo and "transcribing" in resp_lower:
        response = re.sub(r"(?i)transcribing[^.]*\.\s*", "", response).strip()

    # No industrial jargon in greeting/help responses
    if intent in ("greeting", "help"):
        hallucination_markers = [
            "soft starter",
            "modbus",
            "overcurrent",
            "variable frequency",
        ]
        if any(marker in resp_lower for marker in hallucination_markers):
            if intent == "greeting":
                return random.choice(_GREETING_VARIANTS)
            return "What equipment or fault code can I help you with?"

    # No system prompt leakage
    if intent not in ("industrial", "documentation") and "system prompt" in resp_lower:
        return "What equipment or fault code can I help you with?"

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
    original = message
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

    if not result or not result.strip():
        result = original

    if asset_identified:
        result = f"{asset_identified} \u2014 {result}"
    return result
