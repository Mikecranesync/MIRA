"""cv101_relay_poller: read-only, canonical-contract, identity + map-signature tests."""

import ast
import json
from pathlib import Path

import cv101_relay_poller as p
import pytest

SRC = Path(p.__file__).read_text(encoding="utf-8")


class _Resp:
    def __init__(self, bit=None, exc=None):
        self.bits, self.exception_code = [bit], exc

    def isError(self):  # noqa: N802 — pymodbus API
        return self.exception_code is not None


class FakeV4Plc:
    """Coil space of MbSrvConf_v4: 0,3,5,9,11..22 mapped; 1 and 99 unmapped."""

    MAPPED = {0, 3, 5, 9, *range(11, 23)}

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


def test_map_signature_accepts_v4_map():
    plc = FakeV4Plc()
    assert p.map_signature_ok(lambda off: p.read_coil(plc, off)) is True
    assert all(c[0] == "read_coils" for c in plc.calls)


def test_map_signature_rejects_step1_io_check_map():
    # Step-1 IO-check map: coils 1..20 + 100 mapped -> DI_05 lives at coil 6, not 23.
    plc = FakeV4Plc(mapped={*range(0, 20), 99})
    assert p.map_signature_ok(lambda off: p.read_coil(plc, off)) is False


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


def test_clock_applies_measured_offset_and_records_it():
    clock = p.Clock(query=lambda host: 45.6)
    clock.refresh(0.0)
    ts, meta = clock.stamp(1000.0)
    assert ts == pytest.approx(1045.6)
    assert meta["clock_offset_s"] == 45.6 and meta["clock_source"].startswith("sntp:")
    assert meta["host_clock_utc"] == "1970-01-01T00:16:40.000Z"


def test_clock_falls_back_to_host_time_when_ntp_unreachable_and_stale():
    answers = iter([45.6])
    clock = p.Clock(query=lambda host: next(answers, None))
    clock.refresh(0.0)
    clock.refresh(p.NTP_REFRESH_S + 1)  # NTP fails, offset still fresh enough
    assert clock.offset == 45.6
    clock.refresh(p.NTP_MAX_AGE_S + p.NTP_REFRESH_S * 2)  # fails again, now too old
    ts, meta = clock.stamp(1000.0)
    assert ts == 1000.0 and meta["clock_source"] == "host" and "clock_offset_s" not in meta
