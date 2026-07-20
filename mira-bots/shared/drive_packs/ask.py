"""Ask a drive pack — the read-only, deterministic text-question bridge.

Resolve a PROMOTED drive pack (``load_pack``) and answer a technician's plain
text question grounded ONLY in that pack's JSON — its fault codes, parameters,
and keypad-navigation cards — with the pack's own citations. This is the path
that lets a question like *"what does CE10 mean?"* reach the same pack
intelligence the live-telemetry path (``shared.live_snapshot.build_drive_diagnostic``)
already uses, WITHOUT needing a live snapshot / hardware.

Guarantees (the technician-safe contract):
- **Pack-grounded only.** Answers are composed from the pack + the offline
  fault-intel template reader (``shared.drive_fault_intel``) — never a generic
  LLM. ``fallback_used`` is always ``False``; an unmatched question yields an
  honest "not in the pack" answer, never a guess.
- **Static manual-pack intelligence.** ``live_telemetry`` is always ``False`` —
  this reads the pack, not the drive. No Modbus/Ignition, no live values.
- **Read-only.** No drive writes exist; parameter answers surface VIEW-only
  keypad steps + the pack's view-only warning.

Run it (from ``mira-bots/``):

    python -m shared.drive_packs.ask --pack durapulse_gs10 \
        --question "For a GS10 drive, what does CE10 mean?"
    python -m shared.drive_packs.ask --pack durapulse_gs10 \
        --question "Where is GS10 P09.03 documented?" --json
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from .cards import DiagnosticCard, build_cards
from .loader import load_pack
from .schema import Citation, DrivePack, FaultEntry, KeypadNavigationCard, ParameterCard

# A parameter id token in free text: dotted GS10 "P09.03" or PowerFlex "A105"/"C125".
_PARAM_ID_RE = re.compile(r"\b[A-Za-z]\d{2}\.\d{2}\b|\b[A-Za-z]{1,3}\d{2,3}\b")
_TIMEOUT_RE = re.compile(r"time[\s-]?out", re.IGNORECASE)

# A numeric fault code is trusted ONLY when it carries a fault context: a word
# like "fault"/"error"/"trip"/"code"/"alarm" immediately preceding the number,
# OR a PowerFlex-style "F005"/"F5" display token (letter F directly before the
# digits, NOT followed by a decimal — so a DuraPulse frequency display "F60.0"
# is excluded). A BARE integer ("5 A", "45.0 Hz") is deliberately NOT a code —
# a miss is safe, a confident wrong cited hit is a grounding-contract violation.
_NUM_FAULT_CONTEXT_RE = re.compile(
    r"(?:\bfaults?(?:\s+code)?|\berr(?:or)?s?|\btrips?|\bcode|\balarms?)\s*#?\s*0*(\d{1,3})\b"
    r"|\bF0*(\d{1,3})\b(?![.\d])",
    re.IGNORECASE,
)
# A "code-like" leading mnemonic — letters then REQUIRED digits (CE10, CE1,
# F004). Requiring a digit is what keeps this safe: it excludes both the
# plain-English fault names PowerFlex uses as its value ("OverVoltage", and the
# word-leads "Auto"/"Load"/"Net"/"Comm"/"SW" of its multi-word names) AND the
# pure-letter GS10 mnemonics ("oL"/"EF"/"GFF"/"Lvd") that could collide with
# English words — none of which we auto-extract from OCR in v1. Those remain
# answerable via an explicit ``answer_fault_code`` call.
_CODE_LIKE_MNEMONIC_RE = re.compile(r"[A-Za-z]{1,3}\d{1,3}\Z")


@dataclass
class DrivePackAnswer:
    """The structured, surface-agnostic result of asking a pack — carries the
    debug metadata an operator needs to trust the answer's origin."""

    pack_id: str
    resolved: bool  # did the pack load?
    schema_version: int | None
    family: str | None
    matched: bool  # did the question map to real pack content?
    matched_kind: str | None  # "fault" | "parameter" | None
    answer: str
    citations: list[dict[str, str]] = field(default_factory=list)
    answer_source: str = "drive_pack"  # "drive_pack" | "none"
    fallback_used: bool = False  # NEVER a generic/LLM fallback
    live_telemetry: bool = False  # static pack only — no live drive values
    read_only: bool = True  # no drive writes possible

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _template_reader(pack_id: str):
    """The offline fault-intel reader for a pack (causes/checks/citations), or
    None when the family has no curated intel yet (cards then carry the pack's
    own provenance citations only — still grounded, just less detail)."""
    if pack_id == "durapulse_gs10":
        from ..drive_fault_intel import build_gs10_template_reader

        return build_gs10_template_reader()
    return None


def _cite(c: Citation) -> dict[str, str]:
    return {"doc": c.doc, "page": c.page, "excerpt": c.excerpt}


def _fault_mnemonic(card: DiagnosticCard) -> str:
    """The leading fault mnemonic of a card's meaning ("CE10 modbus timeout" ->
    "CE10")."""
    return card.meaning.split()[0] if card.meaning else ""


def _params_for_fault(pack: DrivePack, mnemonic: str) -> list[ParameterCard]:
    m = mnemonic.upper()
    return [p for p in pack.parameters if any(rf.upper() == m for rf in p.related_faults)]


def _keypad_for(pack: DrivePack, parameter_id: str) -> KeypadNavigationCard | None:
    return next((k for k in pack.keypad_navigation if k.parameter_id == parameter_id), None)


def _fault_answer(
    pack: DrivePack, mnemonic: str, card: DiagnosticCard
) -> tuple[str, list[dict[str, str]]]:
    lines = [
        f"{pack.family.series} fault {mnemonic} — {card.meaning} "
        f"(per the {pack.family.series} manual)."
    ]
    if card.likely_causes:
        lines.append("Likely cause: " + " ".join(card.likely_causes))
    if card.first_checks:
        lines.append(
            "First checks (VIEW-ONLY — do not change any setting): " + " ".join(card.first_checks)
        )
    citations = list(card.citations)
    related = _params_for_fault(pack, mnemonic)
    for p in related:
        lines.append(f"Related parameter: {p.parameter_id} [{p.name}] — {p.purpose}")
        citations.append(p.source_citation)
        keypad = _keypad_for(pack, p.parameter_id)
        if keypad:
            lines.append(
                f"To VIEW {p.parameter_id} on the keypad: "
                + " ".join(keypad.keypad_steps)
                + f" {keypad.view_only_warning}"
            )
            citations.append(keypad.source_citation)
    return "\n".join(lines), [_cite(c) for c in citations]


def _param_answer(pack: DrivePack, param: ParameterCard) -> tuple[str, list[dict[str, str]]]:
    lines = [f"{pack.family.series} parameter {param.parameter_id} [{param.name}]: {param.purpose}"]
    spec = []
    if param.range is not None:
        spec.append(f"range {param.range}")
    if param.default is not None:
        spec.append(f"default {param.default}")
    if param.unit:
        spec.append(f"unit {param.unit}")
    if spec:
        lines.append("Spec: " + ", ".join(spec) + ".")
    if param.related_faults:
        lines.append("Related fault(s): " + ", ".join(param.related_faults) + ".")
    citations = [param.source_citation]
    keypad = _keypad_for(pack, param.parameter_id)
    if keypad:
        lines.append(
            "To VIEW it on the keypad: "
            + " ".join(keypad.keypad_steps)
            + f" {keypad.view_only_warning}"
        )
        citations.append(keypad.source_citation)
    return "\n".join(lines), [_cite(c) for c in citations]


def _match_fault_entry(pack: DrivePack, token: str) -> FaultEntry | None:
    """Match a v3 ``FaultEntry`` by ``token`` — the reachable lookup for
    mnemonic-coded drives.

    Order: (1) case-SENSITIVE exact ``fault_id`` (``oC`` and ``OC`` are DISTINCT
    codes and must never be casefolded together — schema RUN_C decision #4);
    (2) a numeric ``wire_value`` match when the token is numeric AND exactly one
    entry carries that wire value; (3) an UNAMBIGUOUS case-insensitive match —
    OCR robustness, used ONLY when a single case-variant exists so it can't
    collapse two distinct codes. Returns ``None`` on no/ambiguous match — never
    guesses."""
    t = (token or "").strip()
    if not t:
        return None
    exact = pack.fault_entry(t, case_sensitive=True)
    if exact is not None:
        return exact
    numeric = re.fullmatch(r"[Ff]?0*(\d{1,3})", t)
    if numeric:
        code = int(numeric.group(1))
        wired = [e for e in pack.fault_entries if e.wire_value == code]
        if len(wired) == 1:
            return wired[0]
    target = t.casefold()
    insensitive = [e for e in pack.fault_entries if e.fault_id.casefold() == target]
    return insensitive[0] if len(insensitive) == 1 else None


def _fault_entry_answer(pack: DrivePack, entry: FaultEntry) -> tuple[str, list[dict[str, str]]]:
    """Compose a cited, VIEW-ONLY answer from a v3 ``FaultEntry``.

    Uses the entry's OWN ``source_citation`` (per-fault provenance — not the
    pack-wide source list), and surfaces any documented related parameters +
    view-only keypad steps, exactly like :func:`_fault_answer`. Read-only, no
    guess: text is the manufacturer's own ``action`` string."""
    label = f"{entry.fault_id} — {entry.name}" if entry.name else entry.fault_id
    lines = [f"{pack.family.series} fault {label} (per the {pack.family.series} manual)."]
    if entry.action:
        lines.append("First checks (VIEW-ONLY — do not change any setting): " + entry.action)
    citations: list[Citation] = []
    if entry.source_citation and entry.source_citation.doc:
        citations.append(entry.source_citation)
    for pid in entry.references_parameters:
        param = next((p for p in pack.parameters if p.parameter_id == pid), None)
        if param is None:
            continue
        lines.append(f"Related parameter: {param.parameter_id} [{param.name}] — {param.purpose}")
        citations.append(param.source_citation)
        keypad = _keypad_for(pack, param.parameter_id)
        if keypad:
            lines.append(
                f"To VIEW {param.parameter_id} on the keypad: "
                + " ".join(keypad.keypad_steps)
                + f" {keypad.view_only_warning}"
            )
            citations.append(keypad.source_citation)
    return "\n".join(lines), [_cite(c) for c in citations]


def answer_question(pack_id: str, question: str) -> DrivePackAnswer:
    """Answer ``question`` grounded ONLY in the ``pack_id`` drive pack. Never
    falls back to a generic answer; an unmatched question is reported honestly."""
    try:
        pack = load_pack(pack_id)
    except (FileNotFoundError, ValueError) as exc:
        return DrivePackAnswer(
            pack_id=pack_id,
            resolved=False,
            schema_version=None,
            family=None,
            matched=False,
            matched_kind=None,
            answer=f"The '{pack_id}' drive pack is not loaded ({exc}). I will not guess an answer.",
            citations=[],
            answer_source="none",
        )

    cards = build_cards(pack, template_reader=_template_reader(pack_id))
    family = pack.family.series
    q_upper = question.upper()

    def _result(kind: str, answer: str, citations: list[dict[str, str]]) -> DrivePackAnswer:
        return DrivePackAnswer(
            pack_id=pack.pack_id,
            resolved=True,
            schema_version=pack.schema_version,
            family=family,
            matched=True,
            matched_kind=kind,
            answer=answer,
            citations=citations,
            answer_source="drive_pack",
        )

    # 1) an explicit fault mnemonic in the question (CE10, GFF, Lvd, oL, EF...)
    for card in cards:
        mnemonic = _fault_mnemonic(card)
        if mnemonic and re.search(rf"\b{re.escape(mnemonic.upper())}\b", q_upper):
            answer, citations = _fault_answer(pack, mnemonic, card)
            return _result("fault", answer, citations)

    # 1b) a v3 fault_entries mnemonic in the question (oC, LL1, BE0) — case-
    #     SENSITIVE (oC and OC are distinct codes; never casefolded together).
    for entry in pack.fault_entries:
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(entry.fault_id)}(?![A-Za-z0-9])", question):
            answer, citations = _fault_entry_answer(pack, entry)
            return _result("fault", answer, citations)

    # 2) an explicit parameter id in the question (P09.03)
    params_by_id = {p.parameter_id.upper(): p for p in pack.parameters}
    for token in _PARAM_ID_RE.findall(question):
        param = params_by_id.get(token.upper())
        if param:
            answer, citations = _param_answer(pack, param)
            return _result("parameter", answer, citations)

    # 3) intent: "communication timeout" -> the comm-timeout parameter, if the
    #    pack has one (matched by the parameter's own name/purpose, not a guess)
    if _TIMEOUT_RE.search(question):
        for param in pack.parameters:
            haystack = f"{param.name} {param.purpose}"
            if _TIMEOUT_RE.search(haystack):
                answer, citations = _param_answer(pack, param)
                return _result("parameter", answer, citations)

    # no fault/parameter matched — honest, pack-scoped, never a generic guess
    mnemonics = sorted(
        {_fault_mnemonic(c) for c in cards if _fault_mnemonic(c)}
        | {e.fault_id for e in pack.fault_entries}
    )
    param_ids = sorted(p.parameter_id for p in pack.parameters)
    covered = (f" It covers faults: {', '.join(mnemonics)}." if mnemonics else "") + (
        f" Parameters: {', '.join(param_ids)}." if param_ids else ""
    )
    return DrivePackAnswer(
        pack_id=pack.pack_id,
        resolved=True,
        schema_version=pack.schema_version,
        family=family,
        matched=False,
        matched_kind=None,
        answer=(
            f"The {family} drive pack is loaded, but your question doesn't map to a fault code "
            f"or parameter it documents, so I won't guess.{covered}"
        ),
        citations=[],
        answer_source="none",
    )


def extract_pack_fault_codes(pack: DrivePack, text: str) -> list[str]:
    """The photo→pack bridge's gate: return the fault-code tokens in ``text``
    that are REAL codes in ``pack`` — nothing else.

    Two conservative sources, in order (deduped, first-seen order):
    1. A digit-bearing display mnemonic (CE10, CE1) that is a real pack code,
       matched only as a standalone whole-word token — never a substring of an
       English word (so "oL" is not pulled from "overloaded").
    2. A number that carries a fault context (``F005``, "Fault 5", "trip 12")
       AND is a real code in the pack. A bare integer is never a code.

    Returns tokens ready to hand to :func:`answer_fault_code` (mnemonics as-is;
    numerics as the decimal string, e.g. ``"5"``). Pure/offline — no I/O."""
    if not text:
        return []
    upper = text.upper()
    fault_codes = pack.live_decode.fault_codes
    found: list[str] = []
    seen: set[str] = set()

    # 1) digit-bearing display mnemonics that are real codes in THIS pack
    for code, name in fault_codes.items():
        if code == 0 or not name:
            continue
        lead = name.split()[0]
        if not _CODE_LIKE_MNEMONIC_RE.fullmatch(lead):
            continue
        if lead not in seen and re.search(rf"\b{re.escape(lead.upper())}\b", upper):
            seen.add(lead)
            found.append(lead)

    # 1b) digit-bearing v3 fault_entries ids that are real codes (LL1, BE0, CE10),
    #     matched CASE-SENSITIVELY as whole-word tokens. Pure-letter fault_ids
    #     (oC, GF, bb) stay EXPLICIT-ONLY — the same OCR-collision safety as the
    #     v2 mnemonics above (a pure-letter code would false-hit English text).
    for entry in pack.fault_entries:
        fid = entry.fault_id
        if not _CODE_LIKE_MNEMONIC_RE.fullmatch(fid):
            continue
        if fid not in seen and re.search(rf"\b{re.escape(fid)}\b", text):
            seen.add(fid)
            found.append(fid)

    # 2) numeric codes that carry a fault context and are real codes in the pack
    for match in _NUM_FAULT_CONTEXT_RE.finditer(text):
        digits = match.group(1) or match.group(2)
        code = int(digits)
        token = str(code)
        if code != 0 and code in fault_codes and token not in seen:
            seen.add(token)
            found.append(token)

    return found


# PowerFlex fault *names* start with ordinary words; these are NOT display codes
# (the technician reads the number). Used only to pick a human label, never to
# match — matching is always by exact code/mnemonic.
_ENGLISH_LEAD_WORDS = frozenset(
    {"AUTO", "LOAD", "OPT", "COMM", "NET", "POWER", "MOTOR", "HEATSINK", "AUXILIARY"}
)


def _display_code(name: str, code: int) -> str:
    """The label to show for a numeric-keyed fault: its embedded display
    mnemonic when the pack value starts with one (GS10 ``4`` -> "GFF ground
    fault" -> ``GFF``; ``54`` -> "CE1 comm..." -> ``CE1``), else the numeric
    code itself (PowerFlex ``5`` -> "OverVoltage" -> ``code 5``)."""
    lead = name.split()[0] if name else ""
    if lead and re.fullmatch(r"[A-Za-z]{1,3}\d{1,3}", lead):
        return lead  # code-like with digits (CE10, CE1)
    if lead and re.fullmatch(r"[A-Za-z]{2,4}", lead) and lead.upper() not in _ENGLISH_LEAD_WORDS:
        return lead  # a short pure-letter display mnemonic (GFF, Lvd, oL, EF)
    return f"code {code}"


def answer_fault_code(pack_id: str, token: str) -> DrivePackAnswer:
    """Answer an EXACT fault code (numeric ``"5"``/``"F005"`` or mnemonic
    ``"CE10"``) grounded ONLY in the ``pack_id`` pack — the lookup half of the
    photo→pack bridge, reusing the same cited, read-only card machinery as
    :func:`answer_question`. Never guesses; an unknown code answers honestly.

    Unlike :func:`answer_question`, this does not scan free text — the caller
    (or :func:`extract_pack_fault_codes`) has already decided ``token`` is a
    code, so a bare number here IS looked up. Keep the extractor as the gate."""
    try:
        pack = load_pack(pack_id)
    except (FileNotFoundError, ValueError) as exc:
        return DrivePackAnswer(
            pack_id=pack_id,
            resolved=False,
            schema_version=None,
            family=None,
            matched=False,
            matched_kind=None,
            answer=f"The '{pack_id}' drive pack is not loaded ({exc}). I will not guess an answer.",
            citations=[],
            answer_source="none",
        )

    cards = build_cards(pack, template_reader=_template_reader(pack_id))
    family = pack.family.series
    t = (token or "").strip()

    # v3 mnemonic-coded fault entries (string fault_id, case-sensitive, per-fault
    # citation). Additive: v1/v2 packs carry no fault_entries, so this is skipped
    # and the int-keyed lookup below is byte-for-byte unchanged.
    if pack.fault_entries:
        entry = _match_fault_entry(pack, t)
        if entry is not None:
            answer, citations = _fault_entry_answer(pack, entry)
            return DrivePackAnswer(
                pack_id=pack.pack_id,
                resolved=True,
                schema_version=pack.schema_version,
                family=family,
                matched=True,
                matched_kind="fault",
                answer=answer,
                citations=citations,
                answer_source="drive_pack",
            )

    target: DiagnosticCard | None = None
    display = t
    numeric = re.fullmatch(r"[Ff]?0*(\d{1,3})", t)
    if numeric:
        code = int(numeric.group(1))
        name = pack.live_decode.fault_codes.get(code)
        if code != 0 and name:
            target = next((c for c in cards if c.fault_or_symptom.startswith(f"{code} —")), None)
            display = _display_code(name, code)
    else:
        for card in cards:
            mnemonic = _fault_mnemonic(card)
            if mnemonic and mnemonic.upper() == t.upper():
                target = card
                display = mnemonic
                break

    if target is not None:
        answer, citations = _fault_answer(pack, display, target)
        return DrivePackAnswer(
            pack_id=pack.pack_id,
            resolved=True,
            schema_version=pack.schema_version,
            family=family,
            matched=True,
            matched_kind="fault",
            answer=answer,
            citations=citations,
            answer_source="drive_pack",
        )

    return DrivePackAnswer(
        pack_id=pack.pack_id,
        resolved=True,
        schema_version=pack.schema_version,
        family=family,
        matched=False,
        matched_kind=None,
        answer=(
            f"The {family} drive pack is loaded, but '{token}' isn't a fault code it "
            f"documents, so I won't guess."
        ),
        citations=[],
        answer_source="none",
    )


def _render_human(result: DrivePackAnswer) -> str:
    lines = [
        f"pack_id:        {result.pack_id}",
        f"resolved:       {result.resolved}",
        f"schema_version: {result.schema_version}",
        f"family:         {result.family}",
        f"answer_source:  {result.answer_source}",
        f"matched:        {result.matched} ({result.matched_kind})",
        f"fallback_used:  {result.fallback_used}",
        f"live_telemetry: {result.live_telemetry}  (static manual-pack only)",
        f"read_only:      {result.read_only}",
        "",
        "ANSWER:",
        result.answer,
    ]
    if result.citations:
        lines.append("")
        lines.append("CITATIONS:")
        for c in result.citations:
            page = f" p.{c['page']}" if c.get("page") else ""
            lines.append(f"  - {c['doc']}{page}: {c['excerpt'][:160]}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Ask a drive pack a question — read-only, pack-grounded, no generic fallback."
    )
    parser.add_argument("--pack", required=True, help="pack_id, e.g. durapulse_gs10")
    parser.add_argument("--question", required=True, help="the technician's question")
    parser.add_argument("--json", action="store_true", help="emit the structured result as JSON")
    args = parser.parse_args(argv)

    result = answer_question(args.pack, args.question)
    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(_render_human(result))
    # exit 0 when we answered from the pack; 2 when the pack didn't resolve;
    # 1 when it resolved but the question didn't map to pack content.
    if not result.resolved:
        return 2
    return 0 if result.matched else 1


if __name__ == "__main__":
    raise SystemExit(main())
