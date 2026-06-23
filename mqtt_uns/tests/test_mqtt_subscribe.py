"""Subscribe: the broker delivers to matching topic filters and the event deserializes intact."""
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
import subscriber as sub_mod  # noqa: E402


def test_topic_matches_wildcards():
    assert bk.topic_matches("#", "a/b/c")
    assert bk.topic_matches("a/#", "a/b/c")
    assert bk.topic_matches("a/+/c", "a/b/c")
    assert not bk.topic_matches("a/+/c", "a/b/d")
    assert not bk.topic_matches("a/b", "a/b/c")
    assert bk.topic_matches("a/b/c", "a/b/c")


def test_subscriber_receives_and_deserializes():
    cmodel, _, _ = eb.build_brain()
    conv = next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)

    transport = bk.InMemoryBroker()
    sub = sub_mod.Subscriber(transport, "#")
    pub = pub_mod.Publisher(transport)
    _, _, delivered = pub.publish_event(ev)

    assert delivered == 1
    assert len(sub.received) == 1
    topic, received = sub.received[0]
    assert received == ev                       # frozen dataclass equality: nothing lost on the wire


def test_filter_scopes_delivery():
    cmodel, _, _ = eb.build_brain()
    conv = next(a for a in cmodel.assets() if comp.classify_asset(a) == "conveyor")
    ev = eb.event_from_scenario(cmodel, "photoeye_blocked", conv.uns_path)
    transport = bk.InMemoryBroker()
    # a filter on a different line must NOT receive this event
    other = sub_mod.Subscriber(transport, "synthetic_beverage_co/demo_site/liquid_processing/#")
    mine = sub_mod.Subscriber(transport, "synthetic_beverage_co/demo_site/bottling/#")
    pub_mod.Publisher(transport).publish_event(ev)
    assert len(mine.received) == 1
    assert len(other.received) == 0
