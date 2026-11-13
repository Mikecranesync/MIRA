"""Mission control v2 (#4737): parsing `[DELIVERY-UPDATE: LANE]` agent reports.

The contract is DELIVERY.md (PR #5314). Synthetic fixtures only; the shapes are
modelled on real #5232 comments (lane comments carry nested history in <details>).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


reports = _load("mission_control_reports", MC / "reports.py")

GOOD = """[DELIVERY-UPDATE: BRAVO-CLAUDE]
Updated: 2026-11-12T23:10:00Z; session: abc123; claim: https://github.com/o/r/issues/4737#issuecomment-1
Plan read: https://github.com/o/r/blob/deadbeef/DELIVERY.md; acknowledgment: PROPOSED
Goal / slice: Mission Control v2 #4737; branch / SHA: bravo/mission-control-v2 / 0123456789abcdef0123456789abcdef01234567
State: ACTIVE
Evidence: NOT TESTED — candidate runs on loopback only
Stage: local
Changed: store, poll and reports modules added
Next: signed webhook replay; target: not agreed
Blocked by / needs: Mike to merge #4985
Decision for Mike: merge #4985 and #5314
"""

# Shaped like the real top-of-comment prose seen on #5232: a marker, an Updated line,
# free text, and the only template-shaped block buried in <details> as history.
PROSE_WITH_NESTED_HISTORY = """[DELIVERY-UPDATE: BRAVO-CODEX]
Updated: 2026-11-08 22:37:35 UTC; session: 01a1bb3d
Current request: investigate #5289 recurrence.
Verdict: #5289 NOT FIXED / NOT ACCEPTED.

<details><summary>Previous checkpoint — historical</summary>

[DELIVERY-UPDATE: BRAVO-CODEX]
Updated: 2026-11-08T15:12:20.927719+00:00; session: 01a1bb3d
Goal / slice: shared delivery coordination #5314; branch / SHA: docs/x / 24e43e49446dee5c90f117d246733b8223756009
State: HANDOFF
Evidence: VERIFIED — checks pass
Stage: review/CI
Next: nothing

</details>
"""


def test_full_template_block_parses_every_field():
    r = reports.parse(GOOD)
    assert r is not None
    assert r["lane"] == "BRAVO-CLAUDE"
    assert r["state"] == "ACTIVE"
    assert r["evidence"] == "NOT TESTED"
    assert r["stage"] == "local"
    assert r["sha"] == "0123456789abcdef0123456789abcdef01234567"
    assert r["goal"].startswith("Mission Control v2 #4737")
    assert r["next"].startswith("signed webhook replay")
    assert r["blocked_by"] == "Mike to merge #4985"
    assert r["decision"] == "merge #4985 and #5314"
    assert r["items"] == [4737, 4985, 5314]  # every #n mentioned, deduped, in order


def test_block_without_the_marker_is_not_a_report():
    assert reports.parse("Updated: 2026-11-12T23:10:00Z\nState: ACTIVE\n") is None


@pytest.mark.parametrize("field", ["State", "Evidence", "Stage"])
def test_missing_enum_field_reads_not_stated_never_a_value(field):
    body = "\n".join(ln for ln in GOOD.splitlines() if not ln.startswith(field + ":")) + "\n"
    r = reports.parse(body)
    assert r is not None  # still a report: the marker + Updated line are present
    assert r[field.lower()] == "not stated"


@pytest.mark.parametrize(
    ("line", "key"),
    [
        ("State: NOT ACCEPTED — repair published", "state"),
        ("Evidence: PASSED", "evidence"),
        ("Stage: prod", "stage"),
    ],
)
def test_values_outside_the_enum_are_unparsed_not_coerced(line, key):
    body = "\n".join(
        line if ln.split(":")[0] == line.split(":")[0] else ln for ln in GOOD.splitlines()
    )
    assert reports.parse(body + "\n")[key] == "unparsed"


def test_nested_history_in_details_never_surfaces_as_the_current_state():
    r = reports.parse(PROSE_WITH_NESTED_HISTORY)
    assert r is not None and r["lane"] == "BRAVO-CODEX"
    assert r["state"] == "not stated"  # the top block has no State line
    assert r["stage"] == "not stated"  # HANDOFF / review/CI belong to history
    assert r["sha"] is None


def test_crlf_bodies_parse_the_same():
    assert reports.parse(GOOD.replace("\n", "\r\n"))["state"] == "ACTIVE"


def test_updated_line_is_required():
    body = "\n".join(ln for ln in GOOD.splitlines() if not ln.startswith("Updated:")) + "\n"
    assert reports.parse(body) is None


def test_a_marker_that_only_appears_inside_details_is_not_a_current_report():  # F8 (Codex r1)
    body = (
        "Current prose: nothing new since yesterday.\n\n<details><summary>history</summary>\n\n"
        "[DELIVERY-UPDATE: BRAVO-CODEX]\nUpdated: 2026-11-08T15:12:20Z\nState: COMPLETE\n\n</details>\n"
    )
    assert reports.parse(body) is None
    assert reports.parse(PROSE_WITH_NESTED_HISTORY) is not None  # control: top-level marker
