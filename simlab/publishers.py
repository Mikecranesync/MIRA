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


class MqttPublisher:
    """Async MQTT publisher (lazy-imports ``aiomqtt``).

    Must be used inside an async context.  Publish is sync-compatible via
    fire-and-forget queuing.

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

    def _get_topic(self, reading: Reading) -> str:
        from simlab.uns import to_mqtt_topic

        return to_mqtt_topic(reading.uns_path)

    def publish(self, readings: list[Reading]) -> None:
        """Synchronously queue publish (best-effort; ignores broker errors in tests)."""
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self._async_publish(readings))
            else:
                loop.run_until_complete(self._async_publish(readings))
        except Exception as exc:
            logger.warning("MqttPublisher.publish failed: %s", exc)

    async def _async_publish(self, readings: list[Reading]) -> None:
        try:

            import aiomqtt  # lazy import — not required for core / tests

            async with aiomqtt.Client(self._host, self._port) as client:
                for r in readings:
                    topic = self._get_topic(r)
                    payload = _mqtt_stamp(r.value, float(BASE_EPOCH + 0))
                    await client.publish(topic, payload=payload, retain=True)
        except Exception as exc:
            logger.warning("MqttPublisher._async_publish error: %s", exc)


# We need BASE_EPOCH here for timestamp
from simlab.engine import BASE_EPOCH  # noqa: E402

# ---------------------------------------------------------------------------
# RelayIngestPublisher (lazy httpx)
# ---------------------------------------------------------------------------


class RelayIngestPublisher:
    """POST reading batches to mira-relay ``/api/v1/tags/ingest``.

    Lazy-imports ``httpx``.  Not used in tests (no NeonDB / relay in CI).
    Sets ``source_system="simulator"`` on every tag entry.
    """

    def __init__(self, relay_url: str, api_key: str = "") -> None:
        self._relay_url = relay_url.rstrip("/")
        self._api_key = api_key

    def publish(self, readings: list[Reading]) -> None:  # noqa: D102
        try:
            import httpx  # lazy

            tags = [r.to_ingest_tag() for r in readings]
            payload = {
                "source_system": "simulator",
                "tags": tags,
            }
            headers: dict[str, str] = {}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            resp = httpx.post(
                f"{self._relay_url}/api/v1/tags/ingest",
                json=payload,
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            logger.debug("RelayIngestPublisher: posted %d tags", len(tags))
        except Exception as exc:
            logger.warning("RelayIngestPublisher.publish failed: %s", exc)
