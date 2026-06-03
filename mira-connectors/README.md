# mira-connectors

Generic connector framework for MIRA. Turns external systems (CMMS/EAM, SCADA, Historian,
document stores, MQTT/UNS) into MIRA's canonical model, then routes proposed asset /
component / location / relationship mappings through a **technician confirmation gate** so a
human confirms before the knowledge graph changes.

It **extends** the existing integrations (`mira-mcp/cmms/`, Ignition, `mira-crawler`,
`mira-relay`) — it does not replace them.

## Layout

```
mira_connectors/
├── canonical.py          # MIRA canonical record model (maps to existing tables)
├── base.py               # Connector ABC + BaseConnector (the 10 capabilities)
├── factory.py            # create_connector(provider, config)
├── types/                # CMMS / SCADA / Historian / Document / MQTT type bases
├── mocks/                # MaximoMockConnector + IgnitionMockConnector + fixtures
├── store.py              # ProposalStore (InMemory + Postgres) — existing tables only
├── confirmation_gate.py  # ConnectorConfirmationGate — propose/confirm/correct/reject (ADR-0017)
└── service.py            # import_and_propose(connector, gate, ...) — one-call wiring
```

## Docs

- `docs/mira/connector-framework.md` — the connector contract, types, read-only doctrine, mocks.
- `docs/mira/technician-confirmation-gate.md` — the confirmation gate, status mapping, API surface.

## Test

```bash
cd mira-connectors && pytest        # 53 offline tests, no DB / network
ruff check mira_connectors tests
```
