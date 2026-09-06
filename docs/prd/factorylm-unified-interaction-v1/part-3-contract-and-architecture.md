## 9. Canonical interaction contract

The existing Equipment Notebook typed stream is the strongest current seam and should be extended additively, not replaced by a second parallel chat backend.

### 9.1 Required top-level objects

```ts
InteractionThread {
  id
  tenantId
  projectId?
  folderId?
  notebookId
  primaryAssetId?
  title
  mode: "ask" | "work"
  ownerUserId?
  visibility
  createdAt
  updatedAt
}

InteractionRun {
  id
  threadId
  kind: "diagnostic" | "inspection" | "commissioning" | "handoff" | "report"
  status
  goal
  plan
  completionCriteria
  contextSnapshot
  startedAt?
  completedAt?
}

InteractionTurn {
  id
  threadId
  runId?
  role
  orderedParts[]
  lifecycle
  createdAt
  updatedAt
}
```

### 9.2 Required ordered part types

- `text`
- `attachment`
- `source`
- `evidence_basis`
- `machine_evidence`
- `visual_observation`
- `safety_notice`
- `tool_call`
- `tool_result`
- `approval_request`
- `plan`
- `plan_step`
- `observation`
- `hypothesis`
- `finding`
- `artifact`
- `context_change`
- `status`
- `usage`
- `error`
- `followups`

Unknown future parts must be preserved for inspection and must not crash the thread.

### 9.3 Lifecycle

At minimum:

`accepted`, `queued`, `running`, `waiting`, `stopping`, `completed`, `stopped`, `failed`, `cancelled`.

The server owns terminal state. The client renders optimistic feedback but reconciles with the authoritative stored turn/run after interruption.

### 9.4 Transport strategy

- Keep the current typed SSE contract for V1 connectivity.
- Add stable thread/turn/run IDs and lifecycle frames.
- Add tool, plan, approval, finding, and artifact frames only as real backend capabilities are connected.
- Use one parser and reducer in a shared package.
- Web, Hub, Android, and iOS must pass the same recorded-event fixture suite.
- Do not fabricate streaming on a buffered transport; render honest progress and authoritative completion.

## 10. Data model extension

This is the recommended additive target. It deliberately reuses the existing Equipment Notebook turns and canonical file-link architecture.

### 10.1 New tables

```text
workspace_projects
- id, tenant_id, name, description, icon, color
- instructions, memory_scope
- owner_user_id, visibility
- created_at, updated_at, archived_at

workspace_folders
- id, tenant_id, project_id, parent_folder_id
- name, description, sort_order
- created_at, updated_at, archived_at

workspace_project_items
- id, tenant_id, project_id, folder_id nullable
- item_type, item_id
- label override, sort_order, pinned
- created_by, created_at

interaction_threads
- id, tenant_id, project_id nullable, folder_id nullable
- notebook_id, primary_asset_id nullable
- title, mode, owner_user_id, visibility
- created_at, updated_at, archived_at

interaction_runs
- id, tenant_id, thread_id
- kind, status, goal
- plan jsonb, completion_criteria jsonb
- context_snapshot jsonb
- created_by, created_at, started_at, completed_at

project_findings
- id, tenant_id, project_id, folder_id nullable
- thread_id nullable, run_id nullable, asset_id nullable
- kind, statement, evidence jsonb
- status, proposed_by, verified_by
- created_at, verified_at, superseded_at
```

### 10.2 Existing-table changes

- Add nullable `thread_id` and `run_id` to `equipment_notebook_turns`.
- Backfill one legacy thread per existing Notebook.
- Keep the existing turn table as the durable message record during V1; do not create a second message store.
- Extend `workspace_file_links.target_type` to support project, folder, thread, run, and finding links.
- Preserve canonical file bytes and many-to-many attachments.

### 10.3 Item types

Initial `workspace_project_items.item_type` allowlist:

- `folder`
- `asset`
- `equipment_notebook`
- `interaction_thread`
- `interaction_run`
- `file`
- `finding`
- `work_order`
- `pm_schedule`
- `report`

The link table organizes references. Domain records remain in their authoritative tables.

### 10.4 Tenant and authorization rules

- Every project/folder/item/thread/run/finding row is tenant-scoped.
- Every relationship validates that both ends belong to the same tenant.
- Project membership controls visibility; item actions still require domain capabilities.
- UI capability gating is convenience only; server authorization is authoritative.
- Project deletion archives links first and never cascades into canonical machines, files, or work orders without an explicit separate action.

## 11. Frontend architecture

### 11.1 Shared packages

```text
packages/
  factorylm-theme/
    tokens.css
    typography.css
    motion.css
    icons.tsx

  mira-interaction/
    types.ts
    events.ts
    reducer.ts
    persistence.ts
    transport.ts
    fixtures/

  factorylm-shell/
    AppShell
    Sidebar
    ProjectTree
    ThreadHeader
    MessageList
    Composer
    Inspector
    SourceViewer

  factorylm-parts/
    Citation
    EvidenceBadge
    MachineChip
    SafetyNotice
    ToolCard
    PlanCard
    FindingCard
    ArtifactCard
```

### 11.2 Actual code sharing

Because Hub and mobile are both React-based, V2 should share real UI components wherever practical.

- Shared packages use React peer dependencies compatible with React 18 and 19 during migration.
- Components are client-side and avoid Next-only APIs.
- Hub wraps them in Next.js routes and server data loaders.
- Mobile wraps them in Vite/Capacitor device adapters.
- Public web serves the same shell in unauthenticated demo mode.
- Platform-specific camera, QR, file, voice, secure storage, and notification functions are injected through an adapter interface.

### 11.3 Public site strategy

The existing marketing server is not React-based. Build the new shell in parallel as a static React/Vite or Next client and serve it as the main public demo experience when approved.

Marketing content becomes secondary panels/routes around the product:

- What FactoryLM does.
- Industrial trust and safety.
- Example projects.
- Pricing.
- Enterprise.
- Sign in / create workspace.

The visitor should understand the product by seeing or using MIRA in a realistic sample project.

### 11.4 Same UI, capability profiles

```ts
SurfaceProfile = {
  publicDemo: boolean
  nativeDevice: boolean
  enterpriseInspector: boolean
  adminCapabilities: string[]
  offlineCapabilities: string[]
}
```

Profiles reveal features but may not redefine navigation, message parts, or component appearance.

## 12. Core user flows

### 12.1 Public visitor to signed-in continuity

1. Visitor opens `factorylm.com` and sees the real FactoryLM shell in demo mode.
2. A sample project and machine are already selected.
3. Visitor asks or chooses a sample maintenance question.
4. MIRA shows a realistic structured, cited answer.
5. Visitor selects **Use with my equipment**.
6. After sign-in, a personal project is created or selected.
7. The original question is restored; no blank-workspace reset.

### 12.2 Create project and organize machines

1. Select **New project**.
2. Name it `Launch 2 Reliability`.
3. Add folder `LSM Drive System`.
4. Link existing machine `Launch 2 Drive A`.
5. Add or link manuals, drawings, and prior work.
6. Start a conversation in that folder.
7. The breadcrumb and context chip show the exact project/folder/machine scope.

### 12.3 Start a machine conversation

1. Open project or scan a machine QR.
2. Select an existing thread or **New chat**.
3. Ask a question with text, photo, or voice.
4. MIRA uses project and machine context only after server validation.
5. The answer shows evidence basis, citations, and machine-time semantics.
6. The thread persists and appears identically on web, mobile, and Hub.

### 12.4 Convert chat into structured Work

1. MIRA suggests **Start diagnostic run** or the user changes Ask → Work.
2. The run freezes goal, machine identity, evidence, and safety scope.
3. MIRA proposes a plan.
4. Technician edits/approves the plan.
5. Each check accepts observations, photos, readings, and notes.
6. MIRA revises hypotheses as results arrive.
7. Candidate findings are reviewed.
8. The run creates a work order, report, handoff, or verified finding.

### 12.5 Shift handoff

1. Technician chooses **Handoff**.
2. FactoryLM generates a concise summary from authoritative run state.
3. Open steps, safety state, evidence, and blockers remain structured.
4. Next technician opens the same run on mobile or web.
5. The run continues without copying text into a new chat.

### 12.6 Enterprise inspection

1. Supervisor opens the same conversation in Hub.
2. The center thread is unchanged.
3. The right inspector exposes asset binding, project inheritance, sources, evidence windows, permissions, integration provenance, decision trace, and audit.
4. Supervisor approves or rejects findings without changing the technician's interaction model.
