"""Generate the STAGED CANDIDATE PowerFlex 525 drive pack from the real manual.

Offline, one-shot PR-B run: point this at the real, licensed
``pf525_520-um001.pdf`` (never committed — see ``.gitignore`` in this
directory) and it produces a full ``pack.json`` candidate for
``tools/drive-pack-extract/candidates/powerflex_525/`` — a STAGED, non-served
location. This candidate is validated and graded in place; it is NOT the
live `packs/` tree the runtime resolver reads. Promotion into the live
``mira-bots/shared/drive_packs/packs/powerflex_525/`` (where
``resolve_pack()`` can return it in production) is a SEPARATE, human-gated
deploy step — see ``docs/drive-commander/runbook-pr-b-acceptance.md`` — not
something this script performs. (`.claude/rules/train-before-deploy.md`.)

This script does NOT modify ``extractor.py``, ``cite_integrity.py``, or any
runtime code under ``mira-bots/shared/drive_packs/`` (loader/schema/cards).
It only:

1. Calls the existing ``extractor.extract()`` (unchanged) to get a cited
   fault_codes/parameters FRAGMENT from the real manual.
2. Assembles that fragment into a FULL v2 pack.json (family/nameplate/
   envelope/knowledge/provenance wrapper around it — none of which the
   manual can supply, so those blocks are honestly empty/unknown).
3. Writes the candidate pack.json + a human-readable PROVENANCE.md sidecar
   into the candidate directory (NOT the live served packs/ tree).
4. Validates the written pack.json against the real, unmodified
   ``drive_packs.loader._parse_pack()`` schema logic (run directly against
   the candidate file, since the loader's own ``load_pack()`` only reads the
   live ``packs/`` tree) — fails closed (non-zero exit) if it doesn't.

Read-only w.r.t. the source PDF (reads it, never writes it); the only writes
are the two new files this script creates. No fieldbus, no network, no DB
(`.claude/rules/fieldbus-readonly.md`).

IMPORTANT: this produces a STAGED CANDIDATE, not a trusted or deployed pack.
Trust/grading is a separate step (the grading harness in
``tools/drive-pack-extract/grading/``), and promotion to the live `packs/`
tree is a separate, later, human-gated step — this script's job is a clean,
schema-valid, honestly-sourced candidate only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

_TOOL_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _TOOL_DIR.parent.parent
_SHARED_DIR = _REPO_ROOT / "mira-bots" / "shared"
# STAGED CANDIDATE location — NOT the live served packs/ tree. Promotion into
# mira-bots/shared/drive_packs/packs/ is a separate, human-gated deploy step
# (see docs/drive-commander/runbook-pr-b-acceptance.md).
_DEFAULT_PACKS_DIR = _TOOL_DIR / "candidates"

if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))

import extractor  # noqa: E402  (path must be set up first)

PACK_ID = "powerflex_525"
DOC_LABEL = "PowerFlex 525 Adjustable Frequency AC Drive User Manual (520-UM001O-EN-E)"
FAULT_PAGES = list(range(161, 166))
# Page 98 (the multi-column Analog Output block: t088/t089/t090) is deliberately
# EXCLUDED — its 3-column layout makes the position-aware parser emit a duplicate
# t089 and bleed footnote text into values. None of those params are diagnostic-
# critical or in the gold set (the gold's t094 lives on p.99). Precision over
# recall: skip the known-messy region and declare it a residual rather than ship
# a duplicate/junk parameter. Widening back to 98 requires an extractor hardening
# pass (PR-A scope), not a pack change.
PARAM_PAGES = [65, 66, 99, 100, 101, 102, 103]

# Known-good sha256 of the real manual this script targets — printed for the
# operator to confirm, NEVER enforced (a future manual edition should still
# be usable; this is a sanity signal, not a gate).
KNOWN_MANUAL_SHA256 = "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6"

_REQUIRED_TOP_LEVEL_KEYS = (
    "pack_id",
    "schema_version",
    "family",
    "nameplate",
    "live_decode",
    "envelope",
    "knowledge",
    "provenance",
    "parameters",
    "keypad_navigation",
)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _git_short_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return out.stdout.strip()
    except Exception:  # noqa: BLE001 — best-effort provenance note, never fatal
        return "<unknown>"


_KNOWN_UNITS = {
    "Hz",
    "s",
    "sec",
    "A",
    "V",
    "rpm",
    "poles",
    "%",
    "kW",
    "W",
    "mA",
    "ms",
    "min",
    "°C",
    "VAC",
    "VDC",
    "Amps",
}
_RANGE_RE = re.compile(r"^-?\d+(\.\d+)?\s*/\s*-?\d+(\.\d+)?$")
_FOREIGN_ID_RE = re.compile(r"\b[APCtbd]\d{2,3}\b")  # a param-id token


def _sanitize_param_bleed(param: dict[str, Any]) -> list[str]:
    """Null out values that are clearly cross-row bleed. Returns a list of
    'parameter_id.field' strings that were nulled (for the provenance/report).
    Conservative: only nulls on strong bleed signals."""
    nulled = []
    pid = param.get("parameter_id", "")
    own = pid.upper()

    # default: null if it contains '=', model-conditional bleed, or a FOREIGN param-id token
    d = param.get("default")
    if isinstance(d, str):
        foreign = [m for m in _FOREIGN_ID_RE.findall(d) if m.upper() != own]
        if "=" in d or "(PowerFlex 52" in d or foreign:
            param["default"] = None
            nulled.append(f"{pid}.default")

    # unit: null if it's not a recognized engineering unit (bleed words like
    # 'scheme','spinning','displayed','per')
    u = param.get("unit")
    if isinstance(u, str) and u.strip() and u.strip() not in _KNOWN_UNITS:
        param["unit"] = None
        nulled.append(f"{pid}.unit")

    # range: null if it doesn't look like a clean min/max
    r = param.get("range")
    if isinstance(r, str) and not _RANGE_RE.match(r.strip()):
        param["range"] = None
        nulled.append(f"{pid}.range")

    return nulled


def _coerce_parameters(
    parameters: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Pass the fragment's parameter cards through unchanged, except coerce
    ``source_citation.page`` to a string (schema wants str; extractor already
    emits str(page), but coerce defensively in case that ever changes) and
    sanitize cross-row bleed values. Returns (coerced_params, sanitized_fields)
    where sanitized_fields is a list of 'parameter_id.field' entries that were
    nulled."""
    out = []
    all_nulled = []
    for param in parameters:
        param = dict(param)
        citation = dict(param.get("source_citation") or {})
        if "page" in citation and citation["page"] is not None:
            citation["page"] = str(citation["page"])
        param["source_citation"] = citation

        # Apply bleed sanitization
        nulled = _sanitize_param_bleed(param)
        all_nulled.extend(nulled)

        out.append(param)

    # Fail-closed: a pack with duplicate parameter_ids is invalid (a consumer keys
    # by id). If a page range ever reintroduces a duplicate, refuse to emit rather
    # than silently pick one — the operator must narrow the scope or harden the
    # parser. The grading harness's domain rule also rejects this downstream.
    seen: dict[str, int] = {}
    for p in out:
        pid = p.get("parameter_id", "")
        seen[pid] = seen.get(pid, 0) + 1
    dupes = sorted(pid for pid, n in seen.items() if n > 1)
    if dupes:
        raise RuntimeError(
            f"duplicate parameter_id(s) {dupes} in extracted params — "
            "narrow PARAM_PAGES to exclude the offending multi-column page(s) "
            "or harden the extractor (PR-A). Refusing to emit a duplicate pack."
        )
    return out, all_nulled


def _build_pack(fragment: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    fault_codes = fragment["fault_codes"]
    fault_citations = fragment["fault_citations"]
    parameters, sanitized_fields = _coerce_parameters(fragment["parameters"])

    sources = [
        {
            "doc": citation["doc"],
            "page": str(citation["page"]),
            "excerpt": citation["excerpt"],
        }
        for citation in fault_citations
    ]

    pack: dict[str, Any] = {
        "pack_id": PACK_ID,
        "schema_version": 2,
        "family": {
            "manufacturer": "Rockwell Automation",
            "series": "PowerFlex 525",
            "aliases": [
                "powerflex 525",
                "pf525",
                "pf 525",
                "powerflex 520-series",
                "520-series",
            ],
        },
        "nameplate": {
            "match_keywords": ["powerflex 525", "pf525", "520-um001", "25b"],
        },
        "live_decode": {
            "status_bits": {},
            "cmd_word": {},
            "fault_codes": fault_codes,
            "registers": {},
        },
        "envelope": {},
        "knowledge": {},
        "provenance": {
            "items": {
                "live_decode.fault_codes": "manual_cited",
                "parameters": "manual_cited",
            },
            "sources": sources,
        },
        "parameters": parameters,
        "keypad_navigation": [],
    }

    missing = set(_REQUIRED_TOP_LEVEL_KEYS) - pack.keys()
    if missing:  # pragma: no cover — defensive, should never trigger
        raise RuntimeError(f"internal error: assembled pack missing keys {sorted(missing)}")
    extra = pack.keys() - set(_REQUIRED_TOP_LEVEL_KEYS)
    if extra:  # pragma: no cover — defensive, should never trigger
        raise RuntimeError(f"internal error: assembled pack has unexpected keys {sorted(extra)}")

    return pack, sanitized_fields


def _validate_loads(pack_dir: Path) -> None:
    """Validate the just-written candidate pack.json against the real,
    unmodified ``drive_packs.loader._parse_pack`` schema logic — fail closed
    on any error.

    The candidate lives under ``tools/drive-pack-extract/candidates/``, not
    the live served ``mira-bots/shared/drive_packs/packs/`` tree, so the
    loader's own ``load_pack(pack_id)`` (which only reads the co-located live
    tree) can't be used directly. Instead we read the candidate JSON
    ourselves and hand it to the loader's own ``_parse_pack`` — identical
    validation code, just not gated behind the loader's hardcoded directory
    lookup. This mirrors what the grading harness's ``schema_check.py``
    already does for the same reason.
    """
    shared_dir = str(_SHARED_DIR)
    if shared_dir not in sys.path:
        sys.path.insert(0, shared_dir)
    from drive_packs.loader import _parse_pack  # noqa: PLC0415

    pack_json_path = pack_dir / "pack.json"
    raw = json.loads(pack_json_path.read_text(encoding="utf-8"))
    pack = _parse_pack(raw, PACK_ID, str(pack_json_path))
    return pack


def _write_provenance_md(
    pack_dir: Path,
    *,
    manual_path: Path,
    manual_sha256: str,
    fault_count: int,
    param_count: int,
    git_sha: str,
    sanitized_fields: list[str] | None = None,
) -> Path:
    content = f"""# PowerFlex 525 pack — provenance

**Status: STAGED CANDIDATE — validated + graded here, NOT deployed.** This
file records how the candidate `pack.json` in this directory
(`tools/drive-pack-extract/candidates/powerflex_525/`) was generated. This
location is NOT the live served `mira-bots/shared/drive_packs/packs/` tree —
`resolve_pack()` cannot see it. Grading happens against this candidate;
promotion into the live `packs/` tree is a SEPARATE, later, human-gated
deploy step (train-before-deploy), not asserted or performed here.

- Vendor: Rockwell Automation
- Family: PowerFlex 525 (520-series)
- Publication: {DOC_LABEL}
- Revision: O
- Date: September 2025
- Source filename: `{manual_path.name}`
- Source sha256: `{manual_sha256}`
- Source PDF is **NOT committed to git** (proprietary Rockwell manual, ~34MB;
  see `tools/drive-pack-extract/.gitignore`).

## Page ranges used

- Fault-code table: pp. 161-165
- Parameter grid layout: pp. 65-66
- Parameter labeled-block layout: pp. 98-103

## Extraction command

```
extractor.extract(
    "{manual_path.name}",
    doc="{DOC_LABEL}",
    fault_pages=list(range(161, 166)),
    param_pages={PARAM_PAGES},
)
```

Run via `python generate_pf525_pack.py --manual <path-to-manual>` from
`tools/drive-pack-extract/`.

## Tooling provenance

- Extractor source git short-sha: `{git_sha}` (`tools/drive-pack-extract/extractor.py`
  at generation time)
- Generation date: <fill at generation>

## Result counts

- Fault codes extracted (cite-integrity verified): {fault_count}
- Parameters extracted (cite-integrity verified): {param_count}

## Sanitized fields (nulled as unreliable bleed)

"""
    if sanitized_fields:
        content += f"{len(sanitized_fields)} field(s) were nulled as cross-row bleed:\n\n"
        for field in sorted(sanitized_fields):
            content += f"- `{field}`\n"
    else:
        content += "No fields were nulled as bleed.\n"

    content += """

## Notes

- `live_decode.status_bits`, `live_decode.cmd_word`, `live_decode.registers`,
  and `envelope` are intentionally EMPTY — PF525 has no bench data yet. No
  register address or command-word bit was invented.
- `keypad_navigation` is intentionally EMPTY — the extractor found no clean,
  citable keypad button-press procedure in the targeted page ranges. An
  empty list is honest; it is not hand-authored.
- Every fault_code and parameter entry passed `cite_integrity` verification
  against the real manual (unverifiable entries are dropped by the
  extractor before this script ever sees them).
"""
    path = pack_dir / "PROVENANCE.md"
    path.write_text(content, encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manual",
        required=True,
        type=Path,
        help="Path to the real PowerFlex 525 manual PDF (520-UM001O-EN-E). "
        "Never hardcoded — pass the local scratch/download path.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=_DEFAULT_PACKS_DIR,
        help="STAGED CANDIDATE parent directory to write into — NOT the live "
        f"served packs/ tree (default: {_DEFAULT_PACKS_DIR}). Promotion into "
        "mira-bots/shared/drive_packs/packs/ is a separate, human-gated step.",
    )
    args = parser.parse_args()

    manual_path: Path = args.manual.resolve()
    if not manual_path.is_file():
        print(f"ERROR: manual not found at {manual_path}", file=sys.stderr)
        return 1

    print(f"Manual: {manual_path}")
    manual_sha256 = _sha256(manual_path)
    print(f"sha256: {manual_sha256}")
    if manual_sha256 != KNOWN_MANUAL_SHA256:
        print(
            "NOTE: sha256 does not match the previously-verified manual "
            f"({KNOWN_MANUAL_SHA256}) — proceeding anyway (not enforced), "
            "but double-check this is the intended edition.",
        )

    print(
        f"Extracting faults (pp.{FAULT_PAGES[0]}-{FAULT_PAGES[-1]}) + "
        f"parameters (pp.{PARAM_PAGES})..."
    )
    fragment = extractor.extract(
        manual_path,
        doc=DOC_LABEL,
        fault_pages=FAULT_PAGES,
        param_pages=PARAM_PAGES,
    )

    pack, sanitized_fields = _build_pack(fragment)

    pack_dir = args.out / PACK_ID
    pack_dir.mkdir(parents=True, exist_ok=True)
    pack_json_path = pack_dir / "pack.json"
    pack_json_path.write_text(
        json.dumps(pack, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {pack_json_path}")

    if sanitized_fields:
        print(f"Sanitized {len(sanitized_fields)} field(s): {', '.join(sanitized_fields)}")

    fault_count = len(pack["live_decode"]["fault_codes"])
    param_count = len(pack["parameters"])
    git_sha = _git_short_sha()

    provenance_path = _write_provenance_md(
        pack_dir,
        manual_path=manual_path,
        manual_sha256=manual_sha256,
        fault_count=fault_count,
        param_count=param_count,
        git_sha=git_sha,
        sanitized_fields=sanitized_fields,
    )
    print(f"Wrote {provenance_path}")

    print("Validating candidate against drive_packs.loader._parse_pack(...) ...")
    try:
        _validate_loads(pack_dir)
    except Exception as exc:  # noqa: BLE001 — fail closed, report, exit non-zero
        print(f"ERROR: schema validation of '{PACK_ID}' candidate failed: {exc}", file=sys.stderr)
        return 1

    print(f"OK: schema validation of '{PACK_ID}' candidate succeeded.")
    print(f"Fault codes: {fault_count}")
    print(f"Parameters: {param_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
