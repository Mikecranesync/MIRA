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
        assert pin_spy and all(ips == [PUBLIC] for _, ips in pin_spy)
        assert recorder.dials and {ip for ip, _ in recorder.dials} == {PUBLIC}

    async def test_judge_fetch_dials_only_checked_public_ip(self, monkeypatch, recorder, pin_spy):
        _resolver(monkeypatch, [PUBLIC])
        await judge.fetch_pdf_bytes("https://literature.example.com/manual.pdf")
        assert pin_spy and all(ips == [PUBLIC] for _, ips in pin_spy)
        assert recorder.dials and {ip for ip, _ in recorder.dials} == {PUBLIC}


class _FlakyFirstBackend(_RecordingBackend):
    """First dial fails (e.g. broken IPv6 route), later dials succeed."""

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.dials.append((host, port))
        if len(self.dials) == 1:
            raise httpcore.ConnectError("first address unreachable")
        return "stream-ok"


class TestCodexR1Findings:
    """#4163 Codex r1: F1 (fallback across checked addresses), F2 (timeout bounds DNS)."""

    async def test_falls_back_to_the_next_checked_address(self, monkeypatch):
        rec = _FlakyFirstBackend()
        monkeypatch.setattr(s, "_inner_network_backend", lambda: rec)
        v6 = "2606:2800:220:1:248:1893:25c8:1946"
        _resolver(monkeypatch, [v6, PUBLIC])
        stream = await s._PinnedNetworkBackend().connect_tcp(
            "literature.example.com", 443, timeout=5
        )
        assert stream == "stream-ok"
        assert [ip for ip, _ in rec.dials] == [v6, PUBLIC]

    async def test_all_addresses_failing_raises_connect_error(self, monkeypatch, recorder):
        _resolver(monkeypatch, [PUBLIC, "93.184.216.35"])
        with pytest.raises(httpcore.ConnectError):
            await s._PinnedNetworkBackend().connect_tcp("literature.example.com", 443, timeout=5)
        assert [ip for ip, _ in recorder.dials] == [PUBLIC, "93.184.216.35"]

    async def test_any_private_answer_still_blocks_before_any_dial(self, monkeypatch, recorder):
        _resolver(monkeypatch, [PUBLIC, "93.184.216.35", "10.0.0.5"])
        with pytest.raises(httpcore.ConnectError, match="blocked"):
            await s._PinnedNetworkBackend().connect_tcp("literature.example.com", 443, timeout=5)
        assert recorder.dials == []

    async def test_timeout_bounds_the_connect_time_resolution(self, monkeypatch, recorder):
        import time

        def slow(host, port, *a, **k):
            time.sleep(0.3)
            return _addrinfo(PUBLIC)

        monkeypatch.setattr(s.socket, "getaddrinfo", slow)
        t0 = time.monotonic()
        with pytest.raises(httpcore.ConnectTimeout):
            await s._PinnedNetworkBackend().connect_tcp("slow.example.com", 443, timeout=0.05)
        assert time.monotonic() - t0 < 0.25
        assert recorder.dials == []


class _Stream:
    def __init__(self, ip: str) -> None:
        self.ip = ip
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class _StallFirstBackend(_RecordingBackend):
    """First address silently drops the SYN (stalls until cancelled); later ones answer."""

    def __init__(self) -> None:
        super().__init__()
        self.cancelled: list[str] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        import asyncio

        self.dials.append((host, port))
        if len(self.dials) == 1:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                self.cancelled.append(host)
                raise
        return _Stream(host)


class TestCodexR2StalledFirstAddress:
    """#4163 Codex r2 F1: a stalled first address must not eat the whole budget."""

    async def test_stalled_first_address_falls_back_within_budget(self, monkeypatch):
        import time

        rec = _StallFirstBackend()
        monkeypatch.setattr(s, "_inner_network_backend", lambda: rec)
        v6 = "2606:2800:220:1:248:1893:25c8:1946"
        _resolver(monkeypatch, [v6, PUBLIC])
        t0 = time.monotonic()
        stream = await s._PinnedNetworkBackend().connect_tcp(
            "literature.example.com", 443, timeout=2.0
        )
        elapsed = time.monotonic() - t0
        assert isinstance(stream, _Stream) and stream.ip == PUBLIC
        assert elapsed < 1.0, f"fallback took {elapsed:.2f}s — the stalled address ate the budget"
        assert [ip for ip, _ in rec.dials] == [v6, PUBLIC]
        assert rec.cancelled == [v6], "the losing attempt must be cancelled"

    async def test_overall_deadline_still_raises_connect_timeout(self, monkeypatch):
        class _AllStall(_RecordingBackend):
            async def connect_tcp(
                self, host, port, timeout=None, local_address=None, socket_options=None
            ):
                import asyncio

                self.dials.append((host, port))
                await asyncio.sleep(30)

        rec = _AllStall()
        monkeypatch.setattr(s, "_inner_network_backend", lambda: rec)
        _resolver(monkeypatch, [PUBLIC, "93.184.216.35"])
        with pytest.raises(httpcore.ConnectTimeout):
            await s._PinnedNetworkBackend().connect_tcp("literature.example.com", 443, timeout=0.6)
        assert {ip for ip, _ in rec.dials} == {PUBLIC, "93.184.216.35"}
