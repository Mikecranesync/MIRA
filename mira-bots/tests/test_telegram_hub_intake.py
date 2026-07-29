"""Telegram file intake → the Hub's citable folder-upload door (#2540).

The legacy §2 ``/api/contextualization/import`` path was a verified dead-end for
a raw Telegram file (browser-session auth, zip-only multipart, dark env). The
working citable door is ``POST /api/uploads/folder`` — Bearer ``HUB_INGEST_TOKEN``
+ an ``X-Mira-Tenant-Id`` header, multipart raw file — which routes through the
golden path to ``knowledge_entries`` (per-tenant, ``is_private=true``, citable).

These tests assert the client half (``submit_file_to_hub_folder``) POSTs to that
endpoint with the right auth + tenant header, carries the raw bytes (not a zip),
skips gracefully when unconfigured, and never raises.
"""

from __future__ import annotations

from shared import contextualization_intake as ci

_RAW = b"\xff\xd8\xff telegram nameplate jpeg bytes"
_TENANT = "11111111-2222-3333-4444-555555555555"


class _Resp:
    def __init__(self, status_code: int = 201):
        self.status_code = status_code

    @property
    def text(self):  # pragma: no cover - only read on failure paths
        return ""


class _Client:
    """Records the single POST the submit path makes."""

    def __init__(self, seen: dict, status_code: int = 201):
        self._seen = seen
        self._status = status_code

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        self._seen["url"] = url
        self._seen["kwargs"] = kwargs
        return _Resp(self._status)


def _patch_client(monkeypatch, seen: dict, status_code: int = 201):
    monkeypatch.setattr(
        ci.httpx, "AsyncClient", lambda *a, **k: _Client(seen, status_code)
    )


async def test_posts_to_citable_folder_endpoint(monkeypatch):
    """The submit path targets /api/uploads/folder — NOT the dead import route."""
    seen: dict = {}
    _patch_client(monkeypatch, seen)

    ok = await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=_TENANT,
        hub_url="https://hub.example.com",
        base_path="/hub",
        token="svc-token",
    )

    assert ok is True
    assert seen["url"] == "https://hub.example.com/hub/api/uploads/folder/"
    # Explicitly NOT the legacy dead-end.
    assert "/api/contextualization/import" not in seen["url"]


async def test_bearer_auth_and_tenant_header(monkeypatch):
    """Bearer HUB_INGEST_TOKEN + X-Mira-Tenant-Id keep uploads per-tenant."""
    seen: dict = {}
    _patch_client(monkeypatch, seen)

    await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="gs10manual.pdf",
        mime="application/pdf",
        tenant_id=_TENANT,
        hub_url="https://hub.example.com",
        token="svc-token",
    )

    headers = seen["kwargs"]["headers"]
    assert headers["Authorization"] == "Bearer svc-token"
    assert headers["X-Mira-Tenant-Id"] == _TENANT


async def test_raw_file_carried_not_a_zip(monkeypatch):
    """Body is the raw file under the `file` field — not a zip bundle."""
    seen: dict = {}
    _patch_client(monkeypatch, seen)

    await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=_TENANT,
        hub_url="https://hub.example.com",
        token="svc-token",
    )

    files = seen["kwargs"]["files"]
    assert files["file"][0] == "photo.jpg"
    assert files["file"][1] == _RAW
    assert files["file"][2] == "image/jpeg"
    # No zip envelope / JSON contract travels on this path.
    assert "data" not in seen["kwargs"]


async def test_graceful_skip_when_env_unset(monkeypatch):
    """No base URL / no token → skip (return False), never POST."""
    monkeypatch.setattr(ci, "HUB_URL", "")
    monkeypatch.setattr(ci, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(ci, "HUB_INGEST_TOKEN", "")

    posted = {"n": 0}

    class _NoPost:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):  # pragma: no cover - must not run
            posted["n"] += 1
            return _Resp()

    monkeypatch.setattr(ci.httpx, "AsyncClient", _NoPost)

    ok = await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=_TENANT,
    )
    assert ok is False
    assert posted["n"] == 0


async def test_hub_folder_upload_configured_reflects_env(monkeypatch):
    monkeypatch.setattr(ci, "HUB_URL", "")
    monkeypatch.setattr(ci, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(ci, "HUB_INGEST_TOKEN", "")
    assert ci.hub_folder_upload_configured() is False
    # Base + token present → configured.
    assert ci.hub_folder_upload_configured(hub_url="https://h", token="t") is True
    # HUB_IMPORT_URL counts as a base (back-compat).
    monkeypatch.setattr(ci, "HUB_IMPORT_URL", "https://legacy")
    monkeypatch.setattr(ci, "HUB_INGEST_TOKEN", "svc")
    assert ci.hub_folder_upload_configured() is True


async def test_non_2xx_returns_false(monkeypatch):
    seen: dict = {}
    _patch_client(monkeypatch, seen, status_code=401)

    ok = await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=_TENANT,
        hub_url="https://hub.example.com",
        token="svc-token",
    )
    assert ok is False


async def test_never_raises_on_transport_error(monkeypatch):
    """Background-safe: a failing Hub POST must not break the chat reply."""

    class _BoomClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise RuntimeError("network down")

    monkeypatch.setattr(ci.httpx, "AsyncClient", _BoomClient)

    ok = await ci.submit_file_to_hub_folder(
        raw_bytes=_RAW,
        filename="photo.jpg",
        mime="image/jpeg",
        tenant_id=_TENANT,
        hub_url="https://hub.example.com",
        token="svc-token",
    )
    assert ok is False  # swallowed, reported as failure, not raised
