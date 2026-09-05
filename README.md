# MIRA — Maintenance Intelligence & Response Assistant

**FactoryLM is a clean conversational maintenance app. MIRA helps technicians ask questions, add photos or manuals, get evidence-backed help, and keep the result with their work.**

The approved September 5, 2026 direction is to improve the **existing FactoryLM mobile app**. Chat is the front door; projects, knowledge, work, and settings are accessible through a quiet menu. Existing accounts, equipment, notebooks, documents, and integrations stay usable.

Start with [NORTH_STAR.md](NORTH_STAR.md), the [unified delivery plan](docs/product/2026-09-05-sellable-app-alignment.md), and [MIRA #3586](https://github.com/Mikecranesync/MIRA/issues/3586). `Mikecranesync/factorylm` supplies supporting capabilities. Slack/Foreman is the internal command center.

This is approved product direction, not a claim that the redesign is deployed. Prior context-platform / Drive Commander positioning is preserved in the [decision history](docs/product/2026-09-05-decision-history.md). Its useful technology remains part of the app's foundation.

---

## Where do I go?

### 🏭 I'm a customer / plant user
- **App entry point (verify release/build before rollout):** [app.factorylm.com](https://app.factorylm.com)
- **Marketing site:** [factorylm.com](https://factorylm.com)
- **Product documentation:** [docs/product/](docs/product/)
  - [What is MIRA?](docs/product/what-is-mira.md)
  - [Getting started](docs/product/getting-started.md)
  - [QR asset tagging](docs/product/qr-system.md)
  - [CMMS integration](docs/product/cmms-integration.md)
  - [Troubleshooting](docs/product/troubleshooting.md)

### 👩‍💻 I'm a developer or operator
- **Developer documentation:** [docs/developer/](docs/developer/)
  - [Architecture overview](docs/developer/architecture.md)
  - [Local setup](docs/developer/local-setup.md)
  - [Deployment](docs/developer/deployment.md)
  - [Contributing](docs/developer/contributing.md)

### 🔧 Reference material
- [All environment variables](docs/env-vars.md)
- [Architecture Decision Records](docs/adr/)
- [Runbooks](docs/runbooks/)
- [Known issues](docs/known-issues.md)
- [Changelog](docs/CHANGELOG.md)

---

## The customer journey we are proving

1. Open MIRA and ask a question.
2. Add a photo, manual, or equipment context when it helps.
3. Confirm the required equipment context and receive cited help, or a clear request for missing evidence.
4. Ask a follow-up, save a useful finding or approved action, and reopen the same work later.

The release gate is a fresh user completing this journey with their own material, without manual repair by Mike. Evidence, tenant isolation, read-only equipment behavior, and existing review/deployment controls remain required. General help before equipment selection must be implemented without bypassing asset-specific confirmation or grounding.

---

## Requirements (for self-hosting)

- Docker + Docker Compose v2.20+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) — all secrets via Doppler
- Ollama running on host at `localhost:11434`
- macOS (Apple Silicon preferred) or Linux
- NeonDB account (free tier works for development)

Full setup walkthrough: [docs/developer/local-setup.md](docs/developer/local-setup.md)

---

## License

Proprietary — Copyright (c) 2026 Cranesync. All rights reserved. See [LICENSE](LICENSE).
Third-party bundled dependencies retain their original open-source licenses.

For licensing inquiries: [mike@cranesync.com](mailto:mike@cranesync.com)
