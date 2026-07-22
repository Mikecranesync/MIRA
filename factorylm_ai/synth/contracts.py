"""Synthetic-interaction contracts: source classes, labeling, answer-key law, job record.

Deterministic data shapes only (addendum §6.5/§12/§14/§15). The two governance
laws enforced here:

* **Synthetic labeling (§14):** every generated case is unambiguously labeled so
  a report can never present a synthetic case as an organic customer interaction.
* **Answer-key independence (§15) — the anti-self-training law:** a synthetic
  training candidate's answer key MUST be independent of the target's response.
  A key derived from the target model (or a second prompt to it, or an agent's
  intuition) is rejected ``ANSWER_KEY_WEAK`` — fail closed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from . import rejection_codes as rc

# Source class (§6.5) — real vs the synthetic families. Reports MUST count these
# separately (§14); synthetic and real are never conflated.
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

# answer_key_type (§14) — the provenance class of the withheld ground truth.
AK_DETERMINISTIC_PACK = "deterministic_pack"
AK_DETERMINISTIC_SIMULATION = "deterministic_simulation"
AK_PUBLIC_SOURCE_WITHHELD = "public_source_withheld"
AK_FROZEN_BENCHMARK = "frozen_benchmark"
AK_HUMAN_APPROVED = "human_approved"
AK_DETERMINISTIC_GRAPH = "deterministic_graph"
AK_VERIFIED_EVIDENCE = "verified_structured_evidence"
# Every acceptable key is independent of the target model by construction (§15).
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


class AnswerKeyRejected(ValueError):
    """Raised (fail-closed) when an answer key is not independent of the target."""

    def __init__(self, detail: str):
        self.rejection = rc.Rejection(rc.ANSWER_KEY_WEAK, detail)
        super().__init__(detail)


@dataclass(frozen=True)
class AnswerKey:
    """A withheld ground-truth reference, independent of the target response (§15).

    ``derived_from_model`` records whether this key came from any model output
    (which makes it self-training and thus unacceptable). ``key_ref`` is a
    content-addressed pointer to the withheld evidence, never inlined into the
    question."""

    key_type: str
    key_ref: str
    derived_from_model: bool = False
    detail: str = ""

    def assert_independent(self, target_model_id: str | None = None) -> None:
        if self.key_type not in ACCEPTABLE_ANSWER_KEY_TYPES:
            raise AnswerKeyRejected(
                f"answer_key_type {self.key_type!r} is not an accepted independent type"
            )
        if self.derived_from_model:
            raise AnswerKeyRejected("answer key was derived from a model output (self-training)")
        if not self.key_ref:
            raise AnswerKeyRejected("answer key has no evidence reference")


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


def idempotency_key(
    *,
    source_type: str,
    source_id: str,
    document_lineage_key: str,
    prompt_version: str,
    mutation_family: str,
) -> str:
    """Stable key so a rerun of the SAME source+lineage+question-form is a no-op
    (§12 idempotent reruns, §16 mutation tracking). Same inputs → same key."""
    raw = "\x00".join(
        [source_type, source_id, document_lineage_key, prompt_version, mutation_family]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# §12 job record fields — the minimum durable provenance for every job.
JOB_FIELDS: tuple[str, ...] = (
    "job_id",
    "case_id",
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
    """One synthetic-flywheel job (§12). Mutable stage/status/hashes as it advances;
    identity + lineage are set at creation and never change."""

    job_id: str
    case_id: str
    source_type: str
    source_id: str
    document_lineage_key: str
    target_surface: str
    idempotency_key: str
    stage: str
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
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    lease_expires_at: str | None = None
    error_code: str | None = None
    error_detail: str | None = None
    labels: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.source_type not in SOURCE_CLASSES:
            raise ValueError(f"bad source_type {self.source_type!r}")

    def to_dict(self) -> dict:
        d = {k: getattr(self, k) for k in JOB_FIELDS}
        d["labels"] = self.labels
        return d
