"""Metamorphic variants (spec §7): expand a real question, never invent its gold.

Each transformation is deterministic and declared in `case.VARIANT_KINDS`. Variants keep
the parent's `lineage_id` and question identity fields (so the same split key) and inherit
its exposure (a Live parent's variants stay hidden). No variant inherits settled gold or
labels: every variant starts provisional. Answer-preserving kinds carry the parent's
evidence as a provisional candidate (so retrieval robustness can be scored); answer-changing
kinds start empty and are never generated from safety-relevant parents.
"""

from __future__ import annotations

import re
from dataclasses import replace

from answer_radar.factory.case import (
    VARIANT_KINDS,
    Answerability,
    BenchmarkCase,
    GoldStatus,
    Pool,
    freeze_case,
)
from answer_radar.schema import SafetyClass

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


#: The only characters a voice variant may start from. Relational and math notation
#: (< > = != ± + ^ * ~ [ ] ...) is NOT verbalized: four review rounds showed each attempt to
#: say it aloud could flip or drop a condition (Codex F16-F19). Such questions get no voice
#: variant at all; losing one paraphrase is cheap, a changed task under inherited gold is not.
_VOICE_SAFE = re.compile(r"[\w\s.,?'\"():;%/-]*")


def _voice(t: str) -> str | None:
    """Spoken form of a question, or None when its meaning cannot be preserved.

    "2.5 A at -.5 C, 80 %" -> "two point five a at minus point five c eight zero percent".
    A hyphen inside a model name ("GS-10") is not a sign.
    """
    t = t.lower()
    # ASCII only: Unicode digits ("٥") and letters would slip past the digit speller.
    if not t.isascii() or not _VOICE_SAFE.fullmatch(t):
        return None
    t = t.replace("%", " percent ")
    t = re.sub(r"(?<![\w.])-(?=\.?\d)", " minus ", t)
    t = re.sub(r"\.(?=\d)", " point ", t)
    t = re.sub(r"(?<=\d)/(?=\d)", " over ", t)
    if "/" in t:  # unit division ("5 A/s") is not "5 As"; it is never dropped silently
        return None
    unsafe = r"\d[^\w\s]+(?=\w)|(?<![a-z])[^\w\s]+\d|\d[a-z]+[^\w\s]+\d"
    if re.search(unsafe, t):
        return None
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\d", lambda m: f" {_SPOKEN[m.group(0)]} ", t)
    return re.sub(r"\s+", " ", t).strip()


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


def make_variants(parent: BenchmarkCase, kinds: list[str] | None = None) -> list[BenchmarkCase]:
    out = []
    for kind in kinds or list(TRANSFORMS):
        preserving = VARIANT_KINDS[kind]
        if not preserving and (
            parent.pool is Pool.SAFETY or parent.question.safety_class is not SafetyClass.NONE
        ):
            continue  # an answer-changing rewrite could silently drop the hazard being tested
        text = TRANSFORMS[kind](parent)
        if not text or text == parent.question.normalized_question:
            continue
        # Answer-preserving kinds inherit the parent's settled answer; answer-changing kinds
        # start unsettled and need their own labels (spec section 7).
        inherit = preserving
        q = replace(
            parent.question,
            question_id=f"{parent.case_id}~{kind}",
            normalized_question=text,
            raw_text=None,
            intent_tags=list(parent.question.intent_tags),
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
                answerability=parent.answerability if inherit else Answerability.UNKNOWN,
                gold_status=GoldStatus.PROVISIONAL,  # never inherited; see case.validate_case
                gold_evidence=list(parent.gold_evidence) if inherit else [],
                labels=[],  # the parent's reviewers judged the parent's wording, not this one
                expected_behavior=list(parent.expected_behavior) if inherit else [],
                forbidden_behavior=list(parent.forbidden_behavior) if inherit else [],
                safety_pair_id=parent.safety_pair_id,
                safety_role=parent.safety_role,
                holdout=parent.holdout,
                exposed_to_developers=parent.exposed_to_developers,
                url=parent.provenance.url,
                external_id=parent.provenance.external_id,
            )
        )
    return out
