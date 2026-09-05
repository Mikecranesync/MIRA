# MIRA-1000 Product Surfaces — Hub vs MIRA

**Decision date:** 2026-08-20  
**Program:** MIRA-1000  
**Status:** ACCEPTED PRODUCT DIRECTION  
**Scope:** product surfaces and client convergence; does not authorize a new runtime or a third client codebase

## Decision

FactoryLM and MIRA have distinct primary jobs:

- **FactoryLM Hub** is the desktop configuration, governance, and operations control plane.
- **MIRA** is the technician-facing intelligent product.
- **`mira-mobile` is the codebase to evolve into MIRA's primary native interface.**
- **Do not create a third chat/native client.** Reuse the existing Capacitor/Vite/React native foundation and change its information architecture.
- Telegram, Slack, Ignition, and future clients remain alternate renderers of the same logical MIRA runtime.

The target technician experience is a minimal, conversation-first interface in the family of ChatGPT/Claude: the conversation is the application, and tools/context appear when needed.

## Repository evidence behind the decision

This decision is based on inspection of the current repository, not a green-field preference.

### FactoryLM Hub already fits the control-plane role

The Hub's live information architecture has already moved toward configuration/governance: Command Board, Namespace, Command Center, Channels, Knowledge, Assets, CMMS, Scan/Visual workspaces, contextualization, settings, users, permissions, and internal review surfaces. Older conversation/report/parts-style surfaces are Labs-gated.

Keep that direction. The Hub is where a manager, reliability engineer, integrator, or administrator builds and governs the world MIRA operates inside.

The Hub should own or expose administration for:

- sites, areas, lines, assets, and UNS structure
- knowledge/manual ingest, approval, provenance, and graph inspection
- PLC/historian/data connections
- CMMS and SaaS integrations
- users, roles, capabilities, and delegated credentials
- MIRA tool policy and approval policy
- Cloud Gold vs On-Prem configuration
- spend budgets and usage telemetry
- audit/traces
- evals, validation, and promotion/qualification

The Hub may contain diagnostic/test chat where useful for configuration or validation, but it is not the primary technician conversation product.

### `mira-mobile` is already a substantial native foundation

Do not replace it merely to obtain a simpler visual shell. It already contains hard-won native/product infrastructure including:

- static Vite + React + TypeScript client in Capacitor 8
- native HTTP/session handling against Hub APIs
- fail-closed `/api/me` capability model
- Android/iOS projects
- deep links and QR/tag resolution
- offline work-order replay/idempotency
- assets and work-order workflows
- PM schedule support
- Files / one-file-many-links behavior
- machine notebooks
- nameplate capture and manual discovery flows
- grounded chat
- persisted turns
- citation chips and exact passage/original-document viewing
- source attachment and trust-state handling

Those are assets. Preserve them unless a measured defect or product requirement justifies replacement.

## New MIRA interaction model

The current mobile shell is a five-tab technician application and the Notebook feature follows a NotebookLM mental model. The future MIRA product changes the **front door**, not the underlying useful capabilities.

### Conversation becomes the root screen

A normal launch should feel closer to ChatGPT/Claude than to a miniature CMMS.

Primary shell:

- new conversation
- conversation history / search in a drawer or secondary surface
- full-height conversation
- bottom composer
- attachment/camera control
- voice when ready
- small, explicit current-context indicator when MIRA has established one
- tool/result/approval cards rendered inline only when relevant

Avoid permanent dashboard chrome when the same operation can be invoked conversationally.

### The technician should not assemble the RAG pipeline

The current Notebook flow can require the user to create a notebook, add/select sources, and then ask. That remains useful for deliberate source-scoped research, but it must not be the prerequisite for ordinary MIRA use.

Target interaction:

> "Why did CV-101 stop twice this morning?"

MIRA decides which authorized tools/context it needs: asset identity, live state, alarms, historian, manuals, knowledge graph, prior incidents, work orders, or approved knowledge.

The user may explicitly constrain sources or context, but does not have to manually build context before every question.

## What happens to Notebook

**Keep it; demote it from mandatory front door to a persistent context/workspace primitive.**

A notebook can represent:

- a machine workspace
- an incident/troubleshooting case
- a planned repair
- a recurring problem
- a training/research workspace

Behind a conversation it may accumulate:

- photos
- manuals consulted
- technician notes
- tool outputs
- historian slices
- prior work orders
- evidence/citations
- hypotheses
- actions and approvals

The technician mainly talks to MIRA; FactoryLM structures the durable context behind the conversation.

## What happens to Workorders, Schedule, Assets, and Files

Do not delete their implementation.

They become **secondary browse/manage surfaces and MIRA tools**, rather than mandatory top-level navigation for routine work.

Examples:

- "What work orders are open on this conveyor?" uses a work-order read tool and may render compact work-order cards.
- "Create a corrective WO for this" produces an approval card, then executes through the existing deterministic work-order path.
- "What's due this week?" can query PM schedules conversationally.
- QR/deep-link scan can open a MIRA conversation already scoped to the resolved asset.
- Files remain canonical attachments/library objects and can be attached from the composer or secondary library.

Browsing remains available when browsing is actually the better interaction.

## Plugin/tool model

Do not build plugin business logic into the client.

The server/runtime owns the tool registry, schemas, permissions, tenant scope, approval requirements, execution, idempotency, and audit. The client renders provider-independent event/result types.

Examples of future tool families:

- FactoryLM: assets, approved knowledge, manuals, KG, historian, alarms, live state
- CMMS: work-order reads/writes, schedules, parts where supported
- delegated business tools: email, Slack, calendar, Drive/docs
- later customer connectors: other CMMS/EAM/business systems

The technician should be able to ask naturally rather than navigate to a plugin-specific mini-app.

## Required conversation/runtime contract

The client direction means the runtime must eventually express more than a final string. The provider-independent MIRA event contract must be able to represent at least:

- assistant text / text deltas
- citations/evidence references
- context/active-asset changes
- tool-call started/progress/completed/failed
- typed tool results
- approval requested/approved/rejected
- attachment/file events
- final status
- recoverable/fatal errors
- usage/cost metadata

The UI should not parse provider-specific OpenAI event semantics directly. Normalize them in MIRA.

## Sequencing decision

Do **not** mix the UI convergence with the P0003 runtime seam/telemetry change.

1. **P0003 — backend first:** connect the provider seam to a real MIRA caller, close the per-turn telemetry prerequisite, and establish the provider-independent conversation/event contract. Preserve current user-visible behavior. No new native client and no broad UI rewrite.
2. **P0004 — native shell convergence:** refactor the existing `mira-mobile` shell so MIRA conversation is the primary root experience; preserve/reuse native auth, QR, offline queue, files, notebooks, citations, work-order/schedule/assets implementations as secondary surfaces/tools.
3. Add read-only FactoryLM tools into the conversation runtime incrementally, then approval-gated business writes.

## Non-negotiables

- Do not create `mira-chat`, `mira-technician-v2`, or another parallel app just to get a cleaner UI.
- Do not copy Hub business logic into the client.
- Do not make Notebook source selection a requirement for ordinary MIRA conversation.
- Do not remove existing field workflows until their replacement path is real and tested.
- Do not let the client choose tenant/tool authority; server permissions remain canonical.
- Do not couple the UI to OpenAI-specific response/event IDs.
- Do not turn the Hub into a second primary technician chat experience.

## Product shorthand

> **FactoryLM builds and governs MIRA's world. MIRA is how the technician works inside that world.**

> **Keep the native app. Replace the information architecture, not the foundation.**
