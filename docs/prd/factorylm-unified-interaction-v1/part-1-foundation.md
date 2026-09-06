# PRD — FactoryLM Unified Interaction Layer & Industrial Projects V1

**Status:** Proposed for visual approval  
**Date:** 2026-09-06  
**Owner:** Mike Harper / FactoryLM  
**Prototype:** UI-only, mocked data, no production connections  
**Primary targets:** `factorylm.com`, `app.factorylm.com/hub`, FactoryLM mobile  

## 1. Executive decision

FactoryLM will present **one simple LLM-style interface everywhere**. The public site, signed-in web app, enterprise Hub, Android app, and iOS app will use the same shell, project tree, conversations, composer, machine context, evidence cards, structured work flows, and visual language.

The products are not separate dashboards:

- **Public FactoryLM:** the same shell in demo mode, with sample industrial projects and clear sign-up paths.
- **FactoryLM Web:** the same shell for everyday maintenance work.
- **FactoryLM Mobile:** the same shell responsively collapsed, with camera, QR, voice, offline, and notification advantages.
- **FactoryLM Hub:** the same shell with deeper enterprise inspectors, administration, integrations, permissions, audit, namespace, signals, and evaluation capabilities.

The core rule is:

> **If a technician learns FactoryLM on a phone, they already know FactoryLM on the web and in Hub.**

V1 will be built as a disconnected design lab beside the current products. Existing production sites and apps remain unchanged until the new interface is visually approved and one end-to-end Golden Conversation passes on every surface.

## 2. Product vision

FactoryLM is the maintenance context platform. MIRA is the assistant through which people use it.

The interaction should feel as simple and familiar as a leading LLM product:

1. Open FactoryLM.
2. Start or resume a conversation.
3. Select a project or machine only when it helps.
4. Type, speak, photograph, scan, or attach a file.
5. Receive an understandable answer with visible evidence.
6. Turn the answer into structured maintenance work.
7. Save verified findings back to the project and machine.
8. Continue from another device without relearning the product.

The simplicity is not cosmetic. It hides complex industrial systems behind one uniform interaction model while preserving evidence, permissions, auditability, machine identity, and read-only OT safety.

## 3. Research synthesis: what to copy and what to adapt

This PRD copies **interaction architecture and user expectations**, not OpenAI branding, logos, proprietary assets, or non-public implementation details.

### 3.1 ChatGPT Projects pattern

Current ChatGPT Projects group chats, files, project instructions, and memory into one long-running workspace. They are designed to preserve context, support reuse, move chats into projects, share project context, and continue across devices.

**FactoryLM adaptation:**

- A **Project** is a persistent maintenance workspace.
- It contains conversations, folders, linked machines, files, findings, work items, and instructions.
- Project context is inherited by conversations without forcing the technician to reattach everything.
- A project can be resumed from mobile, web, or Hub.
- Project sharing follows tenant permissions and enterprise policy.

### 3.2 Chat / Work / Codex pattern

OpenAI separates quick conversation from longer agentic work and domain-specific coding work while preserving a familiar chat-centered interaction. Codex adds project context, plans, tool use, reviewable outputs, parallel threads, and explicit execution environments.

**FactoryLM adaptation:**

- **Ask mode:** quick conversational help, general or machine-aware.
- **Work mode:** a longer structured maintenance run with a goal, plan, checks, observations, findings, artifacts, and completion criteria.
- The mode changes the workflow depth, **not the UI shell**.
- Enterprise controls appear in the inspector, not in a separate dashboard product.

### 3.3 Codex project and worktree pattern

Codex can keep parallel chats inside projects and use isolated worktrees so long-running changes do not interfere with foreground work. Work can be handed off and reviewed before being promoted.

**FactoryLM adaptation:**

A **Diagnostic Run** is the industrial equivalent of an isolated worktree:

- It snapshots the machine identity, evidence window, source set, goal, and plan.
- Observations and hypotheses remain scoped to the run.
- Draft findings do not silently become official machine knowledge.
- A technician or supervisor reviews and promotes a finding to verified machine memory.
- Multiple diagnostic runs may proceed without overwriting each other.
- A shift handoff transfers the same run, state, and evidence to another person.

### 3.4 Codex long-horizon loop pattern

Codex long-running work is kept coherent through an explicit loop: plan, act, observe results, repair, update durable state, and repeat.

**FactoryLM adaptation:**

Work mode uses:

1. Define the maintenance goal.
2. Build a safe diagnostic plan.
3. Gather observations and evidence.
4. Compare expected versus observed behavior.
5. Revise the plan when evidence changes.
6. Record findings and uncertainty.
7. Produce a work order, handoff, report, checklist, or saved finding.
8. Close only when the stated completion criteria are met.

### 3.5 What FactoryLM adds that general LLM products do not

- Canonical machine identity.
- Asset, component, and location relationships.
- OEM manuals and drawings with exact citations.
- Live versus recorded machine evidence.
- Technician observations and photographs with provenance.
- CMMS work and maintenance history.
- Human verification states for industrial facts.
- Read-only OT boundaries.
- Safety hard stops and explicit uncertainty.
- Tenant isolation, enterprise permissioning, and audit trails.

## 4. Product laws

1. **One shell everywhere.** Mobile, public web, signed-in web, and Hub render the same core components.
2. **Conversation is the front door.** Projects, machines, files, and work support the conversation instead of replacing it.
3. **Projects organize; assets remain canonical.** Moving or deleting a project folder never duplicates or destroys the underlying machine record.
4. **One interaction contract.** Every surface renders the same authoritative turns, evidence, tool states, and lifecycle.
5. **Server truth, thin clients.** Clients never invent citations, tool success, machine identity, or final state.
6. **General help is always available.** Asset-specific claims require confirmed identity or evidence.
7. **Draft is not verified.** Hypotheses and observations are visibly separate from promoted machine knowledge.
8. **Read-only toward OT.** V1 introduces no generic PLC, VFD, tag, reset, or control write capability.
9. **Same behavior before same pixels.** Shared interaction behavior is mandatory; responsive layout may collapse or reorder only when needed by viewport.
10. **Old production remains the rollback.** No big-bang cutover.
