# gateway_live_snapshot.py — THE canonical Gateway live tag-snapshot adapter.
#
# Importable from BOTH:
#   * Jython 2.7 inside the Ignition Gateway (WebDev chat handler, timer scripts)
#   * Python 3 under pytest (tests/ignition/test_gateway_live_snapshot.py)
#
# ── Why this module exists ───────────────────────────────────────────────────
#
# The PLC laptop produced TWO INCOMPATIBLE SHAPES for the same physical readings:
#
#   1. STREAM  — gateway-scripts/tag-stream.py → collector.build_reading()
#                → typed {tag_path, value, value_type, quality, ts} where value
#                keeps its Python type and quality is BANDED to
#                good|bad|stale|uncertain, allowlisted FAIL-CLOSED, HMAC-signed,
#                POSTed to mira-relay /api/v1/tags/ingest.
#
#   2. CHAT    — api/chat/doPost.py read tags itself and built
#                {path: {value: str(v), quality: str(q), timestamp: str(ts)}}
#                — every value STRINGIFIED, the raw Ignition quality string
#                passed through UNBANDED, and the allowlist applied through a
#                different API inside `except ImportError: pass`, i.e. FAIL-OPEN.
#
# Same tags, same gateway, same instant — two evidence shapes. Downstream that
# means `value` is sometimes a float and sometimes "42.0", `quality` is sometimes
# "good" and sometimes "Good_Unspecified", and a chat turn could ship
# non-allowlisted tags if one import failed. This module makes both paths derive
# from ONE reading contract.
#
# ── What this module is NOT ──────────────────────────────────────────────────
#
# Not a new ingestion system, transport, normalizer, parser, database writer, or
# runtime context schema. It is a RENDERER over collector.py's existing readings:
#
#     read (injected)  →  collector.build_reading()   [typed, one definition]
#                      →  collector.filter_allowlisted()  [fail-closed]
#                      →  render for the transport that asked
#
# STREAM renders via collector.build_payload() (a list of readings).
# CHAT   renders via snapshot_from_readings() below (a dict keyed by tag path,
#        which is what mira-pipeline/ignition_chat.py::_format_tag_preamble reads).
#
# READ-ONLY BY CONSTRUCTION: this module imports nothing from Ignition and takes
# only reader callables. There is no code path here that can write a tag, send a
# command, or reach a fieldbus — see .claude/rules/fieldbus-readonly.md. The
# read-only gate test asserts this mechanically.
#
# Ref: docs/integrations/ignition-tag-collector.md
#      .claude/rules/direct-connection-uns-certified.md
#      .claude/rules/one-pipeline-ingest.md

from collector import build_reading, filter_allowlisted, load_allowlist_set

# The Ignition tag folder convention the chat handler browses for an asset.
MONITORED_FOLDER_TEMPLATE = "[default]Mira_Monitored/%s"


def monitored_folder(asset_id):
    """The browse root for one asset's monitored tags."""
    return MONITORED_FOLDER_TEMPLATE % asset_id


def snapshot_from_readings(readings):
    """Render typed readings as the chat `tag_snapshot` dict.

    Keyed by tag_path because that is the shape
    mira-pipeline/ignition_chat.py::_format_tag_preamble consumes (it sorts the
    keys and reads `value` / `quality`, plus optional `units` / `data_type` added
    later by cloud-side semantic enrichment).

    `value` keeps its Python type and `quality` is the BANDED band — the two
    things the old chat path destroyed. `value_type` rides along so a consumer
    can tell 0 from False from "0" without re-inferring, and `ts` replaces the
    old stringified timestamp.
    """
    snapshot = {}
    for r in readings:
        path = r.get("tag_path")
        if not path:
            continue
        snapshot[path] = {
            "value": r.get("value"),
            "value_type": r.get("value_type"),
            "quality": r.get("quality"),
            "ts": r.get("ts"),
        }
    return snapshot


def read_tag_readings(browse_fn, read_fn, folder, now_fn=None):
    """Browse `folder`, read the tags, and return typed readings.

    All Ignition I/O is INJECTED so this is unit-testable without a Gateway:

        browse_fn(folder) -> iterable of objects with `.fullPath`
                             (wraps system.tag.browseTags)
        read_fn(paths)    -> list of qualified values with
                             `.value` / `.quality` / `.timestamp`
                             (wraps system.tag.readBlocking)
        now_fn()          -> optional timestamp override; when omitted the tag's
                             own `.timestamp` is used, which is the truthful
                             observation time rather than the read time.

    Returns [] on any failure. A snapshot is best-effort evidence: a chat turn
    must still be answerable (grounded in docs, and honest that live data is
    missing) when the tag system is unreachable. The caller logs; this module
    stays pure.
    """
    try:
        browsed = browse_fn(folder)
    except Exception:  # noqa: BLE001  (Jython: broad catch, caller logs)
        return []
    if not browsed:
        return []

    try:
        paths = [str(t.fullPath) for t in browsed]
    except Exception:  # noqa: BLE001
        return []
    if not paths:
        return []

    try:
        qvs = read_fn(paths)
    except Exception:  # noqa: BLE001
        return []
    if qvs is None:
        return []

    readings = []
    for i, path in enumerate(paths):
        try:
            qv = qvs[i]
        except (IndexError, TypeError, KeyError):
            # Short/ragged read result: skip the tag rather than inventing a
            # value. Fabricating a reading would put a made-up number in front
            # of a technician.
            continue
        ts = now_fn() if now_fn is not None else getattr(qv, "timestamp", None)
        readings.append(
            build_reading(
                path,
                getattr(qv, "value", None),
                getattr(qv, "quality", None),
                ts=str(ts) if ts is not None else None,
            )
        )
    return readings


def collect_live_snapshot(
    browse_fn,
    read_fn,
    asset_id,
    allowlist=None,
    now_fn=None,
):
    """THE canonical entry point for a chat-path live snapshot.

    Read → type → allowlist (FAIL-CLOSED) → render as the chat dict.

    Returns (snapshot, stats) where stats is
    {read, allowed, dropped, allowlist_loaded} so the caller can log what was
    filtered instead of silently shrinking the evidence.

    FAIL-CLOSED is the load-bearing behaviour: with no resolvable allowlist the
    snapshot is EMPTY, never unfiltered. The path this replaces wrapped its
    allowlist import in `except ImportError: pass` and shipped the raw snapshot
    when the import failed — a non-allowlisted tag could reach the cloud. An
    empty snapshot degrades the answer; an unfiltered one breaks the tag
    contract, so empty is the correct failure.

    `asset_id` empty => no snapshot. A chat turn with no asset has no live
    context to attach, and browsing a bare folder root would be meaningless.
    """
    stats = {"read": 0, "allowed": 0, "dropped": 0, "allowlist_loaded": False}
    if not asset_id:
        return {}, stats

    readings = read_tag_readings(browse_fn, read_fn, monitored_folder(asset_id), now_fn=now_fn)
    stats["read"] = len(readings)
    if not readings:
        return {}, stats

    if allowlist is None:
        try:
            allowlist = load_allowlist_set()
        except Exception:  # noqa: BLE001
            allowlist = set()
    stats["allowlist_loaded"] = bool(allowlist)

    allowed = filter_allowlisted(readings, allowlist)
    stats["allowed"] = len(allowed)
    stats["dropped"] = len(readings) - len(allowed)

    return snapshot_from_readings(allowed), stats
