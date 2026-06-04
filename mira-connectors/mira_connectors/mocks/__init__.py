"""Fixture-backed mock connectors (capability #9: mock mode).

These read realistic JSON fixtures instead of hitting a network. They make Phases
downstream of the connector framework testable without a live Maximo/Ignition, and
serve as the reference implementation of each connector type.
"""

from mira_connectors.mocks.ignition_mock import IgnitionMockConnector
from mira_connectors.mocks.maintainx_mock import MaintainXMockConnector
from mira_connectors.mocks.maximo_mock import MaximoMockConnector
from mira_connectors.mocks.pi_mock import PIMockConnector
from mira_connectors.mocks.sap_mock import SAPMockConnector

__all__ = [
    "IgnitionMockConnector",
    "MaintainXMockConnector",
    "MaximoMockConnector",
    "PIMockConnector",
    "SAPMockConnector",
]
