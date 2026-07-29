"""ZTA artifact registry — append-only ledger, fail-closed runtime promotion.

ZTA role: the durable record of every artifact the model lab produces
(prompt versions, adapters, task specs, schema versions, ...). Registering
an artifact is cheap and reversible — a new JSONL row is appended and the
latest row for a given ``artifact_id`` wins on read. PROMOTING an artifact
to ``runtime_allowed=True`` is not cheap: both :meth:`ArtifactRegistry.register`
and :meth:`ArtifactRegistry.allow_runtime` refuse to write a row with
``runtime_allowed=True`` unless ``review_status == "approved"`` AND
``benchmark_status == "pass"`` — fail closed, no exceptions, no override
flag. This mirrors the fail-closed, evidence-gated doctrine of
``printsense/providers/registry.py`` (a capability is never broadly
"qualified"; it is qualified only on recorded evidence, and selection fails
closed rather than silently falling back).

Promotion to runtime is a HUMAN action, performed via explicit invocation —
an operator running ``allow_runtime()`` from a CLI/REPL/documented
procedure after reading the benchmark evidence — never a call automation
makes on its own. No code in ``factorylm_ai`` (proofpack, evals, the
providers, the flywheel) ever calls ``allow_runtime()`` itself. If you are
tempted to wire this into an automated pipeline, don't: that is precisely
the shortcut this module exists to refuse.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any

from factorylm_ai.schemas.validate import SchemaError, load_schema, validate

logger = logging.getLogger("factorylm-ai")

_APPROVED_REVIEW = "approved"
_PASSED_BENCHMARK = "pass"
_ZTA_ARTIFACT_SCHEMA = "zta_artifact"


@dataclass
class ZtaArtifact:
    """Mirrors schemas/zta_artifact.schema.json exactly, field for field."""

    artifact_id: str
    artifact_type: str
    version: str
    source_interaction_ids: list[str]
    source_file_hashes: list[str]
    tenant_id: str | None
    created_at: str
    created_by: str
    review_status: str  # draft | approved | rejected | superseded
    benchmark_status: str  # untested | pass | fail | regression
    runtime_allowed: bool
    metadata: dict[str, Any] = field(default_factory=dict)


class PromotionBlocked(Exception):
    """Raised when a runtime-allowed write/flip does not meet the promotion gate
    (review_status=='approved' AND benchmark_status=='pass'), or when
    allow_runtime() targets an artifact_id that has no registered row.
    """


def _gates_pass(a: ZtaArtifact) -> bool:
    return a.review_status == _APPROVED_REVIEW and a.benchmark_status == _PASSED_BENCHMARK


def _adapter_metadata_errors(a: ZtaArtifact) -> list[str]:
    if a.artifact_type != "adapter":
        return []
    errors: list[str] = []
    required_strings = (
        "job_id",
        "base_model",
        "output_model",
        "dataset_version",
        "dataset_manifest_hash",
    )
    for key in required_strings:
        if not isinstance(a.metadata.get(key), str) or not a.metadata.get(key):
            errors.append(f"metadata.{key} must be a non-empty string")
    if not isinstance(a.metadata.get("hyperparams"), dict):
        errors.append("metadata.hyperparams must be an object")
    if not a.source_file_hashes:
        errors.append("source_file_hashes must include the dataset manifest hash")
    return errors


def _default_registry_path() -> Path:
    data_dir = os.getenv("FACTORYLM_AI_DATA_DIR") or "factorylm_ai/data"
    return Path(data_dir) / "registry.jsonl"


def _from_record(record: dict[str, Any]) -> ZtaArtifact:
    return ZtaArtifact(
        artifact_id=record["artifact_id"],
        artifact_type=record["artifact_type"],
        version=record["version"],
        source_interaction_ids=list(record["source_interaction_ids"]),
        source_file_hashes=list(record["source_file_hashes"]),
        tenant_id=record["tenant_id"],
        created_at=record["created_at"],
        created_by=record["created_by"],
        review_status=record["review_status"],
        benchmark_status=record["benchmark_status"],
        runtime_allowed=record["runtime_allowed"],
        metadata=dict(record.get("metadata") or {}),
    )


class ArtifactRegistry:
    """Append-only JSONL ledger of ZtaArtifact rows; latest row per artifact_id wins."""

    def __init__(self, path: str | None = None) -> None:
        self._path = Path(path) if path is not None else _default_registry_path()

    @property
    def path(self) -> Path:
        return self._path

    def register(self, a: ZtaArtifact) -> None:
        """Validate and append a new artifact row.

        Raises SchemaError if ``a`` does not match zta_artifact.schema.json.
        Raises PromotionBlocked if ``a.runtime_allowed`` is True but the
        review/benchmark gates are not both satisfied (fail closed) — a
        caller can never smuggle a live artifact in through register();
        it must first be registered not-yet-runtime-allowed, reviewed,
        benchmarked, then promoted via allow_runtime().
        """
        record = asdict(a)
        errors = validate(record, load_schema(_ZTA_ARTIFACT_SCHEMA))
        if errors:
            raise SchemaError(
                f"artifact {a.artifact_id!r} failed schema validation: {'; '.join(errors)}"
            )
        metadata_errors = _adapter_metadata_errors(a)
        if metadata_errors:
            raise SchemaError(
                f"adapter metadata for {a.artifact_id!r} is incomplete: "
                f"{'; '.join(metadata_errors)}"
            )
        if a.runtime_allowed and not _gates_pass(a):
            raise PromotionBlocked(
                f"artifact {a.artifact_id!r} requested runtime_allowed=True but "
                f"review_status={a.review_status!r} benchmark_status={a.benchmark_status!r} "
                "(requires review_status='approved' AND benchmark_status='pass')"
            )
        self._append(record)
        logger.info(
            "registered artifact %s type=%s version=%s runtime_allowed=%s",
            a.artifact_id,
            a.artifact_type,
            a.version,
            a.runtime_allowed,
        )

    def get(self, artifact_id: str) -> ZtaArtifact | None:
        """Return the latest row for artifact_id, or None if never registered."""
        latest: ZtaArtifact | None = None
        for record in self._read_all():
            if record.get("artifact_id") == artifact_id:
                latest = _from_record(record)
        return latest

    def list(self, artifact_type: str | None = None) -> list[ZtaArtifact]:
        """Return the latest row per artifact_id, optionally filtered by type."""
        latest_by_id: dict[str, ZtaArtifact] = {}
        order: list[str] = []
        for record in self._read_all():
            artifact_id = record["artifact_id"]
            if artifact_id not in latest_by_id:
                order.append(artifact_id)
            latest_by_id[artifact_id] = _from_record(record)
        artifacts = [latest_by_id[artifact_id] for artifact_id in order]
        if artifact_type is not None:
            artifacts = [a for a in artifacts if a.artifact_type == artifact_type]
        return artifacts

    def allow_runtime(self, artifact_id: str) -> ZtaArtifact:
        """Flip runtime_allowed=True for artifact_id, appending a new row.

        ONLY succeeds if the current row's review_status=='approved' AND
        benchmark_status=='pass'; otherwise raises PromotionBlocked. This is
        the human-invoked promotion action — see module docstring. Nothing
        else in factorylm_ai calls this.
        """
        current = self.get(artifact_id)
        if current is None:
            raise PromotionBlocked(f"no artifact registered with id {artifact_id!r}")
        if not _gates_pass(current):
            raise PromotionBlocked(
                f"artifact {artifact_id!r} cannot be promoted: "
                f"review_status={current.review_status!r} "
                f"benchmark_status={current.benchmark_status!r} "
                "(requires review_status='approved' AND benchmark_status='pass')"
            )
        metadata_errors = _adapter_metadata_errors(current)
        if metadata_errors:
            raise PromotionBlocked(
                f"artifact {artifact_id!r} cannot be promoted: adapter metadata is incomplete: "
                f"{'; '.join(metadata_errors)}"
            )
        promoted = replace(current, runtime_allowed=True)
        record = asdict(promoted)
        errors = validate(record, load_schema(_ZTA_ARTIFACT_SCHEMA))
        if errors:
            raise SchemaError(
                f"artifact {artifact_id!r} failed schema validation on promotion: "
                f"{'; '.join(errors)}"
            )
        self._append(record)
        logger.info("artifact %s promoted to runtime_allowed=True by explicit call", artifact_id)
        return promoted

    def _append(self, record: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, sort_keys=True))
            f.write("\n")

    def _read_all(self) -> list[dict[str, Any]]:
        if not self._path.is_file():
            return []
        records: list[dict[str, Any]] = []
        with self._path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                records.append(json.loads(line))
        return records
