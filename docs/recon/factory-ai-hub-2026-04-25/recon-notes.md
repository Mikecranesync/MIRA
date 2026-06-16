# Factory AI vs FactoryLM Hub Recon

Date: 2026-04-25
Method: Computer Use in the signed-in browser session, with local screenshots captured to `docs/recon/factory-ai-hub-2026-04-25/screenshots/`.

## Scope And Safety

- Factory AI app reviewed at `app.f7i.ai` while signed in.
- FactoryLM Hub reviewed at `app.factorylm.com/hub/*` while signed in.
- No records were submitted, deleted, acknowledged, dismissed, or saved.
- File upload flows were opened only far enough to inspect UI. No file was selected or uploaded.
- OAuth/connect buttons in FactoryLM Channels were not clicked because they would begin third-party authorization.
- Screenshots include live signed-in UI. A few contain account details; keep this folder internal.

## Executive Takeaways

Factory AI feels more polished because it behaves like a complete operating surface even when data is empty. Its core advantages are consistent tri-pane layout, a persistent right-side AI rail, dense table tooling, visible loading skeletons, stronger empty states, and complete creation flows that look production-ready.

FactoryLM Hub already has stronger domain-specific content: safety alerts, PMs, wrench time, work-order detail, MIRA diagnostic cards, channel-aware conversations, and a real maintenance feed. The main opportunity is to wrap that stronger substance in a more durable shell and close the broken routes.

Highest leverage work:

1. Fix Hub route reliability before visual polish.
2. Add a persistent MIRA rail or collapsible copilot panel.
3. Convert Hub modules to consistent list/detail or table/detail layouts.
4. Upgrade empty states so every module has filters, CTAs, and useful framing.
5. Normalize create flows: "Next", "Back", "Review", "Create", never ambiguous "Save" on step 1.
6. Add skeleton states and stronger table controls across Hub pages.
7. Seed demo data consistently across Assets, Usage, Event Log, Knowledge, and Work Orders.

## Factory AI Information Architecture

Factory AI uses a thin app shell:

- Top context bar: logo, organization selector (`Global`), product/workspace selector (`Prevent`), collapse/control icon, user avatar.
- Left icon rail: no text labels in the main nav, just compact icons with selected state.
- Main workspace: page-specific content, usually a list/table/detail area.
- Right AI rail: persistent chat/action surface across most modules.
- Bottom-left user/tier block and settings gear.

This gives the product a cockpit feel. The user always knows which workspace they are in, and the AI assistant never disappears.

Important screenshots:

- [01 Factory AI registry welcome](screenshots/01-factory-ai-registry-welcome.png)
- [02 Factory AI asset detail](screenshots/02-factory-ai-asset-detail.png)
- [03 Factory AI assets table](screenshots/03-factory-ai-assets-table.png)
- [23 Factory AI chat agent menu](screenshots/23-factory-ai-chat-agent-menu.png)

## Factory AI Visual System

Key traits:

- Dark-first interface with near-black page background, charcoal panels, thin borders, and white primary CTAs.
- Accent color is used sparingly. Green marks active states and system success; red only appears for alerts/overdue states.
- Typography is compact. Headings are strong but not huge inside app pages.
- Cards are low-radius, dense, and functional rather than decorative.
- Tables are highly scannable: checkboxes, sortable headings, status pills, search, filters, columns, import/export actions.
- Empty states still look finished. They include icons, concise copy, and a primary next action.
- Skeletons are used while loading, preventing layout shock.
- Modals dim the whole product and focus attention on a well-labeled form.

Screenshot references:

- [04 Factory AI filter popover](screenshots/04-factory-ai-filter-popover.png)
- [06 Factory AI work orders loading](screenshots/06-factory-ai-work-orders-list-loading.png)
- [07 Factory AI work orders empty](screenshots/07-factory-ai-work-orders-empty.png)
- [11 Factory AI inventory empty](screenshots/11-factory-ai-inventory-empty.png)
- [16 Factory AI purchasing reports loaded](screenshots/16-factory-ai-purchasing-reports-loaded.png)

## Factory AI Module Notes

### Registry And Assets

The Registry page uses a left asset tree/list, central detail area, and right AI rail. This is the strongest pattern to borrow for FactoryLM assets.

Asset detail includes:

- Asset title and model/manufacturer subtitle.
- QR action at the top.
- Asset metadata card.
- Telemetry/signals area.
- Documentation area.
- Tabs for Components, Failure Modes, Maintenance, Procedures, Photos, and Work Order History.

FactoryLM should treat asset detail as the anchor of the product, not only as a row in a list.

Screenshots:

- [02 Factory AI asset detail](screenshots/02-factory-ai-asset-detail.png)
- [03 Factory AI assets table](screenshots/03-factory-ai-assets-table.png)

### Work Orders

Factory AI work orders support multiple views: list, table, calendar, kanban, analytics. Even an empty state has:

- Search.
- Filters.
- Assignee controls.
- View toggles.
- Empty-state CTA.
- Creation modal with rich inputs.

The create modal has the polish FactoryLM should aim for: title, description, attachments, camera/library options, work instructions editor, type, estimated duration, priority, due date, asset, scheduled start, skills, and tools.

Screenshots:

- [07 Factory AI work orders empty](screenshots/07-factory-ai-work-orders-empty.png)
- [08 Factory AI work order modal](screenshots/08-factory-ai-work-order-modal.png)
- [09 Factory AI work order view mode](screenshots/09-factory-ai-work-orders-view-mode.png)

### Inventory And Purchasing

Inventory and purchasing show how Factory AI makes operational modules feel complete before there is data:

- Inventory has tabbed subareas: Inventory, Parts, Low Stock, Valuation, Vendors, Serials, Warranties.
- Purchasing has Purchase Orders and Reports tabs.
- Reports display KPI cards and empty report cards, not just a blank table.
- Creation flows use full-page forms for deeper procurement tasks.

Screenshots:

- [10 Factory AI inventory tabs](screenshots/10-factory-ai-inventory-tabs.png)
- [11 Factory AI inventory empty](screenshots/11-factory-ai-inventory-empty.png)
- [12 Factory AI add part modal](screenshots/12-factory-ai-inventory-add-part-modal.png)
- [13 Factory AI purchasing](screenshots/13-factory-ai-purchasing.png)
- [14 Factory AI create PO form](screenshots/14-factory-ai-create-purchase-order-form.png)
- [16 Factory AI purchasing reports loaded](screenshots/16-factory-ai-purchasing-reports-loaded.png)

### Knowledge Base

Factory AI Knowledge Base is sparse but crisp:

- Left sidebar with search, upload, refresh, Browse/Recent tabs.
- Center content area for selected file state.
- Upload opens native OS file picker directly.
- AI rail remains visible.

Screenshots:

- [17 Factory AI knowledge empty](screenshots/17-factory-ai-knowledge-base-empty.png)
- [18 Factory AI knowledge upload picker](screenshots/18-factory-ai-knowledge-upload-file-picker.png)

### Settings And User Menu

Factory AI settings are conventional and readable:

- Horizontal settings tabs.
- Disabled personal info fields.
- Display preference controls.
- Billing section.
- Notification settings with checkboxes.

The user menu includes docs, feedback, appearance switching, install app, settings, and sign out.

Screenshots:

- [19 Factory AI settings general](screenshots/19-factory-ai-settings-general.png)
- [20 Factory AI user menu](screenshots/20-factory-ai-user-menu.png)
- [21 Factory AI organization dropdown](screenshots/21-factory-ai-organization-dropdown.png)
- [22 Factory AI product dropdown](screenshots/22-factory-ai-product-dropdown.png)

### AI Rail And Trust Model

Factory AI's right rail is the most important differentiator:

- Persistent across modules.
- Top controls: History and New.
- Composer: message area, Agent/Ask mode, attach, dictate, send.
- Quick chips: Work Orders, Assets, Inventory, Reports, Schedule, Quick.
- Agent tour explains the safety model.

The tour explicitly separates:

- Agent mode: AI can create, update, delete records.
- Ask mode: information only, no changes.
- Review controls: Review, Keep All, Undo All.

This is directly relevant to MIRA. FactoryLM can use the same trust pattern around AI-created work orders, asset edits, diagnostic notes, and PM schedule updates.

Screenshots:

- [23 Factory AI chat agent menu](screenshots/23-factory-ai-chat-agent-menu.png)
- [24 Factory AI agent tour step 1](screenshots/24-factory-ai-agent-tour-step-1.png)
- [25 Factory AI agent tour step 2](screenshots/25-factory-ai-agent-tour-step-2.png)
- [26 Factory AI agent tour step 3](screenshots/26-factory-ai-agent-tour-step-3.png)
- [27 Factory AI agent tour step 4](screenshots/27-factory-ai-agent-tour-step-4.png)
- [28 Factory AI agent tour step 5](screenshots/28-factory-ai-agent-tour-step-5.png)

## FactoryLM Hub Current State

Hub has a text-labeled left sidebar and a dark app UI. It is more explicit than Factory AI's icon rail, which is good for early users, but it feels less spatially efficient.

Current top-level nav observed:

- Event Log
- Conversations
- Knowledge
- Assets
- Channels
- Usage

Other local routes exist in code and should be included in navigation or a "More" menu if they are meant to ship: actions, alerts, cmms, documents, integrations, parts, reports, requests, schedule, team, workorders.

### Hub Activity Feed

This is the strongest Hub concept. It has:

- KPI cards: open work orders, overdue PMs, downtime, wrench time.
- MIRA voice brief with audio/read actions.
- Safety alert cards.
- Work-order status cards.
- MIRA diagnostic alert cards.
- PM due cards.
- Floating action menu for New Work Order, Scan QR Code, New Request, New Asset.

Compared to Factory AI, the feed has more industrial specificity and more operational story. It should become the "morning command center" for the app.

Issues:

- The right side of the viewport is underused on many pages.
- No persistent MIRA rail.
- Action buttons like Mark as read, Dismiss, Acknowledge, and Defer are numerous and close together; stronger grouping would reduce accidental clicks.
- "Show more" works and adds useful content, but the expanded text block could use better hierarchy.

Screenshots:

- [29 FactoryLM Hub feed](screenshots/29-factorylm-hub-feed.png)
- [38 FactoryLM Hub expanded feed card](screenshots/38-factorylm-hub-feed-expanded-card.png)
- [39 FactoryLM Hub floating action menu](screenshots/39-factorylm-hub-floating-action-menu.png)

### Hub Event Log

Event Log has a clean table skeleton and useful columns: Time, Event, Channel, Action, Confidence, Sync.

Issue:

- Empty state is too quiet compared with Factory AI. Add a better CTA and filters, for example "Connect Telegram", "Send test event", or "View channel setup".

Screenshot:

- [30 FactoryLM Hub event log](screenshots/30-factorylm-hub-event-log.png)

### Hub Conversations

Conversation list is strong:

- Channel badges are visible.
- Thread rows are dense and clear.
- Read-only conversation detail panel is a good pattern.
- It correctly says replies happen in the source channel.

Opportunity:

- Use Factory AI's split layout more deliberately: list on the left, detail on the right, with the right panel always reserved instead of only appearing after click.
- Add filters for Telegram, Slack, email, web, asset, unread.
- Add a MIRA summary strip for each thread: last diagnosis, linked asset, confidence, next action.

Screenshots:

- [31 FactoryLM Hub conversations](screenshots/31-factorylm-hub-conversations.png)
- [32 FactoryLM Hub conversation detail](screenshots/32-factorylm-hub-conversation-detail.png)

### Hub Knowledge

Knowledge has good primitives:

- Search.
- Upload button.
- Indexed/chunks counters.
- Upload modal with drag/drop and connected sources.

Compared with Factory AI, this modal is stronger because it explains accepted file types and includes connected sources. The page itself should feel more complete when empty.

Issues:

- Empty state should include "Upload manuals", "Connect Google Workspace", and "Try a sample manual" actions.
- Google Drive appears disabled until a channel is connected. That is good, but the disabled reason could be shown in the modal UI, not only as a tooltip/help attribute.

Screenshots:

- [33 FactoryLM Hub knowledge empty](screenshots/33-factorylm-hub-knowledge-empty.png)
- [34 FactoryLM Hub knowledge upload modal](screenshots/34-factorylm-hub-knowledge-upload-modal.png)

### Hub Channels

Channels is one of the better Hub pages:

- It clearly separates communication channels and document/knowledge sources.
- It explains each integration in maintenance terms.
- Disabled integrations show configuration reasons through accessibility help text.

Opportunities:

- Factory AI uses more compact cards, but Hub's descriptions are more helpful. Keep the descriptions, reduce visual bulk.
- Add connection status chips and "last sync" once connected.
- Keep OAuth/connect actions protected by confirmation or review screens.

Screenshot:

- [36 FactoryLM Hub channels](screenshots/36-factorylm-hub-channels.png)

### Hub Work Orders

Work Orders are already meaningful:

- Status tabs with counts.
- Search.
- Rich work-order cards.
- Detail view has timer, asset link, MIRA conversation link, CMMS link, instructions, photos, parts, comments.

Factory AI's advantage is layout polish and view flexibility. FactoryLM has better work-order content.

Issues:

- List page uses only the left/center column while the right side is blank. Convert to list/detail split or full-width table.
- Detail page could benefit from a right rail for activity, AI suggestions, linked parts, and safety notes.
- Timer and Start Work are useful but are state-changing; they should be clearly separated from read-only content.
- "New Work Order" step 1 uses the button label "Save" even though the stepper says there are 3 steps. This should be "Next" until final review.
- Selecting an asset turns the asset row very light, which clashes with the dark theme.

Screenshots:

- [40 FactoryLM Hub workorders list](screenshots/40-factorylm-hub-workorders-list.png)
- [41 FactoryLM Hub workorder detail](screenshots/41-factorylm-hub-workorder-detail.png)
- [42 FactoryLM Hub new workorder step 1](screenshots/42-factorylm-hub-new-workorder-step-1.png)

### Hub Broken Or Blocked Paths

Observed during live recon:

- `Assets` nav bounced from a signed-in page to `/hub/login?callbackUrl=/hub/assets`.
- Direct `Usage` nav failed with the browser error "This page couldn't load"; reload did not recover.
- Earlier live checks found `/hub` vs `/hub/` redirect inconsistency.
- FactoryLM still allows return to `/hub/feed` after the Assets auth bounce, which suggests route-level auth or render behavior rather than full session loss.

Screenshots:

- [35 FactoryLM Hub assets auth bounce](screenshots/35-factorylm-hub-assets-auth-bounce.png)
- [37 FactoryLM Hub usage load error](screenshots/37-factorylm-hub-usage-load-error.png)

## Direct Comparison

Factory AI strengths to borrow:

- Persistent AI rail.
- Icon rail plus workspace/product selectors.
- Table toolbars with search, filters, sort, columns, import/export.
- Rich empty states.
- Multi-view work orders.
- Skeleton loading.
- Strong modal/form hierarchy.
- Agent vs Ask trust model.
- Review/Keep/Undo controls for AI mutations.
- More consistent "every page is finished" feeling.

FactoryLM strengths to preserve:

- More concrete industrial narrative.
- Better maintenance-specific feed.
- Channel-aware conversations.
- Safety alert surface.
- Work-order detail depth.
- MIRA diagnostic and confidence language.
- Knowledge upload with connected-source framing.
- Integration/channel strategy.

FactoryLM weaknesses to fix:

- Route reliability.
- Inconsistent module completeness.
- Wasted horizontal space.
- No persistent MIRA rail.
- Some pages are too sparse when empty.
- Floating action menu is useful but isolated from module context.
- Create flow copy is ambiguous.
- Visual system is close, but less refined: spacing, cards, and selected states need tightening.

## Bootstrap Plan For FactoryLM Hub Polish

### 1. Stabilize Routes First

Fix before design work:

- `/hub/assets` auth bounce.
- `/hub/usage` load failure.
- `/hub` and `/hub/` redirect consistency.
- Ensure nav routes, feed links, and floating action links all preserve session state.

### 2. Build A Hub App Shell

Target:

- Collapsible left nav.
- Optional compact icon-only mode on desktop.
- Top page header with title, status, refresh, primary action.
- Persistent right MIRA rail, collapsible to an icon.
- Main content with consistent max widths and split layouts.

Use the current sidebar labels initially, but add a compact mode later. Factory AI's icon-only rail is polished, but FactoryLM may need labels until user onboarding improves.

### 3. Add MIRA Rail

Right rail should include:

- Ask/Agent segmented mode.
- Message composer.
- Context chips: Work Orders, Assets, Knowledge, Events, PM Schedule.
- Attach file.
- Voice input when safe.
- "Changes pending" review panel when MIRA proposes edits.
- Review, Keep All, Undo All trust pattern.

This should start read-only by default. Agent mode should be opt-in per session.

### 4. Rework Assets Around Registry Pattern

Adopt Factory AI's asset pattern:

- Asset table view with columns and filters.
- Asset tree/list for sites/areas/equipment.
- Detail page with tabs: Overview, Procedures, Documents, Failure Modes, Work Orders, Photos, Telemetry.
- QR action visible on every asset.
- Linked MIRA diagnostics and recent conversations.

### 5. Upgrade Work Orders

Near-term:

- Rename "Save" on step 1 to "Next".
- Add "Cancel" and "Back to Work Orders".
- Convert list to table/detail split or full-width table.
- Add views: List, Table, Calendar, Kanban, Analytics.
- Add filters: status, priority, assignee, asset, due date.

Medium-term:

- Add work-order creation modal variant for quick creation.
- Add full-page creation wizard for technician flows.
- Add AI-generated work instructions with review/accept controls.

### 6. Make Empty States Productive

Use this rule: every empty state should answer "what is this, why empty, what can I do next?"

Examples:

- Event Log: Connect channel, send test event, view setup docs.
- Knowledge: Upload manual, connect Drive, import sample.
- Usage: show skeleton/KPI framework even when no billing data.
- Assets: import CSV, scan QR, create asset, view sample asset.

### 7. Normalize Tables And Controls

Create shared components:

- `ModuleHeader`
- `StatusBadge`
- `MetricCard`
- `EmptyState`
- `DataToolbar`
- `FilterPopover`
- `ViewModeToggle`
- `LoadingSkeleton`
- `CreateWizard`
- `RightMiraRail`

### 8. Polish Visual Tokens

Suggested direction:

- Keep dark industrial theme.
- Reduce blue dominance. Use blue for primary actions, red for hazards, amber for overdue, green for healthy/completed.
- Make cards slightly denser.
- Keep radius 8px or less for operational surfaces.
- Use consistent border color and selected states.
- Avoid light selected rows inside dark pages unless intentionally high-contrast.

## Recommended First Implementation Slice

Best first slice:

1. Fix `/hub/assets` and `/hub/usage` route failures.
2. Add `RightMiraRail` as a non-functional/collapsed-by-default shell on Feed, Work Orders, Knowledge, and Conversations.
3. Add shared `EmptyState`, `DataToolbar`, and `MetricCard`.
4. Rework Work Orders list to either full-width table or split list/detail.
5. Rename New Work Order step labels and button copy.

This gives immediate polish without changing core data models or risky AI behavior.

## Screenshot Index

Factory AI:

- `01-factory-ai-registry-welcome.png`
- `02-factory-ai-asset-detail.png`
- `03-factory-ai-assets-table.png`
- `04-factory-ai-filter-popover.png`
- `05-factory-ai-component-templates.png`
- `06-factory-ai-work-orders-list-loading.png`
- `07-factory-ai-work-orders-empty.png`
- `08-factory-ai-work-order-modal.png`
- `09-factory-ai-work-orders-view-mode.png`
- `10-factory-ai-inventory-tabs.png`
- `11-factory-ai-inventory-empty.png`
- `12-factory-ai-inventory-add-part-modal.png`
- `13-factory-ai-purchasing.png`
- `14-factory-ai-create-purchase-order-form.png`
- `15-factory-ai-purchasing-reports-skeleton.png`
- `16-factory-ai-purchasing-reports-loaded.png`
- `17-factory-ai-knowledge-base-empty.png`
- `18-factory-ai-knowledge-upload-file-picker.png`
- `19-factory-ai-settings-general.png`
- `20-factory-ai-user-menu.png`
- `21-factory-ai-organization-dropdown.png`
- `22-factory-ai-product-dropdown.png`
- `23-factory-ai-chat-agent-menu.png`
- `24-factory-ai-agent-tour-step-1.png`
- `25-factory-ai-agent-tour-step-2.png`
- `26-factory-ai-agent-tour-step-3.png`
- `27-factory-ai-agent-tour-step-4.png`
- `28-factory-ai-agent-tour-step-5.png`

FactoryLM Hub:

- `29-factorylm-hub-feed.png`
- `30-factorylm-hub-event-log.png`
- `31-factorylm-hub-conversations.png`
- `32-factorylm-hub-conversation-detail.png`
- `33-factorylm-hub-knowledge-empty.png`
- `34-factorylm-hub-knowledge-upload-modal.png`
- `35-factorylm-hub-assets-auth-bounce.png`
- `36-factorylm-hub-channels.png`
- `37-factorylm-hub-usage-load-error.png`
- `38-factorylm-hub-feed-expanded-card.png`
- `39-factorylm-hub-floating-action-menu.png`
- `40-factorylm-hub-workorders-list.png`
- `41-factorylm-hub-workorder-detail.png`
- `42-factorylm-hub-new-workorder-step-1.png`
