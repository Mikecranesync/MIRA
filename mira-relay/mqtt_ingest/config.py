"""Subscriber configuration — all knobs from env (no secrets in code).

One subscriber instance ↔ one ``(tenant, broker)``. The **tenant is config**,
never derived from the topic (Lane 3 design §1 / §6). Secrets (broker password)
are read from env at startup and never logged.

Env vars (prefix ``MQTT_INGEST_``):

  Broker / transport
    MQTT_INGEST_BROKER_HOST          broker hostname (default "mosquitto")
    MQTT_INGEST_BROKER_PORT          broker port (default 1883; 8883 for TLS)
    MQTT_INGEST_TLS                  "1"/"true" → enable TLS
    MQTT_INGEST_USERNAME             broker username (optional)
    MQTT_INGEST_PASSWORD             broker password (optional; never logged)
    MQTT_INGEST_CLIENT_ID            MQTT client id (default "mira-sparkplug-consumer")
    MQTT_INGEST_CLEAN_SESSION        "1"/"true" → clean session (default true)
    MQTT_INGEST_RECONNECT_MIN_S      reconnect backoff floor seconds (default 1)
    MQTT_INGEST_RECONNECT_MAX_S      reconnect backoff ceiling seconds (default 30)

  Sparkplug filters (topic scoping)
    MQTT_INGEST_GROUP_IDS            comma list of Sparkplug group_ids ("" = all)
    MQTT_INGEST_EDGE_NODES           comma list of edge_node_ids ("" = all)
    MQTT_INGEST_DEVICES              comma list of device_ids ("" = all)

  Identity / tenancy
    MQTT_INGEST_TENANT_ID            REQUIRED — the tenant all tags land under
    MQTT_INGEST_SOURCE_SYSTEM        ingest source_system (default "ignition")
    MQTT_INGEST_SOURCE_CONNECTION_ID broker/edge id stamped on the batch (optional)

  Batching / behaviour flags
    MQTT_INGEST_FLUSH_SIZE           flush after N buffered entries (default 200)
    MQTT_INGEST_FLUSH_INTERVAL_S     flush after this many seconds (default 0.25)
    MQTT_INGEST_DRY_RUN              "1" → decode + log, never write
    MQTT_INGEST_WRITE_TO_DB          "0" → skip persistence (alias of dry-run)
    MQTT_INGEST_LIVE_CACHE_ONLY      reserved; currently same path as full ingest
    MQTT_INGEST_AUTO_DISCOVER        "1" → record unknown tags as seen (enabled=false)
    MQTT_INGEST_DEBUG                "1" → debug logging
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _b(env: str, default: bool) -> bool:
    raw = os.getenv(env)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _csv(env: str) -> tuple[str, ...]:
    raw = os.getenv(env, "")
    return tuple(p.strip() for p in raw.split(",") if p.strip())


class ConfigError(ValueError):
    """Raised when required config (e.g. tenant) is missing."""


@dataclass
class SparkplugConfig:
    tenant_id: str
    broker_host: str = "mosquitto"
    broker_port: int = 1883
    tls: bool = False
    username: str = ""
    password: str = ""  # never logged (see redacted())
    client_id: str = "mira-sparkplug-consumer"
    clean_session: bool = True
    reconnect_min_s: float = 1.0
    reconnect_max_s: float = 30.0

    group_ids: tuple[str, ...] = field(default_factory=tuple)
    edge_nodes: tuple[str, ...] = field(default_factory=tuple)
    devices: tuple[str, ...] = field(default_factory=tuple)

    source_system: str = "ignition"
    source_connection_id: str = ""

    flush_size: int = 200
    flush_interval_s: float = 0.25
    dry_run: bool = False
    write_to_db: bool = True
    live_cache_only: bool = False
    auto_discover: bool = False
    debug: bool = False

    @classmethod
    def from_env(cls) -> "SparkplugConfig":
        tenant_id = os.getenv("MQTT_INGEST_TENANT_ID", "").strip()
        if not tenant_id:
            raise ConfigError(
                "MQTT_INGEST_TENANT_ID is required — a subscriber binds one tenant "
                "by config (never from the topic)."
            )
        return cls(
            tenant_id=tenant_id,
            broker_host=os.getenv("MQTT_INGEST_BROKER_HOST", "mosquitto"),
            broker_port=int(os.getenv("MQTT_INGEST_BROKER_PORT", "1883")),
            tls=_b("MQTT_INGEST_TLS", False),
            username=os.getenv("MQTT_INGEST_USERNAME", ""),
            password=os.getenv("MQTT_INGEST_PASSWORD", ""),
            client_id=os.getenv("MQTT_INGEST_CLIENT_ID", "mira-sparkplug-consumer"),
            clean_session=_b("MQTT_INGEST_CLEAN_SESSION", True),
            reconnect_min_s=float(os.getenv("MQTT_INGEST_RECONNECT_MIN_S", "1")),
            reconnect_max_s=float(os.getenv("MQTT_INGEST_RECONNECT_MAX_S", "30")),
            group_ids=_csv("MQTT_INGEST_GROUP_IDS"),
            edge_nodes=_csv("MQTT_INGEST_EDGE_NODES"),
            devices=_csv("MQTT_INGEST_DEVICES"),
            source_system=os.getenv("MQTT_INGEST_SOURCE_SYSTEM", "ignition"),
            source_connection_id=os.getenv("MQTT_INGEST_SOURCE_CONNECTION_ID", ""),
            flush_size=int(os.getenv("MQTT_INGEST_FLUSH_SIZE", "200")),
            flush_interval_s=float(os.getenv("MQTT_INGEST_FLUSH_INTERVAL_S", "0.25")),
            dry_run=_b("MQTT_INGEST_DRY_RUN", False),
            write_to_db=_b("MQTT_INGEST_WRITE_TO_DB", True),
            live_cache_only=_b("MQTT_INGEST_LIVE_CACHE_ONLY", False),
            auto_discover=_b("MQTT_INGEST_AUTO_DISCOVER", False),
            debug=_b("MQTT_INGEST_DEBUG", False),
        )

    @property
    def topic_filters(self) -> list[str]:
        """Sparkplug subscribe filters. One per group (scoped) or the whole
        namespace. NEVER subscribes to NCMD/DCMD (read-only)."""
        if self.group_ids:
            return [f"{_SPB}/{g}/#" for g in self.group_ids]
        return [f"{_SPB}/#"]

    def passes_filter(self, group_id: str, edge_node: str, device_id: str | None) -> bool:
        """Apply edge/device filters the broker subscription can't express."""
        if self.group_ids and group_id not in self.group_ids:
            return False
        if self.edge_nodes and edge_node not in self.edge_nodes:
            return False
        if self.devices and device_id is not None and device_id not in self.devices:
            return False
        return True

    def redacted(self) -> dict:
        """Config for logging — secrets removed."""
        return {
            "tenant_id": self.tenant_id,
            "broker": f"{self.broker_host}:{self.broker_port}",
            "tls": self.tls,
            "username_set": bool(self.username),
            "password_set": bool(self.password),
            "client_id": self.client_id,
            "group_ids": list(self.group_ids),
            "edge_nodes": list(self.edge_nodes),
            "devices": list(self.devices),
            "source_system": self.source_system,
            "flush_size": self.flush_size,
            "flush_interval_s": self.flush_interval_s,
            "dry_run": self.dry_run,
            "write_to_db": self.write_to_db,
            "auto_discover": self.auto_discover,
        }


_SPB = "spBv1.0"
