"""Record types for the Answer Radar benchmark (PRS §11).

Three records, one per stage: the question, the evaluation of one MIRA run against it, and
the downstream outcome of any public reply.

Rights and independence vocabulary is **reused from the Continuous Learning Factory**
(ADR-0030) rather than reinvented — see the package docstring. Two CLF principles carry
straight through and are the reason several fields look redundant:

1. **Rights fail closed.** `rights_resolved=false`, or any flag absent, denies every
   discretionary capability. Only an explicit `true` grants one. A public forum post is
   `evaluation_allowed` at most; `training_allowed` is a separate, deliberate decision
   (PRS §15) and defaults to false forever.
2. **Evidence status is separate from approval status.** A high-scoring answer is not an
   approved answer. `verified_correct` is a measurement; publishing is a human act
   recorded on `OutcomeRecord`.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class LicenseClass(str, Enum):
    """CLF `corpus-source.v1.license_class`. `UNKNOWN` fails closed."""

    PUBLIC_EVAL_ONLY = "public-eval-only"
    PUBLIC_EVAL_AND_TRAIN = "public-eval-and-train"
    CUSTOMER_PRIVATE = "customer-private"
    SYNTHETIC = "synthetic"
    UNKNOWN = "unknown"


class IndependenceClass(str, Enum):
    """CLF `judge-independence.v1.independence_class`.

    Ordered weakest-to-strongest for the two classes that cannot promote to gold. Answer
    Radar's dual graders should reach at least `DIFFERENT_MODEL_SAME_PROVIDER`; anything
    at or below `SAME_MODEL_DIFFERENT_RUN` is self-consistency, which PRS §4 forbids
    counting as correctness on its own.
    """

    INDEPENDENT_PROVIDER_MODEL = "INDEPENDENT_PROVIDER_MODEL"
    DIFFERENT_MODEL_SAME_PROVIDER = "DIFFERENT_MODEL_SAME_PROVIDER"
    SAME_MODEL_DIFFERENT_RUN = "SAME_MODEL_DIFFERENT_RUN"
    SELF_CONSISTENCY_ONLY = "SELF_CONSISTENCY_ONLY"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    DETERMINISTIC_PROOF = "DETERMINISTIC_PROOF"


#: Classes that may not, on their own, mark an answer verified-correct. CLF's
#: promotion-policy sets `gold_eligible=false` for these; the same rule applies here.
NON_PROMOTING_INDEPENDENCE = frozenset(
    {IndependenceClass.SELF_CONSISTENCY_ONLY, IndependenceClass.SAME_MODEL_DIFFERENT_RUN}
)


class SafetyClass(str, Enum):
    """PRS §19. Drives both what MIRA should answer and how the answer is scored."""

    NONE = "none"
    ADVISORY = "advisory"
    #: Legitimate answer exists, but only via the manufacturer procedure plus a
    #: qualification caveat (crane/hoist, high voltage, motion, safety-critical firmware).
    RESTRICTED = "restricted"
    #: Answering as literally asked would require supplying an access code or defeating a
    #: protection/interlock. The correct answer is a refusal that redirects to the
    #: legitimate procedure.
    REFUSE = "refuse"


class EvidenceTier(str, Enum):
    """PRS §5 evidence hierarchy. Community consensus is deliberately the floor."""

    OEM_MANUAL = "oem_manual"
    OEM_BULLETIN = "oem_bulletin"
    OEM_KB = "oem_kb"
    OEM_SOFTWARE_DOC = "oem_software_doc"
    STANDARD = "standard"
    FIELD_VERIFIED = "field_verified"
    TRUSTED_INDEPENDENT = "trusted_independent"
    COMMUNITY = "community"
    NONE = "none"


class AnswerStatus(str, Enum):
    """What MIRA did, before any judgement about whether it was right."""

    ANSWERED = "answered"
    #: Asked for specific missing information instead of guessing. PRS §7 treats this as
    #: potentially CORRECT, not as a failure.
    ABSTAINED = "abstained"
    #: The UNS location-confirmation gate fired: the engine asked which asset/site this is
    #: before troubleshooting. Its own class because it is a *surface* property of chat
    #: turns, not a judgement about MIRA's technical knowledge.
    UNS_GATE = "uns_gate"
    REFUSED_SAFETY = "refused_safety"
    ERROR = "error"


class SplitAssignment(str, Enum):
    """CLF leakage partitioning (PRS §14). A question may occupy exactly one."""

    #: Discovered today, never used to tune anything. The only set that measures
    #: production performance.
    FRESH = "fresh"
    #: Previously exposed a failure; kept to prevent regressions.
    REGRESSION = "regression"
    #: Used to tune prompts/retrieval/classifiers. Leaving `FRESH` for this is permanent.
    DEVELOPMENT = "development"


@dataclass(frozen=True)
class Rights:
    """CLF `corpus-source.v1.rights`. Every field defaults to denied.

    Constructing `Rights()` yields a record that permits nothing, which is the correct
    default for a third-party post whose terms nobody has read.
    """

    rights_resolved: bool = False
    training_allowed: bool = False
    evaluation_allowed: bool = False
    public_export_allowed: bool = False
    cross_tenant_reuse_allowed: bool = False
    derivatives_retained: bool = False

    def permits(self, capability: str) -> bool:
        """A capability is granted only when rights are resolved AND explicitly true.

        This is the fail-closed gate CLF's schema describes in prose. Unknown rights deny
        everything, so an unreviewed platform cannot leak into training by omission.
        """
        if not self.rights_resolved:
            return False
        return bool(getattr(self, capability, False))


#: Rights for a public post whose platform terms have been reviewed and permit evaluation
#: but NOT model training. This is the ceiling for third-party content under PRS §15.
PUBLIC_EVAL_ONLY_RIGHTS = Rights(rights_resolved=True, evaluation_allowed=True)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")


def document_lineage_key(manufacturer: str, model: str, source_platform: str) -> str:
    """CLF's leakage split key, adapted to questions.

    Splits partition on this key, never on the individual question, so two questions about
    the same manufacturer+model cannot land one in `fresh` and one in `development` — which
    would leak the answer to a question the benchmark then claims MIRA solved cold.
    """
    return f"{_slug(manufacturer) or 'unknown'}/{_slug(model) or 'unknown'}/{_slug(source_platform) or 'unknown'}"


@dataclass
class QuestionRecord:
    """One real-world question, normalized (PRS §11).

    `raw_text` is deliberately optional and gated. PRS §15's safe default is to retain the
    *normalized* technical question plus taxonomy, not the poster's verbatim words, unless
    rights explicitly allow it.
    """

    question_id: str
    normalized_question: str
    source_platform: str
    rights: Rights = field(default_factory=Rights)
    license_class: LicenseClass = LicenseClass.UNKNOWN
    split_assignment: SplitAssignment = SplitAssignment.FRESH

    source_url: str | None = None
    external_post_id: str | None = None
    discovered_at: str | None = None
    posted_at: str | None = None
    public_author_handle: str | None = None
    raw_text: str | None = None

    manufacturer: str = ""
    product_family: str = ""
    model: str = ""
    firmware_or_revision: str = ""
    equipment_type: str = ""
    symptom: str = ""
    error_code: str = ""
    protocol: str = ""
    intent_tags: list[str] = field(default_factory=list)

    safety_class: SafetyClass = SafetyClass.NONE
    lead_score: int = 0
    answerability_score: int = 0

    def __post_init__(self) -> None:
        if self.raw_text is not None and not self.rights.permits("derivatives_retained"):
            # Not an error — the normalized question is what the benchmark actually needs.
            # Dropping verbatim text by default is PRS §15's safe default made mechanical,
            # so retention is a decision someone had to make rather than one that happens
            # because a collector populated a field.
            self.raw_text = None

    @property
    def lineage_key(self) -> str:
        return document_lineage_key(self.manufacturer, self.model, self.source_platform)

    @property
    def dedupe_hash(self) -> str:
        """Stable across whitespace and case, so the same question reposted twice collapses."""
        normalized = re.sub(r"\s+", " ", self.normalized_question.strip().lower())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def usable_for_training(self) -> bool:
        """PRS §15: third-party content needs an explicit rights grant, never an inference."""
        return self.rights.permits("training_allowed") and self.license_class in {
            LicenseClass.PUBLIC_EVAL_AND_TRAIN,
            LicenseClass.SYNTHETIC,
        }

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["lineage_key"] = self.lineage_key
        out["dedupe_hash"] = self.dedupe_hash
        return out


@dataclass
class GraderVerdict:
    """One independent grader's scoring of one answer against the PRS §7 rubric."""

    grader_id: str
    independence_class: IndependenceClass
    correctness: int = 0  # /40
    evidence: int = 0  # /20
    safety: int = 0  # /20
    actionability: int = 0  # /10
    uncertainty: int = 0  # /10
    verdict: str = "FAIL"  # PASS | FAIL
    critical_unsupported_claim: bool = False
    unsafe_specificity: bool = False
    failure_class: str | None = None
    notes: str = ""

    @property
    def total(self) -> int:
        return (
            self.correctness + self.evidence + self.safety + self.actionability + self.uncertainty
        )


@dataclass
class EvaluationRecord:
    """One MIRA run against one question, plus its grades (PRS §11).

    The version triple (`mira_version`, `prompt_version`, `retrieval_version`) is what makes
    a result reproducible. A record without it is an anecdote.
    """

    question_id: str
    mira_run_id: str
    mira_version: str
    prompt_version: str
    retrieval_version: str

    answer_text: str = ""
    answer_status: AnswerStatus = AnswerStatus.ERROR
    citations: list[str] = field(default_factory=list)
    source_documents: list[str] = field(default_factory=list)
    retrieved_chunk_count: int = 0
    best_evidence_tier: EvidenceTier = EvidenceTier.NONE

    total_answer_time_ms: int = 0
    time_to_first_answer_ms: int = 0

    grader_verdicts: list[GraderVerdict] = field(default_factory=list)
    human_adjudication: str | None = None
    failure_class: str | None = None
    notes: str = ""
    evaluated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class OutcomeRecord:
    """What happened after a verified answer (PRS §11). Publishing is a human act."""

    question_id: str
    reply_eligible: bool = False
    human_approved: bool = False
    published: bool = False
    published_at: str | None = None
    reply_url: str | None = None
    engagement_count: int = 0
    clicks: int = 0
    signups: int = 0
    qualified_leads: int = 0
    customer_conversations: int = 0
