"""Tests for the spike hello server. Run BEFORE writing the server."""
from __future__ import annotations

import json
import threading
from http.client import HTTPConnection

import pytest
from hello_server import build_server


@pytest.fixture
def server():
    httpd = build_server(("127.0.0.1", 0))  # ephemeral port
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield port
    httpd.shutdown()


def _get(port: int, path: str) -> tuple[int, bytes]:
    conn = HTTPConnection("127.0.0.1", port, timeout=2)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return resp.status, body


def _post(port: int, path: str, payload: dict) -> tuple[int, bytes]:
    conn = HTTPConnection("127.0.0.1", port, timeout=2)
    body = json.dumps(payload).encode()
    conn.request("POST", path, body=body, headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    out = resp.read()
    conn.close()
    return resp.status, out


def test_root_returns_hello(server: int):
    status, body = _get(server, "/")
    assert status == 200
    assert body == b"hello"


def test_health_returns_200(server: int):
    status, body = _get(server, "/health")
    assert status == 200
    assert body == b"ok"


def test_hook_echoes_post_body(server: int):
    payload = {"event": "test", "n": 42}
    status, body = _post(server, "/hook", payload)
    assert status == 200
    assert json.loads(body) == payload


def test_unknown_path_returns_404(server: int):
    status, _ = _get(server, "/nope")
    assert status == 404


def test_hook_invalid_content_length_returns_400(server: int):
    conn = HTTPConnection("127.0.0.1", server, timeout=2)
    # Send raw request with a malformed Content-Length header; must not 500.
    conn.request(
        "POST",
        "/hook",
        body=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "notanumber"},
    )
    resp = conn.getresponse()
    resp.read()
    conn.close()
    assert resp.status == 400


def test_hook_oversized_body_returns_413(server: int):
    conn = HTTPConnection("127.0.0.1", server, timeout=2)
    # Advertise a body larger than the 1 MiB cap. Server must reject before reading.
    conn.putrequest("POST", "/hook")
    conn.putheader("Content-Type", "application/json")
    conn.putheader("Content-Length", str(1024 * 1024 + 1))
    conn.endheaders()
    resp = conn.getresponse()
    resp.read()
    conn.close()
    assert resp.status == 413
