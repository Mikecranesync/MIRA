"""Layer D — deterministic, gold-independent domain-quality rules.

Every rule here is a hard-fail check on the pack's OWN shape/content — no
manual, no gold set required. See GRADING_SPEC.md's Layer D for the full,
literal rule list this module implements.
"""

from __future__ import annotations

import re
from typing import Any

from report import LayerResult

_VALID_PROVENANCE = {"bench_verified", "manual_cited"}

_JUNK_NAME_RE = re.compile(
    r"Rockwell Automation Publication|Chapter\s+\d+|^\s*\d+\s*$", re.IGNORECASE
)
_PARAM_ID_RE = re.compile(r"^[APCTBDapctbd]\d{2,3}$")
_FAULT_ID_RE = re.compile(r"^F\d+$")
_FAULT_ID_RE_ANY_CASE = re.compile(r"^F\d+$", re.IGNORECASE)
_LEADING_FAULT_ID_RE = re.compile(r"^([A-Za-z]\d{2,3})\b")


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def check_domain(pack_dict: dict[str, Any]) -> LayerResult:
    """Run every Layer D rule against ``pack_dict``. Any violation is a hard
    fail (``status="fail"``) — domain rules have no soft/warn tier."""
    violations: list[str] = []

    fault_codes = pack_dict.get("live_decode", {}).get("fault_codes", {}) or {}
    parameters = pack_dict.get("parameters", []) or []
    keypad_navigation = pack_dict.get("keypad_navigation", []) or []
    provenance = pack_dict.get("provenance", {}) or {}

    # --- fault_codes name junk -------------------------------------------
    for code, name in fault_codes.items():
        if _JUNK_NAME_RE.search(str(name)):
            violations.append(f"fault_codes[{code}]: junk name {name!r} (header/footer bleed)")

    # --- parameter_id shape ------------------------------------------------
    all_param_ids: set[str] = set()
    for param in parameters:
        pid = param.get("parameter_id", "")
        all_param_ids.add(pid)
        if not _PARAM_ID_RE.match(pid) or _FAULT_ID_RE_ANY_CASE.match(pid):
            violations.append(
                f"parameter_id {pid!r}: does not match ^[APCTBDapctbd]\\d{{2,3}}$ or is a fault id"
            )

    # --- related_faults shape + no param-id leaked in ----------------------
    for param in parameters:
        pid = param.get("parameter_id", "")
        for rf in param.get("related_faults", []) or []:
            if not _FAULT_ID_RE.match(rf):
                violations.append(
                    f"parameter {pid!r}: related_faults entry {rf!r} does not match ^F\\d+$"
                )
            if rf in all_param_ids:
                violations.append(
                    f"parameter {pid!r}: related_faults contains a parameter id {rf!r} "
                    "(leaked param-id link)"
                )

    # --- duplicate parameter ids -------------------------------------------
    seen_ids: dict[str, int] = {}
    for param in parameters:
        pid = param.get("parameter_id", "")
        seen_ids[pid] = seen_ids.get(pid, 0) + 1
    for pid, count in seen_ids.items():
        if count > 1:
            violations.append(f"parameter_id {pid!r}: appears {count} times (duplicate)")

    # --- duplicate fault codes -----------------------------------------
    # live_decode.fault_codes is parsed as a dict, so an exact duplicate JSON
    # *key* can't survive to this point (json.loads silently keeps only the
    # last value) — that class of bug is invisible to a post-parse check.
    # provenance.sources[] IS a list, though, and the extractor builds one
    # source entry per original fault citation before any code-keyed
    # collapse; a fault id recovered from two different source excerpts is
    # the detectable symptom of the same underlying duplicate-emission bug.
    fault_id_hits: dict[str, int] = {}
    for source in provenance.get("sources", []) or []:
        excerpt = (source.get("excerpt") or "").strip()
        match = _LEADING_FAULT_ID_RE.match(excerpt)
        if match:
            fid = match.group(1)
            fault_id_hits[fid] = fault_id_hits.get(fid, 0) + 1
    for fid, count in fault_id_hits.items():
        if count > 1:
            violations.append(
                f"fault id {fid!r}: appears in {count} provenance.sources citations (duplicate)"
            )

    # --- uncited non-null parameter value -----------------------------------
    for param in parameters:
        pid = param.get("parameter_id", "")
        has_value = any(not _is_blank(param.get(f)) for f in ("range", "default", "unit"))
        if not has_value:
            continue
        citation = param.get("source_citation") or {}
        if _is_blank(citation.get("excerpt")) or _is_blank(citation.get("page")):
            violations.append(
                f"parameter {pid!r}: has a non-null range/default/unit but an empty "
                "source_citation.excerpt/page (uncited value)"
            )

    # --- keypad_navigation view_only_warning --------------------------------
    for keypad in keypad_navigation:
        goal = keypad.get("goal")
        if _is_blank(keypad.get("view_only_warning")):
            violations.append(f"keypad_navigation goal={goal!r}: empty view_only_warning")

    # --- provenance value vocabulary ----------------------------------------
    for path, tier in (provenance.get("items") or {}).items():
        if tier not in _VALID_PROVENANCE:
            violations.append(
                f"provenance.items[{path!r}] = {tier!r}: not one of {sorted(_VALID_PROVENANCE)}"
            )
    for param in parameters:
        pid = param.get("parameter_id", "")
        tier = param.get("provenance_tier")
        if tier is not None and tier not in _VALID_PROVENANCE:
            violations.append(
                f"parameter {pid!r}: provenance_tier {tier!r} not one of "
                f"{sorted(_VALID_PROVENANCE)}"
            )
    for keypad in keypad_navigation:
        goal = keypad.get("goal")
        tier = keypad.get("provenance_tier")
        if tier is not None and tier not in _VALID_PROVENANCE:
            violations.append(
                f"keypad_navigation goal={goal!r}: provenance_tier {tier!r} not one of "
                f"{sorted(_VALID_PROVENANCE)}"
            )

    # --- inferred relationships must be marked ------------------------------
    # No pack field currently emits an "inferred" relationship (schema.py has
    # no such marker) — this rule is a forward-compat placeholder per
    # GRADING_SPEC.md ("if the pack ever emits one"). A future field would be
    # checked here; today there is nothing to flag.

    status = "fail" if violations else "pass"
    summary = (
        f"domain rules: {len(violations)} violation(s)" if violations else "domain rules: clean"
    )
    return LayerResult(name="domain_rules", status=status, summary=summary, details=violations)
