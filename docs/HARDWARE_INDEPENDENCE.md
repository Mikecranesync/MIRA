# MIRA Hardware Independence

## Model: BRAVO Server, Any-Machine Client

BRAVO (Mac Mini M4, `192.168.1.11` / Tailscale `100.86.236.11`) is the only MIRA server. All services run there in Docker. Every other machine — travel laptop, phone, work PC — is just a client that talks to BRAVO over the network.

## `MIRA_SERVER_BASE_URL`

A single env var controls where client-side scripts point:

```bash
# Set in Doppler (factorylm/prd) or export locally
export MIRA_SERVER_BASE_URL=http://192.168.1.11   # LAN
export MIRA_SERVER_BASE_URL=http://100.86.236.11  # Tailscale
```

The value is **scheme + host, no port** (e.g. `http://192.168.1.11`). Each script appends its own service port:

| Service     | Port | Example URL                           |
|-------------|------|---------------------------------------|
| Open WebUI  | 3000 | `${MIRA_SERVER_BASE_URL}:3000`        |
| mira-ingest | 8002 | `${MIRA_SERVER_BASE_URL}:8002`        |
| mira-mcp    | 8001 | `${MIRA_SERVER_BASE_URL}:8001`        |
| mira-mcpo   | 8003 | `${MIRA_SERVER_BASE_URL}:8003`        |
| Node-RED    | 1880 | `${MIRA_SERVER_BASE_URL}:1880`        |

When unset, all scripts default to `http://localhost` (for running directly on BRAVO).

## What Uses It

- `mira-bots/scripts/seed_kb.py`, `ingest_interactions.py`, `seed_device_kb.py` — KB seeding
- `mira-bots/telegram_test_runner/` — ingest endpoint tests
- `mira-bots/v2_test_harness/` — autonomous test harness
- `mira-bots/tests/` — unit test env defaults
- `install/smoke_test.sh` — health checks

## What Does NOT Use It

- Docker containers — they use Docker service names (`http://mira-core:8080`) internally
- Docker healthchecks — container-internal `localhost` (correct)
- `mira-bots/telegram/bot.py` — runs inside Docker, uses service names
- `mira-core/scripts/ingest_manuals.py` — Ollama is always local to the machine doing ingest

## Running Tests From Any Machine

```bash
# From travel laptop (Doppler has MIRA_SERVER_BASE_URL set)
doppler run --project factorylm --config prd -- python run_test.py --all

# Or export manually
export MIRA_SERVER_BASE_URL=http://100.86.236.11
python mira-bots/telegram_test_runner/run_ingest_test.py --all

# Smoke test
MIRA_SERVER_BASE_URL=http://192.168.1.11 bash install/smoke_test.sh
```
