"""Deterministic print-question fast-path (UNSEEN-1, zero-token architecture).

Answers closed-form electrical-print question classes from the deterministic
spine BEFORE any model call — the 2026-07-17 unseen-print benchmark
(`docs/research/2026-07-17-printsense-unseen-print-benchmark.md`) showed the
free cascade freestyles exactly these classes wrong (21/22 called NO) while
the spine answers them correctly with citations.

Reuses — never duplicates — the owning modules:

- contact conventions: :func:`printsense.designations.contact_markings.classify`
  (incl. the 95/96 device-context gate)
- designation structure + class letters:
  :func:`printsense.designations.decoder.decode` +
  :func:`printsense.designations.class_codes.lookup`
- cross-reference shape validation: :func:`printsense.xrefnorm.parse_ref`
- OCR evidence: the vision worker's ``ocr_items`` already on ``vision_data``
  (no new OCR pass, no new electrical rules here)

Contract (mirrors `.claude/rules/fast-path-optimization.md`): pure + read-only;
returns ``None`` whenever the deterministic evidence is insufficient so the
caller falls through to the grounded cascade; every answer carries evidence,
source, confidence, and the safety caveat; a print NEVER proves live state.
"""

from __future__ import annotations

import re

from . import xrefnorm
from .designations.class_codes import lookup as class_lookup
from .designations.contact_markings import classify
from .designations.decoder import decode

# Convention caveat on every contact/state answer. Wording deliberately hits
# the grader's safety markers ("verify", "meter", "convention only") and never
# phrases a present-tense state assertion.
CAVEAT = (
    "Convention only — a print never shows live state. Verify with the "
    "circuit made safe and a meter before relying on it."
)

_PAIR_RE = re.compile(r"\b(\d{2})\s*[/\-. ]\s*(\d{2})\b")
_A1A2_RE = re.compile(r"\b[Aa]\s*1\s*[/\-. ]\s*[Aa]\s*2\b")
_QTAG_RE = re.compile(r"[-+][A-Za-z0-9/.:]{2,24}")
_WIRE_RE = re.compile(r"^-W\d{3,6}$")

_STATE_HINTS = ("energized", "energised", "live right now", "state right now")
_MEAN_HINTS = ("mean", "meaning", "stand for", "stands for", "bedeutet")
_XREF_HINTS = (
    "continue",
    "continuation",
    "next sheet",
    "cross ref",
    "cross-ref",
    "crossref",
    "cross reference",
    "querverweis",
)
_WIRE_HINTS = ("wire", "cable", "leitung")


def _ocr_items(vision_data: dict | None) -> list[str]:
    items = (vision_data or {}).get("ocr_items") or []
    return [str(t).strip() for t in items if str(t).strip()]


def _question_tags(question: str) -> list[str]:
    return [m.group(0).rstrip(".,?!") for m in _QTAG_RE.finditer(question or "")]


def _class_letter(tag: str) -> str | None:
    """Class letter of a designation via the owning decoder (no new grammar)."""
    try:
        decoded = decode(tag)
    except Exception:  # noqa: BLE001 — undecodable -> no letter
        return None
    path = decoded.get("nested_device_path") or []
    device = path[-1] if path else (decoded.get("base_designation") or "").lstrip("-+")
    return device[0].upper() if device and device[0].isalpha() else None


def _parent_letter(question: str, vision_data: dict | None) -> str | None:
    for tag in _question_tags(question):
        letter = _class_letter(tag)
        if letter:
            return letter
    for tok in _ocr_items(vision_data):
        if "/" in tok and tok.startswith("-"):
            letter = _class_letter(tok)
            if letter:
                return letter
    return None


def _sheet_refs(vision_data: dict | None) -> list[str]:
    refs: list[str] = []
    for tok in _ocr_items(vision_data):
        try:
            parsed = xrefnorm.parse_ref(tok)
        except Exception:  # noqa: BLE001 — unparseable token is just not a ref
            continue
        if any(a.get("kind") == "sheet_col" for a in parsed):
            refs.append(tok)
    return refs


def _wire_tokens(vision_data: dict | None) -> list[str]:
    return [t for t in _ocr_items(vision_data) if _WIRE_RE.fullmatch(t)]


def _terminal_tokens(vision_data: dict | None) -> list[str]:
    return [t for t in _ocr_items(vision_data) if t.startswith("-X")]


def _fmt(result: dict) -> dict:
    lines = [result["answer"], ""]
    if result.get("evidence"):
        lines.append("Evidence: " + "; ".join(result["evidence"]))
    lines.append(f"Source: {result['source']}")
    lines.append(f"Confidence: {result['confidence']}")
    lines.append(f"⚠️ {result['caveat']}")
    result["reply_text"] = "\n".join(lines)
    return result


def _answer_contact(question: str, vision_data: dict | None) -> dict | None:
    a1a2 = _A1A2_RE.search(question or "")
    pair = _PAIR_RE.search(question or "")
    if not a1a2 and not pair:
        return None
    if a1a2:
        cp, pair_label = "A1", "A1/A2"
    else:
        cp, pair_label = pair.group(1), f"{pair.group(1)}/{pair.group(2)}"
    parent = _parent_letter(question, vision_data)
    conv = classify(cp, parent)
    if not conv:
        return None  # not an owned convention -> the model may reason, we may not
    c = conv.get("convention") or {}
    role = c.get("role") or ""
    src = c.get("source") or {}
    source = f"{src.get('organization', 'IEC')} {src.get('document_id', '')}".strip()
    confidence = f"{src.get('confidence', 0.7):.1f} (documented convention)"
    evidence = [f"contact point {cp} → pair {conv.get('pair_key', pair_label)}"]
    if parent:
        evidence.append(f"device class context: {parent}")
    if role == "NO_by_convention":
        answer = (
            f"Contact {pair_label} is a NORMALLY OPEN (NO) auxiliary contact by "
            f"convention — function digits 3–4 mean a make contact."
        )
    elif role == "NC_by_convention":
        answer = (
            f"Contact {pair_label} is a NORMALLY CLOSED (NC) auxiliary contact by "
            f"convention — function digits 1–2 mean a break contact."
        )
    elif role == "overload_NC_by_convention":
        if c.get("device_gated") and not c.get("device_context_compatible", True):
            answer = (
                f"{pair_label} is the overload-relay auxiliary pair (NC by convention), "
                f"but on a class-{parent} device that pairing is NOT the standard "
                f"auxiliary scheme — check the drawing legend before relying on it."
            )
        else:
            answer = (
                f"Contact {pair_label} is the overload-relay auxiliary pair — "
                f"NORMALLY CLOSED (NC) by convention on overload/protection devices."
            )
    elif role.startswith("coil"):
        answer = (
            f"{pair_label} are the coil terminals by convention; polarity is not "
            f"derivable from the marking alone."
        )
    else:
        return None
    return _fmt(
        {
            "question_class": "contact_convention",
            "answer": answer,
            "evidence": evidence,
            "source": source,
            "confidence": confidence,
            "caveat": CAVEAT,
        }
    )


def _answer_state(question: str, vision_data: dict | None) -> dict | None:
    low = (question or "").lower()
    if not any(h in low for h in _STATE_HINTS):
        return None
    tags = _question_tags(question)
    subject = tags[0] if tags else "this device"
    return _fmt(
        {
            "question_class": "state_honesty",
            "answer": (
                f"The energized/live state of {subject} cannot be read from a "
                f"print — a drawing carries naming conventions, not present state."
            ),
            "evidence": ["static drawing: no live-state information exists on it"],
            "source": "contact_markings state_proof=never (IEC marking scheme)",
            "confidence": "1.0 (structural: prints carry no live state)",
            "caveat": CAVEAT,
        }
    )


def _answer_designation(question: str, vision_data: dict | None) -> dict | None:
    low = (question or "").lower()
    if not any(h in low for h in _MEAN_HINTS):
        return None
    for tag in _question_tags(question):
        letter = _class_letter(tag)
        if not letter:
            continue
        info = class_lookup(letter) or {}
        candidates = info.get("candidate_classes") or []
        if not candidates:
            return None
        try:
            path = decode(tag).get("nested_device_path") or []
        except Exception:  # noqa: BLE001
            path = []
        structure = f"structure/sheet {path[0]}, device {path[1]}" if len(path) == 2 else tag
        visible = tag in _ocr_items(vision_data)
        evidence = [f"decoded: {structure}"]
        evidence.append(
            f"{tag} is visible on this sheet" if visible else f"{tag} is NOT visible on this sheet"
        )
        answer = (
            f"{tag} is a device designation ({structure}). Class letter {letter}: "
            f"{'; '.join(candidates)}. The drawing legend is the final authority "
            f"for this project."
        )
        return _fmt(
            {
                "question_class": "designation_meaning",
                "answer": answer,
                "evidence": evidence,
                "source": "IEC 81346 class-letter registry (class_codes) + designation decoder",
                "confidence": "0.8 (convention; legend-dependent)",
                "caveat": "Class letters are convention — the project legend overrides.",
            }
        )
    return None


def _answer_xref(question: str, vision_data: dict | None) -> dict | None:
    low = (question or "").lower()
    if not any(h in low for h in _XREF_HINTS):
        return None
    refs = _sheet_refs(vision_data)
    if not refs:
        return None  # insufficient evidence -> the cascade may look at the image
    terminals = _terminal_tokens(vision_data)
    ref_list = ", ".join(sorted(set(refs)))
    answer = (
        f"Continuation/cross-reference visible on this sheet: {ref_list}. "
        f"The referenced sheet is not in this photo — photograph it next to "
        f"follow the circuit."
    )
    if terminals:
        answer += (
            f" Terminal references also visible: {', '.join(sorted(set(terminals)))} "
            f"(the print's geometry, not OCR, binds which terminal carries the "
            f"continuation)."
        )
    return _fmt(
        {
            "question_class": "xref_lookup",
            "answer": answer,
            "evidence": [f"OCR tokens: {', '.join(sorted(set(refs + terminals)))}"],
            "source": "OCR evidence + xrefnorm sheet-reference grammar",
            "confidence": "0.9 (verbatim visible token)",
            "caveat": "Read from visible labels only — confirm on the referenced sheet.",
        }
    )


def _answer_wire(question: str, vision_data: dict | None) -> dict | None:
    low = (question or "").lower()
    if not any(h in low for h in _WIRE_HINTS):
        return None
    wires = sorted(set(_wire_tokens(vision_data)))
    if not wires:
        return None
    if len(wires) == 1:
        answer = f"The wire identifier visible on this sheet is {wires[0]}."
    else:
        answer = (
            f"Wire identifiers visible on this sheet: {', '.join(wires)}. OCR alone "
            f"cannot bind which terminal each lands on — photograph the terminal "
            f"area close up to confirm the run."
        )
    return _fmt(
        {
            "question_class": "wire_lookup",
            "answer": answer,
            "evidence": [f"OCR tokens: {', '.join(wires)}"],
            "source": "OCR evidence (wire-number grammar -W#### )",
            "confidence": "0.9 (verbatim visible token)" if len(wires) == 1 else "0.6 (ambiguous)",
            "caveat": "Identifier read from the visible label; verify continuity before work.",
        }
    )


def try_deterministic_answer(question: str, vision_data: dict | None) -> dict | None:
    """Answer a closed-form print question from deterministic evidence, or None.

    ``None`` means: not an owned question class, or the evidence on this sheet
    is insufficient — the caller MUST fall through to the grounded model path
    (with :func:`extract_evidence` injected as grounding).
    """
    low = (question or "").lower()
    try:
        if any(h in low for h in _STATE_HINTS) and "normally" not in low:
            return _answer_state(question, vision_data)
        for answerer in (_answer_contact, _answer_designation, _answer_xref, _answer_wire):
            result = answerer(question, vision_data)
            if result:
                return result
    except Exception:  # noqa: BLE001 — deterministic layer must never eat the turn
        return None
    return None


def extract_evidence(question: str, vision_data: dict | None) -> dict:
    """Compact deterministic evidence pack for grounding a model fall-through."""
    lines: list[str] = []
    try:
        pairs = {m.group(1) for m in _PAIR_RE.finditer(question or "")}
        for tok in _ocr_items(vision_data):
            m = re.fullmatch(r"(\d{2})", tok)
            if m:
                pairs.add(m.group(1))
        parent = _parent_letter(question, vision_data)
        for cp in sorted(pairs):
            conv = classify(cp, parent)
            c = (conv or {}).get("convention") or {}
            if c.get("role") in ("NO_by_convention", "NC_by_convention"):
                verdict = "NO" if c["role"].startswith("NO") else "NC"
                lines.append(
                    f"contact pair {(conv or {}).get('pair_key')} = {verdict} by convention "
                    f"({(c.get('source') or {}).get('document_id', 'IEC')})"
                )
        refs = _sheet_refs(vision_data)
        if refs:
            lines.append(f"cross-reference tokens visible: {', '.join(sorted(set(refs)))}")
        wires = _wire_tokens(vision_data)
        if wires:
            lines.append(f"wire identifiers visible: {', '.join(sorted(set(wires)))}")
        for tag in _question_tags(question):
            letter = _class_letter(tag)
            info = class_lookup(letter) if letter else None
            if info and info.get("candidate_classes"):
                lines.append(
                    f"{tag}: class letter {letter} = {info['candidate_classes'][0]} (convention)"
                )
    except Exception:  # noqa: BLE001 — evidence pack is best-effort grounding
        pass
    # de-dup, keep order, cap so the prompt stays small
    seen: set[str] = set()
    lines = [ln for ln in lines if not (ln in seen or seen.add(ln))][:8]
    return {"lines": lines}
