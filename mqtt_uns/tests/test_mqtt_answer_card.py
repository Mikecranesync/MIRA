"""The Phase 4 success condition: the answer card produced THROUGH MQTT matches the offline card."""
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

import answer_card as ac  # noqa: E402
import broker as bk  # noqa: E402
import components as comp  # noqa: E402
import event_bridge as eb  # noqa: E402
import publisher as pub_mod  # noqa: E402
import subscriber as sub_mod  # noqa: E402

_BRAIN = eb.build_brain()


def _round_trip(event):
    cmodel, graph, history = _BRAIN
    _, offline_card = eb.explain_event(graph, history, event)
    transport = bk.InMemoryBroker()
    sub = sub_mod.Subscriber(transport, "#")
    pub_mod.Publisher(transport).publish_event(event)
    _, received = sub.received[0]
    exp, mqtt_card = eb.explain_event(graph, history, received)
    return offline_card, mqtt_card, exp


def _conv():
    cmodel, _, _ = _BRAIN
    return next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")


def test_flagship_card_matches_offline():
    cmodel, _, _ = _BRAIN
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", _conv().uns_path)
    offline, mqtt, exp = _round_trip(ev)
    assert mqtt == offline                                   # transport changed nothing
    for s in ac.REQUIRED_SECTIONS:
        assert s in mqtt
    assert exp.hypotheses[0].mode_id == "photoeye_blocked"
    assert "Photoeye blocked: TRUE" in mqtt


def test_contradiction_survives_transport():
    cmodel, _, _ = _BRAIN
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", _conv().uns_path, conflicting=True)
    offline, mqtt, exp = _round_trip(ev)
    assert mqtt == offline
    assert "lowered by contradicting evidence" in mqtt
    assert exp.hypotheses[0].mode_id == "photoeye_blocked"


def test_sensor_drift_on_tank_matches_offline():
    cmodel, _, _ = _BRAIN
    tank = next(a for a in cmodel.assets() if comp.classify_asset(a) == "tank")
    ev = eb.event_from_scenario(cmodel, "sensor_drift", tank.uns_path)
    offline, mqtt, exp = _round_trip(ev)
    assert mqtt == offline
    assert exp.hypotheses[0].mode_id == "sensor_drift"


def test_no_unsupported_claims_after_transport():
    cmodel, _, _ = _BRAIN
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", _conv().uns_path)
    _, _, exp = _round_trip(ev)
    for h in exp.hypotheses:
        assert h.tag_evidence and h.manual_evidence
