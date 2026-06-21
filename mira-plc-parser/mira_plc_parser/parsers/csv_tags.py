"""CSV tag-export parser -> MIRA PLC IR.

A CSV is not full program logic, but a tag list gives immediate maintenance value (the dictionary,
plus VFD-signal/asset candidates). This adapter REUSES the already-tested vendor-agnostic parser
`ignition/webdev/FactoryLM/api/diagnose/tag_csv.py` (Rockwell/Siemens/Kepware/generic dialects, 18
tests) and maps its canonical records onto IR Tags -- no second CSV parser.

tag_csv lives in the gateway tree and is dual-Py (Jython-safe); it runs fine under CPython 3.12, so
we load it by path rather than duplicating it.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

from ..ir import Confidence, Controller, PLCProject, Provenance, Tag, TagScope

FORMAT = "csv_tags"

# tag_csv.py relative to the repo root (this file: mira-plc-parser/mira_plc_parser/parsers/).
# This resolves in a repo checkout (dev, CLI, the parser's own tests). In a *packaged*
# deployment (e.g. the mira-ingest image, which COPYs only the mira_plc_parser package — not
# the whole repo tree) the `ignition/` tree is absent, so the deployment must bundle tag_csv.py
# and point `MIRA_TAG_CSV_PATH` at it. See `mira-core/mira-ingest/Dockerfile`.
_TAG_CSV_PATH = (
    Path(__file__).resolve().parents[3]
    / "ignition" / "webdev" / "FactoryLM" / "api" / "diagnose" / "tag_csv.py"
)

_tag_csv = None


def _tag_csv_path() -> Path:
    """Resolve tag_csv.py: explicit env override first (packaged deployments), then the
    repo-layout default."""
    env = os.environ.get("MIRA_TAG_CSV_PATH")
    return Path(env) if env else _TAG_CSV_PATH


def _load_tag_csv():
    global _tag_csv
    if _tag_csv is not None:
        return _tag_csv
    path = _tag_csv_path()
    if not path.exists():
        raise FileNotFoundError(
            f"tag_csv.py not found at {path}. In a packaged deployment (no repo tree) bundle "
            f"tag_csv.py and set MIRA_TAG_CSV_PATH to it — see mira-core/mira-ingest/Dockerfile."
        )
    spec = importlib.util.spec_from_file_location("mira_tag_csv_reuse", str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _tag_csv = mod
    return mod


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse a CSV tag export into a PLCProject with a single synthetic controller of tags."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    tc = _load_tag_csv()
    parsed = tc.parse(text)
    for w in parsed.get("warnings", []):
        proj.warnings.append("csv: %s" % w)

    ctrl = Controller(
        name=_controller_name(source_file),
        vendor=_vendor_from_format(parsed.get("format", "generic")),
        software="tag export (%s)" % parsed.get("format", "generic"),
        provenance=Provenance(source_file=source_file, source_format=FORMAT, confidence=Confidence.HIGH),
    )
    for rec in parsed.get("tags", []):
        ctrl.tags.append(_record_to_tag(rec, source_file))
    proj.controllers.append(ctrl)
    return proj


def _record_to_tag(rec: dict, src: str) -> Tag:
    return Tag(
        name=rec.get("name", ""),
        data_type=rec.get("datatype", ""),
        scope=TagScope.CONTROLLER.value,
        description=rec.get("description", ""),
        address=rec.get("address", ""),
        unit=rec.get("unit", ""),
        initial_value=rec.get("sample", ""),
        provenance=Provenance(
            source_file=src, source_format=FORMAT,
            locator="csv:%s" % rec.get("source_format", ""), confidence=Confidence.HIGH,
        ),
    )


def _controller_name(source_file: str) -> str:
    if not source_file:
        return "tag_export"
    return Path(source_file).stem


def _vendor_from_format(fmt: str) -> str:
    return {
        "rockwell_logix": "Rockwell Automation",
        "siemens_tia": "Siemens",
        "kepware": "Kepware / PTC",
    }.get(fmt, "")
