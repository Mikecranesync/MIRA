# FactoryLM UI — P0 build plan (acceptance gates → per-slice checklist)

**Date:** 2026-09-08
**Derives from:** `FACTORYLM_UX_ACCEPTANCE.md` (the recon bundle, `docs/reviews/2026-09-07-ux-recon-bundle/`,
also `~/Downloads/`), the recon report `wiki/reviews/2026-09-07-app.factorylm.com-ux-recon-off-base.md`
(PR #3666), and tracking issue **#3667**.
**Purpose:** turn the release-blocking acceptance gates into a build checklist a session can execute
against directly — **gate ID → observable done-when → component/file → slice/PR → status** — so the
fleet builds to what is *actually wrong* (the ChatGPT-parity recon) rather than to inference.

## How to use this

- Each row is a **release gate**. "Done-when" is the acceptance test's own **observable** pass
  condition — judged from what's on screen, never "an endpoint returned 200."
- Build order = the five #3667 unblockers, top to bottom. A slice is done when every gate in its
  section passes on the real surface (web *and*, for §H, mobile).
- The single meta-gate is **Z-1** (bottom): a stranger reaches a cited answer in five minutes with
  no instruction. If Z-1 fails, no individual gate matters yet.

## Count / source discrepancies (flagged, not smoothed over)

- **27 P0 gates, not 28.** `FACTORYLM_UX_ACCEPTANCE.md` §"RELEASE GATES" says "P0 — 28 tests," but
  the file contains **27** `[P0]`-tagged gates (A:2, B:6, C:2, D:3, E:2, F:3, G:5, H:3, I:1). The
  header is off by one; the 27 below are the real set.
- **44px vs 48px.** Slice A (#3643) shipped a **44px** touch floor; gate **H-1 requires 48×48px**.
  Either raise the floor to 48 or record why 44 is accepted — do not leave it silently divergent.
- **Citations (E-1/E-2) need backend data**, not just UI: the answer payload must carry
  manual-name + page provenance, and a "no manual on file" signal. UI can render a chip only if the
  data arrives. Track the data dependency alongside the UI slice.

## Component map (where the work lands)

| Layer | Location | Owns |
|---|---|---|
| Shared UI kit | `packages/factorylm-ui/src/` | `FactoryLMShell.tsx` (shell), `Sidebar.tsx` (nav/drawer), `Composer.tsx` + `AttachmentMenu.tsx`, `Conversation.tsx`/`parts.tsx`/`conversation.css` (message render/speaker/copy/actions), `ThreadHeader.tsx` (scope badge/title), `Inspector.tsx`/`SourceViewer.tsx` (citations/sources), `Overlay.tsx` (overlays) |
| Web host | `mira-hub/src/app/(hub)/…` | home route (today `command-center` KPI board), `scan`, asset detail (under `cmms`/dynamic), error surfaces, route/scroll state |
| Mobile host | `mira-mobile/src/` (`App.tsx`) | §H gates, drawer, safe-area, system-back |

Status legend: ✅ landed · 🔶 partial (slice exists / groundwork) · ⬜ not started.

---

## Unblocker 1 — The composer is the home screen

| Gate | Obs | Done-when (observable) | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **A-1** | T | Composer visible without scrolling, cursor already in it, a keypress produces text with **no prior click**. FAIL if any KPI tile / flywheel bar / feed occupies the primary slot. | `mira-hub (hub)/` home route + `Composer.tsx` | `feat/hub-home-composer` (un-PR'd) · #3667 U1 | 🔶 |
| **A-2** | T | No modal/dialog/tour/announcement on launch; any promo is dismissible and never overlaps the composer. | `mira-hub (hub)/` + `Overlay.tsx` | #3667 U1 | ⬜ |
| **B-1** | T | Type → Enter → an answer begins. No navigation, no mode pick, no asset pick required first. | `Composer.tsx` + home route | `feat/hub-home-composer`; #3529 (IME Enter) | 🔶 |
| **D-1** | T | Home → asset → typing = **two taps**; the asset composer is focused and ready. | asset route + `Composer.tsx` | #3667 U5 | ⬜ |
| **D-2** | T | Below the asset title the **next element is an input** whose placeholder names the asset. FAIL if a gradient banner / spec grid / tab strip is there. | asset route + `Composer.tsx` | #3667 U5 | ⬜ |

## Unblocker 2 — Never break the shell

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **C-2** | T | From a scan, the **sidebar remains, the theme does not change, and an in-app back is visible at all times**. (The current Scan trap.) | `mira-hub (hub)/scan` + `FactoryLMShell.tsx` | #3667 U2 | ⬜ |
| **I-1** | T | The theme never changes within a session — no light page inside the dark app. | `FactoryLMShell.tsx` + `scan` route | #3667 U2 | ⬜ |
| **F-1** | T | From **every** screen (scan, asset chat, work order) system/browser back returns to the immediately preceding screen; no screen is reachable that back can't leave. | `FactoryLMShell.tsx` + hub routing | #3667 U2 | ⬜ |

## Unblocker 3 — Fix the conversation (render / speaker / stop / copy)

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **B-2** | T | Blur test: user messages = right-aligned filled bubbles; assistant = left, **no bubble**, full width. No message is both left-aligned and filled. | `Conversation.tsx` / `parts.tsx` / `conversation.css` | #3628 (Task 5 render parts) | 🔶 |
| **B-3** | T | No literal `**`, `##`, `[]()`, `\n` in any message — including the first greeting (markdown rendered). | `parts.tsx` (markdown render) | #3628 | 🔶 |
| **B-4** | T | Within **1s** of Enter: message appears, composer relocates to the bottom, a waiting state renders. | `Composer.tsx` + `Conversation.tsx` | #3529 | 🔶 |
| **B-6** | T | During generation the send control is **replaced in place by Stop**; pressing it halts output and leaves the partial answer readable. | `Composer.tsx` (send-slot state machine) | #3529 | 🔶 |
| **B-8** | T | A **copy** control is visible without hovering; pasted text is the answer, formatting intact, no markup artefacts. | `Conversation.tsx` action row | #3667 U3 | ⬜ |

## Unblocker 4 — Humane errors (no status codes, no permanent banners)

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **G-1** | T | No error ever shows a bare status number (no `412`). | hub chat error surface + `Conversation.tsx` | #3667 U4 | ⬜ |
| **G-2** | T | Every error answers three, on screen: *what happened* (plain, no codes) · *is my work safe* (stated **and** the composer keeps the text) · *what now* (**a button**, not "refresh"). | hub error surface + `Composer.tsx` | #3667 U4 | ⬜ |
| **G-3** | T | Errors are dismissible toasts/inline notices — **never a permanent row** in the transcript. | `Conversation.tsx` / `Overlay.tsx` | #3667 U4 | ⬜ |
| **G-4** | T | A failed message exists in **exactly one place** — either transcript-marked-failed with inline retry, or back in the composer. Never both. | `Conversation.tsx` + `Composer.tsx` | #3531 (Retry, HELD) | 🔶 |
| **G-5** | T | After any error the composer is focused and usable, navigation works, and previously loaded content is still visible. | hub error boundary + shell | #3667 U4 | ⬜ |

## Unblocker 5 — Asset page = ChatGPT project page + evidence

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **D-5** | T,S | A scope badge naming the asset is visible **at every scroll position** for the life of the conversation, and tapping it changes scope. | `ThreadHeader.tsx` | #3667 U5 | ⬜ |
| **E-1** | S | A claim carries an **inline chip naming the manual and page** (`📖 SKF 6205 · p.14`). FAIL: bare superscript or no attribution. *(needs provenance in the answer payload)* | `parts.tsx` + `SourceViewer.tsx`; **backend citation data** | #3652 (Slice D citation card) | 🔶 |
| **E-2** | S | An answer with no manual on file carries an explicit label (`⚠ General guidance — no manual on file`); sourced vs unsourced are **visibly different**. *(needs a "no source" signal)* | `parts.tsx`; **backend signal** | #3667 U5 | ⬜ |

## State persistence (cross-cutting P0)

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **F-2** | T | Scroll to the middle of a long chat, navigate away, return → same content at the same pixel. | hub routing + `Conversation.tsx` scroll anchor | #3667 U2 | ⬜ |
| **F-5** | T | Open an asset chat, close the app, reopen → same conversation, same scroll, same scope badge. | hub session/route restore | #3667 U2 | ⬜ |
| **C-1** | T | A photo is attachable from **inside a conversation** (≤2 taps, no leaving). | `Composer.tsx` + `AttachmentMenu.tsx` | #3643 (Slice A attach sheet) | ✅ |

## Mobile (§H — unvalidated until run on a device)

> `FACTORYLM_UX_ACCEPTANCE.md` §H is inference from responsive structure; Charlie's teardown
> (`docs/audits/2026-09-07-mobile-*.md`) is the device evidence. Validate on a real phone.

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **H-1** | T | Every interactive target ≥ **48×48px**; no mis-taps with gloves. | `mira-mobile` + kit | #3643 shipped **44px** — **raise to 48 or justify** | 🔶⚠️ |
| **H-2** | T | The sidebar becomes a drawer with the same content, order, and active state. | `Sidebar.tsx` + `mira-mobile` | #3643 (drawer groundwork) | 🔶 |
| **H-3** | T | System back maps to in-app back at every depth; never exits the app from a sub-screen. | `mira-mobile/src/App.tsx` | #3667 mobile | ⬜ |

---

## Existing-slice coverage & gaps

**Slices that already carry P0 work:** #3643 Slice A (C-1 ✅; H-1 partial/44px; H-2 groundwork) ·
#3628 Task 5 (B-2/B-3 render) · #3529 (B-1/B-4/B-6 composer) · #3652 Slice D (E-1 citation card) ·
#3531 Retry [HELD] (G-4) · `feat/hub-home-composer` un-PR'd (A-1/B-1/D-2).

**P0 gaps with no slice yet (highest-leverage next work):**
1. **Scan breaks the shell** — C-2 / I-1 / F-1 (one fix: render Scan *inside* the persistent shell, keep the dark theme, add in-app back).
2. **Humane errors** — G-1 / G-2 / G-3 / G-5 (kill the `412` banner; degrade + plain language + a Retry button; dismissible).
3. **Asset page as project page** — D-1 / D-2 / D-5 (scoped composer on top, sticky scope badge).
4. **Copy action row** — B-8.
5. **State restore** — F-2 / F-5.
6. **Unsourced-claim labelling** — E-2 (+ backend "no source" signal).

## The meta-gate

> **Z-1 · Five-minute stranger test.** Hand a phone running FactoryLM to a maintenance technician
> who has never seen it, who uses ChatGPT weekly: *"Find out what the grinding noise on that
> conveyor might be."* **Pass:** they start typing/scanning without asking a question; reach a
> **cited** answer within five minutes without instruction; can say where it came from; never say
> *"what do I press?"* or *"where did it go?"*

Run Z-1 and the 27 P0 gates as a **human-observable gate in front of** the CI retrieval gate
(`tests/beta/beta_ready_upload_retrieval_citation.py`). Green retrieval + failed Z-1 is exactly the
false "MET / PASSING" the recon caught.

---

*Sources: `FACTORYLM_UX_ACCEPTANCE.md`, `FACTORYLM_UX_GRAMMAR.md`, `CURRENT_STATE_AUDIT.md`
(`docs/reviews/2026-09-07-ux-recon-bundle/`); report #3666; tracking #3667. Component paths verified
against `packages/factorylm-ui/src/`, `mira-hub/src/app/(hub)/`, and `mira-mobile/src/` on `main`
(2026-09-08). Slice/PR mapping is current-best; confirm each PR's head before building on it.*
