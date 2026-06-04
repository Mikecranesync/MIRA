"""Connector factory — selects a connector by provider name.

Mirrors the existing ``mira-mcp/cmms/factory.py:create_cmms_adapter`` pattern
(provider string → concrete class, returns ``None`` when unconfigured) and extends it
across all connector kinds. Real connectors register here alongside the mocks.
"""

from __future__ import annotations

import logging
from typing import Callable

from mira_connectors.base import Connector, ConnectorConfig
from mira_connectors.mocks.ignition_mock import IgnitionMockConnector
from mira_connectors.mocks.maximo_mock import MaximoMockConnector

logger = logging.getLogger("mira-connectors")

# provider name → constructor. Add real connectors here as they land.
_REGISTRY: dict[str, Callable[[ConnectorConfig], Connector]] = {
    "maximo_mock": MaximoMockConnector,
    "ignition_mock": IgnitionMockConnector,
    # Real connectors (future):
    # "maximo": MaximoConnector,
    # "ignition": IgnitionConnector,
    # "pi": PIHistorianConnector,
    # "maintainx": MaintainXConnector,  # wraps mira-mcp/cmms/maintainx.py
}


def available_providers() -> list[str]:
    return sorted(_REGISTRY)


def create_connector(provider: str, config: ConnectorConfig) -> Connector | None:
    """Create a connector by provider name. Returns ``None`` if unknown/unconfigured."""
    key = (provider or "").lower().strip()
    ctor = _REGISTRY.get(key)
    if ctor is None:
        logger.error("Unknown connector provider: %s (have %s)", provider, available_providers())
        return None
    connector = ctor(config)
    if not connector.configured:
        logger.warning("Connector '%s' selected but not configured — disabled", provider)
        return None
    return connector
