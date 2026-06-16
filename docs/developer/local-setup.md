# Local Setup

Running MIRA on your machine for development. 30-minute walk-through for a first-time contributor.

## Prerequisites

- **Docker + Docker Compose v2.20+** — verify with `docker compose version`
- **Doppler CLI** — all secrets live in Doppler; see [docs.doppler.com/docs/install-cli](https://docs.doppler.com/docs/install-cli)
- **Ollama** — for local inference and embeddings; install from [ollama.com](https://ollama.com)
- **OS:** macOS (Apple Silicon preferred) or Linux. Windows via WSL2 works but is not officially tested.
- **NeonDB account** — free tier is sufficient for development. Sign up at [neon.tech](https://neon.tech).
- **Disk space:** ~15 GB for models + containers + test data

## 1. Clone and enter

```bash
git clone git@github.com:Mikecranesync/MIRA.git
cd MIRA
```

This is a private repo. You'll need SSH access — if you don't have it yet, ask Mike.

## 2. Authenticate Doppler

```bash
doppler login
doppler setup --project factorylm --config dev
```

Use `dev` config for local development. Never run local dev against the `prd` config.

If you don't have Doppler access to the `factorylm` project, ask Mike for an invite. You can run MIRA with a local `.env.dev` file as a fallback — copy `.env.template` to `.env.dev` and fill in the required values (see `docs/env-vars.md`).

## 3. Pull models

```bash
ollama serve    # in one terminal, or as a service
ollama pull nomic-embed-text:v1.5
ollama pull qwen2.5vl:7b
```

These are the embedding model (768-dim, matches NeonDB schema) and the vision model for nameplate OCR. Total download: ~6 GB.

## 4. Start the stack

From the repo root:

```bash
doppler run --project factorylm --config dev -- docker compose up -d
```

This brings up:

- `mira-core` (Open WebUI, port 3000)
- `mira-pipeline` (port 9099)
- `mira-ingest` (port 8001)
- `mira-mcp` (ports 8000, 8001)
- `mira-bridge` (Node-RED, port 1880)
- `mira-docling` (port 5001)
- `atlas-api` (CMMS, port 8088)
- `atlas-db` (Postgres, port 5433)
- `mira-web` (port 3200)

Bot adapters (`mira-bot-telegram`, `mira-bot-slack`) are optional — comment them out in `docker-compose.yml` if you don't have bot tokens yet.

## 5. Verify everything is healthy

```bash
bash install/smoke_test.sh
```

The smoke test hits each service's health endpoint. Expected output: all green.

Individual checks:

```bash
curl localhost:3000                 # Open WebUI
curl localhost:9099/health          # mira-pipeline
curl localhost:8001/health          # mira-ingest
curl localhost:8000/sse             # mira-mcp (SSE stream — Ctrl-C after a second)
curl localhost:3200/api/health      # mira-web
```

## 6. Access the UIs

- **Open WebUI:** [localhost:3000](http://localhost:3000) — the main chat interface
- **Node-RED:** [localhost:1880](http://localhost:1880) — orchestration flows
- **Atlas CMMS:** [localhost:8088](http://localhost:8088) — work orders UI
- **mira-web funnel:** [localhost:3200](http://localhost:3200) — marketing + signup + CMMS

## 7. Seed local data (optional)

```bash
# Populate Atlas with demo work orders and assets
cd mira-web && bun run src/seed/demo-data.ts

# Load the OEM library starter chunks into NeonDB
cd ../mira-core/mira-ingest && python scripts/ingest_manuals.py --sample
```

## 8. Run the tests

From repo root:

```bash
# Fast offline tests (76 tests, <1 second)
pytest tests/ -m "not network and not slow"

# Full eval (requires live services on BRAVO; maintainers only)
doppler run --project factorylm --config prd -- python tests/synthetic_eval.py --regimes all

# Component-level tests in individual services
cd mira-bots && pytest
cd ../mira-web && bun test
```

## Common issues

### "Ollama can't find a model"

```bash
ollama list            # verify nomic-embed-text and qwen2.5vl are present
ollama pull <model>    # re-pull if missing
```

### "mira-core can't reach Ollama from inside the container"

macOS Docker uses `host.docker.internal` to reach host services. Verify:

```bash
docker exec -it mira-core curl host.docker.internal:11434/api/tags
```

If this fails, check that Ollama is bound to all interfaces (not just `127.0.0.1`):

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

### "NeonDB SSL connection fails from my Windows machine"

Known issue — `channel_binding` fails on Windows clients. Use a macOS or Linux dev box, or set `NEON_DATABASE_URL` to a `channel_binding=disable` variant.

### "Doppler can't find my config"

```bash
doppler configure --scope "$PWD"
doppler setup --project factorylm --config dev
```

If Doppler CLI over SSH fails with a keychain error (common on remote Mac Minis), set token storage to file mode:

```bash
doppler configure set token-storage file
```

### "mira-bot-telegram won't start — no TELEGRAM_BOT_TOKEN"

Expected if you haven't set up a Telegram bot. Comment out the `mira-bot-telegram` service in `docker-compose.yml`, or create a bot via [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN` in Doppler.

## Where to go next

- [Architecture overview](architecture.md) — understand the moving pieces
- [Contributing](contributing.md) — PR workflow, commit conventions, code review
- [Deployment](deployment.md) — how code reaches production
- [docs/env-vars.md](../env-vars.md) — every env var, what it controls
