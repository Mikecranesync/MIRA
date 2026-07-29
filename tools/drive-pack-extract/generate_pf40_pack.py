"""Generate the STAGED CANDIDATE PowerFlex 40 drive pack from the real manual.

Offline, one-shot run: point this at the real, licensed PowerFlex 40 User Manual
(``22b-um001.pdf``, pub 22B-UM001J-EN-E — never committed, see ``.gitignore`` in
this directory) and it produces a full ``pack.json`` candidate for
``tools/drive-pack-extract/candidates/powerflex_40/`` — a STAGED, non-served
location. This candidate is validated and graded in place; it is NOT the live
``packs/`` tree the runtime resolver reads. Promotion into the live
``mira-bots/shared/drive_packs/packs/powerflex_40/`` (where ``resolve_pack()``
can return it in production) is a SEPARATE, human-gated deploy step — see
``docs/drive-commander/runbook-pr-b-acceptance.md`` — not something this script
performs. (`.claude/rules/train-before-deploy.md`.)

Structurally identical to ``generate_pf525_pack.py`` (the same reusable
``extractor.extract()`` + assembly + sanitize + validate flow); only the
manual identity, page ranges, and family/nameplate wrapper differ. It does NOT
modify ``extractor.py``, ``cite_integrity.py``, or any runtime code under
``mira-bots/shared/drive_packs/``.

Read-only w.r.t. the source PDF; the only writes are the candidate ``pack.json``
+ ``PROVENANCE.md`` it creates. No fieldbus, no network, no DB
(`.claude/rules/fieldbus-readonly.md`).

IMPORTANT: this produces a STAGED CANDIDATE, not a trusted or deployed pack.
Trust/grading is a separate step (``tools/drive-pack-extract/grading/``); promotion
to the live ``packs/`` tree is a separate, later, human-gated step.
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

PACK_ID = "powerflex_40"
DOC_LABEL = "PowerFlex 40 Adjustable Frequency AC Drive User Manual (22B-UM001J-EN-E)"
FAULT_PAGES = [93, 94, 95]
# Motor nameplate/limit params (p.53) + comm/Advanced Program params (p.76). The
# p.76 comm group carries the headline F81 -> A105 [Comm Loss Action] link. The
# analog-scaling group (p.77, A109-A112, "0.0%"-style glued defaults) and the
# graph-callout pages (e.g. p.71 with the "A034 [Minimum Freq]" typo) are
# deliberately EXCLUDED — precision over recall — declared as residuals rather
# than shipping thin/ambiguous values (the same discipline as PF525's page-98
# exclusion).
PARAM_PAGES = [53, 76]

# Known-good sha256 of the real manual this script targets — printed for the
# operator to confirm, NEVER enforced (a future manual edition should still
# be usable; this is a sanity signal, not a gate).
KNOWN_MANUAL_SHA256 = "15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9"

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

    d = param.get("default")
    if isinstance(d, str):
        foreign = [m for m in _FOREIGN_ID_RE.findall(d) if m.upper() != own]
        if "=" in d or "(PowerFlex 4" in d or foreign:
            param["default"] = None
            nulled.append(f"{pid}.default")

    u = param.get("unit")
    if isinstance(u, str) and u.strip() and u.strip() not in _KNOWN_UNITS:
        param["unit"] = None
        nulled.append(f"{pid}.unit")

    r = param.get("range")
    if isinstance(r, str) and not _RANGE_RE.match(r.strip()):
        param["range"] = None
        nulled.append(f"{pid}.range")

    return nulled


def _related_parameters_map(manual_path: Path) -> dict[str, list[str]]:
    """Build ``{parameter_id: related_parameters}`` from the manual's raw,
    per-parameter "Related Parameters:" line — the param<->param link that
    ``extractor.assemble_pack_fragment`` intentionally drops (it carries only
    ``related_faults``). Read-only, same page range as the main extraction."""
    raw_params = extractor.parse_parameters(manual_path, pages=PARAM_PAGES)
    return {
        entry["parameter_id"]: list(entry.get("related_parameters", [])) for entry in raw_params
    }


def _coerce_parameters(
    parameters: list[dict[str, Any]],
    related_parameters_map: dict[str, list[str]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    related_parameters_map = related_parameters_map or {}
    out = []
    all_nulled = []
    for param in parameters:
        param = dict(param)
        citation = dict(param.get("source_citation") or {})
        if "page" in citation and citation["page"] is not None:
            citation["page"] = str(citation["page"])
        param["source_citation"] = citation

        nulled = _sanitize_param_bleed(param)
        all_nulled.extend(nulled)

        param["related_parameters"] = related_parameters_map.get(param.get("parameter_id", ""), [])
        out.append(param)

    seen: dict[str, int] = {}
    for p in out:
        pid = p.get("parameter_id", "")
        seen[pid] = seen.get(pid, 0) + 1
    dupes = sorted(pid for pid, n in seen.items() if n > 1)
    if dupes:
        raise RuntimeError(
            f"duplicate parameter_id(s) {dupes} in extracted params — "
            "narrow PARAM_PAGES to exclude the offending multi-column page(s) "
            "or harden the extractor. Refusing to emit a duplicate pack."
        )
    return out, all_nulled


def _build_pack(
    fragment: dict[str, Any],
    related_parameters_map: dict[str, list[str]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    fault_codes = fragment["fault_codes"]
    fault_citations = fragment["fault_citations"]
    parameters, sanitized_fields = _coerce_parameters(
        fragment["parameters"], related_parameters_map
    )

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
            "series": "PowerFlex 40",
            "aliases": [
                "powerflex 40",
                "pf40",
                "pf 40",
                "powerflex 22b",
                "22b",
            ],
        },
        "nameplate": {
            "match_keywords": ["powerflex 40", "pf40", "22b-um001", "22b"],
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
    unmodified ``drive_packs.loader._parse_pack`` schema logic — fail closed."""
    shared_dir = str(_SHARED_DIR)
    if shared_dir not in sys.path:
        sys.path.insert(0, shared_dir)
    from drive_packs.loader import _parse_pack  # noqa: PLC0415

    pack_json_path = pack_dir / "pack.json"
    raw = json.loads(pack_json_path.read_text(encoding="utf-8"))
    return _parse_pack(raw, PACK_ID, str(pack_json_path))


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
    content = f"""# PowerFlex 40 pack — provenance

**Status: STAGED CANDIDATE — validated + graded here, NOT deployed.** This
file records how the candidate `pack.json` in this directory
(`tools/drive-pack-extract/candidates/powerflex_40/`) was generated. This
location is NOT the live served `mira-bots/shared/drive_packs/packs/` tree —
`resolve_pack()` cannot see it. Grading happens against this candidate;
promotion into the live `packs/` tree is a SEPARATE, later, human-gated deploy
step (train-before-deploy), not asserted or performed here.

- Vendor: Rockwell Automation
- Family: PowerFlex 40 (22B)
- Publication: {DOC_LABEL}
- Revision: J
- Date: September 2025
- Source filename: `{manual_path.name}`
- Source sha256: `{manual_sha256}`
- Source PDF is **NOT committed to git** (proprietary Rockwell manual, ~6.5MB;
  see `tools/drive-pack-extract/.gitignore`).

## Page ranges used

- Fault-code table: pp. 93-95 (Table 10 – Fault Types, Descriptions, and Actions)
- Parameter pages: p. 53 (motor nameplate/limits) + p. 76 (comm / Advanced Program)

## Extraction command

```
extractor.extract(
    "{manual_path.name}",
    doc="{DOC_LABEL}",
    fault_pages={FAULT_PAGES},
    param_pages={PARAM_PAGES},
)
```

Run via `python generate_pf40_pack.py --manual <path-to-manual>` from
`tools/drive-pack-extract/`.

## Tooling provenance

- Extractor source git short-sha: `{git_sha}` (`tools/drive-pack-extract/extractor.py`
  at generation time)
- Generation date: <fill at generation>

## Result counts

- Fault codes extracted (cite-integrity verified): {fault_count}
- Parameters extracted (cite-integrity verified): {param_count}

## Headline cross-vendor proof

- **F81 [Comm Loss] -> A105 [Comm Loss Action]** — the fault's action text
  "Turn off using A105 [Comm Loss Action]" makes A105.related_faults include
  F81. The Allen-Bradley PowerFlex 40 analog of GS10 CE10->P09.03 and
  PowerFlex 525 F081->C125.

## Sanitized fields (nulled as unreliable bleed)

"""
    if sanitized_fields:
        content += f"{len(sanitized_fields)} field(s) were nulled as cross-row bleed:\n\n"
        for field in sorted(sanitized_fields):
            content += f"- `{field}`\n"
    else:
        content += "No fields were nulled as bleed.\n"

    content += """
## Declared residuals

- Worded/conditional defaults (P031 [Motor NP Volts], P033 [Motor OL Current] =
  "Based on Drive Rating") are emitted as `null` — honest, not a miss.
- Shared-group fault continuations (F39/F40, F42/F43) and a few informational
  faults (F48/F71/F80) carry no own Fault-Type glyph; they are emitted with
  `fault_type "—"` (not fabricated). `fault_type` is not carried into the pack.
- The analog-scaling param group (p.77) and graph-callout pages (p.71 "A034
  [Minimum Freq]" typo) are excluded from the param page range — precision over
  recall.

## Notes

- `live_decode.status_bits`, `live_decode.cmd_word`, `live_decode.registers`,
  and `envelope` are intentionally EMPTY — PF40 has no bench data yet. No
  register address or command-word bit was invented.
- `keypad_navigation` is intentionally EMPTY — the extractor found no clean,
  citable keypad button-press procedure in the targeted page ranges.
- Every fault_code and parameter entry passed `cite_integrity` verification
  against the real manual (unverifiable entries are dropped by the extractor
  before this script ever sees them).
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
        help="Path to the real PowerFlex 40 manual PDF (22B-UM001J-EN-E). "
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

    print(f"Extracting faults (pp.{FAULT_PAGES}) + parameters (pp.{PARAM_PAGES})...")
    fragment = extractor.extract(
        manual_path,
        doc=DOC_LABEL,
        fault_pages=FAULT_PAGES,
        param_pages=PARAM_PAGES,
    )

    print("Recovering related_parameters (manual-stated param<->param link)...")
    related_parameters_map = _related_parameters_map(manual_path)

    pack, sanitized_fields = _build_pack(fragment, related_parameters_map)

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
