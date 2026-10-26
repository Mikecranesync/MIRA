"""Metamorphic variants (spec §7): expand a real question, never invent its gold.

Each transformation is deterministic and declared in `case.VARIANT_KINDS`. Variants keep
the parent's `lineage_id` and question identity fields (so the same split key), inherit
its exposure (a Live parent's variants stay hidden), and inherit its gold only when the
transformation is answer-preserving. Answer-changing kinds are not generated here: they
need their own gold, which only a labeler can supply.
"""

from __future__ import annotations

import re
from dataclasses import replace

from answer_radar.factory.case import VARIANT_KINDS, BenchmarkCase, freeze_case

_SHORT = {
    "drive": "vfd",
    "fault": "flt",
    "overvoltage": "OV",
    "overcurrent": "OC",
    "motor": "mtr",
    "what": "wat",
}
_SPOKEN = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}


def _typo(t: str) -> str:
    words = t.split()
    for i, w in enumerate(words):
        if len(w) > 4 and w.isalpha():
            words[i] = w[0] + w[2] + w[1] + w[3:]
            break
    return " ".join(words)


def _shorthand(t: str) -> str:
    return re.sub(r"\b(\w+)\b", lambda m: _SHORT.get(m.group(1).lower(), m.group(1)), t)


def _voice(t: str) -> str:
    t = re.sub(r"[^\w\s]", "", t.lower())
    return re.sub(r"\d", lambda m: f" {_SPOKEN[m.group(0)]} ", t).replace("  ", " ").strip()


TRANSFORMS = {
    "typo": lambda c: _typo(c.question.normalized_question),
    "shorthand": lambda c: _shorthand(c.question.normalized_question),
    "voice_transcription": lambda c: _voice(c.question.normalized_question),
    "fault_code_only": lambda c: (
        f"{c.question.model} {c.question.error_code}".strip() if c.question.error_code else None
    ),
    "ack_clear_reset": lambda c: (
        f"{c.question.normalized_question} How do I acknowledge and clear it?"
    ),
}
if not all(VARIANT_KINDS[k] for k in TRANSFORMS):
    raise RuntimeError("only answer-preserving kinds may be auto-generated")


def make_variants(parent: BenchmarkCase, kinds: list[str] | None = None) -> list[BenchmarkCase]:
    out = []
    for kind in kinds or list(TRANSFORMS):
        text = TRANSFORMS[kind](parent)
        if not text or text == parent.question.normalized_question:
            continue
        q = replace(
            parent.question,
            question_id=f"{parent.case_id}~{kind}",
            normalized_question=text,
            raw_text=None,
        )
        out.append(
            freeze_case(
                q,
                source_id=parent.provenance.source_id,
                captured_text=text,
                captured_at=parent.provenance.captured_at,
                pool=parent.pool,
                lineage_id=parent.lineage_id,
                parent_case_id=parent.case_id,
                variant_kind=kind,
                answerability=parent.answerability,
                gold_status=parent.gold_status,
                gold_evidence=list(parent.gold_evidence),
                labels=list(parent.labels),
                expected_behavior=list(parent.expected_behavior),
                forbidden_behavior=list(parent.forbidden_behavior),
                holdout=parent.holdout,
                exposed_to_developers=parent.exposed_to_developers,
                url=parent.provenance.url,
                external_id=parent.provenance.external_id,
            )
        )
    return out
