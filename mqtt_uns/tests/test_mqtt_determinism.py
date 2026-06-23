"""Determinism: same event + same brain -> same MQTT message, same answer card, same replay metrics."""
from __future__ import annotations

import sys
from pathlib import Path

_MU = Path(__file__).resolve().parents[1]
_ROOT = _MU.parent
for _p in (str(_MU), str(_ROOT / "evidence_graph"), str(_ROOT / "causality"),
           str(_ROOT / "factory_context"), str(_ROOT / "discovery_corpus" / "scripts"),
           str(_ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import broker as bk  # noqa: E402
import components as comp  # noqa: E402
import event_bridge as eb  # noqa: E402
import publisher as pub_mod  # noqa: E402
import replay as rp  # noqa: E402
import subscriber as sub_mod  # noqa: E402


def _conv(cmodel):
    return next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")


def test_event_serialization_is_stable():
    cmodel, _, _ = eb.build_brain()
    a = eb.event_from_scenario(cmodel, "photoeye_blocked", _conv(cmodel).uns_path).to_json()
    cmodel2, _, _ = eb.build_brain()
    b = eb.event_from_scenario(cmodel2, "photoeye_blocked", _conv(cmodel2).uns_path).to_json()
    assert a == b


def test_same_event_same_card_every_publish():
    cmodel, graph, history = eb.build_brain()
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", _conv(cmodel).uns_path)
    cards = []
    for _ in range(5):
        transport = bk.InMemoryBroker()
        sub = sub_mod.Subscriber(transport, "#")
        pub_mod.Publisher(transport).publish_event(ev)
        _, received = sub.received[0]
        _, card = eb.explain_event(graph, history, received)
        cards.append(card)
    assert len(set(cards)) == 1


def test_replay_invariants_are_100pct():
    cmodel, graph, history = eb.build_brain()
    m = rp.run_replay(cmodel, graph, history, repeats=6)
    assert m["total_replays"] >= 100
    assert m["mqtt_match_pct"] == 100.0
    assert m["determinism_pct"] == 100.0
    assert m["citation_complete_pct"] == 100.0
    assert m["transport_failures"] == 0
    assert m["answer_card_mismatches"] == 0
