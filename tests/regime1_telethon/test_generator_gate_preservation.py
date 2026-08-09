"""A gate a generator silently drops is a contract that was never graded.

`mutators.INTENTS` declares `gate="identifying_question"` on the two
symptom-report intents. `generate()` then rebuilt every turn as

    dict(send=send, expect=t.get("expect", []), forbid=t.get("forbid", []))

which keeps three keys and discards the rest — including `gate`. Combined with
those intents carrying `expect=[]` (correct on its own: they are graded by
BEHAVIOUR, not vocabulary), the emitted turn had:

  * no gate            -> the behavioural contract never ran
  * empty expect       -> `grade_turn` skips the expect branch entirely
  * forbid ['[Source:'] -> the only surviving assertion

So the scenario asserted "MIRA did not emit a [Source: tag" and nothing else.
The identifying-question behaviour it exists to prove was ungraded, and the cell
was green either way.

That is what makes this the expensive kind of bug: it fails in the OPTIMISTIC
direction, exactly like every other reporting defect this campaign has found.
A 5-seed run reported `t1:symptom_report` at STABLE_PASS 100% (up from FLAKY 50%
on the previous build) and that delta was read as evidence a product fix had
landed. It was not evidence of anything — the scenario had become unfailable
between the two builds.

These tests are generator-agnostic on purpose. Every tier added from here
inherits the same trap the moment its generate() rebuilds turn dicts by hand.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from tests.regime1_telethon.campaign import gates  # noqa: E402

# Every scripted generator the runner can dispatch. A new scripted tier MUST be
# added here — that is the point of the test.
SCRIPTED_GENERATORS = ["mutators", "state_attacks", "work_order_lifecycle"]


def _module(name: str):
    return importlib.import_module(f"tests.regime1_telethon.campaign.{name}")


def _declared_gates(mod) -> set[str]:
    """Gate names declared in a module's static scenario data."""
    found: set[str] = set()

    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("gate"):
                found.add(obj["gate"])
            for v in obj.values():
                walk(v)
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                walk(v)

    for attr in dir(mod):
        if attr.startswith("__"):
            continue
        walk(getattr(mod, attr))
    return found


@pytest.mark.parametrize("gen_name", SCRIPTED_GENERATORS)
class TestGeneratorsPreserveDeclaredGates:
    def test_every_declared_gate_survives_generate(self, gen_name):
        """The load-bearing assertion.

        If a module's static data declares a gate anywhere, at least one emitted
        turn must carry it. Otherwise the declaration is decoration and the
        scenario is graded by whatever is left over.
        """
        mod = _module(gen_name)
        declared = _declared_gates(mod)
        if not declared:
            pytest.skip(f"{gen_name} declares no gates")
        emitted = set()
        for sc in mod.generate(42, 20):
            for turn in sc["turns"]:
                if turn.get("gate"):
                    emitted.add(turn["gate"])
        missing = declared - emitted
        assert not missing, (
            f"{gen_name}.generate() DROPPED declared gate(s) {sorted(missing)} — "
            "those turns run ungraded and their scenarios cannot fail"
        )

    def test_every_emitted_gate_is_registered(self, gen_name):
        """A gate that survives generate() but is not in TURN_GATES would raise
        mid-campaign, after live Telegram traffic has been spent."""
        mod = _module(gen_name)
        for sc in mod.generate(42, 20):
            for turn in sc["turns"]:
                if turn.get("gate"):
                    gates.resolve_turn_gate(turn["gate"])

    def test_no_turn_is_completely_ungraded(self, gen_name):
        """expect=[] is legitimate ONLY when a gate carries the contract.

        A turn with no gate, no expect and no forbid asserts nothing at all: it
        spends a live Telegram round-trip to produce a guaranteed PASS.
        """
        mod = _module(gen_name)
        ungraded = [
            (sc["id"], i)
            for sc in mod.generate(42, 20)
            for i, turn in enumerate(sc["turns"], 1)
            if not turn.get("gate") and not turn.get("expect") and not turn.get("forbid")
        ]
        assert not ungraded, f"{gen_name}: turns that assert nothing: {ungraded}"


class TestTheSymptomReportRegression:
    """Pins the specific scenario whose green cell was mistaken for evidence."""

    def test_symptom_report_carries_its_behavioural_gate(self):
        mod = _module("mutators")
        turns = [
            t for sc in mod.generate(42, 20) if "symptom_report" in sc["id"] for t in sc["turns"]
        ]
        assert turns, "no symptom_report scenarios generated"
        assert all(t.get("gate") == "identifying_question" for t in turns), (
            "symptom_report is graded by behaviour, not vocabulary — without the gate "
            "its expect=[] makes the scenario unfailable"
        )
