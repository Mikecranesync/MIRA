"""Ask a machine's wiring profile — the read-only, deterministic Q&A bridge.

Resolve a technician's plain-text question ("Where does W200 land?", "what
lands on X1:3") against a `MachineWiringProfile` assembled from
`wiring_connections`, and answer grounded ONLY in that asset's own rows.

Doctrine enforced here (this is the sharp end — get it wrong and MIRA lies
about plant wiring):
- **Approval gate.** A trusted answer is built ONLY from
  `profile.trusted()` (`approval_state == 'verified'`) rows. If a match
  exists only among proposed/needs_review/rejected rows, this REFUSES — it
  may mention that an unverified record exists, but never asserts it as fact.
- **Citation-or-refuse.** Every answer with `answer_source ==
  "wiring_connections"` carries >=1 citation. A refusal/no-record answer
  carries zero citations and `answer_source == "none"`.
- **Never invent.** No endpoint, wire number, or terminal is fabricated. An
  absent record produces an honest "no record" — never a guess.
- **Read-only.** No writes to `wiring_connections`, no control writes.
  `read_only` is always `True`.
- **No generic fallback.** `fallback_used` is always `False` — an unmatched
  question is reported honestly, never handed to a generic LLM answer.

Run it (from ``mira-bots/``)::

    python -m shared.wiring_profile.ask --rows-file rows.json --asset gs10-eval \
        --question "Where does W200 land?"
    python -m shared.wiring_profile.ask --rows-file rows.json --asset gs10-eval \
        --question "what is connected to I-00?" --json
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from .reader import profile_from_rows
from .schema import MachineWiringProfile, WiringConnection

# Terminal tokens always carry a separator between device/rail letters and the
# terminal number ("I-00", "X1:3", "TB2-14") — checked FIRST so it never gets
# mistaken for a bare wire number.
_TERMINAL_RE = re.compile(r"\b[A-Za-z]{1,4}\d{0,3}[-:]\d{1,4}\b")
# Bare wire numbers have no separator ("W200", "101A", "200").
_WIRE_RE = re.compile(r"\b[A-Za-z]{0,3}\d{1,4}[A-Za-z]?\b")


@dataclass
class WiringAnswer:
    """The structured, surface-agnostic result of asking a wiring profile —
    carries the debug metadata a technician needs to trust the answer."""

    asset: str
    resolved: bool  # did the profile have ANY connections at all?
    matched: bool  # did the question map to a TRUSTED (approved) connection?
    matched_kind: Optional[str]  # "wire" | "terminal" | None
    answer: str
    citations: list[dict[str, str]] = field(default_factory=list)
    answer_source: str = "wiring_connections"  # "wiring_connections" | "none"
    fallback_used: bool = False  # NEVER a generic/LLM fallback
    read_only: bool = True  # no writes are possible from this path
    trusted_evidence: bool = False  # answer stands on approved rows only

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _extract_token(question: str) -> tuple[Optional[str], Optional[str]]:
    """Classify + extract the wire/terminal token from `question`.

    Terminal tokens (require a `-`/`:` separator) are checked first so a
    hyphenated terminal never gets mis-read as a wire number. Returns
    `(kind, token)` or `(None, None)` when nothing parseable is found.
    """
    m = _TERMINAL_RE.search(question)
    if m:
        return "terminal", m.group(0)
    m = _WIRE_RE.search(question)
    if m:
        return "wire", m.group(0)
    return None, None


def _cite(c: WiringConnection) -> dict[str, str]:
    excerpt = f"{c.source_label()} -> {c.dest_label()}"
    if c.wire_number:
        excerpt += f" (wire {c.wire_number})"
    return {
        "drawing_reference": c.drawing_reference or "",
        "source": str(c.evidence_summary.get("source") or ""),
        "approval_state": c.approval_state,
        "excerpt": excerpt,
    }


def _build_answer(
    kind: str, token: str, hits: tuple[WiringConnection, ...]
) -> tuple[str, list[dict[str, str]]]:
    header = f"Wire {token} lands on:" if kind == "wire" else f"Connected to {token}:"
    lines = [header]
    for h in hits:
        tag = f" [{h.function_class}]" if h.function_class else ""
        wire = f", wire {h.wire_number}" if h.wire_number else ""
        cite = h.drawing_reference or "cited record"
        lines.append(f"  - {h.source_label()} <-> {h.dest_label()}{tag}{wire} (per {cite})")
    return "\n".join(lines), [_cite(h) for h in hits]


def answer_wiring_question(profile: MachineWiringProfile, question: str) -> WiringAnswer:
    """Answer `question` grounded ONLY in `profile`'s approved connections.
    Never falls back to a generic answer; a match found only among
    non-approved rows is an explicit refusal, not an answer."""
    resolved = bool(profile.connections)
    kind, token = _extract_token(question)

    if kind is None or token is None:
        return WiringAnswer(
            asset=profile.asset,
            resolved=resolved,
            matched=False,
            matched_kind=None,
            answer=(
                "I can answer where a wire lands or what connects to a terminal — "
                "I couldn't find a wire or terminal in your question."
            ),
            citations=[],
            answer_source="none",
        )

    all_hits = profile.find_by_wire(token) if kind == "wire" else profile.find_by_terminal(token)
    approved_hits = tuple(h for h in all_hits if h.is_trusted())

    if approved_hits:
        answer, citations = _build_answer(kind, token, approved_hits)
        return WiringAnswer(
            asset=profile.asset,
            resolved=True,
            matched=True,
            matched_kind=kind,
            answer=answer,
            citations=citations,
            answer_source="wiring_connections",
            trusted_evidence=True,
        )

    if all_hits:
        return WiringAnswer(
            asset=profile.asset,
            resolved=resolved,
            matched=False,
            matched_kind=kind,
            answer=(
                f"I found a record of {token}, but it is only PROPOSED/unverified — "
                "there is not enough APPROVED evidence to answer. "
                "It needs human approval before I'll assert it."
            ),
            citations=[],
            answer_source="none",
            trusted_evidence=False,
        )

    return WiringAnswer(
        asset=profile.asset,
        resolved=resolved,
        matched=False,
        matched_kind=kind,
        answer=f"I have no record of {token} in {profile.asset}'s approved wiring. I won't guess.",
        citations=[],
        answer_source="none",
    )


def _render_human(result: WiringAnswer) -> str:
    lines = [
        f"asset:          {result.asset}",
        f"resolved:       {result.resolved}",
        f"matched:        {result.matched} ({result.matched_kind})",
        f"answer_source:  {result.answer_source}",
        f"trusted_evidence: {result.trusted_evidence}",
        f"fallback_used:  {result.fallback_used}",
        f"read_only:      {result.read_only}",
        "",
        "ANSWER:",
        result.answer,
    ]
    if result.citations:
        lines.append("")
        lines.append("CITATIONS:")
        for c in result.citations:
            lines.append(f"  - [{c['approval_state']}] {c['drawing_reference']}: {c['excerpt']}")
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - CLI glue
    parser = argparse.ArgumentParser(
        description="Ask a machine's wiring profile a question — read-only, evidence-grounded, no generic fallback."
    )
    parser.add_argument(
        "--rows-file", required=True, help="JSON file of wiring_connections-shaped row dicts"
    )
    parser.add_argument("--asset", required=True, help="asset label / evidence_summary asset scope")
    parser.add_argument("--question", required=True, help="the technician's question")
    parser.add_argument("--json", action="store_true", help="emit the structured result as JSON")
    args = parser.parse_args(argv)

    with open(args.rows_file, encoding="utf-8") as fh:
        rows = json.load(fh)
    profile = profile_from_rows(rows, asset=args.asset)
    result = answer_wiring_question(profile, args.question)

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(_render_human(result))

    if not result.resolved:
        return 2
    return 0 if result.matched else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
