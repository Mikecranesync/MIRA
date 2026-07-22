"""Print of the Day v2 — structured view model (PRD section 13.3).

ONE view model that both the mobile-first email (v2) and the full evidence report
render from, so the two can never disagree (PRD 19). Pure data + validation:
no network, no email, no I/O.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

TEMPLATE_VERSION = "v2"

# PRD 14 status treatments — (label, shape/glyph). Status is carried by TEXT + a
# shape, never color alone (accessibility; .claude/rules/ui-style.md).
VERDICTS: dict[str, tuple[str, str]] = {
    "gold_candidate": ("Gold Candidate", "◆"),
    "approved_gold": ("Approved Gold", "★"),
    "correction_required": ("Correction Required", "▲"),
    "hold_for_review": ("Hold for Review", "▮"),
    "rejected": ("Rejected", "✕"),
    "unreadable": ("Unreadable", "▢"),
    "unsafe": ("Unsafe", "⚠"),
    "rights_blocked": ("Rights Blocked", "⦸"),
    "pipeline_degraded": ("Pipeline Degraded", "◐"),
}

REQUIRED_CLAIM_KEYS = ("confirmed", "incorrect", "unsupported", "nuance")
MAX_KEY_FINDINGS = 3  # FR-4: the main email shows no more than three findings.


@dataclass(frozen=True)
class Finding:
    type: str
    title: str
    summary: str


@dataclass(frozen=True)
class PODViewModel:
    case_id: str
    sequence_number: int
    title: str
    evaluation_date: str
    verdict: str
    overall_grade: str
    claim_counts: dict
    dimension_grades: dict
    source: dict
    blind_summary: str
    key_findings: tuple
    pipeline_health: dict
    report: dict
    template_version: str = TEMPLATE_VERSION

    def verdict_label(self) -> str:
        return VERDICTS[self.verdict][0]

    def verdict_glyph(self) -> str:
        return VERDICTS[self.verdict][1]

    def send_key(self, recipient: str) -> str:
        """FR-8 durable send key: sha256(case + report_version + template_version + recipient)."""
        raw = f"{self.case_id}|{self.report.get('version')}|{self.template_version}|{recipient}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_view_model(
    *, case_id, sequence_number, title, evaluation_date, verdict, overall_grade,
    claim_counts, dimension_grades, source, blind_summary, key_findings,
    pipeline_health, report, template_version=TEMPLATE_VERSION,
) -> PODViewModel:
    if verdict not in VERDICTS:
        raise ValueError(f"unknown verdict {verdict!r}; expected one of {sorted(VERDICTS)}")
    missing = [k for k in REQUIRED_CLAIM_KEYS if k not in claim_counts]
    if missing:
        raise ValueError(f"claim_counts missing keys: {missing}")
    if len(key_findings) > MAX_KEY_FINDINGS:
        raise ValueError(f"key_findings has {len(key_findings)} > {MAX_KEY_FINDINGS} (FR-4)")
    findings = tuple(
        f if isinstance(f, Finding) else Finding(f["type"], f["title"], f["summary"])
        for f in key_findings
    )
    return PODViewModel(
        case_id=case_id, sequence_number=sequence_number, title=title,
        evaluation_date=evaluation_date, verdict=verdict, overall_grade=overall_grade,
        claim_counts=dict(claim_counts), dimension_grades=dict(dimension_grades),
        source=dict(source), blind_summary=blind_summary, key_findings=findings,
        pipeline_health=dict(pipeline_health), report=dict(report),
        template_version=template_version,
    )
