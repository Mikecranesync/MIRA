"""Connector factory registry tests."""

from __future__ import annotations

from mira_connectors.base import ConnectorConfig
from mira_connectors.factory import available_providers, create_connector
from mira_connectors.mocks import IgnitionMockConnector, MaximoMockConnector


def test_available_providers():
    providers = available_providers()
    assert "maximo_mock" in providers
    assert "ignition_mock" in providers


def test_create_known(ro_config: ConnectorConfig):
    assert isinstance(create_connector("maximo_mock", ro_config), MaximoMockConnector)
    assert isinstance(create_connector("ignition_mock", ro_config), IgnitionMockConnector)


def test_create_case_insensitive(ro_config: ConnectorConfig):
    assert isinstance(create_connector("  Maximo_Mock ", ro_config), MaximoMockConnector)


def test_create_unknown_returns_none(ro_config: ConnectorConfig):
    assert create_connector("sap_pm", ro_config) is None
