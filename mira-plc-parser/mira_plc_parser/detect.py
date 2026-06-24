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
    needs_export: str = ""   # if set, a CLOSED project file -> what to export instead (actionable)


KNOWN_FORMATS = (
    "rockwell_l5x",
    "csv_tags",
    "plcopen_xml",
    "siemens_tia_xml",
    "structured_text",
    "ignition_json",         # Ignition tag-export JSON (UNS tag tree) -- ProveIt import engine
    "rockwell_acd",          # closed binary project -> export L5X
    "siemens_tia_project",   # closed project -> Openness XML export
    "step7_project",         # closed project -> XML/SCL export
    "codesys_project",       # closed project -> PLCopen XML export
    "archive",               # zip/7z bundle -> unpack + export
    "unknown",
)

# Closed / proprietary PROJECT files we cannot parse directly. The right answer is NOT "great" and
# NOT "unknown" -- it is a precise instruction to export the open interchange artifact and resend.
# extension -> (format_key, what-to-do guidance)
_CLOSED_PROJECTS = {
    ".acd": ("rockwell_acd",
             "This is a Rockwell Studio 5000 .ACD project (proprietary binary). Export it to L5X "
             "(File > Save As > .L5X, or right-click the controller > Export) and resend the .L5X."),
    ".ap14": ("siemens_tia_project", "Siemens TIA Portal project. Use TIA Openness to export blocks/"
              "tags to XML and resend the XML."),
    ".ap15": ("siemens_tia_project", "Siemens TIA Portal project. Export via TIA Openness to XML and resend."),
    ".ap16": ("siemens_tia_project", "Siemens TIA Portal project. Export via TIA Openness to XML and resend."),
    ".ap17": ("siemens_tia_project", "Siemens TIA Portal project. Export via TIA Openness to XML and resend."),
    ".ap18": ("siemens_tia_project", "Siemens TIA Portal project. Export via TIA Openness to XML and resend."),
    ".zap16": ("siemens_tia_project", "Siemens TIA archived project. Retrieve it, then Openness-export to XML."),
    ".zap17": ("siemens_tia_project", "Siemens TIA archived project. Retrieve it, then Openness-export to XML."),
    ".s7p": ("step7_project", "Siemens STEP 7 (classic) project. Export the symbol table / sources to "
             "SDF/SCL/XML and resend that."),
    ".project": ("codesys_project", "CODESYS project. Export to PLCopen XML (or the routines to "
                 "Structured Text) and resend."),
    ".rss": ("rockwell_acd", "Rockwell RSLogix 500 (.RSS) project (closed). Export the tag/program "
             "report or use an L5X-capable tool, and resend."),
    ".rsp": ("rockwell_acd", "Rockwell project file (closed). Export to L5X/report and resend."),
}
# archive bundles -- often a wrapped project; ask the user to unpack + export
_ARCHIVE_EXT = (".zip", ".7z", ".rar", ".tar", ".gz")

# content signatures (checked against the head of the file)
_L5X_RE = re.compile(r"<RSLogix5000Content", re.IGNORECASE)
_PLCOPEN_RE = re.compile(r"<project\b[^>]*xmlns[^>]*plcopen", re.IGNORECASE)
_PLCOPEN_RE2 = re.compile(r"http://www\.plcopen\.org/xml", re.IGNORECASE)
_SIEMENS_RE = re.compile(r"<SW\.(Blocks|Types|Tags)\.|<Document\b.*Siemens|TIAPortal", re.IGNORECASE)
_XML_RE = re.compile(r"^\s*<\?xml", re.IGNORECASE)
# Ignition tag-export JSON: a JSON object whose tree uses Ignition's tagType vocabulary. We require
# a Folder/UdtInstance/AtomicTag marker so a generic JSON config doesn't match.
_JSON_OBJ_RE = re.compile(r"^\s*\{")
_IGNITION_RE = re.compile(r'"tagType"\s*:\s*"(Folder|UdtInstance|AtomicTag|UdtType)"')
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

    # --- closed/proprietary PROJECT files: cannot parse; tell the user what to export ---
    for ext, (fmt, guidance) in _CLOSED_PROJECTS.items():
        if name.endswith(ext):
            return Detection(fmt, "high", "closed project file (%s)" % ext, needs_export=guidance)
    if name.endswith(_ARCHIVE_EXT):
        return Detection("archive", "high", "archive bundle",
                         needs_export="This looks like an archive. Unpack it and resend the actual "
                         "export (L5X / PLCopen XML / Openness XML / CSV).")
    # a renamed binary project (e.g. an .acd saved as .txt) -- detect by binary content, no XML/CSV
    if _looks_binary(text or "") and not _L5X_RE.search(head):
        return Detection("rockwell_acd", "medium", "binary content, not a text export",
                         needs_export="This appears to be a binary PLC project file, not a text "
                         "export. If it is a Rockwell .ACD, export it to L5X and resend.")

    # --- content-confirmed (high) ---
    if _L5X_RE.search(head):
        return Detection("rockwell_l5x", "high", "found <RSLogix5000Content> root")
    if _PLCOPEN_RE.search(head) or _PLCOPEN_RE2.search(head):
        return Detection("plcopen_xml", "high", "found PLCopen XML namespace")
    if _SIEMENS_RE.search(head):
        return Detection("siemens_tia_xml", "high", "found Siemens TIA/Openness XML markers")

    # --- Ignition tag-export JSON (the UNS tag tree) ---
    if _JSON_OBJ_RE.search(head) and _IGNITION_RE.search(head):
        return Detection("ignition_json", "high", "JSON object with Ignition tagType markers")

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


def _looks_binary(text: str) -> bool:
    """A NUL byte or a high share of control chars in the head = a binary file, not a text export."""
    sample = text[:2000]
    if not sample:
        return False
    if "\x00" in sample:
        return True
    ctrl = sum(1 for ch in sample if ord(ch) < 9 or (13 < ord(ch) < 32))
    return ctrl > len(sample) * 0.02


def _looks_like_csv(head: str) -> bool:
    lines = [ln for ln in head.replace("\r\n", "\n").replace("\r", "\n").split("\n") if ln.strip()]
    if len(lines) < 2:
        return False
    # at least one delimiter present consistently in the first couple of lines
    for delim in (",", ";", "\t", "|"):
        if all(delim in ln for ln in lines[:2]):
            return True
    return False
