"""Print of the Day — the ONE structured view model both surfaces render from.

PRD "Print of the Day — Mobile-First Daily Review Experience" §13.3. The
mobile-first review email AND the full evidence report are BOTH generated from
this single immutable view model (PRD §19 "generate both from the same
immutable structured view model") — never maintained separately, so they can
never disagree.

The view model is DERIVED from the POTD case manifest (`factorylm.print-of-day.v1`,
PR 6) plus the deterministic grade and — when available — the independent judge
/ claim ledger. It degrades HONESTLY: when claim-level data is absent (e.g. the
judge was unavailable in-container, a real degraded state today), the claim
counts are ``null`` and the pipeline-health section says so; it never fabricates
a "20 confirmed" summary it cannot support.

Pure + import-safe: no env, no network, no I/O. A dict in, a dataclass out.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

VIEW_MODEL_SCHEMA = "factorylm.potd-view-model.v1"
EMAIL_TEMPLATE_VERSION = "print_of_day_email_v2"
REPORT_TEMPLATE_VERSION = "print_of_day_report_v1"

# Verdict vocabulary (PRD §14 status treatments). Text labels, never colour alone.
VERDICT_GOLD_CANDIDATE = "gold_candidate"
VERDICT_CORRECTION_REQUIRED = "correction_required"
VERDICT_HOLD = "hold_for_review"
VERDICT_REJECTED = "rejected"
VERDICT_UNSAFE = "unsafe"
VERDICT_RIGHTS_BLOCKED = "rights_blocked"

VERDICT_LABELS = {
    VERDICT_GOLD_CANDIDATE: "Gold Candidate",
    VERDICT_CORRECTION_REQUIRED: "Correction Required",
    VERDICT_HOLD: "Hold for Review",
    VERDICT_REJECTED: "Rejected",
    VERDICT_UNSAFE: "Unsafe",
    VERDICT_RIGHTS_BLOCKED: "Rights Blocked",
}

# Pipeline-health status vocabulary (PRD §9.10) — SEPARATE from the model grade.
PIPELINE_HEALTHY = "healthy"
PIPELINE_DEGRADED = "degraded"
PIPELINE_MANUAL_REVIEW = "manual_review_required"
PIPELINE_BLOCKED = "blocked"

_MAX_KEY_FINDINGS = 3


@dataclass
class KeyFinding:
    type: str  # confirmed | correction | nuance | learning
    title: str
    summary: str

    def to_dict(self) -> dict:
        return {"type": self.type, "title": self.title, "summary": self.summary}


@dataclass
class ViewModel:
    schema: str
    case_id: str
    sequence_number: int | None
    title: str
    evaluation_date: str
    verdict: str
    verdict_label: str
    overall_grade: str | None
    claim_counts: dict[str, int | None]
    dimension_grades: dict[str, str]
    source: dict[str, Any]
    blind_summary: str
    key_findings: list[KeyFinding]
    pipeline_health: dict[str, Any]
    report: dict[str, Any]
    actions: dict[str, str]
    promotion_blocked: bool
    template_versions: dict[str, str]
    dedup_key: str

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "key_findings"}
        d["key_findings"] = [f.to_dict() for f in self.key_findings]
        return d


def duplicate_send_key(
    case_id: str, report_version: int | str, template_version: str, recipient: str
) -> str:
    """FR-8 durable send key: sha256(case_id + report_version + template_version + recipient).

    One case/report-version/template-version/recipient combination sends once;
    a provider retry or forwarded link cannot re-trigger it."""
    raw = f"{case_id}\x00{report_version}\x00{template_version}\x00{recipient}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _derive_verdict(
    manifest: dict, grade: dict, claim_counts: dict[str, int | None]
) -> tuple[str, bool]:
    """(verdict, promotion_blocked) from the available evidence, fail-safe.

    Safety/rights blocks and hard grade failures win over a rosy gold verdict
    (PRD §19 "display any safety-critical or promotion-blocking issue"). Gold
    candidacy requires the manifest's fail-closed gold_eligible AND no incorrect
    claims (when the claim ledger is present)."""
    ocr = manifest.get("ocr", {})
    if grade.get("safety_critical_misreads"):
        return VERDICT_UNSAFE, True
    if manifest.get("provider", {}).get("resolved") is None:
        return VERDICT_HOLD, True
    if grade.get("import_verdict") not in (None, "PASS"):
        return VERDICT_CORRECTION_REQUIRED, True
    if grade.get("hard_failures"):
        return VERDICT_CORRECTION_REQUIRED, True
    incorrect = claim_counts.get("incorrect")
    if incorrect is not None and incorrect > 0:
        return VERDICT_CORRECTION_REQUIRED, True
    if not ocr.get("available", False) and ocr.get("required", False):
        return VERDICT_HOLD, True
    if manifest.get("gold_eligible"):
        return VERDICT_GOLD_CANDIDATE, False
    return VERDICT_HOLD, True


def _pipeline_health(manifest: dict) -> dict[str, Any]:
    """Pipeline-health block (PRD §9.10) — infra status, SEPARATE from grade."""
    judge = manifest.get("judge", {})
    ocr = manifest.get("ocr", {})
    messages: list[str] = []
    judge_state = "ok"
    if judge.get("judge_error"):
        judge_state = "manual_fallback"
        messages.append(
            f"Independent LLM judge unavailable; hand review required ({judge['judge_error']})."
        )
    ocr_state = "ok"
    if not ocr.get("available"):
        ocr_state = "unavailable"
        messages.append("OCR cross-check unavailable (Tesseract not available).")
    if manifest.get("degraded"):
        messages.extend(str(d) for d in manifest["degraded"])

    if judge_state == "manual_fallback" or manifest.get("degraded"):
        status = PIPELINE_MANUAL_REVIEW if judge_state == "manual_fallback" else PIPELINE_DEGRADED
    elif ocr_state == "unavailable":
        status = PIPELINE_DEGRADED
    else:
        status = PIPELINE_HEALTHY
    return {
        "status": status,
        "judge": judge_state,
        "ocr_crosscheck": ocr_state,
        "messages": messages,
    }


def _key_findings(grade: dict, claims: list[dict] | None) -> list[KeyFinding]:
    """At most three findings for the email (PRD §9.7). Prefers a real claim
    ledger; falls back to the deterministic grade's confident/safety misreads;
    ends with a nuance/learning slot so there are always at least one."""
    findings: list[KeyFinding] = []
    if claims:
        confirmed = [c for c in claims if c.get("status") == "CONFIRMED"]
        incorrect = [c for c in claims if c.get("status") in ("INCORRECT", "UNSUPPORTED")]
        if confirmed:
            findings.append(
                KeyFinding(
                    "confirmed", "Strongest confirmed interpretation", confirmed[0].get("text", "")
                )
            )
        if incorrect:
            findings.append(
                KeyFinding("correction", "Most important correction", incorrect[0].get("text", ""))
            )
    else:
        for m in (grade.get("safety_critical_misreads") or [])[:1]:
            findings.append(KeyFinding("correction", "Safety-critical misread", str(m)))
        for m in (grade.get("confident_misreads") or [])[:1]:
            findings.append(KeyFinding("correction", "Confident misread", str(m)))
    while len(findings) < 1:
        findings.append(
            KeyFinding(
                "learning",
                "Reviewer confirmation needed",
                "Claim-level judging was unavailable for this run; confirm the "
                "interpretation against the source before promotion.",
            )
        )
    return findings[:_MAX_KEY_FINDINGS]


def build_view_model(
    manifest: dict,
    *,
    recipient: str,
    title: str | None = None,
    sequence_number: int | None = None,
    blind_summary: str = "",
    claim_counts: dict[str, int | None] | None = None,
    claims: list[dict] | None = None,
    report_url: str = "",
    report_version: int = 1,
    report_sha256: str = "",
    reply_commands: bool = True,
) -> ViewModel:
    """Derive the single view model from a POTD case manifest + optional
    claim data. Everything both surfaces render comes from here."""
    grade = manifest.get("grader", {})
    counts = {
        "confirmed": None,
        "incorrect": None,
        "unsupported": None,
        "nuance": None,
    }
    if claim_counts:
        counts.update(claim_counts)

    verdict, promotion_blocked = _derive_verdict(manifest, grade, counts)
    health = _pipeline_health(manifest)

    dims = {
        "accuracy": grade.get("letter") or "n/a",
        "evidence": grade.get("letter") or "n/a",
        "honesty": "pass" if not grade.get("confident_misreads") else "review",
        "safety": "fail" if grade.get("safety_critical_misreads") else "pass",
        "rights": manifest.get("source_rights", "evaluation_only"),
    }

    # Reviewer actions. Phase 1 keeps reply-commands as the mechanism (no web
    # endpoints yet); the URL slots are present so Phase 2 fills signed links in.
    actions = {
        "approve": "reply:APPROVE CASE" if reply_commands else "",
        "correct": "reply:CORRECT CASE: <comment>" if reply_commands else "",
        "reject": "reply:REJECT CASE: <reason>" if reply_commands else "",
        "hold": "reply:HOLD CASE" if reply_commands else "",
        "report": report_url,
    }

    return ViewModel(
        schema=VIEW_MODEL_SCHEMA,
        case_id=manifest.get("case_id", ""),
        sequence_number=sequence_number,
        title=title or manifest.get("case_id", "Print of the Day"),
        evaluation_date=(manifest.get("generated_at") or "")[:10],
        verdict=verdict,
        verdict_label=VERDICT_LABELS[verdict],
        overall_grade=grade.get("letter"),
        claim_counts=counts,
        dimension_grades=dims,
        source={
            "sha256": (manifest.get("artifact_sha256") or {}).get("print.png")
            or manifest.get("selected_page_sha"),
            "rights_label": dims["rights"],
            "sheet_label": manifest.get("sheet_label"),
        },
        blind_summary=blind_summary,
        key_findings=_key_findings(grade, claims),
        pipeline_health=health,
        report={"version": report_version, "sha256": report_sha256, "url": report_url},
        actions=actions,
        promotion_blocked=promotion_blocked,
        template_versions={
            "email": EMAIL_TEMPLATE_VERSION,
            "report": REPORT_TEMPLATE_VERSION,
        },
        dedup_key=duplicate_send_key(
            manifest.get("case_id", ""), report_version, EMAIL_TEMPLATE_VERSION, recipient
        ),
    )
