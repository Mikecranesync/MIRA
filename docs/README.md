# Docs index

A hand-curated map of the `docs/` tree. If something's missing here, it's drift — please add or remove the entry.

For repo-level files (README, CONTRIBUTING, SECURITY, SUPPORT), look at the [repository root](../).

---

## For customers and operators

- [What is MIRA?](product/what-is-mira.md)
- [Getting started](product/getting-started.md)
- [QR asset tagging](product/qr-system.md)
- [CMMS integration](product/cmms-integration.md)
- [Troubleshooting](product/troubleshooting.md)

The same content also lives **inside the product** at [app.factorylm.com/help](https://app.factorylm.com/help) — that's the fastest place for active customers.

---

## For developers

- [Architecture overview](developer/architecture.md)
- [Local setup](developer/local-setup.md)
- [Deployment](developer/deployment.md)
- [Contributing](developer/contributing.md) (also see [`CONTRIBUTING.md`](../CONTRIBUTING.md) at the repo root)
- [All environment variables](env-vars.md) — 25 vars, all in Doppler `factorylm/prd`
- [Known issues](known-issues.md) — what we know is broken or deferred
- [Changelog](CHANGELOG.md) — released versions and what changed

---

## Architecture and design

- [Architecture](ARCHITECTURE.md) — high-level system overview
- [Adapter architecture](ADAPTER_ARCHITECTURE.md) — how Telegram/Slack/Teams/WhatsApp adapters share an engine
- [Quality score](QUALITY_SCORE.md) — domain-by-domain code grade
- [HNSW migration](HNSW_MIGRATION.md) — vector index migration plan
- [Hardware independence](HARDWARE_INDEPENDENCE.md) — the path off Mac Mini cluster

### Architecture Decision Records

ADRs are short, immutable records of architectural decisions and the context that drove them.

- [`adr/`](adr/) — full directory
- [0001 — PLC protocol choice](adr/0001-plc-protocol-choice.md)
- [0002 — Bot adapter pattern](adr/0002-bot-adapter-pattern.md)
- [0003 — Edge inference strategy](adr/0003-edge-inference-strategy.md)
- [0004 — Multi-machine sync](adr/0004-multi-machine-sync.md)
- [0005 — AR HUD architecture](adr/0005-ar-hud-architecture.md)
- [0006 — Paperclip dev orchestration](adr/0006-paperclip-dev-orchestration.md)
- [0007 — Notebook intelligence layer](adr/0007-notebook-intelligence-layer.md)
- [0008 — Sidecar deprecation](adr/0008-sidecar-deprecation.md)
- [0009 — Crawl verification fallback](adr/0009-crawl-verification-fallback.md)
- [0010 — Karpathy eval alignment](adr/0010-karpathy-eval-alignment.md)

---

## Specs

Active and historical feature specs. New features start as a spec under `docs/specs/` before any code lands — see [CONTRIBUTING.md](../CONTRIBUTING.md#spec-first-rule).

- [`specs/`](specs/) — full directory
- [FactoryLM platform v2](specs/factorylm-platform-v2.md)
- [Help documentation](specs/help-documentation-spec.md)

---

## Runbooks

Operational procedures for things that need to be done, not just understood.

- [`runbooks/`](runbooks/) — full directory
- [VPS provisioning](runbooks/factorylm-vps.md)
- [Edge deploy](runbooks/edge-deploy.md)
- [CMMS onboarding](runbooks/cmms-onboarding.md)
- [Inference router deploy](runbooks/2026-04-11-inference-router-deploy.md)
- [PLC integration test](runbooks/plc-integration-test.md)
- [HUD demo setup](runbooks/hud-demo-setup.md)
- [Sidecar OEM migration](runbooks/sidecar-oem-migration.md)

---

## Brand and positioning

- [Brand and positioning kit](brand-and-positioning-2026-04-26.md) — workspace + agent model, voice, color, type
- [Design system](design-system-2026-04-26.md)
- [Design handoff](design-handoff-2026-04-26.md)
- [GitHub alignment](gh-alignment-2026-04-26.md)

---

## Reference

- [API reference](api-reference/)
- [Integration implementation guide](INTEGRATION_IMPLEMENTATION_GUIDE.md)
- [PRD v1.0](PRD_v1.0.md) — historical, retained for context
- [Hub integrations PRD v1](PRD_Hub_Integrations_v1.md)
- [Customer interviews](customer-interviews.md)
- [Customer usability survey](customer-usability-survey-2026-04-26.md)
- [Textbook sources](TEXTBOOK_SOURCES.md)

---

## Maintaining this index

This file is hand-curated. When you add or remove a doc:

1. Update the relevant section above.
2. Group by purpose, not by date.
3. One line per pointer — title plus a short hook. No multi-line summaries here.
4. Avoid stale links — if a doc gets archived, remove its entry.

If the section a new doc belongs in doesn't exist yet, add it. Long-running drift makes the index useless; small frequent updates keep it accurate.
