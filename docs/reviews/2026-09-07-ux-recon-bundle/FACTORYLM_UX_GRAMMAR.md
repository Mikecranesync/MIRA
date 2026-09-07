# FACTORYLM UX GRAMMAR

**Derived from:** `AI_APP_COMMON_PATTERN.md` (5-product synthesis) and `factorylm/CURRENT_STATE_AUDIT.md`
**Date:** 2026-09-07

**The rule that governs this document:**
> Do not innovate where users already have a strong learned convention, unless industrial work genuinely requires it.

Every **numbered** rule below is tagged (the §9 presentation table and the §2.9 tap table are all conventions and are not tagged individually):

- **CONVENTION** — follow it exactly. The user already knows it. Originality here costs us and buys nothing.
- **DIFFERENTIATION** — deliberately different, because maintenance work requires it. Each one carries a justification. If the justification does not hold, the rule reverts to convention.

**The governing sentence for the whole product:**
> FactoryLM is an AI surface that contains operations — not an operations console that contains an AI feature.

---

## 1. APP SHELL

**1.1 CONVENTION — One shell, never unmounted.**
Sidebar + header persist across every route. Only the main slot swaps. No route change may remove the sidebar, change the theme, or leave the user without a way back.
*Fixes: S1-02 (Scan leaves the shell).*

**1.1b CONVENTION — One header row per screen.**
A screen gets a title row and nothing else above the content. Status counts, commissioning state and system health move into the content area or behind `More › Live view`. No reference product uses more than one header band.
*Fixes: S3-11.*

**1.2 CONVENTION — Five primary nav items, everything else behind `More ›`.**

```
  ✎ New                 ← always first, always sticky
  🔧 Assets
  📋 Work Orders
  📖 Manuals
  ⧉ Scans
  ⋯ More ›              ← flyout: CMMS · Integrations · Namespace ·
                          Notebooks · Channels · Review queue · Settings
  ── Pinned ──
  ── Recent ──
  [MH] Mike Harper · Owner
```
Thirteen items become five. Nothing is deleted; secondary destinations move into the flyout.
> **Evidence note:** the *ceiling* of 5–6 primary items holds across ChatGPT (5), Claude (5) and Gemini (6). The `More ›` *flyout mechanism* is ChatGPT's alone (`n=1/5`) — Gemini deliberately does the opposite, promoting Images and Videos to top level. We adopt the ceiling as convention and the flyout as our chosen mechanism for hitting it.
*Fixes: S2-01.*

**1.3 CONVENTION — Plain nouns only. Every invented word is deleted.**

| Retire | Use |
|---|---|
| Command Board | Home |
| Command Center | Live view *(under More)* |
| Namespace | Equipment map *(under More)* |
| Knowledge | Manuals |
| Intel *(tab)* | Insights |
| Validate *(tab)* | Verify |
| Channels | Alerts |
| threads / sessions *(if either appears)* | Chats |
| `L5 — Proposal flywheel`, `Namespace readiness`, `VERIFIED EDGES`, `Auto-extracted PMs`, `One-Board Status` | delete from all user-facing surfaces |

Perplexity was marked down in this study for inventing **one** noun (`Sessions`). We currently have about a dozen, two of which differ by a single word.
*Fixes: S3-01.*

**1.4 CONVENTION — One accent colour. Depth from lightness, not borders or shadows.**
One blue for interactive/primary. Hairline dividers only; no bordered field boxes. Surfaces lift by a few percent of lightness.
*Fixes: S3-09, S3-10.*

**1.5 DIFFERENTIATION — Equipment status colour is semantic and exempt.**
`Operational / Warning / Critical / Idle` keep green / amber / red / grey.
> **Justification:** a chat has no state; a machine does, and a technician reads that state before reading anything else. This is the one place where colour must carry meaning beyond interactivity. It is confined to status pills and status dots — never to buttons, icons, headers, or backgrounds.

**1.6 CONVENTION — One high-emphasis action per screen.** Everything else is a subtle filled surface or a borderless icon. No gradient CTAs anywhere.
*Fixes: S2-07, S3-08.*

**1.7 CONVENTION — Chrome floats; content is one continuous scroll surface.** Translucent header and composer; content passes beneath them and is never clipped.
*Fixes: S3-12.*

---

## 2. NAVIGATION RULES

**2.1 CONVENTION — Maximum depth three.** `Home → Asset → Chat`. `Home → Work Order → Chat`. Nothing deeper.

**2.2 CONVENTION — Back and forward restore scroll position and per-conversation settings.** Verified in both ChatGPT and Claude. Returning to a chat must land on the identical pixel, with that chat's answer-depth setting intact.

**2.3 CONVENTION — Opening an existing chat lands at the newest message.**

**2.4 CONVENTION — Exactly one nav row is active at a time**, and it clears when the user navigates home.
*Fixes: S2-08.*

**2.5 CONVENTION — Every navigation is instant.** If a route needs data, render the shell and the page frame immediately and fill the content with skeletons. A nav click must never produce a highlight and nothing else.
*Fixes: S2-08.*

**2.6 CONVENTION — Overlays float without a backdrop dim; `Escape` and `×` always close; the shell stays clickable behind them.** No blocking modals on launch.

**2.7 CONVENTION — Maximum four tabs per object.**
Asset detail goes from eight tabs to four:

```
  [ Chat ]  [ Details ]  [ History ]  [ Files ]
```
- **Chat** — the default tab (see 3.1)
- **Details** — nameplate + specs + PM dates *(absorbs Details, Parts)*
- **History** — work orders, activity, machine memory, past scans *(absorbs Activity, Work Orders)*
- **Files** — manuals, photos, nameplate images *(absorbs Documents)*

`Intel` and `Validate` move into Details as sections, not tabs.
*Fixes: S2-02.*

**2.8 CONVENTION — Tabs change the panel, never the shell.** The title row and the composer stay pixel-identical across tab switches (ChatGPT's project page rule).

**2.9 Target tap counts from cold launch:**

| Action | Target | Today |
|---|---|---|
| Ask a general question | **0** (composer focused on Home) | impossible |
| Scan a nameplate | **1** | 1 *(but exits the shell)* |
| Ask about a specific asset | **2** | 3 |
| Open a work order | **1** | not measured |
| Attach a photo to a chat | **2** | impossible |
| Find a manual page | **2** | not measured |

---

## 3. CONVERSATION RULES

**3.1 CONVENTION — The composer is the home screen, and it is focused on arrival.**

```
                    Ready when you are, Mike.

        ┌──────────────────────────────────────────────┐
        │ +  Ask about a machine, or scan a plate   ⌄🎤│
        └──────────────────────────────────────────────┘

          🔧 Garage Conveyor — lubrication check open 123d
          ⚠  Discharge Conveyor — bearing temp 82 °C last month
          📷 Finish the nameplate scan you started Friday
```
The KPI tiles, the flywheel bar and the work-order feed leave the home screen. Home is a greeting, a composer, and three contextual suggestions.
*Fixes: S1-01, S3-02, S3-15.*

**3.2 DIFFERENTIATION — Home suggestions are drawn from live equipment state, not from prompt ideas.**
Following ChatGPT's connector-derived suggestions (D-1), each row carries a source glyph and names real pending work: an open WO, a flagged reading, an unfinished scan.
> **Justification:** a technician arrives with a machine already in mind. A generic prompt starter (`Try asking about PM schedules`) is worthless; `Discharge Conveyor — bearing temp 82 °C last month` is the actual reason they opened the app.
Rows are **one-tap**, never quoted text (see 3.4).

**3.3 CONVENTION — Message asymmetry, strictly enforced.**
User: right-aligned, filled bubble, capped at ~60% of the measure. Assistant: **no bubble**, left-aligned, full column width, reading like a document. **No message is ever left-aligned and filled.**
*Fixes: S1-03, S2-06 — the most serious readability defect in the product today.*

**3.4 CONVENTION — Suggestions are one-tap chips, never quoted text in a bubble.**
`• "What are the most common faults for this equipment?"` becomes a tappable chip. A suggestion the user has to retype is not a suggestion.
*Fixes: S2-04.*

**3.5 CONVENTION — Markdown is rendered, never displayed.**
*Fixes: S1-04.*

**3.6 CONVENTION — Persistent action row under every completed answer.**
`copy · 👍 · 👎 · ↻ retry · ⋯` — plus the FactoryLM-specific actions in 3.7.
**Copy is mandatory and non-negotiable.** A technician pastes diagnoses into work orders.
*Fixes: S1-07.*

**3.7 DIFFERENTIATION — The action row splits into *act on this* and *check this*, following Perplexity (D-10).**

```
  📋 Copy   ⊕ Add to WO   🖨 Print          │   📖 3 sources   👍  👎   ⋯
  └─── act on the answer ──────────────┘       └── check the answer ──┘
```
> **Justification:** a maintenance answer has exactly two fates — it becomes an action (a work order, a parts order, a printed procedure), or it gets challenged. `Add to work order` is the closed loop this product exists to deliver; it belongs in the action row, not behind a menu.

**3.8 DIFFERENTIATION — Message timestamps.** Relative for recent (`just now`, `2h ago`), absolute for older.
> **Justification:** only Claude does this (`n=1/5`), so it is not a convention we are inheriting — it is a choice. When a reading was taken is part of the reading, and a technician reviewing yesterday's diagnosis needs to know it was yesterday's.

**3.9 CONVENTION — The state-dependent placeholder.**
Home: `Ask about a machine, or scan a plate`. In an asset chat: `Ask about Garage Conveyor`. Generating: `Follow up`. After an answer: `Ask a follow-up`.

**3.10 DIFFERENTIATION — Every chat displays its scope as a badge, permanently.**
Keep and elevate the existing `Asset-scoped` badge, but name the actual scope: `🔧 Garage Conveyor` · `📋 WO-837C0E5A` · `🌐 All equipment`.
> **Justification:** ChatGPT solves scope with a placeholder that disappears the moment you type. In maintenance, answering a question about the wrong machine is a safety problem, not an inconvenience. Scope must remain visible for the life of the conversation, and must be tappable to change.

**3.11 CONVENTION — Retained, inspectable reasoning: `Checked 3 sources · 4s ›`.**
Collapsed by default, expandable, permanent, above the answer. Claude and Perplexity both do this.
> Reinforced by domain need: a technician who is about to lock out a machine has to be able to see what the answer was based on.
*Fixes: S2-09.*

**3.12 CONVENTION — Auto-title every chat immediately; never leave `Untitled`.**
*Guards against the Gemini `Untitled notebook` ×2 failure and our own duplicate `Stardust Racers`.*

**3.13 CONVENTION — `Clear` requires confirmation, or is replaced by `New chat`.**
*Fixes: S2-10.*

**3.14 CONVENTION — Floating scroll-to-bottom on scroll detach.**

---

## 4. COMPOSER RULES

**4.1 CONVENTION — One `+`, and it is the only door to attachments and tools.**
```
Add photo · Scan nameplate · Attach manual page · Add from asset files
─────────────────────────────────────────────────────────────────────
Look up part · Create work order · Check PM schedule
─────────────────────────────────────────────────────────────────────
Limble · MaintainX · Atlas                              [Connect]
─────────────────────────────────────────────────────────────────────
Type to search assets, manuals, parts and work orders
```
Three unlabelled groups separated by spacing (ChatGPT's `+` anatomy), each row `icon · bold label · muted description`, an inline `Connect` on unconnected integrations, and a **search footer rather than submenus**.
*Fixes: S2-05.*

**4.2 DIFFERENTIATION — The camera is promoted out of the `+` menu and given its own permanent button.**
ChatGPT promotes exactly one capability — voice — out of the `+`. We promote the camera.
> **Justification:** photo → nameplate → manual → work order is the product's spine. Burying the spine's entry point one tap inside a menu, on a phone, in a plant, is indefensible. It is the one capability that cannot wait for a menu.
Result: `[+] [📷] ...text... [depth ⌄] [🎤] [send]`.

**4.3 CONVENTION — The send slot is a state machine.** idle → 🎤 · has text → ↑ filled high-contrast · generating → ■ stop. Never a low-contrast grey send.
*Fixes: S2-11.*

**4.4 DIFFERENTIATION — The depth control is named by outcome and by job, following Gemini (P-2) and Grok.**

```
  Quick        Fast answer from what we already know
  Standard  ✓  Checks the manual and asset history
  Deep         Full diagnostic — cross-checks PMs, parts and past WOs
```
> **Justification:** a technician on a ladder cannot interpret `Extra High` or `Opus 5`. Never expose a model name or a numeric magnitude in the composer. The collapsed control shows the **current value** (`Standard`), never the parameter name — Perplexity's `Model ⌄` is the failure case to avoid.

**4.5 CONVENTION — The composer relocates from centre to bottom on first send**, as the same animating element.

**4.6 CONVENTION — In a thread the composer sheds weight**; the depth indicator moves out beside the disclaimer (Claude's rule).

---

## 5. PROJECT / ASSET STRUCTURE

**5.1 CONVENTION — The asset page is ChatGPT's project page.** This is the single highest-leverage transplant available.

```
  ← Assets
  🔧 Garage Conveyor            ● Operational   Medium criticality
  OTHE-3PMTTSX8 · Lake Wales, FL
                                                    [Share] [⋯]
  ┌──────────────────────────────────────────────────────────┐
  │ +  📷  Ask about Garage Conveyor      Standard ⌄  🎤     │  ← composer ON TOP
  └──────────────────────────────────────────────────────────┘

    [ Chat ]  [ Details ]  [ History ]  [ Files ]
    ──────────────────────────────────────────────────────────
    Bearing noise on drive end                          Sep 6
    what does the grinding at startup mean

    Lubrication check procedure                         Aug 30
    walk me through the PM checklist
```
The composer is at the top because an asset page is **a place you start work**, not a record you read. The gradient banner and the `Ask MIRA` tab both disappear — asking is no longer a destination.
*Fixes: S2-03, S3-08.*

**5.2 CONVENTION — Cards, not tables, for the asset index** — with a description line, keeping the existing search + status chips.

**5.3 CONVENTION — Every object is auto-named at creation and names are disambiguated.**
Two assets may not both read `Stardust Racers`. Append the distinguishing attribute to the visible title: `Stardust Racers — Ride 1` / `Stardust Racers — Ride 2`.
*Fixes: S3-03.*

**5.4 CONVENTION — Never show a raw identifier as a primary label.**
`enterprise.home_garage.conveyor_lab.conveyor_1` becomes `Conveyor Lab · Conveyor 1`, with the raw path available on hover or in Details.
*Fixes: S3-04.*

**5.5 DIFFERENTIATION — Empty fields state their consequence and offer the fix.**
`MODEL: 1` and `SERIAL: 1` are worse than empty — they are false confidence. Where a nameplate field is missing or junk:
> `Model unknown — scan the nameplate to fill this in` `[📷 Scan]`
> **Justification:** in a general assistant, a missing field is cosmetic. Here, a missing model number is the difference between a cited manual answer and a guess. The gap must be visible and one tap from repair.
*Fixes: S3-05.*

**5.6 CONVENTION — Empty states never dead-end.** Every empty state names the next action. `Create work order (no anomaly yet)` becomes `No runs recorded yet` + `[Log a reading]`.
*Fixes: S3-06, S3-07.*

**5.7 CONVENTION — `Add files` is the first row of the Files list**, not a header button.

**5.7b CONVENTION — A failed upload is stated, retryable, and never silently loses the file.**
**5.7c CONVENTION — A thumbnail either renders or shows a meaningful type glyph** — never an empty grey rectangle (W-3).

**5.8 CONVENTION — Ingested files are renamed at ingest.**
`image-1781126450592.jpg` never reaches a user-facing list. Nameplate photos become `Nameplate — Garage Conveyor — Sep 6`.
*Guards against: W-2 (observed in ChatGPT and Gemini; FactoryLM's own instance is S3-04, fixed by 5.4).*

---

## 6. MANUALS, CITATIONS AND EVIDENCE

**6.1 DIFFERENTIATION — Inline citation chips naming the manual and page, following Perplexity (D-8).**
> "Check shaft play before condemning the motor. `📖 SKF 6205 · p.14`"

> **Justification:** this is the product's whole claim. `[3]` tells a technician nothing until they click; `SKF 6205 · p.14` lets them judge the claim inside the sentence and go find the page. Mike's own roadmap names "cited answers with page references" as a demo-day priority — this is its UI.

**6.2 DIFFERENTIATION — Three-level source disclosure, none of which navigates away.**
1. Chip in the sentence: `📖 SKF 6205 · p.14`
2. Count in the action row: `📖 3 sources`
3. Popover: `thumbnail · manual name · page · matched snippet`

**6.3 DIFFERENTIATION — Claims without evidence are labelled, not hidden.**
An answer drawn from general knowledge rather than this asset's manuals carries `⚠ General guidance — no manual on file for this asset` with a `[Add manual]` action.
> **Justification:** the reference products can afford an unsourced claim. A wrong torque spec has physical consequences. **The distinction between "the manual says" and "generally speaking" must be visible in the answer, not inferable from the absence of a chip.**

**6.4 CONVENTION — `Manuals` opens on a list of manuals.**
The knowledge-graph `Map` moves behind `More › Equipment map`, and is never the default view of the place manuals live.
*Fixes: S3-02.*

---

## 7. LOADING, ERROR AND FAILURE BEHAVIOR

**7.1 CONVENTION — Skeletons for lists, words for generation. No spinners.**

**7.2 DIFFERENTIATION — The waiting state names the step.**
Not `Thinking`. `Reading the nameplate…` → `Finding the manual…` → `Checking work order history…`
> **Justification:** with a target of sub-2s first token but a multi-step OCR → match → retrieve pipeline, the wait is real and variable. Every reference product's waiting state is content-free, and W-4 records that as a universal weakness. Naming the step converts dead time into visible work and makes a slow answer feel diagnostic rather than broken.

**7.3 CONVENTION — Errors follow the ChatGPT rule: degrade to the nearest working state, explain in a dismissible layer, offer a next action.**

Every error answers three questions:

| Question | Requirement |
|---|---|
| What happened? | Plain language. **No HTTP status codes.** |
| Is my work safe? | Say so explicitly, and show it — the composer keeps the text |
| What now? | A **button**, not an instruction to refresh |

Today: `Chat unavailable (412). Try again or refresh the page.`
Required: `Couldn't reach MIRA. Your message is saved.` `[Retry]` `[×]`
*Fixes: S1-05.*

**7.4 CONVENTION — Errors are dismissible toasts, never permanent rows in the transcript.**
*Fixes: S1-05.*

**7.5 CONVENTION — A failed message exists in exactly one place.** Either it is in the transcript marked failed with an inline retry, or it is back in the composer. Never both.
*Fixes: S1-06.*

**7.6 DIFFERENTIATION — Offline is a first-class state, not an error.**
When connectivity drops: a persistent (not dismissible) status strip, `⚡ Offline — showing saved manuals and asset history`, cached content stays readable, the composer stays usable, messages queue and send on reconnect.
> **Justification:** every reference product assumes connectivity because their users are at desks. Ours are in steel buildings, in basements, next to VFDs. **Offline is not an edge case in this product; it is Tuesday.** No reference product offers a pattern here — this is genuine, defensible differentiation.

**7.7 DIFFERENTIATION — Offer to hand off long waits, following Claude (D-3).**
`This may take a minute. [Notify me]` — shown once a response passes **15 seconds**.
> **Justification:** the technician put the phone in their pocket and climbed onto the machine. Claude built this for distracted desk workers; our users are not merely distracted, they are physically elsewhere and holding tools.

---

## 8. MOBILE BEHAVIOR

> **Evidence status:** this section is **inference, not observation.** Mobile was excluded from the recon by scope. These rules follow from the responsive structure of the reference products and from the domain, and must be validated before being treated as findings.

**8.1 CONVENTION — The sidebar becomes a drawer.** Same content, same order, same active state.

**8.2 CONVENTION — No bottom tab bar.** The composer already carries the primary actions; the reference products all keep everything in the composer and the drawer.

**8.3 CONVENTION — The reading measure does not change.** Desktop is already capped near 640px, so phone is desktop minus the sidebar.

**8.4 CONVENTION — Same routes, same URLs, same back behavior.** System back must map to in-app back.

**8.5 DIFFERENTIATION — Touch targets are 48px minimum, and the camera button is thumb-reachable.**
> **Justification:** gloves, and one hand on a railing. This is also why 4.1's flat searchable `+` menu beats Gemini's nested submenus — every `›` is another precise tap.

**8.6 DIFFERENTIATION — Photo capture opens the camera directly, not a source picker.**
> **Justification:** the technician is standing in front of the nameplate. The overwhelmingly common case should not cost a disambiguation tap.

---

## 9. PRESENTATION RULES

| Property | Rule |
|---|---|
| **Type sizes** | Three: greeting ~28px · body ~16px · meta ~13px. Hierarchy by weight and colour, not size. |
| **Type family** | Sans for chrome. Serif or sans for answer body — pick one and never mix. |
| **Radius** | Two values: full-round for pills and buttons; ~12–16px for cards, menus and the composer. |
| **Shadows** | None. Depth is lightness and translucency. |
| **Borders** | Hairline dividers only. No bordered field boxes. |
| **Colour** | One accent for interactive. Status colour permitted **only** in equipment status pills and dots (1.5). |
| **Icons** | Single-weight line icons. Paired with text in nav; unlabelled in action rows. |
| **Buttons** | Three tiers, one high-emphasis instance per screen. **No gradients.** |
| **Labels** | Sentence case. No all-caps micro-labels. *Fixes: S3-13.* |
| **Measure** | ~640px, centred, constant. |
| **Empty states** | Never blank. Always name the next action. |
| **Disabled** | Replace the control rather than disabling it (the send-slot rule). |
| **Internal strings** | No build, integration or debug string ever renders in the interface (`monday context loading…`). *Fixes: S3-14.* |

---

## 10. STATE PERSISTENCE RULES

**10.1 CONVENTION — Back/forward restores route, scroll position and per-conversation settings.**

**10.2 CONVENTION — Relaunch restores the last route.** Reopening lands where the user left, at the same scroll position.

**10.3 CONVENTION — Draft text survives navigation.** Typed-but-unsent text is preserved per conversation.

**10.4 CONVENTION — Answer depth is per-conversation, not global** (ChatGPT's rule: an old thread reopened at `5.5 Medium` while a new one was `Extra High`).

**10.4b CONVENTION — Conversations are findable by message content, not just by title.**
Search matches inside message bodies and shows the matched sentence with the term emphasised (ChatGPT's search behavior, S-15).

**10.4c DIFFERENTIATION — History is grouped by time.**
`Today · Yesterday · This week · Earlier`.
> **Justification:** **no reference product does this** — W-1 records it as a universal weakness. A technician tracking a recurring fault across weeks needs "when", and a flat list cannot answer it. This is a deliberate improvement on the category, not an inherited convention.

**10.5 DIFFERENTIATION — Scope is sticky and survives everything.**
An asset-scoped chat stays asset-scoped through relaunch, reconnect, and offline recovery. Scope may only change by explicit user action on the badge (3.10).
> **Justification:** silently losing scope means silently answering about a different machine.

**10.6 DIFFERENTIATION — Queued messages survive app close.**
A message composed offline sends on next connect, even if the app was closed in between.

---

## SUMMARY OF DIFFERENTIATION

Fourteen deliberate departures. Every other rule in this document is convention.

| # | Differentiation | Because |
|---|---|---|
| 1.5 | Semantic status colour on equipment | machines have state; chats don't |
| 3.2 | Suggestions from live equipment state | the tech arrives with a machine in mind |
| 3.7 | Action row split act-on / check | answers become work orders or get challenged |
| 3.8 | Message timestamps | n=1/5 in the study; when a reading was taken is part of the reading |
| 3.10 | Permanent, tappable scope badge | wrong-machine answers are a safety problem |
| 4.2 | Camera promoted out of `+` | photo→nameplate is the product spine |
| 4.4 | Depth named by outcome and job | never show a model name to a technician |
| 5.5 | Missing nameplate fields state consequence + offer fix | a missing model number breaks citation |
| 6.1 | Inline manual + page citation chips | the product's entire claim |
| 6.2 | Three-level source disclosure | evidence must be checkable without leaving |
| 6.3 | Unsourced claims explicitly labelled | wrong torque specs have physical consequences |
| 7.2 | Waiting state names the step | multi-step pipeline, variable latency |
| 7.6 | Offline as a first-class state | steel buildings, basements, VFDs |
| 7.7 | Offer to hand off long waits | the tech is on the machine, holding tools |
| 8.5 | 48px touch targets | gloves |
| 8.6 | Camera opens directly, no source picker | the tech is standing at the nameplate |
| 10.4c | History grouped by time | no reference product does this; recurring faults need "when" |
| 10.5 | Scope is sticky across relaunch and reconnect | silently losing scope answers about the wrong machine |
| 10.6 | Queued messages survive app close | offline work must not evaporate |

**Everything else is convention. Follow it exactly.**
