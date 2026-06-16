"""Vendor / format detector -- the first stage of the pipeline.

Given a filename + the raw bytes/text of an upload, decide which parser should handle it. Detection
is by CONTENT first (a renamed .txt L5X is still an L5X), with the extension as a tiebreaker. We
only need to route to a parser here -- the parser does the real extraction.

Phase 1 recognizes: rockwell_l5x, csv_tags, and (stubs, for routing only) plcopen_xml,
siemens_tia_xml, structured_text. Everything else -> "unknown".
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Detection:
    fmt: str            # canonical format key (see KNOWN_FORMATS)
    confidence: str     # "high" (content-confirmed) | "medium" (extension/heuristic) | "low"
    reason: str         # human-readable why


KNOWN_FORMATS = (
    "rockwell_l5x",
    "csv_tags",
    "plcopen_xml",
    "siemens_tia_xml",
    "structured_text",
    "unknown",
)

# content signatures (checked against the head of the file)
_L5X_RE = re.compile(r"<RSLogix5000Content", re.IGNORECASE)
_PLCOPEN_RE = re.compile(r"<project\b[^>]*xmlns[^>]*plcopen", re.IGNORECASE)
_PLCOPEN_RE2 = re.compile(r"http://www\.plcopen\.org/xml", re.IGNORECASE)
_SIEMENS_RE = re.compile(r"<SW\.(Blocks|Types|Tags)\.|<Document\b.*Siemens|TIAPortal", re.IGNORECASE)
_XML_RE = re.compile(r"^\s*<\?xml", re.IGNORECASE)
# ST: IEC 61131-3 structured-text keywords commonly opening a program/function block
_ST_RE = re.compile(
    r"\b(PROGRAM|FUNCTION_BLOCK|FUNCTION|VAR(_INPUT|_OUTPUT|_GLOBAL)?)\b.*\b(END_(PROGRAM|FUNCTION_BLOCK|FUNCTION|VAR))\b",
    re.IGNORECASE | re.DOTALL,
)


def _head(text: str, n: int = 4000) -> str:
    return text[:n]


def detect(filename: str, text: str) -> Detection:
    """Classify an upload from its name + decoded text."""
    name = (filename or "").lower()
    head = _head(text or "")

    # --- content-confirmed (high) ---
    if _L5X_RE.search(head):
        return Detection("rockwell_l5x", "high", "found <RSLogix5000Content> root")
    if _PLCOPEN_RE.search(head) or _PLCOPEN_RE2.search(head):
        return Detection("plcopen_xml", "high", "found PLCopen XML namespace")
    if _SIEMENS_RE.search(head):
        return Detection("siemens_tia_xml", "high", "found Siemens TIA/Openness XML markers")

    # --- structured text (high if keyword-bracketed, else medium by extension) ---
    if _ST_RE.search(head):
        return Detection("structured_text", "high", "IEC 61131-3 ST program/FB keywords")

    # --- CSV (content heuristic: comma/semicolon-separated, no XML) ---
    if not _XML_RE.search(head) and _looks_like_csv(head):
        return Detection("csv_tags", "high", "delimited rows, no XML root")

    # --- extension fallbacks (medium) ---
    if name.endswith(".l5x"):
        return Detection("rockwell_l5x", "medium", "extension .l5x (content not confirmed)")
    if name.endswith(".xml"):
        if "plcopen" in name:
            return Detection("plcopen_xml", "medium", "extension .xml + plcopen in name")
        return Detection("plcopen_xml", "low", "generic .xml -- unconfirmed; try PLCopen")
    if name.endswith((".st", ".scl", ".exp", ".iecst")):
        return Detection("structured_text", "medium", "ST-family extension")
    if name.endswith(".csv"):
        return Detection("csv_tags", "medium", "extension .csv")
    if name.endswith((".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff")):
        return Detection("unknown", "low", "image/PDF -- OCR fallback not built (Phase 7)")

    return Detection("unknown", "low", "no known signature or extension matched")


def _looks_like_csv(head: str) -> bool:
    lines = [ln for ln in head.replace("\r\n", "\n").replace("\r", "\n").split("\n") if ln.strip()]
    if len(lines) < 2:
        return False
    # at least one delimiter present consistently in the first couple of lines
    for delim in (",", ";", "\t", "|"):
        if all(delim in ln for ln in lines[:2]):
            return True
    return False
