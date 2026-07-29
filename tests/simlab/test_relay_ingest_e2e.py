"""End-to-end seam proof: SimLab emit -> mira-relay land, HMAC, zero infra.

The unit tests on either side prove their half (fake httpx on the publisher side;
raw-JSON POST on the relay side). This test closes the SEAM between them: a real
``RelayIngestPublisher`` HMAC-signs a real ``SimEngine`` snapshot, the bytes flow
through the actual relay ASGI app + ``ingest_batch`` pipeline, and we assert the
readings land in ``tag_events`` + ``live_signal_cache`` (an in-memory ``TagStore``
double — no NeonDB) with the UNS resolved from the allowlist.

The allowlist here is built from ``snapshot()`` exactly as
``tools/seeds/gen_approved_tags_simulator.py`` builds the seed — so this also
proves the seed's mapping admits every SimLab tag (fail-closed → nothing dropped).

Infra-gated end-to-end (real NeonTagStore + a running relay) is the staging
runbook's job; this is the no-infra confidence floor.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

import pytest

pytest.importorskip("starlette")
pytest.importorskip("httpx")

from simlab import SIMLAB_TENANT_ID  # noqa: E402
from simlab.engine import SimEngine  # noqa: E402
from simlab.lines.juice_bottling import build_line  # noqa: E402
from simlab.publishers import RelayIngestPublisher  # noqa: E402

_RELAY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mira-relay")

_HMAC_KEY = "e2e-test-hmac-key"


class _InMemoryTagStore:
    """Minimal TagStore double (the tag_ingest.TagStore Protocol contract).

    Mirrors mira-relay/tests/test_tag_ingest.py::InMemoryTagStore — kept tiny
    and local (the Protocol is 3 methods) rather than importing a test module.
    """

    def __init__(self, allowlist: dict[str, dict[str, str | None]]) -> None:
        self._allow = allowlist
        self.events: list = []  # -> tag_events
        self.state: dict = {}  # tag_path -> latest row  (-> live_signal_cache)

    def load_allowlist(self, tenant_id, source_system):
        return dict(self._allow.get(source_system, {}))

    def current_state_simulated(self, tenant_id, tag_paths):
        return {t: self.state[t].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = r
        return (len(event_rows), len(state_rows))


def _route_httpx_to_app(test_client):
    """Shim for httpx.post that delivers the publisher's bytes to the ASGI app."""

    def _post(url, *, content=None, headers=None, timeout=None, **kwargs):
        return test_client.post(urlsplit(url).path, content=content, headers=headers)

    return _post


@pytest.fixture
def relay(monkeypatch):
    """Import relay_server, force the HMAC path, inject the in-memory store, and
    build the allowlist from the SimLab snapshot (as the seed does)."""
    monkeypatch.syspath_prepend(_RELAY_DIR)
    import relay_server
    from tag_ingest import normalize_tag_path
    from starlette.testclient import TestClient

    snapshot = SimEngine(build_line()).snapshot()
    allow = {normalize_tag_path(r.uns_path): r.uns_path for r in snapshot}
    store = _InMemoryTagStore({"simulator": allow})

    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", _HMAC_KEY)
    monkeypatch.setattr(relay_server, "_get_tag_store", lambda: store)
    client = TestClient(relay_server.app)

    import httpx

    monkeypatch.setattr(httpx, "post", _route_httpx_to_app(client))
    return store, len(snapshot)


def test_simlab_snapshot_lands_via_hmac_through_the_real_relay(relay):
    store, n_tags = relay
    eng = SimEngine(build_line())
    eng.add_publisher(
        RelayIngestPublisher("http://relay.test", tenant_id=SIMLAB_TENANT_ID, hmac_key=_HMAC_KEY)
    )

    eng.advance(1)  # advance() -> snapshot -> publisher -> relay -> ingest_batch

    # tag_events: every reading is its own append-only row.
    assert len(store.events) == n_tags, "all SimLab tags should land in tag_events"
    # live_signal_cache: latest value per tag, UNS resolved from the allowlist.
    assert len(store.state) == n_tags
    sample = next(iter(store.state.values()))
    assert sample.simulated is True
    assert sample.uns_path  # resolved, not null
    assert sample.source_system == "simulator"
    # tenant carried through HMAC (header authoritative).
    assert sample.tenant_id == SIMLAB_TENANT_ID


def test_relay_outage_does_not_stop_the_sim(relay, monkeypatch):
    """A 5xx/broken relay must never propagate into the sim loop."""
    import httpx

    def _boom(*a, **k):
        raise RuntimeError("relay down")

    monkeypatch.setattr(httpx, "post", _boom)
    eng = SimEngine(build_line())
    eng.add_publisher(
        RelayIngestPublisher("http://relay.test", tenant_id=SIMLAB_TENANT_ID, hmac_key=_HMAC_KEY)
    )
    eng.advance(3)  # must not raise
    assert eng.tick == 3


def test_unsigned_traffic_is_rejected_when_hmac_required(relay):
    """No HMAC key on the publisher -> no signature -> relay 401 (best-effort,
    so the sim still doesn't crash, but nothing lands)."""
    store, _ = relay
    eng = SimEngine(build_line())
    # bench bearer with no relay RELAY_LEGACY_BEARER -> relay rejects.
    eng.add_publisher(
        RelayIngestPublisher("http://relay.test", tenant_id=SIMLAB_TENANT_ID, api_key="x")
    )
    eng.advance(1)
    assert store.events == [], "unsigned batch must not land when HMAC is required"
