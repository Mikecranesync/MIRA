"""Run-B independent adversarial audit — multi-line fault-cell bleed regression.

Ground-truthed against the real IMPULSE G+ Mini Technical Manual (144-25085,
sha256 56075883…00be), p.138. Five fault entries whose Name/Description cell
wraps across multiple lines have description text bleeding into the `name` and
`action` fields (the wrap line sits past `action_x0` and is mis-binned into the
action column; the name loses its numeric suffix).

Confirmed by the audit (2026-07-16):
- oH3 name should be "Motor Overheating 1"  (was "Motor Overheating detected motor overheating")
- oH4 name should be "Motor Overheating 2"  (was identical to oH3 — the 1/2 distinction was lost)
- LL1 name should start "Lower Limit 1—SLOW DOWN"  (was "Lower Limit 1—SLOW Limit 1—SLOW DOWN changed)")
- LL2 name should start "Lower Limit 2—STOP"       (was "Lower Limit 2—STOP 2—STOP is input (switch")
- actions must begin at a real numbered step, not with bled description text.

Params and oPE04 are NOT defective (the parameter audit's 27.9% claim was a
pdftotext linearization artifact; oPE04's name "Parameters do not match" is the
manual text). This test pins only the confirmed fault defects.

Skips cleanly when the manual PDF is absent (it is gitignored / not committed);
run locally after placing it at ``manuals/drives-g-mini-manual.pdf``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent.parent  # tools/drive-pack-extract
_PDF = _HERE / "manuals" / "drives-g-mini-manual.pdf"
sys.path.insert(0, str(_HERE))


pytestmark = [
    pytest.mark.skipif(
        not _PDF.is_file(),
        reason="IMPULSE G+ Mini manual not present (gitignored); place at manuals/ to run",
    ),
    # KNOWN DEFECT (Run-B independent audit, 2026-07-16): multi-line Name/Description
    # cells bleed into name/action. strict=True so this flips to a hard failure the
    # moment the dialect fix lands — that's the signal to delete this marker. The
    # fix is a `magnetek_dialect.parse_magnetek_fault_page` column-geometry rework
    # (desc wrap text past action_x0 is mis-binned into the action column); tracked
    # as the Run-B audit follow-up on #2691.
    pytest.mark.xfail(strict=True, reason="multi-line fault-cell bleed — dialect fix pending (#2691)"),
]


def _extract_faults() -> dict[str, dict]:
    import extractor  # noqa: E402

    frag = extractor.extract(
        str(_PDF), doc="Magnetek IMPULSE G+ Mini Technical Manual (144-25085)"
    )
    return {f["fault_id"]: f for f in frag["fault_entries"]}


def test_oh3_oh4_names_are_distinct_and_carry_their_suffix():
    faults = _extract_faults()
    assert faults["oH3"]["name"] == "Motor Overheating 1", faults["oH3"]["name"]
    assert faults["oH4"]["name"] == "Motor Overheating 2", faults["oH4"]["name"]
    # The historical bug made both identical (lost the 1/2 distinction).
    assert faults["oH3"]["name"] != faults["oH4"]["name"]
    # No description bleed ("detected motor overheating" is desc, not name).
    assert "detected" not in faults["oH3"]["name"].lower()


def test_lower_limit_names_are_not_garbled():
    faults = _extract_faults()
    assert faults["LL1"]["name"].startswith("Lower Limit 1—SLOW DOWN"), faults["LL1"]["name"]
    assert faults["LL2"]["name"].startswith("Lower Limit 2—STOP"), faults["LL2"]["name"]
    # The bug duplicated fragments ("...SLOW Limit 1—SLOW DOWN...").
    assert "SLOW Limit" not in faults["LL1"]["name"]
    assert "STOP 2—STOP" not in faults["LL2"]["name"]


def test_actions_begin_at_a_real_step_not_bled_description():
    faults = _extract_faults()
    for fid in ("LL1", "LL2", "oH3", "oH4", "oL1"):
        action = faults[fid]["action"].strip()
        # A correct corrective-action cell starts with a step number.
        assert action[:2] == "1." or action.startswith("1 "), (fid, action[:60])
