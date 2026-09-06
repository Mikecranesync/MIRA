## 18. Analytics and success metrics

### Activation

- Time from first open to first useful answer.
- Public demo → account conversion.
- New workspace → first linked machine.
- New project → first resumed conversation.

### Utility

- Weekly active technicians.
- Conversations resumed across devices.
- Questions that become structured Work runs.
- Runs that produce a saved finding, handoff, work order, or report.
- Verified correct answers per day.
- Citation/source-open rate.
- Repeat use per machine/project.

### Quality

- Unsupported machine-specific claim rate.
- Incorrect identity-binding rate.
- Safety rendering/persistence parity.
- Provider/error truthfulness after reload.
- Cross-surface fixture parity.
- Task completion success in outside-in human testing.

## 19. Acceptance criteria

### Visual and interaction approval

1. Mobile, web, and Hub clearly look like the same product.
2. Same project tree, composer, messages, evidence cards, plan cards, and source viewer are used.
3. Hub does not revert to a separate dashboard IA.
4. A first-time user can identify New chat, Projects, current machine, sources, and Work mode without instruction.
5. The preview works at 390×844, 768×1024, 1440×900, and ≥1720 px.

### Project organization

6. Create a project and nested folder.
7. Link a canonical machine without duplicating it.
8. Place multiple conversations/files/runs under the folder.
9. Move a link without changing the machine's canonical asset or UNS location.
10. Inspect inherited project/folder/machine context.

### Golden Conversation

11. Same account and thread opens on mobile, web, and Hub.
12. Same user turn, MIRA content, citations, safety, machine evidence, usage, and status render from one event stream.
13. Reload produces the same truth as the live turn.
14. General questions work without sources or machine identity.
15. Machine-specific claims fail closed when identity or evidence is not confirmed.

### Structured Work

16. Convert a conversation to a diagnostic run.
17. Review/edit a plan before executing checks.
18. Record observations without promoting them to verified knowledge.
19. Promote a supported finding through explicit review.
20. Hand off the same run to another user/device.

### Performance and quality

21. Performance budgets pass.
22. Accessibility audit passes.
23. Zero client-manufactured tool success/citations/final state.
24. Old UI remains available as rollback until the cutover gate is complete.
25. No production disconnect occurs solely because the template looks finished.

## 20. Decisions locked by this PRD

- Build a new disconnected V2 design lab first.
- Keep all existing production experiences operational during design and connection.
- Use one shared UI shell across public web, signed-in web, Hub, Android, and iOS.
- Hub receives the same redesign; enterprise complexity is exposed through capability-gated inspectors and routes.
- Projects and folders organize links; they do not own or duplicate canonical machines.
- The existing Equipment Notebook and typed stream remain the first backend seam.
- The existing canonical file plus many-link model is extended.
- Ask and Work share one conversation interface.
- Work runs are isolated snapshots whose findings require review before promotion.
- No new generic OT write capability.

## 21. Open product decisions

These do not block the disconnected V1 preview:

1. Whether the signed-in everyday web route remains only on `app.factorylm.com` or also appears at `factorylm.com/app`.
2. Default project created for existing users: `My maintenance` versus `Unfiled`.
3. Whether project-level instructions are editable by technicians or only project editors.
4. Maximum folder depth enforced by product policy, if any.
5. Default sharing model for technician-created projects.
6. Whether Work mode initially supports only diagnostic runs or also inspection/commissioning templates.
7. When to align Hub and mobile React versions versus supporting both from shared peer-compatible packages.

## 22. Repository mapping

### Reuse

- `mira-hub` authentication, tenant context, capabilities, APIs, and enterprise services.
- `equipment_notebooks` as machine-context containers.
- `equipment_notebook_turns` as the initial durable turn store.
- Typed Notebook SSE frames for content, sources, evidence, safety, usage, and follow-ups.
- `workspace_file_links` for canonical file reuse and many-to-many attachments.
- Existing mobile auth, deep links, QR, offline queue, camera/file flows, assets, schedules, and Notebook chat.
- Existing server-owned evidence, safety, retrieval, and provider routing.

### Connect

- Hub source-free general MIRA behavior.
- One shared interaction reducer/parser.
- Project and folder organization.
- Multiple threads within a machine/project.
- Cross-device thread continuity proof.
- Existing Work/CMMS/assets/files/history capabilities as inline cards and tools.

### Repair before broad rollout

- Notebook ownership proof before all early writes/responses.
- Confirmed machine binding for machine-specific evidence.
- Live versus reloaded error/safety/evidence parity.
- Device streaming/stop behavior or honest buffered fallback.
- Current Hub/mobile navigation drift.

### Retire later

- Duplicate chat parsers and renderer semantics.
- Separate mobile versus Hub navigation vocabularies.
- Old customer-facing chat routes once the canonical path is fully proven.
- Dashboard-first Hub shell after enterprise parity is complete.

## 23. Research and repository references

### Official OpenAI product references

- Projects in ChatGPT: https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt
- ChatGPT Work and Codex: https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- Codex worktrees: https://learn.chatgpt.com/docs/environments/git-worktrees
- Codex long-horizon task architecture: https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
- ChatGPT/Codex feature overview: https://learn.chatgpt.com/docs/features

### FactoryLM/MIRA repository references

- `NORTH_STAR.md`
- `docs/prd/2026-08-30-chatgpt-class-ui-prd.md` on PR #3514
- `docs/architecture/convergence/GATE0_SUMMARY.md` on PR #3596
- `mira-hub/src/lib/notebook-chat-types.ts`
- `mira-hub/db/migrations/073_equipment_notebooks.sql`
- `mira-hub/db/migrations/075_workspace_file_links.sql`
- `mira-mobile/src/App.tsx`
- `mira-mobile/src/nav.ts`
- `mira-hub/src/components/layout/sidebar.tsx`
- `mira-hub/src/components/layout/bottom-tabs.tsx`
- `mira-mobile/package.json`
- `mira-hub/package.json`
- `mira-web/package.json`
