"""Token stream -> structural parse under a syntax profile (D2-D4).

Aspect prefixes (= function, + location, - product), ':' as connection-point
separator, '/' interpreted ONLY through the profile (ambiguous otherwise).
Unparseable segments are kept visible in unresolved_segments — never dropped."""

from __future__ import annotations

import re

from .profiles import slash_candidates

_DEVICE = re.compile(r"^([A-Za-z]{1,3})(\d+)$")
_NFPA_STYLE = re.compile(r"^\d+[A-Za-z]+$")
_SHEET_COL = re.compile(r"^\d+[a-z]?[.,]\d+$")


def parse(lexed: dict, profile: dict, page_context: dict | None = None) -> dict:
    raw = lexed["raw"]
    tokens = lexed["tokens"]
    out: dict = {
        "aspects": {"function": None, "location": None, "product": None},
        "structure_path": [], "nested_device_path": [],
        "segments": [], "unresolved_segments": [],
        "connection_point_raw": None, "base_designation": None,
        "displayed_designation": raw,
        "resolved_full_designation": None,
        "ambiguities": [], "warnings": [], "diagnostics": [],
    }

    # split at the FIRST ':' separator: left = device path, right = point
    colon_ix = next((i for i, t in enumerate(tokens)
                     if t["kind"] == "sep" and t["raw"] == ":"), None)
    left = tokens if colon_ix is None else tokens[:colon_ix]
    right = [] if colon_ix is None else tokens[colon_ix + 1:]
    if colon_ix is not None and profile.get("colon_is_connection_point", True):
        right_text = [t for t in right if t["kind"] == "text"]
        if len(right_text) == 1 and not any(
                t["kind"] == "sep" and t["raw"].strip() for t in right):
            out["connection_point_raw"] = right_text[0]["raw"]
        else:
            out["unresolved_segments"].append(
                {"raw": raw[tokens[colon_ix]["end"]:] or ":",
                 "reason": "unparseable connection-point segment"})

    base_end = tokens[colon_ix]["start"] if colon_ix is not None else len(raw)
    base = raw[:base_end].strip()
    out["base_designation"] = base or None

    # walk the device path
    aspect = None
    slash_seen = False
    path: list[str] = []
    for tok in left:
        if tok["kind"] == "sep":
            ch = tok["raw"]
            if ch == "=":
                aspect = "function"
            elif ch == "+":
                aspect = "location"
            elif ch in ("-", "–", "—"):
                aspect = "product"
            elif ch == "/":
                slash_seen = True
                if profile.get("slash") is None:
                    out["ambiguities"].append(
                        {"separator": "/",
                         "candidates": slash_candidates(),
                         "reason": "slash meaning is profile-dependent"})
            continue
        text = tok["raw"]
        seg: dict = {"raw": text, "kind": "unknown", "meaning": None}
        if aspect == "function" and out["aspects"]["function"] is None:
            out["aspects"]["function"] = text
            seg["kind"] = "function_aspect"
        elif aspect == "location" and out["aspects"]["location"] is None:
            out["aspects"]["location"] = text
            seg["kind"] = "location_aspect"
        else:
            m = _DEVICE.match(text)
            if m:
                seg.update({"kind": "device_candidate",
                            "class_code": m.group(1).upper(),
                            "counter": m.group(2)})
                path.append(text)
            elif _SHEET_COL.match(text):
                seg["kind"] = "sheet_or_coordinate_reference"
            elif text.isdigit():
                seg["kind"] = "product_or_structure_candidate"
                seg["raw"] = ("-" if aspect == "product" and
                              f"-{text}" in raw else "") + text
                seg["raw"] = f"-{text}" if f"-{text}" in raw else text
                path.append(text)
            elif _NFPA_STYLE.match(text):
                seg["kind"] = "non_iec_notation_candidate"
                out["warnings"].append(
                    f"token {text!r} looks like digit-first (NFPA-style) "
                    "notation; profile rules not applied")
            else:
                seg["kind"] = "unresolved"
        out["segments"].append(seg)
        if seg["kind"] in ("unresolved", "product_or_structure_candidate"):
            out["unresolved_segments"].append(
                {"raw": seg["raw"], "reason": "meaning requires structure "
                 "profile or project legend"})

    if len(path) > 1 and not slash_seen:
        out["nested_device_path"] = path
    elif len(path) > 1:
        out["nested_device_path"] = path

    # page-context completion (stage 2, D3/D10): a displayed tag may omit
    # higher-level aspects supplied by the page header / structure box
    prefix = (page_context or {}).get("prefix")
    if prefix and not any(a in raw for a in "=+"):
        stripped = base.lstrip("-–—")
        if stripped:
            out["resolved_full_designation"] = f"{prefix}-{stripped}" + (
                f":{out['connection_point_raw']}"
                if out["connection_point_raw"] else "")

    if not any(s["kind"] not in ("unresolved",) for s in out["segments"]) \
            and not out["segments"]:
        out["unresolved_segments"].append(
            {"raw": raw, "reason": "no parseable content"})
        out["diagnostics"].append({"code": "malformed_designation",
                                   "detail": "no text tokens found"})
    if out["segments"] and all(s["kind"] == "unresolved"
                               for s in out["segments"]):
        out["diagnostics"].append({"code": "unparsed_designation",
                                   "detail": "no segment resolved"})
    return out
