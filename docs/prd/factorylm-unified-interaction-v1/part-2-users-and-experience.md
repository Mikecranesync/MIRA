## 5. Users

### 5.1 Technician

Needs fast, one-handed help in poor lighting, high noise, intermittent connectivity, and time pressure. Wants answers, steps, sources, camera input, QR identification, work capture, and shift continuity.

### 5.2 Supervisor

Needs current work, evidence quality, handoffs, approvals, recurring problems, and review of findings without reading every raw conversation.

### 5.3 Reliability / controls / engineering user

Needs deeper machine context, signals, timelines, manuals, changes, evidence windows, comparisons, and reusable diagnostic runs.

### 5.4 Enterprise administrator

Needs tenant configuration, users, permissions, integrations, namespace, source governance, audit, usage, model policy, and evaluation.

### 5.5 Public visitor

Needs to understand FactoryLM by using a safe sample version of the real interface rather than being dropped into a conventional brochure site or empty workspace.

## 6. Uniform shell

The product has four persistent regions.

### 6.1 Left navigation

- FactoryLM identity and workspace switcher.
- **New chat**.
- Search.
- Recent conversations.
- Projects tree.
- Pinned machines or work.
- Scheduled/assigned work when enabled.
- Settings and user menu.

On mobile this becomes a drawer. The hierarchy, labels, order, and icons remain the same.

### 6.2 Center conversation

- Project/folder breadcrumb.
- Ask / Work mode switch.
- Current machine context chip.
- Conversation or structured work run.
- Inline messages, evidence, tools, plans, findings, and artifacts.
- Persistent composer.

### 6.3 Universal composer

The composer is the main entry point for:

- Text.
- Voice/dictation.
- Camera.
- Photo/gallery.
- File/PDF.
- QR/barcode scan.
- Machine selection.
- Recorded machine history.
- Web or approved workspace search.
- Start Work mode / create a diagnostic run.

The same composer component and state machine must be used everywhere.

### 6.4 Right inspector

The inspector is optional and responsive.

- On desktop/web it opens beside the conversation.
- In Hub it may remain pinned and expose enterprise tabs.
- On mobile it opens as a full-height sheet.

Inspector tabs:

- **Context:** selected project, folder, machine, identity, status, and evidence basis.
- **Files:** project, folder, machine, and thread attachments.
- **Activity:** runs, work orders, findings, handoffs, and recent events.
- **Enterprise:** namespace path, integrations, permissions, source provenance, audit, usage, and evaluation. Capability-gated.

## 7. Information architecture

### 7.1 Canonical hierarchy

```text
Workspace / tenant
└── Project
    ├── Project instructions and memory policy
    ├── Folder
    │   ├── Subfolder
    │   │   ├── Machine link
    │   │   ├── Conversation
    │   │   ├── Diagnostic run
    │   │   ├── File link
    │   │   ├── Finding
    │   │   └── Work item / artifact
    │   └── ...
    └── Project-level items
```

### 7.2 Recommended industrial examples

```text
Launch 2 Reliability
├── LSM Drive System
│   ├── Drive A
│   ├── Drive B
│   ├── Speed Sensor Chain
│   ├── G120 manuals
│   └── F30001 diagnostic runs
├── Brake System
└── 2026 recurring findings

Plant Utilities
├── Chilled Water
│   ├── Pump P-101
│   └── Pump P-102
└── Compressed Air

2026 Shutdown
├── Area 1
├── Area 2
└── Completion reports
```

### 7.3 Project semantics

A project is simultaneously:

- an organization container;
- a memory boundary;
- an instruction boundary;
- a sharing and permission boundary;
- a source/context boundary; and
- a durable home for multiple conversations and work runs.

A project is **not** the canonical owner of a machine, file, or work order.

### 7.4 Folder semantics

Folders are flexible organizational containers. They may represent an area, system, line, machine family, shutdown phase, problem class, or customer engagement.

Rules:

- Nested folders are allowed.
- The UI supports up to five visible levels before compacting the breadcrumb; the data model does not need a destructive hard limit.
- Folders inherit project instructions and project sources.
- Folder-specific sources and instructions may narrow context below them.
- Moving a folder updates organization only; it does not rewrite canonical asset paths or UNS paths.

### 7.5 Machine semantics

A machine shown in a project is a **link to the canonical asset**.

- One canonical asset may appear in multiple projects.
- The canonical asset retains its own identity, location, manuals, observations, history, and relationships.
- Project-specific conversations, hypotheses, plans, and findings remain project scoped until promoted.
- Deleting a project link does not delete the asset.
- Project folders do not replace the asset graph or UNS hierarchy.

### 7.6 Context inheritance

The interaction layer constructs context in this explicit order:

1. Current turn attachments and direct user selections.
2. Confirmed machine context.
3. Current conversation and diagnostic-run state.
4. Folder sources and instructions.
5. Project sources and instructions.
6. Workspace-approved knowledge.
7. General reasoning.

The UI must show a compact **Using context** summary and allow inspection. A lower-precedence layer may not override tenant, permission, machine identity, safety, or verified evidence from a higher-authority server rule.

### 7.7 Memory policy

Every project has one of these policies:

- **Project-only:** conversations use only project/folder/thread context plus explicitly approved workspace knowledge. Recommended default for industrial work.
- **Workspace-assisted:** the project may use approved memory and sources elsewhere in the same tenant.
- **Temporary:** no durable project memory; appropriate for public demo and sensitive one-off work.

Machine facts that cross projects must be verified or explicitly approved. Unverified conversation hypotheses never become global machine memory automatically.

## 8. Ask mode and Work mode

### 8.1 Ask mode

For quick help:

- General industrial questions.
- Machine-specific questions.
- Photo and nameplate interpretation.
- Manual and drawing lookup.
- Explanation of faults, components, and procedures.
- Follow-up conversation.

Ask mode may produce citations, tool cards, suggested checks, or a proposal to start Work mode.

### 8.2 Work mode

For structured multi-step maintenance:

- Troubleshooting.
- Commissioning.
- Root-cause investigation.
- Inspection.
- Repair planning.
- Shutdown work.
- Recurring fault analysis.
- Shift handoff.

A Work run contains:

- Goal.
- Safety scope.
- Confirmed machine(s).
- Evidence snapshot.
- Plan and completion criteria.
- Steps and status.
- Observations.
- Hypotheses.
- Tool calls/results.
- Decisions and approvals.
- Findings.
- Generated artifacts.
- Handoff history.

### 8.3 Diagnostic-run lifecycle

```text
Draft → Ready → Running → Waiting → Review → Completed
                       ↘ Blocked / Cancelled
```

- **Draft:** goal and context are being assembled.
- **Ready:** machine identity, safety scope, and initial plan are present.
- **Running:** checks are actively being performed.
- **Waiting:** user, part, permission, connection, or approval is required.
- **Review:** candidate findings and artifacts are ready for confirmation.
- **Completed:** completion criteria were met and results were saved.
- **Blocked/Cancelled:** reason remains durable and visible.

### 8.4 Promotion model

```text
Observation → Hypothesis → Proposed finding → Verified finding → Superseded
```

Only a permitted human or deterministic approved process may promote industrial knowledge. The model may propose; it may not self-certify.
