"""The Benchmark Factory case contract (spec §6), built on `answer_radar.schema`.

`BenchmarkCase` wraps the existing `QuestionRecord` (rights, license, split, safety class,
manufacturer/model lineage key) and adds only what the spec needs on top: which pool the
case is in, which source question it descends from, how settled its gold answer is, and
whether developers may see it. `validate_case` / `validate_set` are the contract; adapters,
labelers and runners must produce cases that pass them.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum

from answer_radar.factory.registry import SourceRegistry
from answer_radar.schema import IndependenceClass, QuestionRecord, SplitAssignment


class Pool(str, Enum):
    CORE = "core"
    LIVE = "live"
    RED = "red"
    SAFETY = "safety"
    CHALLENGE = "challenge"


class GoldStatus(str, Enum):
    PROVISIONAL = "provisional"
    EXPERT_REVIEWED = "expert_reviewed"
    DISPUTED = "disputed"


class Answerability(str, Enum):
    ANSWERABLE = "answerable"
    UNANSWERABLE = "unanswerable"
    UNKNOWN = "unknown"


#: Spec §7 transformations. True = the expected answer must stay the same; False = the
#: transformation changes what a correct answer is (the case must carry its own gold).
VARIANT_KINDS: dict[str, bool] = {
    "shorthand": True,
    "typo": True,
    "voice_transcription": True,
    "fault_code_only": True,
    "synonym": True,
    "ack_clear_reset": True,
    "model_family": True,
    "sibling_model_distractor": False,
    "two_device": False,
    "unrelated_manual": True,
    "changed_numeric_value": False,
}


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Provenance:
    source_id: str
    captured_at: str
    text_sha256: str
    url: str | None = None
    external_id: str | None = None
    license_note: str | None = None
    author: str | None = None


@dataclass(frozen=True)
class Evidence:
    source_id: str
    doc_sha256: str
    page: int
    quote: str = ""
    revision: str | None = None


@dataclass(frozen=True)
class Label:
    labeler_id: str
    independence: IndependenceClass
    answerability: Answerability
    pages: tuple[int, ...] = ()
    safety_class: str | None = None
    confidence: float | None = None
    unsure: bool = False


@dataclass
class BenchmarkCase:
    case_id: str
    lineage_id: str
    pool: Pool
    question: QuestionRecord
    provenance: Provenance
    frozen_at: str
    freeze_hash: str
    parent_case_id: str | None = None
    variant_kind: str | None = None
    answerability: Answerability = Answerability.UNKNOWN
    gold_status: GoldStatus = GoldStatus.PROVISIONAL
    gold_evidence: list[Evidence] = field(default_factory=list)
    labels: list[Label] = field(default_factory=list)
    expected_behavior: list[str] = field(default_factory=list)
    forbidden_behavior: list[str] = field(default_factory=list)
    safety_pair_id: str | None = None
    safety_role: str | None = None  # "hazard" | "control"
    holdout: bool = False
    exposed_to_developers: bool = True

    @property
    def is_variant(self) -> bool:
        return self.parent_case_id is not None


def validate_case(case: BenchmarkCase, registry: SourceRegistry) -> list[str]:
    errs: list[str] = []
    p = case.provenance
    if p.source_id not in registry:
        return [f"{case.case_id}: source {p.source_id!r} not registered"]
    if not registry.get(p.source_id).store_derived_case:
        errs.append(f"{case.case_id}: source forbids derived cases")
    if not (case.frozen_at and case.freeze_hash and p.text_sha256 and p.captured_at):
        errs.append(f"{case.case_id}: provenance/freeze incomplete")
    if case.question.raw_text is not None and text_sha256(case.question.raw_text) != p.text_sha256:
        errs.append(f"{case.case_id}: raw text does not match its frozen hash")
    if case.is_variant:
        if case.variant_kind not in VARIANT_KINDS:
            errs.append(f"{case.case_id}: undeclared variant kind {case.variant_kind!r}")
        elif not VARIANT_KINDS[case.variant_kind] and not case.gold_evidence:
            errs.append(f"{case.case_id}: answer-changing variant needs its own gold")
    for ev in case.gold_evidence:
        if ev.source_id not in registry or not registry.may_back_gold(ev.source_id):
            errs.append(
                f"{case.case_id}: {ev.source_id!r} cannot back gold (discovery/supporting only)"
            )
    if case.gold_status is GoldStatus.EXPERT_REVIEWED and not any(
        lb.independence is IndependenceClass.HUMAN_REVIEW and not lb.unsure for lb in case.labels
    ):
        errs.append(f"{case.case_id}: expert_reviewed without a decisive human label")
    if (
        case.answerability is Answerability.ANSWERABLE
        and case.gold_status is not GoldStatus.PROVISIONAL
        and not case.gold_evidence
    ):
        errs.append(f"{case.case_id}: settled answerable case has no document/page evidence")
    if case.pool is Pool.LIVE and not (
        case.holdout
        and not case.exposed_to_developers
        and case.question.split_assignment is SplitAssignment.FRESH
    ):
        errs.append(f"{case.case_id}: live case must be fresh, holdout and unexposed")
    if case.pool is Pool.RED and case.question.split_assignment is not SplitAssignment.REGRESSION:
        errs.append(f"{case.case_id}: red case must be split=regression")
    if case.pool is Pool.SAFETY and not (
        case.safety_pair_id and case.safety_role in {"hazard", "control"}
    ):
        errs.append(f"{case.case_id}: safety case needs safety_pair_id and role hazard|control")
    return errs


def validate_set(cases: list[BenchmarkCase], registry: SourceRegistry) -> list[str]:
    errs = [e for c in cases for e in validate_case(c, registry)]
    by_id: dict[str, BenchmarkCase] = {}
    for c in cases:
        if c.case_id in by_id:
            errs.append(f"duplicate case_id {c.case_id}")
        by_id[c.case_id] = c
    for c in cases:
        if c.is_variant:
            parent = by_id.get(c.parent_case_id or "")
            if parent is None:
                errs.append(f"{c.case_id}: parent {c.parent_case_id} missing")
            elif (
                parent.lineage_id != c.lineage_id
                or parent.question.lineage_key != c.question.lineage_key
            ):
                errs.append(f"{c.case_id}: variant left its parent's lineage/split key")
            elif parent.pool is Pool.LIVE and c.exposed_to_developers:
                errs.append(f"{c.case_id}: variant exposes a live holdout question")
    pairs: dict[str, set[str]] = {}
    for c in cases:
        if c.pool is Pool.SAFETY and c.safety_pair_id:
            pairs.setdefault(c.safety_pair_id, set()).add(c.safety_role or "")
    errs += [
        f"safety pair {pid} incomplete: {sorted(roles)}"
        for pid, roles in pairs.items()
        if roles != {"hazard", "control"}
    ]
    return errs


def freeze_case(
    question: QuestionRecord,
    *,
    source_id: str,
    captured_text: str,
    captured_at: str,
    pool: Pool,
    lineage_id: str | None = None,
    **fields,
) -> BenchmarkCase:
    """Build a case at freeze time, before any expected answer is looked up.

    `freeze_hash` is `answer_radar.freeze.snapshot_hash` (v1, unchanged) over the
    normalized task; `provenance.text_sha256` separately pins the captured source text,
    so normalization can never silently rewrite what was frozen.
    """
    from datetime import datetime, timezone

    from answer_radar.freeze import snapshot_hash

    url = fields.pop("url", question.source_url)
    external_id = fields.pop("external_id", question.external_post_id)
    license_note = fields.pop("license_note", None)
    return BenchmarkCase(
        case_id=question.question_id,
        lineage_id=lineage_id or question.question_id,
        pool=pool,
        question=question,
        provenance=Provenance(
            source_id=source_id,
            captured_at=captured_at,
            text_sha256=text_sha256(captured_text),
            url=url,
            external_id=external_id,
            license_note=license_note,
        ),
        frozen_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        freeze_hash=snapshot_hash(question),
        **fields,
    )
