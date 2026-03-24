# mira-bridge — Node-RED Message Router

Node-RED 4.x container for message routing and SQLite persistence.
Image: `nodered/node-red:4.1.7-22`

## Purpose

Bridges incoming messages (Telegram webhooks, REST triggers) to MIRA core
services and writes structured data to the shared SQLite database.

## SQLite (data/mira.db)

- WAL mode; shared volume `node-red-data` mounted at `/data` inside container
- **Source of truth** for mira.db — all other containers mount this volume read-write
- mira-mcp and mira-ingest receive the same file via Docker volume, not copy

## Flows (flows/)

Node-RED flow definitions stored as JSON. Edit via the Node-RED UI at port 1880,
then export and commit the updated JSON files.

## Port

`${NODERED_PORT:-1880}:1880` — UI and HTTP-in nodes.

## Volume Layout

```
node-red-data:/data          # Node-RED settings, flows, credentials
${MIRA_DB_PATH:-./data}:/mira-db  # Host SQLite directory exposed into container
```

## Key Constraint

mira-bridge holds the write lock on mira.db during normal operation.
Do not run schema migrations against mira.db from other containers while
mira-bridge is running — use `Supervisor._ensure_table()` patterns (WAL + retry).

## Healthcheck

`curl -f http://localhost:1880/` — passes when Node-RED HTTP server is up.
