"""The offline refusal classifier must stay byte-identical to notebook chat's (#4576).

If someone changes ``isRefusal``'s patterns in route.ts, every refusal number this
tool reports would silently disagree with production. This test fails first.
"""

from __future__ import annotations

import json
import shutil
import subprocess
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


HUB_CASES = "mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/answer-hygiene.test.ts"
_CASE_RE = re.compile(r'expect\(isRefusal\(("(?:[^"\\]|\\.)*")\)\)\.toBe\((true|false)\)')


def _hub_cases() -> list[tuple[str, bool]]:
    src = (ROOT / HUB_CASES).read_text()
    return [(json.loads(lit), want == "true") for lit, want in _CASE_RE.findall(src)]


def test_port_agrees_with_every_literal_isrefusal_case_in_the_hub_tests():
    cases = _hub_cases()
    assert len(cases) >= 20, f"expected the hub's literal isRefusal cases, found {len(cases)}"
    wrong = [(t, want) for t, want in cases if refusal.is_refusal(t) != want]
    assert not wrong, wrong


_UNICODE_EDGES = [
    "écan't find the torque in the manual.",
    "Ñcannot find this in the provided manual.",
    "The manual doesn't cover the procédure.",
    "naïve: the excerpts do not specify the torque.",
    "The loaded excerpts do not give the value. " + "😀" * 170,
    "The loaded excerpts do not give the value. " + "😀" * 190,
    "The loaded excerpts do not give the value. I can't confirm it from the documents.",
    "İ CAN'T FIND THIS IN THE SUPPLIED MANUAL.",
    "Ｔhe manual does not list it.",
    "The excerpts ﬁnd nothing; the manual does not specify the torque.",
]


def _node_is_refusal(texts: list[str]) -> list[bool]:
    """Run production's own isRefusal source (extracted from route.ts) under node."""
    src = (ROOT / refusal.ROUTE_TS).read_text()
    parts = [re.search(rf"const {n} =\s*/.*/[a-z]*;\n", src).group(0) for n in refusal.PATTERNS]
    for head in (
        "function refusalText(",
        "function refusalPhraseIn(",
        "export function isRefusal(",
    ):
        start = src.index(head)
        parts.append(src[start : src.index("\n}\n", start) + 3])
    js = "\n".join(parts).replace("export function", "function")
    js = re.sub(r"\((\w+): string\): (?:string|boolean) \{", r"(\1) {", js)
    script = js + "\nconst t = JSON.parse(require('fs').readFileSync(0, 'utf8'));\n"
    script += "process.stdout.write(JSON.stringify(t.map(isRefusal)));\n"
    out = subprocess.run(
        ["node", "-e", script], input=json.dumps(texts), capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_port_matches_production_isrefusal_executed_in_node():
    texts = [t for t, _ in _hub_cases()] + _UNICODE_EDGES
    want = _node_is_refusal(texts)
    got = [refusal.is_refusal(t) for t in texts]
    diff = [(t, w) for t, w, g in zip(texts, want, got) if w != g]
    assert not diff, diff
