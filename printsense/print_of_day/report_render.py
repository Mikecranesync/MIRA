"""Print of the Day — full evidence report renderer.

PRD §10. The report is the CANONICAL record; the email is generated from the
same view model, never separately (PRD §19). Renders the 20 required sections
as Markdown (audit-friendly, diffable), HTML (authenticated viewing), and JSON
(machine-readable). The original blind interpretation is preserved verbatim and
is never overwritten by corrections (PRD §10 report behavior).

Pure: takes the view model + the raw manifest + optional deep sections; returns
strings. The report version + content hash are computed here.
"""

from __future__ import annotations

import hashlib
import json
from html import escape
from typing import Any

from .view_model import ViewModel

# The 20 canonical sections (PRD §10 "Required sections"), in order.
SECTIONS = (
    "Case identity and source metadata",
    "Rights and publication restrictions",
    "Source print or page references",
    "Blind interpretation",
    "Withheld answer key",
    "Claim-by-claim comparison",
    "Confirmed claims",
    "Incorrect claims",
    "Unsupported claims",
    "Nuanced or partially correct claims",
    "Safety analysis",
    "Corrected interpretation",
    "Reusable lessons",
    "Gold/promotion recommendation",
    "Reviewer decision history",
    "Pipeline-health details",
    "Model, prompt, grader, and tool versions",
    "Content hashes and provenance",
    "Attachments and derived artifacts",
    "Machine-readable structured result",
)


def _mk(section: str, body: str) -> str:
    return f"## {section}\n\n{body.strip() or '_Not available for this run._'}\n"


def render_markdown(
    vm: ViewModel,
    manifest: dict,
    *,
    answer_key: str = "",
    claims: list[dict] | None = None,
    corrected_interpretation: str = "",
    lessons: list[str] | None = None,
    decision_history: list[dict] | None = None,
) -> str:
    """The canonical Markdown report — all 20 sections, always in order."""
    claims = claims or []
    prov = manifest.get("provenance", {})
    provider = manifest.get("provider", {})
    grade = manifest.get("grader", {})
    ocr = manifest.get("ocr", {})
    health = vm.pipeline_health

    def _claim_rows(status: str) -> str:
        rows = [c for c in claims if c.get("status") == status]
        if not rows:
            return ""
        return "\n".join(f"- {c.get('text', '')}" for c in rows)

    parts = [f"# Print of the Day — {vm.title} ({vm.case_id})\n"]
    parts.append(
        f"**Verdict:** {vm.verdict_label} · **Grade:** {vm.overall_grade or 'n/a'} · "
        f"**Report version:** {vm.report['version']} · **Generated:** {manifest.get('generated_at', '')}\n"
    )

    parts.append(
        _mk(
            SECTIONS[0],
            f"- case_id: `{vm.case_id}`\n- title: {vm.title}\n- evaluation_date: {vm.evaluation_date}\n"
            f"- sequence: {vm.sequence_number}",
        )
    )
    parts.append(
        _mk(
            SECTIONS[1],
            f"- rights: **{vm.dimension_grades['rights']}**\n- source_url present: {bool(manifest.get('source_url'))}",
        )
    )
    parts.append(
        _mk(
            SECTIONS[2],
            f"- selected_page_sha256: `{manifest.get('selected_page_sha')}`\n"
            f"- graded_page_sha256: `{manifest.get('graded_page_sha')}`\n"
            f"- sheet_label: {vm.source.get('sheet_label')}",
        )
    )
    parts.append(
        _mk(
            SECTIONS[3],
            f"_Preserved verbatim; never overwritten by corrections._\n\n{vm.blind_summary}",
        )
    )
    parts.append(_mk(SECTIONS[4], answer_key))
    parts.append(
        _mk(
            SECTIONS[5],
            "\n".join(f"- **{c.get('status', '?')}**: {c.get('text', '')}" for c in claims),
        )
    )
    parts.append(_mk(SECTIONS[6], _claim_rows("CONFIRMED")))
    parts.append(_mk(SECTIONS[7], _claim_rows("INCORRECT")))
    parts.append(_mk(SECTIONS[8], _claim_rows("UNSUPPORTED")))
    parts.append(_mk(SECTIONS[9], _claim_rows("PARTIALLY_CORRECT") + "\n" + _claim_rows("NUANCE")))
    parts.append(
        _mk(
            SECTIONS[10],
            f"- safety verdict: **{vm.dimension_grades['safety']}**\n"
            f"- safety-critical misreads: {grade.get('safety_critical_misreads', [])}",
        )
    )
    parts.append(_mk(SECTIONS[11], corrected_interpretation))
    parts.append(_mk(SECTIONS[12], "\n".join(f"- {x}" for x in (lessons or []))))
    parts.append(
        _mk(
            SECTIONS[13],
            f"- verdict: **{vm.verdict_label}**\n- promotion_blocked: {vm.promotion_blocked}\n"
            f"- gold_eligible (fail-closed): {manifest.get('gold_eligible')}",
        )
    )
    parts.append(
        _mk(
            SECTIONS[14],
            "\n".join(
                f"- {d.get('timestamp', '')}: {d.get('decision', '')} by {d.get('reviewer', '')} "
                f"(report v{d.get('report_version', '')}, hash `{d.get('report_hash', '')}`)"
                for d in (decision_history or [])
            ),
        )
    )
    parts.append(
        _mk(
            SECTIONS[15],
            f"- status: **{health['status']}**\n- judge: {health['judge']}\n"
            f"- ocr_crosscheck: {health['ocr_crosscheck']}\n"
            + "".join(f"- {m}\n" for m in health["messages"]),
        )
    )
    parts.append(
        _mk(
            SECTIONS[16],
            f"- interpreter provider/model: {provider.get('resolved')} / {provider.get('model')}\n"
            f"- responded model: {provider.get('responded_model')}\n"
            f"- endpoint: {provider.get('endpoint_class')}\n"
            f"- grader import_verdict: {grade.get('import_verdict')}\n"
            f"- tesseract: {ocr.get('tesseract_version')} · pytesseract: {ocr.get('pytesseract_version')}",
        )
    )
    parts.append(
        _mk(
            SECTIONS[17],
            f"- git_sha: `{prov.get('git_sha')}`\n- git_dirty: {prov.get('git_dirty')}\n"
            f"- image_revision: `{prov.get('image_revision')}`",
        )
    )
    parts.append(
        _mk(
            SECTIONS[18],
            "\n".join(
                f"- `{name}`: `{sha}`"
                for name, sha in (manifest.get("artifact_sha256") or {}).items()
            ),
        )
    )
    parts.append(
        _mk(
            SECTIONS[19], "```json\n" + json.dumps(vm.to_dict(), indent=2, sort_keys=True) + "\n```"
        )
    )
    return "\n".join(parts)


def report_version_hash(markdown: str) -> str:
    """Content hash of a rendered report (PRD §10 'content-addressed')."""
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def render_html(vm: ViewModel, markdown: str) -> str:
    """Minimal authenticated-HTML wrapper over the canonical Markdown (escaped;
    the report is data, not a rich app)."""
    return (
        "<!doctype html><meta charset='utf-8'>"
        f"<title>Print of the Day — {escape(vm.title)}</title>"
        "<div style='max-width:840px;margin:0 auto;padding:24px;"
        "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'>"
        f"<pre style='white-space:pre-wrap;font:14px/1.5 ui-monospace,monospace;'>{escape(markdown)}</pre>"
        "</div>"
    )


def render_json(vm: ViewModel, manifest: dict) -> dict[str, Any]:
    """Downloadable machine-readable result (PRD §10 section 20)."""
    return {"view_model": vm.to_dict(), "manifest": manifest}
