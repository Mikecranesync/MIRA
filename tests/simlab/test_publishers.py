"""MqttPublisher hardening regression tests (3 bugs).

These pin three real defects in `simlab.publishers.MqttPublisher` that would corrupt a LIVE MQTT
feed (the ProveIt on-stage hookup shape):

  B1  every reading was stamped with a frozen `BASE_EPOCH + 0` (and `Reading.ts` is an ISO-8601
      string, not a float) -> all live values share one wrong timestamp.
  B2  `asyncio.get_event_loop()` is deprecated in 3.12 and raises with no running loop -> a plain
      `publish()` from sync code blew up / warned.
  B3  `loop.create_task(...)` result was never referenced -> asyncio keeps only weak refs to tasks,
      so the publish coroutine could be garbage-collected before it ran.

We monkeypatch a fake `aiomqtt` so the tests need no broker.
"""
from __future__ import annotations

import asyncio
import json
import sys
import types
import warnings

import pytest

from simlab.engine import BASE_EPOCH, _epoch_to_iso
from simlab.models import Reading, TagCategory, ValueType
from simlab.publishers import MqttPublisher


class _FakeClient:
    """Stand-in for aiomqtt.Client: records every publish() call."""

    instances: list["_FakeClient"] = []

    def __init__(self, host, port=1883, *args, **kwargs):
        self.host = host
        self.port = port
        self.messages: list[tuple[str, str, bool]] = []
        _FakeClient.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def publish(self, topic, payload=None, retain=False, **kwargs):
        self.messages.append((topic, payload, retain))


@pytest.fixture
def fake_aiomqtt(monkeypatch):
    _FakeClient.instances = []
    mod = types.ModuleType("aiomqtt")
    mod.Client = _FakeClient
    monkeypatch.setitem(sys.modules, "aiomqtt", mod)
    return _FakeClient


def _reading(tag: str, value, tick: int) -> Reading:
    return Reading(
        asset_id="filler01",
        tag=tag,
        category=list(TagCategory)[0],
        value=value,
        value_type=list(ValueType)[0],
        uns_path=f"enterprise.site1.area1.line01.filler01.process.{tag}",
        ts=_epoch_to_iso(BASE_EPOCH + tick),
    )


def _all_messages(fake) -> list[tuple[str, str, bool]]:
    return [m for c in fake.instances for m in c.messages]


def test_b1_each_reading_carries_its_own_real_timestamp(fake_aiomqtt):
    r1 = _reading("fill_level_oz", 11.5, tick=5)
    r2 = _reading("speed_rpm", 240, tick=9)
    MqttPublisher(host="broker.example").publish([r1, r2])

    msgs = _all_messages(fake_aiomqtt)
    assert len(msgs) == 2
    by_value = {json.loads(p)["value"]: json.loads(p) for _t, p, _r in msgs}
    # the frozen-BASE_EPOCH bug would make these identical; they must differ and match each reading
    assert by_value[11.5]["ts"] == BASE_EPOCH + 5
    assert by_value[240]["ts"] == BASE_EPOCH + 9
    assert by_value[11.5]["ts"] != by_value[240]["ts"]
    assert all(j["source"] == "simulator" for j in by_value.values())


def test_b2_sync_publish_without_running_loop_does_not_warn_or_raise(fake_aiomqtt):
    r = _reading("fill_level_oz", 11.5, tick=1)
    with warnings.catch_warnings():
        # the old get_event_loop() path raises DeprecationWarning under 3.12
        warnings.simplefilter("error", DeprecationWarning)
        MqttPublisher(host="broker.example").publish([r])
    assert len(_all_messages(fake_aiomqtt)) == 1


def test_b3_publish_inside_running_loop_keeps_a_strong_task_reference(fake_aiomqtt):
    async def drive():
        pub = MqttPublisher(host="broker.example")
        pub.publish([_reading("speed_rpm", 240, tick=2)])
        # the task must be referenced (not weakly held) or it could be GC'd before running
        assert pub._pending, "publish() inside a running loop must retain its task"
        await asyncio.gather(*list(pub._pending))
        return pub

    pub = asyncio.run(drive())
    assert len(_all_messages(fake_aiomqtt)) == 1
    assert not pub._pending, "completed tasks should be discarded from the pending set"


def test_topic_is_projected_from_uns_path(fake_aiomqtt):
    MqttPublisher(host="broker.example").publish([_reading("fill_level_oz", 11.5, tick=3)])
    topic, _payload, retain = _all_messages(fake_aiomqtt)[0]
    assert topic.endswith("process/fill_level_oz")
    assert "/" in topic and "." not in topic.split("/")[-1]


# ---------------------------------------------------------------------------
# RelayIngestPublisher — HTTP relay path (Gap A/B). Fake httpx; no relay/DB.
# ---------------------------------------------------------------------------

import os  # noqa: E402

from simlab.publishers import RelayIngestPublisher  # noqa: E402

_TENANT = "00000000-0000-0000-0000-000000515ab1"


class _FakeResponse:
    def __init__(self, status_code: int = 200) -> None:
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeHttpx:
    """Captures the single POST a publish() makes."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.status_code = 200

    def post(self, url, *, content=None, headers=None, timeout=None, **kwargs):
        self.calls.append(
            {"url": url, "content": content, "headers": dict(headers or {}), "timeout": timeout}
        )
        return _FakeResponse(self.status_code)


@pytest.fixture
def fake_httpx(monkeypatch):
    fake = _FakeHttpx()
    mod = types.ModuleType("httpx")
    mod.post = fake.post
    monkeypatch.setitem(sys.modules, "httpx", mod)
    return fake


def test_relay_requires_tenant():
    with pytest.raises(ValueError):
        RelayIngestPublisher("http://relay.example", tenant_id="")


def test_relay_bearer_mode_carries_tenant_in_body(fake_httpx):
    pub = RelayIngestPublisher("http://relay.example/", tenant_id=_TENANT, api_key="benchkey")
    pub.publish([_reading("fill_level_oz", 11.5, tick=2)])

    assert len(fake_httpx.calls) == 1
    call = fake_httpx.calls[0]
    assert call["url"] == "http://relay.example/api/v1/tags/ingest"
    assert call["headers"]["Authorization"] == "Bearer benchkey"
    # No HMAC headers in bearer mode.
    assert "X-MIRA-Signature" not in call["headers"]
    body = json.loads(call["content"])
    assert body["source_system"] == "simulator"
    assert body["tenant_id"] == _TENANT  # relay falls back to body tenant in legacy path
    assert body["tags"][0]["tag_path"].endswith("fill_level_oz")


def test_relay_hmac_mode_round_trips_against_the_real_verifier(fake_httpx):
    # Import the authoritative verifier so the test proves the WIRE contract,
    # not just a mirror of our own signing code.
    relay_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mira-relay"
    )
    sys.path.insert(0, relay_dir)
    try:
        import auth  # mira-relay/auth.py
    finally:
        sys.path.remove(relay_dir)

    key = "test-hmac-key"
    pub = RelayIngestPublisher("http://relay.example", tenant_id=_TENANT, hmac_key=key)
    pub.publish([_reading("fill_level_oz", 11.5, tick=2)])

    call = fake_httpx.calls[0]
    headers = call["headers"]
    body_bytes = call["content"]
    assert isinstance(body_bytes, (bytes, bytearray))
    # The verifier returns the tenant on success and raises on any mismatch.
    tenant = auth.verify_hmac(headers, body_bytes, key)
    assert tenant == _TENANT
    # HMAC mode does NOT put the tenant in the body (header is authoritative).
    assert "tenant_id" not in json.loads(body_bytes)


def test_relay_hmac_signature_is_over_the_exact_bytes_sent(fake_httpx):
    # Tampering with the posted body must break verification — proves we signed
    # the bytes we actually send (the content= path), not a re-encoded copy.
    relay_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mira-relay"
    )
    sys.path.insert(0, relay_dir)
    try:
        import auth
    finally:
        sys.path.remove(relay_dir)

    key = "test-hmac-key"
    RelayIngestPublisher("http://relay.example", tenant_id=_TENANT, hmac_key=key).publish(
        [_reading("speed_rpm", 240, tick=1)]
    )
    call = fake_httpx.calls[0]
    tampered = call["content"] + b" "
    with pytest.raises(ValueError):
        auth.verify_hmac(call["headers"], tampered, key)


def test_relay_publish_is_best_effort_on_error(fake_httpx):
    fake_httpx.status_code = 500  # raise_for_status() will raise
    pub = RelayIngestPublisher("http://relay.example", tenant_id=_TENANT, hmac_key="k")
    # Must not propagate — a down relay can never stall the sim.
    pub.publish([_reading("fill_level_oz", 11.5, tick=1)])
    assert len(fake_httpx.calls) == 1
