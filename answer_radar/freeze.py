"""Frozen question snapshots (PRS §20 step 5, §14).

The daily batch must "freeze source question snapshot before reading thread answers". This
module is that freeze, and it exists because the alternative is unfalsifiable: without a
content-addressed record taken *before* MIRA runs, nobody can later prove the question was
not edited to match the answer.

Keyed the way the rest of the repo keys durable evidence — `(content_sha, stage, version)`,
the `printsense/cas.py` pattern that `.claude/rules/materialized-evidence.md` rule 7 makes
the standard. Re-freezing unchanged content is a no-op returning the same id, so a re-run
is idempotent rather than a second snapshot.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from answer_radar.schema import QuestionRecord

FREEZE_STAGE = "answer_radar.question_freeze"
FREEZE_VERSION = "v1"


def snapshot_hash(question: QuestionRecord) -> str:
    """Content address of the frozen question.

    Covers only the fields that define the *task*. Discovery metadata (when we found it,
    lead score) is excluded on purpose: re-scoring a question's commercial value must not
    invalidate the snapshot that proves what MIRA was asked.
    """
    payload = {
        "normalized_question": question.normalized_question,
        "manufacturer": question.manufacturer,
        "model": question.model,
        "equipment_type": question.equipment_type,
        "symptom": question.symptom,
        "error_code": question.error_code,
        "protocol": question.protocol,
        "stage": FREEZE_STAGE,
        "version": FREEZE_VERSION,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def freeze_question(question: QuestionRecord, out_dir: Path) -> Path:
    """Write the immutable snapshot. Returns its path.

    Refuses to overwrite an existing snapshot whose content differs — that would mean the
    question changed after being frozen, which invalidates every result already recorded
    against it. Failing loudly is the point.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    digest = snapshot_hash(question)
    path = out_dir / f"{question.question_id}.frozen.json"

    record = {
        "question_id": question.question_id,
        "snapshot_hash": digest,
        "stage": FREEZE_STAGE,
        "version": FREEZE_VERSION,
        "frozen_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "split_assignment": question.split_assignment.value,
        "lineage_key": question.lineage_key,
        "license_class": question.license_class.value,
        "safety_class": question.safety_class.value,
        "question": question.to_dict(),
    }

    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing.get("snapshot_hash") == digest:
            return path  # idempotent re-freeze
        raise ValueError(
            f"{path} already holds a DIFFERENT frozen question "
            f"({existing.get('snapshot_hash', '?')[:12]} != {digest[:12]}). A frozen "
            f"question is immutable — results already recorded against it would become "
            f"unattributable. Give the edited question a new question_id."
        )

    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def load_frozen(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
