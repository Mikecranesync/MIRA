# MIRA — Maintenance Intelligence & Response Assistant

**AI-powered industrial maintenance diagnostics, delivered through the browser and every chat app your technicians already use.**

MIRA diagnoses equipment faults in conversation. Scan a QR code on a machine, tell MIRA what's wrong, and get an answer grounded in that specific asset's manuals, history, and the collective experience of every technician who came before. Built for the plant floor — mobile-first, voice-capable, CMMS-integrated.

---

## Where do I go?

### 🏭 I'm a customer / plant user
- **Live product:** [app.factorylm.com](https://app.factorylm.com)
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

## What MIRA does, in one minute

1. A technician walks up to a faulting machine.
2. They scan a QR sticker on the equipment (or type in the asset tag, or upload a nameplate photo).
3. MIRA opens a chat pre-loaded with the asset's vendor, model, service history, and recent faults.
4. The technician describes the symptom — by voice or text.
5. MIRA asks diagnostic questions, pulls the relevant page from the manual, and proposes a fix.
6. When the fault is resolved, MIRA auto-generates the CMMS work order closeout. One tap to confirm.

Competitive differentiators: asset-scoped entry, industrial knowledge grounding (25K+ chunks across 100+ vendors), voice-first mobile UX, Atlas/MaintainX/Limble/Fiix CMMS integration.

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
