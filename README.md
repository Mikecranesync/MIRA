# MIRA — Maintenance Intelligence & Response Assistant

AI-powered equipment fault diagnosis — delivered through Slack, Telegram, Teams, and WhatsApp.

## Quick Start

```bash
git clone https://github.com/factorylm/mira && cd mira
cp .env.template .env  # fill in NODERED_PORT and any non-Doppler vars
doppler run --project factorylm --config prd -- docker compose up -d
```

Run the smoke test to verify all services are healthy:

```bash
bash install/smoke_test.sh
```

## Documentation

- [Architecture & Setup](docs/README.md)
- [Audit & System State](docs/AUDIT.md)
- [PRD — Config 1 MVP](docs/PRD_v1.0.md)
- [Slack Setup](docs/SETUP_SLACK.md)
- [Teams Setup](docs/SETUP_TEAMS.md)
- [WhatsApp Setup](docs/SETUP_WHATSAPP.md)

## Requirements

- Docker + Docker Compose v2.20+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) — all secrets managed via Doppler
- Ollama running on host at `localhost:11434` (for local inference backend)
- macOS (Apple Silicon preferred) or Linux

## License

Apache 2.0 — see [LICENSE](LICENSE)
