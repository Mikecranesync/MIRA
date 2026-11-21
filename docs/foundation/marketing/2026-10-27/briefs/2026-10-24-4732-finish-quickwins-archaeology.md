# #4732 FINISH quick wins — archaeology (READ-ONLY)
Repo: Mikecranesync/MIRA · main tip **315c1fa1c5a8599eaec6aaf4ad15a7e9b55d3d39** (2026-10-24 16:32 EDT) · clone /workspace/punchlist/mira-tip (shallow; git history per-file UNVERIFIED, PR history via GitHub search).
Nothing reproduced live. No commits/PRs/comments.

---
## 1. #4731 — WO status "closed" 500s; only "completed" works
**Verdict: FINISH · Effort: S**

Mechanism (confirmed in code): the server treats `closed` as a closing status but the Postgres enum has no `closed` value, so the cast throws and the catch returns 500.
- `mira-hub/src/lib/wo-completion-validation.ts:11` — `CLOSING_STATUSES = new Set(["completed","closed"])`.
- `mira-hub/src/app/api/work-orders/[id]/route.ts:147-186` — no allow-list; closing-field validation only. `:195-199` — `status = $n::text::workorderstatus` (raw string cast). `:225-227` — any DB error → `500 "Update failed"`.
- Enum: defined by pre-migration Atlas init (not in repo → exact prod values UNVERIFIED). `tools/seeds/demo-hub-tenant.sql:372` documents `open / in_progress / needs_completion / completed / cancelled`; `mira-hub/db/migrations/005_wo_pm_enhancements.sql:15` adds `needs_completion`. No `closed`.
- Mobile client: `mira-mobile/src/screens/Workorders.tsx:306-308` already notes "closed 500s on prod (enum lacks the value)" and sends `completed` (:323). `updateWorkOrder` = `mira-mobile/src/api/resources.ts:173-179`.
- **Second latent bug (same class):** `Workorders.tsx:39-44` `STATUS_FILTERS`/`NEXT_STATUS` use **`resolved`**, which is also not in the documented enum → the status buttons likely 500 too (UNVERIFIED live). Hub web uses `open/in_progress/completed` (`mira-hub/src/app/(hub)/workorders/page.tsx:55`).
- Prior attempts: none found (PR search "work order status closed" — no relevant PR; no branch). 
- Tests: `mira-hub/src/app/api/work-orders/[id]/route.test.ts` covers only `rowToWO` (#2375); no PATCH status test.

**Smallest fix:** in PATCH, validate `status` against an exported allow-list (`open,in_progress,needs_completion,completed,cancelled`); map `closed`→`completed` (alias) or 400 with `allowed`; drop `closed` from `CLOSING_STATUSES` (or keep as alias pre-normalisation). Fix mobile `NEXT_STATUS`/filters `resolved`→`completed`. Add route test: `closed`, `completed`, unknown → 400. Bonus: map PG `22P02` to 400.

---
## 2. #4694 — Phone: can't see a project's manuals or rename it
**Verdict: CONNECT · Effort: M** (S for Sources-only; M with menu + rename + delete confirm)

Note: issue was found on **staging /v3 at 390×844** (Hub shared shell), not the native app; both use `packages/factorylm-ui`.
- **Server: exists.** `mira-hub/src/app/api/equipment-notebooks/[id]/route.ts:55` GET returns `{notebook, sources, turns, threads, photos}` (sources via `listSources`); `:126` PATCH → `updateNotebook` (`mira-hub/src/lib/equipment-notebooks.ts:349-371`) accepts `displayName` → rename works server-side; `:141` DELETE exists; `sources/route.ts` POST + `sources/[docId]` PATCH/DELETE exist.
- **/v3 (hub-host):** `mira-hub/src/factorylm-ui/hub-host.tsx` loads `detail.sources` (:329, :332) but the project tree exposes no Sources item and no row/header actions. `packages/factorylm-ui/src/ProjectTree.tsx:140` project row = plain onClick, no menu/onContextMenu; `Sidebar.tsx`, `ThreadHeader.tsx` have no rename/delete/sources hooks. Inspector (`FactoryLMShell.tsx:41-42`) gated on `profile.enterpriseInspector`, no sources list.
- **Native mira-mobile:** already has a Sources destination — `mira-mobile/src/unified/notebook-tree.ts:53-71,127` (`Sources (n)` item) routed at `mira-mobile/src/screens/UnifiedRoot.tsx:401-405`. Client has `deleteNotebook`, `attachSource`, `setSourceEnabled`, `detachSource` (`resources.ts:590-630`) but **no rename client** (no `displayName` PATCH caller).
- Prior attempts: #4499 (open) "collapsible projects + ChatGPT-style row actions menu (research first)" — Mike requires research before build; #3807 (open PR) "fix(mobile): open project sources and verify cold-restart history" (scope vs current main UNVERIFIED); #3741 (merged) converge Projects and Threads; #3750/#3751 closed V6/V7 shells.
- Tests: `mira-hub/src/factorylm-ui/hub-host-create-project.test.ts`, notebook route `__tests__/` (rename/sources UI tests: none found).

**Smallest fix:** CONNECT existing endpoints into the shared shell: (a) port mobile's `sourcesItemId` "Sources (n)" tree item into hub-host's project projection (S); (b) add a "⋯" on project row/header in `ProjectTree.tsx` with Sources / Rename (PATCH `{displayName}`) / Delete (confirm → existing DELETE); add `renameNotebook()` to mobile `resources.ts`. Touches the #3626 shared-UI lane (held under F004 M2, draft #4303) and #4499's research-first constraint — sequence accordingly.

---
## 3. #4681 — Tapping a project opens a new empty chat instead of the last one
**Verdict: FINISH (reverse a deliberate decision) · Effort: S** — needs Mike's product call because current behavior is intentional.

- **/v3 (where reported):** `mira-hub/src/factorylm-ui/hub-host.tsx:696-702` `onSelectProject` → `select(openNotebookSelection(nb))` with comment "A fresh chat, not the notebook's last conversation (#4444)". `mira-hub/src/factorylm-ui/hub-host-logic.ts:91-93` `openNotebookSelection` always mints `newThreadId()`; doc at :95-104 and :153.
- Introduced by **PR #4449 (merged)** "opening a notebook starts a fresh chat instead of resuming its last conversation (#4444)". Locked by tests `mira-hub/src/factorylm-ui/hub-host-logic.test.ts:231-257, :457-477`.
- **Native mira-mobile already does what #4681 asks:** `mira-mobile/src/screens/UnifiedRoot.tsx:128-142` `open()` resumes restored thread (#3851) else `latestThreadId(notebook)`; `onSelectProject` at :410-413. So /v3 and mobile diverge.
- Related: PR #4474 (open draft) adds header "New chat" — the explicit fresh-start control the issue wants kept; landing it makes reversing #4444 safe.
- Shared-shell: `packages/factorylm-ui/src/ProjectTree.tsx:140` calls `onSelectProject` then `select-project`.

**Smallest fix:** change `openNotebookSelection` (or just the sidebar `onSelectProject` path, keeping `?notebook=` deep links per #4444 if desired) to pick the most recent thread (`nb.threads` newest / mobile's `latestThreadId`), mint only when none; update the #4444 tests; land/keep #4474 for explicit New chat. Also consider titling threads from the first *user* question, not auto-sent "What is in this document?" (separate).
