from __future__ import annotations

import logging
import time

from pymodbus.client import AsyncModbusTcpClient

from .base import DriverProtocol, TagDescriptor, TagValue

logger = logging.getLogger("mira-connect.modbus")


class ModbusDriver(DriverProtocol):
    def __init__(self):
        self._client: AsyncModbusTcpClient | None = None
        self._connected = False
        self._tag_map: dict[str, dict] = {}
        self._host = ""
        self._port = 502

    async def connect(self, host: str, port: int = 502) -> bool:
        self._host = host
        self._port = port
        self._client = AsyncModbusTcpClient(host, port=port, timeout=5)
        connected = await self._client.connect()
        self._connected = connected and self._client.connected
        if self._connected:
            logger.info("Modbus TCP connected to %s:%d", host, port)
        else:
            logger.warning("Modbus TCP failed to connect to %s:%d", host, port)
        return self._connected

    def load_tag_map(self, tags: dict[str, dict]) -> None:
        self._tag_map = tags

    async def discover_tags(self) -> list[TagDescriptor]:
        return [
            TagDescriptor(
                name=name,
                address=str(info["address"]),
                scale=info.get("scale", 1.0),
                unit=info.get("unit", ""),
                sm_field=info.get("sm_field", name),
            )
            for name, info in self._tag_map.items()
        ]

    async def read_tags(self, tags: list[str]) -> dict[str, TagValue]:
        if not self._connected or not self._client:
            return {}
        now = time.time()
        result: dict[str, TagValue] = {}
        for tag_name in tags:
            info = self._tag_map.get(tag_name)
            if not info:
                continue
            try:
                resp = await self._client.read_holding_registers(
                    address=info["address"], count=1, slave=1
                )
                if resp.isError():
                    result[tag_name] = TagValue(value=0, quality="bad", timestamp=now)
                else:
                    raw = resp.registers[0]
                    scaled = raw * info.get("scale", 1.0)
                    result[tag_name] = TagValue(
                        value=round(scaled, 2), quality="good", timestamp=now
                    )
            except Exception as e:
                logger.warning("Read failed for %s: %s", tag_name, e)
                result[tag_name] = TagValue(value=0, quality="error", timestamp=now)
        return result

    async def disconnect(self) -> None:
        if self._client:
            self._client.close()
        self._connected = False
        logger.info("Modbus TCP disconnected from %s:%d", self._host, self._port)
