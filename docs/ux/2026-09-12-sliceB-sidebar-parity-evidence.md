# Slice B — Sidebar interaction parity: visual evidence packet

**Parity authority:** `docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md` §5 Gap 2 / §6 Slice B
**Policy:** `docs/ux/VISUAL_EVIDENCE_POLICY.md` (first packet produced under it)
**Lane:** PR #3757, branch `v7/chatgpt-ui-replacement`
**Commit SHA at capture:** `259637c2d` (working tree clean; all rendering-relevant
paths byte-identical to reviewed `40ca03d48` — commits since touched only
`mira-hub` tests and docs)
**Date:** 2026-09-12

## Capture setup (all real renders, no mockups)

- **Live app** (`app` frames): `mira-mobile` Vite dev build of this branch at
  `http://localhost:5199/`, authenticated against the **live production
  backend** `app.factorylm.com` (magic-link session as mike@cranesync.com;
  vite proxy `/api` → prod with `cookieDomainRewrite`), unified shell mounted
  via `CapacitorStorage.flm.chatui.v1=unified`. Playwright-driven Chromium at
  **412×915** (mobile viewport). *Limitation recorded per policy §5: no
  Android emulator exists on this capture host (BRAVO has `adb` but no AVDs);
  frames are the actual Capacitor webview content at the mobile viewport, not
  an emulator screencap.*
- **Lab** (`web`/`lab` frames): `apps/factorylm-ui-lab` (bun dev, `:3000`,
  `embed=1`) rendering the **same `packages/factorylm-ui` shell components**
  with deterministic fixtures — used for states the disconnected lab can show
  and for the desktop viewport (**1440×900**). Console shows two benign lab
  dev-harness CSP messages (bun HMR inline script + websocket blocked by the
  lab CSP); not app errors.

All files live in `docs/promo-screenshots/` (append-only), prefix
`2026-09-12_sliceB-`.

## Frames

| # | File (suffix) | Surface | Viewport | Route/screen | State demonstrated | Reproduction steps |
|---|---|---|---|---|---|---|
| 1 | `app-blank-new-chat_mobile` | Live app + prod | 412×915 | `/` unified home | Blank New Chat: greeting-first canvas, quiet context line, `+ / input / send` composer, drawer closed | Sign in → pref `unified` → load `/` |
| 2 | `app-drawer-open-projects-recent_mobile` | Live app + prod | 412×915 | `/` drawer | Drawer open over real data: New chat, Search, Projects (threads nested), Recent, account footer | From 1: tap ☰ (Open navigation) |
| 3 | `app-thread-opened-drawer-closed_mobile` | Live app + prod | 412×915 | notebook conversation | Selecting a conversation closes the drawer; real cited answer + evidence card renders | From 2: tap Recent row "Test" |
| 4 | `app-current-thread-selected_mobile` | Live app + prod | 412×915 | `/` drawer | Current thread visibly selected — exactly one `aria-current="page"` row (accent tint), Recent reference carries quiet `data-active` (DOM verified, values in packet) | From 3: tap ☰ |
| 5 | `app-second-thread-opened_mobile` | Live app + prod | 412×915 | notebook conversation | Tapping another thread switches conversation and closes drawer | From 4: tap "E2E HARNESS VALIDATION…" thread row |
| 6 | `app-selection-moved_mobile` | Live app + prod | 412×915 | `/` drawer | Selection moved with it — still exactly one `aria-current` row (DOM verified: count 1) | From 5: tap ☰ |
| 7 | `app-search-filter-live_mobile` | Live app + prod | 412×915 | `/` drawer | Search filters Projects tree + Recent live ("E2E") | From 6: type `E2E` in Search |
| 8 | `app-new-chat-draft-prod-087-leak_mobile` | Live app + prod | 412×915 | notebook conversation | ⚠️ HONEST GAP FRAME: sidebar **New chat** requested a fresh draft thread; the **prod server (no migration 087) returned the notebook's whole existing conversation** — the exact Gap 1 deployment gap surfacing in the UI. Branch server is integration-proven to return a blank, filtered thread (`docs/ux/2026-09-12-gap1-thread-identity-proof.md`) | From 7: clear search, tap **New chat** |
| 9 | `app-draft-new-chat-row_mobile` | Live app + prod | 412×915 | `/` drawer | Client-side draft "New chat" row injected at the top of its project's thread list | From 8: tap ☰ |
| 10 | `lab-drawer-closed_mobile` | Lab fixtures | 412×915 | `?surface=mobile&scenario=grounded-answer&embed=1` | Drawer closed over a populated grounded conversation (trust chip, OEM citation, composer) | Load URL → tap ✕ (drawer opens by default in this fixture) |
| 11 | `lab-drawer-open_mobile` | Lab fixtures | 412×915 | same | Drawer open: scrim over conversation, full nav (disabled New chat is the lab's honest no-host state, by design) | Load URL (fixture opens with drawer) |
| 12 | `sidebar-projects-recent_desktop` | Lab fixtures | 1440×900 | `?surface=web&scenario=project-tree&embed=1` | Desktop persistent sidebar: Projects hierarchy (threads/runs/findings nested, machines inside projects), Recent section, selected row accent | Load URL |
| 13 | `sidebar-search-filter_desktop` | Lab fixtures | 1440×900 | same | Search filtering the navigation ("F30001") | From 12: type `F30001` in Search |
| 14 | `thread-selected-conversation_desktop` | Lab fixtures | 1440×900 | `?surface=web&scenario=grounded-answer&embed=1` | Thread selected + its grounded conversation on the canvas | Load URL |

DOM selection-state verification recorded at capture (frames 4/6):
`document.querySelectorAll('[aria-current="page"]')` → exactly **1** row each
time ("Test · Chat", then "E2E HARNESS VALIDATION 2026-08-21h · Chat");
Recent reference row carries `data-active="true"`.

## Before / after

This slice ships **no new presentation code**: the audit found the Gap 2
interaction grammar (drawer open/select/close, single quiet selection,
Projects-with-threads, Recent, search, select-closes-drawer) already
implemented on the canonical shell by the prior presentation slice. The
"before" for that slice (Ask/Work bar, top-level Machines section, voice
stub, machine chip) is documented with screenshots in
`docs/ux/2026-09-12-chatgpt-ui-replacement-slice.md`. This packet is the
missing *visual state coverage* required by the new policy.

## Engineering facts — what Gap 2 still needs (backend-gated)

**Rename / archive / delete of conversations is NOT implemented anywhere in
the stack** — this is an engineering fact, not a presentation omission:

- Threads have **no server-side metadata store**: a thread exists only as
  `equipment_notebook_turns.thread_id` (087); its title is derived at read
  time from the first question (`threadTitleFromQuestion`). There is nothing
  to rename, archive, or delete a thread against.
- Notebook-level PATCH/DELETE exist (`/api/equipment-notebooks/[id]`), but a
  notebook is the Project, not the conversation.

Closing it needs a bounded backend sub-slice (**Slice B2**): migration 088
(`equipment_notebook_threads` metadata table: `thread_id`, `notebook_id`,
`tenant_id`, `owner_user_id`, `title`, `archived_at`) + thread PATCH/DELETE
routes + `listThreads` join + compact contextual controls in the shared
shell. Faking rename client-side would violate the contract's "no new
parallel store" rule and is not done.

## Gap 2 acceptance matrix (contract §5)

| Target behavior | Status | Evidence |
|---|---|---|
| New Chat prominent and immediate | PASS | frames 1, 2, 9 |
| Search behaves as conversation/history search | PASS (client-side filter over nav) | frames 7, 13 |
| Projects are primary containers, threads nested | PASS | frames 2, 12 |
| Recent conversations easy to reach | PASS | frames 2, 4, 12 |
| Selected-thread state obvious but quiet | PASS | frames 4, 6 + DOM verification |
| Mobile slide-out drawer, natural open/close | PASS | frames 1→2, 10→11 |
| Selecting a conversation closes the drawer | PASS | frames 3, 5 |
| Rename/archive/delete via compact contextual controls | **FAIL — not implemented; backend-gated (Slice B2 above)** | — |
| Conversation titles useful and stable | PARTIAL — first-question titles work (frame 2); stable custom titles need B2 | frames 2, 9 |
| No top-level Machines product competing with Projects | PASS | frames 2, 12 (machines appear inside projects) |

## What remains unverified

- Emulator/device captures (no AVD on capture host — recorded per policy).
- Server-backed thread rows in Recent on the live host (blocked on the
  canonical stack deploying 087 — same blocker as Gap 1's live items).
- Visual-regression harness (worth adding when Slice B2 lands controls worth
  pinning).

## Next

**Slice B2** (backend + controls, design above) or proceed to **Slice C —
Composer parity** while B2 awaits authorization; B2 touches a migration, so
it should be its own reviewed slice.
