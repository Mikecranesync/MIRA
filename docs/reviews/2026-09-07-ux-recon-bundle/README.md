# AI PRODUCT UX RECON — FINAL DELIVERABLE

**For:** the FactoryLM development team · **Date:** 2026-09-07
**Products studied:** ChatGPT (deep, authenticated) · Grok · Claude · Gemini · Perplexity, then FactoryLM itself
**Status:** PATTERN CONVERGED — broad reconnaissance closed

```
recon/
├── README.md                        ← you are here: the five answers
├── AI_APP_COMMON_PATTERN.md         ← Phase 2: patterns, classified, with evidence counts
├── FACTORYLM_UX_GRAMMAR.md          ← Phase 3: the rules, CONVENTION vs DIFFERENTIATION
├── FACTORYLM_UX_ACCEPTANCE.md       ← Phase 4: 74 outside-in tests + the one that matters
├── chatgpt/PRODUCT_ANATOMY.md       ← the baseline, in full
├── claude/  grok/  gemini/  perplexity/PRODUCT_ANATOMY.md   ← deltas
└── factorylm/CURRENT_STATE_AUDIT.md ← what we do today, walked with the same framework
```

---

## 1. What modern AI apps universally do

**The home screen is a greeting and a text box.** Five out of five. No dashboard, no metrics, no tour.

**A sidebar that never unmounts holds history.** Only the main panel swaps between routes — no flash, no re-render.

**One `+` at the composer's left edge is the only door to every capability.** Files, photos, image generation, search, connectors, tools. Nothing is promoted to a toolbar.

**The composer slides from centre to bottom on first send** — the same element animating, so continuity is never broken.

**The send slot is a state machine, not a button:** mic when idle, send when there is text, stop while generating. One position, three meanings.

**The user's message is a right-aligned bubble; the assistant's answer has no bubble at all** and reads as a document at full column width.

**Everything is at most three levels deep**, the deepest level is always a conversation, and back always works.

**One accent colour, no shadows, three type sizes, one high-emphasis button per screen.**

---

## 2. What users now unconsciously expect

These are the things nobody notices until they are missing.

- **Typing works immediately.** No selection, no setup, no mode choice first.
- **Back returns them to the exact pixel** they were reading, not to the top of the thread.
- **Relaunching lands them where they were.**
- **The chat names itself** within a few seconds — nothing is ever `Untitled`.
- **They can copy any answer** without hunting for the control.
- **`Escape` closes anything**, and the app stays visible behind every overlay.
- **An error does not cost them their work** — the composer keeps the text and stays usable.
- **The waiting state is a word, not a spinner.** Spinners read as broken.
- **Long answers scroll under the composer**, never behind a hard edge.
- **Suggestions are tappable.** Text they must retype is not a suggestion.

---

## 3. What FactoryLM currently violates

Walked live on 2026-09-07. Full detail in `factorylm/CURRENT_STATE_AUDIT.md`.

**The seven that break a universal convention:**

| # | Violation | What a user experiences |
|---|---|---|
| 1 | **No composer on the home screen.** Command Board opens on KPI tiles, a `Proposal flywheel` progress bar and a work-order feed. | A technician cannot ask anything from the landing screen. Reaching the AI takes three navigations. |
| 2 | **`Scan` leaves the app shell entirely** — sidebar gone, theme flips dark→light, no in-app back. | The user is trapped, on the product's most important screen. |
| 3 | **Message alignment does not encode speaker.** A long blue message renders left-aligned while other user messages render right-aligned in the same blue. | You cannot tell who said what. |
| 4 | **Raw markdown leaks into output** — the MIRA greeting shows literal `**Garage Conveyor**`. | The first message a user ever sees looks broken. |
| 5 | **Errors show HTTP status codes with no recovery.** `Chat unavailable (412). Try again or refresh the page.` — a static, non-dismissible red banner permanently in the transcript, no retry button. | `412` means nothing. "Refresh the page" is the developer's job, handed to the user. |
| 6 | **A failed message exists twice** — as a sent bubble and still in the composer. | You cannot tell whether it sent. |
| 7 | **No message actions anywhere.** No copy, retry, feedback, sources or timestamps. | A technician cannot paste a diagnosis into a work order. |

**And the pattern underneath all of them:**

> FactoryLM is currently built as **an operations console that contains an AI feature**. Every product in this study is built as **an AI surface that contains operations**.

Also serious: 13 primary nav items against a category norm of 5–6 · 8 tabs on an asset page against ChatGPT's 2 · roughly a dozen invented nouns (`Namespace`, `Command Board`, `Command Center`, `Proposal flywheel`, `Verified edges`, `Intel`, `Validate`) where Perplexity was marked down in this study for inventing **one** · `Knowledge` opening on a 47-node graph instead of on manuals · two assets both displayed as `Stardust Racers` · `MODEL: 1` and `SERIAL: 1` presented as data · a gradient CTA that reads as an ad · no way to attach a photo from a conversation, in a product whose spine is photo→nameplate.

**What is already right, and should be protected:** the `Asset-scoped` badge, the greeting naming the asset and its ID, the Assets index (H1 + search + status chips + cards) which is the most conventional screen in the product, `Scan plate` / `Upload photo` as the two correctly-ranked entry paths, and the underlying object model — assets, work orders, documents, parts, scans are the right nouns. **The problem is presentation and navigation, not the data model.**

---

## 4. What FactoryLM should standardize

The five that unblock everything else:

1. **Make the composer the home screen.** Greeting, focused input, three suggestions drawn from live equipment state. The KPI tiles and flywheel bar leave.
2. **Never break the shell.** No route may remove the sidebar, change the theme, or leave the user without an in-app back.
3. **Fix the conversation:** render markdown, enforce user-right-bubble / assistant-left-no-bubble, make suggestions tappable chips, and put a persistent action row under every answer with **copy** as non-negotiable.
4. **Rewrite errors to the ChatGPT rule** — degrade to the nearest working state, explain in plain language, offer a **button**. No status codes, no permanent red banners.
5. **Make the asset page ChatGPT's project page** — scoped composer on top, four tabs below (`Chat · Details · History · Files`), placeholder naming the asset. The gradient banner and the `Ask MIRA` tab both disappear, because asking stops being a destination.

Then: 13 nav items → 5 + `More ›` · 8 tabs → 4 · every invented noun → a word a technician already uses.

---

## 5. Where FactoryLM should intentionally differentiate

Nineteen deliberate departures, each justified in `FACTORYLM_UX_GRAMMAR.md`. The six that matter most:

1. **Inline citation chips naming the manual and page** — `📖 SKF 6205 · p.14`, not `[3]`. A number tells a technician nothing until they click; a name lets them judge the claim inside the sentence. This is the product's whole commercial claim, and it is the demo-day priority that has a UI attached.
2. **Unsourced claims are visibly labelled** — `⚠ General guidance — no manual on file for this asset`. The reference products can afford an unattributed claim. A wrong torque spec has physical consequences.
3. **Offline is a first-class state, not an error.** Cached manuals stay readable, the composer stays usable, messages queue and send on reconnect. Every reference product assumes connectivity because their users are at desks. Ours are in steel buildings next to VFDs. **No reference product offers a pattern here** — this is genuine, defensible differentiation.
4. **The camera is promoted out of the `+` menu** into its own permanent composer button. ChatGPT promotes exactly one capability (voice); we promote the one that is our spine.
5. **The waiting state names the step** — `Reading the nameplate…` → `Finding the manual…` → `Checking work order history…`. Every reference product's waiting state is content-free; that is a universal weakness, and naming the step turns a variable multi-step pipeline from "broken" into "diagnostic".
6. **A permanent, tappable scope badge** naming the machine. ChatGPT solves scope with a placeholder that disappears when you type. Answering about the wrong machine is a safety problem, not an inconvenience.

Plus: depth named by outcome (`Quick / Standard / Deep` — **never a model name**), an action row split into *act on this* / *check this* with `Add to work order` in it, missing nameplate fields that state their consequence and offer the scan, and history grouped by time — which no reference product does, and which a technician tracking a recurring fault needs.

---

## 6. The tests that prove we got it right

`FACTORYLM_UX_ACCEPTANCE.md` — **74 tests, all outside-in.** Every one is judged from what is on screen; none asserts that an endpoint returned 200 or that a component mounted. **28 are P0 ship gates.**

And the one that outranks all of them:

> ### Z-1 · The five-minute stranger test
> Hand a phone running FactoryLM to a maintenance technician who has never seen it and who uses ChatGPT weekly. Say only: *"Find out what the grinding noise on that conveyor might be."* Then say nothing for five minutes.
>
> **Pass:** they start typing or scanning **without asking a question**; they reach a cited answer within five minutes **without instruction**; they can say afterwards where the answer came from; and they never say *"what do I press?"* or *"where did it go?"*
>
> If Z-1 passes, the grammar is right. If it fails, no individual test matters yet.

---

## The one-sentence finding

**The app grammar converged four products ago — so not one hour should go into re-deciding where the sidebar lives. What separates mature AI products is the domain object they put inside the shell: Claude's is a durable artifact, Perplexity's is a cited result, and FactoryLM's is a machine that is currently broken and a technician who has to fix it.**

---

## Honest limits of this study

- **Grok and Perplexity were walked logged out.** Signing in was out of bounds. Grok's authenticated shell, history and chat lifecycle are entirely untested; Perplexity's Projects and history likewise. Evidence counts are stated against what was *observable*, not against five.
- **Mobile was excluded by scope.** All mobile guidance is inference from responsive structure and is labelled as such in both the grammar (§8) and the tests (section H).
- **Failure behavior was tested in depth in ChatGPT only**, and observed incidentally in FactoryLM via a real 412. Network loss and mid-stream generation failure were tested nowhere.
- **Some adopted rules rest on one or two products** — search behavior, message asymmetry, capped reading measure. They are adopted on quality and domain fit, not on consensus, and each says so where it appears.
- **Screenshots were captured live**; the recon environment returned no retrievable file paths, so every evidence index entry is a **reproducible journey** — route → action → resulting state — that the team can re-run directly. That is more useful to a developer than an opaque PNG.
