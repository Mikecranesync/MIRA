from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mira_connect.drivers.modbus_driver import ModbusDriver


async def test_connect_success():
    mock_client = MagicMock()
    mock_client.connect = AsyncMock(return_value=True)
    mock_client.connected = True

    with patch("mira_connect.drivers.modbus_driver.AsyncModbusTcpClient", return_value=mock_client):
        driver = ModbusDriver()
        result = await driver.connect("192.168.1.100", 502)
    assert result is True
    assert driver._connected is True


async def test_read_tags_returns_scaled_values():
    driver = ModbusDriver()
    driver._connected = True
    mock_response = MagicMock()
    mock_response.isError.return_value = False
    mock_response.registers = [421]

    mock_client = MagicMock()
    mock_client.read_holding_registers = AsyncMock(return_value=mock_response)
    driver._client = mock_client
    driver._tag_map = {
        "outputFrequency": {"address": 0x2103, "scale": 0.1},
    }
    result = await driver.read_tags(["outputFrequency"])
    assert result["outputFrequency"].value == pytest.approx(42.1, rel=0.01)


async def test_disconnect_closes_client():
    driver = ModbusDriver()
    driver._connected = True
    driver._client = MagicMock()
    await driver.disconnect()
    assert driver._connected is False
