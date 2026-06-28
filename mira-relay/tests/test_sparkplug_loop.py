"""Subscriber LOOP integration — ``run_subscriber`` against a FAKE aiomqtt.

No real broker. A fake ``aiomqtt`` module is injected into ``sys.modules`` (the
subscriber imports it lazily), scripted per connection attempt: yield messages,
raise to force a reconnect, or raise ``CancelledError`` to end the loop. Proves
the connect → subscribe → feed → flush wiring and the reconnect/backoff path.
"""

from __future__ import annotations

import asyncio
import types

import pytest

from ingest_contract import normalize_tag_path
from mqtt_ingest.codecs import sparkplug_b as spb
from mqtt_ingest.config import SparkplugConfig
from mqtt_ingest.subscriber import run_subscriber

GROUP, EDGE, DEVICE = "FactoryLM", "ConveyorEdge", "Conv_Simple"
METRIC = "Conveyor/VFD_Hz"
RAW = f"{GROUP}/{EDGE}/{DEVICE}/{METRIC}"
TOPIC = f"spBv1.0/{GROUP}/DBIRTH/{EDGE}/{DEVICE}"
DTOPIC = f"spBv1.0/{GROUP}/DDATA/{EDGE}/{DEVICE}"


class _Store:
    def __init__(self):
        self._allow = {"ignition": {normalize_tag_path(RAW): "enterprise.x"}}
        self.events, self.state = [], {}

    def load_allowlist(self, t, ss):
        return dict(self._allow.get(ss, {}))

    def current_state_simulated(self, t, paths):
        return {}

    def persist_batch(self, ev, st):
        self.events.extend(ev)
        for r in st:
            self.state[r.tag_path] = r
        return (len(ev), len(st))


class _Msg:
    def __init__(self, topic: str, payload: bytes):
        self.topic = topic
        self.payload = payload


def _birth():
    return _Msg(
        TOPIC,
        spb.encode_payload(
            [spb.encode_metric(name=METRIC, alias=2, datatype=spb.DT_FLOAT, value=60.0)]
        ),
    )


def _data(v):
    return _Msg(
        DTOPIC, spb.encode_payload([spb.encode_metric(alias=2, datatype=spb.DT_FLOAT, value=v)])
    )


def _install_fake_aiomqtt(monkeypatch, scripts):
    """scripts[i] drives the i-th connection: a list[_Msg] to yield, or a
    BaseException to raise on connect."""
    state = {"attempt": 0}

    class MqttError(Exception):
        pass

    class TLSParameters:
        def __init__(self, *a, **k):
            pass

    class Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.subscribed = []

        async def __aenter__(self):
            beh = scripts[min(state["attempt"], len(scripts) - 1)]
            state["attempt"] += 1
            if isinstance(beh, BaseException):
                raise beh
            self._msgs = list(beh)
            return self

        async def __aexit__(self, *a):
            return False

        async def subscribe(self, topic_filter):
            self.subscribed.append(topic_filter)

        @property
        def messages(self):
            async def _gen():
                for m in self._msgs:
                    yield m

            return _gen()

    mod = types.ModuleType("aiomqtt")
    mod.MqttError = MqttError
    mod.TLSParameters = TLSParameters
    mod.Client = Client
    mod._state = state
    monkeypatch.setitem(__import__("sys").modules, "aiomqtt", mod)
    return state


def _config(**kw):
    base = dict(
        tenant_id="t-loop",
        source_system="ignition",
        flush_size=1,
        flush_interval_s=0.01,
        reconnect_min_s=0.01,
        reconnect_max_s=0.05,
    )
    base.update(kw)
    return SparkplugConfig(**base)


async def test_loop_connects_subscribes_and_lands_messages(monkeypatch):
    store = _Store()
    # connection 0 yields birth+data; connection 1 ends the loop.
    _install_fake_aiomqtt(monkeypatch, [[_birth(), _data(49.5)], asyncio.CancelledError()])
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(run_subscriber(_config(), store), timeout=5)
    # both readings landed via the loop → ingest_batch → store
    assert store.state[RAW].value == "49.5"
    assert len(store.events) == 2


async def test_loop_reconnects_after_broker_error(monkeypatch):
    store = _Store()
    state = _install_fake_aiomqtt(
        monkeypatch,
        [RuntimeError("broker down"), [_birth()], asyncio.CancelledError()],
    )
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(run_subscriber(_config(), store), timeout=5)
    assert state["attempt"] >= 3  # failed once, reconnected, then stopped
    assert RAW in store.state  # landed after the reconnect
