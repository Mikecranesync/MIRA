"""Make ``mira_connectors`` importable when pytest runs from anywhere."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_PKG_ROOT = Path(__file__).resolve().parent.parent  # mira-connectors/
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from mira_connectors.base import ConnectorConfig, ConnectorMode  # noqa: E402
from mira_connectors.mocks import (  # noqa: E402
    IgnitionMockConnector,
    MaintainXMockConnector,
    MaximoMockConnector,
    PIMockConnector,
    SAPMockConnector,
)


@pytest.fixture
def tenant_id() -> str:
    return "00000000-0000-0000-0000-0000000000aa"


@pytest.fixture
def ro_config(tenant_id: str) -> ConnectorConfig:
    return ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_ONLY)


@pytest.fixture
def rw_config(tenant_id: str) -> ConnectorConfig:
    return ConnectorConfig(tenant_id=tenant_id, mode=ConnectorMode.READ_WRITE)


@pytest.fixture
def maximo(ro_config: ConnectorConfig) -> MaximoMockConnector:
    return MaximoMockConnector(ro_config)


@pytest.fixture
def ignition(ro_config: ConnectorConfig) -> IgnitionMockConnector:
    return IgnitionMockConnector(ro_config)


@pytest.fixture
def sap(ro_config: ConnectorConfig) -> SAPMockConnector:
    return SAPMockConnector(ro_config)


@pytest.fixture
def maintainx(ro_config: ConnectorConfig) -> MaintainXMockConnector:
    return MaintainXMockConnector(ro_config)


@pytest.fixture
def pi(ro_config: ConnectorConfig) -> PIMockConnector:
    return PIMockConnector(ro_config)
