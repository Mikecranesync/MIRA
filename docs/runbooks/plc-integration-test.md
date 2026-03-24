# Runbook: PLC Integration Test

**Status: DEFERRED — this runbook describes planned tests for Config 4.**

`plc_worker.py` is currently a stub. No Modbus or EtherNet/IP code is implemented.
Do not attempt these steps until Config 4 is started.

See ADR-0001 for the protocol decision (Modbus TCP primary, pymodbus MIT library).

---

## Pre-Requisites (Config 4)

- PLC Laptop (Tailscale: 100.72.2.99) is online and reachable
- Allen-Bradley Micro820 powered and connected to factory LAN
- CCW (Connected Components Workbench) project loaded and compiled
- pymodbus installed in mira-bots container: `pip install pymodbus`
- `MODBUS_HOST` and `MODBUS_PORT` env vars set in Doppler `factorylm/prd`

## Known Blockers (as of v0.3.1)

- **CCW serial port sync**: CCW project on PLC Laptop requires physical serial connection
  to download program to Micro820. USB-Serial adapter must be present.
- **Network unreachable**: PLC Laptop is sometimes not reachable on Tailscale (100.72.2.99).
  Requires physical check — boot and confirm Tailscale daemon is running.
- **plc_worker.py is a stub**: `PLCWorker` class exists but all methods are no-ops.

## Planned Test Suite (Config 4)

### Test 1: Modbus TCP Connectivity

```python
from pymodbus.client import ModbusTcpClient
client = ModbusTcpClient(host=MODBUS_HOST, port=502)
assert client.connect(), "Modbus TCP connection failed"
client.close()
```

Pass: connection established within 2 seconds.

### Test 2: Register Read (Holding Registers)

Read fault register block from Micro820 (address range TBD per CCW tag map):

```python
result = client.read_holding_registers(address=0, count=10, slave=1)
assert not result.isError(), f"Register read failed: {result}"
```

Pass: 10 registers returned without error.

### Test 3: Fault Injection → MIRA Diagnosis

1. Trigger a simulated fault in Factory I/O (e.g., motor overcurrent)
2. Verify fault code appears in holding register
3. Send fault description to `Supervisor.process()` via Telegram
4. Verify MIRA responds with diagnostic question within 5 seconds

### Test 4: Register Write (Fault Clear)

After diagnosis, verify MIRA can issue a fault-clear command:

```python
result = client.write_register(address=FAULT_CLEAR_REG, value=1, slave=1)
assert not result.isError()
```

## Reference

- Micro820 Modbus register map: see `docs/gists/` (master wiring guide gist)
- GS20 VFD Modbus map: P9.xx registers, documented in GS20 manual
- pymodbus docs: https://pymodbus.readthedocs.io (Apache 2.0 license)
