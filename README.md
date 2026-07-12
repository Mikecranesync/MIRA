# MIRA — Maintenance Intelligence & Response Assistant

> **⚠️ PRODUCT FRAMING UPDATE (2026-07-11):** This README describes the infrastructure layer. The **first
> sellable product is Drive Commander**, a read-only VFD troubleshooting tool (issue #2577, PR #2504,
> ADR-0025). The generic "AI-powered maintenance diagnostics" framing below is foundational but no
> longer the lead pitch — **start at the [Drive Commander ADR](docs/adr/0025-drive-intelligence-packs-and-drive-commander.md)
> and [product strategy](NORTH_STAR.md)** to understand the current direction. **See also the canonical
> wedge statement in [NORTH_STAR.md](NORTH_STAR.md).**

**FactoryLM is the maintenance-context layer that makes a factory's messy reality trustworthy enough for AI.
MIRA is the grounded agent that proves it by diagnosing with cited sources.**

The first product delivering this vision is **Drive Commander** — context-led, read-only VFD fault intelligence
on a phone. Earlier framing (generic "copilot", whole-plant "signal difference engine") is archived; see
`docs/product/` for those framings' superseded-by headers.

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
