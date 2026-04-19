from __future__ import annotations

import abc
from dataclasses import dataclass, field


@dataclass
class TagValue:
    value: float | int | bool | str
    quality: str = "good"
    timestamp: float = 0.0


@dataclass
class TagDescriptor:
    name: str
    address: str
    data_type: str = "float"
    unit: str = ""
    scale: float = 1.0
    sm_field: str = ""


@dataclass
class DeviceInfo:
    host: str
    port: int
    protocol: str
    manufacturer: str = ""
    model: str = ""
    tags: list[TagDescriptor] = field(default_factory=list)


class DriverProtocol(abc.ABC):
    @abc.abstractmethod
    async def connect(self, host: str, port: int) -> bool: ...

    @abc.abstractmethod
    async def discover_tags(self) -> list[TagDescriptor]: ...

    @abc.abstractmethod
    async def read_tags(self, tags: list[str]) -> dict[str, TagValue]: ...

    @abc.abstractmethod
    async def disconnect(self) -> None: ...
