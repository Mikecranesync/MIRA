# MIRA Vision — Canonical Specification

**Effective:** 2026-04-15
**Supersedes:** v0.1.0 product-vision memo (Ignition Module target, $299 / $4,999 / $9,999 tiers)

This directory is the authoritative source of MIRA's product definition. Everything else — CLAUDE.md claims, release notes, ADRs, marketing copy — defers to these documents when they conflict.

## Files

- **[2026-04-15-mira-manufacturing-gaps.md](./2026-04-15-mira-manufacturing-gaps.md)** — The 12-problem specification. MIRA's MVP is defined by honest implementation of every claim in this document. Any public claim MIRA makes about itself must be backed by code that appears in `git grep` results for the terms used here.

- **[mvp-gap-analysis.md](./mvp-gap-analysis.md)** — Point-in-time audit (2026-04-15) of how much of the 12-problem spec the codebase actually backs. Current state: 3/10. This file tracks delta over time.

## Rule

If the 12-problem doc uses a vocabulary term — **ISA-95**, **SM Profile**, **MIRA Connect**, **I3X**, **FewShotTrainer**, **tribal_knowledge**, **OPC UA discovery**, **CESMII Marketplace**, **quality metadata on telemetry**, **typed relationship edges** — and that term does not appear in `src/`, we do not claim the feature exists. Marketing follows code, not the other way around.

## Where the old vision went

Pre-2026-04-15, MIRA was positioned as an Ignition Module for SCADA integrators ($299/$4,999/$9,999 tiers). That strategy is preserved in the `project_product_vision.md` memory and is NOT dead — the Ignition distribution channel remains a long-term goal. But the MVP the codebase is now driving toward is the 12-problem industrial-AI platform defined in this directory. Ignition packaging becomes a deployment target once the substance exists.

The $97/mo beta funnel (factorylm.com / app.factorylm.com) remains the near-term revenue and feedback-collection vehicle while the MVP is built. It does not define the product.
