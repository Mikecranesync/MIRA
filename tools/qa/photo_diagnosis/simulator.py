"""Photo Diagnosis Benchmark — the fixed-fact technician simulator.

The simulator never generates free text. Every string it can emit is either
one of three fixed constants (:data:`DONT_KNOW`, :data:`NUDGE`, the
``"Already told you: "`` prefix) or a verbatim quote from the case fixture
(``reported_facts``, ``hidden_facts[].text``,
``legit_product_asks.identity_confirm``). This is a structural guarantee,
not a style preference: it is what keeps the simulator from ever handing
MIRA a decisive clue MIRA did not earn by asking the right question.

A :class:`Classifier` callable (injected — tests use a fake; production
uses :func:`make_llm_classifier`) maps MIRA's reply to the checks it is
asking for, plus an optional product ask, plus whether the reply was
actionable at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

DONT_KNOW = "I don't know — I haven't checked that."
NUDGE = "What should I check next?"
REPEAT_PREFIX = "Already told you: "
MAX_NUDGES = 2

SIM_TURN_KINDS = ("facts", "dont_know", "repeat", "nudge", "product_ask", "stop")
PRODUCT_ASK_KINDS = ("identity_confirm", "retake_photo", "manual_upload")


@dataclass
class ClassifierResult:
    check_ids: list[str] = field(default_factory=list)
    product_ask: str | None = None  # one of PRODUCT_ASK_KINDS, or None
    actionable: bool = True


class Classifier(Protocol):
    def __call__(self, mira_reply: str, checks: list[dict]) -> ClassifierResult: ...


@dataclass
class SimTurn:
    text: str
    revealed_fact_ids: list[str]
    repeat_check_ids: list[str]
    kind: str  # one of SIM_TURN_KINDS
    product_ask: str | None = None
    product_ask_path: str | None = None  # retake_photo / manual_upload target

    def __post_init__(self) -> None:
        if self.kind not in SIM_TURN_KINDS:
            raise ValueError(f"invalid SimTurn.kind {self.kind!r}")


class SimulatorAlreadyStopped(RuntimeError):
    pass


class TechSimulator:
    """Plays one ``kind: diagnosis`` case against MIRA's replies."""

    def __init__(self, case: dict, classifier: Classifier):
        if case.get("kind") != "diagnosis":
            raise ValueError("TechSimulator only plays kind=diagnosis cases")
        self.case = case
        self.classifier = classifier
        self.revealed: set[str] = set()
        self.nudge_count = 0
        self.stopped = False
        self._check_ids = {c["id"] for c in case.get("checks") or []}
        self._hidden_facts: list[dict] = list(case.get("hidden_facts") or [])
        self._legit_asks: dict[str, Any] = dict(case.get("legit_product_asks") or {})

    def opening(self) -> str:
        text = self.case["reported_facts"]
        if self.case.get("photo"):
            text += " [photo attached]"
        return text

    def force_stop(self) -> None:
        """Called by the caller (runner/test) when a conclusion was reached
        or ``max_turns`` was hit — the two external stop conditions the
        plan names alongside the nudge-exhaustion stop below."""
        self.stopped = True

    def respond(self, mira_reply: str) -> SimTurn:
        if self.stopped:
            raise SimulatorAlreadyStopped("simulator already stopped; no further turns")

        result = self.classifier(mira_reply, self.case.get("checks") or [])
        # Filter to checks this case actually defines — a classifier is a
        # judge, not a source of fixture content.
        requested = [c for c in (result.check_ids or []) if c in self._check_ids]

        new_checks = [c for c in requested if c not in self.revealed]
        repeat_checks = [c for c in requested if c in self.revealed]

        # Precedence: new facts > repeat > product_ask > dont_know (asked,
        # no match) > nudge (nothing actionable at all).
        if new_checks:
            self.revealed.update(new_checks)
            self.nudge_count = 0
            new_set = set(new_checks)
            matched = [f for f in self._hidden_facts if new_set & set(f.get("revealed_by") or [])]
            texts = [f["text"] for f in matched]
            ids = [f["id"] for f in matched]
            return SimTurn(
                text="\n".join(texts), revealed_fact_ids=ids, repeat_check_ids=[], kind="facts"
            )

        if repeat_checks:
            self.nudge_count = 0
            repeat_set = set(repeat_checks)
            matched = [
                f for f in self._hidden_facts if repeat_set & set(f.get("revealed_by") or [])
            ]
            texts = [f["text"] for f in matched]
            return SimTurn(
                text=REPEAT_PREFIX + "; ".join(texts),
                revealed_fact_ids=[],
                repeat_check_ids=repeat_checks,
                kind="repeat",
            )

        if result.product_ask:
            self.nudge_count = 0
            if result.product_ask not in PRODUCT_ASK_KINDS:
                return SimTurn(
                    text=DONT_KNOW, revealed_fact_ids=[], repeat_check_ids=[], kind="dont_know"
                )
            value = self._legit_asks.get(result.product_ask)
            if not value:
                return SimTurn(
                    text=DONT_KNOW, revealed_fact_ids=[], repeat_check_ids=[], kind="dont_know"
                )
            if result.product_ask == "identity_confirm":
                return SimTurn(
                    text=str(value),
                    revealed_fact_ids=[],
                    repeat_check_ids=[],
                    kind="product_ask",
                    product_ask="identity_confirm",
                )
            # retake_photo / manual_upload are structured signals, not prose
            return SimTurn(
                text="",
                revealed_fact_ids=[],
                repeat_check_ids=[],
                kind="product_ask",
                product_ask=result.product_ask,
                product_ask_path=str(value),
            )

        if result.actionable:
            # MIRA asked for something, but it matched nothing this
            # simulator knows about.
            self.nudge_count = 0
            return SimTurn(
                text=DONT_KNOW, revealed_fact_ids=[], repeat_check_ids=[], kind="dont_know"
            )

        self.nudge_count += 1
        if self.nudge_count > MAX_NUDGES:
            self.stopped = True
            return SimTurn(text="", revealed_fact_ids=[], repeat_check_ids=[], kind="stop")
        return SimTurn(text=NUDGE, revealed_fact_ids=[], repeat_check_ids=[], kind="nudge")


# ---------------------------------------------------------------------------
# Production classifier (LLM-backed). Tests inject a fake instead.


def make_llm_classifier(provider: Any) -> Classifier:
    """Build a :class:`Classifier` backed by ``provider`` (a
    :class:`photo_diagnosis.providers.Provider`). Never used by the
    hermetic tests — they inject a deterministic fake so the simulator's
    text-safety property can be checked without a model in the loop."""
    import json as _json

    def _classify(mira_reply: str, checks: list[dict]) -> ClassifierResult:
        checks_block = "\n".join(f"- {c['id']}: {c.get('description', '')}" for c in checks)
        messages = [
            {
                "role": "system",
                "content": (
                    "Classify which of the following checks (if any) this maintenance "
                    "technician reply is asking the tech to perform, or whether it is a "
                    "legitimate product ask (identity_confirm/retake_photo/manual_upload), "
                    "or whether it proposes no actionable next step at all. Return strict "
                    'JSON: {"check_ids": [str], "product_ask": str|null, "actionable": bool}.'
                ),
            },
            {"role": "user", "content": f"Checks:\n{checks_block}\n\nReply:\n{mira_reply}"},
        ]
        text, _usage = provider.complete(messages, max_tokens=300)
        start, end = text.index("{"), text.rindex("}") + 1
        data = _json.loads(text[start:end])
        return ClassifierResult(
            check_ids=list(data.get("check_ids") or []),
            product_ask=data.get("product_ask"),
            actionable=bool(data.get("actionable", True)),
        )

    return _classify


__all__ = [
    "DONT_KNOW",
    "NUDGE",
    "REPEAT_PREFIX",
    "MAX_NUDGES",
    "ClassifierResult",
    "Classifier",
    "SimTurn",
    "SimulatorAlreadyStopped",
    "TechSimulator",
    "make_llm_classifier",
]
