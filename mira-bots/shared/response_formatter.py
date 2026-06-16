"""MIRA Response Formatter — parse and format LLM responses for display.

Extracted from engine.py (Supervisor class) to be independently testable.
engine.py delegates all parse/format work here.

Dependency direction: response_formatter ← guardrails (no engine imports)
"""

from __future__ import annotations

import json
import logging
import re

from .guardrails import scrub_fabricated_reflection

logger = logging.getLogger("mira-gsd")

# ── Regex constants (formerly in engine.py module scope) ─────────────────────

_JSON_RE = re.compile(r'\{[^{}]*"reply"[^{}]*\}', re.DOTALL)

_PADDING_OPTION_RE = re.compile(
    r"^(i'?m not sure|not sure|not applicable|n/?a|unknown|other|unsure"
    r"|i don'?t know|don'?t know|not visible|can'?t tell|cannot tell"
    r"|none of the above|maybe|possibly)\.?$",
    re.IGNORECASE,
)

_PLACEHOLDER_OPTION_RE = re.compile(r"^[\"']?\d+[.):\-]?[\"']?$")

_YES_OPTION_RE = re.compile(
    r"^(yes|yeah|yep|y|correct|true|confirmed|connected|present|on|good|ok|okay"
    r"|done|working|fine|all digits|all good)([,.]|\b).*$",
    re.IGNORECASE,
)
_NO_OPTION_RE = re.compile(
    r"^(no|nope|n|incorrect|false|wrong|disconnected|absent|off|bad|missing"
    r"|broken|single digit|not working|failed)([,.]|\b).*$",
    re.IGNORECASE,
)

_VISION_PROSE_HEAD_RE = re.compile(
    r"^\s*(?:i can see (?:this is\s+)?)?"
    r"(?:the image shows[^.\n]*\.\s*)+",
    re.IGNORECASE,
)
_VISION_PROSE_PREFIX_RE = re.compile(
    r"^\s*(?:i can see (?:this is\s+)?)?"
    r"(?:the image shows\s+(?:a |an |the )?)",
    re.IGNORECASE,
)


# ── Standalone utility functions ──────────────────────────────────────────────


def format_diagnostic_response(
    equipment_id: str, key_observation: str, question: str, options: list
) -> str:
    """Format a structured diagnostic reply with equipment header and options."""
    header = f"📷 {equipment_id} — {key_observation}"
    opts = "\n".join(f"{i + 1}. {opt}" for i, opt in enumerate(options))
    return f"{header}\n\n{question}\n{opts}"


def deduplicate_options(reply_text: str, keyboard_options: list) -> str:
    """Remove numbered option lines from reply_text that already appear in keyboard_options."""
    if not keyboard_options:
        return reply_text
    for opt in keyboard_options:
        reply_text = re.sub(rf"\n\d+\.\s+{re.escape(opt)}", "", reply_text)
    return reply_text.strip()


_FAULT_CODE_LOOKING = re.compile(r"^[FfEeAa]\d{2,5}$")


def _looks_like_model_number(text: str) -> str:
    """Return the first model-number-like token from text, or ''.

    A model number must contain both at least one letter and at least one
    digit (e.g. "GS20", "X3", "FC-302", "VLT-FC302").

    Tokens that look like fault codes (single F/E/A prefix + 2-5 digits, no
    hyphen) are skipped so "powerflex 525 f0004" does not return "f0004"
    as the model.
    """
    for raw in re.split(r"[\s,;]+", text):
        tok = re.sub(r"[^\w-]", "", raw)
        if len(tok) >= 2 and re.search(r"[A-Za-z]", tok) and re.search(r"\d", tok):
            if _FAULT_CODE_LOOKING.match(tok):
                continue
            return tok
    return ""


# ── LLM response parsing ──────────────────────────────────────────────────────


def _salvage_groq_json(parsed: dict) -> dict | None:
    """Attempt to extract a usable reply from non-standard Groq JSON."""
    follow_ups = parsed.get("follow_ups") or parsed.get("suggestions")
    if isinstance(follow_ups, list) and follow_ups:
        text = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(follow_ups[:4]))
        return {"next_state": None, "reply": text, "options": follow_ups[:4], "confidence": "LOW"}

    title = parsed.get("title")
    if isinstance(title, str) and title.strip():
        return {"next_state": None, "reply": title.strip(), "options": [], "confidence": "LOW"}

    queries = parsed.get("queries")
    if isinstance(queries, list) and queries:
        return {"next_state": None, "reply": queries[0], "options": [], "confidence": "LOW"}

    return None


def _extract_parsed(parsed: dict) -> dict:
    """Normalize a parsed JSON envelope into standard form."""
    raw_conf = parsed.get("confidence", "LOW")
    confidence = raw_conf if raw_conf in ("HIGH", "MEDIUM", "LOW") else "LOW"
    return {
        "next_state": parsed.get("next_state"),
        "reply": parsed["reply"],
        "options": parsed.get("options", []),
        "confidence": confidence,
    }


def parse_response(raw: str) -> dict:
    """Parse LLM response — try JSON envelope, fall back to plain text.

    Groq models frequently return JSON with non-standard keys like
    ``follow_ups``, ``tags``, ``title``, ``queries`` instead of the
    expected ``reply`` key. We attempt to salvage these into a valid
    response so the FSM doesn't stall.
    """
    raw_stripped = raw.strip()

    try:
        parsed = json.loads(raw_stripped, strict=False)
        if isinstance(parsed, dict):
            if "reply" in parsed:
                return _extract_parsed(parsed)
            parsed = _salvage_groq_json(parsed)
            if parsed:
                return parsed
    except (json.JSONDecodeError, TypeError):
        pass

    if "```" in raw_stripped:
        for block in raw_stripped.split("```"):
            block = block.strip()
            if block.startswith("json"):
                block = block[4:].strip()
            try:
                parsed = json.loads(block, strict=False)
                if isinstance(parsed, dict) and "reply" in parsed:
                    return _extract_parsed(parsed)
            except (json.JSONDecodeError, TypeError):
                continue

    for i in range(len(raw_stripped)):
        if raw_stripped[i] == "{":
            for j in range(len(raw_stripped), i, -1):
                if raw_stripped[j - 1] == "}":
                    try:
                        parsed = json.loads(raw_stripped[i:j].rstrip(), strict=False)
                        if isinstance(parsed, dict) and "reply" in parsed:
                            return _extract_parsed(parsed)
                    except (json.JSONDecodeError, TypeError):
                        continue
            break

    clean = raw_stripped
    brace_idx = clean.find("{")
    if brace_idx >= 0:
        close_idx = clean.rfind("}")
        if close_idx > brace_idx:
            clean = (clean[:brace_idx] + clean[close_idx + 1 :]).strip()
    if not clean:
        clean = raw_stripped
    logger.warning("parse_response fallback; raw=%r", raw_stripped[:200])
    return {"next_state": None, "reply": clean, "options": [], "confidence": "LOW"}


# ── Reply formatting ──────────────────────────────────────────────────────────


# Rockwell / Allen-Bradley document-type codes that show up in PDF filenames.
# When a model_number arrives looking like "193 um011 en p" we map "um" → "User Manual"
# and recognise the bulletin number so the user sees a readable label instead of the stem.
_DOC_TYPE_CODES = {
    "um": "User Manual",
    "in": "Installation Instructions",
    "sg": "Selection Guide",
    "qs": "Quick Start",
    "td": "Technical Data",
    "rm": "Reference Manual",
    "pp": "Product Profile",
    "ds": "Data Sheet",
    "wd": "Wiring Diagram",
    "fl": "Family Listing",
    "at": "Application Technique",
    "rn": "Release Notes",
    "ap": "Application Note",
}

# Bulletin / product-family hints we recognise from common Rockwell numbers.
# Conservative — only the codes we've actually ingested. Add as KB grows.
_BULLETIN_FAMILY = {
    "193": "Bulletin 193 E1 Plus Overload Relay",
    "1756": "ControlLogix 1756",
    "1769": "CompactLogix 1769",
    "1734": "POINT I/O 1734",
    "150": "SMC Flex Soft Starter",
    "pflex": "PowerFlex Drive",
    "powerflex": "PowerFlex Drive",
    "kinetix": "Kinetix Servo Drive",
    "stratix": "Stratix Switch",
}

# Pattern: a bulletin/series number, optional space, doc-type letters + digits,
# optional language code, optional trailing single letter. Matches "193 um011 en p",
# "193-um011-en-p", "pflex_um001_en_p", and similar filename stems.
_FILENAME_STEM_RE = re.compile(
    r"^\s*"
    r"(?P<series>[a-z0-9]+)"  # 193, pflex, 1756, etc.
    r"[\s_\-]+"
    r"(?P<doctype>[a-z]{2})"  # um, in, sg, etc.
    r"(?P<docnum>\d{2,4})"  # document number (011, 001, etc.)
    r"(?:[\s_\-]+(?:en|fr|de|es|it|jp|zh)\w?)?"  # optional language code
    r"(?:[\s_\-]+[a-z])?"  # optional trailing single letter (p = print)
    r"\s*$",
    re.IGNORECASE,
)


# Domains where we can infer the manufacturer from the URL hostname.
_DOMAIN_TO_MANUFACTURER = {
    "rockwellautomation.com": "Allen-Bradley",
    "ab.rockwellautomation.com": "Allen-Bradley",
    "literature.rockwellautomation.com": "Allen-Bradley",
    "siemens.com": "Siemens",
    "support.industry.siemens.com": "Siemens",
    "abb.com": "ABB",
    "library.e.abb.com": "ABB",
    "schneider-electric.com": "Schneider Electric",
    "automationdirect.com": "AutomationDirect",
    "factoryio.com": "Factory I/O",
}


def _manufacturer_from_url(src_url: str) -> str:
    """Best-effort manufacturer inference from a documentation URL hostname."""
    if not src_url:
        return ""
    m = re.match(r"^https?://([^/]+)/", src_url)
    if not m:
        return ""
    host = m.group(1).lower()
    for domain, mfr in _DOMAIN_TO_MANUFACTURER.items():
        if host.endswith(domain):
            return mfr
    return ""


def _parse_filename_stem(stem: str) -> str:
    """If stem matches the bulletin/doc-type pattern, return a clean label.

    Returns "" if no match — caller falls back to other strategies.
    """
    m = _FILENAME_STEM_RE.match(stem)
    if not m:
        return ""
    series = m.group("series").lower()
    doctype = m.group("doctype").lower()
    docnum = m.group("docnum")
    family = _BULLETIN_FAMILY.get(series, series.upper())
    doc_label = _DOC_TYPE_CODES.get(doctype, doctype.upper())
    return f"{family} — {doc_label} {docnum}".strip()


def _format_citation_label(c: dict) -> str:
    """Build a readable citation label from a chunk dict.

    Strategy:
    1. If model_number is set and matches the bulletin/filename pattern, expand it.
    2. If model_number is set and looks human, keep it as-is.
    3. If only source_url is set, parse the URL stem with the same pattern, and
       infer manufacturer from the hostname when possible.
    4. Otherwise, fall back to whatever non-empty pieces we have.
    Always optionally append the section, then the page number (when present).
    """
    mfr = (c.get("manufacturer") or "").strip()
    mdl = (c.get("model_number") or "").strip()
    section = (c.get("section") or "").strip()
    src_url = (c.get("source_url") or "").strip()
    # Pull page_num from the top-level field (set by rag_worker._build_kb_status)
    # and fall back to metadata for callers that haven't flattened it yet.
    page_num = c.get("page_num")
    if page_num is None:
        meta = c.get("metadata")
        if isinstance(meta, dict):
            page_num = meta.get("page_num")

    label = ""
    if mdl:
        cleaned = _parse_filename_stem(mdl)
        # If the parser found a known bulletin number, use the expansion;
        # otherwise keep model_number verbatim (already human, e.g. "PowerFlex 525").
        label = cleaned or mdl
    elif src_url:
        # No model_number — derive from URL stem and try the same parser.
        stub = src_url.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        cleaned = _parse_filename_stem(stub)
        if cleaned:
            label = cleaned
        else:
            label = re.sub(r"[_\-]+", " ", stub).strip().title() or "knowledge base"
        # Infer manufacturer from the URL when missing.
        if not mfr:
            mfr = _manufacturer_from_url(src_url)

    if mfr and label and not label.lower().startswith(mfr.lower()):
        label = f"{mfr} {label}"
    elif mfr and not label:
        label = mfr
    elif not label:
        label = "knowledge base"

    if section:
        label = f"{label} — {section}"
    if isinstance(page_num, int) and page_num > 0:
        label = f"{label}, p. {page_num}"
    return label


def _maybe_append_citation_footer(reply: str, kb_status: dict | None = None) -> str:
    """Append a Sources footer if KB chunks were used but the reply doesn't cite them."""
    citations = (kb_status or {}).get("citations") or []
    if not isinstance(citations, list) or not citations:
        return reply
    if "[Source:" in reply or "--- Sources ---" in reply:
        return reply
    # Deduplicate identical labels so we don't show the same source twice.
    seen: set[str] = set()
    lines = ["", "", "--- Sources ---"]
    idx = 1
    for c in citations:
        label = _format_citation_label(c)
        if label in seen:
            continue
        seen.add(label)
        lines.append(f"[{idx}] {label}")
        idx += 1
    return reply + "\n".join(lines)


def format_reply(parsed: dict, user_message: str = "", kb_status: dict | None = None) -> str:
    """Format parsed response for display.

    Shape rules (2026-04-19 audit):
    - Strip vision-prose leakage ("The image shows...") from reply head.
    - Strip fabricated reflections ("You've checked X" when user didn't say X).
    - Drop padding options banned by Rule 3 ("I'm not sure", "Other", etc.).
    - When remaining options are a Yes/No pair, render inline prose.
    - Otherwise fall back to the numbered-list rendering.
    - Append citation footer if KB chunks were used but reply lacks [Source: ...].
    """
    reply = parsed["reply"]
    options = parsed.get("options", [])

    reply = _VISION_PROSE_HEAD_RE.sub("", reply).lstrip()
    if user_message:
        reply = scrub_fabricated_reflection(reply, user_message)

    cleaned: list[str] = []
    for raw in options:
        if raw is None:
            continue
        text = re.sub(r"^\s*\d+[.):\-]\s*", "", str(raw)).strip()
        if len(text) <= 1:
            continue
        if _PLACEHOLDER_OPTION_RE.match(text):
            continue
        if _PADDING_OPTION_RE.match(text):
            continue
        cleaned.append(text)

    if len(cleaned) < 2:
        pass
    elif len(cleaned) == 2 and _YES_OPTION_RE.match(cleaned[0]) and _NO_OPTION_RE.match(cleaned[1]):
        reply = deduplicate_options(reply, cleaned)
        suffix = f"Reply: {cleaned[0]} or {cleaned[1]}."
        if not reply.rstrip().endswith((".", "?", "!")):
            reply = reply.rstrip() + "."
        reply = f"{reply} {suffix}"
    else:
        reply = deduplicate_options(reply, cleaned)
        reply += "\n\n" + "\n".join(f"{i + 1}. {opt}" for i, opt in enumerate(cleaned))

    return _maybe_append_citation_footer(reply, kb_status)
