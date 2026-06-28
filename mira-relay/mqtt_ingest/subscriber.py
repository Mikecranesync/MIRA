"""Sparkplug subscriber — decode → buffer → ``ingest_batch`` (the one pipeline).

Two layers, deliberately split so the logic is testable without a broker:

* :class:`Consumer` — pure, synchronous message handling. ``feed()`` decodes a
  message and buffers canonical entries; ``flush()`` emits ONE ``ingest_batch``
  call (the same pipeline the HTTP relay route uses). Death → mark stale;
  rejected-unknown → record as *seen* (enabled=false) when auto-discover is on.
  No MQTT, no asyncio — tests drive it directly.
* :func:`run_subscriber` — the aiomqtt connect/subscribe/reconnect loop that
  feeds :class:`Consumer`. ``aiomqtt`` is imported lazily so unit tests don't
  need the broker client.

Lane 3 thesis: this module calls ``ingest_batch`` + ``build_ingest_batch`` only.
It contains NO allowlist check, NO normalizer, NO direct ``tag_events`` write,
and NO publish path (read-only — .claude/rules/fieldbus-readonly.md).
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional, Protocol

from ingest_contract import build_ingest_batch
from tag_ingest import IngestError, IngestResult, ingest_batch

from .codecs import sparkplug_b as spb
from .config import SparkplugConfig
from .decode import SparkplugDecoder

logger = logging.getLogger("mira-relay.mqtt_ingest.subscriber")


class LifecycleStore(Protocol):
    """The Sparkplug-specific store surface, ON TOP of the ingest ``TagStore``
    Protocol (load_allowlist / current_state_simulated / persist_batch).

    Both are optional at runtime — the consumer no-ops (with a log) if a store
    doesn't implement them, so an ingest-only store still works."""

    def mark_tags_stale(self, tenant_id: str, tag_paths: list[str]) -> int: ...

    def record_seen_tags(self, tenant_id: str, source_system: str, tag_paths: list[str]) -> int: ...


IngestFn = Callable[[dict, str, object], IngestResult]


class Consumer:
    """Stateful, broker-free Sparkplug message handler."""

    def __init__(
        self,
        config: SparkplugConfig,
        store: object,
        *,
        ingest_fn: IngestFn = ingest_batch,
        now_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.store = store
        self._ingest = ingest_fn
        self._now = now_fn
        self._decoder = SparkplugDecoder()
        self._buffer: list[dict] = []
        self._last_flush = now_fn()
        # observability counters
        self.stats = {
            "messages": 0,
            "ignored": 0,
            "dropped_metrics": 0,
            "entries_buffered": 0,
            "accepted": 0,
            "rejected": 0,
            "flushes": 0,
            "stale_marked": 0,
            "seen_recorded": 0,
        }

    # ── ingest one message ───────────────────────────────────────────────────
    def feed(self, topic_str: str, payload_bytes: bytes) -> None:
        """Decode + buffer one MQTT message. Best-effort: a bad message is
        logged and dropped, never raised (the loop must survive it)."""
        self.stats["messages"] += 1

        topic = spb.parse_topic(topic_str)
        if topic is not None and not self.config.passes_filter(
            topic.group_id, topic.edge_node_id, topic.device_id
        ):
            self.stats["ignored"] += 1
            return

        try:
            result = self._decoder.handle(topic_str, payload_bytes)
        except Exception:  # noqa: BLE001 — one bad message must not kill the loop
            logger.exception("sparkplug feed failed for topic %s", topic_str)
            self.stats["ignored"] += 1
            return

        if result.ignored_reason:
            self.stats["ignored"] += 1
            return

        self.stats["dropped_metrics"] += result.dropped

        # DEATH → mark those tags stale immediately (lifecycle, not a value write).
        if result.offline_tag_paths:
            self._mark_stale(result.offline_tag_paths)

        if result.entries:
            self._buffer.extend(result.entries)
            self.stats["entries_buffered"] += len(result.entries)

    # ── flush the buffer through the ONE pipeline ────────────────────────────
    def should_flush(self) -> bool:
        if not self._buffer:
            return False
        if len(self._buffer) >= self.config.flush_size:
            return True
        return (self._now() - self._last_flush) >= self.config.flush_interval_s

    def flush(self) -> Optional[IngestResult]:
        """Emit ONE ``ingest_batch`` call for the buffered entries. Returns the
        result, or None when nothing was written (empty buffer / dry-run)."""
        if not self._buffer:
            return None
        entries = self._buffer
        self._buffer = []
        self._last_flush = self._now()
        self.stats["flushes"] += 1

        batch = build_ingest_batch(
            self.config.source_system,
            entries,
            source_connection_id=self.config.source_connection_id or None,
        )

        if self.config.dry_run or not self.config.write_to_db:
            logger.info(
                "sparkplug dry-run: would ingest %d entries (tenant=%s source=%s)",
                len(entries),
                self.config.tenant_id,
                self.config.source_system,
            )
            return None

        try:
            result = self._ingest(batch, self.config.tenant_id, self.store)
        except IngestError as exc:
            logger.warning("sparkplug batch rejected: %s", exc)
            return None
        except Exception:  # noqa: BLE001 — DB error fails this flush, loop survives
            logger.exception("sparkplug ingest_batch failed")
            return None

        self.stats["accepted"] += result.accepted
        self.stats["rejected"] += len(result.rejected)
        logger.info(
            "sparkplug flush: accepted=%d events=%d rejected=%d cache_skipped=%d",
            result.accepted,
            result.events_written,
            len(result.rejected),
            result.cache_skipped,
        )

        # Discovery: unknown (not_allowlisted) tags become seen/proposed —
        # recorded as approved_tags(enabled=false) so a human can promote them.
        # They are NOT historized (fail-closed kept them out of tag_events).
        if self.config.auto_discover and result.rejected:
            unknown = [r.tag_path for r in result.rejected if r.reason == "not_allowlisted"]
            if unknown:
                self._record_seen(unknown)
        return result

    # ── lifecycle store calls (optional surface; no-op + log if absent) ───────
    def _mark_stale(self, tag_paths: list[str]) -> None:
        fn = getattr(self.store, "mark_tags_stale", None)
        if fn is None:
            logger.debug("store has no mark_tags_stale; skipping stale for %d tags", len(tag_paths))
            return
        try:
            n = fn(self.config.tenant_id, tag_paths)
            self.stats["stale_marked"] += int(n or 0)
        except Exception:  # noqa: BLE001
            logger.exception("mark_tags_stale failed")

    def _record_seen(self, tag_paths: list[str]) -> None:
        fn = getattr(self.store, "record_seen_tags", None)
        if fn is None:
            logger.debug("store has no record_seen_tags; skipping discovery")
            return
        try:
            n = fn(self.config.tenant_id, self.config.source_system, tag_paths)
            self.stats["seen_recorded"] += int(n or 0)
        except Exception:  # noqa: BLE001
            logger.exception("record_seen_tags failed")


# ── aiomqtt run loop (lazy import; not needed for unit tests) ─────────────────
async def run_subscriber(config: SparkplugConfig, store: object) -> None:
    """Connect to the broker and feed messages to a :class:`Consumer` until
    cancelled. Reconnects with capped exponential backoff. READ-ONLY: subscribes
    only, never publishes."""
    import asyncio

    import aiomqtt  # lazy: keeps unit tests free of the broker client

    consumer = Consumer(config, store)
    backoff = config.reconnect_min_s
    logger.info("sparkplug subscriber starting: %s", config.redacted())

    while True:
        try:
            tls_params = aiomqtt.TLSParameters() if config.tls else None
            async with aiomqtt.Client(
                hostname=config.broker_host,
                port=config.broker_port,
                username=config.username or None,
                password=config.password or None,
                identifier=config.client_id,
                clean_session=config.clean_session,
                tls_params=tls_params,
            ) as client:
                backoff = config.reconnect_min_s  # connected → reset backoff
                for topic_filter in config.topic_filters:
                    await client.subscribe(topic_filter)
                logger.info("subscribed: %s", config.topic_filters)

                async def _periodic_flush() -> None:
                    while True:
                        await asyncio.sleep(config.flush_interval_s)
                        if consumer.should_flush():
                            consumer.flush()

                flush_task = asyncio.create_task(_periodic_flush())
                try:
                    async for message in client.messages:
                        payload = message.payload
                        if isinstance(payload, (bytes, bytearray)):
                            consumer.feed(str(message.topic), bytes(payload))
                        if consumer.should_flush():
                            consumer.flush()
                finally:
                    flush_task.cancel()
                    consumer.flush()  # drain on disconnect
        except asyncio.CancelledError:
            consumer.flush()
            logger.info("sparkplug subscriber cancelled; final stats=%s", consumer.stats)
            raise
        except Exception as exc:  # noqa: BLE001 — reconnect on any broker error
            logger.warning("broker connection lost (%s); reconnecting in %.1fs", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, config.reconnect_max_s)
