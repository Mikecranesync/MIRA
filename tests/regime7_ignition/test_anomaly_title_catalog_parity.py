"""Workstream C (PRD §9.2): the Hub's technician-facing anomaly titles must be
the canonical rule titles from the single-source A0-A12 brain
(plc/conv_simple_anomaly/rules_core.py), not a raw tag suffix.

Parity test: every `Anomaly("<RULE_ID>", <sev>, "<title>", ...)` literal in
rules_core must appear, byte-identical, in mira-hub/src/lib/anomaly-titles.ts,
and the TS catalog must not carry a rule the brain does not know.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES_CORE = ROOT / "plc" / "conv_simple_anomaly" / "rules_core.py"
TS_CATALOG = ROOT / "mira-hub" / "src" / "lib" / "anomaly-titles.ts"

_PY = re.compile(r'Anomaly\(\s*"(A\d+_[A-Z0-9_]+)"\s*,\s*[a-zA-Z_]+\s*,\s*"([^"]+)"')
_TS = re.compile(r'^\s*([A-Z0-9_]+):\s*"([^"]+)"', re.M)


def _py_titles() -> dict[str, str]:
    return dict(_PY.findall(RULES_CORE.read_text(encoding="utf-8")))


def _ts_titles() -> dict[str, str]:
    assert TS_CATALOG.exists(), f"missing catalog: {TS_CATALOG}"
    return dict(_TS.findall(TS_CATALOG.read_text(encoding="utf-8")))


def test_every_rule_title_is_in_the_hub_catalog_verbatim():
    py, ts = _py_titles(), _ts_titles()
    assert len(py) >= 10, "rules_core parse failed - regex needs updating"
    missing = {k: v for k, v in py.items() if ts.get(k) != v}
    assert not missing, f"Hub catalog drifted from rules_core: {missing}"


def test_hub_catalog_has_no_unknown_rules():
    unknown = set(_ts_titles()) - set(_py_titles())
    assert not unknown, f"Hub catalog names rules the brain does not define: {unknown}"


def test_no_title_is_a_raw_tag_or_pseudo_topic():
    for rule, title in _ts_titles().items():
        assert not re.search(r"(^|\s)_[a-z_]+|\[default\]|MIRA_IOCheck|vfd/vfd101", title), (
            rule,
            title,
        )
