"""Publish: a maintenance event serializes onto its UNS-shaped topic."""
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
import topics  # noqa: E402


def _conv():
    cmodel, _, _ = eb.build_brain()
    conv = next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")
    return cmodel, conv


def test_topic_is_uns_shaped():
    cmodel, conv = _conv()
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)
    t = topics.topic_for_event(ev)
    assert t == conv.uns_path.replace(".", "/") + "/events"
    assert "synthetic_beverage_co/demo_site/bottling/bottlingline1/conveyor01/events" == t


def test_publish_logs_serialized_event():
    cmodel, conv = _conv()
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)
    transport = bk.InMemoryBroker()
    pub = pub_mod.Publisher(transport)
    topic, payload, delivered = pub.publish_event(ev)
    assert delivered == 0  # no subscribers yet
    assert transport.log == [(topic, payload)]
    assert payload == ev.to_json()


def test_payload_carries_enough_to_reconstruct_observation():
    cmodel, conv = _conv()
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)
    obs = eb.observation_from_event(ev)
    assert obs.abnormal and obs.symptom == "line_blocked"
    assert any("photoeye" in s for s in obs.abnormal)
