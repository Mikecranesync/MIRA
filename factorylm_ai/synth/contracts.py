"""Synthetic-interaction contracts: source classes, labeling, answer-key law, job record.

Deterministic data shapes only (addendum §6.5/§12/§14/§15). Governance laws:

* **Synthetic labeling (§14):** every generated case is unambiguously labeled so
  a report can never present a synthetic case as an organic customer interaction.
* **Answer-key independence (§15) — anti-self-training:** a candidate's answer key
  MUST come from an independent producer with verifiable evidence. Explicit
  provenance (producer type/model/prompt-hash, evidence hash, verification
  status/verifier) is required; anything produced by the target model, unverified
  model output, evidence-less, or with an incomplete provenance chain is rejected
  ``ANSWER_KEY_WEAK`` — fail closed.
* **Case vs execution identity (review fix 3):** ``case_key`` is the stable
  *what-is-being-asked* (lineage + evidence content + mutation + answer-key +
  prompt versions); ``execution_key`` is *one run of that case* (case_key +
  target surface/config + model + tools/retrieval + run mode). Base/tools/adapter
  runs of one case get distinct ``execution_key``s and never collide; new
  evidence or a new answer key changes ``case_key`` (a new case version).

Timestamps are ``float | None`` epoch seconds throughout (matches the JSON schema
and the SQLite REAL columns).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from ..governance import rejection_codes as rc

# ── source classes (§6.5) — real vs synthetic families, never conflated (§14) ──
REAL_USER = "real_user"
OWNER_GENERATED = "owner_generated"
SYNTHETIC_BENCHMARK = "synthetic_benchmark"
SIMULATED_FAULT = "simulated_fault"
PUBLIC_DOCUMENT_CASE = "public_document_case"
SOURCE_CLASSES: frozenset[str] = frozenset(
    {REAL_USER, OWNER_GENERATED, SYNTHETIC_BENCHMARK, SIMULATED_FAULT, PUBLIC_DOCUMENT_CASE}
)
REAL_SOURCE_CLASSES: frozenset[str] = frozenset({REAL_USER, OWNER_GENERATED})

ORIGIN_SYNTHETIC = "synthetic"
ORIGIN_REAL = "real"
INTERACTION_ORIGINS: frozenset[str] = frozenset({ORIGIN_SYNTHETIC, ORIGIN_REAL})

SYNTHETIC_METHOD = "scheduled_evidence_grounded"

# answer_key_type (§14) — the provenance CLASS label carried on the case.
AK_DETERMINISTIC_PACK = "deterministic_pack"
AK_DETERMINISTIC_SIMULATION = "deterministic_simulation"
AK_PUBLIC_SOURCE_WITHHELD = "public_source_withheld"
AK_FROZEN_BENCHMARK = "frozen_benchmark"
AK_HUMAN_APPROVED = "human_approved"
AK_DETERMINISTIC_GRAPH = "deterministic_graph"
AK_VERIFIED_EVIDENCE = "verified_structured_evidence"
ACCEPTABLE_ANSWER_KEY_TYPES: frozenset[str] = frozenset(
    {
        AK_DETERMINISTIC_PACK,
        AK_DETERMINISTIC_SIMULATION,
        AK_PUBLIC_SOURCE_WITHHELD,
        AK_FROZEN_BENCHMARK,
        AK_HUMAN_APPROVED,
        AK_DETERMINISTIC_GRAPH,
        AK_VERIFIED_EVIDENCE,
    }
)

# ── answer-key producer provenance (review fix 4) ─────────────────────────────
PRODUCER_DETERMINISTIC = "deterministic"  # pack / simulation / graph / evidence
PRODUCER_HUMAN = "human"
PRODUCER_PUBLIC_SOURCE = "public_source"
PRODUCER_FROZEN_BENCHMARK = "frozen_benchmark"
PRODUCER_TARGET_MODEL = "target_model"  # the model under test — ALWAYS rejected
PRODUCER_OTHER_MODEL = "other_model"  # a different model — only if verified + evidence
PRODUCER_TYPES: frozenset[str] = frozenset(
    {
        PRODUCER_DETERMINISTIC,
        PRODUCER_HUMAN,
        PRODUCER_PUBLIC_SOURCE,
        PRODUCER_FROZEN_BENCHMARK,
        PRODUCER_TARGET_MODEL,
        PRODUCER_OTHER_MODEL,
    }
)
_MODEL_PRODUCERS: frozenset[str] = frozenset({PRODUCER_TARGET_MODEL, PRODUCER_OTHER_MODEL})
_INDEPENDENT_PRODUCERS: frozenset[str] = frozenset(
    {PRODUCER_DETERMINISTIC, PRODUCER_HUMAN, PRODUCER_PUBLIC_SOURCE, PRODUCER_FROZEN_BENCHMARK}
)

VERIFY_VERIFIED = "verified"
VERIFY_UNVERIFIED = "unverified"


class AnswerKeyRejected(ValueError):
    """Raised (fail-closed) when an answer key is not provably independent."""

    def __init__(self, detail: str):
        self.rejection = rc.Rejection(rc.ANSWER_KEY_WEAK, detail)
        super().__init__(detail)


@dataclass(frozen=True)
class AnswerKeyProvenance:
    """Explicit provenance chain for a withheld answer key (review fix 4)."""

    producer_type: str
    evidence_hash: str
    verification_status: str = VERIFY_UNVERIFIED
    producer_model_id: str | None = None
    producer_prompt_hash: str | None = None
    verifier: str | None = None

    def to_dict(self) -> dict:
        return {
            "producer_type": self.producer_type,
            "evidence_hash": self.evidence_hash,
            "verification_status": self.verification_status,
            "producer_model_id": self.producer_model_id,
            "producer_prompt_hash": self.producer_prompt_hash,
            "verifier": self.verifier,
        }


@dataclass(frozen=True)
class AnswerKey:
    """A withheld ground-truth reference + its provenance chain (§15)."""

    key_type: str
    key_ref: str
    provenance: AnswerKeyProvenance

    def assert_independent(self, target_model_id: str | None = None) -> None:
        """Fail closed unless the key is provably independent of the target."""
        p = self.provenance
        if not self.key_ref:
            raise AnswerKeyRejected("answer key has no evidence reference")
        if self.key_type not in ACCEPTABLE_ANSWER_KEY_TYPES:
            raise AnswerKeyRejected(f"answer_key_type {self.key_type!r} not accepted")
        # incomplete provenance chain
        if p.producer_type not in PRODUCER_TYPES:
            raise AnswerKeyRejected(f"unknown producer_type {p.producer_type!r}")
        if not p.evidence_hash:
            raise AnswerKeyRejected("answer key lacks independent evidence (no evidence_hash)")
        if not p.verification_status:
            raise AnswerKeyRejected("answer key provenance incomplete (no verification_status)")
        # any model producer must be fully attributed AND verified
        is_model = p.producer_type in _MODEL_PRODUCERS
        if is_model and (not p.producer_model_id or not p.producer_prompt_hash):
            raise AnswerKeyRejected(
                "model-produced key has incomplete provenance (model id / prompt hash)"
            )
        if is_model and p.verification_status != VERIFY_VERIFIED:
            raise AnswerKeyRejected("unverified model output cannot be an answer key")
        # produced by the target model itself → self-training
        if p.producer_type == PRODUCER_TARGET_MODEL:
            raise AnswerKeyRejected("answer key was produced by the target model (self-training)")
        if target_model_id and p.producer_model_id and p.producer_model_id == target_model_id:
            raise AnswerKeyRejected("answer key producer is the target model (self-training)")


@dataclass(frozen=True)
class SyntheticLabel:
    """The §14 labeling stamped on every generated case."""

    interaction_origin: str = ORIGIN_SYNTHETIC
    synthetic_method: str = SYNTHETIC_METHOD
    answer_key_type: str = AK_DETERMINISTIC_PACK

    def __post_init__(self) -> None:
        if self.interaction_origin not in INTERACTION_ORIGINS:
            raise ValueError(f"bad interaction_origin {self.interaction_origin!r}")
        if self.answer_key_type not in ACCEPTABLE_ANSWER_KEY_TYPES:
            raise ValueError(f"bad answer_key_type {self.answer_key_type!r}")

    def to_dict(self) -> dict:
        return {
            "interaction_origin": self.interaction_origin,
            "synthetic_method": self.synthetic_method,
            "answer_key_type": self.answer_key_type,
        }


def _sha(*parts: str) -> str:
    return hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()


def case_key(
    *,
    document_lineage_key: str,
    evidence_content_hash: str,
    mutation_family: str,
    answer_key_version: str,
    question_prompt_version: str,
) -> str:
    """Stable identity of *what is being asked* (review fix 3). Changing the
    evidence content or the answer-key version yields a NEW case_key = a new case
    version. Sibling question forms of one lineage differ only by mutation_family."""
    return "case_" + _sha(
        document_lineage_key,
        evidence_content_hash,
        mutation_family,
        answer_key_version,
        question_prompt_version,
    )


def execution_key(
    *,
    case_key: str,
    target_surface: str,
    target_config_version: str,
    model_version: str,
    tools_retrieval_version: str,
    run_mode: str,
) -> str:
    """Stable identity of *one run of a case* (review fix 3). Base/tools/adapter
    evaluations of the same case differ in model_version / tools_retrieval_version
    / run_mode, so their execution_keys never collide."""
    return "exec_" + _sha(
        case_key,
        target_surface,
        target_config_version,
        model_version,
        tools_retrieval_version,
        run_mode,
    )


# §12 job record fields + the review-fix additions. Single source of truth for
# the dataclass, the SQLite columns, and the JSON schema (schema-drift tested).
JOB_FIELDS: tuple[str, ...] = (
    "job_id",
    "case_id",
    "case_key",
    "execution_key",
    "case_version",
    "supersedes_case_key",
    "reconciliation_count",
    "source_type",
    "source_id",
    "document_lineage_key",
    "target_surface",
    "stage",
    "status",
    "attempt_count",
    "idempotency_key",
    "input_hash",
    "evidence_hash",
    "answer_key_hash",
    "blind_response_hash",
    "critic_output_hash",
    "candidate_output_hash",
    "prompt_version",
    "model_provider",
    "model_id",
    "model_version",
    "rights_status",
    "split",
    "created_at",
    "started_at",
    "finished_at",
    "lease_expires_at",
    "error_code",
    "error_detail",
)


@dataclass
class JobRecord:
    """One synthetic-flywheel job (§12 + review fixes). Identity/lineage are set at
    creation; stage/status/hashes/reconciliation_count advance as it runs.
    Timestamps are epoch seconds (``float | None``)."""

    job_id: str
    case_id: str
    case_key: str
    execution_key: str
    source_type: str
    source_id: str
    document_lineage_key: str
    target_surface: str
    stage: str
    idempotency_key: str | None = None  # §12; defaults to execution_key when unset
    case_version: str | None = None
    supersedes_case_key: str | None = None
    reconciliation_count: int = 0
    status: str = "pending"
    attempt_count: int = 0
    input_hash: str | None = None
    evidence_hash: str | None = None
    answer_key_hash: str | None = None
    blind_response_hash: str | None = None
    critic_output_hash: str | None = None
    candidate_output_hash: str | None = None
    prompt_version: str | None = None
    model_provider: str | None = None
    model_id: str | None = None
    model_version: str | None = None
    rights_status: str | None = None
    split: str | None = None
    created_at: float | None = None
    started_at: float | None = None
    finished_at: float | None = None
    lease_expires_at: float | None = None
    error_code: str | None = None
    error_detail: str | None = None
    labels: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.source_type not in SOURCE_CLASSES:
            raise ValueError(f"bad source_type {self.source_type!r}")
        if self.idempotency_key is None:
            self.idempotency_key = self.execution_key

    def to_dict(self) -> dict:
        d: dict[str, Any] = {k: getattr(self, k) for k in JOB_FIELDS}
        d["labels"] = self.labels
        return d
