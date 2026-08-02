"""``factorylm.machine-snapshot.v1`` transport — envelope in, canonical ingest out.

PRD #3048, PR 3 ("existing-ingress integration only"). Two pieces:

* :func:`snapshot_to_ingest_batch` — pure decode of the read-only FactoryLM PLC
  snapshot envelope into the batch shape ``tag_ingest.ingest_batch`` enforces.
* :class:`FactoryLMSnapshotPublisher` — HMAC-signed POST of that batch to the
  **existing** ``POST /api/v1/tags/ingest`` route.

This module defines **no** normalizer, allowlist, persistence path, batch shape,
or enforcement path (``.claude/rules/one-pipeline-ingest.md``). It calls the
canonical ``ingest_contract.build_tag_entry`` / ``build_ingest_batch`` builders
and stops there — exactly as ``simlab/publishers.py::RelayIngestPublisher``
does. Adding a FactoryLM-specific endpoint was never an option: the one-pipeline
law forbids it and ``tests/test_architecture.py`` Contract 5 fails the build on
a violation.

Envelope → canonical batch mapping (PRD § "Envelope → canonical batch mapping
(amended 2026-08-02)"):

  * ``tags[].tag_path`` / ``value`` / ``quality``           → ``build_tag_entry``
  * ``tags[].observed_at``                                   → ``ts``
  * ``machine_state``, ``active_conditions``, ``snapshot_id``,
    ``captured_at``, ``schema_version``, ``provenance``,
    ``asset.proposed_uns_path``, ``asset.source_record_id``  → per-tag
    ``metadata.factorylm_snapshot``. ``machine_state`` and ``active_conditions``
    are REQUIRED to build a ``LiveStateOverlay``; losing them silently would
    produce a permanently "unknown state" overlay while every tag looked healthy.
  * ``asset.source_record_id`` stays in metadata — this module has no
    equipment-entity resolver, and guessing an ``equipment_entity_id`` from a
    foreign record id would be inventing plant identity.
  * ``tenant_id``                                            → **never** read
    from the envelope. On the HMAC path ``X-MIRA-Tenant`` is authoritative; the
    bench/legacy-bearer path takes it as an explicit keyword from the caller.

``source_system`` must be ``plc_bridge`` — ``VALID_SOURCE_SYSTEMS`` rejects
``factorylm-plc-modbus``, so the FactoryLM identity rides ``provenance.producer``
instead (PRD amendment). ``simulated`` is derived by ``ingest_batch`` from
``source_system`` alone, once per batch, so a ``plc_bridge`` snapshot is real
telemetry and can never be clobbered by a simulated cache row.

**Read-only.** A snapshot is observation data. No command, actuator, or control
field is honored, no fieldbus client is imported, and nothing here writes to a
plant. UNS identity comes from the ``approved_tags`` row ``ingest_batch``
resolves, never from the envelope's ``proposed_uns_path`` (provenance only).

Seed prerequisite: ``tools/seeds/approved_tags_factorylm_conv_simple.sql``. The
allowlist is fail-closed with no permissive mode — without the seed a valid
snapshot is accepted with ``accepted=0`` and every tag ``not_allowlisted``.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from ingest_contract import build_ingest_batch, build_tag_entry

logger = logging.getLogger("mira-relay.factorylm_snapshot")

FACTORYLM_SNAPSHOT_SCHEMA = "factorylm.machine-snapshot.v1"

#: The one ``source_system`` a FactoryLM PLC snapshot may claim.
FACTORYLM_SOURCE_SYSTEM = "plc_bridge"


class SnapshotContractError(ValueError):
    """The envelope failed the transport-layer contract check (shape,
    ``schema_version``, ``snapshot_id``, ``captured_at``, ``tags``).

    Distinct from ``tag_ingest.IngestError``: this fires *before* the batch is
    built, so a malformed snapshot never reaches the pipeline at all.
    """


def _infer_value_type(value: Any) -> str:
    """Derive the ``value_type`` ``ingest_batch`` validates against.

    ``bool`` is checked before ``int`` because ``isinstance(True, int)`` is True
    in Python — the wrong order would type every boolean tag as an int and lose
    the ``live_signal_cache`` bool column.
    """
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    return "string"


def snapshot_to_ingest_batch(
    snapshot: dict[str, Any],
    *,
    tenant_id: Optional[str] = None,
    source_connection_id: Optional[str] = None,
) -> dict[str, Any]:
    """One ``factorylm.machine-snapshot.v1`` envelope → the canonical ingest batch.

    Pure, no I/O. Raises :class:`SnapshotContractError` when the envelope fails
    the minimal top-level contract; the caller decides what that means for its
    transport (the publisher logs and drops the batch — a bad snapshot must
    never take down live diagnosis).

    ``tenant_id`` is **not** read from the envelope. Pass it only on the
    bench/legacy-bearer path; omit it on the HMAC path so the signed body stays
    minimal and ``X-MIRA-Tenant`` remains authoritative (PRD § contract rules:
    "never default it, infer it, or accept it from an untrusted caller").
    """
    if not isinstance(snapshot, dict):
        raise SnapshotContractError("snapshot_not_an_object")
    if snapshot.get("schema_version") != FACTORYLM_SNAPSHOT_SCHEMA:
        raise SnapshotContractError(f"schema_version:{snapshot.get('schema_version')!r}")
    if not snapshot.get("snapshot_id"):
        raise SnapshotContractError("snapshot_id:missing")
    if not snapshot.get("captured_at"):
        raise SnapshotContractError("captured_at:missing")
    raw_tags = snapshot.get("tags")
    if not isinstance(raw_tags, list):
        raise SnapshotContractError("tags:not_a_list")

    asset = snapshot.get("asset") or {}
    snapshot_meta = {
        "schema_version": snapshot.get("schema_version"),
        "snapshot_id": snapshot.get("snapshot_id"),
        "captured_at": snapshot.get("captured_at"),
        "machine_state": snapshot.get("machine_state"),
        "active_conditions": snapshot.get("active_conditions") or [],
        "provenance": snapshot.get("provenance") or {},
        "proposed_uns_path": asset.get("proposed_uns_path"),
        "source_record_id": asset.get("source_record_id"),
    }

    entries: list[Any] = []
    for raw_tag in raw_tags:
        if not isinstance(raw_tag, dict):
            # Structurally malformed. Passed through UNCHANGED so ingest_batch's
            # own isinstance check rejects it as "malformed_entry" — an
            # observable rejection in the result, never a silent drop here.
            entries.append(raw_tag)
            continue
        entries.append(
            build_tag_entry(
                str(raw_tag.get("tag_path") or ""),
                raw_tag.get("value"),
                value_type=_infer_value_type(raw_tag.get("value")),
                quality=str(raw_tag.get("quality") or "good"),
                ts=raw_tag.get("observed_at"),
                metadata={"factorylm_snapshot": snapshot_meta},
            )
        )

    return build_ingest_batch(
        str(snapshot.get("source_system") or ""),
        entries,
        tenant_id=tenant_id,
        source_connection_id=source_connection_id,
    )


class FactoryLMSnapshotPublisher:
    """POST a FactoryLM machine snapshot to ``/api/v1/tags/ingest``.

    Mirrors ``simlab/publishers.py::RelayIngestPublisher`` — the established
    shape for a producer that reaches the canonical ingress:

    * **HMAC mode (production)** — pass ``hmac_key``. Headers come from
      ``auth.sign_hmac_headers`` (the same signed-string definition
      ``verify_hmac`` checks against), and ``X-MIRA-Tenant`` is authoritative,
      so a body ``tenant_id`` can never override it. The body is serialized
      ONCE and posted via ``content=`` because HMAC signs the exact bytes.
    * **Bearer mode (bench fallback)** — pass ``api_key`` and no ``hmac_key``.
      The relay accepts this only under ``RELAY_LEGACY_BEARER=1`` and reads the
      tenant from the body.

    Credentials come from the caller (Doppler-managed env in deployment) — this
    class never reads a secret store, never logs a key, and never writes to a
    plant.
    """

    def __init__(
        self,
        relay_url: str,
        tenant_id: str,
        *,
        api_key: str = "",
        hmac_key: str = "",
        source_connection_id: Optional[str] = None,
    ) -> None:
        if not tenant_id:
            raise ValueError("FactoryLMSnapshotPublisher requires a tenant_id")
        self._relay_url = relay_url.rstrip("/")
        self._tenant_id = tenant_id
        self._api_key = api_key
        self._hmac_key = hmac_key
        self._source_connection_id = source_connection_id

    def publish(self, snapshot: dict[str, Any]) -> bool:
        """Deliver one snapshot. Returns True when the relay accepted the POST.

        Best-effort by design: a contract error, a transport error, or a relay
        rejection is logged and returns False. Publishing is an evidence feed —
        it must never raise into, or take down, a diagnosis path.
        """
        try:
            import httpx  # lazy — not needed for the pure decode path or tests

            payload = snapshot_to_ingest_batch(
                snapshot,
                # HMAC mode: omit the body tenant so the signed body stays
                # minimal and the header stays authoritative.
                tenant_id=None if self._hmac_key else self._tenant_id,
                source_connection_id=self._source_connection_id,
            )

            # Serialize once and post the exact bytes we signed — letting httpx
            # re-encode via json= would invalidate the HMAC body hash.
            body_bytes = json.dumps(payload, separators=(",", ":")).encode()
            headers = {"Content-Type": "application/json"}
            if self._hmac_key:
                from auth import sign_hmac_headers

                headers.update(sign_hmac_headers(self._tenant_id, body_bytes, self._hmac_key))
            elif self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"

            resp = httpx.post(
                f"{self._relay_url}/api/v1/tags/ingest",
                content=body_bytes,
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            logger.debug(
                "FactoryLMSnapshotPublisher: posted snapshot %s (%d tags)",
                snapshot.get("snapshot_id") if isinstance(snapshot, dict) else "?",
                len(payload["tags"]),
            )
            return True
        except SnapshotContractError as exc:
            logger.warning("FactoryLMSnapshotPublisher: invalid snapshot: %s", exc)
            return False
        except Exception as exc:  # noqa: BLE001 — an evidence feed never raises out
            logger.warning("FactoryLMSnapshotPublisher.publish failed: %s", exc)
            return False
