# Developing MIRA

This page holds the technical and contributor material that used to sit in the root README.
For what the product does today, see the [root README](../README.md). Some older docs linked below describe earlier framing (for example Drive Commander, CMMS integration or QR flows) or planned work. They are not product claims.

## Start here
- **[Codebase flowchart](architecture/CODEBASE_FLOWCHART.md)**: system map, chat-turn paths, ingest, ship flow
- **Developer documentation:** [developer/](developer/)
  - [Architecture overview](developer/architecture.md)
  - [Local setup](developer/local-setup.md)
  - [Deployment](developer/deployment.md)
  - [Contributing](developer/contributing.md)

## Reference material
- [All environment variables](env-vars.md)
- [Architecture Decision Records](adr/)
- [Runbooks](runbooks/)
- [Known issues](known-issues.md)
- [Changelog](CHANGELOG.md)

## Product and strategy background (internal framing, not claims)
- [Product strategy](../NORTH_STAR.md)
- [Drive Commander ADR](adr/0025-drive-intelligence-packs-and-drive-commander.md) (earlier framing, July 2026)
- [Product docs](product/): [What is MIRA?](product/what-is-mira.md), [Getting started](product/getting-started.md), [QR asset tagging](product/qr-system.md), [CMMS integration](product/cmms-integration.md), [Troubleshooting](product/troubleshooting.md)

## Requirements (for self-hosting)
- Docker + Docker Compose v2.20+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli): all secrets via Doppler
- Ollama running on host at `localhost:11434`
- macOS (Apple Silicon preferred) or Linux
- NeonDB account (free tier works for development)

Full setup walkthrough: [developer/local-setup.md](developer/local-setup.md)

## License
Proprietary. Copyright (c) 2026 Cranesync. All rights reserved. See [LICENSE](../LICENSE).
Third-party bundled dependencies retain their original open-source licenses.

For licensing inquiries: [mike@cranesync.com](mailto:mike@cranesync.com)
