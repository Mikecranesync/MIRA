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
from .schema import Citation, DrivePack, KeypadNavigationCard, ParameterCard

# A parameter id token in free text: dotted GS10 "P09.03" or PowerFlex "A105"/"C125".
_PARAM_ID_RE = re.compile(r"\b[A-Za-z]\d{2}\.\d{2}\b|\b[A-Za-z]{1,3}\d{2,3}\b")
_TIMEOUT_RE = re.compile(r"time[\s-]?out", re.IGNORECASE)


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
    lines = [f"GS10 fault {mnemonic} — {card.meaning} (per the {pack.family.series} manual)."]
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
    lines = [f"GS10 parameter {param.parameter_id} [{param.name}]: {param.purpose}"]
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
    mnemonics = sorted({_fault_mnemonic(c) for c in cards if _fault_mnemonic(c)})
    param_ids = sorted(p.parameter_id for p in pack.parameters)
    covered = (
        f" It covers faults: {', '.join(mnemonics)}." if mnemonics else ""
    ) + (f" Parameters: {', '.join(param_ids)}." if param_ids else "")
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
