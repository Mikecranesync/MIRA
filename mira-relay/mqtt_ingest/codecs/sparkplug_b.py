"""Sparkplug B codec — self-contained protobuf decode/encode (Lane 3, Phase 3b).

Sparkplug B (Eclipse Tahu) is protobuf with a stateful session model. This module
is the *wire* layer only: it turns a Sparkplug B ``Payload`` protobuf into Python
``Metric`` objects (and back, for tests/fixtures). It knows NOTHING about MIRA's
ingest pipeline — the BIRTH/alias state machine and the mapping to the canonical
``ingest_batch`` contract live one level up in ``decode.py``.

Why a hand-rolled codec instead of ``eclipse-tahu`` / generated ``sparkplug_b_pb2``:
the supported surface (scalar metrics) is a small, fixed slice of the protobuf
wire format, and vendoring it keeps the unit tests free of ``protoc``, the
``protobuf`` runtime, and any Ignition install — tests build payloads with the
``encode_*`` helpers here and assert the decoder round-trips them. Real Ignition
Sparkplug B bytes decode through the identical wire reader. Complex metric types
(DataSet/Template/PropertySet) are intentionally skipped, not mis-parsed —
:data:`UNSUPPORTED_DATATYPES`.

Read-only: this module never constructs a publish/CMD path.
Spec: docs/design/2026-06-23-lane3-mqtt-subscriber-design.md §2.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

# ── Sparkplug B topic namespace ──────────────────────────────────────────────
NAMESPACE = "spBv1.0"

# Node/device session message types. NBIRTH/DBIRTH carry the alias→name table;
# NDATA/DDATA carry aliases + values only; NDEATH/DDEATH (LWT) mark stale.
MESSAGE_TYPES = frozenset({"NBIRTH", "NDEATH", "NDATA", "DBIRTH", "DDEATH", "DDATA", "STATE"})
# Command types — a READ-ONLY subscriber must never see these as ingest and must
# never publish them (.claude/rules/fieldbus-readonly.md). Listed so callers can
# explicitly drop them.
COMMAND_MESSAGE_TYPES = frozenset({"NCMD", "DCMD"})

# ── Sparkplug B datatype enum (Tahu) → MIRA VALID_VALUE_TYPES ─────────────────
# 1..8 ints, 9 Float, 10 Double, 11 Boolean, 12 String, 13 DateTime, 14 Text,
# 15 UUID, 16 DataSet, 17 Bytes, 18 File, 19 Template.
DT_INT8, DT_INT16, DT_INT32, DT_INT64 = 1, 2, 3, 4
DT_UINT8, DT_UINT16, DT_UINT32, DT_UINT64 = 5, 6, 7, 8
DT_FLOAT, DT_DOUBLE, DT_BOOLEAN = 9, 10, 11
DT_STRING, DT_DATETIME, DT_TEXT, DT_UUID = 12, 13, 14, 15
DT_DATASET, DT_BYTES, DT_FILE, DT_TEMPLATE = 16, 17, 18, 19

_INT_DATATYPES = {
    DT_INT8,
    DT_INT16,
    DT_INT32,
    DT_INT64,
    DT_UINT8,
    DT_UINT16,
    DT_UINT32,
    DT_UINT64,
    DT_DATETIME,
}
UNSUPPORTED_DATATYPES = {DT_DATASET, DT_TEMPLATE}

DATATYPE_NAMES = {
    DT_INT8: "Int8",
    DT_INT16: "Int16",
    DT_INT32: "Int32",
    DT_INT64: "Int64",
    DT_UINT8: "UInt8",
    DT_UINT16: "UInt16",
    DT_UINT32: "UInt32",
    DT_UINT64: "UInt64",
    DT_FLOAT: "Float",
    DT_DOUBLE: "Double",
    DT_BOOLEAN: "Boolean",
    DT_STRING: "String",
    DT_DATETIME: "DateTime",
    DT_TEXT: "Text",
    DT_UUID: "UUID",
    DT_DATASET: "DataSet",
    DT_BYTES: "Bytes",
    DT_FILE: "File",
    DT_TEMPLATE: "Template",
}


def datatype_to_value_type(datatype: Optional[int]) -> str:
    """Map a Sparkplug B datatype to one of MIRA's ``VALID_VALUE_TYPES``.

    Ints → ``int``, Float/Double → ``float``, Boolean → ``bool``, everything
    text-ish (String/Text/UUID/Bytes/File) → ``string``. Unknown/None → ``string``
    so the value still lands (ingest_batch is the type authority)."""
    if datatype in _INT_DATATYPES:
        return "int"
    if datatype in (DT_FLOAT, DT_DOUBLE):
        return "float"
    if datatype == DT_BOOLEAN:
        return "bool"
    return "string"


# ── Data classes ─────────────────────────────────────────────────────────────
@dataclass
class Metric:
    """One Sparkplug B metric. ``name`` is present in BIRTH; ``alias`` may be the
    only identifier in DATA (resolved against the BIRTH table by ``decode.py``)."""

    name: Optional[str] = None
    alias: Optional[int] = None
    datatype: Optional[int] = None
    value: Any = None
    timestamp: Optional[int] = None  # epoch milliseconds (Sparkplug convention)
    is_null: bool = False


@dataclass
class SparkplugPayload:
    timestamp: Optional[int] = None  # epoch milliseconds
    seq: Optional[int] = None
    uuid: Optional[str] = None
    metrics: list[Metric] = field(default_factory=list)


@dataclass
class SparkplugTopic:
    namespace: str
    group_id: str
    message_type: str
    edge_node_id: str
    device_id: Optional[str] = None

    @property
    def is_node_level(self) -> bool:
        return self.device_id is None

    @property
    def is_death(self) -> bool:
        return self.message_type in ("NDEATH", "DDEATH")

    @property
    def is_birth(self) -> bool:
        return self.message_type in ("NBIRTH", "DBIRTH")

    @property
    def is_data(self) -> bool:
        return self.message_type in ("NDATA", "DDATA")

    @property
    def is_command(self) -> bool:
        return self.message_type in COMMAND_MESSAGE_TYPES


def parse_topic(topic: str) -> Optional[SparkplugTopic]:
    """Parse ``spBv1.0/<group>/<type>/<edge>[/<device>]``. Returns None for a
    non-Sparkplug or malformed topic (caller drops it, never raises)."""
    if not topic:
        return None
    parts = topic.split("/")
    if len(parts) < 4 or parts[0] != NAMESPACE:
        return None
    namespace, group_id, message_type, edge_node_id = parts[0], parts[1], parts[2], parts[3]
    device_id = parts[4] if len(parts) >= 5 and parts[4] else None
    if message_type not in MESSAGE_TYPES and message_type not in COMMAND_MESSAGE_TYPES:
        return None
    if not group_id or not edge_node_id:
        return None
    return SparkplugTopic(namespace, group_id, message_type, edge_node_id, device_id)


def metric_to_tag_path(topic: "SparkplugTopic", metric_name: str) -> str:
    """Build the raw tag path for a metric: ``group/edge[/device]/metric``.

    THE single path-builder. This raw path is what ``normalize_tag_path`` (in
    ingest_batch) collapses to the ``approved_tags`` match key — so the Sparkplug
    allowlist seed generator MUST call THIS function too, or live traffic and the
    seed normalize differently and every metric is silently rejected (the §5
    fail-closed contract). Lives here (dependency-free, loadable standalone) so
    both the decoder and the seed generator share one implementation."""
    parts = [topic.group_id, topic.edge_node_id]
    if topic.device_id:
        parts.append(topic.device_id)
    parts.append(metric_name)
    return "/".join(p for p in parts if p)


# ── protobuf wire-format primitives ──────────────────────────────────────────
class DecodeError(ValueError):
    """Raised on a truncated/corrupt protobuf buffer."""


def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise DecodeError("truncated varint")
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7
        if shift > 63:
            raise DecodeError("varint too long")


def _iter_fields(buf: bytes) -> Iterator[tuple[int, int, Any]]:
    """Yield ``(field_number, wire_type, raw)`` for every field in ``buf``.

    raw is: an int (wire 0); the 8-byte slice (wire 1); the bytes slice
    (wire 2); the 4-byte slice (wire 5)."""
    pos = 0
    n = len(buf)
    while pos < n:
        key, pos = _read_varint(buf, pos)
        field_number = key >> 3
        wire_type = key & 0x07
        if wire_type == 0:
            val, pos = _read_varint(buf, pos)
            yield field_number, wire_type, val
        elif wire_type == 1:
            if pos + 8 > n:
                raise DecodeError("truncated 64-bit field")
            yield field_number, wire_type, buf[pos : pos + 8]
            pos += 8
        elif wire_type == 2:
            length, pos = _read_varint(buf, pos)
            if pos + length > n:
                raise DecodeError("truncated length-delimited field")
            yield field_number, wire_type, buf[pos : pos + length]
            pos += length
        elif wire_type == 5:
            if pos + 4 > n:
                raise DecodeError("truncated 32-bit field")
            yield field_number, wire_type, buf[pos : pos + 4]
            pos += 4
        else:
            raise DecodeError(f"unsupported wire type {wire_type}")


def _decode_metric(buf: bytes) -> Metric:
    m = Metric()
    for fnum, wtype, raw in _iter_fields(buf):
        if fnum == 1 and wtype == 2:  # name
            m.name = raw.decode("utf-8", "replace")
        elif fnum == 2 and wtype == 0:  # alias
            m.alias = raw
        elif fnum == 3 and wtype == 0:  # timestamp (ms)
            m.timestamp = raw
        elif fnum == 4 and wtype == 0:  # datatype
            m.datatype = raw
        elif fnum == 7 and wtype == 0:  # is_null
            m.is_null = bool(raw)
        elif fnum == 10 and wtype == 0:  # int_value (uint32)
            m.value = raw
        elif fnum == 11 and wtype == 0:  # long_value (uint64)
            m.value = raw
        elif fnum == 12 and wtype == 5:  # float_value
            m.value = struct.unpack("<f", raw)[0]
        elif fnum == 13 and wtype == 1:  # double_value
            m.value = struct.unpack("<d", raw)[0]
        elif fnum == 14 and wtype == 0:  # boolean_value
            m.value = bool(raw)
        elif fnum == 15 and wtype == 2:  # string_value
            m.value = raw.decode("utf-8", "replace")
        elif fnum == 16 and wtype == 2:  # bytes_value
            m.value = raw
        # fields 8 (metadata), 9 (properties), 17/18/19 (dataset/template/ext)
        # are skipped — _iter_fields already advanced past them.
    if m.is_null:
        m.value = None
    return m


def decode_payload(raw: bytes) -> SparkplugPayload:
    """Decode a Sparkplug B ``Payload`` protobuf into a :class:`SparkplugPayload`.

    Raises :class:`DecodeError` on a corrupt buffer (caller drops the message)."""
    payload = SparkplugPayload()
    for fnum, wtype, val in _iter_fields(raw):
        if fnum == 1 and wtype == 0:  # payload timestamp
            payload.timestamp = val
        elif fnum == 2 and wtype == 2:  # repeated Metric
            payload.metrics.append(_decode_metric(val))
        elif fnum == 3 and wtype == 0:  # seq
            payload.seq = val
        elif fnum == 4 and wtype == 2:  # uuid
            payload.uuid = val.decode("utf-8", "replace")
        # field 5 (body bytes) skipped.
    return payload


# ── encoder (tests + captured fixtures only — never used on the ingest path) ──
def _encode_varint(value: int) -> bytes:
    if value < 0:
        value &= (1 << 64) - 1  # two's-complement 64-bit, matches protobuf
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field_number: int, wire_type: int) -> bytes:
    return _encode_varint((field_number << 3) | wire_type)


def _encode_len_delim(field_number: int, data: bytes) -> bytes:
    return _key(field_number, 2) + _encode_varint(len(data)) + data


def encode_metric(
    *,
    name: Optional[str] = None,
    alias: Optional[int] = None,
    datatype: Optional[int] = None,
    value: Any = None,
    timestamp: Optional[int] = None,
    is_null: bool = False,
) -> bytes:
    """Encode one metric to Sparkplug B protobuf bytes (test/fixture helper)."""
    out = bytearray()
    if name is not None:
        out += _encode_len_delim(1, name.encode("utf-8"))
    if alias is not None:
        out += _key(2, 0) + _encode_varint(alias)
    if timestamp is not None:
        out += _key(3, 0) + _encode_varint(timestamp)
    if datatype is not None:
        out += _key(4, 0) + _encode_varint(datatype)
    if is_null:
        out += _key(7, 0) + _encode_varint(1)
    elif value is not None:
        if datatype in (DT_FLOAT,):
            out += _key(12, 5) + struct.pack("<f", float(value))
        elif datatype in (DT_DOUBLE,):
            out += _key(13, 1) + struct.pack("<d", float(value))
        elif datatype == DT_BOOLEAN or isinstance(value, bool):
            out += _key(14, 0) + _encode_varint(1 if value else 0)
        elif datatype in _INT_DATATYPES or isinstance(value, int):
            field_no = 11 if datatype in (DT_INT64, DT_UINT64, DT_DATETIME) else 10
            out += _key(field_no, 0) + _encode_varint(int(value))
        else:
            out += _encode_len_delim(15, str(value).encode("utf-8"))
    return bytes(out)


def encode_payload(
    metrics: list[bytes],
    *,
    timestamp: Optional[int] = None,
    seq: Optional[int] = None,
    uuid: Optional[str] = None,
) -> bytes:
    """Encode a Sparkplug B ``Payload`` from already-encoded metric bytes."""
    out = bytearray()
    if timestamp is not None:
        out += _key(1, 0) + _encode_varint(timestamp)
    for m in metrics:
        out += _encode_len_delim(2, m)
    if seq is not None:
        out += _key(3, 0) + _encode_varint(seq)
    if uuid is not None:
        out += _encode_len_delim(4, uuid.encode("utf-8"))
    return bytes(out)
