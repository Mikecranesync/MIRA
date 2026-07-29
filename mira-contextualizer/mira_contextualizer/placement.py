"""Deterministic UNS placement for CCW / Micro8xx tag rows — reuses the parser's ``propose_uns``.

The Rockwell L5X / tag-CSV path gets UNS paths for free: ``mira_plc_parser`` builds them via
``uns.propose_uns`` and ``engine.extract_plc`` copies them onto each row. CCW rows
(``ccw.parse_modbus`` / ``parse_logicalvalues`` / ``parse_st`` / ``parse_project``) leave
``uns_path_proposed=None``, so ``uns.json`` / ``i3x.json`` come out empty for a CCW project.

This module closes that gap for CCW. It shapes the merged CCW rows + controller metadata into the
report dict ``propose_uns`` consumes (``tag_dictionary`` + ``asset_candidates`` +
``vfd_signal_candidates`` + ``controller``) and calls the SAME placement logic the L5X path uses:

  * asset segment  — asset-prefix match (a tag whose name starts with an equipment prefix),
  * signal leaf    — a standardized signal word when the name carries one (frequency / current /
                     …), else the engineering name itself (CCW names are already meaningful),
  * upper levels   — enterprise / site / area / line from a controller-derived prefix.

A uniqueness guard keeps two tags from collapsing onto one path (which would silently drop a signal
from ``i3x.json``): on a collision the later tag falls back to its slugged engineering name as the
leaf — guaranteed unique per asset because tag names are unique.

Deterministic, offline, stdlib + the sibling parser only. No LLM, no network.
"""

from __future__ import annotations

import re

from mira_plc_parser import uns as _uns

# Equipment keywords that name an asset. Mirrors mira_plc_parser.analyze._ASSET_PAT — kept local so
# we don't import another package's private internals; same vocabulary, same intent.
_ASSET_WORDS = (
    "motor",
    "conv",
    "conveyor",
    "pump",
    "valve",
    "solenoid",
    "vfd",
    "drive",
    "fan",
    "heater",
    "horn",
    "light",
    "lamp",
    "cylinder",
    "gate",
    "damper",
    "mixer",
    "agitator",
)
_ASSET_RE = re.compile(r"(?<![A-Za-z])(?:" + "|".join(_ASSET_WORDS) + r")(?![A-Za-z])", re.I)

# name keyword -> standardized signal word (subset of uns._ROLE_WORDS; mirrors analyze._VFD_ROLES so
# the parser and this placement agree on what a frequency/current/… tag looks like). First match wins.
_SIGNAL_WORDS: list[tuple[str, re.Pattern]] = [
    ("frequency", re.compile(r"(?<![A-Za-z])(?:freq|hz|outputhz|speedhz)(?![A-Za-z])", re.I)),
    ("current", re.compile(r"(?<![A-Za-z])(?:current|amps?|iout)(?![A-Za-z])", re.I)),
    (
        "voltage",
        re.compile(r"(?<![A-Za-z])(?:voltage|volts?|vdc|vbus|dcbus|dclink)(?![A-Za-z])", re.I),
    ),
    ("speed", re.compile(r"(?<![A-Za-z])(?:speed|rpm)(?![A-Za-z])", re.I)),
    ("torque", re.compile(r"(?<![A-Za-z])(?:torque)(?![A-Za-z])", re.I)),
    ("temperature", re.compile(r"(?<![A-Za-z])(?:temp|temperature)(?![A-Za-z])", re.I)),
    (
        "setpoint",
        re.compile(r"(?<![A-Za-z])(?:setpoint|freqcmd|cmdfreq|freqref|freqsp)(?![A-Za-z])", re.I),
    ),
    ("fault", re.compile(r"(?<![A-Za-z])(?:fault|trip|alarm|fail|error)(?![A-Za-z])", re.I)),
    ("warning", re.compile(r"(?<![A-Za-z])(?:warn|warning)(?![A-Za-z])", re.I)),
    ("comm", re.compile(r"(?<![A-Za-z])(?:comm|heartbeat|online|link)(?![A-Za-z])", re.I)),
    ("running", re.compile(r"(?<![A-Za-z])(?:running|run)(?![A-Za-z])", re.I)),
    ("command", re.compile(r"(?<![A-Za-z])(?:command|cmd)(?![A-Za-z])", re.I)),
]


def _is_signal_row(row: dict) -> bool:
    """A controller identity is not a signal — it never gets a UNS leaf."""
    return "controller" not in (row.get("roles") or [])


def _asset_candidates(names: list[str]) -> list[dict]:
    """Equipment assets from tag-name prefixes (keyword-anchored, mirrors analyze._asset_candidates):
    a name carrying an equipment keyword contributes its leading underscore/dot token as an asset."""
    keys: dict[str, None] = {}
    for name in names:
        if not _ASSET_RE.search(name):
            continue
        key = re.split(r"[._]", name, maxsplit=1)[0]
        if key:
            keys.setdefault(key, None)
    return [{"name": k} for k in keys]


def _signal_candidates(names: list[str]) -> list[dict]:
    """Tags whose name carries a standardized signal word → a propose_uns vfd_signal candidate, so the
    leaf becomes that word (frequency / current / …) exactly like the L5X path."""
    out: list[dict] = []
    for name in names:
        for word, rex in _SIGNAL_WORDS:
            if rex.search(name):
                out.append({"name": name, "detail": "candidate role: %s" % word})
                break
    return out


def propose_ccw_uns(
    rows: list[dict], meta: dict | None = None, prefix: dict | None = None
) -> dict[str, dict]:
    """Return ``{tag_name: uns_candidate}`` for the signal rows, using the parser's propose_uns.

    ``meta`` is the CCW project metadata (``controller_model`` seeds the line). ``prefix`` overrides
    the upper UNS levels (enterprise/site/area/line) when the user has set them.
    """
    meta = meta or {}
    tags = [r for r in rows if _is_signal_row(r)]
    names = [r["tag_name"] for r in tags]
    report = {
        "handled": True,
        "controller": meta.get("controller_model") or meta.get("controller"),
        "tag_dictionary": [
            {
                "name": r["tag_name"],
                "data_type": (r.get("evidence_json") or {}).get("data_type", ""),
            }
            for r in tags
        ],
        "asset_candidates": _asset_candidates(names),
        "vfd_signal_candidates": _signal_candidates(names),
    }
    out: dict[str, dict] = {}
    used: set[str] = set()
    for c in _uns.propose_uns(report, prefix):
        if c["path"] in used:  # collision — fall back to the unique engineering name as the leaf
            segs = dict(c["segments"])
            segs["signal"] = _uns.slug(c["tag"])
            parts = [segs["enterprise"], segs["site"], segs["area"], segs["line"]]
            if segs.get("asset"):
                parts.append(segs["asset"])
            parts.append(segs["signal"])
            c = {**c, "signal": segs["signal"], "segments": segs, "path": "/".join(parts)}
        used.add(c["path"])
        out[c["tag"]] = c
    return out


def place_rows(
    rows: list[dict], meta: dict | None = None, prefix: dict | None = None
) -> list[dict]:
    """Set ``uns_path_proposed`` + ``i3x_element_id`` on CCW signal rows in place (controller rows are
    left untouched). Existing paths are preserved. Returns the same list for convenience."""
    placed = propose_ccw_uns(rows, meta, prefix)
    for r in rows:
        c = placed.get(r["tag_name"])
        if c and not r.get("uns_path_proposed"):
            r["uns_path_proposed"] = c["path"]
            r["i3x_element_id"] = c["path"]
            r.setdefault("evidence_json", {})["uns_segments"] = c["segments"]
    return rows
