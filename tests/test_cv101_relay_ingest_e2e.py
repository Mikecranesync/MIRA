"""CV-101 signed batch -> the REAL relay ASGI app -> tag_ingest.ingest_batch
(in-memory store). Extends the ASGI e2e pattern of
tests/simlab/test_relay_ingest_e2e.py (which proves the SimLab
RelayIngestPublisher lands through the real Starlette app) to the CV-101
conveyor allowlist and, instead of RelayIngestPublisher, uses the Task-1
signing client (mira-relay/tools/sign_and_post.py::build_signed_request) --
proving `sign_and_post`'s signature is not just self-consistent
(mira-relay/tests/test_sign_and_post.py checks that against auth.verify_hmac
directly) but actually accepted by the live Starlette route + full
ingest_batch pipeline, and that a tampered body is rejected end-to-end.

No NeonDB, no network -- the Starlette TestClient drives the ASGI app
in-process and an in-memory TagStore double stands in for NeonTagStore.
"""

from __future__ import annotations

import importlib.util
import os
import re

import pytest

pytest.importorskip("starlette")
pytest.importorskip("httpx")

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
_RELAY_DIR = os.path.join(_REPO_ROOT, "mira-relay")
_SEED_PATH = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_conveyor.sql")
_CV101_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"

_ROW_RE = re.compile(r"'ignition',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::ltree")
_HMAC_KEY = "cv101-e2e-test-hmac-key"
_TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"


def _load_sign_and_post():
    """Load mira-relay/tools/sign_and_post.py by file path under a unique
    module name -- avoids colliding with the repo-root `tools` namespace
    package (tools/seeds/, tools/command-center/, ...) that may already be on
    sys.path in a full `pytest tests/` run. Same technique
    simlab/publishers.py uses to load mira-relay/ingest_contract.py."""
    path = os.path.join(_RELAY_DIR, "tools", "sign_and_post.py")
    spec = importlib.util.spec_from_file_location("mira_relay_sign_and_post", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _seed_allowlist() -> dict[str, str | None]:
    with open(_SEED_PATH, encoding="utf-8") as fh:
        sql = fh.read()
    return {norm: uns for _src, norm, uns in _ROW_RE.findall(sql)}


class _InMemoryTagStore:
    def __init__(self, allowlist: dict[str, str | None]) -> None:
        self._allow = allowlist
        self.events: list = []
        self.state: dict = {}

    def load_allowlist(self, tenant_id, source_system):
        return dict(self._allow)

    def current_state_simulated(self, tenant_id, tag_paths):
        return {t: self.state[t].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = r
        return (len(event_rows), len(state_rows))


@pytest.fixture
def relay(monkeypatch):
    monkeypatch.syspath_prepend(_RELAY_DIR)
    import relay_server
    from starlette.testclient import TestClient

    store = _InMemoryTagStore(_seed_allowlist())
    monkeypatch.setattr(relay_server, "MIRA_IGNITION_HMAC_KEY", _HMAC_KEY)
    monkeypatch.setattr(relay_server, "_get_tag_store", lambda: store)

    return TestClient(relay_server.app), store


def test_cv101_signed_batch_accepted_by_the_real_relay(relay):
    client, store = relay
    sign_and_post = _load_sign_and_post()

    body_bytes, headers = sign_and_post.build_signed_request(
        tenant_id=_TENANT,
        key=_HMAC_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
        source_system="ignition",
    )
    resp = client.post("/api/v1/tags/ingest", content=body_bytes, headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["accepted"] == 1
    assert body["rejected"] == []
    assert body["simulated"] is False
    assert len(store.events) == 1
    assert store.events[0].uns_path == _CV101_UNS
    assert store.events[0].simulated is False
    assert store.state["[default]Conveyor/VFD_Hz"].uns_path == _CV101_UNS


def test_tampered_body_is_rejected_401_signature_mismatch(relay):
    client, store = relay
    sign_and_post = _load_sign_and_post()

    body_bytes, headers = sign_and_post.build_signed_request(
        tenant_id=_TENANT,
        key=_HMAC_KEY,
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
        source_system="ignition",
    )
    tampered = body_bytes.replace(b"60.0", b"999.0")
    resp = client.post("/api/v1/tags/ingest", content=tampered, headers=headers)

    assert resp.status_code == 401
    assert resp.json()["detail"] == "signature_mismatch"
    assert store.events == [], "a tampered/unverified batch must never be persisted"


def test_wrong_key_is_rejected_401(relay):
    client, store = relay
    sign_and_post = _load_sign_and_post()

    body_bytes, headers = sign_and_post.build_signed_request(
        tenant_id=_TENANT,
        key="not-the-relay-key",
        tag_path="[default]Conveyor/VFD_Hz",
        value=60.0,
        value_type="float",
        source_system="ignition",
    )
    resp = client.post("/api/v1/tags/ingest", content=body_bytes, headers=headers)

    assert resp.status_code == 401
    assert resp.json()["detail"] == "signature_mismatch"
    assert store.events == []
