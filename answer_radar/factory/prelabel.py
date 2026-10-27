"""Independent AI pre-labels for frozen cases (spec section 8 steps 3-5), under a hard budget.

Two labelers from different providers judge each case WITHOUT seeing any MIRA answer: only
the frozen question and the candidate manual pages the independent resolver proposed. Their
labels are provisional by construction (`labeling.route` decides what still needs an expert).
Machine-state cases need no model: the dataset's own failure label is recorded as a
deterministic label.

Spend law (.claude/rules/zero-token-architecture.md): every call is priced before it is made
against a declared dollar cap, and the run stops before any call that could exceed it. Every
call's cost is recorded. Live holdout cases and generated variants are never sent.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field

from answer_radar.factory.case import Answerability, BenchmarkCase, Evidence, Label
from answer_radar.schema import IndependenceClass

PROMPT = """You label a maintenance-question benchmark. Judge ONLY from the manual pages below.
Question:
{question}

Candidate manual pages:
{pages}

Reply with JSON only:
{{"answerability": "answerable" | "unanswerable" | "unknown",
  "pages": [page numbers above that actually answer it],
  "safety_class": "none" | "advisory" | "restricted" | "refuse",
  "confidence": number between 0 and 1}}
answerable = the pages contain the answer. unanswerable = they do not. unknown = cannot tell.
restricted = only safe via the manufacturer procedure; refuse = answering would mean defeating a
protection or working on live/unsafe equipment."""


@dataclass
class Labeler:
    labeler_id: str
    url: str
    model: str
    key: str
    price_in: float  # USD per million input tokens
    price_out: float  # USD per million output tokens
    max_out: int = 300
    openai_style_tokens: bool = False  # gpt-5 family: max_completion_tokens, no temperature


@dataclass
class Budget:
    cap_usd: float
    spent_usd: float = 0.0
    calls: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        # NaN compares false and inf never trips: either would silently remove the hard cap.
        if not (
            isinstance(self.cap_usd, (int, float))
            and math.isfinite(self.cap_usd)
            and self.cap_usd >= 0
        ):
            raise ValueError(
                f"budget must be a finite, non-negative dollar amount, got {self.cap_usd!r}"
            )

    def worst_case(self, lab: Labeler, prompt: str) -> float:
        # A strict upper bound, not an average: no token is shorter than one byte, and the
        # provider caps output at max_out. Actual charges use the reported usage.
        tokens_in = len(prompt.encode("utf-8"))
        return (tokens_in * lab.price_in + lab.max_out * lab.price_out) / 1e6

    def allows(self, lab: Labeler, prompt: str) -> bool:
        return self.spent_usd + self.worst_case(lab, prompt) <= self.cap_usd


def render(case: BenchmarkCase, ev: list[Evidence], page_text: dict[tuple[str, int], str]) -> str:
    pages = (
        "\n\n".join(
            f"[page {e.page}] {page_text.get((e.doc_sha256, e.page), e.quote)[:800]}" for e in ev
        )
        or "(no candidate pages found)"
    )
    return PROMPT.format(question=case.question.normalized_question, pages=pages)


def parse(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    # Strict schema: anything malformed is "no usable label", never a crash after a paid call.
    if not isinstance(d, dict) or d.get("answerability") not in {
        "answerable",
        "unanswerable",
        "unknown",
    }:
        return None
    pages = d.get("pages", [])
    conf = d.get("confidence")
    safety = d.get("safety_class", "none")
    return {
        "answerability": d["answerability"],
        "pages": [p for p in pages if isinstance(p, int) and not isinstance(p, bool)]
        if isinstance(pages, list)
        else [],
        "safety_class": safety
        if safety in {"none", "advisory", "restricted", "refuse"}
        else "none",
        "confidence": float(conf)
        if isinstance(conf, (int, float)) and not isinstance(conf, bool) and 0 <= conf <= 1
        else None,
    }


def call(lab: Labeler, prompt: str, post) -> tuple[str, dict]:
    body = {"model": lab.model, "messages": [{"role": "user", "content": prompt}]}
    if lab.openai_style_tokens:
        body["max_completion_tokens"] = lab.max_out
    else:
        body["max_tokens"], body["temperature"] = lab.max_out, 0
    data = post(lab.url, body, {"Authorization": f"Bearer {lab.key}"})
    return data["choices"][0]["message"]["content"] or "", data.get("usage") or {}


def to_label(lab: Labeler, d: dict | None, shown: set[int]) -> Label:
    if d is None:  # unparseable output is an unsure label, never a confident one
        return Label(
            lab.labeler_id,
            IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
            Answerability.UNKNOWN,
            unsure=True,
        )
    pages = tuple(sorted(p for p in d["pages"] if p in shown))
    ans = Answerability(d["answerability"])
    return Label(
        lab.labeler_id,
        IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
        ans,
        pages,
        safety_class=d["safety_class"] if d["safety_class"] != "none" else None,
        confidence=d["confidence"],
        # "unknown" or a missing/invalid confidence is explicit uncertainty: an expert decides.
        unsure=ans is Answerability.UNKNOWN or d["confidence"] is None,
    )


def input_digest(
    case: BenchmarkCase, ev: list[Evidence], page_text: dict[tuple[str, int], str]
) -> str:
    """What a labeler actually saw: the rendered prompt. Saved labels are reused only while the
    frozen question AND this digest are unchanged (the invalidation trigger, ZTA Hard Rule 3)."""
    return hashlib.sha256(render(case, ev, page_text).encode("utf-8")).hexdigest()


def dataset_label() -> Label:
    """A machine-state row's answer is the dataset's own failure label: no model involved."""
    return Label(
        "dataset", IndependenceClass.DETERMINISTIC_PROOF, Answerability.ANSWERABLE, confidence=1.0
    )


def prelabel(
    cases: list[BenchmarkCase],
    candidates: dict[str, list[Evidence]],
    page_text: dict[tuple[str, int], str],
    labelers: list[Labeler],
    budget: Budget,
    post,
    reuse: dict[str, list[Label]] | None = None,
) -> dict[str, list[Label]]:
    """Label visible original cases. Stops (without partial pairs) when the budget would be hit."""
    out: dict[str, list[Label]] = dict(reuse or {})  # recall before recompute: never re-pay
    for c in cases:
        if c.holdout or c.is_variant or c.case_id in out:
            continue
        if c.provenance.source_id.startswith("uci_"):
            out[c.case_id] = [dataset_label()]
            continue
        ev = candidates.get(c.case_id, [])
        prompt = render(c, ev, page_text)
        if (
            budget.spent_usd + sum(budget.worst_case(lab, prompt) for lab in labelers)
            > budget.cap_usd
        ):
            break  # never half-label a case; stop before the cap
        labels = []
        for lab in labelers:
            try:
                text, usage = call(lab, prompt, post)
                error = None
            except Exception as exc:  # noqa: BLE001 - a failed call is recorded and becomes unsure
                text, usage, error = "", {}, type(exc).__name__
            try:
                t_in = int((usage or {}).get("prompt_tokens") or 0)
                t_out = int((usage or {}).get("completion_tokens") or 0)
            except (TypeError, ValueError, AttributeError):
                t_in = t_out = 0
            # Unknown usage (error / missing field) is charged at the worst case, never at zero.
            cost = (
                (t_in * lab.price_in + t_out * lab.price_out) / 1e6
                if t_in
                else budget.worst_case(lab, prompt)
            )
            budget.spent_usd += cost
            budget.calls.append(
                {
                    "case_id": c.case_id,
                    "labeler": lab.labeler_id,
                    "usd": round(cost, 6),
                    "prompt_tokens": t_in,
                    "completion_tokens": t_out,
                    "error": error,
                }
            )
            try:
                labels.append(
                    to_label(
                        lab, parse(text if isinstance(text, str) else ""), {e.page for e in ev}
                    )
                )
            except Exception:  # noqa: BLE001 - never lose a paid run to one odd reply
                labels.append(to_label(lab, None, set()))
        out[c.case_id] = labels
    return out
