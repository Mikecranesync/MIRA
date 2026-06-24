"""Publisher abstraction for SimLab readings.

Publishers follow a simple Protocol — they receive a list of ``Reading`` objects
and deliver them somewhere.  Heavy publishers (MQTT, relay-ingest) are only
instantiated when their deps are available; the sim core and tests always use
``InMemoryPublisher`` / ``FakePublisher``.

MQTT envelope mirrors ``mira-fault-sim/sim.py`` ``_stamp``:
    {"value": <value>, "ts": <float epoch>, "source": "simulator"}
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional, Protocol, runtime_checkable

from simlab.models import Reading

logger = logging.getLogger("simlab.publishers")


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class Publisher(Protocol):
    """Minimal publisher interface."""

    def publish(self, readings: list[Reading]) -> None:
        ...


# ---------------------------------------------------------------------------
# InMemoryPublisher (test default)
# ---------------------------------------------------------------------------


class InMemoryPublisher:
    """Records all published batches in memory.  No external deps.

    Attributes
    ----------
    batches:
        All batches ever published (each a list of ``Reading``).
    last:
        The most recently published batch, or ``None`` if nothing published yet.
    """

    def __init__(self) -> None:
        self.batches: list[list[Reading]] = []

    @property
    def last(self) -> Optional[list[Reading]]:
        return self.batches[-1] if self.batches else None

    def publish(self, readings: list[Reading]) -> None:  # noqa: D102
        self.batches.append(list(readings))
        logger.debug("InMemoryPublisher: captured %d readings", len(readings))

    def clear(self) -> None:
        """Reset recorded batches."""
        self.batches.clear()


# ---------------------------------------------------------------------------
# FakePublisher (alias used in tests / docs examples)
# ---------------------------------------------------------------------------


class FakePublisher(InMemoryPublisher):
    """Alias for ``InMemoryPublisher`` — name used in test fixtures."""


# ---------------------------------------------------------------------------
# RestSnapshotPublisher
# ---------------------------------------------------------------------------


class RestSnapshotPublisher:
    """Maintains the latest reading per UNS path for ``GET /snapshot``.

    This is a pull-model publisher: it stores the last value for each
    ``uns_path`` so HTTP clients can poll.
    """

    def __init__(self) -> None:
        self._snapshot: dict[str, Reading] = {}

    def publish(self, readings: list[Reading]) -> None:  # noqa: D102
        for r in readings:
            self._snapshot[r.uns_path] = r

    def get_snapshot(self, asset_id: Optional[str] = None) -> dict[str, Any]:
        """Return ``{uns_path: value}`` for all tags (or filtered by asset)."""
        return {
            path: reading.value
            for path, reading in self._snapshot.items()
            if asset_id is None or reading.asset_id == asset_id
        }

    def get_full(self) -> dict[str, Reading]:
        """Return the full snapshot dict (path → Reading)."""
        return dict(self._snapshot)


# ---------------------------------------------------------------------------
# MqttPublisher (lazy aiomqtt)
# ---------------------------------------------------------------------------


def _mqtt_stamp(value: Any, ts_float: float) -> str:
    """Build the MQTT payload envelope (mirrors mira-fault-sim/sim.py _stamp)."""
    return json.dumps(
        {"value": value, "ts": ts_float, "source": "simulator"},
        separators=(",", ":"),
    )


def _reading_epoch(ts_iso: str) -> float:
    """Convert a ``Reading.ts`` ISO-8601 stamp to epoch seconds for the MQTT envelope.

    ``Reading.ts`` is an ISO-8601 string (``2025-01-01T00:00:05Z``), not a float — so the envelope's
    numeric ``ts`` must be derived per reading. Best-effort: an unparseable stamp falls back to 0.0
    rather than breaking the publish.
    """
    if not ts_iso:
        return 0.0
    try:
        from datetime import datetime

        return datetime.fromisoformat(ts_iso.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return 0.0


class MqttPublisher:
    """Async MQTT publisher (lazy-imports ``aiomqtt``).

    Sync-compatible: ``publish()`` may be called from plain sync code OR from inside a running event
    loop. Inside a loop it fire-and-forgets a task whose reference is RETAINED (asyncio only keeps
    weak references to tasks, so an unreferenced task can be garbage-collected before it runs).

    Parameters
    ----------
    host:
        MQTT broker hostname.
    port:
        MQTT broker port (default 1883).
    """

    def __init__(self, host: str = "localhost", port: int = 1883) -> None:
        self._host = host
        self._port = port
        self._client: Any = None  # aiomqtt.Client, lazily created
        self._pending: set = set()  # strong refs to in-flight publish tasks (so they aren't GC'd)

    def _get_topic(self, reading: Reading) -> str:
        from simlab.uns import to_mqtt_topic

        return to_mqtt_topic(reading.uns_path)

    def publish(self, readings: list[Reading]) -> None:
        """Publish a batch (best-effort; broker errors are logged, not raised).

        Works both inside and outside a running event loop. ``asyncio.get_event_loop()`` is avoided —
        it is deprecated in 3.12 and raises when there is no current loop.
        """
        import asyncio

        batch = list(readings)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None:
            task = loop.create_task(self._async_publish(batch))
            self._pending.add(task)
            task.add_done_callback(self._pending.discard)
        else:
            try:
                asyncio.run(self._async_publish(batch))
            except Exception as exc:
                logger.warning("MqttPublisher.publish failed: %s", exc)

    async def _async_publish(self, readings: list[Reading]) -> None:
        try:
            import aiomqtt  # lazy import — not required for core / tests
        except ImportError as exc:
            logger.warning("MqttPublisher: aiomqtt not installed: %s", exc)
            return
        try:
            async with aiomqtt.Client(self._host, self._port) as client:
                for r in readings:
                    topic = self._get_topic(r)
                    payload = _mqtt_stamp(r.value, _reading_epoch(r.ts))
                    await client.publish(topic, payload=payload, retain=True)
        except Exception as exc:
            logger.warning("MqttPublisher._async_publish error: %s", exc)

# ---------------------------------------------------------------------------
# RelayIngestPublisher (lazy httpx)
# ---------------------------------------------------------------------------


_BUILD_INGEST_BATCH: Any = None


def _build_ingest_batch(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """Lazily load + cache the canonical ``build_ingest_batch`` from
    ``mira-relay/ingest_contract.py`` (loaded by file path — SimLab is a
    repo-root bench tool, so the relay's contract file is on disk at runtime;
    loading by path avoids polluting ``sys.path``).

    This is what makes the SimLab relay publisher build the SAME batch shape as
    the future MQTT/Sparkplug subscribers and the engine bridge — one contract,
    every transport. See ``mira-relay/ingest_contract.py`` and the Lane 3 design
    review (``docs/design/2026-06-23-lane3-mqtt-subscriber-design.md`` §7).
    """
    global _BUILD_INGEST_BATCH
    if _BUILD_INGEST_BATCH is None:
        import importlib.util
        from pathlib import Path

        path = Path(__file__).resolve().parents[1] / "mira-relay" / "ingest_contract.py"
        spec = importlib.util.spec_from_file_location("mira_relay_ingest_contract", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        _BUILD_INGEST_BATCH = mod.build_ingest_batch
    return _BUILD_INGEST_BATCH(*args, **kwargs)


class RelayIngestPublisher:
    """POST reading batches to mira-relay ``/api/v1/tags/ingest``.

    Lazy-imports ``httpx``. Not used in tests against a real relay (no NeonDB /
    relay in CI) — the unit tests inject a fake ``httpx``. Sets
    ``source_system="simulator"`` on every tag entry.

    Auth (matches ``mira-relay/auth.py`` + ``relay_server._authenticate_http``):

    * **HMAC mode (durable, production-shaped)** — pass ``hmac_key``. Every
      request is signed with the four ``X-MIRA-*`` headers over the exact body
      bytes, and the relay treats the ``X-MIRA-Tenant`` header as authoritative
      (a caller-supplied body ``tenant_id`` can never override it). This is the
      shape a real Ignition/Sparkplug feed uses.
    * **Bearer mode (bench fallback)** — pass ``api_key`` and no ``hmac_key``.
      The relay accepts this only under ``RELAY_LEGACY_BEARER=1``; the tenant is
      carried in the request body (``relay_server`` falls back to
      ``payload["tenant_id"]`` when no HMAC header is present).

    ``tenant_id`` is required in both modes — the relay rejects a batch with no
    resolvable tenant (``tenant_required``).
    """

    def __init__(
        self,
        relay_url: str,
        tenant_id: str,
        *,
        api_key: str = "",
        hmac_key: str = "",
    ) -> None:
        if not tenant_id:
            raise ValueError("RelayIngestPublisher requires a tenant_id")
        self._relay_url = relay_url.rstrip("/")
        self._tenant_id = tenant_id
        self._api_key = api_key
        self._hmac_key = hmac_key

    def _hmac_headers(self, body_bytes: bytes) -> dict[str, str]:
        """Build the four ``X-MIRA-*`` HMAC headers for ``body_bytes``.

        Mirrors the signed-string contract in ``mira-relay/auth.py``:
        ``f"{tenant}\\n{nonce}\\n{timestamp}\\n{sha256_hex(body_bytes)}"``.
        """
        import hashlib
        import hmac as _hmac
        import time
        import uuid

        nonce = uuid.uuid4().hex
        timestamp = str(int(time.time()))
        body_hash = hashlib.sha256(body_bytes).hexdigest()
        signed = f"{self._tenant_id}\n{nonce}\n{timestamp}\n{body_hash}"
        signature = _hmac.new(
            self._hmac_key.encode(), signed.encode(), hashlib.sha256
        ).hexdigest()
        return {
            "X-MIRA-Tenant": self._tenant_id,
            "X-MIRA-Nonce": nonce,
            "X-MIRA-Timestamp": timestamp,
            "X-MIRA-Signature": signature,
        }

    def publish(self, readings: list[Reading]) -> None:  # noqa: D102
        try:
            import httpx  # lazy

            tags = [r.to_ingest_tag() for r in readings]
            # Build the batch via the canonical contract so SimLab and the future
            # MQTT/Sparkplug subscribers emit the identical shape. Bench/legacy
            # bearer carries the tenant in the body (the relay falls back to
            # payload["tenant_id"] when no HMAC header is sent); in HMAC mode the
            # X-MIRA-Tenant header is authoritative, so tenant_id is omitted.
            payload = _build_ingest_batch(
                "simulator",
                tags,
                tenant_id=None if self._hmac_key else self._tenant_id,
            )

            # Sign/hash the EXACT bytes we send: serialize once and post via
            # ``content=`` so httpx does not re-encode the body (which would
            # break the HMAC body-hash).
            body_bytes = json.dumps(payload, separators=(",", ":")).encode()
            headers = {"Content-Type": "application/json"}
            if self._hmac_key:
                headers.update(self._hmac_headers(body_bytes))
            elif self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"

            resp = httpx.post(
                f"{self._relay_url}/api/v1/tags/ingest",
                content=body_bytes,
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            logger.debug("RelayIngestPublisher: posted %d tags", len(tags))
        except Exception as exc:
            logger.warning("RelayIngestPublisher.publish failed: %s", exc)
