# FACTORYLM — CURRENT STATE AUDIT

**Recon date:** 2026-09-07 · **Surface:** app.factorylm.com, logged in as Mike Harper (Owner), dark theme
**Method:** same framework applied to FactoryLM as to the five reference products
**Screens walked:** Command Board · Command Center · Scan · Assets · Asset detail (Details, Ask MIRA) · Knowledge

This file is observation. The prescription is in `FACTORYLM_UX_GRAMMAR.md`; the tests are in `FACTORYLM_UX_ACCEPTANCE.md`.

---

## Headline

FactoryLM is currently built as **an operations console that contains an AI feature**. Every product in this study is built as **an AI surface that contains operations**. That single inversion generates most of the findings below.

Concretely: a technician who lands on FactoryLM cannot ask a question. The home screen has no input. Reaching the AI takes three navigations (Assets → asset → Ask MIRA, or a banner click). In all five reference products the composer **is** the home screen; in ChatGPT it is additionally focused on arrival, making asking cost zero taps.

---

## Severity 1 — Breaks a universal convention

**S1-01 · There is no composer on the home screen.**
Command Board opens on KPI tiles, a progress bar, and a work-order feed. No text input exists anywhere on the landing route. This is the single most universal pattern in the category — five out of five products open on a focused text box — and it is absent.

**S1-02 · `Scan` leaves the app shell entirely.**
Clicking `Scan` renders a bare page with **no sidebar, no header, no back control, and a light theme** against the app's dark theme. There is no in-app way back; only browser back. The persistent shell is the one structure every reference product never breaks, and FactoryLM breaks it on the screen that is supposed to be the product's spine (photo → nameplate → manual → work order). A user is trapped here.

**S1-03 · Message alignment does not encode speaker.**
In `Ask MIRA`, a long blue-filled message renders **left-aligned** while other user messages render right-aligned in the same blue. The user cannot reliably tell who said what. In both reference products where message container treatment was recorded (ChatGPT, Claude), speaker identity is instantly readable and never ambiguous — user = right-aligned bubble, assistant = left, no bubble, full width.

**S1-04 · Raw markdown leaks into rendered output.**
The MIRA greeting displays `**Garage Conveyor**` with literal asterisks. Unparsed markup in the first message a user ever sees reads as a broken product.

**S1-05 · Errors expose HTTP status codes and offer no recovery.**
Sending a message produced: `Chat unavailable (412). Try again or refresh the page.` — a static, **non-dismissible red banner permanently occupying a slot in the message stream**, with no retry control. `412` is meaningless to a technician; "refresh the page" delegates recovery to the user. Compare ChatGPT's failure: plain language, two concrete next actions, dismissible, and the app degrades to a fully working state.

**S1-06 · The failed message exists twice.**
After the 412, the message appears both as a delivered bubble in the transcript *and* still in the composer. The user cannot tell whether it sent.

**S1-07 · No message actions anywhere.**
No copy, retry, feedback, sources, or timestamps on any message. A technician who needs to paste a diagnosis into a work order has no path. Only Gemini shares this failure among the reference products, and Gemini is not a product whose answers get acted on with a wrench.

---

## Severity 2 — Breaks a strong convention

**S2-01 · Thirteen primary nav items.** Command Board, Namespace, Command Center, Channels, Knowledge, Notebooks, then `MORE`: Assets, CMMS, Scan, Visual Workspace, Settings, Review queue — plus Tour, English, Light mode. Reference range is 5–6 primary items with an overflow flyout.

**S2-02 · Eight tabs on the asset detail page.** `Details · Ask MIRA · Activity · Work Orders · Documents · Parts · Intel · Validate`. ChatGPT's project detail — the closest analogue — has two.

**S2-03 · The AI is a destination, not the page.**
On an asset, `Ask MIRA` is a tab, and separately a full-width gradient banner. Both are things you click *to get to* a place where you can type. ChatGPT's project page puts the composer at the top with a scoped placeholder (`New chat in Factory LM and Mira`) — typing is the first thing available.

**S2-04 · Suggested prompts are non-interactive text.**
`• "What are the most common faults for this equipment?"` — a bulleted list in quotation marks inside a message bubble. The user must retype or copy. Every reference product that offers suggestions makes them one tap. (Claude and Grok offer none at all.)

**S2-05 · No attach/photo control in the composer.**
The MIRA composer is a bordered input plus a grey send icon. No `+`, no camera, no file. In a product whose spine is photo→nameplate, and whose users are on phones, **a photo cannot be added from the conversation.**

**S2-06 · The assistant renders inside a bubble.**
The MIRA greeting and its suggestion block render as a filled bubble. **Answer rendering itself was not observable this pass** — generation never succeeded (see S1-05) — but the greeting establishes the pattern. ChatGPT and Claude render assistant output with no bubble, at full column width, as a document. Bubbles cap the measure and add chrome, which is actively harmful for procedures and manual excerpts.

**S2-07 · No high-emphasis hierarchy.**
Assets header carries four buttons (`Export CSV`, `New Asset`, `Print QR Labels`, `Scan QR`), two of them blue. Work-order cards carry four actions each (`View WO`, `Ask MIRA`, `Mark as read`, `Dismiss`). Reference products allow one high-emphasis action per screen.

**S2-08 · Navigation is slow and silent.**
The first click on `Assets` produced a row highlight but no route change and no feedback for ~4s; a second click was required. Two nav rows appeared active simultaneously. Reference products route instantly and never show two active rows.

**S2-09 · Streaming, thinking and scroll-to-bottom states were not observable this pass.** Generation never succeeded (S1-05), so their absence is inferred from a failed request rather than observed. Re-test once chat is working.

**S2-10 · `Clear` wipes a conversation with no confirmation**, positioned top-right of the chat panel.

**S2-11 · The send control is a low-contrast grey icon.** Every reference product renders send as a filled, high-contrast control the moment there is text.

---

## Severity 3 — Vocabulary, presentation, and content

**S3-01 · Invented vocabulary throughout.** From FLM-A-01: `Command Board`, `Namespace`, `Command Center`, `Channels`, `L5 — Proposal flywheel`, `Namespace readiness`, `VERIFIED EDGES`, `Auto-extracted PMs`. From FLM-B-01: `One-Board Status`, `Remote commissioning`. From FLM-F-01: `Intel`, `Validate`. Perplexity was marked down in this study for calling chats "Sessions" — one invented noun. FactoryLM has roughly a dozen, and two of them (`Command Board` / `Command Center`) differ by a single word.

**S3-02 · System internals presented as the user's workspace.**
- Home screen's top element is `L5 — Proposal flywheel · Keep verifying — once verified outnumber proposed you cross L6` — a progress bar toward the *system's* readiness, with `ASSETS 5 · DOCS 3 · VERIFIED EDGES 3`.
- `Knowledge` opens by default on `Map`: a 47-node force-directed graph with type checkboxes, `Size by influence`, and a legend distinguishing verified from MIRA-proposed edges. `Manuals` is the first tab but not the active one.
- `Command Center` leads with an 8-pill red/green commissioning checklist.
No reference product shows its own data structure as a primary surface.

**S3-03 · Duplicate object names.** Two assets both named `Stardust Racers`, distinguished only by muted EQ numbers. Same failure as Gemini's two `Untitled notebook` rows, but on real equipment a technician must tell apart.

**S3-04 · Raw identifiers as primary labels.** `enterprise.home_garage.conveyor_lab.conveyor_1` is shown as an object's subtitle. Same class of error as ChatGPT's `image-1781126450592.jpg`, but here it is the identifier the user is expected to read.

**S3-05 · Asset records are mostly empty or junk.** On `Garage Conveyor`: `MANUFACTURER: Other`, `MODEL: 1`, `SERIAL NUMBER: 1`, `CATEGORY: —`, `LAST PM: —`, `NEXT PM: —`. Six of ten fields carry nothing usable. A nameplate-extraction product displaying `Model: 1` is displaying that its spine has not run.

**S3-06 · An empty state whose button argues against itself.**
`Machine memory — No machine runs recorded for this asset yet.` → button: `Create work order (no anomaly yet)`. Parenthetical hedging inside a button label.

**S3-07 · Dead-end empty states.** `No conveyor or Stardust telemetry has landed yet.` states an absence and offers nothing. The best reference behavior names a next action — ChatGPT's search shows recent chats, Claude's nav says how to fill the section. (Perplexity's `No projects` is merely declarative, i.e. the same weakness.)

**S3-08 · Gradient CTA.** The `Chat with MIRA about this asset` banner is a full-width purple→blue gradient — the largest element on the asset page. No reference product uses a gradient CTA. It reads as an ad unit, so the most important action on the page is styled as the thing users have learned to skip.

**S3-09 · Colour is decorative, not semantic.** Blue, green, amber, red, purple all appear as chrome on one screen. Every reference product uses exactly one functional accent.

**S3-10 · Surfaces are separated by borders rather than lightness.** The asset detail page renders ten bordered field boxes. ChatGPT and Claude use hairline dividers only and lift surfaces with a few percent of lightness.

**S3-11 · Four stacked header bands on Command Center** before any content — title bar (5 stats, 2 buttons), a notice line, a commissioning band (8 pills + a `Next:` line), a status card (4 pills + timestamp). Reference products use one header row.

**S3-12 · Content clipped by fixed chrome.** The Command Center right pane's title is overlapped by the header band. Reference products let content scroll under translucent chrome.

**S3-13 · All-caps micro-labels with icons, all at equal weight** — ten field labels on the asset page with no hierarchy.

**S3-14 · Leaked internal status string.** `monday context loading…` in the Scan page header — lowercase, untranslated, internal.

**S3-15 · Redundant metrics.** Command Board shows `7 OPEN WORK ORDERS` and `7 TOTAL WORK ORDERS` as separate tiles, plus two tiles reading `0`.

---

## What FactoryLM already gets right

Recorded deliberately — these are assets to protect, not accidents.

1. **`Asset-scoped` badge on the MIRA chat.** Explicitly names the conversation's context. Better than a breadcrumb; conceptually equal to ChatGPT's scoped placeholder.
2. **The MIRA greeting names the asset and its ID.** `Ask me anything about Garage Conveyor (OTHE-3PMTTSX8)`.
3. **The Assets index is close to convention** — H1, search, filter chips (`All / Operational / Warning / Critical / Idle`), count, card grid with status. This is the most conventional screen in the product.
4. **Asset cards carry status as a coloured pill** — a legitimate domain addition; equipment has state that a chat does not.
5. **`← Assets` back link** on the detail page.
6. **`Scan plate` / `Upload photo` as the two entry paths** — the right two options, correctly ranked.
7. **Filter chips already match the category pattern.**
8. **The underlying object model is right.** Assets, work orders, documents, parts, activity and scans are the correct nouns for this domain. The problem is presentation and navigation, not the model.

---

## Evidence index

| ID | Route | Action | Resulting state |
|---|---|---|---|
| FLM-A-01 | `/` | cold load | Command Board: `L5 — Proposal flywheel` bar, 4 KPI tiles (two zero, two identical), WO feed, floating `+` FAB. **No composer.** |
| FLM-B-01 | `Command Center` | nav | 4 stacked header bands; 8-pill commissioning checklist; dead-end empty state; clipped pane title |
| FLM-B-02 | `Scan` | nav | **shell gone, light theme, no nav, no back**; `monday context loading…`; two buttons on an empty page |
| FLM-C-01 | `Assets` | first click | row highlights, **no navigation, no feedback**, two rows active |
| FLM-C-02 | `Assets` | second click | index renders: H1, search, chips, 5 cards, 4 header buttons, two assets named `Stardust Racers` |
| FLM-F-01 | asset detail | open `Garage Conveyor` | **8 tabs**; gradient CTA banner; 6 of 10 fields empty/junk; `Create work order (no anomaly yet)` |
| FLM-D-01 | asset → `Ask MIRA` | tab | literal `**Garage Conveyor**`; suggestions as quoted plain text; **left-aligned blue message breaks speaker encoding**; no attach; no message actions |
| FLM-I-01 | `Ask MIRA` | send message | `Chat unavailable (412). Try again or refresh the page.` — static, non-dismissible, in-stream, no retry; message duplicated in transcript and composer |
| FLM-G-01 | `Knowledge` | nav | defaults to `Map`: 47-node graph, 7 type checkboxes, `Size by influence`, verified/proposed edge legend |

**Not walked this pass:** Namespace, Channels, Notebooks, CMMS, Visual Workspace, Review queue, Settings, Tour, logged-out entry, mobile.
