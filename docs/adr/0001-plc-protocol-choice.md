# ADR-0001: PLC Protocol Choice

## Status
Accepted

## Context

MIRA targets Allen-Bradley Micro820 and CompactLogix PLCs on the factory floor.
These controllers natively support both Modbus TCP/RTU and EtherNet/IP (CIP).
A protocol must be chosen for `plc_worker.py` (currently a stub, deferred to Config 4)
to establish the read/write interface for fault register polling and command dispatch.
The choice affects library dependencies, device compatibility beyond AB hardware,
and implementation complexity.

## Considered Options

1. Modbus TCP (primary)
2. EtherNet/IP (CIP) via pycomm3
3. OPC-UA via opcua-asyncio

## Decision

**Modbus TCP as primary protocol, EtherNet/IP as secondary for Allen-Bradley-native features.**

pymodbus (MIT license) will be the implementation library. Modbus TCP is
industry-standard, supported by virtually all PLCs and VFDs regardless of vendor,
and dramatically simpler to implement and debug than CIP. EtherNet/IP will be
added later for AB-specific features (tag-name access, controller diagnostics) that
Modbus cannot expose. OPC-UA is deferred indefinitely — it requires a dedicated
server license on most PLCs and is overkill for current scale.

## Consequences

### Positive
- Single pymodbus dependency (MIT) covers 80%+ of field device compatibility
- Modbus register maps are well-documented for GS10/GS20 VFDs and Micro820
- Simple request/response model; easy to unit-test without hardware
- Broad compatibility beyond Allen-Bradley — any Modbus device works

### Negative
- `plc_worker.py` remains a stub until Config 4; no live PLC data in MVP
- Modbus lacks tag-name access — register addresses must be mapped manually per device
- EtherNet/IP secondary path adds future complexity; CIP stack is substantially more involved
