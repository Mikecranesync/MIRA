## 13. V1 disconnected preview scope

The first preview is deliberately fake-data-only.

### Included

- Shared desktop/mobile/Hub shell.
- Projects and nested folders.
- Linked machines, chats, files, and work runs.
- Ask / Work mode switch.
- Example industrial conversation.
- Evidence and safety components.
- Diagnostic plan card.
- Source viewer.
- Right context/enterprise inspector.
- Composer and add menu.
- Responsive mobile drawer/sheet behavior.
- Light/dark appearance.
- Simple mock send behavior.

### Excluded

- Authentication.
- Production APIs.
- Database migrations.
- Real provider calls.
- Real uploads.
- CMMS writes.
- Live telemetry.
- Deployment.
- Replacement of current routes.

The preview exists to settle the shell, hierarchy, naming, density, and interaction model before backend work begins.

## 14. Connection and migration plan

### Phase 0 — Visual design lab

- Create the disconnected preview.
- Iterate until Mike explicitly approves mobile, web, and Hub views.
- Freeze tokens, navigation, component vocabulary, and key flows.
- No production code path changes.

### Phase 1 — Shared foundation

- Create shared theme, interaction types/reducer, and shell packages.
- Build fixture-driven component stories for all message parts and failure states.
- Add responsive screenshots at phone, tablet, desktop, and wide Hub sizes.
- Keep the new shell hidden behind a development-only route/flag.

### Phase 2 — Golden Conversation adapter

Connect only:

`sign in → open/create project → open/create thread → ask general question → attach machine/manual/photo → cited answer → save/reload → open same thread on another surface`

Use existing Hub session, Equipment Notebook route, turn persistence, evidence rules, safety, and provider routing. Repair current trust gaps before broad feature migration.

### Phase 3 — Projects, folders, and multiple threads

- Add the additive project/folder/link/thread tables.
- Backfill existing Notebooks into a default project or Unfiled section.
- Preserve current Notebook IDs and turns.
- Enable drag/move/link without duplicating machines or files.

### Phase 4 — Structured Work

- Add diagnostic runs, plans, observations, findings, artifacts, and handoff.
- Connect existing work orders, schedules, machine memory, and file links.
- Keep all side effects permissioned, idempotent, auditable, and user-confirmed.

### Phase 5 — Enterprise inspector

- Move current Hub capabilities behind the same shell.
- Add namespace, signals, integrations, team, permissions, audit, usage, and evaluation inspector routes.
- Retire duplicate navigation and presentation only after parity is proven.

### Phase 6 — Controlled cutover

- New shell becomes opt-in on staging.
- Internal dogfood and outside-in human testing.
- New shell becomes production default behind instant rollback.
- Old UI remains briefly accessible for recovery.
- Delete old presentation code only after a measured stability window.

## 15. Performance requirements

### Shared shell

- Initial route JavaScript target: ≤ 300 KB compressed for the ordinary conversation route.
- LCP p75 on mobile 4G: ≤ 2.5 s.
- CLS: < 0.1.
- Composer keystroke response: < 50 ms p95 on target phones.
- Navigation/project expansion response: < 100 ms perceived.
- First visual stream update: within 100 ms of receiving a content frame.
- Large project trees use virtualization or incremental loading.
- Opening sources or inspector must not reset thread scroll.

### Mobile

- 44 × 44 px minimum interactive targets.
- Safe areas and keyboard respected.
- Background/foreground and process death reconcile from authoritative state.
- Cached project tree, recent threads, machine identity, and recent sources remain readable offline where policy permits.

## 16. Accessibility

- WCAG 2.2 AA target.
- Full keyboard operation on web/Hub.
- Screen-reader announcements for streaming, progress, tool state, safety, and completion.
- Visible focus.
- Reduced motion.
- Text zoom without clipped controls.
- Color never carries evidence/safety/status meaning alone.
- Mobile drawer, sheets, source viewer, and modal focus are trapped and restored correctly.

## 17. Industrial safety and trust

- Safety STOP is a first-class part attached to the exact turn/run.
- General advice is visibly distinct from OEM or machine evidence.
- Live and recorded evidence cannot share ambiguous labels.
- Every machine-specific claim has a citation, evidence reference, or explicit inference label.
- Source location and provenance remain inspectable.
- Tool state distinguishes requested, running, completed, refused, cancelled, and failed.
- The model cannot claim a work order, upload, approval, or tool action succeeded without authoritative confirmation.
- No control write path is introduced by this UI initiative.
