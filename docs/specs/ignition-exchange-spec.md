# Ignition Exchange Resources Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Distributable **Ignition 8.1** project assets that demonstrate MIRA on a real industrial control surface (Conveyor MIRA scenario). Ships an Ignition project (`ConveyorMIRA`), 36 PLC tags, gateway scripts, web-dev modules, and a deploy script. Designed to install on a PLC laptop talking to a Micro820 over Modbus TCP. Pairs with `mira-relay` (cloud relay endpoint for factory→cloud tag streaming) for SaaS connectivity.

## Scope
**IN scope**
- Ignition project under `ignition/project/` (Perspective views: ConveyorStatus + others)
- 36 tags under `ignition/tags/`
- Gateway scripts under `ignition/gateway-scripts/`
- WebDev modules under `ignition/webdev/`
- Config in `ignition/config/` and `ignition/db/`
- PowerShell deployer `ignition/deploy_ignition.ps1`

**OUT of scope**
- The PLC ladder logic itself (lives under `plc/`)
- Cloud relay implementation (`mira-relay`, separate spec target)
- Custom Ignition modules (we use stock Perspective + WebDev)

## Architecture
- **Layer:** Industrial integration (off the standard MIRA layer map; runs on the PLC laptop)
- **Targets:**
  - Ignition Gateway 8.1 Standard (trial OK) on `http://localhost:8088`
  - Micro820 PLC at `192.168.1.100:502` (Modbus TCP)
- **Scenarios:** Standalone (LAN) and SaaS (`mira-relay` for factory→cloud streaming)

```
Micro820 (Modbus TCP) ──▶ Ignition Gateway ──▶ Perspective (ConveyorStatus)
                                  │
                                  └── WebDev → POST events to mira-relay (SaaS) → MIRA cloud
```

## API Contract
### Deploy script (`deploy_ignition.ps1`)
Sequence the script must execute, idempotently:
1. Confirm Ignition gateway running.
2. Locate Ignition `data/projects/` automatically.
3. Copy `ignition/project/` → `ConveyorMIRA` project folder.
4. Trigger project rescan via REST.
5. Import all 36 tags via REST.
6. Print Perspective URL.

### Device connection (one-time, manual)
| Field | Value |
|---|---|
| Driver | Modbus TCP |
| Name | `Micro820_Conveyor` (case-sensitive) |
| Hostname | `192.168.1.100` (try first) or `169.254.32.93` |
| Port | `502` |
| Unit ID | `1` |

### Cloud relay (when wired)
WebDev `POST` body to `mira-relay`:
```json
{ "asset_id": "<tag-or-asset>", "tag": "<name>", "value": <number|str>, "ts": "<iso8601>" }
```
Authentication is a per-tenant signing key (held in Doppler).

## Configuration
| Setting | Where | Purpose |
|---|---|---|
| Gateway URL | `http://localhost:8088` | Ignition Gateway |
| Project name | `ConveyorMIRA` | Created by deploy script |
| Tag-import REST | Ignition Gateway API | Import 36 tags |
| `MIRA_RELAY_URL` | env on PLC laptop | Cloud relay endpoint when SaaS-connected |
| `MIRA_RELAY_SIGNING_KEY` | Doppler / DPAPI | HMAC for relay POSTs |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Deploy script idempotency | required | re-run safe |
| Tag count after import | 36 | exact match |
| Gateway → PLC connection | "Connected" before tag import | enforced via deploy script |
| Mean install time | unmeasured | ≤ 5 minutes |

## Acceptance Criteria
1. **Cold install:** Following the README on a clean PLC laptop with Ignition 8.1 results in a `Connected` Modbus device, 36 imported tags, and a working Perspective URL.
2. **Re-run safety:** Running `deploy_ignition.ps1` a second time does not duplicate tags or break the project.
3. **ConveyorStatus view:** Loads at `/ConveyorMIRA` and shows VFD metrics + status pills wired to live tags.
4. **Tag naming invariant:** The device connection is named `Micro820_Conveyor` exactly; renaming breaks tag references.
5. **SaaS mode:** With `MIRA_RELAY_URL` and signing key set, tag changes appear in the MIRA cloud within 5 s.
6. **Trial-license tolerance:** Setup works on Ignition Standard trial without Maker license features.

## Known Issues
- Hostname depends on the PLC's network mode (Ethernet vs. APIPA fallback). Two hostnames are documented; users may need to try both.
- Tag import is REST-driven; firewalls that block local REST to `:8088` will block the deployer.
- The deploy script is PowerShell-only (Windows host).

## Change Log
- 2026-04 — `mira-relay` added as SaaS endpoint; Ignition WebDev modules updated to POST scoped tag events.
- 2026-04 — `deploy_ignition.ps1` 3-command flow established as the canonical install path.
