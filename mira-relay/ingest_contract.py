"""Canonical tag-ingest contract — the ONE normalizer + batch builder.

Every tag source funnels through these before ``tag_ingest.ingest_batch`` so
there is a single normalization result and a single batch shape across all
ingestion transports:

  * the relay HTTP matcher (``tag_ingest.normalize_tag_path`` re-exports from here)
  * SimLab's ``RelayIngestPublisher`` (repo-root bench tool — loads this file)
  * the ``approved_tags`` seed generator (``tools/seeds/gen_approved_tags_simulator.py``)
  * the future ``mira-relay/mqtt_ingest`` plain-JSON / Sparkplug subscribers
  * the future production engine bridge

**Why it lives in ``mira-relay`` (and is dependency-free):** the relay matcher
and the future MQTT codec run inside the relay container, which is built by the
``mira-relay`` Dockerfile with **per-file ``COPY``** — a shared module elsewhere
would not be present at runtime. Cross-container producers that POST over the
wire (SimLab, the engine bridge) load this exact file by path, so there is never
a second copy of the fail-closed match key. See the Lane 3 design review,
``docs/design/2026-06-23-lane3-mqtt-subscriber-design.md`` §7.

This module imports only the stdlib (``re``) so any producer can load it cheaply.
"""

from __future__ import annotations

import re
from typing import Any, Optional

_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# The vocabularies ``tag_ingest.ingest_batch`` validates against. Re-stated here
# as the contract; ``tag_ingest`` remains the single ENFORCEMENT point (a builder
# is intentionally permissive — it shapes, it does not reject).
VALID_VALUE_TYPES: tuple[str, ...] = ("bool", "int", "float", "string", "enum")
VALID_QUALITY: tuple[str, ...] = ("good", "bad", "stale", "uncertain")


def normalize_tag_path(raw: str) -> str:
    """uns.slug-style normalization: lowercase, runs of non-alphanumerics → '_',
    trim leading/trailing '_'. Path separators ('/', '.', ':') collapse to '_', so
    ``'Mira_Monitored/Conveyor/Motor_Current'`` → ``'mira_monitored_conveyor_motor_current'``.

    THE fail-closed match key: the relay matches incoming traffic's normalized
    path against ``approved_tags.normalized_tag_path``. Every tag source and every
    allowlist seed MUST normalize identically — so they all call THIS function.
    Mirrors ``mira-crawler/ingest/uns.slug()`` (kept local to avoid importing the
    heavy ingest package into the relay container).
    """
    if not raw:
        return ""
    return _NON_ALNUM.sub("_", raw.strip().lower()).strip("_")


def build_tag_entry(
    tag_path: str,
    value: Any,
    *,
    value_type: str = "string",
    quality: str = "good",
    ts: Optional[str] = None,
    equipment_entity_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> dict[str, Any]:
    """Build ONE canonical tag entry — the dict ``ingest_batch`` iterates over.

    Producers that build entries from a raw message (the future MQTT / Sparkplug
    codecs, the engine bridge) call this so every transport emits the identical
    entry shape. Optional keys are omitted when ``None`` so the result matches the
    minimal HTTP-path shape (``{tag_path, value, value_type, quality[, ts, …]}``).

    The builder is intentionally permissive — it does not validate ``value_type``
    / ``quality`` against the vocabularies above; ``ingest_batch`` is the single
    enforcement point (unknown ``quality`` is downgraded to ``uncertain`` there,
    bad ``value_type`` is rejected there).
    """
    entry: dict[str, Any] = {
        "tag_path": tag_path,
        "value": value,
        "value_type": value_type,
        "quality": quality,
    }
    if ts is not None:
        entry["ts"] = ts
    if equipment_entity_id is not None:
        entry["equipment_entity_id"] = equipment_entity_id
    if metadata is not None:
        entry["metadata"] = metadata
    return entry


def build_ingest_batch(
    source_system: str,
    tags: list[dict[str, Any]],
    *,
    tenant_id: Optional[str] = None,
    source_connection_id: Optional[str] = None,
) -> dict[str, Any]:
    """Assemble the canonical batch payload ``POST /api/v1/tags/ingest`` /
    ``ingest_batch`` expect: ``{source_system, tags[, tenant_id, source_connection_id]}``.

    ``tags`` are entries (each from :func:`build_tag_entry`, or an equivalent dict
    such as SimLab's ``Reading.to_ingest_tag()`` output).

    ``tenant_id`` is included only for the bench / legacy-bearer path, where the
    relay reads the tenant from the body. When the caller HMAC-signs the request
    the ``X-MIRA-Tenant`` header is authoritative, so HMAC callers pass
    ``tenant_id=None`` and the key is omitted (keeping the signed body minimal).

    Key insertion order is fixed (``source_system`` → ``tags`` → ``tenant_id`` →
    ``source_connection_id``) so the serialized body is deterministic — required
    because HMAC signs the exact bytes of this payload.
    """
    payload: dict[str, Any] = {"source_system": source_system, "tags": list(tags)}
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id
    if source_connection_id is not None:
        payload["source_connection_id"] = source_connection_id
    return payload
