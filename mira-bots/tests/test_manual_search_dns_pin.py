"""DNS resolve-and-pin for manual-search probes (Manual-First PRD R6, #4160 S3a).

``_url_is_probeable`` resolves a hostname and rejects non-public addresses, but
httpx then resolves the name AGAIN when it connects. A hostile resolver can
answer "public" to the check and "10.0.0.5" to the connect (DNS rebinding). The
fix connects to exactly the address that was checked: a network backend that
resolves, rejects any non-public answer, and dials the checked IP — while TLS
SNI and certificate validation keep using the URL hostname.

No test here touches the network: getaddrinfo is monkeypatched and the inner
backend is a recorder.
"""

from __future__ import annotations

import socket

import httpcore
import httpx
import pytest

from shared.manual_search import judge
from shared.manual_search import search as s

PUBLIC = "93.184.216.34"


def _addrinfo(*ips: str):
    out = []
    for ip in ips:
        fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
        sockaddr = (ip, 443, 0, 0) if fam == socket.AF_INET6 else (ip, 443)
        out.append((fam, socket.SOCK_STREAM, 6, "", sockaddr))
    return out


class _RecordingBackend(httpcore.AsyncNetworkBackend):
    """Stands in for the real socket layer: records every dial, never connects."""

    def __init__(self) -> None:
        self.dials: list[tuple[str, int]] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.dials.append((host, port))
        raise httpcore.ConnectError("recording backend: no real sockets in tests")

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise httpcore.ConnectError("unix sockets are never used")

    async def sleep(self, seconds: float) -> None:
        return None


@pytest.fixture
def recorder(monkeypatch):
    rec = _RecordingBackend()
    monkeypatch.setattr(s, "_inner_network_backend", lambda: rec)
    monkeypatch.setattr(s, "_transport_for_tests", None)
    return rec


def _resolver(monkeypatch, *answers):
    """Each getaddrinfo call returns the next answer (the last one repeats)."""
    calls = []

    def fake(host, port, *a, **k):
        calls.append(host)
        ips = answers[min(len(calls), len(answers)) - 1]
        return _addrinfo(*ips)

    monkeypatch.setattr(s.socket, "getaddrinfo", fake)
    return calls


class TestPinnedBackend:
    async def test_public_answer_dials_the_checked_ip_not_the_name(self, monkeypatch, recorder):
        _resolver(monkeypatch, [PUBLIC])
        backend = s._PinnedNetworkBackend()
        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("literature.example.com", 443)
        assert recorder.dials == [(PUBLIC, 443)]

    @pytest.mark.parametrize(
        "ips",
        [
            ["10.0.0.5"],
            ["127.0.0.1"],
            ["169.254.169.254"],
            ["100.68.1.2"],  # CGNAT — the retired droplet's Tailscale range
            ["::1"],
            ["fc00::1"],
            ["::ffff:169.254.169.254"],
            [PUBLIC, "10.0.0.5"],  # mixed answers: any private address blocks
        ],
    )
    async def test_non_public_answer_is_refused_and_never_dialed(self, monkeypatch, recorder, ips):
        _resolver(monkeypatch, ips)
        backend = s._PinnedNetworkBackend()
        with pytest.raises(httpcore.ConnectError, match="blocked"):
            await backend.connect_tcp("literature.example.com", 443)
        assert recorder.dials == []

    async def test_resolution_failure_is_refused(self, monkeypatch, recorder):
        def boom(*a, **k):
            raise socket.gaierror("nope")

        monkeypatch.setattr(s.socket, "getaddrinfo", boom)
        with pytest.raises(httpcore.ConnectError):
            await s._PinnedNetworkBackend().connect_tcp("x.example.com", 443)
        assert recorder.dials == []

    async def test_unix_sockets_refused(self, recorder):
        with pytest.raises(httpcore.ConnectError):
            await s._PinnedNetworkBackend().connect_unix_socket("/var/run/docker.sock")


class TestTransportWiring:
    def test_probe_transport_uses_the_pinned_backend(self, monkeypatch):
        monkeypatch.setattr(s, "_transport_for_tests", None)
        t = s._probe_transport()
        assert isinstance(t, httpx.AsyncHTTPTransport)
        # Fails loudly if an httpx/httpcore upgrade moves the pool: pinning must
        # never silently fall back to the default resolver.
        assert isinstance(t._pool._network_backend, s._PinnedNetworkBackend)

    def test_probe_transport_keeps_tls_verification_on(self, monkeypatch):
        monkeypatch.setattr(s, "_transport_for_tests", None)
        ctx = s._probe_transport()._pool._ssl_context
        assert ctx is not None
        assert ctx.verify_mode.name == "CERT_REQUIRED"
        assert ctx.check_hostname is True

    def test_test_seam_still_wins(self, monkeypatch):
        mock = httpx.MockTransport(lambda r: httpx.Response(200))
        monkeypatch.setattr(s, "_transport_for_tests", mock)
        assert s._probe_transport() is mock


@pytest.fixture
def pin_spy(monkeypatch):
    """Records every connect-time resolution and its outcome, so a test can
    prove the connect went through the pinned resolver (not merely that no
    private address was dialed, which a broken wiring also satisfies)."""
    seen: list[tuple[str, str]] = []
    real = s._resolve_public

    def spy(host, port):
        try:
            ip = real(host, port)
        except httpcore.ConnectError:
            seen.append((host, "blocked"))
            raise
        seen.append((host, ip))
        return ip

    monkeypatch.setattr(s, "_resolve_public", spy)
    return seen


class TestRebindingEndToEnd:
    """The check sees a public answer, the connect sees a private one."""

    async def test_validate_pdf_refuses_a_rebinding_host(self, monkeypatch, recorder, pin_spy):
        _resolver(monkeypatch, [PUBLIC], ["10.0.0.5"])
        assert await s.validate_pdf("https://rebind.example.com/manual.pdf") is False
        assert ("rebind.example.com", "blocked") in pin_spy
        assert recorder.dials == []

    async def test_judge_fetch_refuses_a_rebinding_host(self, monkeypatch, recorder, pin_spy):
        _resolver(monkeypatch, [PUBLIC], ["127.0.0.1"])
        assert await judge.fetch_pdf_bytes("https://rebind.example.com/manual.pdf") is None
        assert ("rebind.example.com", "blocked") in pin_spy
        assert recorder.dials == []

    async def test_validate_pdf_dials_only_checked_public_ip(self, monkeypatch, recorder, pin_spy):
        _resolver(monkeypatch, [PUBLIC])
        await s.validate_pdf("https://literature.example.com/manual.pdf")
        assert pin_spy and all(ip == PUBLIC for _, ip in pin_spy)
        assert recorder.dials and {ip for ip, _ in recorder.dials} == {PUBLIC}

    async def test_judge_fetch_dials_only_checked_public_ip(self, monkeypatch, recorder, pin_spy):
        _resolver(monkeypatch, [PUBLIC])
        await judge.fetch_pdf_bytes("https://literature.example.com/manual.pdf")
        assert pin_spy and all(ip == PUBLIC for _, ip in pin_spy)
        assert recorder.dials and {ip for ip, _ in recorder.dials} == {PUBLIC}
