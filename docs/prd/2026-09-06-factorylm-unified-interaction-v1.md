# PRD — FactoryLM Unified Interaction Layer & Industrial Projects V1

**Status:** Approved design direction; implementation not started by this PR  
**Date:** 2026-09-06  
**Owner:** Mike Harper / FactoryLM  
**Initiative:** `FLM-UI-4000`  
**Prototype:** `docs/prototypes/factorylm-unified-ui-v1/index.html`

FactoryLM will use one ChatGPT-style interaction shell across public web, signed-in web, mobile, and enterprise Hub. Projects and nested folders organize conversations, canonical machine links, files, findings, work items, and isolated Diagnostic Runs. Hub receives the same UI refresh and exposes enterprise depth through inspectors rather than a separate dashboard mental model.

The full PRD is split into five reviewable parts so agents can load only the section they need:

1. [Foundation, product vision, research synthesis, and product laws](./factorylm-unified-interaction-v1/part-1-foundation.md)
2. [Users, uniform shell, information architecture, Ask and Work modes](./factorylm-unified-interaction-v1/part-2-users-and-experience.md)
3. [Canonical interaction contract, data model, frontend architecture, and core flows](./factorylm-unified-interaction-v1/part-3-contract-and-architecture.md)
4. [Disconnected preview, migration plan, performance, accessibility, and industrial trust](./factorylm-unified-interaction-v1/part-4-preview-migration-quality.md)
5. [Metrics, acceptance criteria, locked decisions, open decisions, repository mapping, and references](./factorylm-unified-interaction-v1/part-5-acceptance-decisions-references.md)

The agent entrypoint, phase order, boundaries, and first implementation prompt are in [`docs/initiatives/FLM-UI-4000.md`](../initiatives/FLM-UI-4000.md).
