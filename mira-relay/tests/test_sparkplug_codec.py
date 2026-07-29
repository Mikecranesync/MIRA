"""Sparkplug B wire codec — encode/decode round-trips + topic parsing.

No broker, no Ignition, no protobuf runtime: payloads are built with the codec's
own ``encode_*`` helpers and decoded back. Real Ignition bytes use the identical
wire format, so a green round-trip here is the decoder's correctness proof.
"""

from __future__ import annotations

import pytest

from mqtt_ingest.codecs import sparkplug_b as spb


# ── topic parsing ────────────────────────────────────────────────────────────
def test_parse_node_topic():
    t = spb.parse_topic("spBv1.0/FactoryLM/NDATA/Edge1")
    assert t is not None
    assert (t.group_id, t.message_type, t.edge_node_id, t.device_id) == (
        "FactoryLM",
        "NDATA",
        "Edge1",
        None,
    )
    assert t.is_node_level and t.is_data and not t.is_birth and not t.is_death


def test_parse_device_topic():
    t = spb.parse_topic("spBv1.0/FactoryLM/DBIRTH/Edge1/Conv_Simple")
    assert t is not None
    assert t.device_id == "Conv_Simple"
    assert t.is_birth and not t.is_node_level


def test_parse_death_and_command_flags():
    assert spb.parse_topic("spBv1.0/G/NDEATH/E").is_death
    assert spb.parse_topic("spBv1.0/G/DDEATH/E/D").is_death
    assert spb.parse_topic("spBv1.0/G/NCMD/E").is_command
    assert spb.parse_topic("spBv1.0/G/DCMD/E/D").is_command


def test_parse_rejects_non_sparkplug_and_malformed():
    assert spb.parse_topic("FactoryLM/cell1/motor") is None  # not spBv1.0
    assert spb.parse_topic("spBv1.0/G") is None  # too short
    assert spb.parse_topic("spBv1.0/G/BOGUS/E") is None  # unknown type
    assert spb.parse_topic("") is None


# ── datatype → value_type map ────────────────────────────────────────────────
@pytest.mark.parametrize(
    "dt,expected",
    [
        (spb.DT_INT8, "int"),
        (spb.DT_INT64, "int"),
        (spb.DT_UINT32, "int"),
        (spb.DT_DATETIME, "int"),
        (spb.DT_FLOAT, "float"),
        (spb.DT_DOUBLE, "float"),
        (spb.DT_BOOLEAN, "bool"),
        (spb.DT_STRING, "string"),
        (spb.DT_TEXT, "string"),
        (spb.DT_UUID, "string"),
        (None, "string"),
    ],
)
def test_datatype_to_value_type(dt, expected):
    assert spb.datatype_to_value_type(dt) == expected


# ── metric round-trips (the correctness core) ────────────────────────────────
def _roundtrip_one(**kw) -> spb.Metric:
    payload = spb.encode_payload([spb.encode_metric(**kw)])
    decoded = spb.decode_payload(payload)
    assert len(decoded.metrics) == 1
    return decoded.metrics[0]


def test_roundtrip_int():
    m = _roundtrip_one(name="Count", datatype=spb.DT_INT32, value=42)
    assert m.name == "Count" and m.datatype == spb.DT_INT32 and m.value == 42


def test_roundtrip_long():
    m = _roundtrip_one(name="Big", datatype=spb.DT_INT64, value=10_000_000_000)
    assert m.value == 10_000_000_000


def test_roundtrip_float_and_double():
    mf = _roundtrip_one(name="Hz", datatype=spb.DT_FLOAT, value=60.0)
    assert mf.value == pytest.approx(60.0)
    md = _roundtrip_one(name="Amps", datatype=spb.DT_DOUBLE, value=3.14159)
    assert md.value == pytest.approx(3.14159)


def test_roundtrip_bool():
    assert _roundtrip_one(name="Run", datatype=spb.DT_BOOLEAN, value=True).value is True
    assert _roundtrip_one(name="Run", datatype=spb.DT_BOOLEAN, value=False).value is False


def test_roundtrip_string():
    m = _roundtrip_one(name="Mode", datatype=spb.DT_STRING, value="AUTO")
    assert m.value == "AUTO"


def test_roundtrip_alias_only_metric():
    # DATA-style metric: alias + value, no name.
    m = _roundtrip_one(alias=7, datatype=spb.DT_FLOAT, value=49.5)
    assert m.name is None and m.alias == 7 and m.value == pytest.approx(49.5)


def test_is_null_metric_has_no_value():
    m = _roundtrip_one(name="Maybe", datatype=spb.DT_INT32, is_null=True)
    assert m.is_null is True and m.value is None


def test_payload_timestamp_and_seq_roundtrip():
    payload = spb.encode_payload(
        [spb.encode_metric(name="X", datatype=spb.DT_INT32, value=1, timestamp=1_700_000_000_000)],
        timestamp=1_700_000_000_001,
        seq=5,
    )
    decoded = spb.decode_payload(payload)
    assert decoded.timestamp == 1_700_000_000_001
    assert decoded.seq == 5
    assert decoded.metrics[0].timestamp == 1_700_000_000_000


def test_multiple_metrics_in_one_payload():
    payload = spb.encode_payload(
        [
            spb.encode_metric(name="A", alias=1, datatype=spb.DT_INT32, value=1),
            spb.encode_metric(name="B", alias=2, datatype=spb.DT_BOOLEAN, value=True),
        ]
    )
    decoded = spb.decode_payload(payload)
    assert [m.name for m in decoded.metrics] == ["A", "B"]
    assert decoded.metrics[1].value is True


# ── corrupt input is a clean error, not a crash ──────────────────────────────
def test_truncated_buffer_raises_decode_error():
    good = spb.encode_payload([spb.encode_metric(name="X", datatype=spb.DT_INT32, value=1)])
    with pytest.raises(spb.DecodeError):
        spb.decode_payload(good[:-1])  # chop the last byte


def test_truncated_varint_raises():
    with pytest.raises(spb.DecodeError):
        spb.decode_payload(b"\x08\xff")  # field 1 varint, never terminates
