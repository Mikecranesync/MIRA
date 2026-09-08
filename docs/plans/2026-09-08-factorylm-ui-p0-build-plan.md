# FactoryLM UI — P0 build plan (acceptance gates → per-slice checklist)

**Date:** 2026-09-08
**Derives from (immutable committed refs only):** the recon report
`wiki/reviews/2026-09-07-app.factorylm.com-ux-recon-off-base.md` (on `main`, PR #3666); the acceptance
suite / grammar / audit source files `FACTORYLM_UX_ACCEPTANCE.md`, `FACTORYLM_UX_GRAMMAR.md`,
`CURRENT_STATE_AUDIT.md` on the pushed branch `docs/ux-recon-bundle-2026-09-07`; and tracking issue
**#3667**. (Not sourced from machine-local `~/Downloads` — that path is not committed.)
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

- **27 P0 gates, not 28 (and 72 total, not 74).** `FACTORYLM_UX_ACCEPTANCE.md` says "P0 — 28" /
  "74 total," but the real tagged counts are **27 P0 / 37 P1 / 7 P2 = 71 tagged, + the untagged Z-1
  = 72**. The doc over-counts by exactly one per bucket because the legend line
  (`` `[P0]` blocks release · `[P1]` … · `[P2]` … ``) carries one of each tag and was counted as a
  test (independently confirmed by `mira-97`). The 27 P0 below are the real set.
- **44px vs 48px is an unadjudicated spec conflict — NOT a Slice A defect.** `hub-mobile-spec.md:26`
  declares "≥ 44 px" and is named by path in the native-mobile PRD (§ "UX contract"), part-4, and the
  dogfood spec — six citations. So the 44px in #3643/#3682 **conforms to the declared contract**; it
  is not drift. Gate H-1 asks for **48** (Material/Android 48dp; Apple HIG / WCAG 2.1 AAA is 44 — the
  repo's own competitive-ux notes write it as a "44–48 px" range). **Two specs disagree and nobody
  has adjudicated.** This is one decision for Mike (escalated on #3683), not a code fix: if 48 wins,
  a single PR amends the spec + PRD + part-4 + dogfood spec **and** the three tests pinning 44
  (`v3-contract.test.ts`, `attachment-sheet.test.tsx`, `mobile-behavior.test.tsx`) together; if 44
  wins, H-1 is corrected in the acceptance suite and no code changes. (Verified by `mira-97` +
  `charlie-disk-memory-reclamation`.)
- **Citations (E-1/E-2) need backend data**, not just UI: the answer payload must carry
  manual-name + page provenance, and a "no manual on file" signal. UI can render a chip only if the
  data arrives. Track the data dependency alongside the UI slice.

## Routing under the Unified UI Cutover (MANDATORY — #3647 merged 2026-09-08, `2182205e`)

**All new presentation code targets `packages/factorylm-*/**` or the canonical adapter roots
`mira-hub/src/factorylm-ui/**` / `mira-mobile/src/factorylm-ui/**`.** The legacy trees
`mira-hub/src/app/**`, `mira-web/src/**`, and `mira-mobile/src/**` (React/style/navigation) are a
**feature-frozen rollback surface**, enforced by the live `ui-lifecycle-guard`
(`.claude/rules/factorylm-unified-ui-cutover.md`). **Do NOT request a `legacy-ui-exception` for this
work** — none of these P0 gates is a security/S0-S1 repair; they route through the canonical layers
by construction. A minimal production *mount* edit (wiring a canonical adapter into the shell) is a
separately audited exception, out of ordinary slice scope. Reviewer = a different Claude session +
green CI (Codex lane unavailable until 2026-09-13).

## Component map (where the work lands)

| Layer | Location | Owns |
|---|---|---|
| Shared UI kit | `packages/factorylm-ui/src/` | `FactoryLMShell.tsx` (shell), `Sidebar.tsx` (nav/drawer), `Composer.tsx` + `AttachmentMenu.tsx`, `Conversation.tsx`/`parts.tsx`/`conversation.css` (message render/speaker/copy/actions), `ThreadHeader.tsx` (scope badge/title), `Inspector.tsx`/`SourceViewer.tsx` (citations/sources), `Overlay.tsx` (overlays) |
| Web canonical host | `mira-hub/src/factorylm-ui/**` (canonical adapter root) | Hub home / scan / asset / error surfaces rendered through the shared shell — **not** the frozen `mira-hub/src/app/**` routes |
| Mobile canonical host | `mira-mobile/src/factorylm-ui/**` (canonical adapter root) | §H gates, drawer, safe-area, system-back — **not** the frozen `mira-mobile/src/**` classic screens |

Status legend: ✅ landed · 🔶 partial (slice exists / groundwork) · ⬜ not started.

---

## Unblocker 1 — The composer is the home screen

| Gate | Obs | Done-when (observable) | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **A-1** | T | Composer visible without scrolling, cursor already in it, a keypress produces text with **no prior click**. FAIL if any KPI tile / flywheel bar / feed occupies the primary slot. | `mira-hub/src/factorylm-ui/**` home route + `Composer.tsx` | **#3682** (`feat/hub-home-composer`) · #3667 U1 | 🔶 |
| **A-2** | T | No modal/dialog/tour/announcement on launch; any promo is dismissible and never overlaps the composer. | `mira-hub/src/factorylm-ui/**` + `Overlay.tsx` | #3667 U1 | ⬜ |
| **B-1** | T | Type → Enter → an answer begins. No navigation, no mode pick, no asset pick required first. | `Composer.tsx` + home route | **#3682**; #3529 (IME Enter) | 🔶 |
| **D-1** | T | Home → asset → typing = **two taps**; the asset composer is focused and ready. | `mira-hub/src/factorylm-ui/**` (asset surface) + `Composer.tsx` | #3667 U5 | ⬜ |
| **D-2** | T | Below the asset title the **next element is an input** whose placeholder names the asset. FAIL if a gradient banner / spec grid / tab strip is there. | `mira-hub/src/factorylm-ui/**` (asset surface) + `Composer.tsx` | #3667 U5 | ⬜ |

## Unblocker 2 — Never break the shell

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **C-2** | T | From a scan, the **sidebar remains, the theme does not change, and an in-app back is visible at all times**. (The current Scan trap.) | `mira-hub/src/factorylm-ui/**` (scan surface) + `FactoryLMShell.tsx` | #3667 U2 | ⬜ |
| **I-1** | T | The theme never changes within a session — no light page inside the dark app. | `FactoryLMShell.tsx` + `scan` route | #3667 U2 | ⬜ |
| **F-1** | T | From **every** screen (scan, asset chat, work order) system/browser back returns to the immediately preceding screen; no screen is reachable that back can't leave. | `FactoryLMShell.tsx` + `mira-hub/src/factorylm-ui/**` routing | #3667 U2 | ⬜ |

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
| **G-1** | T | No error ever shows a bare status number (no `412`). | `mira-hub/src/factorylm-ui/**` error surface + `Conversation.tsx` | #3667 U4 | ⬜ |
| **G-2** | T | Every error answers three, on screen: *what happened* (plain, no codes) · *is my work safe* (stated **and** the composer keeps the text) · *what now* (**a button**, not "refresh"). | `mira-hub/src/factorylm-ui/**` error surface + `Composer.tsx` | #3667 U4 | ⬜ |
| **G-3** | T | Errors are dismissible toasts/inline notices — **never a permanent row** in the transcript. | `Conversation.tsx` / `Overlay.tsx` | #3667 U4 | ⬜ |
| **G-4** | T | A failed message exists in **exactly one place** — either transcript-marked-failed with inline retry, or back in the composer. Never both. | `Conversation.tsx` + `Composer.tsx` | #3531 (Retry, HELD) | 🔶 |
| **G-5** | T | After any error the composer is focused and usable, navigation works, and previously loaded content is still visible. | `mira-hub/src/factorylm-ui/**` error boundary + shell | #3667 U4 | ⬜ |

## Unblocker 5 — Asset page = ChatGPT project page + evidence

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **D-5** | T,S | A scope badge naming the asset is visible **at every scroll position** for the life of the conversation, and tapping it changes scope. | `ThreadHeader.tsx` | #3667 U5 | ⬜ |
| **E-1** | S | A claim carries an **inline chip naming the manual and page** (`📖 SKF 6205 · p.14`). FAIL: bare superscript or no attribution. *(needs provenance in the answer payload)* | `parts.tsx` + `SourceViewer.tsx`; **backend citation data** | #3652 (Slice D citation card) | 🔶 |
| **E-2** | S | An answer with no manual on file carries an explicit label (`⚠ General guidance — no manual on file`); sourced vs unsourced are **visibly different**. *(needs a "no source" signal)* | `parts.tsx`; **backend signal** | #3667 U5 | ⬜ |

## State persistence (cross-cutting P0)

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **F-2** | T | Scroll to the middle of a long chat, navigate away, return → same content at the same pixel. | `mira-hub/src/factorylm-ui/**` routing + `Conversation.tsx` scroll anchor | #3667 U2 | ⬜ |
| **F-5** | T | Open an asset chat, close the app, reopen → same conversation, same scroll, same scope badge. | `mira-hub/src/factorylm-ui/**` session/route restore | #3667 U2 | ⬜ |
| **C-1** | T | A photo is attachable from **inside a conversation** (≤2 taps, no leaving). | `Composer.tsx` + `AttachmentMenu.tsx` | #3643 (Slice A attach sheet) | ✅ |

## Mobile (§H — unvalidated until run on a device)

> `FACTORYLM_UX_ACCEPTANCE.md` §H is inference from responsive structure; Charlie's teardown
> (`docs/audits/2026-09-07-mobile-*.md`) is the device evidence. Validate on a real phone.

| Gate | Obs | Done-when | Component | Slice/PR | Status |
|---|---|---|---|---|---|
| **H-1** | T | Interactive targets meet the adjudicated floor; no mis-taps with gloves. | `mira-mobile/src/factorylm-ui/**` + kit | #3682/#3683 build to the **44px** contract (`hub-mobile-spec.md`); H-1 asks 48 — **spec conflict, Mike decides (#3683)**, not a defect | ⏳ decision |
| **H-2** | T | The sidebar becomes a drawer with the same content, order, and active state. | `Sidebar.tsx` + `mira-mobile/src/factorylm-ui/**` | #3643 (drawer groundwork) | 🔶 |
| **H-3** | T | System back maps to in-app back at every depth; never exits the app from a sub-screen. | `mira-mobile/src/factorylm-ui/**` | #3667 mobile | ⬜ |

---

## Existing-slice coverage & gaps

**Slices carrying P0 work (all now PR'd — the roll call surfaced 7 un-PR'd branches, opened as #3681–#3687):**
- **#3682** `feat/hub-home-composer` — A-1/B-1/D-2 (composer-as-home; also owns `/api/hub/ask`)
- **#3681** `fix/hub-render-approved-context-refusal` — G-1/G-2/G-3/G-5 (**the `412` — already built**, see note below)
- **#3683** `feat/hub-v3-surface` — B-8/E-1/E-2 partial (**must land AFTER #3682** — it posts to `/api/hub/ask`, which lives only on #3682, or its composer 404s)
- #3628 Task 5 (B-2/B-3) · #3529 (B-1/B-4/B-6) · #3652 Slice D (E-1) · #3531 Retry [HELD] (G-4) · #3643 Slice A (C-1 ✅; 44px per contract; H-2 groundwork)

> **The `412` is not a generic error (root cause changes the fix).** A `412` is
> `buildApprovedContextRefusal` — MIRA correctly *declining* without approved grounding
> (train-before-deploy behaviour). The response body already carries the `reason` and the exact
> `action` ("Upload and approve a manual / PLC tag list / evidence document"). The client threw it
> away (`throw new Error(\`Server error ${res.status}\`)`, no body read) and a downstream catch
> regexed three digits into a red banner. So a *designed refusal* rendered as an outage, and "refresh
> the page" was advice that could never work. G-1's fix = **read and render the body's reason+action**,
> not generic error handling. Built on #3681.

**P0 gaps still needing a slice (highest-leverage next work):**
1. **Scan breaks the shell** — C-2 / I-1 / F-1 (**#3680**, claimable). Root cause is a full-viewport light surface + an nginx route collision (`/scan/` served by a different app), not a misplaced route — see #3680.
2. **Asset page as project page** — D-1 / D-2 / D-5 (scoped composer on top, sticky scope badge).
3. **Copy action row** — B-8.
4. **State restore** — F-2 / F-5.
5. **Unsourced-claim labelling** — E-2 (+ backend "no source" signal).

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

*Sources (committed refs): report `wiki/reviews/2026-09-07-app.factorylm.com-ux-recon-off-base.md`
(#3666, on `main`); acceptance/grammar/audit files on branch `docs/ux-recon-bundle-2026-09-07`;
tracking #3667; the cutover rule `.claude/rules/factorylm-unified-ui-cutover.md` (#3647, merged
`2182205e`). Shared-kit component paths verified against `packages/factorylm-ui/src/` on `main`
(2026-09-08); host work targets the canonical adapter roots `mira-hub/src/factorylm-ui/**` /
`mira-mobile/src/factorylm-ui/**` per the cutover (NOT the frozen `mira-hub/src/app/**` /
`mira-mobile/src/**`). Slice/PR mapping (#3681–#3687) is current-best; confirm each PR's head before
building on it.*
