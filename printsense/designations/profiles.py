"""Standard profiles + heuristic detection (D8/D9).

Only ``eplan_iec`` and ``unknown_european`` carry proven rule content in v1;
every other profile is DECLARED with ``proven: False`` and selecting it adds
a diagnostic — support is never silently claimed (directive D8)."""

from __future__ import annotations

PROFILES: dict[str, dict] = {
    "eplan_iec": {
        "name": "eplan_iec", "proven": True,
        "colon_is_connection_point": True,
        "slash": "project_hierarchy",
        "aspects": True,
        "notes": "EPLAN-style IEC 81346 output: ':' separates device from "
                 "connection point (EPLAN docs, confidence 0.55). '/' inside "
                 "a device path is treated as PROJECT-DIALECT hierarchy "
                 "(observed drawing family); EPLAN-generic '/' meanings "
                 "documented elsewhere are page/column cross-reference "
                 "suffixes and cable end-device joins - the segment meaning "
                 "therefore stays unresolved until a legend confirms.",
    },
    "unknown_european": {
        "name": "unknown_european", "proven": True,
        "colon_is_connection_point": True,
        "slash": None,  # ambiguous by construction
        "aspects": True,
        "notes": "Conservative fallback: separators recognized, slash left "
                 "ambiguous, class codes never selected.",
    },
    "iec_81346_current": {"name": "iec_81346_current", "proven": False},
    "din_en_81346": {"name": "din_en_81346", "proven": False},
    "legacy_din_40719": {"name": "legacy_din_40719", "proven": False},
    "eplan_din": {"name": "eplan_din", "proven": False},
    "manufacturer_profile": {"name": "manufacturer_profile", "proven": False},
    "project_profile": {"name": "project_profile", "proven": False},
}

_SLASH_CANDIDATES = [
    "nested_structure", "sheet_reference", "subdivision",
    "cable_designation", "cross_reference", "company_hierarchy",
]


def get_profile(name: str | None) -> dict:
    if name is None:
        return PROFILES["unknown_european"]
    prof = PROFILES.get(name)
    if prof is None:
        prof = dict(PROFILES["unknown_european"])
        prof["diagnostic"] = f"unknown profile {name!r}; conservative fallback"
        return prof
    if not prof.get("proven"):
        prof = {**PROFILES["unknown_european"], "name": name,
                "diagnostic": f"profile {name!r} declared but not proven; "
                              "conservative rules applied"}
    return prof


def slash_candidates() -> list[str]:
    return list(_SLASH_CANDIDATES)


def detect_profile(samples: list[str], title_text: str = "") -> dict:
    """Evidence-based heuristic detection (D9). Low confidence preserves
    alternatives; never forces NFPA onto IEC or vice versa."""
    evidence: list[str] = []
    score = 0.0
    joined = " ".join(samples)
    if any(s.startswith(("-", "=", "+")) for s in samples):
        score += 0.3
        evidence.append("aspect-prefixed identifiers present")
    if ":" in joined:
        score += 0.25
        evidence.append("colon connection-point separators present")
    if "eplan" in title_text.lower():
        score += 0.3
        evidence.append("EPLAN named in title text")
    if any(t in title_text.lower() for t in ("blatt", "zeichnung", "din", "iec")):
        score += 0.15
        evidence.append("European title-block vocabulary")
    nfpa = sum(1 for s in samples if s and s[0].isdigit() and s[-1].isalpha())
    conflicts = ["NFPA-style digit-first tags present"] if nfpa else []
    selected = "eplan_iec" if score >= 0.5 and not nfpa else "unknown_european"
    alternatives = [{"name": "unknown_european", "confidence": 0.4}] \
        if selected == "eplan_iec" else \
        [{"name": "eplan_iec", "confidence": round(min(score, 0.45), 2)}]
    return {"selected_profile": selected,
            "confidence": round(min(score, 0.95), 2),
            "evidence": evidence, "alternatives": alternatives,
            "conflicts": conflicts}
