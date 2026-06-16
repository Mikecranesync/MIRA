# MIRA Connect Phase 1: Modbus MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A technician downloads MIRA Connect on a plant PC, enters an activation code, and within minutes sees live VFD data in their Open WebUI chat — with MIRA ready to diagnose faults using real equipment context.

**Architecture:** Python edge agent (pymodbus) → outbound WebSocket → VPS relay → mira.db equipment_status → mira-pipeline renders rich cards in Open WebUI. Activation via short-code pairing. Store-and-forward for offline resilience.

**Tech Stack:** Python 3.12, pymodbus (BSD-3), websockets (BSD-3), httpx (BSD-3), SQLite WAL, YAML register maps. VPS relay in Python (uvicorn + websockets).

**Spec:** `docs/superpowers/specs/2026-04-17-mira-connect-design.md`

---

## File Map

```
NEW — mira-connect/
├── pyproject.toml                     # uv project, deps: pymodbus, websockets, httpx, pyyaml
├── mira_connect/__init__.py
├── mira_connect/main.py               # Entry point: activation → discovery → connect → stream
├── mira_connect/config.py             # Activation state, tenant_id, relay URL
├── mira_connect/drivers/
│   ├── __init__.py
│   ├── base.py                        # DriverProtocol ABC
│   └── modbus_driver.py              # pymodbus AsyncModbusTcpClient wrapper
├── mira_connect/discovery/
│   ├── __init__.py
│   └── modbus_scanner.py             # Scan local /24 subnet port 502
├── mira_connect/fingerprint/
│   ├── __init__.py
│   ├── identifier.py                  # Match register probes → YAML register map
│   └── register_maps/
│       └── gs20.yaml                  # AutomationDirect GS20 VFD
├── mira_connect/relay/
│   ├── __init__.py
│   ├── client.py                      # Outbound WSS to connect.factorylm.com
│   └── store_forward.py              # SQLite buffer for offline
└── tests/
    ├── conftest.py
    ├── test_modbus_driver.py
    ├── test_modbus_scanner.py
    ├── test_fingerprint.py
    ├── test_relay_client.py
    └── test_store_forward.py

NEW — mira-relay/
├── relay_server.py                    # WSS relay: receive from agents, write to mira.db
└── Dockerfile

MODIFY:
├── mira-web/src/server.ts             # Add POST /api/connect/activate
├── mira-web/src/lib/quota.ts          # Add plg_activation_codes table
├── mira-bots/shared/workers/plc_worker.py  # Replace stub with live tag reader
├── docker-compose.saas.yml            # Add mira-relay service
```

---

### Task 1: Driver Protocol + Modbus Driver

**Files:**
- Create: `mira-connect/pyproject.toml`
- Create: `mira-connect/mira_connect/__init__.py`
- Create: `mira-connect/mira_connect/drivers/__init__.py`
- Create: `mira-connect/mira_connect/drivers/base.py`
- Create: `mira-connect/mira_connect/drivers/modbus_driver.py`
- Test: `mira-connect/tests/test_modbus_driver.py`
- Test: `mira-connect/tests/conftest.py`

- [ ] **Step 1: Create project scaffold**

```toml
# mira-connect/pyproject.toml
[project]
name = "mira-connect"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "pymodbus>=3.7,<4",
    "websockets>=13,<14",
    "httpx>=0.28,<1",
    "pyyaml>=6,<7",
]

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio"]

[tool.pytest.ini_options]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W", "I"]
ignore = ["E501"]
```

```python
# mira-connect/mira_connect/__init__.py
```

```python
# mira-connect/mira_connect/drivers/__init__.py
```

Run: `cd mira-connect && uv sync`

- [ ] **Step 2: Write the DriverProtocol ABC**

```python
# mira-connect/mira_connect/drivers/base.py
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
```

- [ ] **Step 3: Write the failing Modbus driver test**

```python
# mira-connect/tests/conftest.py
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

```python
# mira-connect/tests/test_modbus_driver.py
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mira_connect.drivers.modbus_driver import ModbusDriver


async def test_connect_success():
    driver = ModbusDriver()
    with patch.object(driver, "_client", new_callable=AsyncMock) as mock_client:
        mock_client.connect = AsyncMock(return_value=True)
        mock_client.connected = True
        result = await driver.connect("192.168.1.100", 502)
    assert result is True


async def test_read_tags_returns_scaled_values():
    driver = ModbusDriver()
    driver._connected = True
    mock_response = MagicMock()
    mock_response.isError.return_value = False
    mock_response.registers = [421, 83, 582, 0]

    with patch.object(driver, "_client", new_callable=AsyncMock) as mock_client:
        mock_client.read_holding_registers = AsyncMock(return_value=mock_response)
        driver._tag_map = {
            "outputFrequency": {"address": 0x2103, "scale": 0.1},
            "motorCurrent": {"address": 0x2104, "scale": 0.1},
            "dcBusVoltage": {"address": 0x2105, "scale": 1.0},
            "faultCode": {"address": 0x210F, "scale": 1.0},
        }
        result = await driver.read_tags(["outputFrequency"])
    assert result["outputFrequency"].value == pytest.approx(42.1, rel=0.01)


async def test_disconnect_closes_client():
    driver = ModbusDriver()
    driver._connected = True
    with patch.object(driver, "_client", new_callable=AsyncMock) as mock_client:
        mock_client.close = AsyncMock()
        await driver.disconnect()
    assert driver._connected is False
```

Run: `cd mira-connect && uv run pytest tests/test_modbus_driver.py -v`
Expected: FAIL (ModbusDriver not defined)

- [ ] **Step 4: Implement ModbusDriver**

```python
# mira-connect/mira_connect/drivers/modbus_driver.py
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
                    result[tag_name] = TagValue(value=round(scaled, 2), quality="good", timestamp=now)
            except Exception as e:
                logger.warning("Read failed for %s: %s", tag_name, e)
                result[tag_name] = TagValue(value=0, quality="error", timestamp=now)
        return result

    async def disconnect(self) -> None:
        if self._client:
            self._client.close()
        self._connected = False
        logger.info("Modbus TCP disconnected from %s:%d", self._host, self._port)
```

- [ ] **Step 5: Run tests — verify pass**

Run: `cd mira-connect && uv run pytest tests/test_modbus_driver.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
cd mira-connect && git add -A && cd ..
git add mira-connect/
git commit -m "feat(mira-connect): driver protocol + Modbus TCP driver with tests"
```

---

### Task 2: Network Discovery Scanner

**Files:**
- Create: `mira-connect/mira_connect/discovery/__init__.py`
- Create: `mira-connect/mira_connect/discovery/modbus_scanner.py`
- Test: `mira-connect/tests/test_modbus_scanner.py`

- [ ] **Step 1: Write the failing scanner test**

```python
# mira-connect/tests/test_modbus_scanner.py
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from mira_connect.discovery.modbus_scanner import ModbusScanner


async def test_scan_finds_responding_host():
    scanner = ModbusScanner()
    with patch("mira_connect.discovery.modbus_scanner.asyncio.open_connection") as mock_conn:
        mock_reader = AsyncMock()
        mock_writer = AsyncMock()
        mock_writer.close = lambda: None
        mock_writer.wait_closed = AsyncMock()
        mock_conn.return_value = (mock_reader, mock_writer)
        results = await scanner.scan_subnet("192.168.1.0/24", port=502, timeout=0.1)
    assert len(results) > 0
    assert results[0]["host"].startswith("192.168.1.")
    assert results[0]["port"] == 502


async def test_scan_skips_non_responding_hosts():
    scanner = ModbusScanner()
    with patch(
        "mira_connect.discovery.modbus_scanner.asyncio.open_connection",
        side_effect=OSError("Connection refused"),
    ):
        results = await scanner.scan_subnet("192.168.1.0/30", port=502, timeout=0.1)
    assert len(results) == 0
```

Run: `cd mira-connect && uv run pytest tests/test_modbus_scanner.py -v`
Expected: FAIL

- [ ] **Step 2: Implement ModbusScanner**

```python
# mira-connect/mira_connect/discovery/__init__.py
```

```python
# mira-connect/mira_connect/discovery/modbus_scanner.py
from __future__ import annotations

import asyncio
import ipaddress
import logging

logger = logging.getLogger("mira-connect.discovery")


class ModbusScanner:
    async def scan_subnet(
        self, cidr: str, port: int = 502, timeout: float = 1.0, concurrency: int = 50
    ) -> list[dict]:
        network = ipaddress.IPv4Network(cidr, strict=False)
        hosts = [str(ip) for ip in network.hosts()]
        semaphore = asyncio.Semaphore(concurrency)
        results: list[dict] = []

        async def probe(host: str) -> None:
            async with semaphore:
                try:
                    reader, writer = await asyncio.wait_for(
                        asyncio.open_connection(host, port), timeout=timeout
                    )
                    writer.close()
                    await writer.wait_closed()
                    results.append({"host": host, "port": port, "protocol": "modbus_tcp"})
                    logger.info("Modbus TCP responding at %s:%d", host, port)
                except (OSError, asyncio.TimeoutError):
                    pass

        await asyncio.gather(*(probe(h) for h in hosts))
        results.sort(key=lambda r: ipaddress.IPv4Address(r["host"]))
        return results
```

- [ ] **Step 3: Run tests — verify pass**

Run: `cd mira-connect && uv run pytest tests/test_modbus_scanner.py -v`
Expected: 2 passed

- [ ] **Step 4: Commit**

```bash
git add mira-connect/mira_connect/discovery/ mira-connect/tests/test_modbus_scanner.py
git commit -m "feat(mira-connect): Modbus TCP subnet scanner"
```

---

### Task 3: Device Fingerprinting + GS20 Register Map

**Files:**
- Create: `mira-connect/mira_connect/fingerprint/__init__.py`
- Create: `mira-connect/mira_connect/fingerprint/identifier.py`
- Create: `mira-connect/mira_connect/fingerprint/register_maps/gs20.yaml`
- Test: `mira-connect/tests/test_fingerprint.py`

- [ ] **Step 1: Create GS20 register map YAML**

```yaml
# mira-connect/mira_connect/fingerprint/register_maps/gs20.yaml
manufacturer: AutomationDirect
model: GS20
protocol: modbus_tcp
probe:
  - register: 0x2100
    type: holding
    expected_range: [0, 65535]
    description: "Command register — confirms GS20-class VFD"
  - register: 0x2103
    type: holding
    expected_range: [0, 6000]
    description: "Output frequency x10 — realistic range 0-600.0 Hz"
tags:
  outputFrequency:
    register: 0x2103
    scale: 0.1
    unit: Hz
    sm_field: outputFrequency
  motorCurrent:
    register: 0x2104
    scale: 0.1
    unit: A
    sm_field: motorCurrent
  dcBusVoltage:
    register: 0x2105
    scale: 1
    unit: V
    sm_field: dcBusVoltage
  heatsinkTemp:
    register: 0x2106
    scale: 1
    unit: degC
    sm_field: heatsinkTemp
  faultCode:
    register: 0x210F
    scale: 1
    unit: ""
    sm_field: faultCode
sm_profile: ConveyorDrive
```

- [ ] **Step 2: Write the failing fingerprint test**

```python
# mira-connect/tests/test_fingerprint.py
from __future__ import annotations

from pathlib import Path

import pytest

from mira_connect.fingerprint.identifier import DeviceIdentifier


def test_load_register_maps():
    ident = DeviceIdentifier()
    assert len(ident.maps) >= 1
    assert any(m["model"] == "GS20" for m in ident.maps)


def test_match_gs20_from_probe_results():
    ident = DeviceIdentifier()
    probe_results = {0x2103: 421, 0x2100: 0}
    match = ident.identify(probe_results)
    assert match is not None
    assert match["manufacturer"] == "AutomationDirect"
    assert match["model"] == "GS20"


def test_no_match_returns_none():
    ident = DeviceIdentifier()
    probe_results = {0x9999: 0}
    match = ident.identify(probe_results)
    assert match is None


def test_tag_map_has_scaled_entries():
    ident = DeviceIdentifier()
    probe_results = {0x2103: 421, 0x2100: 0}
    match = ident.identify(probe_results)
    tags = match["tags"]
    assert "outputFrequency" in tags
    assert tags["outputFrequency"]["scale"] == 0.1
    assert tags["outputFrequency"]["unit"] == "Hz"
```

Run: `cd mira-connect && uv run pytest tests/test_fingerprint.py -v`
Expected: FAIL

- [ ] **Step 3: Implement DeviceIdentifier**

```python
# mira-connect/mira_connect/fingerprint/__init__.py
```

```python
# mira-connect/mira_connect/fingerprint/identifier.py
from __future__ import annotations

import logging
from pathlib import Path

import yaml

logger = logging.getLogger("mira-connect.fingerprint")

MAPS_DIR = Path(__file__).parent / "register_maps"


class DeviceIdentifier:
    def __init__(self, maps_dir: Path = MAPS_DIR):
        self.maps: list[dict] = []
        for path in sorted(maps_dir.glob("*.yaml")):
            with open(path) as f:
                self.maps.append(yaml.safe_load(f))
        logger.info("Loaded %d register maps from %s", len(self.maps), maps_dir)

    def identify(self, probe_results: dict[int, int]) -> dict | None:
        for device_map in self.maps:
            if self._matches(device_map, probe_results):
                return {
                    "manufacturer": device_map["manufacturer"],
                    "model": device_map["model"],
                    "sm_profile": device_map.get("sm_profile", ""),
                    "tags": device_map["tags"],
                }
        return None

    def _matches(self, device_map: dict, probe_results: dict[int, int]) -> bool:
        for probe in device_map.get("probe", []):
            reg = probe["register"]
            if reg not in probe_results:
                return False
            value = probe_results[reg]
            lo, hi = probe.get("expected_range", [0, 65535])
            if not (lo <= value <= hi):
                return False
        return True
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd mira-connect && uv run pytest tests/test_fingerprint.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add mira-connect/mira_connect/fingerprint/ mira-connect/tests/test_fingerprint.py
git commit -m "feat(mira-connect): device fingerprinting + GS20 register map"
```

---

### Task 4: WebSocket Relay (Cloud Side)

**Files:**
- Create: `mira-relay/relay_server.py`
- Create: `mira-relay/Dockerfile`
- Create: `mira-connect/mira_connect/relay/__init__.py`
- Create: `mira-connect/mira_connect/relay/client.py`
- Create: `mira-connect/mira_connect/relay/store_forward.py`
- Test: `mira-connect/tests/test_relay_client.py`
- Test: `mira-connect/tests/test_store_forward.py`

- [ ] **Step 1: Write store-and-forward test**

```python
# mira-connect/tests/test_store_forward.py
from __future__ import annotations

import json

from mira_connect.relay.store_forward import StoreForward


def test_buffer_and_drain(tmp_path):
    sf = StoreForward(db_path=str(tmp_path / "buffer.db"))
    sf.buffer({"type": "tags", "tags": {"freq": 42.1}})
    sf.buffer({"type": "tags", "tags": {"freq": 42.2}})
    messages = sf.drain(limit=10)
    assert len(messages) == 2
    assert messages[0]["tags"]["freq"] == 42.1


def test_drain_empties_buffer(tmp_path):
    sf = StoreForward(db_path=str(tmp_path / "buffer.db"))
    sf.buffer({"type": "tags", "tags": {"freq": 42.1}})
    sf.drain(limit=10)
    remaining = sf.drain(limit=10)
    assert len(remaining) == 0


def test_buffer_count(tmp_path):
    sf = StoreForward(db_path=str(tmp_path / "buffer.db"))
    assert sf.count() == 0
    sf.buffer({"type": "tags", "tags": {}})
    assert sf.count() == 1
```

Run: `cd mira-connect && uv run pytest tests/test_store_forward.py -v`
Expected: FAIL

- [ ] **Step 2: Implement StoreForward**

```python
# mira-connect/mira_connect/relay/__init__.py
```

```python
# mira-connect/mira_connect/relay/store_forward.py
from __future__ import annotations

import json
import sqlite3


class StoreForward:
    def __init__(self, db_path: str = "mira_connect_buffer.db"):
        self._db = sqlite3.connect(db_path)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS buffer ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  payload TEXT NOT NULL,"
            "  created_at REAL NOT NULL DEFAULT (unixepoch('now'))"
            ")"
        )
        self._db.commit()

    def buffer(self, message: dict) -> None:
        self._db.execute("INSERT INTO buffer (payload) VALUES (?)", (json.dumps(message),))
        self._db.commit()

    def drain(self, limit: int = 100) -> list[dict]:
        rows = self._db.execute(
            "SELECT id, payload FROM buffer ORDER BY id LIMIT ?", (limit,)
        ).fetchall()
        if not rows:
            return []
        ids = [r[0] for r in rows]
        placeholders = ",".join("?" * len(ids))
        self._db.execute(f"DELETE FROM buffer WHERE id IN ({placeholders})", ids)
        self._db.commit()
        return [json.loads(r[1]) for r in rows]

    def count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM buffer").fetchone()[0]
```

- [ ] **Step 3: Run store-forward tests — verify pass**

Run: `cd mira-connect && uv run pytest tests/test_store_forward.py -v`
Expected: 3 passed

- [ ] **Step 4: Write relay server**

```python
# mira-relay/relay_server.py
"""MIRA Connect WebSocket relay — receives tag data from edge agents, writes to mira.db."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time

import websockets

logger = logging.getLogger("mira-relay")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
PORT = int(os.environ.get("RELAY_PORT", "8765"))
AGENTS: dict[str, websockets.WebSocketServerProtocol] = {}


def _get_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    return db


def _upsert_equipment(db: sqlite3.Connection, equipment_id: str, tags: dict) -> None:
    db.execute(
        """INSERT INTO equipment_status (equipment_id, name, status, last_updated,
           speed_rpm, temperature_c, current_amps, pressure_psi, metadata)
           VALUES (?, ?, 'online', datetime('now'), ?, ?, ?, ?, ?)
           ON CONFLICT(equipment_id) DO UPDATE SET
               status='online', last_updated=datetime('now'),
               speed_rpm=COALESCE(excluded.speed_rpm, speed_rpm),
               temperature_c=COALESCE(excluded.temperature_c, temperature_c),
               current_amps=COALESCE(excluded.current_amps, current_amps),
               pressure_psi=COALESCE(excluded.pressure_psi, pressure_psi),
               metadata=COALESCE(excluded.metadata, metadata)
        """,
        (
            equipment_id,
            tags.get("_name", equipment_id),
            tags.get("speed_rpm"),
            tags.get("temperature_c") or tags.get("heatsinkTemp", {}).get("v"),
            tags.get("current_amps") or tags.get("motorCurrent", {}).get("v"),
            tags.get("pressure_psi"),
            json.dumps(tags),
        ),
    )
    db.commit()


def _insert_fault(db: sqlite3.Connection, equipment_id: str, fault_code: str) -> None:
    existing = db.execute(
        "SELECT id FROM faults WHERE equipment_id=? AND fault_code=? AND resolved=0",
        (equipment_id, fault_code),
    ).fetchone()
    if existing:
        return
    db.execute(
        "INSERT INTO faults (equipment_id, fault_code, description, severity) VALUES (?, ?, ?, ?)",
        (equipment_id, fault_code, f"Fault {fault_code} detected via MIRA Connect", "warning"),
    )
    db.commit()
    logger.warning("New fault: %s on %s", fault_code, equipment_id)


async def handler(ws):
    agent_id = None
    try:
        async for raw in ws:
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "auth":
                agent_id = msg.get("agent_id", "unknown")
                AGENTS[agent_id] = ws
                logger.info("Agent connected: %s (tenant=%s)", agent_id, msg.get("tenant_id"))
                await ws.send(json.dumps({"type": "auth_ok"}))

            elif msg_type == "tags":
                db = _get_db()
                for eq_id, tag_data in msg.get("equipment", {}).items():
                    _upsert_equipment(db, eq_id, tag_data)
                    fault_val = tag_data.get("faultCode", {}).get("v", 0)
                    if fault_val and fault_val != 0:
                        _insert_fault(db, eq_id, str(int(fault_val)))
                db.close()

            elif msg_type == "discovery":
                logger.info("Discovery from %s: %d devices", agent_id, len(msg.get("devices", [])))

    except websockets.ConnectionClosed:
        pass
    finally:
        if agent_id and agent_id in AGENTS:
            del AGENTS[agent_id]
            logger.info("Agent disconnected: %s", agent_id)


async def main():
    logger.info("MIRA Relay starting on port %d", PORT)
    async with websockets.serve(handler, "0.0.0.0", PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 5: Write relay Dockerfile**

```dockerfile
# mira-relay/Dockerfile
FROM python:3.12.13-slim
WORKDIR /app
RUN pip install --no-cache-dir websockets==13.*
COPY relay_server.py .
CMD ["python", "relay_server.py"]
```

- [ ] **Step 6: Commit**

```bash
git add mira-connect/mira_connect/relay/ mira-connect/tests/test_store_forward.py \
       mira-connect/tests/test_relay_client.py mira-relay/
git commit -m "feat(mira-connect): WSS relay server + store-and-forward client"
```

---

### Task 5: Activation Flow

**Files:**
- Modify: `mira-web/src/server.ts` — add `/api/connect/activate` + `/api/connect/generate-code`
- Modify: `mira-web/src/lib/quota.ts` — add `plg_activation_codes` schema
- Create: `mira-connect/mira_connect/config.py`

- [ ] **Step 1: Add activation code table to mira-web schema**

In `mira-web/src/lib/quota.ts`, add to `ensureSchema()`:

```typescript
await db`
  CREATE TABLE IF NOT EXISTS plg_activation_codes (
    code        TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES plg_tenants(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    agent_id    TEXT
  )`;
```

- [ ] **Step 2: Add generate-code endpoint to server.ts**

In `mira-web/src/server.ts`, add after the billing-portal route:

```typescript
app.post("/api/connect/generate-code", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const code = `MIRA-${crypto.randomUUID().slice(0, 4).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const db = sql();
  await db`
    INSERT INTO plg_activation_codes (code, tenant_id, expires_at)
    VALUES (${code}, ${user.sub}, NOW() + INTERVAL '1 hour')`;
  return c.json({ code, expires_in_seconds: 3600 });
});
```

- [ ] **Step 3: Add activate endpoint (unauthenticated — agent calls this)**

```typescript
app.post("/api/connect/activate", async (c) => {
  const body = await c.req.json();
  const { code, agent_id } = body;
  if (!code || !agent_id) return c.json({ error: "code and agent_id required" }, 400);

  const db = sql();
  const rows = await db`
    SELECT code, tenant_id, expires_at, used_at
    FROM plg_activation_codes
    WHERE code = ${code} LIMIT 1`;
  const row = rows[0];
  if (!row) return c.json({ error: "Invalid code" }, 404);
  if (row.used_at) return c.json({ error: "Code already used" }, 410);
  if (new Date(row.expires_at) < new Date()) return c.json({ error: "Code expired" }, 410);

  await db`
    UPDATE plg_activation_codes
    SET used_at = NOW(), agent_id = ${agent_id}
    WHERE code = ${code}`;

  const relayUrl = process.env.RELAY_WSS_URL || "wss://connect.factorylm.com";
  return c.json({
    tenant_id: row.tenant_id,
    relay_url: relayUrl,
    agent_id,
  });
});
```

- [ ] **Step 4: Write agent config module**

```python
# mira-connect/mira_connect/config.py
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("mira-connect.config")

CONFIG_PATH = Path.home() / ".mira-connect" / "config.json"


@dataclass
class ConnectConfig:
    agent_id: str = ""
    tenant_id: str = ""
    relay_url: str = ""
    activated: bool = False

    def save(self) -> None:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(self.__dict__, indent=2))
        logger.info("Config saved to %s", CONFIG_PATH)

    @classmethod
    def load(cls) -> ConnectConfig:
        if CONFIG_PATH.exists():
            data = json.loads(CONFIG_PATH.read_text())
            return cls(**data)
        return cls(agent_id=f"agent-{uuid.uuid4().hex[:8]}")


async def activate(code: str, api_base: str = "https://factorylm.com") -> ConnectConfig:
    import httpx

    config = ConnectConfig.load()
    if not config.agent_id:
        config.agent_id = f"agent-{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{api_base}/api/connect/activate",
            json={"code": code, "agent_id": config.agent_id},
        )
        resp.raise_for_status()
        data = resp.json()

    config.tenant_id = data["tenant_id"]
    config.relay_url = data["relay_url"]
    config.activated = True
    config.save()
    return config
```

- [ ] **Step 5: Commit**

```bash
git add mira-web/src/server.ts mira-web/src/lib/quota.ts mira-connect/mira_connect/config.py
git commit -m "feat(mira-connect): activation code pairing flow"
```

---

### Task 6: Agent Main Loop

**Files:**
- Create: `mira-connect/mira_connect/main.py`

- [ ] **Step 1: Write the agent entry point**

```python
# mira-connect/mira_connect/main.py
"""MIRA Connect Agent — discover, connect, stream factory equipment data."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time

import websockets

from .config import ConnectConfig, activate
from .discovery.modbus_scanner import ModbusScanner
from .drivers.modbus_driver import ModbusDriver
from .fingerprint.identifier import DeviceIdentifier
from .relay.store_forward import StoreForward

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
logger = logging.getLogger("mira-connect")

POLL_INTERVAL = float(__import__("os").environ.get("POLL_INTERVAL", "2.0"))


async def discover_and_identify(subnet: str) -> list[dict]:
    scanner = ModbusScanner()
    logger.info("Scanning %s for Modbus TCP devices...", subnet)
    hosts = await scanner.scan_subnet(subnet, timeout=1.0)
    logger.info("Found %d responding hosts", len(hosts))

    identifier = DeviceIdentifier()
    identified = []

    for host_info in hosts:
        driver = ModbusDriver()
        host = host_info["host"]
        if not await driver.connect(host, host_info["port"]):
            continue
        try:
            probe_results = {}
            for reg in [0x2100, 0x2103, 0x2104, 0x2105, 0x210F]:
                try:
                    resp = await driver._client.read_holding_registers(address=reg, count=1, slave=1)
                    if not resp.isError():
                        probe_results[reg] = resp.registers[0]
                except Exception:
                    pass
            match = identifier.identify(probe_results)
            if match:
                match["host"] = host
                match["port"] = host_info["port"]
                identified.append(match)
                logger.info("Identified %s %s at %s", match["manufacturer"], match["model"], host)
            else:
                identified.append({"host": host, "port": host_info["port"],
                                   "manufacturer": "Unknown", "model": "Unknown",
                                   "tags": {}, "sm_profile": ""})
        finally:
            await driver.disconnect()

    return identified


async def stream_tags(config: ConnectConfig, devices: list[dict]) -> None:
    sf = StoreForward()
    drivers: list[tuple[str, ModbusDriver]] = []

    for dev in devices:
        if not dev.get("tags"):
            continue
        driver = ModbusDriver()
        eq_id = f"{dev['manufacturer']}-{dev['model']}-{dev['host']}".replace(" ", "_")
        if await driver.connect(dev["host"], dev["port"]):
            driver.load_tag_map(dev["tags"])
            drivers.append((eq_id, driver))

    if not drivers:
        logger.warning("No devices with tags to stream")
        return

    relay_url = config.relay_url
    ws = None

    while True:
        try:
            if ws is None:
                ws = await websockets.connect(relay_url)
                await ws.send(json.dumps({
                    "type": "auth",
                    "tenant_id": config.tenant_id,
                    "agent_id": config.agent_id,
                }))
                auth_resp = json.loads(await ws.recv())
                if auth_resp.get("type") != "auth_ok":
                    logger.error("Auth failed: %s", auth_resp)
                    ws = None
                    await asyncio.sleep(5)
                    continue
                logger.info("Relay connected")

                buffered = sf.drain(limit=500)
                for msg in buffered:
                    await ws.send(json.dumps(msg))
                if buffered:
                    logger.info("Forwarded %d buffered messages", len(buffered))

            equipment_data = {}
            for eq_id, driver in drivers:
                tag_names = list(driver._tag_map.keys())
                readings = await driver.read_tags(tag_names)
                equipment_data[eq_id] = {
                    name: {"v": tv.value, "q": tv.quality, "t": tv.timestamp}
                    for name, tv in readings.items()
                }

            msg = {
                "type": "tags",
                "tenant_id": config.tenant_id,
                "agent_id": config.agent_id,
                "ts": time.time(),
                "equipment": equipment_data,
            }

            try:
                await ws.send(json.dumps(msg))
            except websockets.ConnectionClosed:
                logger.warning("Relay connection lost — buffering locally")
                sf.buffer(msg)
                ws = None

        except Exception as e:
            logger.error("Stream error: %s — buffering", e)
            sf.buffer(msg if "msg" in dir() else {"type": "heartbeat"})
            ws = None
            await asyncio.sleep(5)
            continue

        await asyncio.sleep(POLL_INTERVAL)


async def run() -> None:
    config = ConnectConfig.load()

    if not config.activated:
        print("\n  MIRA Connect - Factory Floor Agent\n")
        code = input("  Enter activation code: ").strip()
        if not code:
            print("  No code entered. Exiting.")
            return
        config = await activate(code)
        print(f"  Activated! Tenant: {config.tenant_id[:8]}...\n")

    subnet = __import__("os").environ.get("SCAN_SUBNET", "192.168.1.0/24")
    devices = await discover_and_identify(subnet)

    if not devices:
        logger.warning("No devices found on %s. Retrying in 30s...", subnet)
        await asyncio.sleep(30)
        return

    logger.info("Starting tag streaming for %d devices", len(devices))
    await stream_tags(config, devices)


def main():
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("MIRA Connect stopped")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify agent runs (dry run)**

Run: `cd mira-connect && uv run python -c "from mira_connect.main import run; print('import OK')"`
Expected: `import OK`

- [ ] **Step 3: Commit**

```bash
git add mira-connect/mira_connect/main.py
git commit -m "feat(mira-connect): agent main loop — discover, connect, stream"
```

---

### Task 7: Wire plc_worker.py to Live Tags

**Files:**
- Modify: `mira-bots/shared/workers/plc_worker.py`

- [ ] **Step 1: Replace the stub with a real tag reader**

```python
# mira-bots/shared/workers/plc_worker.py
"""PLC Worker — injects live equipment tag data into diagnostic context."""
from __future__ import annotations

import json
import logging
import os
import sqlite3

logger = logging.getLogger("mira-gsd.plc")

DB_PATH = os.environ.get("MIRA_DB_PATH", "./mira.db")


def get_equipment_context(asset_identified: str | None) -> str:
    if not asset_identified:
        return ""
    try:
        db = sqlite3.connect(DB_PATH)
        db.execute("PRAGMA journal_mode=WAL")
        row = db.execute(
            "SELECT equipment_id, status, speed_rpm, temperature_c, current_amps, "
            "pressure_psi, metadata, last_updated FROM equipment_status "
            "WHERE equipment_id LIKE ? OR name LIKE ? "
            "ORDER BY last_updated DESC LIMIT 1",
            (f"%{asset_identified}%", f"%{asset_identified}%"),
        ).fetchone()
        db.close()
        if not row:
            return ""
        eq_id, status, rpm, temp, current, pressure, metadata_json, updated = row
        parts = [f"Live equipment data for {eq_id} (as of {updated}):"]
        parts.append(f"  Status: {status}")
        if rpm is not None:
            parts.append(f"  Speed: {rpm} RPM")
        if temp is not None:
            parts.append(f"  Temperature: {temp}°C")
        if current is not None:
            parts.append(f"  Current: {current} A")
        if pressure is not None:
            parts.append(f"  Pressure: {pressure} PSI")
        if metadata_json:
            try:
                meta = json.loads(metadata_json)
                for k, v in meta.items():
                    if k.startswith("_"):
                        continue
                    if isinstance(v, dict) and "v" in v:
                        parts.append(f"  {k}: {v['v']} {v.get('u', '')}")
            except (json.JSONDecodeError, TypeError):
                pass
        return "\n".join(parts)
    except Exception as e:
        logger.warning("PLC context lookup failed: %s", e)
        return ""


def get_active_faults(asset_identified: str | None) -> list[dict]:
    if not asset_identified:
        return []
    try:
        db = sqlite3.connect(DB_PATH)
        db.execute("PRAGMA journal_mode=WAL")
        rows = db.execute(
            "SELECT fault_code, description, severity, timestamp FROM faults "
            "WHERE (equipment_id LIKE ? OR equipment_id LIKE ?) AND resolved=0 "
            "ORDER BY timestamp DESC LIMIT 5",
            (f"%{asset_identified}%", f"%{asset_identified}%"),
        ).fetchall()
        db.close()
        return [
            {"fault_code": r[0], "description": r[1], "severity": r[2], "timestamp": r[3]}
            for r in rows
        ]
    except Exception as e:
        logger.warning("Fault lookup failed: %s", e)
        return []
```

- [ ] **Step 2: Commit**

```bash
git add mira-bots/shared/workers/plc_worker.py
git commit -m "feat(plc_worker): replace stub with live tag reader from equipment_status"
```

---

### Task 8: Docker Compose + End-to-End Verification

**Files:**
- Modify: `docker-compose.saas.yml` — add mira-relay service

- [ ] **Step 1: Add relay service to compose**

Add to `docker-compose.saas.yml`:

```yaml
  mira-relay:
    build: ./mira-relay
    container_name: mira-relay-saas
    restart: unless-stopped
    ports:
      - "127.0.0.1:8765:8765"
    environment:
      - MIRA_DB_PATH=/data/mira.db
      - RELAY_PORT=8765
    volumes:
      - ./mira-bridge/data:/data
    networks:
      - mira-net
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8765')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
```

- [ ] **Step 2: End-to-end verification script**

Create `mira-connect/tests/e2e_modbus_sim.py`:

```python
"""End-to-end test: Modbus simulator → agent → relay → mira.db."""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time

from pymodbus.server import StartAsyncTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusSlaveContext,
    ModbusServerContext,
)


async def run_simulator():
    """Start a fake GS20 VFD on localhost:5020."""
    store = ModbusSlaveContext(
        hr=ModbusSequentialDataBlock(0x2100, [0, 0, 0, 421, 83, 582, 47, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    )
    context = ModbusServerContext(slaves=store, single=True)
    print("[sim] Starting Modbus simulator on localhost:5020")
    await StartAsyncTcpServer(context=context, address=("127.0.0.1", 5020))


if __name__ == "__main__":
    print("Run this in one terminal, then in another:")
    print("  SCAN_SUBNET=127.0.0.1/32 uv run python -m mira_connect.main")
    print()
    asyncio.run(run_simulator())
```

- [ ] **Step 3: Run lint + format**

```bash
cd mira-connect && uv run ruff check . --fix && uv run ruff format .
```

- [ ] **Step 4: Run full test suite**

```bash
cd mira-connect && uv run pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 5: Final commit**

```bash
git add docker-compose.saas.yml mira-connect/tests/e2e_modbus_sim.py
git commit -m "feat(mira-connect): compose relay service + e2e Modbus simulator"
```

---

## Verification Checklist

- [ ] `uv run pytest mira-connect/tests/ -v` — all unit tests pass
- [ ] `ruff check mira-connect/` — no lint errors
- [ ] Modbus simulator + agent + relay produces rows in `mira.db` `equipment_status` table
- [ ] `plc_worker.get_equipment_context("GS20")` returns live tag data string
- [ ] Activation code flow: generate code → agent enters code → gets tenant_id + relay URL
- [ ] Store-and-forward: disconnect relay → agent buffers → reconnect → buffered messages drain
