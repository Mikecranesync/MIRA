"""Layer E — the reproducible grading report + the trust-status decision.

Assembles the results of Layers A-D (schema/cite/gold/domain) plus pack
metadata into one report, computes the final trust status **fail-closed,
worst-wins** (see ``GRADING_SPEC.md`` "Trust status"), and renders both a
machine-readable ``grading_report.json`` and a human-readable
``grading_report.md``.

This module never calls a wall-clock function itself — ``generated_at`` is a
plain string the caller supplies (``"unknown"`` by default), which keeps the
report byte-reproducible in tests and avoids sneaking in an implicit,
untestable "now".
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("drive-pack-extract.grading.report")

_STATUSES = {"pass", "fail", "skipped"}
_TRUST_STATUSES = ("rejected", "internal_only", "beta")


@dataclass
class LayerResult:
    """The uniform result shape every grading layer (A-D) returns.

    ``status`` is one of ``pass`` / ``fail`` / ``skipped`` — never a free-form
    string, so ``report.py`` can reason about it structurally. ``details`` is
    an itemized list of findings (one string per violation/note); ``metrics``
    carries whatever numeric/structured data downstream trust-status logic or
    the report needs (e.g. ``fault_count``, ``overall_recall``).
    """

    name: str
    status: str
    summary: str
    details: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.status not in _STATUSES:
            raise ValueError(
                f"LayerResult {self.name!r}: status must be one of {sorted(_STATUSES)}, "
                f"got {self.status!r}"
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "summary": self.summary,
            "details": self.details,
            "metrics": self.metrics,
        }


def _has_undeclared_gaps(gold_result: LayerResult, cite_result: LayerResult) -> bool:
    """A "gap" is any known shortfall a real gold/cite run can surface:
    incomplete overall gold recall, or an unverifiable (non-critical)
    citation. The trust table requires these be *declared* as residuals
    before a pack can reach ``beta`` — see GRADING_SPEC.md's "residuals
    declared" clause.
    """
    overall_recall = gold_result.metrics.get("overall_recall", 1.0)
    unverifiable = cite_result.metrics.get("unverifiable_count", 0)
    return overall_recall < 1.0 or unverifiable > 0


def compute_trust_status(
    *,
    schema_result: LayerResult,
    cite_result: LayerResult,
    gold_result: LayerResult,
    domain_result: LayerResult,
    residuals: list[str] | None = None,
) -> tuple[str, list[str]]:
    """Compute the trust status, fail-closed and worst-wins.

    Returns ``(status, reasons)`` where ``reasons`` is a human-readable list
    explaining exactly which criteria drove the decision (always non-empty —
    even a clean ``beta`` reports why it qualified). The harness NEVER emits
    ``trusted`` — GRADING_SPEC.md is explicit that promotion to ``trusted`` is
    "a documented human action, never automatic" (a recorded sign-off in
    ``runbook-pr-b-acceptance.md`` plus bench-verified data or an explicit
    waiver). The automated ceiling this function can reach is ``beta``.
    """
    residuals = residuals or []
    reasons: list[str] = []

    fabrication_detected = bool(gold_result.metrics.get("fabrication_detected", False))
    dropped_critical = cite_result.metrics.get("dropped_diagnostic_critical", [])
    dc_fault_recall = gold_result.metrics.get("diagnostic_critical_fault_recall", 1.0)
    dc_precision = gold_result.metrics.get("diagnostic_critical_precision", 1.0)
    overall_fault_recall = gold_result.metrics.get("overall_fault_recall", 1.0)

    # --- rejected: any hard failure, fail-closed -------------------------
    if schema_result.status == "fail":
        reasons.append(f"schema validation FAILED: {schema_result.summary}")
    if domain_result.status == "fail":
        reasons.append(f"domain-rule hard violation(s): {domain_result.summary}")
    if fabrication_detected:
        reasons.append("gold-set scoring found a fabricated value or a leaked param-id link")
    if dropped_critical:
        reasons.append(
            f"cite-integrity dropped diagnostic-critical citation(s): {sorted(set(dropped_critical))}"
        )
    if reasons:
        return "rejected", reasons

    # --- internal_only: automated checks pass, but coverage is incomplete
    gaps_present = _has_undeclared_gaps(gold_result, cite_result)
    undeclared = gaps_present and not residuals
    internal_reasons: list[str] = []
    if cite_result.status == "skipped":
        internal_reasons.append("cite-integrity did not run (manual not available)")
    if dc_fault_recall < 1.0:
        internal_reasons.append(f"diagnostic-critical fault recall {dc_fault_recall:.0%} < 100%")
    if undeclared:
        internal_reasons.append("residual gaps present but not declared via --residual")

    # --- beta: everything automated passes cleanly -----------------------
    beta_ok = (
        cite_result.status == "pass"
        and dc_precision >= 1.0
        and dc_fault_recall >= 1.0
        and overall_fault_recall >= 0.9
        and not undeclared
    )

    if internal_reasons or not beta_ok:
        if not internal_reasons:
            # beta_ok is False for a reason not already captured above.
            if dc_precision < 1.0:
                internal_reasons.append(f"diagnostic-critical precision {dc_precision:.0%} < 100%")
            if overall_fault_recall < 0.9:
                internal_reasons.append(f"overall fault recall {overall_fault_recall:.0%} < 90%")
        return "internal_only", internal_reasons

    reasons.append("schema + domain + cite-integrity all pass")
    reasons.append(f"diagnostic-critical precision {dc_precision:.0%}, fault recall 100%")
    reasons.append(f"overall fault recall {overall_fault_recall:.0%} >= 90%")
    reasons.append(
        "no undeclared residuals" if not gaps_present else f"residuals declared: {residuals}"
    )
    reasons.append(
        "automated ceiling is 'beta' — promotion to 'trusted' requires a recorded human "
        "sign-off (runbook-pr-b-acceptance.md), never automatic"
    )
    return "beta", reasons


def build_report(
    *,
    pack_id: str,
    pack_dict: dict[str, Any],
    schema_result: LayerResult,
    cite_result: LayerResult,
    gold_result: LayerResult,
    domain_result: LayerResult,
    manual_path: str | Path | None = None,
    manual_sha256: str | None = None,
    extractor_commit: str | None = None,
    extraction_command: str | None = None,
    residuals: list[str] | None = None,
    generated_at: str = "unknown",
) -> dict[str, Any]:
    """Assemble the full Layer E report dict (the source for both rendered
    files). Every field GRADING_SPEC.md's Layer E lists is present."""
    residuals = residuals or []
    status, reasons = compute_trust_status(
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
        residuals=residuals,
    )

    family = pack_dict.get("family", {})
    provenance_items = pack_dict.get("provenance", {}).get("items", {})
    bench_verified_live_decode = any(
        k.startswith("live_decode") and v == "bench_verified" for k, v in provenance_items.items()
    )

    return {
        "generated_at": generated_at,
        "pack": {
            "pack_id": pack_id,
            "manufacturer": family.get("manufacturer"),
            "series": family.get("series"),
            "schema_version": pack_dict.get("schema_version"),
        },
        "manual": {
            "path": str(manual_path) if manual_path else None,
            "sha256": manual_sha256,
        },
        "extractor_commit": extractor_commit,
        "extraction_command": extraction_command,
        "fault_count": schema_result.metrics.get("fault_count"),
        "parameter_count": schema_result.metrics.get("param_count"),
        "bench_verified_live_decode": bench_verified_live_decode,
        "layers": {
            "schema": schema_result.to_dict(),
            "cite_integrity": cite_result.to_dict(),
            "gold_score": gold_result.to_dict(),
            "domain_rules": domain_result.to_dict(),
        },
        "residuals": residuals,
        "trust_status": status,
        "trust_status_reasons": reasons,
    }


def _fmt_metrics(metrics: dict[str, Any]) -> str:
    if not metrics:
        return "(none)"
    return ", ".join(f"{k}={v}" for k, v in metrics.items())


def render_markdown(report: dict[str, Any]) -> str:
    """Render the human-readable ``grading_report.md`` from ``build_report``'s
    dict output."""
    lines: list[str] = []
    pack = report["pack"]
    manual = report["manual"]

    lines.append(f"# Drive-Pack Grading Report — {pack['pack_id']}")
    lines.append("")
    lines.append(f"Generated: {report['generated_at']}")
    lines.append("")
    lines.append(f"## Trust status: **{report['trust_status'].upper()}**")
    lines.append("")
    for reason in report["trust_status_reasons"]:
        lines.append(f"- {reason}")
    lines.append("")

    lines.append("## Pack")
    lines.append(f"- pack_id: `{pack['pack_id']}`")
    lines.append(f"- manufacturer / series: {pack.get('manufacturer')} / {pack.get('series')}")
    lines.append(f"- schema_version: {pack.get('schema_version')}")
    lines.append(f"- fault count: {report.get('fault_count')}")
    lines.append(f"- parameter count: {report.get('parameter_count')}")
    lines.append(f"- bench-verified live_decode: {report.get('bench_verified_live_decode')}")
    lines.append("")

    lines.append("## Source manual")
    lines.append(f"- path: {manual.get('path')}")
    lines.append(f"- sha256: {manual.get('sha256')}")
    lines.append(f"- extractor commit: {report.get('extractor_commit')}")
    lines.append(f"- extraction command: `{report.get('extraction_command')}`")
    lines.append("")

    lines.append("## Layers")
    for layer_name in ("schema", "cite_integrity", "gold_score", "domain_rules"):
        layer = report["layers"][layer_name]
        lines.append(f"### {layer_name} — {layer['status'].upper()}")
        lines.append(layer["summary"])
        if layer["details"]:
            lines.append("")
            for detail in layer["details"]:
                lines.append(f"- {detail}")
        lines.append("")
        lines.append(f"metrics: {_fmt_metrics(layer['metrics'])}")
        lines.append("")

    lines.append("## Residuals (declared)")
    if report["residuals"]:
        for residual in report["residuals"]:
            lines.append(f"- {residual}")
    else:
        lines.append("(none declared)")
    lines.append("")

    return "\n".join(lines)


def write_report(report: dict[str, Any], out_dir: str | Path) -> tuple[Path, Path]:
    """Write both ``grading_report.json`` and ``grading_report.md`` into
    ``out_dir`` (created if needed). Returns ``(json_path, md_path)``."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    json_path = out_path / "grading_report.json"
    md_path = out_path / "grading_report.md"

    json_path.write_text(json.dumps(report, indent=2, sort_keys=False), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")

    logger.info("wrote grading report: %s, %s", json_path, md_path)
    return json_path, md_path
