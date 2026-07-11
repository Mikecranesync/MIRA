"""Scientific grading rubric — a deterministic, weighted 0-100 / A-F score.

Implements `Drive_Pack_Scientific_Grading_Spec` on TOP of the existing five-layer
harness (schema / cite / gold / domain — `grade.py`), which stays the
measurement engine. This module adds only the *scoring*: it turns the layers'
metrics + the pack/gold comparison into eight weighted category scores, an
overall score, a letter grade, the critical-failure list, and a promotion
recommendation. It never re-implements a measurement — schema validity comes
from the real runtime loader (`schema_check`), citation fidelity from
`cite_check`, domain quality from `domain_rules`, and the gold comparison reuses
`gold_score`'s own normalization (`_norm`/`_norm_set`) so "0 \"Fault\"" and
"0 fault" compare equal exactly as the trust-status path does.

Doctrine (spec): *No drive pack is promoted on subjective review alone. Grade
before promote. Every production pack must be scientifically traceable to its OEM
documentation.* The existing `beta`/`trusted` trust-status is unchanged and
COMPLEMENTS this grade — the letter band maps onto the same promotion policy.

Hard gates (any failure → grade **F**, not promotable): schema validity, runtime
compatibility (both proven by loading through the production loader), and
provenance presence. N/A handling: a pack with no gold set cannot be scored on
coverage/accuracy (categories 2-6 become N/A and are excluded from the weighted
average) — the result is flagged INCOMPLETE and is not promotable until the
missing evidence (a gold set, or the manual for citation fidelity) exists. That
"cannot be scored" verdict is itself a scientific finding.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from gold_score import _fault_codes_by_int, _norm, _norm_set
from report import LayerResult

# --- category weights (spec) ------------------------------------------------
# The spec's eight weights sum to 120, not 100; the overall score is therefore a
# weighted AVERAGE — Σ(score·weight) / Σ(weight over gradeable categories) — which
# normalizes the 120 cleanly and, crucially, renormalizes when an N/A category is
# excluded (no gold / no manual) instead of silently scoring it zero.
WEIGHTS: dict[str, int] = {
    "provenance_traceability": 10,
    "fault_coverage_precision": 20,
    "fault_field_accuracy": 20,
    "parameter_coverage_precision": 20,
    "parameter_field_accuracy": 15,
    "relationship_accuracy": 10,
    "citation_fidelity": 15,
    "safety_usability": 10,
}

CATEGORY_NAMES: dict[str, str] = {
    "provenance_traceability": "Manual provenance and traceability",
    "fault_coverage_precision": "Fault coverage and precision",
    "fault_field_accuracy": "Fault field accuracy",
    "parameter_coverage_precision": "Parameter coverage and precision",
    "parameter_field_accuracy": "Parameter field accuracy",
    "relationship_accuracy": "Relationship accuracy",
    "citation_fidelity": "Citation fidelity",
    "safety_usability": "Safety and technician usability",
}

# categories that need a gold set (coverage/accuracy/relationship)
_GOLD_CATEGORIES = frozenset(
    {
        "fault_coverage_precision",
        "fault_field_accuracy",
        "parameter_coverage_precision",
        "parameter_field_accuracy",
        "relationship_accuracy",
    }
)

# --- grade bands (spec) -----------------------------------------------------
_BANDS = (  # (min_score, letter, meaning)
    (92, "A", "Production-ready after human sign-off"),
    (82, "B", "Beta; waiver required for promotion"),
    (70, "C", "Candidate only; remain staged"),
    (50, "D", "Research only"),
    (0, "F", "Failed; not promotable"),
)


def band_for(score: float) -> tuple[str, str]:
    for threshold, letter, meaning in _BANDS:
        if score >= threshold:
            return letter, meaning
    return "F", "Failed; not promotable"  # pragma: no cover — 0 floor covers all


@dataclass
class CategoryScore:
    key: str
    name: str
    weight: int
    score: float | None  # 0-100, or None when Not Applicable (no gold / no manual)
    findings: list[str] = field(default_factory=list)

    @property
    def gradeable(self) -> bool:
        return self.score is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "weight": self.weight,
            "score": None if self.score is None else round(self.score, 1),
            "gradeable": self.gradeable,
            "findings": self.findings,
        }


# ---------------------------------------------------------------------------
# Gold-dependent primitives (computed once, reused by categories 2-6)
# ---------------------------------------------------------------------------
_FIELD_KEYS = ("name", "range", "default")


def _gold_primitives(pack: dict[str, Any], gold: dict[str, Any]) -> dict[str, Any]:
    """One pass over pack+gold producing the raw counts every gold-dependent
    category needs. Uses gold_score's `_norm`/`_norm_set` so comparisons match
    the trust-status path exactly."""
    fault_codes = _fault_codes_by_int(pack)
    params_by_id = {
        p.get("parameter_id"): p for p in pack.get("parameters", []) or [] if p.get("parameter_id")
    }
    all_param_ids = set(params_by_id)

    gold_faults = gold.get("faults", []) or []
    gold_params = gold.get("parameters", []) or []

    # --- faults: presence + name accuracy + fault->param link accuracy ------
    fault_total = len(gold_faults)
    fault_present = fault_name_correct = 0
    link_total = link_correct = 0
    for gf in gold_faults:
        code = gf["code"]
        if code in fault_codes:
            fault_present += 1
            if _norm(fault_codes[code]) == _norm(gf["name"]):
                fault_name_correct += 1
        for ref in gf.get("references_parameters", []) or []:
            link_total += 1
            linked = params_by_id.get(ref)
            if linked and _norm(gf["fault_id"]) in _norm_set(linked.get("related_faults")):
                link_correct += 1

    # --- params: presence + per-field accuracy + relationships --------------
    param_total = len(gold_params)
    param_present = 0
    field_graded = field_correct = 0
    rel_total = rel_correct = 0  # related_parameters (gold-floor) + related_faults exact
    for gp in gold_params:
        pid = gp["parameter_id"]
        pack_p = params_by_id.get(pid)
        if pack_p is None:
            continue
        param_present += 1
        for key in _FIELD_KEYS:
            gold_v = gp.get(key)
            if gold_v is None:
                continue  # gold has no opinion on this field
            field_graded += 1
            if _norm(pack_p.get(key)) == _norm(gold_v):
                field_correct += 1
        # related_parameters — each expected entry is a gold-floor recall item
        for expected in gp.get("related_parameters", []) or []:
            rel_total += 1
            if _norm(expected) in _norm_set(pack_p.get("related_parameters")):
                rel_correct += 1
        # related_faults — exact-set match (extra = wrong, missing = gap)
        gold_rf = _norm_set(gp.get("related_faults"))
        if gold_rf:
            pack_rf = _norm_set(pack_p.get("related_faults"))
            rel_total += len(gold_rf)
            rel_correct += len(gold_rf & pack_rf) - len(pack_rf - gold_rf)  # penalize extras

    # --- precision-side signals (pack entries that shouldn't exist) ---------
    pack_fault_count = len(fault_codes)
    pack_param_count = len(params_by_id)
    # a leaked param id in any related_faults is the relationship fabrication
    rel_leaks = 0
    for p in params_by_id.values():
        for rf in p.get("related_faults", []) or []:
            if rf in all_param_ids:
                rel_leaks += 1

    return {
        "fault_total": fault_total,
        "fault_present": fault_present,
        "fault_name_correct": fault_name_correct,
        "link_total": link_total,
        "link_correct": link_correct,
        "param_total": param_total,
        "param_present": param_present,
        "field_graded": field_graded,
        "field_correct": field_correct,
        "rel_total": rel_total,
        "rel_correct": max(0, rel_correct),
        "rel_leaks": rel_leaks,
        "pack_fault_count": pack_fault_count,
        "pack_param_count": pack_param_count,
    }


def _ratio(num: int, den: int, *, empty: float = 1.0) -> float:
    return empty if den == 0 else max(0.0, min(1.0, num / den))


# ---------------------------------------------------------------------------
# Category scorers
# ---------------------------------------------------------------------------
def _score_provenance(pack: dict[str, Any]) -> CategoryScore:
    findings: list[str] = []
    provenance = pack.get("provenance", {}) or {}
    items = provenance.get("items") or {}
    sources = provenance.get("sources") or []
    params = pack.get("parameters", []) or []

    items_ok = bool(items) and all(
        tier in {"bench_verified", "manual_cited"} for tier in items.values()
    )
    if not items_ok:
        findings.append("provenance.items missing or carries an invalid tier")
    sources_ok = any((s.get("page") not in (None, "")) and s.get("excerpt") for s in sources)
    if not sources_ok:
        findings.append("provenance.sources missing page+excerpt evidence")

    cited_params = sum(
        1
        for p in params
        if (p.get("source_citation") or {}).get("excerpt")
        and (p.get("source_citation") or {}).get("page") not in (None, "")
    )
    param_ratio = _ratio(cited_params, len(params))
    if params and cited_params < len(params):
        findings.append(f"{len(params) - cited_params}/{len(params)} parameters lack a full citation")

    source_ratio = _ratio(
        sum(1 for s in sources if s.get("page") not in (None, "") and s.get("excerpt")),
        len(sources),
        empty=0.0 if not sources else 1.0,
    )

    score = 100.0 * (
        0.25 * (1.0 if items_ok else 0.0)
        + 0.25 * (1.0 if sources_ok else 0.0)
        + 0.25 * param_ratio
        + 0.25 * source_ratio
    )
    return CategoryScore("provenance_traceability", CATEGORY_NAMES["provenance_traceability"], 10, score, findings)


def _score_fault_coverage(prim: dict[str, Any], junk_faults: int) -> CategoryScore:
    findings: list[str] = []
    recall = _ratio(prim["fault_present"], prim["fault_total"])
    precision = _ratio(prim["pack_fault_count"] - junk_faults, prim["pack_fault_count"])
    if prim["fault_present"] < prim["fault_total"]:
        findings.append(
            f"fault coverage: {prim['fault_present']}/{prim['fault_total']} gold faults present"
        )
    if junk_faults:
        findings.append(f"{junk_faults} pack fault name(s) look like header/footer junk")
    score = 100.0 * (0.6 * recall + 0.4 * precision)
    return CategoryScore(
        "fault_coverage_precision", CATEGORY_NAMES["fault_coverage_precision"], 20, score, findings
    )


def _score_fault_fields(prim: dict[str, Any]) -> CategoryScore:
    findings: list[str] = []
    name_acc = _ratio(prim["fault_name_correct"], prim["fault_present"])
    link_acc = _ratio(prim["link_correct"], prim["link_total"])
    if prim["fault_name_correct"] < prim["fault_present"]:
        findings.append(
            f"fault name accuracy: {prim['fault_name_correct']}/{prim['fault_present']} present faults named correctly"
        )
    if prim["link_correct"] < prim["link_total"]:
        findings.append(
            f"fault->param link accuracy: {prim['link_correct']}/{prim['link_total']} gold links present"
        )
    # names dominate; the cross-ref link is the diagnostic payoff
    score = 100.0 * (0.7 * name_acc + 0.3 * link_acc)
    return CategoryScore(
        "fault_field_accuracy", CATEGORY_NAMES["fault_field_accuracy"], 20, score, findings
    )


def _score_param_coverage(prim: dict[str, Any], bad_param_ids: int) -> CategoryScore:
    findings: list[str] = []
    recall = _ratio(prim["param_present"], prim["param_total"])
    precision = _ratio(prim["pack_param_count"] - bad_param_ids, prim["pack_param_count"])
    if prim["param_present"] < prim["param_total"]:
        findings.append(
            f"param coverage: {prim['param_present']}/{prim['param_total']} gold params present"
        )
    if bad_param_ids:
        findings.append(f"{bad_param_ids} pack parameter id(s) malformed or duplicated")
    score = 100.0 * (0.6 * recall + 0.4 * precision)
    return CategoryScore(
        "parameter_coverage_precision",
        CATEGORY_NAMES["parameter_coverage_precision"],
        20,
        score,
        findings,
    )


def _score_param_fields(prim: dict[str, Any]) -> CategoryScore:
    findings: list[str] = []
    acc = _ratio(prim["field_correct"], prim["field_graded"])
    if prim["field_correct"] < prim["field_graded"]:
        findings.append(
            f"param field accuracy: {prim['field_correct']}/{prim['field_graded']} graded fields match gold"
        )
    score = 100.0 * acc
    return CategoryScore(
        "parameter_field_accuracy", CATEGORY_NAMES["parameter_field_accuracy"], 15, score, findings
    )


def _score_relationships(prim: dict[str, Any]) -> CategoryScore:
    findings: list[str] = []
    acc = _ratio(prim["rel_correct"], prim["rel_total"])
    if prim["rel_correct"] < prim["rel_total"]:
        findings.append(
            f"relationship accuracy: {prim['rel_correct']}/{prim['rel_total']} gold relationship items correct"
        )
    score = 100.0 * acc
    if prim["rel_leaks"]:
        findings.append(
            f"{prim['rel_leaks']} parameter id(s) leaked into related_faults — capped to 0"
        )
        score = 0.0  # a leaked param-id link is the relationship fabrication — floor it
    return CategoryScore(
        "relationship_accuracy", CATEGORY_NAMES["relationship_accuracy"], 10, score, findings
    )


def _score_citation(cite_result: LayerResult) -> CategoryScore:
    findings: list[str] = []
    if cite_result.status == "skipped":
        findings.append("manual not available — citation fidelity could not be measured")
        return CategoryScore(
            "citation_fidelity", CATEGORY_NAMES["citation_fidelity"], 15, None, findings
        )
    verified = cite_result.metrics.get("verified_count", 0)
    unverifiable = cite_result.metrics.get("unverifiable_count", 0)
    dropped = cite_result.metrics.get("dropped_diagnostic_critical", []) or []
    ratio = _ratio(verified, verified + unverifiable)
    score = 100.0 * ratio
    if unverifiable:
        findings.append(f"{unverifiable} citation(s) did not verify verbatim on their page")
    if dropped:
        findings.append(f"DIAGNOSTIC-CRITICAL citation(s) dropped: {sorted(set(dropped))} — capped")
        score = min(score, 30.0)  # a dropped critical cite is a critical failure
    return CategoryScore(
        "citation_fidelity", CATEGORY_NAMES["citation_fidelity"], 15, score, findings
    )


def _score_safety(domain_result: LayerResult, pack: dict[str, Any]) -> CategoryScore:
    findings: list[str] = list(domain_result.details)
    violations = len(domain_result.details)
    # each domain violation is a usability/safety smudge; -15 apiece, floored.
    score = 100.0 if violations == 0 else max(0.0, 100.0 - 15.0 * violations)
    # keypad cards must always carry a view-only warning (read-only-first doctrine)
    for kp in pack.get("keypad_navigation", []) or []:
        if not (kp.get("view_only_warning") or "").strip():
            findings.append(f"keypad card goal={kp.get('goal')!r} missing view_only_warning")
            score = min(score, 50.0)
    return CategoryScore("safety_usability", CATEGORY_NAMES["safety_usability"], 10, score, findings)


# ---------------------------------------------------------------------------
# Hard gates + critical failures + overall assembly
# ---------------------------------------------------------------------------
def _hard_gates(schema_result: LayerResult, pack: dict[str, Any]) -> list[dict[str, Any]]:
    schema_ok = schema_result.status == "pass"
    provenance = pack.get("provenance", {}) or {}
    items = provenance.get("items") or {}
    prov_ok = bool(items) and all(
        t in {"bench_verified", "manual_cited"} for t in items.values()
    )
    return [
        {
            "key": "schema_validity",
            "passed": schema_ok,
            "detail": schema_result.summary,
        },
        {
            "key": "runtime_compatibility",
            "passed": schema_ok,  # proven by loading through the production loader
            "detail": "pack loads + validates through the runtime drive_packs loader"
            if schema_ok
            else "pack does not load through the runtime loader",
        },
        {
            "key": "provenance_present",
            "passed": prov_ok,
            "detail": "provenance.items present with valid tiers"
            if prov_ok
            else "provenance.items missing or carries an invalid tier",
        },
    ]


def grade_scientifically(
    *,
    pack_id: str,
    pack_dict: dict[str, Any],
    gold_dict: dict[str, Any] | None,
    schema_result: LayerResult,
    cite_result: LayerResult,
    gold_result: LayerResult,
    domain_result: LayerResult,
    generated_at: str = "unknown",
) -> dict[str, Any]:
    """Assemble the full scientific grading report dict (source for JSON + MD)."""
    # domain-derived precision signals (gold-independent)
    junk_faults = sum(1 for d in domain_result.details if "junk name" in d)
    bad_param_ids = sum(
        1 for d in domain_result.details if "does not match" in d or "duplicate" in d
    )

    categories: list[CategoryScore] = [_score_provenance(pack_dict)]

    if gold_dict is not None:
        prim = _gold_primitives(pack_dict, gold_dict)
        categories.extend(
            [
                _score_fault_coverage(prim, junk_faults),
                _score_fault_fields(prim),
                _score_param_coverage(prim, bad_param_ids),
                _score_param_fields(prim),
                _score_relationships(prim),
            ]
        )
    else:
        for key in (
            "fault_coverage_precision",
            "fault_field_accuracy",
            "parameter_coverage_precision",
            "parameter_field_accuracy",
            "relationship_accuracy",
        ):
            categories.append(
                CategoryScore(key, CATEGORY_NAMES[key], WEIGHTS[key], None, ["no gold set for this pack"])
            )

    categories.append(_score_citation(cite_result))
    categories.append(_score_safety(domain_result, pack_dict))

    # --- overall = weighted average over GRADEABLE categories ---------------
    gradeable = [c for c in categories if c.gradeable]
    weight_sum = sum(c.weight for c in gradeable)
    overall = (
        sum(c.score * c.weight for c in gradeable) / weight_sum if weight_sum else 0.0
    )
    na_categories = [c.key for c in categories if not c.gradeable]
    incomplete = bool(na_categories)

    letter, meaning = band_for(overall)

    # --- critical failures (block promotion) --------------------------------
    hard_gates = _hard_gates(schema_result, pack_dict)
    critical: list[str] = []
    for g in hard_gates:
        if not g["passed"]:
            critical.append(f"hard gate '{g['key']}' FAILED: {g['detail']}")
    if gold_result.metrics.get("fabrication_detected"):
        critical.append("gold-set fabrication: a pack value contradicts gold or a param-id leaked into related_faults")
    dropped = cite_result.metrics.get("dropped_diagnostic_critical", []) or []
    if dropped:
        critical.append(f"diagnostic-critical citation dropped: {sorted(set(dropped))}")
    if gold_dict is not None:
        dc_fault_recall = gold_result.metrics.get("diagnostic_critical_fault_recall", 1.0)
        if dc_fault_recall < 1.0:
            critical.append(f"diagnostic-critical fault recall {dc_fault_recall:.0%} < 100%")
    if domain_result.status == "fail":
        critical.append(f"domain hard violation(s): {domain_result.summary}")

    hard_gate_failed = any(not g["passed"] for g in hard_gates)
    if hard_gate_failed:
        letter, meaning = "F", "Failed; not promotable"

    # --- promotion recommendation -------------------------------------------
    recommendation, promotable = _promotion(letter, critical, incomplete, na_categories)

    return {
        "generated_at": generated_at,
        "pack_id": pack_id,
        "manufacturer": (pack_dict.get("family") or {}).get("manufacturer"),
        "series": (pack_dict.get("family") or {}).get("series"),
        "schema_version": pack_dict.get("schema_version"),
        "overall_score": round(overall, 1),
        "grade": letter,
        "grade_meaning": meaning,
        "incomplete": incomplete,
        "not_applicable_categories": na_categories,
        "categories": [c.to_dict() for c in categories],
        "hard_gates": hard_gates,
        "critical_failures": critical,
        "fault_recall": _pct(gold_result.metrics.get("overall_fault_recall")) if gold_dict else None,
        "fault_precision": _pct(gold_result.metrics.get("overall_precision")) if gold_dict else None,
        "parameter_recall": _pct(gold_result.metrics.get("overall_recall")) if gold_dict else None,
        "diagnostic_critical_precision": _pct(gold_result.metrics.get("diagnostic_critical_precision")) if gold_dict else None,
        "citation_accuracy": _citation_accuracy(cite_result),
        "missing_evidence": _missing_evidence(gold_dict, cite_result),
        "promotable": promotable,
        "promotion_recommendation": recommendation,
        # the existing trust-status path is unchanged and complements this grade
        "note": "COMPLEMENTS the beta/trusted trust-status (grade.py); does not replace it.",
    }


def _pct(value: float | None) -> float | None:
    return None if value is None else round(100.0 * value, 1)


def _citation_accuracy(cite_result: LayerResult) -> float | None:
    if cite_result.status == "skipped":
        return None
    v = cite_result.metrics.get("verified_count", 0)
    u = cite_result.metrics.get("unverifiable_count", 0)
    return round(100.0 * _ratio(v, v + u), 1)


def _missing_evidence(gold_dict: dict[str, Any] | None, cite_result: LayerResult) -> list[str]:
    missing: list[str] = []
    if gold_dict is None:
        missing.append("gold set (author gold/<family>/gold.json) — coverage/accuracy unscored")
    if cite_result.status == "skipped":
        missing.append("source manual PDF — citation fidelity unscored")
    return missing


def _promotion(
    letter: str, critical: list[str], incomplete: bool, na_categories: list[str]
) -> tuple[str, bool]:
    if critical:
        return (
            f"NOT PROMOTABLE — {len(critical)} unresolved critical failure(s) must be fixed first.",
            False,
        )
    if incomplete:
        return (
            "NOT PROMOTABLE (INCOMPLETE) — missing evidence prevents a full scientific grade; "
            f"un-graded categories: {na_categories}. Provide the missing evidence, then re-grade.",
            False,
        )
    if letter == "A":
        return ("PROMOTABLE after recorded human sign-off (grade A).", True)
    if letter == "B":
        return ("PROMOTABLE with a recorded human sign-off AND a documented waiver (grade B / beta).", True)
    if letter == "C":
        return ("STAGE ONLY — candidate quality (grade C); do not promote.", False)
    return (f"NOT PROMOTABLE — grade {letter}.", False)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def render_scientific_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# Drive-Pack Scientific Grade — {report['pack_id']}")
    lines.append("")
    lines.append(f"Generated: {report['generated_at']}")
    lines.append("")
    incomplete = " (INCOMPLETE)" if report["incomplete"] else ""
    lines.append(f"## Grade: **{report['grade']} — {report['overall_score']}/100**{incomplete}")
    lines.append(f"_{report['grade_meaning']}_")
    lines.append("")
    lines.append(f"**Promotion:** {report['promotion_recommendation']}")
    lines.append("")

    lines.append("## Pack")
    lines.append(f"- pack_id: `{report['pack_id']}`")
    lines.append(f"- manufacturer / series: {report['manufacturer']} / {report['series']}")
    lines.append(f"- schema_version: {report['schema_version']}")
    lines.append("")

    lines.append("## Hard gates")
    for g in report["hard_gates"]:
        mark = "✅" if g["passed"] else "❌"
        lines.append(f"- {mark} **{g['key']}** — {g['detail']}")
    lines.append("")

    lines.append("## Category scores (weighted average over gradeable categories)")
    lines.append("")
    lines.append("| Category | Weight | Score |")
    lines.append("|---|---:|---:|")
    for c in report["categories"]:
        score = "N/A" if c["score"] is None else f"{c['score']:.1f}"
        lines.append(f"| {c['name']} | {c['weight']} | {score} |")
    lines.append("")
    for c in report["categories"]:
        if c["findings"]:
            lines.append(f"**{c['name']}** ({'N/A' if c['score'] is None else c['score']}):")
            for finding in c["findings"]:
                lines.append(f"- {finding}")
            lines.append("")

    lines.append("## Key metrics")
    lines.append(f"- Fault recall: {_fmt_pct(report['fault_recall'])}")
    lines.append(f"- Fault precision: {_fmt_pct(report['fault_precision'])}")
    lines.append(f"- Parameter recall: {_fmt_pct(report['parameter_recall'])}")
    lines.append(f"- Diagnostic-critical precision: {_fmt_pct(report['diagnostic_critical_precision'])}")
    lines.append(f"- Citation accuracy: {_fmt_pct(report['citation_accuracy'])}")
    lines.append("")

    lines.append("## Critical failures")
    if report["critical_failures"]:
        for cf in report["critical_failures"]:
            lines.append(f"- ❌ {cf}")
    else:
        lines.append("- ✅ none")
    lines.append("")

    lines.append("## Missing evidence")
    if report["missing_evidence"]:
        for m in report["missing_evidence"]:
            lines.append(f"- {m}")
    else:
        lines.append("- none")
    lines.append("")
    lines.append(f"> {report['note']}")
    lines.append("")
    return "\n".join(lines)


def _fmt_pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.1f}%"
