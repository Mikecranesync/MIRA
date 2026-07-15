"""decode() — staged contextual decoding (D10 stages 1-2) producing the D13
deterministic output shape — and explain() (D14), the technician-facing
layered explanation.

Stages 3-6 (package context, project profile, manufacturer/device enrichment
beyond notes, human confirmation) exist as explicit seams: their absence is
recorded as a diagnostic, never silently skipped."""

from __future__ import annotations

from ..grader import _norm
from . import class_codes, semantics
from .lexer import lex
from .parser import parse
from .profiles import get_profile
from .project_profile import legend_conflicts

_SCHEMA_VERSION = "1.0"


def decode(raw: str, profile: str | None = "eplan_iec",
           page_context: dict | None = None, legends: list | None = None,
           device_profile: dict | None = None) -> dict:
    prof = get_profile(profile)
    lexed = lex(raw)
    parsed = parse(lexed, prof, page_context=page_context)

    ambiguities = list(parsed["ambiguities"])
    diagnostics = list(parsed["diagnostics"])
    warnings = list(parsed["warnings"])
    if prof.get("diagnostic"):
        diagnostics.append({"code": "profile_fallback",
                            "detail": prof["diagnostic"]})
    for stage in ("package_context", "project_profile_resolution",
                  "manufacturer_enrichment", "human_confirmation"):
        diagnostics.append({"code": "unimplemented_stage", "detail": stage})

    # OCR candidates surface as ambiguities (never applied) — D15
    for tok in lexed["tokens"]:
        for cand in tok.get("ocr_candidates", []):
            ambiguities.append({"raw": tok["raw"], "candidates": [cand],
                                "reason": "possible OCR substitution"})

    # class-code candidates + legend conflicts (D7/D16)
    parent_class = None
    segments = []
    for seg in parsed["segments"]:
        seg = dict(seg)
        if seg.get("kind") == "device_candidate":
            info = class_codes.lookup(seg["class_code"])
            seg["candidate_classes"] = info["candidate_classes"]
            seg["selected_class"] = info["selected_class"]
            seg["requires_project_legend"] = info["requires_project_legend"]
            seg["source_rules"] = info["source_rules"]
            parent_class = seg["class_code"]
            ambiguities.extend(legend_conflicts(
                legends, seg["class_code"], info["candidate_classes"]))
        segments.append(seg)

    connection_point = None
    if parsed["connection_point_raw"] is not None:
        connection_point = semantics.classify_connection_point(
            parsed["connection_point_raw"], parent_class)
        if device_profile:
            note = (device_profile.get("terminals") or {}).get(
                connection_point["raw"])
            if note:
                # manufacturer data ENRICHES (a note), never overwrites the
                # raw designation or asserts polarity/state as fact (D6/D16)
                connection_point["manufacturer_note"] = note
        segments.append({"raw": connection_point["raw"],
                         "kind": connection_point["kind"],
                         "role": connection_point.get("role"),
                         "meaning": None})

    base = parsed["base_designation"]
    child = raw.strip() if connection_point else None
    relationship = None
    if connection_point:
        from .relationships import _child_relationship
        relationship = _child_relationship(
            {"connection_point": connection_point}) or None

    decoded = {
        "schema_version": _SCHEMA_VERSION,
        "raw": raw,
        "normalized": _norm(raw),
        "profile": {"name": prof["name"],
                    "confidence": 0.8 if prof.get("proven") else 0.3,
                    "proven": bool(prof.get("proven"))},
        "aspects": parsed["aspects"],
        "structure_path": parsed["structure_path"],
        "nested_device_path": parsed["nested_device_path"],
        "base_designation": base,
        "displayed_designation": parsed["displayed_designation"],
        "resolved_full_designation": parsed["resolved_full_designation"],
        "segments": segments,
        "connection_point": connection_point,
        "entity_plan": {"parent_device": base,
                        "child_entity": child,
                        "relationship": relationship},
        "unresolved_segments": parsed["unresolved_segments"],
        "ambiguities": ambiguities,
        "diagnostics": diagnostics,
        "warnings": warnings,
        "evidence": [{"kind": "raw_designation", "value": raw}],
    }
    return decoded


_SAFETY_CAVEAT = (
    "Terminal numbering is a naming convention only - it is NOT proof of "
    "contact state, energization, continuity, or safe isolation. Physical "
    "verification per site procedure governs; a drawing or photo never "
    "proves de-energization.")


def explain(decoded: dict, max_items: int | None = None) -> str:
    """Layered technician explanation (D14). Safety caveats and unresolved
    items are NEVER trimmed by ``max_items`` (D17 item 30)."""
    lines = [decoded["raw"], "", "Likely interpretation:"]
    body: list[str] = []
    if decoded.get("base_designation"):
        body.append(f"- {decoded['base_designation']} identifies the parent "
                    "device within the drawing's structure (convention).")
    for seg in decoded["segments"]:
        if seg.get("kind") == "device_candidate":
            body.append(
                f"- {seg['raw']}: device identifier; class letter "
                f"{seg['class_code']!r} is profile/legend-dependent "
                "(project interpretation required).")
    cp = decoded.get("connection_point")
    if cp:
        body.append(f"- {cp['raw']}: {cp.get('role', cp['kind'])} on that "
                    "device (convention). Sibling points (e.g. A1/A2, "
                    "13/14) are separate terminals, not aliases.")
    if max_items is not None:
        body = body[:max_items]
    lines.extend(body)
    lines.append("")
    lines.append(f"Safety: {_SAFETY_CAVEAT}")
    if cp and cp.get("pair_key", "").startswith("5"):
        lines.append(
            "Note: the 5x/5x pair's project meaning is pending human "
            "confirmation - the convention is not resolved for this drawing.")
    unresolved = decoded.get("unresolved_segments", [])
    if unresolved:
        lines.append("")
        lines.append("Not yet confirmed:")
        for u in unresolved:
            lines.append(f"- {u['raw']}: {u['reason']}")
    return "\n".join(lines)
