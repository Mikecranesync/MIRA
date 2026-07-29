"""Sparkplug B decode state machine — BIRTH alias table, DATA resolution, DEATH.

Drives ``SparkplugDecoder`` directly with encoded payloads (no broker). Asserts
the canonical tag entries it emits and the lifecycle signals.
"""

from __future__ import annotations

from mqtt_ingest.codecs import sparkplug_b as spb
from mqtt_ingest.decode import SparkplugDecoder, metric_to_tag_path

GROUP, EDGE, DEVICE = "FactoryLM", "ConveyorEdge", "Conv_Simple"


def _topic(mtype: str, device: bool = True) -> str:
    base = f"spBv1.0/{GROUP}/{mtype}/{EDGE}"
    return f"{base}/{DEVICE}" if device else base


def _birth(metrics: list[bytes], seq: int = 0) -> bytes:
    return spb.encode_payload(metrics, timestamp=1_700_000_000_000, seq=seq)


def test_birth_registers_aliases_and_emits_initial_values():
    dec = SparkplugDecoder()
    payload = _birth(
        [
            spb.encode_metric(
                name="Conveyor/Motor_Running", alias=1, datatype=spb.DT_BOOLEAN, value=True
            ),
            spb.encode_metric(name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0),
        ]
    )
    res = dec.handle(_topic("DBIRTH"), payload)
    assert len(res.entries) == 2
    paths = {e["tag_path"] for e in res.entries}
    assert f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/Motor_Running" in paths
    # discovered both tags
    assert len(res.discovered) == 2
    # value_type carried from datatype
    by_path = {e["tag_path"]: e for e in res.entries}
    assert by_path[f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/VFD_Hz"]["value_type"] == "float"
    assert by_path[f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/Motor_Running"]["value_type"] == "bool"


def test_data_resolves_alias_against_birth_table():
    dec = SparkplugDecoder()
    dec.handle(
        _topic("DBIRTH"),
        _birth(
            [
                spb.encode_metric(
                    name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0
                ),
            ]
        ),
    )
    # DDATA carries ALIAS ONLY (no name, no datatype) — must resolve via BIRTH.
    data = spb.encode_payload([spb.encode_metric(alias=2, value=49.5, datatype=spb.DT_FLOAT)])
    res = dec.handle(_topic("DDATA"), data)
    assert len(res.entries) == 1
    entry = res.entries[0]
    assert entry["tag_path"] == f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/VFD_Hz"
    assert entry["value"] == 49.5
    assert entry["value_type"] == "float"  # recovered from BIRTH datatype
    assert entry["metadata"]["source_protocol"] == "sparkplug_b"
    assert entry["metadata"]["edge_node"] == EDGE


def test_data_before_birth_is_dropped_not_crashed():
    dec = SparkplugDecoder()
    data = spb.encode_payload([spb.encode_metric(alias=99, value=1.0, datatype=spb.DT_FLOAT)])
    res = dec.handle(_topic("DDATA"), data)
    assert res.entries == []
    assert res.dropped == 1


def test_death_marks_known_tags_offline():
    dec = SparkplugDecoder()
    dec.handle(
        _topic("DBIRTH"),
        _birth(
            [
                spb.encode_metric(
                    name="Conveyor/Motor_Running", alias=1, datatype=spb.DT_BOOLEAN, value=True
                ),
                spb.encode_metric(
                    name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0
                ),
            ]
        ),
    )
    res = dec.handle(_topic("DDEATH"), spb.encode_payload([]))
    assert set(res.offline_tag_paths) == {
        f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/Motor_Running",
        f"{GROUP}/{EDGE}/{DEVICE}/Conveyor/VFD_Hz",
    }


def test_rebirth_is_idempotent_for_discovery():
    dec = SparkplugDecoder()
    birth = _birth(
        [spb.encode_metric(name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0)]
    )
    first = dec.handle(_topic("DBIRTH"), birth)
    second = dec.handle(_topic("DBIRTH"), birth)
    assert len(first.discovered) == 1
    assert second.discovered == []  # already known → not re-discovered
    # alias table still resolves after rebirth
    data = spb.encode_payload([spb.encode_metric(alias=2, value=55.0, datatype=spb.DT_FLOAT)])
    assert dec.handle(_topic("DDATA"), data).entries[0]["value"] == 55.0


def test_command_and_state_and_nonspb_are_ignored():
    dec = SparkplugDecoder()
    assert dec.handle(_topic("NCMD", device=False), b"").ignored_reason == "command_topic"
    assert dec.handle(_topic("DCMD"), b"").ignored_reason == "command_topic"
    assert dec.handle("spBv1.0/G/STATE/E", b"").ignored_reason == "state_topic"
    assert dec.handle("FactoryLM/not/sparkplug", b"").ignored_reason == "not_sparkplug"


def test_corrupt_payload_is_ignored_not_raised():
    dec = SparkplugDecoder()
    res = dec.handle(_topic("DDATA"), b"\x08\xff\xff")  # truncated varint
    assert res.ignored_reason == "decode_error"
    assert res.entries == []


def test_metric_to_tag_path_node_vs_device():
    node = spb.parse_topic("spBv1.0/FactoryLM/NDATA/Edge1")
    dev = spb.parse_topic("spBv1.0/FactoryLM/DDATA/Edge1/Dev1")
    assert metric_to_tag_path(node, "Motor/Run") == "FactoryLM/Edge1/Motor/Run"
    assert metric_to_tag_path(dev, "Motor/Run") == "FactoryLM/Edge1/Dev1/Motor/Run"


def test_null_metric_skipped_in_data():
    dec = SparkplugDecoder()
    dec.handle(
        _topic("DBIRTH"),
        _birth(
            [
                spb.encode_metric(
                    name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0
                ),
            ]
        ),
    )
    data = spb.encode_payload([spb.encode_metric(alias=2, datatype=spb.DT_FLOAT, is_null=True)])
    res = dec.handle(_topic("DDATA"), data)
    assert res.entries == []  # null carries no value to ingest
