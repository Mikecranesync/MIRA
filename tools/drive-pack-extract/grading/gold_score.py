"""Layer C — score a candidate pack against a human-approved gold set.

Precision over recall: the gold set is a curated subset (GRADING_SPEC.md),
so grading only judges the intersection between what the pack claims and
what gold has an opinion on. A gold entry the pack lacks is a recall miss; a
pack entry that CONTRADICTS a gold value is a fabrication (hard fail).
"""

from __future__ import annotations

import re
from typing import Any

from report import LayerResult

_WHITESPACE_RE = re.compile(r"\s+")
_FAULT_ID_RE = re.compile(r"^F\d+$", re.IGNORECASE)


def _norm(value: Any) -> str | None:
    """Normalize a value for comparison: None stays None; everything else is
    stringified, whitespace-collapsed, quote-stripped, and lowercased — so
    ``0 "Fault"`` and ``0 'fault'`` compare equal."""
    if value is None:
        return None
    text = _WHITESPACE_RE.sub(" ", str(value)).strip().strip("\"'").lower()
    return text or None


def _norm_set(values: list[str] | None) -> set[str]:
    return {n for n in (_norm(v) for v in (values or [])) if n is not None}


def _fault_codes_by_int(pack_dict: dict[str, Any]) -> dict[int, str]:
    raw = pack_dict.get("live_decode", {}).get("fault_codes", {}) or {}
    out: dict[int, str] = {}
    for key, value in raw.items():
        try:
            out[int(key)] = value
        except (TypeError, ValueError):
            continue
    return out


def _score_faults(
    gold_faults: list[dict[str, Any]],
    fault_codes: dict[int, str],
    params_by_id: dict[str, dict[str, Any]],
    details: list[str],
) -> dict[str, Any]:
    total = present = correct = 0
    dc_total = dc_present = dc_correct = 0
    fabrication = False

    for gf in gold_faults:
        code = gf["code"]
        name = gf["name"]
        fid = gf["fault_id"]
        dc = bool(gf.get("diagnostic_critical", False))
        total += 1
        if dc:
            dc_total += 1

        if code not in fault_codes:
            details.append(f"fault {fid} (code {code}): missing from pack")
        else:
            present += 1
            if dc:
                dc_present += 1
            pack_name = fault_codes[code]
            if _norm(pack_name) == _norm(name):
                correct += 1
                if dc:
                    dc_correct += 1
            else:
                fabrication = True
                details.append(
                    f"fault {fid} (code {code}): name contradiction — "
                    f"gold={name!r} pack={pack_name!r}"
                )

        # Fault->param link is a SCORED recall input (GRADING_SPEC.md §C), not
        # a cosmetic note: each referenced parameter id is its own scored
        # item, on top of (not instead of) the fault-presence/name check
        # above. A missing link reduces recall; it is never a fabrication —
        # the fault itself can be present-and-correct while a link is absent.
        for ref in gf.get("references_parameters", []) or []:
            linked_param = params_by_id.get(ref)
            linked_faults = _norm_set((linked_param or {}).get("related_faults"))
            linked = bool(linked_param) and _norm(fid) in linked_faults
            total += 1
            if dc:
                dc_total += 1
            if linked:
                present += 1
                correct += 1
                if dc:
                    dc_present += 1
                    dc_correct += 1
            else:
                details.append(
                    f"fault {fid} -> param {ref} link MISSING "
                    f"(param {ref!r}.related_faults should contain {fid!r})"
                )

    return {
        "total": total,
        "present": present,
        "correct": correct,
        "dc_total": dc_total,
        "dc_present": dc_present,
        "dc_correct": dc_correct,
        "fabrication": fabrication,
    }


def _score_one_param(
    gp: dict[str, Any],
    pack_param: dict[str, Any],
    all_param_ids: set[str],
    details: list[str],
) -> bool:
    """Returns True iff this gold parameter contradicts (fabrication) the
    pack's entry for it. Missing/empty pack fields are gaps, not fabrication —
    "don't invent missing data" cuts both ways: absence isn't a lie."""
    pid = gp["parameter_id"]
    contradiction = False

    for field_name in ("name", "range", "default"):
        gold_value = gp.get(field_name)
        if gold_value is None:
            continue
        pack_value = pack_param.get(field_name)
        if pack_value is None:
            details.append(f"param {pid}.{field_name}: missing in pack (gap)")
            continue
        if _norm(pack_value) != _norm(gold_value):
            contradiction = True
            details.append(
                f"param {pid}.{field_name}: contradiction — gold={gold_value!r} pack={pack_value!r}"
            )

    # related_faults IS a pack field — graded strictly (an extra entry the
    # gold doesn't have is a fabrication; a missing one is a recall gap).
    gold_faults_set = _norm_set(gp.get("related_faults"))
    if gold_faults_set:
        pack_faults_set = _norm_set(pack_param.get("related_faults"))
        extra = pack_faults_set - gold_faults_set
        missing = gold_faults_set - pack_faults_set
        if extra:
            contradiction = True
            details.append(f"param {pid}.related_faults: unexpected entries {sorted(extra)}")
        if missing:
            details.append(f"param {pid}.related_faults: missing entries {sorted(missing)} (gap)")

    # related_parameters is NOT part of the ParameterCard schema — the extractor
    # drops it (adding it is a runtime/schema PR, out of scope). Grading a field
    # the pack cannot represent would be grading the impossible, so any
    # difference here is INFORMATIONAL only: it never sets fabrication, never
    # counts toward matched/precision/recall, and never lowers the trust status.
    # (The related_parameters_not_faults edge case still verifies, separately,
    # that no related_parameters value leaks into related_faults.)
    gold_related_params = _norm_set(gp.get("related_parameters"))
    if gold_related_params:
        pack_related_params = _norm_set(pack_param.get("related_parameters"))
        missing_related = gold_related_params - pack_related_params
        if missing_related:
            details.append(
                f"param {pid}.related_parameters: gold lists {sorted(gold_related_params)} "
                "but ParameterCard schema has no related_parameters field (informational; "
                "not scored)"
            )

    for rf in pack_param.get("related_faults", []) or []:
        if rf in all_param_ids:
            contradiction = True
            details.append(
                f"param {pid}: related_faults contains a parameter id {rf!r} (fabrication)"
            )

    return contradiction


def _score_params(
    gold_params: list[dict[str, Any]],
    params_by_id: dict[str, dict[str, Any]],
    all_param_ids: set[str],
    details: list[str],
) -> dict[str, Any]:
    total = present = correct = 0
    dc_total = dc_present = dc_correct = 0
    fabrication = False

    for gp in gold_params:
        pid = gp["parameter_id"]
        dc = bool(gp.get("diagnostic_critical", False))
        total += 1
        if dc:
            dc_total += 1

        pack_param = params_by_id.get(pid)
        if pack_param is None:
            details.append(f"param {pid}: missing from pack")
            continue

        present += 1
        if dc:
            dc_present += 1
        contradicted = _score_one_param(gp, pack_param, all_param_ids, details)
        if contradicted:
            fabrication = True
        else:
            correct += 1
            if dc:
                dc_correct += 1

    return {
        "total": total,
        "present": present,
        "correct": correct,
        "dc_total": dc_total,
        "dc_present": dc_present,
        "dc_correct": dc_correct,
        "fabrication": fabrication,
    }


def _check_edge_case(
    edge_case: dict[str, Any], params_by_id: dict[str, dict[str, Any]]
) -> tuple[bool, str]:
    kind = edge_case.get("kind")
    ids = edge_case.get("ids", [])

    if kind == "comma_group_skip":
        leaked = [i for i in ids if i in params_by_id]
        return (not leaked, f"leaked into pack: {leaked}" if leaked else "correctly skipped")

    if kind == "multi_id_shared_desc":
        missing = [i for i in ids if i not in params_by_id]
        if missing:
            return False, f"missing ids: {missing}"
        names = [params_by_id[i].get("name", "") for i in ids]
        if any(not n.strip() for n in names):
            return False, "one or more entries has an empty name"
        if len(ids) > 1 and len({_norm(n) for n in names}) == 1:
            return False, f"all {len(ids)} entries share one identical name (merged/bled)"
        return True, "each id present with a distinct, non-empty name"

    if kind == "related_parameters_not_faults":
        for i in ids:
            param = params_by_id.get(i)
            if param is None:
                return False, f"{i} missing from pack"
            for rf in param.get("related_faults", []) or []:
                if not _FAULT_ID_RE.match(rf):
                    return False, f"{i}.related_faults contains non-fault entry {rf!r}"
        return True, "no related_parameters entries leaked into related_faults"

    return True, f"unrecognized edge_case kind {kind!r} — not implemented, treated as pass"


def score_against_gold(pack_dict: dict[str, Any], gold_dict: dict[str, Any]) -> LayerResult:
    """Score ``pack_dict`` against ``gold_dict`` per GRADING_SPEC.md Layer C."""
    details: list[str] = []

    fault_codes = _fault_codes_by_int(pack_dict)
    params_by_id = {
        p["parameter_id"]: p for p in pack_dict.get("parameters", []) or [] if p.get("parameter_id")
    }
    all_param_ids = set(params_by_id)

    gold_faults = gold_dict.get("faults", []) or []
    gold_params = gold_dict.get("parameters", []) or []
    gold_edge_cases = gold_dict.get("edge_cases", []) or []

    fault_scores = _score_faults(gold_faults, fault_codes, params_by_id, details)
    param_scores = _score_params(gold_params, params_by_id, all_param_ids, details)

    edge_case_results: dict[str, str] = {}
    for edge_case in gold_edge_cases:
        kind = edge_case.get("kind", "unknown")
        ids = edge_case.get("ids", [])
        key = f"{kind}:{','.join(ids)}"
        passed, note = _check_edge_case(edge_case, params_by_id)
        edge_case_results[key] = "pass" if passed else "fail"
        details.append(f"edge_case {key}: {'PASS' if passed else 'FAIL'} — {note}")

    total_gold = fault_scores["total"] + param_scores["total"]
    matched_gold = fault_scores["correct"] + param_scores["correct"]
    present_total = fault_scores["present"] + param_scores["present"]
    correct_present = fault_scores["correct"] + param_scores["correct"]

    dc_total = fault_scores["dc_total"] + param_scores["dc_total"]
    dc_present = fault_scores["dc_present"] + param_scores["dc_present"]
    dc_correct = fault_scores["dc_correct"] + param_scores["dc_correct"]

    overall_recall = (matched_gold / total_gold) if total_gold else 1.0
    overall_precision = (correct_present / present_total) if present_total else 1.0
    diagnostic_critical_recall = (dc_correct / dc_total) if dc_total else 1.0
    diagnostic_critical_precision = (dc_correct / dc_present) if dc_present else 1.0

    overall_fault_recall = (
        (fault_scores["correct"] / fault_scores["total"]) if fault_scores["total"] else 1.0
    )
    diagnostic_critical_fault_recall = (
        (fault_scores["dc_correct"] / fault_scores["dc_total"]) if fault_scores["dc_total"] else 1.0
    )

    fabrication_detected = fault_scores["fabrication"] or param_scores["fabrication"]
    edge_case_failed = any(v == "fail" for v in edge_case_results.values())

    status = "fail" if fabrication_detected else "pass"
    summary = (
        f"gold score: overall recall={overall_recall:.0%} precision={overall_precision:.0%}; "
        f"diagnostic-critical recall={diagnostic_critical_recall:.0%} "
        f"precision={diagnostic_critical_precision:.0%}; "
        f"fault recall={overall_fault_recall:.0%} (diagnostic-critical fault "
        f"recall={diagnostic_critical_fault_recall:.0%})"
    )
    if edge_case_failed:
        summary += "; one or more edge_case expectations FAILED"

    return LayerResult(
        name="gold_score",
        status=status,
        summary=summary,
        details=details,
        metrics={
            "total_gold": total_gold,
            "matched_gold": matched_gold,
            "overall_recall": overall_recall,
            "overall_precision": overall_precision,
            "diagnostic_critical_recall": diagnostic_critical_recall,
            "diagnostic_critical_precision": diagnostic_critical_precision,
            "overall_fault_recall": overall_fault_recall,
            "diagnostic_critical_fault_recall": diagnostic_critical_fault_recall,
            "fabrication_detected": fabrication_detected,
            "edge_case_results": edge_case_results,
        },
    )
