# MIRA Spec Index
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

Every module in MIRA has a spec at `docs/specs/{module-name}-spec.md`. A spec is the source of truth for **what the module does, its API contract, its quality benchmarks, and its acceptance criteria**. If a future Claude Code session needs to validate that the code still meets spec, this is where to look first — before reading the implementation.

Specs follow the same template (Purpose · Scope · Architecture · API Contract · Configuration · Quality Standards · Acceptance Criteria · Known Issues · Change Log). When a module changes materially, bump the spec's Change Log; when an acceptance criterion changes, bump the version.

## Core Platform
- [`mira-bots`](./mira-bots-spec.md) — Adapter containers + the shared diagnostic engine (Supervisor / GSDEngine, FSM, RAGWorker, guardrails, InferenceRouter cascade).
- [`mira-pipeline`](./mira-pipeline-spec.md) — OpenAI-compat API on `:9099`; the active VPS chat path that wraps Supervisor for Open WebUI.
- [`mira-hub`](./mira-hub-spec.md) — Authenticated Next.js workspace (17 sections); non-destructive overlay over the existing backend.
- [`mira-web`](./mira-web-spec.md) — Public marketing site + PLG funnel (Hono/Bun, Stripe, Resend, Atlas provisioning).
- [`mira-mcp`](./mira-mcp-spec.md) — FastMCP server + REST proxy for equipment + CMMS tools (Atlas / MaintainX / Limble / Fiix adapters).
- [`mira-core`](./mira-core-spec.md) — Open WebUI + MCPO proxy + mira-ingest photo/PDF pipeline.

## Data & Intelligence
- [`mira-crawler`](./mira-crawler-spec.md) — Celery fleet that discovers, downloads, parses, chunks, and embeds knowledge into NeonDB.
- [`knowledge-graph`](./knowledge-graph-spec.md) — `kg_entities`, `kg_relationships`, `kg_triples_log` schemas + RLS; foundation for GraphRAG.
- [`rag-pipeline`](./rag-pipeline-spec.md) — End-to-end retrieval, hybrid (BM25 + pgvector + RRF), citation contract, eval discipline.
- [`quality-gate`](./quality-gate-spec.md) — Output post-processor + confidence heuristic; deterministic, < 10 ms.
- [`dialogue-state-tracker`](./dialogue-state-tracker-spec.md) — Stage-1 FSM that drives the Guided Socratic Dialogue.

## Integrations
- [`mira-cmms`](./mira-cmms-spec.md) — Atlas CMMS (4 containers); REST-only integration to keep license boundary clean.
- [`mira-bridge`](./mira-bridge-spec.md) — Node-RED 4.x; canonical writer of the shared SQLite WAL `mira.db`.
- [`mira-scan`](./mira-scan-spec.md) — Asset-tag scanner: standalone web flow + monday.com app; "Open CMMS" button on every page.
- [`ignition-exchange`](./ignition-exchange-spec.md) — Ignition 8.1 ConveyorMIRA project, 36 tags, deploy script, optional `mira-relay` SaaS.

## Infrastructure
- [`agentic-os`](./agentic-os-spec.md) — Heartbeat, self-healer, learning capture, funnel tracker; the Cowork scheduled tasks.
- [`auth-tenancy`](./auth-tenancy-spec.md) — Magic-link, Google OAuth, trial gate, admin bypass, JWT, HMAC inbound webhooks.
- [`deployment`](./deployment-spec.md) — Compose layout, nginx routing, node map, Doppler injection, smoke test.

## Interfaces
- [`telegram-bot`](./telegram-bot-spec.md) — Primary field-tech surface; polling-only, voice WO, photo intake, slash commands.
- [`hub-mobile`](./hub-mobile-spec.md) — Responsive Hub: bottom tabs < 768 px, side drawer ≥ 768 px; touch-target + safe-area rules.

## Existing Reference Specs (kept for compatibility)
- [`factorylm-platform-v2`](./factorylm-platform-v2.md) — Earlier overview; canonical platform context lives here in this index now.

## Conventions
- **Versioning:** A spec's `Version` bumps when an acceptance criterion changes. Change Log captures every notable update.
- **Owner:** Mike Harper / FactoryLM unless explicitly delegated.
- **Reviewing a PR:** Cross-check the PR diff against the affected spec's "Acceptance Criteria"; if the change implies a new criterion, the spec should change in the same PR.
- **Auditing the system:** Read `docs/context/PROGRESS.md` first (current phase + decisions), then this index.
