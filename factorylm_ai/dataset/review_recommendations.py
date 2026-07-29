"""Review-by-exception recommendations for a frozen candidate pool.

Emits ``recommendations.jsonl``: one row per approvable candidate, marking it
either ``auto_approve_ok`` (eligible for the console's bulk-approve action)
or ``individual_review`` (a human must open the card). The console treats
this file as READ-ONLY advice — every committed approval still lands in the
same append-only event ledger under the human reviewer's id.

Policy ``review-by-exception.v1`` — a card is ``auto_approve_ok`` ONLY when
ALL of the following hold:

Deterministic checks (this module):
- schema-valid: chat messages validate (roles, non-empty user+assistant);
- source-grounded: the evidence contract holds mechanically —
  * the answer states the pack claim only if the USER turn carries it, and
  * an evidence-absent answer (Pattern B / C-without) does NOT state it;
- non-safety-sensitive (``safety.safety_sensitive`` false);
- train-split with ``rights.training_allowed`` (held-out/eval rows excluded);
- not a correction-type interaction (corrections always get human eyes);
- readable: printable text, no replacement chars, sane lengths.

Independent reviewer (separate judgment source, loaded from a verdicts file):
- a second reviewer — NEVER the model being trained — must have judged the
  exact content hash ``approve`` with confidence >= MIN_CONFIDENCE. Missing
  verdict => individual review (low-confidence). Disagreement with the
  deterministic checks => individual review (conflicting).

Anything else — unreadable, low-confidence, conflicting, safety-sensitive,
corrected, held-out — is routed to individual human review. The generator
never contacts any network or model at runtime; verdicts are produced
offline and bound to content hashes so a changed card invalidates its
verdict.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

POLICY_VERSION = "review-by-exception.v1"
MIN_CONFIDENCE = 0.8
# The model under training may never review its own examples (and no
# same-family checkpoint may either). Checked against the verdicts file.
FORBIDDEN_REVIEWER_SUBSTRINGS = ("technician-v0", "technician-v1", "mike_578c", "mike-578c")

REASON_SAFETY = "safety_sensitive"
REASON_SPLIT = "not_trainable_split_or_rights"
REASON_CORRECTION = "correction_interaction"
REASON_SCHEMA = "schema_invalid"
REASON_UNREADABLE = "unreadable_text"
REASON_CONTRACT = "evidence_contract_violation"
REASON_NO_VERDICT = "independent_verdict_missing"
REASON_LOW_CONF = "independent_confidence_low"
REASON_CONFLICT = "independent_reviewer_disagrees"


@dataclass(frozen=True)
class IndependentVerdict:
    reviewer_id: str
    content_hash: str
    verdict: str  # "approve" | "flag"
    confidence: float
    note: str = ""


def _load_verdicts(path: Path) -> dict[str, IndependentVerdict]:
    out: dict[str, IndependentVerdict] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        v = IndependentVerdict(
            reviewer_id=str(row["reviewer_id"]),
            content_hash=str(row["content_hash"]),
            verdict=str(row["verdict"]),
            confidence=float(row["confidence"]),
            note=str(row.get("note", "")),
        )
        lowered = v.reviewer_id.lower()
        for forbidden in FORBIDDEN_REVIEWER_SUBSTRINGS:
            if forbidden in lowered:
                raise ValueError(
                    f"independent verdicts file names a forbidden reviewer "
                    f"{v.reviewer_id!r} — the model being trained (or its family) "
                    "may never approve its own training examples"
                )
        out[v.content_hash] = v
    return out


def _messages_of(candidate: dict[str, Any]) -> tuple[str, str, bool]:
    """Return (user, assistant, schema_ok)."""
    msgs = candidate.get("messages") or []
    roles = [m.get("role") for m in msgs if isinstance(m, dict)]
    users = [m.get("content") for m in msgs if isinstance(m, dict) and m.get("role") == "user"]
    asst = [m.get("content") for m in msgs if isinstance(m, dict) and m.get("role") == "assistant"]
    ok = (
        len(msgs) >= 2
        and all(r in ("system", "user", "assistant") for r in roles)
        and bool(users)
        and bool(asst)
        and all(isinstance(c, str) and c.strip() for c in users + asst)
    )
    return (users[-1] if users else "", asst[-1] if asst else "", ok)


def _readable(text: str) -> bool:
    if not text or "�" in text:
        return False
    if len(text) > 8000:
        return False
    printable = sum(1 for ch in text if ch.isprintable() or ch in "\n\t")
    return printable / max(1, len(text)) > 0.99


def _claim_of(candidate: dict[str, Any]) -> str:
    return (
        str(candidate.get("answer_key", {}).get("withheld_payload", {}).get("claim", ""))
        .strip()
        .rstrip(".")
    )


def deterministic_reasons(candidate: dict[str, Any]) -> list[str]:
    """All deterministic reasons this card must go to individual review."""
    reasons: list[str] = []
    if candidate.get("safety", {}).get("safety_sensitive"):
        reasons.append(REASON_SAFETY)
    if candidate.get("split") != "train" or not candidate.get("rights", {}).get("training_allowed"):
        reasons.append(REASON_SPLIT)
    if candidate.get("interaction_type") == "correction":
        reasons.append(REASON_CORRECTION)
    user, answer, schema_ok = _messages_of(candidate)
    if not schema_ok:
        reasons.append(REASON_SCHEMA)
    if not (_readable(user) and _readable(answer)):
        reasons.append(REASON_UNREADABLE)
    claim = _claim_of(candidate)
    if claim and schema_ok:
        claim_in_answer = claim.lower() in answer.lower()
        claim_in_user = claim.lower() in user.lower()
        if claim_in_answer and not claim_in_user:
            reasons.append(REASON_CONTRACT)
    return reasons


def build_recommendations(
    candidates: list[dict[str, Any]],
    verdicts: dict[str, IndependentVerdict],
    *,
    manifest_sha256: str,
    content_hash_of: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for c in candidates:
        rid = c["record_id"]
        content_hash = content_hash_of.get(rid, "")
        det = deterministic_reasons(c)
        verdict = verdicts.get(content_hash)
        reasons = list(det)
        confidence = None
        reviewer = None
        if verdict is None:
            reasons.append(REASON_NO_VERDICT)
        else:
            reviewer = verdict.reviewer_id
            confidence = verdict.confidence
            if verdict.confidence < MIN_CONFIDENCE:
                reasons.append(REASON_LOW_CONF)
            if verdict.verdict != "approve":
                reasons.append(REASON_CONFLICT)
            elif not det and verdict.verdict == "approve":
                pass  # both agree: eligible
        rows.append(
            {
                "schema": "factorylm.review-by-exception.recommendation.v1",
                "policy_version": POLICY_VERSION,
                "record_id": rid,
                "content_hash": content_hash,
                "evidence_hash": c.get("answer_key", {}).get("evidence_hash", ""),
                "manifest_sha256": manifest_sha256,
                "recommendation": "auto_approve_ok" if not reasons else "individual_review",
                "reasons": sorted(reasons),
                "independent_reviewer": reviewer,
                "independent_confidence": confidence,
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", type=Path, required=True, help="candidate_dataset.jsonl")
    ap.add_argument("--manifest", type=Path, required=True, help="candidate_manifest.json")
    ap.add_argument("--verdicts", type=Path, required=True, help="independent verdicts JSONL")
    ap.add_argument("--out", type=Path, required=True, help="recommendations.jsonl destination")
    args = ap.parse_args(argv)

    candidates = [
        json.loads(line)
        for line in args.dataset.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    content_hash_of = {e["record_id"]: e["content_hash"] for e in manifest["entries"]}
    verdicts = _load_verdicts(args.verdicts)
    rows = build_recommendations(
        candidates,
        verdicts,
        manifest_sha256=manifest["manifest_sha256"],
        content_hash_of=content_hash_of,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "\n".join(json.dumps(r, ensure_ascii=True, sort_keys=True) for r in rows) + "\n",
        encoding="utf-8",
    )
    eligible = sum(1 for r in rows if r["recommendation"] == "auto_approve_ok")
    print(
        json.dumps(
            {"records": len(rows), "auto_approve_ok": eligible, "policy": POLICY_VERSION},
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
