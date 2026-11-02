"""cv101_relay_poller: read-only, canonical-contract, identity + map-signature tests."""

import ast
import json
import re
from pathlib import Path

import cv101_relay_poller as p
import pytest

SRC = Path(p.__file__).read_text(encoding="utf-8")
PLC_DIR = Path(p.__file__).resolve().parents[1]


def coil_offsets(xml_rel: str) -> set[int]:
    """0-based coil offsets a Modbus slave-map XML declares (addresses 000001..099999)."""
    text = (PLC_DIR / xml_rel).read_text(encoding="utf-8")
    return {int(a) - 1 for a in re.findall(r'address="(0\d{5})"', text) if 0 < int(a) < 100000}


# Observed on the bench Micro820 2026-11-02 (read-only probe): ConvSimple coils +
# slave-map v2 offsets 20..22; offset 1 and 99 return exception 2.
BENCH_SPARSE_V2 = {0, 3, 5, 9, *range(11, 23)}


class _Resp:
    def __init__(self, bit=None, exc=None):
        self.bits, self.exception_code = [bit], exc

    def isError(self):  # noqa: N802 — pymodbus API
        return self.exception_code is not None


class FakeV4Plc:
    """Coil space of the flashed bench map unless ``mapped`` is given."""

    MAPPED = BENCH_SPARSE_V2

    def __init__(self, di05=False, mapped=None):
        self.di05, self.mapped, self.calls = di05, mapped or self.MAPPED, []

    def read_coils(self, offset, count=1, device_id=1):
        self.calls.append(("read_coils", offset, count))
        if offset not in self.mapped:
            return _Resp(exc=2)
        return _Resp(bit=self.di05 if offset == 22 else False)


def test_module_never_calls_a_modbus_write():
    called = {
        n.func.attr
        for n in ast.walk(ast.parse(SRC))
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
    }
    assert not {a for a in called if a.startswith("write_")}
    assert "read_coils" in called


def test_reads_coil_000023_only_for_di05():
    plc = FakeV4Plc(di05=True)
    assert p.read_coil(plc, p.DI05_COIL_OFFSET) == (True, None)
    assert plc.calls == [("read_coils", 22, 1)]


def test_xml_fixtures_put_di05_where_the_guard_expects():
    v4 = (PLC_DIR / "MbSrvConf_v4.xml").read_text(encoding="utf-8")
    assert re.search(r'variable="_IO_EM_DI_05"[^>]*address="000023"', v4)
    step1 = (PLC_DIR / "ccw/drive_test/step1_io_check/MbSrvConf_import.xml").read_text(
        encoding="utf-8"
    )
    assert re.search(r'variable="_IO_EM_DI_05"[^>]*address="000006"', step1)


@pytest.mark.parametrize(
    "mapped,expected",
    [
        (coil_offsets("MbSrvConf_v4.xml"), True),  # canonical full v4 (offset 1 mapped)
        (BENCH_SPARSE_V2, True),  # what is actually flashed today
        (coil_offsets("MbSrvConf_v3.xml"), False),  # 000023 unmapped
        (coil_offsets("MbSrvConf_ConvSimple_v1.9.xml"), False),  # 000023 unmapped
        (coil_offsets("ccw/drive_test/step1_io_check/MbSrvConf_import.xml"), False),  # DI_05 @ 6
    ],
)
def test_map_signature_against_repo_maps(mapped, expected):
    plc = FakeV4Plc(mapped=mapped)
    assert p.map_signature_ok(lambda off: p.read_coil(plc, off)) is expected
    assert all(c[0] == "read_coils" for c in plc.calls)


def test_transport_failure_raises_not_a_value():
    class Dead:
        def read_coils(self, *a, **k):
            raise OSError("connection reset")

    with pytest.raises(OSError):
        p.read_coil(Dead(), 22)


def test_payload_is_canonical_plc_bridge_identity_not_ignition():
    payload = p.build_payload(True, 1793590925.123, 4.2)
    assert payload["source_system"] == "plc_bridge"
    assert payload["source_connection_id"] == "cv101-bench-modbus"
    assert "tenant_id" not in payload  # HMAC header is authoritative
    (tag,) = payload["tags"]
    assert tag["tag_path"] == "micro820/_IO_EM_DI_05"
    assert "MIRA_IOCheck" not in json.dumps(payload)
    assert tag["value"] is True and tag["value_type"] == "bool" and tag["quality"] == "good"
    assert tag["ts"] == "2026-11-02T03:42:05.123Z"
    assert tag["metadata"]["modbus_coil"] == "000023"


def test_normalized_key_matches_seed():
    from ingest_contract import normalize_tag_path

    seed = (
        Path(p.__file__).resolve().parents[2]
        / "tools"
        / "seeds"
        / "approved_tags_cv101_modbus_di05.sql"
    ).read_text(encoding="utf-8")
    norm = normalize_tag_path(p.TAG_PATH)
    assert norm == "micro820_io_em_di_05"
    assert f"'{p.TAG_PATH}'" in seed and f"'{norm}'" in seed and "'plc_bridge'" in seed


@pytest.mark.parametrize(
    "value,last,last_post,now,expected",
    [
        (True, None, 0.0, 1.0, True),  # first genuine read
        (True, False, 10.0, 10.3, True),  # change -> immediate
        (True, True, 10.0, 12.0, False),  # unchanged inside heartbeat
        (True, True, 10.0, 15.0, True),  # heartbeat due
    ],
)
def test_should_post(value, last, last_post, now, expected):
    assert p.should_post(value, last, last_post, now) is expected


class FakeClocks:
    def __init__(self, wall=1000.0, mono=0.0):
        self.wall, self.mono = wall, mono

    def advance(self, dt):
        self.wall += dt
        self.mono += dt


def test_clock_applies_measured_offset_and_records_it():
    t = FakeClocks()
    clock = p.Clock(query=lambda host: 45.6, wall=lambda: t.wall, mono=lambda: t.mono)
    clock.refresh()
    ts, meta = clock.stamp(t.wall, t.mono)
    assert ts == pytest.approx(1045.6)
    assert meta["clock_offset_s"] == 45.6 and meta["clock_source"].startswith("sntp:")
    assert meta["host_clock_utc"] == "1970-01-01T00:16:40.000Z"


@pytest.mark.parametrize("host_step", [45.6, -30.0])
def test_host_clock_step_between_refreshes_is_not_double_applied(host_step):
    t = FakeClocks()
    clock = p.Clock(query=lambda host: 45.6, wall=lambda: t.wall, mono=lambda: t.mono)
    clock.refresh()
    t.advance(10)
    t.wall += host_step  # e.g. Windows Time starts and steps the host clock
    clock.refresh()  # inside NTP_REFRESH_S: no re-measure
    ts, meta = clock.stamp(t.wall, t.mono)
    assert ts == pytest.approx(1055.6)  # tracks elapsed monotonic time, no jump
    assert meta["clock_offset_s"] == pytest.approx(45.6 - host_step)
    t.advance(1)
    assert clock.stamp(t.wall, t.mono)[0] == pytest.approx(1056.6)


def test_clock_falls_back_to_host_time_when_ntp_unreachable_and_stale():
    answers = iter([45.6])
    t = FakeClocks()
    clock = p.Clock(
        query=lambda host: next(answers, None), wall=lambda: t.wall, mono=lambda: t.mono
    )
    clock.refresh()
    t.advance(p.NTP_REFRESH_S + 1)
    clock.refresh()  # NTP fails, anchor still young enough
    assert clock.stamp(t.wall, t.mono)[1]["clock_source"].startswith("sntp:")
    t.advance(p.NTP_MAX_AGE_S)
    clock.refresh()  # fails again, anchor too old
    ts, meta = clock.stamp(t.wall, t.mono)
    assert ts == t.wall and meta["clock_source"] == "host" and "clock_offset_s" not in meta


def _reply(
    request, t1, *, li=0, mode=4, stratum=2, offset=45.6, rtt=0.04, originate=None, zero=False
):
    t2 = t1 + rtt / 2 + offset
    t3 = t2 + 0.001
    hdr = bytes([(li << 6) | (4 << 3) | mode, stratum]) + bytes(22)
    orig = request[40:48] if originate is None else originate
    rx, tx = (bytes(8), bytes(8)) if zero else (p._to_ntp(t2), p._to_ntp(t3))
    return hdr + orig + rx + tx, t1 + rtt + 0.001


def test_parse_sntp_accepts_a_valid_server_reply():
    t1 = 1793590925.0
    req = p.sntp_request(t1)
    data, t4 = _reply(req, t1)
    assert p.parse_sntp(data, req, t1, t4, 2.0) == pytest.approx(45.6, abs=0.01)


@pytest.mark.parametrize(
    "kw",
    [
        {"stratum": 0},  # kiss-o'-death (DENY/RATE)
        {"stratum": 16},  # unsynchronized
        {"li": 3},  # alarm: clock not synchronized
        {"mode": 3},  # not a server reply
        {"originate": bytes(8)},  # does not echo our transmit timestamp
        {"zero": True},  # zero receive/transmit timestamps
        {"offset": -4002579725.0},  # the 1900 timestamp Codex produced
        {"rtt": 5.0},  # over-timeout round trip
    ],
)
def test_parse_sntp_rejects_invalid_replies(kw):
    t1 = 1793590925.0
    req = p.sntp_request(t1)
    data, t4 = _reply(req, t1, **kw)
    assert p.parse_sntp(data, req, t1, t4, 2.0) is None
    assert p.parse_sntp(data[:47], req, t1, t4, 2.0) is None


def test_refresh_tries_next_server_and_keeps_valid_anchor_on_bad_replies():
    t = FakeClocks()
    answers = {"a": [45.6, None], "b": [None, None]}
    clock = p.Clock(
        query=lambda host: answers[host].pop(0), wall=lambda: t.wall, mono=lambda: t.mono
    )
    p_hosts, p.NTP_HOSTS = p.NTP_HOSTS, ("a", "b")
    try:
        clock.refresh()
        t.advance(p.NTP_REFRESH_S + 1)
        clock.refresh()  # both servers reply invalid -> keep the existing anchor
    finally:
        p.NTP_HOSTS = p_hosts
    ts, meta = clock.stamp(t.wall, t.mono)
    assert ts == pytest.approx(t.wall + 45.6) and meta["clock_source"] == "sntp:a"


def test_post_signs_with_corrected_time_so_a_slow_host_still_authenticates():
    """F5: host 600 s behind true time; SNTP anchor +600 s. Both the reading ts and
    the HMAC timestamp must use corrected time and pass the real verify_hmac."""
    from auth import verify_hmac

    server_now = 1793590925.0
    t = FakeClocks(wall=server_now - 600, mono=50.0)
    clock = p.Clock(query=lambda host: 600.0, wall=lambda: t.wall, mono=lambda: t.mono)
    clock.refresh()
    stamped, meta = clock.stamp(t.wall, t.mono)
    payload = p.build_payload(True, stamped, 3.0, meta)

    class VerifyingHttp:
        def post(self, url, content, headers):
            tenant = verify_hmac(headers, content, "k" * 32, _now=server_now)
            assert tenant == "tenant-a"
            body = json.loads(content)

            class R:
                status_code = 200

                @staticmethod
                def json():
                    return {"accepted": 1, "ts": body["tags"][0]["ts"]}

            return R()

    sign_now, _ = clock.stamp(t.wall, t.mono)
    code, resp = p.post(VerifyingHttp(), payload, "tenant-a", "k" * 32, sign_now)
    assert code == 200 and resp["accepted"] == 1
    assert resp["ts"] == "2026-11-02T03:42:05.000Z"


def test_uncorrected_host_signing_time_would_be_rejected():
    """Negative control: signing with the slow host clock fails the relay window."""
    from auth import sign_hmac_headers, verify_hmac

    server_now = 1793590925.0
    headers = sign_hmac_headers("tenant-a", b"{}", "k" * 32, now=server_now - 600)
    with pytest.raises(ValueError, match="bad_timestamp"):
        verify_hmac(headers, b"{}", "k" * 32, _now=server_now)
