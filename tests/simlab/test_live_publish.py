"""SimLab live-feed wiring: advance() pushes a snapshot to attached publishers.

This is what makes the deterministic sim a LIVE factory feed (the ProveIt on-stage hookup shape).
The wiring is additive: with no publisher attached the engine behaves exactly as before, so the
existing 63-test suite is unaffected.
"""
from __future__ import annotations

from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.publishers import InMemoryPublisher


def _engine() -> SimEngine:
    return SimEngine(build_line())


def test_no_publisher_means_no_behavior_change():
    eng = _engine()
    eng.advance(5)               # must not raise; no publishers attached
    assert eng.tick == 5


def test_advance_pushes_a_snapshot_to_attached_publisher():
    eng = _engine()
    cap = InMemoryPublisher()
    eng.add_publisher(cap)
    eng.advance(3)
    # one publish per advance() call, carrying a Reading for every tag
    assert len(cap.batches) == 1
    assert cap.last is not None
    assert len(cap.last) == len(eng.snapshot())
    # the published values reflect the CURRENT tick, not tick 0
    assert all(r.ts.endswith("00:00:03Z") for r in cap.last)


def test_one_bad_publisher_does_not_stop_the_others_or_the_sim():
    class _Boom:
        def publish(self, readings):
            raise RuntimeError("broker down")

    eng = _engine()
    good = InMemoryPublisher()
    eng.add_publisher(_Boom())
    eng.add_publisher(good)
    eng.advance(1)               # must not raise despite the bad publisher
    assert good.last is not None


def test_build_app_attaches_mqtt_publisher_when_env_set(monkeypatch):
    import simlab.api as api

    monkeypatch.setenv("SIMLAB_MQTT_HOST", "broker.example")
    monkeypatch.setenv("SIMLAB_MQTT_PORT", "1884")
    eng = _engine()
    api.build_app(engine=eng)
    from simlab.publishers import MqttPublisher

    attached = [p for p in eng._publishers if isinstance(p, MqttPublisher)]
    assert len(attached) == 1
    assert attached[0]._host == "broker.example"
    assert attached[0]._port == 1884


def test_build_app_attaches_nothing_when_env_unset(monkeypatch):
    import simlab.api as api

    monkeypatch.delenv("SIMLAB_MQTT_HOST", raising=False)
    monkeypatch.delenv("SIMLAB_RELAY_URL", raising=False)
    eng = _engine()
    api.build_app(engine=eng)
    assert eng._publishers == []


def test_build_app_attaches_relay_publisher_when_url_set(monkeypatch):
    import simlab.api as api
    from simlab import SIMLAB_TENANT_ID
    from simlab.publishers import RelayIngestPublisher

    monkeypatch.delenv("SIMLAB_MQTT_HOST", raising=False)
    monkeypatch.setenv("SIMLAB_RELAY_URL", "http://relay.example")
    monkeypatch.setenv("SIMLAB_RELAY_HMAC_KEY", "k")
    monkeypatch.delenv("SIMLAB_RELAY_TENANT_ID", raising=False)
    eng = _engine()
    api.build_app(engine=eng)

    attached = [p for p in eng._publishers if isinstance(p, RelayIngestPublisher)]
    assert len(attached) == 1
    # Defaults to the reserved SimLab tenant.
    assert attached[0]._tenant_id == SIMLAB_TENANT_ID
    assert attached[0]._hmac_key == "k"


def test_build_app_relay_tenant_override(monkeypatch):
    import simlab.api as api
    from simlab.publishers import RelayIngestPublisher

    monkeypatch.delenv("SIMLAB_MQTT_HOST", raising=False)
    monkeypatch.setenv("SIMLAB_RELAY_URL", "http://relay.example")
    monkeypatch.setenv("SIMLAB_RELAY_TENANT_ID", "11111111-1111-1111-1111-111111111111")
    eng = _engine()
    api.build_app(engine=eng)

    attached = [p for p in eng._publishers if isinstance(p, RelayIngestPublisher)]
    assert attached[0]._tenant_id == "11111111-1111-1111-1111-111111111111"
