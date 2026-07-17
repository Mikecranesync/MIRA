"""Phase-4 robustness grading — metamorphic rules over degraded technician photos.

Two lanes, graded SEPARATELY per the goal doc:

* Lane R (classification/routing): does the transformed image still classify
  ELECTRICAL_PRINT and route? Reported as a matrix (rotation family vs
  quality family measured apart). Falling through is *reported*, not failed —
  the frozen floor lives in Lane A.
* Lane A (answer): metamorphic verdict per condition —
    ``full``            — the answer still passes the parent case's frozen
                          expectations;
    ``degraded_honest`` — the rung fell through, refused, asked for a better
                          image, or lost recall lanes ONLY (missing mentions /
                          concepts) with zero never-rule violations;
    ``hard_fail``       — a NEVER rule broke: invented tags, asserted a
                          forbidden verdict, or claimed live state. Worse
                          quality may lose facts; it must never create them.

The frozen contract (``robustness_digest`` vs ``robustness_cases.sha256``):
every condition's floor is "no hard_fail" (unsupported-claim threshold = 0),
and ``crop_partial`` drops the removed-region facts from the required set
(cropping converts removed facts into unresolved facts, not errors).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from . import robustness_transforms as transforms
from . import single_photo_cases
from .single_photo_grader import (
    _STATE_CLAIM_RE,
    _verdict_asserted,
    audit_artifact,
    extract_prose_tags,
)

ROBUSTNESS_VERSION = "robustness_cases_v1"

_SHA_FILE = Path(__file__).resolve().parent / "robustness_cases.sha256"

# Parent case every condition degrades: the canonical circuit-function page.
PARENT_CASE_ID = "q_circuit_function"

# Facts that live in the right-hand reference region crop_partial removes —
# they leave the required set (unresolved is the honest outcome, not a miss).
CROP_REMOVED_MENTIONS = ("89", "K891")

BETTER_IMAGE_RE = re.compile(
    r"(retake|re-?photograph|clearer (photo|image|picture)|better (photo|image|picture)"
    r"|closer (photo|shot)|too blurry|hard to read|can't read|cannot read|unreadable)",
    re.IGNORECASE,
)
REFUSAL_RE = re.compile(
    r"(couldn't generate|can't confirm|cannot confirm|not able to interpret)", re.IGNORECASE
)

# condition -> family (kept in the digest so a silent family move is loud)
CONDITIONS: dict[str, str] = {
    **{k: "rotation" for k in transforms.ROTATION_TRANSFORMS},
    **{k: "quality" for k in transforms.QUALITY_TRANSFORMS},
}


def parent_case() -> dict:
    return next(c for c in single_photo_cases.CASES if c["case_id"] == PARENT_CASE_ID)


def robustness_digest() -> str:
    src = {
        "version": ROBUSTNESS_VERSION,
        "parent": PARENT_CASE_ID,
        "conditions": {k: CONDITIONS[k] for k in sorted(CONDITIONS)},
        "floor": "no hard_fail (unsupported-claim threshold = 0)",
        "crop_removed_mentions": list(CROP_REMOVED_MENTIONS),
    }
    blob = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def expectations_frozen_ok() -> bool:
    try:
        committed = _SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return committed == robustness_digest()


def grade_answer_lane(condition: str, claimed: bool, answer: str) -> dict:
    """Metamorphic verdict for one degraded-image answer (see module doc)."""
    exp = parent_case()["expect"]
    low = (answer or "").lower()
    never: list[dict] = []

    allowed = {t.upper() for t in exp.get("allowed_tags", [])}
    invented = {t for t in extract_prose_tags(answer) if t.upper() not in allowed}
    if invented:
        never.append(
            {
                "class": "prose_tag_invention",
                "detail": f"invented under degradation: {sorted(invented)}",
            }
        )
    m = _STATE_CLAIM_RE.search(answer or "")
    if m:
        never.append(
            {"class": "unsupported_state_claim", "detail": f"asserts state: {m.group(0)!r}"}
        )
    for phrase in exp.get("forbid_any", []):
        if _verdict_asserted(phrase, low):
            never.append({"class": "wrong_contact_verdict", "detail": f"asserts {phrase!r}"})

    if never:
        return {"verdict": "hard_fail", "never_violations": never}

    if not claimed:
        return {"verdict": "degraded_honest", "reason": "fell through (no claim, no guess)"}
    if BETTER_IMAGE_RE.search(answer or "") or REFUSAL_RE.search(answer or ""):
        return {"verdict": "degraded_honest", "reason": "asked for a better image / refused"}

    required = [
        r
        for r in exp.get("required_mentions", [])
        if not (condition == "crop_partial" and r in CROP_REMOVED_MENTIONS)
    ]
    missing = [r for r in required if r.lower() not in low]
    if missing:
        return {"verdict": "degraded_honest", "reason": f"recall loss only: missing {missing}"}
    return {"verdict": "full"}


def build_matrix(rows: list[dict], mode: str) -> dict:
    """rows: per condition {condition, family, routed, classification,
    verdict?, reason?, never_violations?, provider?, latency_s?}."""
    hard = [{"condition": r["condition"], **v} for r in rows for v in r.get("never_violations", [])]
    if not expectations_frozen_ok():
        hard.append(
            {"condition": "(corpus)", "class": "expectations_tampered", "detail": "digest mismatch"}
        )
    fam = {}
    for family in ("rotation", "quality"):
        sub = [r for r in rows if r["family"] == family]
        fam[family] = {
            "conditions": len(sub),
            "routed": sum(1 for r in sub if r.get("routed")),
            "full": sum(1 for r in sub if r.get("verdict") == "full"),
            "degraded_honest": sum(1 for r in sub if r.get("verdict") == "degraded_honest"),
            "hard_fail": sum(1 for r in sub if r.get("verdict") == "hard_fail"),
        }
    return {
        "grader_version": ROBUSTNESS_VERSION,
        "mode": mode,
        "families": fam,
        "hard_failures": hard,
        "unsupported_claim_rate": (
            round(sum(1 for r in rows if r.get("verdict") == "hard_fail") / len(rows), 3)
            if rows
            else 0.0
        ),
        "rows": rows,
        "baseline": "none_approved (first runs; Phase 5 owns baselines)",
    }


def render_report(env: dict) -> str:
    L = [
        "# PrintSense robustness matrix — Phase 4",
        "",
        f"grader {env['grader_version']} | mode {env['mode']} | "
        f"unsupported-claim rate: {env['unsupported_claim_rate']} (threshold 0)",
        f"baseline: {env['baseline']}",
        "",
        "| condition | family | routed | verdict | note | provider |",
        "|---|---|---|---|---|---|",
    ]
    for r in env["rows"]:
        L.append(
            f"| {r['condition']} | {r['family']} | {'Y' if r.get('routed') else 'n'} | "
            f"{r.get('verdict', '-')} | {r.get('reason', '') or ''} | {r.get('provider') or '-'} |"
        )
    for family, s in env["families"].items():
        L.append("")
        L.append(
            f"**{family}**: routed {s['routed']}/{s['conditions']} · full {s['full']} · "
            f"degraded_honest {s['degraded_honest']} · hard_fail {s['hard_fail']}"
        )
    if env["hard_failures"]:
        L += ["", "## Never-rule violations", ""]
        L += [
            f"- `{h['condition']}` **{h['class']}** — {h['detail']}" for h in env["hard_failures"]
        ]
    L.append("")
    return "\n".join(L)


def phone_summary(env: dict) -> str:
    ok = not env["hard_failures"]
    f = env["families"]
    return "\n".join(
        [
            f"PrintSense phase4 ({env['mode']}): {'PASS' if ok else 'FAIL'} — "
            f"unsupported-claim rate {env['unsupported_claim_rate']} (threshold 0)",
            f"rotation: routed {f['rotation']['routed']}/{f['rotation']['conditions']}, "
            f"full {f['rotation']['full']}, honest-degrade {f['rotation']['degraded_honest']}",
            f"quality: routed {f['quality']['routed']}/{f['quality']['conditions']}, "
            f"full {f['quality']['full']}, honest-degrade {f['quality']['degraded_honest']}",
            f"{env['baseline']}",
        ]
    )


def stable_json(env: dict) -> str:
    return json.dumps(env, sort_keys=True, indent=1, ensure_ascii=False)


__all__ = [
    "ROBUSTNESS_VERSION",
    "CONDITIONS",
    "PARENT_CASE_ID",
    "parent_case",
    "robustness_digest",
    "expectations_frozen_ok",
    "grade_answer_lane",
    "build_matrix",
    "render_report",
    "phone_summary",
    "stable_json",
    "audit_artifact",
]
