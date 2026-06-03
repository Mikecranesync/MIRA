"""Connector *type* base classes.

Each fixes ``kind`` and adds domain shape. Plant-facing types (SCADA, Historian,
MQTT) refuse write-back by construction — MIRA does not write to the plant.
"""

from mira_connectors.types.cmms import CMMSConnector
from mira_connectors.types.document import DocumentConnector
from mira_connectors.types.historian import HistorianConnector
from mira_connectors.types.mqtt import MQTTConnector
from mira_connectors.types.scada import SCADAConnector

__all__ = [
    "CMMSConnector",
    "DocumentConnector",
    "HistorianConnector",
    "MQTTConnector",
    "SCADAConnector",
]
