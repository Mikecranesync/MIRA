# FACTORYLM UX ACCEPTANCE MODEL

**Derived from:** `FACTORYLM_UX_GRAMMAR.md`
**Date:** 2026-09-07

## How to use this

Every test below is **outside-in**: it is written from what a person sees on a screen, and it is judged by one question —

> **Would a normal modern-app user perceive this as behaving correctly?**

Rules for this suite:

- A test may only reference things **visible on screen**. No test asserts that an endpoint returned 200, that a component mounted, or that state was set.
- Each test names its **observer** — the persona whose expectation it encodes.
- Each test is **binary**. If a result needs a paragraph to explain why it half-passes, it fails.
- `[P0]` blocks release · `[P1]` blocks the demo · `[P2]` next iteration.

**Observers:**
- **T — Technician.** Uses ChatGPT daily on their phone. Has never seen FactoryLM. Gloves on. Standing at a machine.
- **S — Supervisor.** Wants to know where an answer came from before authorising work.
- **N — New user.** First launch, no data, no explanation.

---

## A. COLD LAUNCH

**A-1 `[P0]` · The first thing on the screen is a text box.** — *T*
**Do:** open the app logged in.
**Pass:** a composer is visible without scrolling, the cursor is already in it, and typing a character produces text with no prior click.
**Fail:** any dashboard, KPI tile, progress bar or feed occupies the primary position.

**A-2 `[P0]` · Nothing blocks the first action.** — *T*
**Pass:** no modal, dialog, tour or announcement appears on launch. Any promotional content is dismissible and does not overlap the composer.

**A-3 `[P1]` · A new user can name what the product does in one sentence after five seconds.** — *N* · *No single grammar rule; this is the whole of §1 and §3 working together.*
**Do:** show the home screen for five seconds, hide it, ask "what is this for?"
**Pass:** the answer references equipment, machines or maintenance.
**Fail:** the answer references dashboards, data or "some kind of monitoring thing."

**A-4 `[P1]` · No invented vocabulary is visible on the home screen.** — *N*
**Pass:** every visible word is one a maintenance technician already uses. Specifically absent: `Namespace`, `Command Board`, `Command Center`, `Proposal flywheel`, `Verified edges`, `Auto-extracted PMs`.

**A-5 `[P1]` · The home screen offers at least one thing worth tapping, drawn from real equipment.** — *T*
**Pass:** at least one suggestion row names a real asset, work order or reading, and tapping it starts a conversation without further typing.
**Fail:** suggestions are generic prompt ideas, or are text the user must retype.

**A-6 `[P2]` · Primary navigation has no more than six items** before an overflow control.

---

## B. NEW CHAT AND STREAMING

**B-1 `[P0]` · Asking a question takes zero taps from home.** — *T*
**Pass:** type, press Enter, an answer begins. No navigation, no mode selection, no asset selection required first.

**B-2 `[P0]` · The user can tell who said what without reading the words.** — *T*
**Do:** blur or squint at a conversation of four or more messages.
**Pass:** user messages are right-aligned filled bubbles; assistant answers are left-aligned, **unbubbled**, full column width. No message is both left-aligned and filled.
**Fail:** any ambiguity about the speaker of any message.

**B-3 `[P0]` · No raw markup is ever visible.** — *T*
**Pass:** no `**`, `##`, `[]()` or `\n` appears as literal text in any message, including the first greeting.

**B-4 `[P0]` · Something changes on screen within 1 second of pressing Enter.** — *T*
**Pass:** the message appears, the composer moves to the bottom, and a waiting state renders. All within 1s, whether or not the answer has started.

**B-5 `[P1]` · The waiting state says what is happening.** — *T*
**Pass:** the waiting indicator names the current step (e.g. `Finding the manual…`) rather than showing only a spinner, a dot cluster, or the bare word `Thinking`.

**B-6 `[P0]` · Generation can be stopped.** — *T*
**Pass:** during generation the send control is replaced in the same position by a stop control; pressing it halts output and leaves the partial answer readable.

**B-7 `[P1]` · Scrolling up during generation does not fight the user.** — *T*
**Pass:** the view stays where the user put it, and a scroll-to-bottom control appears. It disappears at the bottom.

**B-8 `[P0]` · Every completed answer can be copied.** — *T*
**Do:** finish an answer, look for copy without hovering, click it, paste elsewhere.
**Pass:** a copy control is visible without hovering, and the pasted text is the answer with formatting intact and no markup artefacts.
**Fail:** no visible action row (current state).

**B-9 `[P1]` · Every completed answer can be retried and rated.** — *T*
**Pass:** retry, 👍 and 👎 are visible in the action row without hovering.

**B-10 `[P1]` · The chat is titled by itself within 10 seconds.** — *T*
**Pass:** a descriptive title appears in the history list. No chat ever reads `Untitled` or shows the raw prompt permanently.

**B-11 `[P1]` · The answer reads as a document, not as a chat log.** — *S*
**Pass:** a 300-word answer with headings and a list renders at full column width with intact hierarchy, and is not compressed into a width-capped bubble.

**B-12 `[P2]` · Messages carry a timestamp** — relative for recent, absolute for older.

---

## C. ATTACHMENT AND PHOTO

**C-1 `[P0]` · A photo can be attached from inside a conversation.** — *T*
**Pass:** the composer offers photo attachment without leaving the conversation. Two taps maximum.
**Fail:** no attach control in the composer (current state).

**C-2 `[P0]` · Scanning a nameplate never leaves the app.** — *T*
**Do:** start a scan from anywhere.
**Pass:** the sidebar remains, the theme does not change, and an in-app back control is visible at all times.
**Fail:** the shell disappears, the theme flips, or the only way back is the browser (current state).

**C-3 `[P1]` · The camera is reachable in one tap on mobile.** — *T*
**Pass:** a camera control is visible in the composer without opening a menu, and tapping it opens the camera — not a source picker.

**C-4 `[P1]` · An uploaded file is named by what it is.** — *T*
**Pass:** after a nameplate scan, the file appears in the asset's Files list as something like `Nameplate — Garage Conveyor — Sep 6`.
**Fail:** any user-facing list shows `image-1781126450592.jpg`.

**C-5 `[P1]` · A failed upload says so and offers retry.** — *T* · *Grammar §5.7b*
**Do:** attach a photo with connectivity disabled.
**Pass:** the failure is stated in plain language, the photo is not silently lost, and a retry control is present.

**C-6 `[P1]` · A thumbnail either renders or shows a meaningful placeholder.** — *T* · *Grammar §5.7c*
**Fail:** an empty grey rectangle indistinguishable from a broken image.

---

## D. ASSET AND WORK ORDER NAVIGATION

**D-1 `[P0]` · Asking about a specific machine takes two taps from home.** — *T*
**Pass:** home → asset → typing. The composer on the asset page is focused and ready.
**Fail:** any path requiring a banner click or a tab switch before typing (current state: three taps).

**D-2 `[P0]` · The asset page's first element is a composer.** — *T*
**Pass:** below the asset title, the next element is an input whose placeholder names the asset (`Ask about Garage Conveyor`).
**Fail:** a gradient banner, a specification grid, or a tab strip occupies that position.

**D-3 `[P1]` · An asset page has no more than four tabs.** — *T*
**Fail:** eight tabs (current state).

**D-4 `[P1]` · Switching tabs does not move the title or the composer.** — *T*
**Pass:** the title row and composer are pixel-identical across all tab switches; only the panel below changes.

**D-5 `[P0]` · The conversation always shows which machine it is about.** — *T, S*
**Pass:** a scope badge naming the asset is visible at every scroll position for the life of the conversation, and tapping it allows changing scope.

**D-6 `[P1]` · Two assets are never displayed with the same name.** — *T*
**Do:** view the asset index with two similarly-named machines.
**Pass:** visible titles are distinguishable without reading the ID.
**Fail:** two rows both reading `Stardust Racers` (current state).

**D-7 `[P1]` · No raw system identifier appears as a primary label.** — *T*
**Fail:** `enterprise.home_garage.conveyor_lab.conveyor_1` shown as an object's name or subtitle (current state).

**D-8 `[P1]` · A missing nameplate field is visibly missing and one tap from repair.** — *T*
**Pass:** unknown fields read `Model unknown — scan the nameplate to fill this in` with a scan action.
**Fail:** `MODEL: 1` or `SERIAL NUMBER: 1` presented as data (current state).

**D-9 `[P1]` · Every empty state names a next action.** — *N*
**Fail:** any empty state that only reports absence, or whose button label argues against pressing it (`Create work order (no anomaly yet)`).

---

## E. EVIDENCE AND CITATIONS

**E-1 `[P0]` · A supervisor can tell where a claim came from without leaving the sentence.** — *S*
**Do:** read an answer containing a specific figure (torque, clearance, temperature).
**Pass:** the claim carries an inline chip naming the manual and page (`📖 SKF 6205 · p.14`).
**Fail:** a bare superscript number, or no attribution at all.

**E-2 `[P0]` · Sourced and unsourced claims are visibly different.** — *S*
**Pass:** an answer with no manual on file for the asset carries an explicit label (`⚠ General guidance — no manual on file`).
**Fail:** an unsourced answer is visually identical to a sourced one.

**E-3 `[P1]` · Checking a source never leaves the conversation.** — *S*
**Pass:** the source count opens a popover showing manual name, page and matched snippet. The conversation stays on screen.

**E-4 `[P1]` · The reasoning behind an answer can be inspected.** — *S*
**Pass:** a collapsed, expandable trace (`Checked 3 sources · 4s ›`) sits above the answer and persists after completion.

**E-5 `[P1]` · `Manuals` opens on manuals.** — *T*
**Pass:** the default view of the manuals destination is a searchable list of manuals.
**Fail:** a node graph with type checkboxes as the default view (current state).

---

## F. HISTORY, BACK AND STATE

**F-1 `[P0]` · Back returns to the previous screen, always.** — *T*
**Pass:** from every screen — including scan, an asset chat, and a work order — browser/system back returns to the immediately preceding screen. No screen is reachable that back cannot leave.

**F-2 `[P0]` · Returning to a conversation lands where you left it.** — *T*
**Do:** scroll to the middle of a long chat, navigate away, come back.
**Pass:** the same content is on screen at the same position. Verified in both ChatGPT and Claude; users will notice its absence.

**F-3 `[P1]` · Reopening a chat restores its own settings.** — *T*
**Pass:** answer depth is per-conversation. Opening an old chat set to `Quick` shows `Quick`, not the global default.

**F-4 `[P1]` · Unsent text survives navigation.** — *T*
**Do:** type without sending, navigate away, come back.
**Pass:** the text is still in the composer.

**F-5 `[P0]` · Relaunch returns the user to where they were.** — *T*
**Do:** open an asset chat, close the app, reopen it.
**Pass:** the same conversation, at the same scroll position, with the same scope badge.

**F-6 `[P1]` · Exactly one navigation item is highlighted at a time**, and none is highlighted on home. — *T*
**Fail:** two rows appearing active simultaneously (current state).

**F-7 `[P1]` · Every conversation is findable by its content, not just its title.** — *T* · *Grammar §10.4b*
**Pass:** searching a word that appears in a message body returns that conversation, with the matched sentence shown and the term emphasised.

**F-8 `[P2]` · History is grouped by time** (Today / Yesterday / This week / Earlier).
*Grammar §10.4c. No reference product does this — it is a deliberate improvement on a universal weakness (W-1), because a technician tracking a recurring fault needs "when".*

---

## G. ERRORS AND OFFLINE

**G-1 `[P0]` · No error ever shows a status code.** — *T*
**Fail:** `Chat unavailable (412)` or any bare number (current state).

**G-2 `[P0]` · Every error answers three questions on screen.** — *T*

| Question | Observable requirement |
|---|---|
| What happened? | one plain sentence, no codes, no jargon |
| Is my work safe? | stated explicitly, and demonstrated — the typed text is still there |
| What now? | a **button**, not an instruction to refresh |

**G-3 `[P0]` · Errors are dismissible and do not become permanent content.** — *T*
**Pass:** the error is a toast or inline notice with a dismiss control, and it does not remain in the transcript after dismissal.
**Fail:** a static red banner permanently occupying a message slot (current state).

**G-4 `[P0]` · A failed message exists in exactly one place.** — *T*
**Fail:** the message appearing both as a sent bubble and still in the composer (current state).

**G-5 `[P0]` · An error never costs the ability to act.** — *T*
**Pass:** after any error, the composer is focused and usable, navigation works, and previously loaded content is still visible.

**G-6 `[P1]` · Retry is a button, and it works.** — *T*
**Pass:** tapping retry resends without the user retyping.

**G-7 `[P1]` · Offline is announced, and the app stays useful.** — *T*
**Do:** disable connectivity mid-session.
**Pass:** a persistent status strip states the app is offline and what still works; previously loaded manuals and asset history remain readable; the composer accepts input.
**Fail:** blank screens, spinners that never resolve, or an error dialog.

**G-8 `[P1]` · A message written offline sends when connectivity returns** — including after the app was closed — and its queued state is visible while it waits.

**G-9 `[P1]` · A long wait offers a handoff.** — *T*
**Pass:** past the 15-second threshold set in grammar §7.7, an offer to notify on completion appears, with a dismiss control.

**G-10 `[P2]` · No internal string ever reaches the interface.**
**Fail:** `monday context loading…` in a page header (current state).

---

## H. MOBILE

> **Status: unvalidated.** Mobile was excluded from the recon by scope; these tests encode the grammar's inferences and must be run before the inferences are trusted.

**H-1 `[P0]` · Every interactive target is at least 48×48px.** — *T*
**Do:** run the primary flow wearing work gloves.
**Pass:** no mis-taps on send, camera, back, or scope badge.

**H-2 `[P0]` · The sidebar becomes a drawer with the same content and order.** — *T*

**H-3 `[P0]` · System back maps to in-app back** at every depth, and never exits the app from a sub-screen.

**H-4 `[P1]` · The composer stays visible when the keyboard opens**, and the last message remains readable above it.

**H-5 `[P1]` · The camera control is reachable with one thumb** without repositioning the phone.

**H-6 `[P1]` · The reading measure is unchanged from desktop.** *(Rests on a single-product observation — S-13, ChatGPT only. Validate the premise before trusting the test.)* An answer is not narrower or denser on a phone; the phone layout is the desktop layout minus the sidebar.

**H-7 `[P1]` · The same URL opens the same screen on phone and desktop.** — *T*

---

## I. VISUAL PRESENTATION

**I-1 `[P0]` · The theme never changes within a session.** — *T*
**Fail:** any route rendering a light page inside a dark app (current state: Scan).

**I-2 `[P1]` · Exactly one high-emphasis button per screen.** — *T*
**Do:** screenshot each primary screen and count filled, high-contrast buttons.
**Fail:** four header buttons with two competing blues (current state: Assets).

**I-3 `[P1]` · No gradient is used on an interactive control.** — *T*
**Fail:** the full-width gradient `Chat with MIRA about this asset` banner (current state).

**I-4 `[P1]` · Colour outside equipment status is monochrome plus one accent.** — *T*
**Pass:** on any screen, the only non-neutral colours are the single interactive accent and equipment status pills/dots.

**I-5 `[P1]` · Content is never clipped by fixed chrome.** — *T*
**Fail:** a panel title overlapped by a header band (current state: Command Center).

**I-6 `[P2]` · No more than three type sizes** are used on any screen.

**I-7 `[P2]` · Surfaces are separated by lightness and hairlines**, not by boxed borders.

**I-8 `[P2]` · No all-caps micro-labels.** Sentence case throughout.

---

## RELEASE GATES

**P0 — 28 tests. Ship gate.**
Concentrated in five areas. Four of the five have **observed** current-state failures; the fifth is untested:

1. **The composer is the home screen** — A-1 and B-1 fail today (FLM-A-01: no input on the home route). *A-2 is currently a pass — no launch modal was observed — and is listed to protect it.*
2. **Speaker identity and rendering** — B-2 and B-3 fail today (FLM-D-01).
3. **The shell is never broken** — C-2 and I-1 fail today (FLM-B-02: Scan drops the shell and flips the theme). *F-1 is untested: browser back does work from Scan; what is missing is an in-app back, which C-2 covers.*
4. **Answers are actionable and attributable** — B-8 fails today (no action row, FLM-D-01). E-1 and E-2 are **untested**: generation never succeeded (FLM-I-01), so citation behavior has not been observed either way.
5. **Errors are humane and non-destructive** — G-1 through G-5 all fail today, observed on a real 412 (FLM-I-01).

**P1 — 38 tests.** Demo gate.
**P2 — 8 tests.** Next iteration.

**74 tests total, plus Z-1.**

---

## THE ONE TEST THAT MATTERS

**Z-1 · The five-minute stranger test.**

**Do:** hand a phone running FactoryLM to a maintenance technician who has never seen it, who uses ChatGPT weekly. Say only: *"Find out what the grinding noise on that conveyor might be."* Then say nothing for five minutes.

**Pass:**
- They start typing or scanning **without asking a question**
- They reach a cited answer within five minutes **without instruction**
- They can say afterwards where the answer came from
- They never say *"what do I press?"* or *"where did it go?"*

**Fail:** any of the above.

If Z-1 passes, the grammar is right. If it fails, no individual test above matters yet.
