"""The offline refusal classifier must stay byte-identical to notebook chat's (#4576).

If someone changes ``isRefusal``'s patterns in route.ts, every refusal number this
tool reports would silently disagree with production. This test fails first.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from retrieval_eval import refusal

ROOT = Path(__file__).resolve().parents[2]


def _route_literals() -> dict[str, str]:
    src = (ROOT / refusal.ROUTE_TS).read_text()
    out = {}
    for name in refusal.PATTERNS:
        m = re.search(rf"const {name} =\s*/(.*)/[a-z]*;\n", src)
        assert m, f"{name} not found in {refusal.ROUTE_TS}"
        out[name] = m.group(1)
    return out


def test_patterns_match_route_ts_byte_for_byte():
    assert _route_literals() == refusal.PATTERNS


def test_is_refusal_still_has_the_shape_this_port_assumes():
    src = (ROOT / refusal.ROUTE_TS).read_text()
    body = src[src.index("export function isRefusal") :][:600]
    assert "refusalPhraseIn(a) && EVIDENCE_PHRASE_RE.test(a) && a.length < 400" in body


@pytest.mark.parametrize(
    "text",
    [
        "The loaded excerpts do not give the recommended tightening torque for the motor foot bolts.",
        "The supplied manual does not cover that procedure.",
        "I can’t confirm that from the provided documents.",
    ],
)
def test_honest_refusals(text):
    assert refusal.is_refusal(text)


@pytest.mark.parametrize(
    "text",
    [
        # An instruction that opens with "Do not" is not the model declining.
        "Do not open the cover until the DC bus has discharged. The manual lists 5 minutes [1].",
        # A substantive answer with no refusal phrase.
        "ocA means over-current during acceleration; increase the acceleration time [2].",
        # A refusal phrase buried in a long answer is an answer that qualified itself.
        "x" * 400 + " The manual does not specify the torque.",
    ],
)
def test_not_refusals(text):
    assert not refusal.is_refusal(text)
