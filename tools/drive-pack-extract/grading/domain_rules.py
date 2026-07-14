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
_LEADING_FAULT_ID_RE = re.compile(r"^([A-Za-z]\d{2,3})\b")

# --- Family-aware ID conventions --------------------------------------------
# Different drive families label parameters and faults differently, and an id
# that is legitimate for one family is contamination in another. The rules are
# therefore keyed off the pack's declared ``family``, NOT a single hardcoded
# vocabulary. This is deliberately NOT a broad relaxation: each family has its
# own explicit pattern, an UNKNOWN family falls back to the strict PowerFlex
# pattern, and the param-id-leak guard (``rf in all_param_ids``) stays absolute
# for every family. So a PowerFlex id in a GS10 pack (or vice-versa) is still
# flagged — the shape simply belongs to the wrong family.
#
#   powerflex  : params A105/P042/C125/t094/d015 (^[APCTBDapctbd]\d{2,3}$);
#                fault refs F081 (^F\d+$).
#   durapulse  : AutomationDirect GS10/GS20 — dotted params P09.03
#                (^[A-Za-z]\d{2}\.\d{2}$); alphanumeric fault mnemonics
#                CE10/GFF/Lvd/oL/EF/CE1..4 — anything that is NOT the PowerFlex
#                F\d+ form and is a short letter(+digit) token.
#   magnetek   : Magnetek/Columbus McKinnon IMPULSE crane VFDs (G+ Mini,
#                G+/VG+ Series 4/5). STRONGLY INFERRED relabeled Yaskawa
#                (V1000/G5) hardware, so the ID SHAPE matches durapulse — dotted
#                params H01.01/U01.10/C12.05 (^[A-Za-z]\d{2}\.\d{2}$) and mnemonic
#                faults oC/EF0/LL1/BE2/UV1/MNT (^(?!F\d+$)[A-Za-z]{1,4}\d{0,2}$),
#                verified against the real G+ Mini manual (144-25085). It is a
#                DISTINCT family (own crane firmware/faults/brake logic), so it
#                gets its own key even though the regexes coincide with durapulse.
_FAMILY_CONVENTIONS = {
    "powerflex": {
        "param_id": re.compile(r"^[APCTBDapctbd]\d{2,3}$"),
        "fault_ref": re.compile(r"^F\d+$"),
    },
    "durapulse": {
        "param_id": re.compile(r"^[A-Za-z]\d{2}\.\d{2}$"),
        "fault_ref": re.compile(r"^(?!F\d+$)[A-Za-z]{1,4}\d{0,2}$"),
    },
    "magnetek": {
        "param_id": re.compile(r"^[A-Za-z]\d{2}\.\d{2}$"),
        "fault_ref": re.compile(r"^(?!F\d+$)[A-Za-z]{1,4}\d{0,2}$"),
    },
}
_DEFAULT_FAMILY = "powerflex"  # strict fallback for an unrecognized family

# Back-compat aliases (the powerflex convention == the original hardcoded rules).
_PARAM_ID_RE = _FAMILY_CONVENTIONS["powerflex"]["param_id"]
_FAULT_ID_RE = _FAMILY_CONVENTIONS["powerflex"]["fault_ref"]


def _family_key(pack_dict: dict[str, Any]) -> str:
    """Resolve the pack's family to a convention key from its declared
    ``family`` (manufacturer / series / aliases). Unknown -> strict default."""
    fam = pack_dict.get("family", {}) or {}
    hay = " ".join(
        [str(fam.get("manufacturer", "")), str(fam.get("series", ""))]
        + [str(a) for a in (fam.get("aliases") or [])]
    ).lower()
    if "powerflex" in hay:
        return "powerflex"
    if any(t in hay for t in ("magnetek", "impulse", "columbus mckinnon", "g+ mini", "vg+")):
        return "magnetek"
    if any(t in hay for t in ("durapulse", "automationdirect", "gs10", "gs20")):
        return "durapulse"
    return _DEFAULT_FAMILY


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


# --- crane-domain supplement -------------------------------------------------
# The crane hard-fail rule (task Phase 3): crane-safety-critical content in a
# pack must be CITED — an uncited brake/limit/load-check/STO/encoder entry is a
# hard fail. This is a PACK-level integrity check (does the shipped pack carry a
# cited basis for its crane-safety content), NOT an answer-quality judge: the
# spec's "unsafe answer -> hard failure" is about Q&A answers, and there is no
# answer-judge in the scout. That crane-safety ANSWER judge is a named follow-up;
# this supplement is the in-scope pack-content half.
#
# Deterministic keyword match only — deliberately NO "scan the prose for unsafe
# advice" regex (it false-positives on "do NOT bypass the brake" and is trivially
# evaded; that would be safety theater, not a control).
_CRANE_FAMILY_RE = re.compile(r"magnetek|impulse|crane|hoist|columbus mckinnon", re.I)
_CRANE_SAFETY_RE = re.compile(
    r"brake|torque prov|load check|swift[-\s]?lift|ultra[-\s]?lift|overspeed|"
    r"upper limit|lower limit|travel limit|safe torque|\bsto\b|answer[-\s]?back|"
    r"\bencoder\b|\bhoist\b",
    re.I,
)


def _is_crane_family(pack_dict: dict[str, Any]) -> bool:
    fam = pack_dict.get("family", {}) or {}
    hay = " ".join(
        [str(fam.get("manufacturer", "")), str(fam.get("series", ""))]
        + [str(a) for a in (fam.get("aliases") or [])]
    )
    return bool(_CRANE_FAMILY_RE.search(hay))


def _crane_domain_violations(pack_dict: dict[str, Any]) -> list[str]:
    """Family-gated crane-safety hard-fails. Returns [] for a non-crane family
    (so the base rubric is never weakened). For a crane family: any crane-safety
    fault / parameter / keypad step present in the pack MUST carry a citation."""
    if not _is_crane_family(pack_dict):
        return []

    violations: list[str] = []

    # A crane-safety fault (by name) must have a cited corrective action: a
    # non-empty provenance.sources excerpt referencing it (sharing a safety
    # keyword with the fault name). Uncited crane-safety guidance is a hard fail.
    sources = pack_dict.get("provenance", {}).get("sources", []) or []
    src_text = " ".join(str(s.get("excerpt") or "") for s in sources).lower()
    fault_codes = pack_dict.get("live_decode", {}).get("fault_codes", {}) or {}
    for code, name in fault_codes.items():
        m = _CRANE_SAFETY_RE.search(str(name))
        if m and m.group(0).lower() not in src_text:
            violations.append(
                f"crane-safety fault_codes[{code}]={name!r}: no cited corrective action "
                "in provenance.sources (crane-safety content must be cited)"
            )

    # A crane-safety parameter must be cited (stricter than the generic
    # uncited-value rule: fires even if range/default/unit are all blank).
    for param in pack_dict.get("parameters", []) or []:
        pid = param.get("parameter_id", "")
        text = " ".join(str(v) for v in param.values() if isinstance(v, str))
        if _CRANE_SAFETY_RE.search(text):
            cit = param.get("source_citation") or {}
            if _is_blank(cit.get("excerpt")) or _is_blank(cit.get("page")):
                violations.append(
                    f"crane-safety parameter {pid!r}: uncited (empty source_citation) — "
                    "crane-safety content must be cited"
                )

    # A crane-safety keypad step must be cited.
    for keypad in pack_dict.get("keypad_navigation", []) or []:
        goal = keypad.get("goal")
        if goal and _CRANE_SAFETY_RE.search(str(goal)):
            cit = keypad.get("source_citation") or {}
            if _is_blank(cit.get("excerpt")):
                violations.append(
                    f"crane-safety keypad goal={goal!r}: uncited — "
                    "crane-safety content must be cited"
                )

    return violations


def check_domain(pack_dict: dict[str, Any]) -> LayerResult:
    """Run every Layer D rule against ``pack_dict``. Any violation is a hard
    fail (``status="fail"``) — domain rules have no soft/warn tier."""
    violations: list[str] = []

    fault_codes = pack_dict.get("live_decode", {}).get("fault_codes", {}) or {}
    parameters = pack_dict.get("parameters", []) or []
    keypad_navigation = pack_dict.get("keypad_navigation", []) or []
    provenance = pack_dict.get("provenance", {}) or {}

    family = _family_key(pack_dict)
    conv = _FAMILY_CONVENTIONS[family]

    # --- fault_codes name junk -------------------------------------------
    for code, name in fault_codes.items():
        if _JUNK_NAME_RE.search(str(name)):
            violations.append(f"fault_codes[{code}]: junk name {name!r} (header/footer bleed)")

    # --- parameter_id shape (family-aware) ---------------------------------
    all_param_ids: set[str] = set()
    for param in parameters:
        pid = param.get("parameter_id", "")
        all_param_ids.add(pid)
        # invalid if it doesn't match THIS family's param shape, or it looks
        # like a fault reference (a fault id masquerading as a param).
        if not conv["param_id"].match(pid) or conv["fault_ref"].match(pid):
            violations.append(
                f"parameter_id {pid!r}: does not match the {family} parameter convention "
                f"or is a fault id (wrong-family contamination or malformed)"
            )

    # --- related_faults shape (family-aware) + no param-id leaked in --------
    for param in parameters:
        pid = param.get("parameter_id", "")
        for rf in param.get("related_faults", []) or []:
            if not conv["fault_ref"].match(rf):
                violations.append(
                    f"parameter {pid!r}: related_faults entry {rf!r} is not a valid "
                    f"{family} fault reference (wrong-family contamination or malformed)"
                )
            # The param-id-leak guard is ABSOLUTE for every family — a parameter
            # id must never appear in related_faults, whatever the convention.
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

    # --- crane-domain supplement (family-gated) -----------------------------
    # Adds crane-safety hard-fails on top of the base rubric WITHOUT weakening
    # it: these rules only fire for a crane family, so PowerFlex/DuraPulse packs
    # are unaffected. See _crane_domain_violations.
    violations.extend(_crane_domain_violations(pack_dict))

    status = "fail" if violations else "pass"
    summary = (
        f"domain rules: {len(violations)} violation(s)" if violations else "domain rules: clean"
    )
    return LayerResult(name="domain_rules", status=status, summary=summary, details=violations)
