# FactoryLM ChatGPT Parity Contract

**Status:** ACTIVE product/UX north star  
**Date:** 2026-09-12  
**Scope:** FactoryLM/MIRA shared conversation UI across mobile and web  
**Related governance:** `UNIFIED_UI_CUTOVER.md`  
**Related product architecture:** `wiki/architecture/chatgpt-first-maintenance-genie.md`  
**Current implementation lane at time of writing:** draft PR #3757

---

## 1. Purpose

FactoryLM should feel immediately familiar to anyone who already knows how to use ChatGPT.

The target is not to copy OpenAI branding or proprietary implementation. The target is to match the **interaction grammar, information hierarchy, visual simplicity, and conversation-first mental model** closely enough that a technician does not need to learn a new application before asking for help.

The product should behave like **ChatGPT for industrial technicians**:

- Conversation is the primary experience.
- New Chat creates a new independent conversation.
- Projects organize work.
- Threads are conversation/work history.
- Machines/equipment belong inside the project/context model rather than competing with Projects as a separate top-level product.
- Manuals, photos, files, sensor readings, notebooks, citations, work history, and other evidence support the conversation underneath it.
- Industrial tools are exposed through familiar, low-clutter controls rather than permanent panels and mode selectors.
- Backend architecture must remain invisible to the technician unless it directly helps them make a maintenance decision.

A useful shorthand is:

> **ChatGPT interaction model + FactoryLM industrial context and evidence.**

---

## 2. What “98% like ChatGPT” means

“98%” is a product-direction target, not a pixel-perfect numerical measurement.

It means the normal technician workflow should have the same obvious structure and behavior:

1. Open the app.
2. See a quiet conversation canvas.
3. Start a new chat without first selecting a machine.
4. Type a question in a simple composer.
5. Receive a readable streamed answer.
6. Open the sidebar to find Projects and recent conversations.
7. Switch conversations and return without losing context.
8. Add photos/files/tools through the `+` affordance.
9. Use industrial evidence when needed without leaving the conversation-first mental model.

The approximately 2% that should be uniquely FactoryLM is:

- FactoryLM/MIRA branding.
- Projects representing equipment, lines, areas, jobs, or maintenance work.
- Industrial tools such as camera, QR/nameplate scan, manuals, sensor data, and work-order actions.
- Evidence/citation behavior appropriate for maintenance and safety.
- Machine context and plant history available underneath the conversation.

If an ordinary technician can tell that the application was designed around notebooks, reducers, adapters, modes, backend entities, or implementation history, the UI has leaked architecture and has missed this target.

---

## 3. Canonical product model

The product hierarchy is:

```text
FactoryLM
├── New Chat
├── Search
├── Projects
│   ├── Project / equipment context
│   │   ├── Thread
│   │   ├── Thread
│   │   └── supporting evidence
│   └── Project
└── Recent conversations
```

Supporting industrial data can include:

```text
manuals
photos
files
machine identity
sensor readings
maintenance history
notebook/retrieval data
citations
work orders
CMMS records
```

Those are **context and evidence**, not separate competing primary products.

The user-facing mental model should remain:

> **I am talking to MIRA about my work.**

Not:

> **I need to decide which FactoryLM subsystem or mode I am in before I can ask a question.**

---

## 4. Current direction from #3757

PR #3757 moves in the correct direction because it removes UI concepts that made the canonical shell feel unlike ChatGPT while preserving the proven backend behavior.

The important changes are:

- Composer reduced toward `+ / input / send`.
- Disabled voice stub and permanent machine-picker chip removed from the primary composer row.
- Always-visible Ask/Work mode toggle removed from the conversation surface.
- Status chip removed from the normal conversation bar.
- Sidebar reorganized toward New Chat, Search, Projects, and Recent.
- Competing top-level Machines section removed.
- First-run/home presentation simplified by removing default suggestion clutter.
- Existing reducer, send path, thread model, notebook transport, citations, adapters, and backend capability seams remain authoritative.

This is the correct architecture: **change presentation around the existing proven capability seams rather than create another parallel application.**

However, #3757 should be treated as a first parity slice, not proof that ChatGPT parity is complete.

---

## 5. Remaining parity gaps

Future work should close explicit gaps rather than producing more vaguely named UI generations.

### Gap 1 — New Chat and thread identity

**Target behavior:** New Chat must create a genuinely distinct conversation with its own durable server thread identity.

Acceptance:

- From any state, choose New Chat.
- The visible conversation is blank except for intentional first-run content.
- Send one question.
- A distinct server thread ID is created.
- Only the turns belonging to that new conversation appear.
- The new thread appears in Recent and/or its Project location.
- Open another conversation.
- Reopen the exact new thread row.
- The original question and answer restore intact.
- No turns from an older notebook/legacy thread leak into the new chat.

This is foundational. A UI that looks like ChatGPT but appends New Chat messages to an old server thread is not ChatGPT-like behavior.

### Gap 2 — Sidebar interaction parity

The sidebar must become a predictable conversation organizer rather than an equipment navigation dashboard.

Target behaviors:

- New Chat is prominent and immediate.
- Search behaves as conversation/history search.
- Projects are the primary organizational containers.
- Threads are visible beneath or within Projects where appropriate.
- Recent conversations remain easy to reach.
- Selected-thread state is obvious but visually quiet.
- Mobile uses a natural slide-out/drawer behavior.
- Selecting a conversation on mobile closes the drawer naturally.
- Rename/archive/delete actions use compact contextual controls rather than permanent clutter.
- Conversation titles are useful and stable.

Machines may appear inside a Project or context path, but a second top-level Machines product should not compete with Projects.

### Gap 3 — Composer parity

The default composer should be visually and behaviorally boring in the best sense: obvious, familiar, and low-friction.

Target behaviors:

- `+` for secondary inputs/tools.
- Single primary text field.
- Send action.
- Stop action while generating when supported.
- Natural multiline growth.
- Correct keyboard/safe-area behavior on Android/iOS.
- Composer remains reachable when long content is on screen.
- No permanent machine selector, mode picker, sensor dashboard, notebook picker, or industrial toolbar in the primary row.
- Attachments/context appear as compact chips/cards only when present.

### Gap 4 — Conversation canvas and visual parity

Architecture alone will not make the product feel like ChatGPT. The conversation canvas needs deliberate visual and interaction tuning.

The implementation should compare and tune:

- content width;
- header height;
- typography scale and weight;
- paragraph spacing;
- list spacing;
- markdown rendering;
- tables;
- code blocks;
- message spacing;
- streaming behavior;
- scroll anchoring;
- jump-to-latest behavior;
- loading states;
- error/retry presentation;
- composer width and elevation;
- mobile safe areas;
- keyboard transitions;
- sidebar width;
- icon size/weight;
- hover, pressed, focus, and selected states.

Do not claim “ChatGPT-like” based only on component names or architecture. Prove the visible result with side-by-side evidence.

### Gap 5 — Projects parity

A FactoryLM Project should behave conceptually like a ChatGPT Project while carrying industrial context.

Opening a Project should primarily expose conversations, not send the technician into a separate notebook application.

A Project may bind or contain:

- a machine or group of machines;
- manuals;
- photos;
- files;
- sensor history;
- prior work;
- technician notes;
- retrieval sources;
- work-order context;
- conversation threads.

The technician should still experience the Project as **a place to talk to MIRA with richer context**, not as a database browser.

### Gap 6 — Industrial tools through familiar controls

Industrial capabilities should extend the ChatGPT interaction model rather than replace it.

Default entry point: the composer `+` menu.

Examples:

```text
Take photo
Upload photo or file
Scan machine / QR / nameplate
Attach manual
Add sensor reading
Attach work context
```

After selection, the item should appear as a compact attachment/context element and become available to MIRA.

Avoid permanent rows of industrial action buttons unless evidence from technicians proves a specific action deserves permanent placement.

### Gap 7 — Evidence and citations without breaking flow

FactoryLM has a reason to be more evidence-oriented than a generic chatbot. That advantage should remain, but evidence presentation must not overwhelm normal conversation.

Target behavior:

- Answers read normally first.
- Citations are compact and tappable.
- Tapping a citation opens the supporting passage/source cleanly.
- Safety/evidence warnings appear only when material.
- Source inspection is a secondary layer, not the default screen.
- The user can return to the exact conversation state immediately.

### Gap 8 — One product surface

The end state must not require users or developers to choose among V2, V6, V7, Unified, Classic, Notebook Chat, or another parallel presentation tree.

The convergence path is:

1. Prove canonical golden conversation behavior.
2. Close the parity gaps above incrementally.
3. Prove Projects, attachments, citations, camera, and industrial context on the canonical shell.
4. Make the unified/shared shell the normal product entry point.
5. Remove ordinary user-facing UI selectors between generations.
6. Retire branch-only/parallel shells such as `V6Root` rather than continuing to add features to them.
7. Keep legacy UI only as a controlled rollback/recovery path until the cutover charter allows removal.
8. Retire the old multi-tab presentation after measured parity and rollback requirements pass.

Do not solve a parity gap by creating another root shell.

---

## 6. Delivery sequence

Stop naming normal parity work as successive product generations unless there is a real architectural reason.

Drive execution by the gap being closed.

Recommended order:

### Slice A — New Chat parity

Prove independent thread creation, persistence, history entry, and exact-thread reopen.

### Slice B — Sidebar parity

Finish mobile drawer behavior, Projects hierarchy, Recent, selection state, and conversation navigation.

### Slice C — Composer parity

Tune sizing, multiline behavior, keyboard handling, `+`, send/stop, and attachment presentation.

### Slice D — Conversation parity

Tune typography, spacing, markdown, citations, streaming, scrolling, retries, and long-answer behavior.

### Slice E — Projects parity

Ensure Projects organize context and conversations like ChatGPT Projects rather than acting as renamed notebooks.

### Slice F — Industrial tools

Expose camera, files, QR/nameplate, manuals, sensor data, and related tools primarily through the `+` flow and compact context surfaces.

### Slice G — Cross-surface parity

Prove the same interaction grammar on supported mobile and web hosts using the shared shell/adapters rather than separate feature implementations.

### Slice H — Cutover and retirement

Make the shared shell the standard surface, remove normal UI generation selectors, and retire duplicate presentation paths under the cutover charter.

---

## 7. Evidence required for each slice

Every parity slice should produce evidence, not just code.

Minimum evidence packet:

1. Exact branch/head SHA.
2. Gap/section from this document being closed.
3. Before state.
4. After state.
5. Focused tests for behavior changed.
6. Build/typecheck result where relevant.
7. Real-host or device proof when the behavior depends on integration.
8. Screenshots or recordings for visible interaction changes.
9. Explicit list of what remains unverified.
10. Confirmation that no new parallel store, thread model, stream parser, evidence system, or root UI was created.

For visual parity work, include a **side-by-side comparison matrix** instead of using phrases such as “more ChatGPT-like” without proof.

Suggested matrix:

| Area | Reference behavior | FactoryLM behavior | Status | Evidence |
|---|---|---|---|---|
| New Chat | Fresh independent thread | | PASS/FAIL/UNVERIFIED | |
| Sidebar | Projects + recent history | | | |
| Composer | `+ / input / send` | | | |
| Mobile drawer | Natural open/select/close | | | |
| Conversation | Comparable width/spacing/markdown | | | |
| Streaming | Stable incremental answer | | | |
| Reopen | Exact thread restored | | | |
| Attachments | Secondary through `+` | | | |
| Citations | Compact source access | | | |

No parity claim should be upgraded from UNVERIFIED to PASS without evidence.

---

## 8. Engineering constraints

The UI parity mission does not authorize architectural duplication.

Prefer, in order:

1. existing canonical repository components;
2. existing backend capability seams;
3. mature open-source UI/framework components already adopted by the repository;
4. narrow adapter changes;
5. new implementation only when the above cannot satisfy the requirement.

Do not create another:

- chat state store;
- thread model;
- stream parser;
- safety system;
- citation/evidence system;
- provider router;
- machine identity system;
- capability registry;
- root chat application;
- parallel mobile/web product surface.

Presentation should consume the canonical interaction contract and existing capability seams.

If a parity requirement reveals a backend defect, fix or isolate the backend defect rather than hiding it with presentation logic.

---

## 9. Product rules

The following are product rules unless changed by an explicit later decision:

- General ask works before a machine is known.
- Machine binding should add context, not gate basic conversation.
- Projects are the primary organization layer.
- Threads are work/conversation history.
- Notebook/retrieval concepts remain supporting infrastructure, not the primary navigation metaphor.
- Evidence should be available without making every answer feel like a research tool.
- Industrial tools should be discoverable but not permanently clutter the composer.
- The shared canonical shell is the future product surface.
- Parallel experimental shells must converge or retire; they do not become permanent alternatives.

---

## 10. Definition of done

FactoryLM has reached the intended ChatGPT parity target when all of the following are true:

- A new technician can open the app and immediately know where to type without instruction.
- New Chat always creates a clean independent durable conversation.
- The sidebar provides familiar Projects and conversation-history navigation.
- Projects organize equipment/work context without exposing notebook-centric architecture.
- Conversations reopen reliably from exact thread rows.
- The composer behaves like a modern ChatGPT-style composer on mobile and web.
- Camera/files/scan/manual/sensor inputs are primarily accessed through low-clutter secondary actions such as `+`.
- Answers stream, scroll, render markdown, and handle long content cleanly.
- Citations/evidence can be inspected without leaving or losing the conversation.
- Mobile keyboard and safe-area behavior are production-quality.
- The canonical shared shell provides the normal product experience.
- No ordinary user needs to choose between multiple generations of the FactoryLM UI.
- Legacy/parallel shells are rollback-only or retired according to the cutover charter.
- Side-by-side evidence demonstrates that the major interaction grammar is familiar to a ChatGPT user.

The desired user reaction is:

> “This works like ChatGPT, but it knows my equipment and gives me the maintenance evidence I need.”

---

## 11. Instructions for implementation agents

Before doing user-facing FactoryLM chat/UI work, read this document and the Unified UI Cutover Charter.

For each proposed slice:

1. Name the exact parity gap from this document.
2. Inspect the existing canonical implementation before proposing new architecture.
3. Identify the smallest existing components/seams that can close the gap.
4. Avoid parallel roots and duplicate product logic.
5. Implement only the bounded slice.
6. Produce evidence against the acceptance criteria.
7. State PASS / FAIL / UNVERIFIED for the affected parity items.
8. Stop and request a product decision only when multiple legitimate product behaviors remain after engineering facts are established.

When this document conflicts with an older experimental UI concept, prefer this document unless a newer explicit product decision supersedes it.

When this document conflicts with safety, lifecycle governance, release policy, or the Unified UI Cutover Charter, the stricter governance rule wins.

---

## 12. Immediate next actions from the current state

At the time this contract was written, the next high-value work is:

1. Prove New Chat creates a distinct server thread and reopens from the exact thread row.
2. Keep #3757 as the canonical presentation lane rather than extending `V6Root` as a parallel product surface.
3. Repair the lifecycle-guard/test-path mismatch separately and narrowly rather than using UI architecture work to weaken governance.
4. After thread identity is proven, close Sidebar → Composer → Conversation visual/interaction parity in bounded slices.
5. Require side-by-side evidence for each parity claim.

This sequence intentionally prioritizes behavioral correctness first, then visible parity, then cutover.