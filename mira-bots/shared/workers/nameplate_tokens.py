"""Deterministic nameplate-token extraction — the printed plate is ground truth.

A vision model reading a nameplate *guesses*; the plate does not. This module
pulls the high-signal, LABEL-ANCHORED tokens a plate actually prints — type /
catalog code, part number, serial, kW / HP, input voltage / current /
frequency — out of OCR text using regexes only. Zero LLM, zero network, pure
functions, no I/O (except the optional ``plate_ocr_text`` helper, which reuses
the existing Tesseract floor and never raises).

Why it exists (live defect, prod 2026-08-17): a Danfoss VLT AQUA Drive plate
came back from the vision model as ``manufacturer="VLT"`` (the product family,
not the maker), ``serial="TC=20P72B2R2XCNXXXXXXXXD"`` (a mangled read of the
T/C *type* line), and no catalog code at all — while the plate plainly printed
``T/C: FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX``, ``P/N: 131H4017`` and
``S/N: 02334H073``. The bot then asked the technician for a model number that
was already in the photo.

Trust model (deliberate, per-field — not a blanket "OCR wins"):

- **Anchored override** (``catalog``, ``serial``, ``kw``, ``hp``): the plate
  LABELS these values, so a deterministic read is evidence and the model's
  value for the same field is a guess. The token wins. Every override logs.
- **Fill-only** (``model``, ``voltage``, ``fla``, ``frequency``): written only
  when the model left the field empty. Which of several printed voltages is
  "the" voltage is a judgment call, so a deterministic read never overwrites a
  model read here.
- **manufacturer**: corrected only when the plate text names a KNOWN vendor
  (``shared.uns_resolver.VENDOR_ALIASES`` — the single vendor table in the
  repo, lazily imported, never copied) that canonicalizes differently from the
  model's answer. That is the "VLT -> Danfoss" fix.
- **Nothing is ever invented.** No anchor -> no token -> no change.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence

logger = logging.getLogger("mira.nameplate_tokens")

# Deterministic token names this module can produce. A superset of the
# nameplate field vocabulary (``part_number`` is kept as evidence even though
# it has no NAMEPLATE_FIELDS slot — the point of this module is to STOP
# discarding what the plate printed).
PLATE_TOKEN_FIELDS: tuple[str, ...] = (
    "manufacturer",
    "model",
    "catalog",
    "part_number",
    "serial",
    "kw",
    "hp",
    "voltage",
    "fla",
    "frequency",
)

# Fields where a labelled plate token BEATS the vision model's value.
OVERRIDE_FIELDS: tuple[str, ...] = ("catalog", "serial", "kw", "hp")

# Fields where a plate token only fills a gap the vision model left.
FILL_ONLY_FIELDS: tuple[str, ...] = ("model", "voltage", "fla", "frequency")

# An identifier value: starts alphanumeric, then alphanumerics and the
# separators real catalog/serial codes use. Deliberately excludes whitespace so
# a capture stops at the end of the token, not the end of the line.
_ID_TOKEN = r"([A-Z0-9][A-Z0-9\-/.]{2,})"

# A capture that is really the anchor's own trailing word, grabbed by regex
# backtracking on a keyword-only line ("CAT. NO.", "SERIAL NUMBER"). Such a
# capture is not a value at all.
_KEYWORD_NOISE = re.compile(
    r"^(?:NO\.?|NUMBER|SERIAL|MODEL|TYPE|CAT\.?|CATALOG|PART|SERIES|SPEC\.?|DATE|CODE|REF\.?)$",
    re.IGNORECASE,
)

# Type / catalog code. ``T/C`` is the Danfoss VLT label; TYPE, CAT NO and the
# Siemens ``1P`` data identifier cover the rest of the corpus.
_CATALOG_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\bT\s*/\s*C[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bTYPE(?:\s*(?:NO\.?|CODE))?[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bCAT(?:ALOG|\.)?\s*(?:NO\.?|NUMBER)?[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
)

_PART_NUMBER_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\bP\s*/\s*N[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bPART\s*(?:NO\.?|NUMBER)?[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"^1P[:.\s]+{_ID_TOKEN}", re.IGNORECASE),
)

_SERIAL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\bS\s*/\s*N[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bSN\b[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bSER(?:\.|IAL)?\s*(?:NO\.?|NUMBER)?[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
)

_MODEL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\bMODEL(?:\s*NO\.?)?[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
    re.compile(rf"\bM\s*/\s*N[:.#\s]*{_ID_TOKEN}", re.IGNORECASE),
)

# "TYPE" also labels short classifier codes on real plates ("TYPE PTC"), where
# the model's own fuller assignment was right. Require a substantial token.
_MIN_TYPE_CODE_LEN = 4

_KW_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*k\s*W\b", re.IGNORECASE)
_HP_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:HP\b|H\.P\.)", re.IGNORECASE)

# Electrical values are only read off a line the plate anchors to the INPUT
# side. An unanchored number could just as easily be the drive's OUTPUT rating.
_INPUT_LINE_RE = re.compile(r"^\s*(?:IN|INPUT)\b", re.IGNORECASE)
_VOLT_LABEL_RE = re.compile(r"\bVOLTS?\b|\bVOLTAGE\b", re.IGNORECASE)
_AMP_LABEL_RE = re.compile(r"\bFLA\b|\bAMP(?:S|ERES)?\b", re.IGNORECASE)
_FREQ_LABEL_RE = re.compile(r"\bFREQ(?:UENCY)?\b", re.IGNORECASE)

_VOLTAGE_TOKEN_RE = re.compile(r"(\d[\d\s.xX×/-]*V)(?![A-Za-z])")
_AMP_TOKEN_RE = re.compile(r"(\d+(?:[.,]\d+)?\s*A)(?![A-Za-z])")
_FREQ_TOKEN_RE = re.compile(r"(\d+(?:\s*/\s*\d+)?\s*Hz)(?![A-Za-z])", re.IGNORECASE)

# Vendor aliases too short or too overloaded to be safe on plate text: "AB"
# and "SEW" are real tokens elsewhere on a plate, and "DELTA" is how a motor
# plate names its winding connection, not its maker.
_AMBIGUOUS_PLATE_ALIASES = frozenset({"ab", "delta", "sew"})
_MIN_PLATE_ALIAS_LEN = 3


def _lines(ocr_text: str | Sequence[str] | None) -> list[str]:
    """Normalize OCR input (a blob or a list of line strings) to clean lines."""
    if not ocr_text:
        return []
    if isinstance(ocr_text, str):
        raw = ocr_text.splitlines()
    else:
        raw = [str(item) for item in ocr_text]
    return [line.strip() for line in raw if str(line).strip()]


def _capture(lines: list[str], pattern: re.Pattern[str]) -> str | None:
    """First non-noise capture of ``pattern`` across ``lines``."""
    for line in lines:
        match = pattern.search(line)
        if not match:
            continue
        value = match.group(1).strip().rstrip(".,;:")
        if not value or _KEYWORD_NOISE.match(value):
            continue
        return value
    return None


def _first_capture(lines: list[str], patterns: Sequence[re.Pattern[str]]) -> str | None:
    for pattern in patterns:
        value = _capture(lines, pattern)
        if value:
            return value
    return None


def _electrical_lines(lines: list[str], label: re.Pattern[str]) -> list[str]:
    """Lines the plate anchors to the input side (or to an explicit label)."""
    return [line for line in lines if _INPUT_LINE_RE.search(line) or label.search(line)]


def _squash(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _vendor_aliases() -> dict[str, str]:
    """The repo's single alias -> canonical-manufacturer table (lazy import).

    Imported lazily so this module stays dependency-free at import time (and
    keeps working in lean images where ``uns_resolver``'s dependency chain is
    absent). A failed import simply disables manufacturer canonicalization.
    """
    try:
        from ..uns_resolver import VENDOR_ALIASES
    except Exception as exc:  # noqa: BLE001 — absence is a degraded state, not an error
        logger.debug("nameplate_tokens: vendor alias table unavailable: %s", exc)
        return {}
    return VENDOR_ALIASES


def plate_manufacturer(ocr_text: str | Sequence[str] | None) -> str | None:
    """Canonical manufacturer named anywhere in the plate text, else ``None``.

    Longest alias first so a family alias that implies a maker ("aqua drive")
    is preferred over a bare substring. Aliases shorter than three characters,
    and the explicitly ambiguous ones, are skipped — a plate is a noisy
    haystack and a wrong maker is worse than no maker.
    """
    lines = _lines(ocr_text)
    if not lines:
        return None
    aliases = _vendor_aliases()
    haystack = "\n".join(lines).lower()
    for alias in sorted(aliases, key=len, reverse=True):
        if len(alias) < _MIN_PLATE_ALIAS_LEN or alias in _AMBIGUOUS_PLATE_ALIASES:
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", haystack):
            return aliases[alias]
    return None


def canonical_manufacturer(value: str | None) -> str | None:
    """Canonical name for a manufacturer string, or the trimmed string itself."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    return _vendor_aliases().get(text.lower()) or text


def extract_plate_tokens(ocr_text: str | Sequence[str] | None) -> dict[str, str]:
    """Deterministic, label-anchored tokens read off plate OCR text.

    Returns only the tokens actually found — never a key with a fabricated or
    empty value. Pure; never raises.
    """
    lines = _lines(ocr_text)
    if not lines:
        return {}

    tokens: dict[str, str] = {}

    type_code = _capture(lines, _CATALOG_PATTERNS[0])
    if not type_code:
        labelled_type = _capture(lines, _CATALOG_PATTERNS[1])
        if labelled_type and len(labelled_type) >= _MIN_TYPE_CODE_LEN:
            type_code = labelled_type
    if not type_code:
        type_code = _capture(lines, _CATALOG_PATTERNS[2])

    part_number = _first_capture(lines, _PART_NUMBER_PATTERNS)
    if part_number:
        tokens["part_number"] = part_number

    # A plate with no type/catalog anchor but a part number still has ONE
    # orderable identifier — use it rather than discarding the plate.
    catalog = type_code or part_number
    if catalog:
        tokens["catalog"] = catalog

    serial = _first_capture(lines, _SERIAL_PATTERNS)
    if serial:
        tokens["serial"] = serial

    model = _first_capture(lines, _MODEL_PATTERNS)
    if model:
        tokens["model"] = model

    kw_match = _KW_RE.search("\n".join(lines))
    if kw_match:
        tokens["kw"] = f"{kw_match.group(1)} kW"

    hp_match = _HP_RE.search("\n".join(lines))
    if hp_match:
        tokens["hp"] = f"{hp_match.group(1)} HP"

    voltage_lines = _electrical_lines(lines, _VOLT_LABEL_RE)
    voltage = _capture(voltage_lines, _VOLTAGE_TOKEN_RE)
    if voltage:
        tokens["voltage"] = _squash(voltage)

    amp_lines = _electrical_lines(lines, _AMP_LABEL_RE)
    fla = _capture(amp_lines, _AMP_TOKEN_RE)
    if fla:
        tokens["fla"] = _squash(fla)

    freq_lines = _electrical_lines(lines, _FREQ_LABEL_RE)
    frequency = _capture(freq_lines, _FREQ_TOKEN_RE)
    if frequency:
        tokens["frequency"] = _squash(frequency)

    manufacturer = plate_manufacturer(lines)
    if manufacturer:
        tokens["manufacturer"] = manufacturer

    return tokens


def merge_plate_tokens(
    fields: dict, tokens: dict[str, str]
) -> tuple[dict, dict[str, tuple[str | None, str]]]:
    """Merge deterministic plate tokens into vision-extracted ``fields``.

    Returns ``(merged_fields, overrides)`` where ``overrides`` maps each
    changed field to ``(previous_value, plate_value)``. ``fields`` is not
    mutated. Pure; never raises.
    """
    merged = dict(fields or {})
    overrides: dict[str, tuple[str | None, str]] = {}
    if not tokens:
        return merged, overrides

    for name in OVERRIDE_FIELDS:
        value = tokens.get(name)
        if not value:
            continue
        previous = merged.get(name)
        if previous and str(previous).strip().upper() == value.upper():
            continue
        merged[name] = value
        overrides[name] = (previous, value)

    for name in FILL_ONLY_FIELDS:
        value = tokens.get(name)
        if value and not merged.get(name):
            merged[name] = value
            overrides[name] = (None, value)

    plate_mfr = tokens.get("manufacturer")
    if plate_mfr:
        previous_mfr = merged.get("manufacturer")
        if canonical_manufacturer(previous_mfr) != plate_mfr:
            merged["manufacturer"] = plate_mfr
            overrides["manufacturer"] = (previous_mfr, plate_mfr)

    # Evidence, not a field: the part number survives even when the catalog
    # slot took the type code instead.
    if tokens.get("part_number"):
        merged["part_number"] = tokens["part_number"]

    for name, (previous, value) in sorted(overrides.items()):
        logger.info(
            "nameplate_tokens: plate %s %s: %r -> %r (plate text is ground truth)",
            "override" if previous else "fill",
            name,
            previous,
            value,
        )
    return merged, overrides


def apply_plate_ocr(
    fields: dict, ocr_text: str | Sequence[str] | None
) -> tuple[dict, dict[str, str], dict[str, tuple[str | None, str]]]:
    """``extract_plate_tokens`` + ``merge_plate_tokens`` in one call.

    Returns ``(merged_fields, tokens, overrides)``.
    """
    tokens = extract_plate_tokens(ocr_text)
    merged, overrides = merge_plate_tokens(fields, tokens)
    return merged, tokens, overrides


def has_anchored_identity(tokens: dict[str, str]) -> bool:
    """Did the plate print a LABELLED identifier (catalog / part no / serial)?

    True is a very strong "this photo is a nameplate" signal — those anchors do
    not appear on equipment photos or schematics.
    """
    return bool(tokens.get("catalog") or tokens.get("part_number") or tokens.get("serial"))


# Order matters: identity first, then ratings — a technician reads top-down.
_PLATE_READ_LABELS: tuple[tuple[str, str], ...] = (
    ("manufacturer", ""),
    ("model", ""),
    ("catalog", "type "),
    ("part_number", "P/N "),
    ("serial", "S/N "),
    ("kw", ""),
    ("hp", ""),
    ("voltage", ""),
    ("fla", ""),
    ("frequency", ""),
)


def format_plate_read(fields: dict) -> str:
    """One-line summary of what was actually read off the plate ("" if nothing)."""
    parts: list[str] = []
    seen: set[str] = set()
    for name, prefix in _PLATE_READ_LABELS:
        value = (fields or {}).get(name)
        if not value:
            continue
        text = str(value).strip()
        if not text or text.upper() in seen:
            continue
        seen.add(text.upper())
        parts.append(f"{prefix}{text}")
    return " · ".join(parts)


def missing_identity_ask(fields: dict) -> str | None:
    """The ONE thing still missing, or ``None`` when nothing is.

    Never asks for a field the extraction already produced — the live defect
    this module exists to kill was MIRA asking for a model number that was
    printed in the photo it had just read.
    """
    source = fields or {}
    if source.get("model") or source.get("catalog") or source.get("part_number"):
        return None
    if source.get("manufacturer"):
        return (
            "I still need the model or type/catalog code — it's the line labelled "
            "TYPE, T/C, CAT NO or P/N."
        )
    return "Send a closer, glare-free shot of the plate so I can read the maker and type code."


def plate_ocr_text(image_bytes: bytes) -> str:
    """Tesseract-floor plate text for ``image_bytes`` ("" when unavailable).

    Reuses the vision worker's existing OCR adapter (one Tesseract seam in the
    codebase, not two) and degrades honestly: a lean image without printsense,
    a missing binary, or an unreadable photo all return "". Synchronous —
    callers run it in a thread. Never raises.
    """
    if not image_bytes:
        return ""
    try:
        from .vision_worker import _printsense_line_items, _tesseract_tokens_impl

        return "\n".join(_printsense_line_items(_tesseract_tokens_impl(image_bytes)))
    except Exception as exc:  # noqa: BLE001 — the OCR floor must never eat a turn
        logger.warning("nameplate_tokens: plate OCR unavailable: %s", exc)
        return ""
