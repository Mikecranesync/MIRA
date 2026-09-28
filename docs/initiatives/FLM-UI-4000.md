# FLM-UI-4000 — FactoryLM Unified Interaction V1

**Status:** Approved design direction; implementation not started by this change  
**Owner:** Mike Harper / FactoryLM  
**Date:** 2026-09-06  
**Authority:** The PRD and prototype committed with this initiative  
**Runtime effect:** None; documentation and static preview only

## Mission

Build one simple, ChatGPT-class FactoryLM interface and use it everywhere:

1. `factorylm.com` — public/demo and acquisition mode.
2. Signed-in FactoryLM web — everyday MIRA workspace.
3. FactoryLM mobile — the same interface, responsively collapsed with native capabilities.
4. `app.factorylm.com/hub` — the same interface plus enterprise inspectors and administration.

A person who learns FactoryLM on one device must already know how to use it on every other device.

## Product model

- **FactoryLM** is the product and trusted maintenance-context platform.
- **MIRA** is the assistant and primary interaction surface.
- **Projects** organize long-running maintenance work.
- **Folders/subfolders** organize project context.
- **Machines remain canonical assets.** Projects link to machines; they never copy them.
- **Conversations** are the primary working surface.
- **Diagnostic Runs** are isolated, reviewable Work-mode investigations analogous to Codex workspaces/worktrees.
- **Findings** are promoted into verified machine memory only through explicit review.

## Uniform shell

Every surface uses the same conceptual component tree:

- FactoryLM identity and account control
- New conversation
- Ask / Work mode
- Project and folder tree
- Conversation history
- Central MIRA thread
- Universal composer
- Machine/project context
- Attachments
- Citations and evidence
- Safety notices
- Tool/action cards
- Diagnostic plan and progress
- Optional right inspector

Responsive layout may collapse panels into drawers or sheets. Permission level may reveal more controls. Neither is allowed to create a different mental model.

## Architecture

```text
Public Web       Signed-in Web       Mobile       Enterprise Hub
    \                 |                 |               /
     \________________|_________________|______________/
                       |
             FactoryLM Unified UI
                       |
            MIRA Interaction Adapter
                       |
     Existing Notebook / Asset / File / Work APIs
                       |
        FactoryLM context, evidence, permissions,
        machine memory, integrations, and audit
```

Use the existing Notebook route, turn persistence, evidence types, asset identity, Files model, and server-owned MIRA policies. Do not create a second chat backend or second evidence system.

## Required repository structure

The first implementation should create or converge toward:

```text
packages/
  factorylm-theme/
  factorylm-interaction/
  factorylm-ui/

apps/
  factorylm-ui-lab/
```

- `factorylm-theme`: visual tokens and responsive rules.
- `factorylm-interaction`: runtime-neutral types, reducers, fixtures, and normalization.
- `factorylm-ui`: shared React components with no Next.js/Capacitor/router dependency.
- `factorylm-ui-lab`: disconnected fixture-driven preview for visual approval.

React compatibility must cover the current Hub and mobile runtimes. Platform-specific behavior enters through adapters.

## Phase order

### Phase 0 — authority and collision cleanup

Review and sequence existing overlapping work before implementation:

- #3595 — governance authority stack.
- #3596 — product convergence archaeology.
- #3587 — earlier product direction; salvage only non-conflicting language.
- #3514 — ChatGPT-class UI architecture and protocol decisions.
- #3515 — assistant-ui compatibility spike; salvage proven adapter work rather than merge stale branches wholesale.

### Phase 1 — disconnected shared UI lab

Build the full shell with realistic fixtures only. No auth, APIs, database, providers, files, work orders, or production state.

Required fixture states:

- New/empty user
- General Ask turn
- Machine-bound Ask turn
- Project and nested folders
- Machine links in multiple projects
- Photo/PDF/file attachment states
- Grounded answer with citations
- Live versus recorded machine evidence
- Safety stop
- Work-mode Diagnostic Run
- Plan, progress, findings, artifact, and handoff
- Error/retry
- Offline/sync state
- Enterprise inspector
- Long conversation/project history
- Light/dark and desktop/tablet/mobile layouts

### Phase 2 — Hub private preview

Mount the approved shared shell under a private, non-default route or feature flag. Begin with fixtures, then connect read-only data.

### Phase 3 — one Golden Conversation

Connect only:

```text
sign in
→ open/create project
→ create folder
→ link machine
→ start conversation
→ ask general question
→ attach photo/manual
→ ask machine-specific follow-up
→ receive cited answer
→ inspect source
→ save finding
→ close
→ reopen on another surface
→ continue with identical context
```

### Phase 4 — mobile adapter

Reuse the same UI. Add only platform adapters for camera, QR, file picker, hardware Back, offline cache, share, notifications, safe areas, and keyboard behavior.

### Phase 5 — public web mode

Render the same shell in demo mode, with sample industrial projects and cited answers. Keep the existing commercial/checkout services intact behind the new experience.

### Phase 6 — project writes and Work mode

Add projects, folders, linked items, saved findings, and Diagnostic Runs as additive organizational records. Assets, files, notebooks, and work orders remain canonical targets.

### Phase 7 — enterprise inspector

Expose deeper Hub capabilities around the same thread: identity, evidence provenance, machine history, knowledge, namespace, signals, integrations, permissions, audit, usage, evaluation, and administration.

## Data rules

1. Projects and folders store references, not copies.
2. A machine may appear in many projects while remaining one canonical asset.
3. Project instructions may be inherited; project files are available for retrieval, not blindly inserted into every prompt.
4. The active machine is always visible and correctable.
5. Machine-specific claims require confirmed identity and authorized evidence.
6. Each historical turn preserves the exact evidence scope it used.
7. Changing project/folder/machine context affects future turns and must not rewrite old turns.
8. All project, folder, item, run, and finding records are tenant-scoped and fail closed.
9. OT remains read-only unless a separately governed capability explicitly says otherwise; this initiative authorizes no control paths.

## Implementation boundaries

- Do not change the current default production UI in the design-lab PR.
- Do not connect production APIs during Phase 1.
- Do not create another conversation store, prompt stack, evidence vocabulary, provider router, or safety brain.
- Do not split implementation by assigning one independent agent to each surface.
- One owner implements shared components; other agents review or implement non-overlapping adapters.
- Keep every slice behind a flag or private route with immediate rollback.
- Draft PRs only until Mike explicitly authorizes merge/deploy.

## Agent responsibilities

- **Claude Code:** primary implementation of shared UI and bounded adapters.
- **Codex:** independent exact-SHA review, accessibility, state recovery, context safety, and parity testing.
- **Foreman/Grokbot:** orchestration, collision detection, work claims, evidence collection, and concise reporting; never a second customer MIRA brain.

## Phase 1 acceptance gate

The disconnected shared UI lab is complete only when:

1. The same component implementation renders public, signed-in, mobile, and Hub modes.
2. Desktop, tablet, and 412×915 mobile screenshots exist in light and dark modes.
3. Keyboard-only navigation and screen-reader labels cover the core flow.
4. Mobile drawer/sheet/back/keyboard behavior is tested.
5. Every required fixture state renders without console errors.
6. The project tree supports nested folders and canonical machine links.
7. Ask and Work modes share the same shell.
8. No production network request is possible from the lab.
9. The PR lists exactly what was salvaged from prior work and what was intentionally not reused.
10. Mike can review the complete experience without any backend dependency.

## Golden Conversation release gate

V2 cannot become the default until the same persisted conversation is proven across Hub/web and a real mobile build with:

- identical project, folder, and machine context;
- identical accepted user turns;
- identical citations and evidence basis;
- identical safety meaning;
- durable attachments and findings;
- no duplicate turns after interruption/retry;
- tenant and machine-identity adversarial tests;
- production rollback proof.

## First implementation prompt

```markdown
# FACTORYLM-UNIFIED-UI-V2-SHELL-001

Use `docs/prd/2026-09-06-factorylm-unified-interaction-v1.md`,
`docs/prototypes/factorylm-unified-ui-v1/index.html`, and
`docs/initiatives/FLM-UI-4000.md` as the approved design authority.

First inspect current main and open UI/chat PRs, especially #3514, #3515,
#3587, #3595, and #3596. Reuse proven work; do not merge stale branches or
create a competing chat backend.

Build a disconnected, fixture-driven React UI lab for one shared FactoryLM
interface across public web, authenticated web/mobile, and enterprise Hub.
Create reusable theme, interaction-model, and UI packages. The same shell,
project tree, conversation, composer, citations, machine context, safety
states, Diagnostic Run cards, and inspector must render at desktop, tablet,
and 412×915 mobile sizes.

Include mocked states for general chat, machine-bound chat, project/folder
organization, files, citations, machine history, safety stop, Work mode,
errors, offline state, and enterprise inspector.

No production API calls, authentication changes, database migrations,
provider calls, writes, deploys, or changes to the existing default UI.
Keep all current interfaces untouched.

Use assistant-ui only behind a FactoryLM-owned adapter. Keep shared components
independent of Next.js, Capacitor, and any specific router. React peer
compatibility must cover the current Hub and mobile versions.

Deliver a runnable UI lab, screenshot matrix, interaction fixtures,
keyboard/mobile behavior tests, accessibility checks, performance
measurements, component/adapter map, exact salvage list, and draft PR.
Stop after the complete disconnected interface is reviewable.
```

## Durable shorthand

> One FactoryLM UI. One MIRA interaction contract. Projects organize the work. Machines and evidence remain canonical. Hub adds depth without becoming a different product.
