# THE COMMON PATTERN OF MODERN AI APPLICATIONS

**Synthesis of:** ChatGPT (deep, authenticated) · Claude (authenticated) · Gemini (authenticated) · Perplexity (unauthenticated) · Grok (unauthenticated)
**Date:** 2026-09-07 · **Status:** PATTERN CONVERGED
**Organized by pattern, not by company.**

Each pattern carries a **classification** and an **evidence count** — `n/5` products where the behavior could actually be observed. Patterns with low n are labelled as such rather than being asserted as universal.

---

## THE ONE-PARAGRAPH VERSION

Modern AI applications have converged on a single interaction grammar. The home screen is a focused text box under a greeting. A sidebar that never unmounts holds history. One `+` hides every capability. The composer slides from centre to bottom on first send and its right-hand button changes identity — mic, then send, then stop. The user's message is a right-aligned bubble; the assistant's answer has no bubble at all and reads as a document. Everything is at most three levels deep, back always works, and the whole system is drawn in one accent colour with no shadows. **This grammar is now settled.** What separates mature products from each other is not the shell — it is the domain object they put inside it.

---

# HOW TO READ THE EVIDENCE COUNTS

`n = products where the behavior was actually observed / products where it was observable`.

**Two products were walked logged out.** Grok showed no shell, no sidebar, no history, no account row, and produced **no answer at all**. Perplexity showed no Projects, Artifacts or history interior. So for any rule about the shell, history, the account row, or the answer lifecycle, **the maximum attainable n is 3 or 4, never 5.** Counts below reflect that. Where a rule is strong but thinly evidenced, it says so; a rule at n=1 or n=2 is a *lead*, not a law, and is marked accordingly.

---

# PART 1 — UNIVERSAL
*Observed in every product where it could be observed. Deviating will be read as a bug.*

### U-1 · The home screen is a greeting and a text box
`n=5/5`. Every product opens on a centred greeting with a composer directly beneath it.
> ChatGPT `Ready when you are.` · Claude `Back at it, Mike` · Gemini `What should we focus on?` · Perplexity `What do you want to know?` · Grok `¿Qué debemos explorar?`

Four of the five show *nothing else* — no dashboard, no metrics, no feature grid, no tour. **Perplexity is the partial exception**, adding two capability tiles below the composer.

**Composer focused on arrival is a separate, weaker claim:** verified in ChatGPT only (`n=1/5`). Treat "zero taps to start" as a target we are adopting from ChatGPT, not as a category-wide observation.

### U-2 · A persistent shell that never unmounts
`n=4/4 observable`. A left sidebar and header remain fixed across every route change; only the main slot swaps. No flash, no re-render, no spinner over the shell. *Grok logged out has no shell at all, so it is not counted.*

### U-3 · The composer relocates from centre to bottom on first send
`n=4/4 observable`. The same element animates to a new position. *Grok produced no answer, so no relocation was observable.*

### U-4 · The send slot is a state machine, not a button
`n=4/4 observable`.

| State | Control |
|---|---|
| idle, empty | mic (and/or voice) |
| has text | send, filled, high contrast |
| generating | stop |

One position, three meanings. **Grok is a counter-example, not an instance**: it renders send in its enabled state even when empty — the only product that does not use the send control to communicate readiness.

### U-5 · Conversations are auto-titled and appear in history immediately
`n=4/4 observable`. The history entry exists before the answer does. Titles are model-generated, never user-required. *Grok has no history logged out.*

### U-6 · The model/effort control lives inline in the composer
`n=5/5`. Never in settings. It sits in the composer's control row because it is a property of the message about to be sent.
*Scope note: this covers the **model/effort** control only. Where the **mode** switch lives is a product choice with four different answers — see P-1. Claude further moves its model indicator out of the composer once inside a thread (CL-7).*

### U-7 · One `+` at the composer's left edge
`n=5/5` for the control. **What is behind it is not universal:** a full capability menu was observed in ChatGPT and Gemini only (`n=2/5`); Grok's `+` is a plain attach control (`Adjuntar`), and Claude's and Perplexity's menu contents were not opened this pass. The *position and single-door principle* is universal; the *menu anatomy* is a ChatGPT/Gemini pattern.

### U-8 · Overlays float and do not trap
`n=3/3 observable`. Menus and palettes open over content **without a dimmed backdrop**, leaving the shell visible and clickable; `Escape` or `×` always closes.
**Two blocking overlays were observed** and are counter-examples: Claude's cold-launch announcement modal (dimmed backdrop) and Perplexity's cookie consent dialog.

### U-9 · One accent colour, no shadows
`n=5/5`. Depth comes from a few percent of surface lightness and from translucency, never from drop shadows. Colour is functional, never decorative.
*The "hairline borders" clause is separated out: ChatGPT and Claude use hairline dividers; Grok records hairline-**free** surfaces. Border treatment is `n=2/5` and belongs in Part 3.*

### U-10 · An AI disclaimer sits adjacent to the composer
`n=4/5`. Small, muted, always present, never a dialog. *Not recorded in Perplexity.*

### U-11 · Shallow navigation
`n=3/3 observable`. Home → conversation; collection → item → conversation. Nothing goes deeper than three levels, and the deepest level is always a conversation. *Grok's navigation could not be assessed; Perplexity's Projects interior was not walked.*

---

# PART 2 — STRONG CONVENTION
*Most products where it was observable do it similarly. Deviating is defensible but costs the user something.*

### S-1 · A persistent action row under every completed answer
`n=3/4 observable`. Copy, feedback, regenerate, share — visible after completion without hovering, muted, unlabelled, borderless, left-aligned to the message. Observed in ChatGPT, Claude and Perplexity.
**Gemini has none** — not persistent, not on hover. The clearest regression against convention in the study. *Grok produced no answer.*

### S-2 · Message asymmetry — user is a bubble, assistant is a document
`n=2/2 recorded`.

| | User | Assistant |
|---|---|---|
| container | rounded bubble, filled | **none** |
| alignment | right | left, full column width |

Recorded explicitly in ChatGPT and Claude. Gemini and Perplexity did not have message container treatment recorded this pass; Grok produced no assistant message. **Thinly evidenced but strongly held** — it is the visual rule most likely to be noticed when broken, and FactoryLM currently breaks it (see the audit's S1-03).

### S-3 · Back and forward restore scroll position
`n=2/2 tested`. Independently verified in ChatGPT and Claude: navigating away and back returns the user to the **identical pixel**.
**Per-conversation settings restoration is a narrower claim** — verified in ChatGPT only (`n=1/2`), where an old thread reopened at `5.5 Medium` while a new one was `Extra High`.

### S-4 · Reasoning retained as an inspectable, collapsed trace
`n=2/5`. Claude `Thought for 10s ›`; Perplexity `Finished 1 step ›`. Both expandable, both above the answer, both permanent. ChatGPT and Gemini discard it.
**Emerging, not settled.** Two independent instances in products whose answers get acted on. For FactoryLM the domain argument carries this rule, not the count.

### S-5 · Placeholder micro-copy changes with state
`n=2/4 observable`. `Ask ChatGPT → Follow up`; `Type @ for connectors → Ask a follow-up`. Claude's stays static (`Write a message…`); Grok's is a static advertisement.

### S-6 · Chrome floats; content is one continuous scroll surface
`n=2/3 observable`. Header and composer translucent and blurred, text passing beneath them. ChatGPT and Claude. Gemini uses an opaque band.

### S-7 · A floating scroll-to-bottom control on scroll detach
`n=2/4 observable`. ChatGPT and Claude. Absent in Gemini; not recorded in Perplexity.

### S-8 · Skeletons for lists; a word or glyph for generation
`n=2/4` for skeletons (ChatGPT search results, Gemini's pending sidebar row) and `n=2/4` for a worded generation state (ChatGPT `Thinking`, Claude `Figuring`).
**Gemini is a counter-example on the second half** — a wordless dot cluster. The reliable part of this rule is narrower than it first appears: **no product used a spinner or a progress bar for generation in anything observed here**, but that is an absence, not a measurement.

### S-9 · Nav sections carry their own empty states
`n=2/5`. `Pin projects to keep them here` (Claude, instructive) · `No projects` / `No recent sessions` (Perplexity, merely declarative). **The instructive form is materially better.**

### S-10 · Filter chips above collections
`n=2/5`. ChatGPT (`All / Created by you / Shared with you`; `All / Chats / Images / Documents`) and Claude (`All / Yours / Shared with you`).

### S-11 · Pinned items hoisted above recents
`n=2/4 observable`. ChatGPT and Claude. Gemini pins in place inside `Recents`, which defeats the purpose.

### S-12 · The account control is the last row of the sidebar
`n=3/3 observable`. Sticky at the bottom, showing avatar, name and plan. ChatGPT, Claude, Gemini. *Grok withholds the account row logged out; Perplexity shows `Sign In` in the same position, which is the same slot serving the logged-out case.*

### S-13 · The reading measure is capped and centred
`n=1/5` — **ChatGPT only**, at roughly 640px, with user bubbles right-aligned to the same measure. Not recorded in the other four. **This is a single-product observation that two downstream rules depend on** (grammar §8.3, acceptance H-6). It is adopted because a capped measure is well-established typographic practice, not because the study proved it is a category convention. Flagged for validation.

### S-14 · A secondary-destination overflow keeps primary nav small
`n=1/5` — **ChatGPT only** (`More ›` holding Images, Health, Finances, Sites, GPTs). Claude's nav has no overflow. **Gemini actively contradicts it**, promoting Images, Videos and Notebooks to top-level destinations. The *ceiling* of 5–6 primary items holds across ChatGPT (5), Claude (5) and Gemini (6); the *mechanism* for staying under it is ChatGPT's alone.

### S-15 · Search is a floating palette, content-matched
`n=1/5` — **ChatGPT only.** Search was a declared gap in Claude and Gemini and was not walked in Perplexity or Grok. Every specific in this pattern is a single-product observation: no backdrop dim; empty query shows recent items rather than a blank box; results are content-matched with the query term bolded in the matched sentence; relative dates for recent items, absolute for older. **Adopt on quality, not on consensus.**

---

# PART 3 — PRODUCT CHOICE
*Several valid answers exist. Pick one deliberately; do not mix them.*

### P-1 · Where the mode switch lives — **four different answers**
| Product | Location | Form |
|---|---|---|
| ChatGPT | header, centred | segmented `Chat \| Work` |
| Claude | sidebar top **and** composer | segmented `Home \| Code` + pills `Chat \| Cowork` |
| Gemini | sidebar top | segmented `Chat \| Spark BETA` |
| Perplexity | composer control row | chips `🔍 Search ⌄ · ▭ Computer` |

All four are legible. **Claude's two-location split is the one weak variant** — the user cannot tell that one switch is app-wide and the other is per-message.

### P-2 · How effort and model are expressed — **three answers, ranked**
1. **Gemini — job descriptions.** `3.5 Flash-Lite / Fastest answers` · `3.8 Flash / All-around help` · `3.1 Pro / Advanced reasoning`, with `Extended thinking / Complex problem solving` separated below. Keeps the names *and* explains the job. **Best for a non-expert who must justify a choice.**
2. **Grok — outcome names.** `Fast · Auto · Expert · Heavy`. No parameters to interpret. Undermined by fusing a product mode (`Build`) into the same list.
3. **ChatGPT — magnitude then taxonomy.** A 5-notch slider labelled `Thinking effort`, with the model list one level deeper behind `›`, defaulting to `Latest`. Elegant, but `Extra High` means nothing on its own.
**Perplexity is the failure case:** its control reads `Model ⌄` — the parameter name rather than the current value — so the user cannot see what they are set to.

### P-3 · How capability menus scale
- **ChatGPT — flat list + `Type to search plugins, files, folders & skills`.** Stays 8 rows forever. Scales infinitely. Requires knowing a name.
- **Gemini — nested submenus (`More uploads ›`, `More tools ›`).** Browsable without knowing names. Every level costs another precise tap.
**On a phone, with gloves, the flat searchable list wins.**

### P-4 · How collections are rendered
- **Table** (ChatGPT Projects): `Name | Modified`. Dense, sortable, gives no context.
- **Cards** (Claude Projects/Artifacts): title + description + date + status. Fewer per screen, self-describing.
**Cards win for objects the user must *recognise*; tables win for objects the user must *sort*.**

### P-5 · How a pending conversation appears in history
- **Optimistic text** (ChatGPT): raw prompt immediately, then rewritten twice. Informative, flickers.
- **Skeleton** (Gemini): grey bar, filled once. Stable, uninformative — the user cannot find their own new thread.
- **Final title up front** (Claude): titled before the first token. Calmest; fails worst if titling fails.

### P-6 · How the answer arrives
- **Token stream** (observed in ChatGPT; assumed in Claude and Perplexity but not recorded this pass): words appear left to right.
- **Structure-first fade** (Gemini): the answer's *shape* — one paragraph, four list items — paints at low opacity, then content fades in. The reader learns the answer's structure before reading a word.
**For a skimming reader hunting one item out of four, structure-first is arguably better.**

### P-7 · Where generated outputs live
- **A dedicated indexed object type** (Claude `Artifacts`) — findable, shareable, versioned, with `Edited <date>`.
- **Media-type destinations** (Gemini `Images`, `Videos`).
- **A tab inside the parent** (ChatGPT project `Sources`).
- **A view of the result** (Perplexity `Links`, `Images` tabs).

### P-8 · Whether the thread has a visible title
- **Yes** (Claude): title + `⌄` in the header. The user always knows which thread they are in.
- **No** (ChatGPT, Gemini): title lives only in the sidebar, so a collapsed sidebar leaves the thread anonymous.
**Claude's is better and costs one row.**

### P-9 · What fills the empty state
- **Contextual, source-attributed suggestions** (ChatGPT): `✉ Check the new Vercel domain configuration warning` — real pending work from connected systems.
- **Capability cards** (Perplexity): two tiles teaching the two modes.
- **Nothing** (Claude): cleanest, teaches least.

### P-10 · Typography of the answer
- **Serif body** (Claude, Perplexity) — reads as prose.
- **Sans body** (ChatGPT, Gemini) — reads as interface. *Grok produced no answer, so its answer typography is unknown.*
Both work. Sans chrome + serif content is the sharper split.

---

# PART 4 — DIFFERENTIATORS
*Unique behavior, not industry convention. These are where products actually compete.*

### D-1 · Suggestions drawn from the user's real connected work — **ChatGPT**
Home suggestions are not prompt starters. Each carries a source glyph and names actual pending work: a Gmail warning, a GitHub PR, an agent awaiting a decision. The blank screen is filled with **the user's own backlog**, not with ideas.

### D-2 · Steering a response mid-generation — **Claude**
A floating `Quick answer` pill during generation lets the user redirect the answer in flight. Everyone else offers stop and nothing else.

### D-3 · Offering to hand off the wait — **Claude**
`Want to be notified when Claude responds?` `[Notify]` `[×]`. The product admits generation can outlast attention and offers an exit instead of demanding the user watch the screen.

### D-4 · Outputs promoted to a first-class indexed object — **Claude**
`Artifacts` in primary nav, with its own index, privacy state, sharing, and edit history. Outputs escape the transcript.

### D-5 · Teaching structure with a shipped, populated example — **Claude**
`How to use Claude`, badged `Example project`, sits in the Projects index from day one. **The cheapest onboarding mechanism in the study** — no tour, no modal, no instructional copy. One real object demonstrates the shape.

### D-6 · Structure-first rendering — **Gemini**
See P-6.

### D-7 · The answer is one view of a result — **Perplexity**
Header tabs `Answer | Links | Images`. Everyone else returns a single artifact.

### D-8 · Inline citation chips that name the source — **Perplexity**
A claim ends with `emersoneins +6` — publisher name plus overflow count, not a superscript number. **A number tells you nothing until you click; a name lets you judge the claim inside the sentence.**

### D-9 · Three-level source disclosure without navigation — **Perplexity**
Pill in the sentence → `🔵🟢🔴 10 sources` in the action row → popover with `favicon · domain · bold title · snippet`. No level navigates away.

### D-10 · Splitting the action row by intent — **Perplexity**
Left: act on the answer (`copy · export · ⑂ branch`). Right: judge the answer (`sources · 👍 · 👎 · ⋯`).

### D-11 · Branching a conversation from any answer — **Perplexity**
A `⑂` control in the action row forks the thread from that point, so a second hypothesis can be explored without losing the first. No other product in the study offers it.

### D-12 · Suggested follow-ups after every answer — **Perplexity**
Five `↳` rows phrased as complete queries, placed where the user actually has a next question.

### D-13 · The placeholder teaches an affordance — **Perplexity**
`Type @ for connectors`. Compare Grok's `Cambia al modo Build para crear apps` — the same line spent on an advertisement.

---

# PART 5 — WHAT EVERYONE GETS WRONG
*Universal weaknesses. Beating these is free differentiation.*

### W-1 · Nobody groups history by date. `n=2/4 recorded`
Recorded explicitly in ChatGPT and Gemini; Claude and Perplexity show a single undifferentiated list with no grouping stated. No product in the study was observed grouping history by date. Once history is long, "when did I look at that" is unanswerable without search. For anyone tracking a recurring problem over weeks, this is a real loss.

### W-2 · Raw filenames and machine identifiers are shown as labels. `n=2/5`
`image-1781126450592.jpg` (ChatGPT Sources) · `Untitled notebook` ×2 (Gemini nav). *FactoryLM has the same defect (`enterprise.home_garage.conveyor_lab.conveyor_1`) but is the subject of the study, not a reference product, so it is not counted.* **Anything ingested must be renamed by what it is, at ingest.**

### W-3 · Preview slots that never fill. `n=2/5`
Flat grey squares (ChatGPT), empty dark rectangles (Claude Artifacts). A preview area that never loads is worse than no preview area.

### W-4 · Waiting states do not say how long. `n=4/5`
`Thinking`, `Figuring`, a dot cluster. Only Claude reports duration, and only *after* the fact. Nobody sets an expectation before the wait.

### W-5 · Commercial furniture in the workspace. `n=4/5`
Claude's blocking launch modal; Gemini's promo card in the action corner; Perplexity's two simultaneous signin solicitations, one of which covers generated content; Grok's four monetization surfaces on a one-input screen. **ChatGPT's home sells nothing, and it is the calmest home in the study.**

### W-6 · Stale active-row highlights. `n=1/5`
ChatGPT only: navigating home leaves the previous conversation highlighted in the sidebar, so the nav claims a thread is open when it is not. *FactoryLM has a worse version of the same defect but is not counted here.*

### W-7 · Inconsistent empty-input handling within one product. `n=1/5`
ChatGPT's Chat surface replaces send with mic; its Work surface shows a greyed-out send. Two answers to one question inside one product.

---

# PART 6 — THE CONVERGENCE FINDING

**New grammar rules contributed, in study order:**

| Product | New rules | Character |
|---|---|---|
| ChatGPT | *(baseline)* | — |
| Grok | **1** | outcome-named effort levels |
| Claude | **6** | durable outputs, retained reasoning, wait handoff |
| Gemini | **2** | job-described models, structure-first rendering |
| Perplexity | **12 nominal / ~4 grammar-adjacent** | mostly domain adaptations for provenance |

Perplexity's raw count is the highest in the study, so the convergence call needs justifying rather than asserting.

**Most of what Perplexity contributed is domain adaptation, not grammar.** Its shell, navigation, composer behavior, send/stop semantics, history model, empty-state handling and presentation system are the baseline unchanged. Result views, citation chips, three-level source disclosure, follow-up rows and branching all exist because Perplexity must show provenance — those are *domain object* inventions.

Four of its twelve are genuinely grammar-adjacent and should be counted as such: mode named above the greeting (PPX-8), mode chips in the composer (PPX-9, which this document elevates to a fourth valid answer at P-1), auth as a dismissible side-sheet (PPX-11), and nav empty states (PPX-12, counted as evidence at S-9). PPX-10 is the second instance that makes retained reasoning a convention at S-4. So the honest count is roughly **4 grammar-adjacent, 8 domain** — not zero.

**The convergence call therefore rests on Grok and Gemini alone, and it survives without Perplexity.** Those are the two products in the sequence that are general-purpose assistants like the baseline, and they contributed **1 and 2** grammar rules respectively — two consecutive mature products adding almost nothing. **The convergence condition is met on that basis.**

> ### The finding
> **The app grammar converged. Differentiation now lives entirely in the domain object a product puts inside the shell.**
>
> Claude's object is a durable artifact. Perplexity's is a cited result. ChatGPT's is a project of connected work.
>
> **FactoryLM's object is a machine that is currently broken, and a technician who has to fix it.** That object — asset identity, evidence, provenance to a manual page, and a closed loop to a work order — is where every unit of design effort should go. Not one unit should go into re-deciding where the sidebar lives.

---

## Evidence limitations

Stated plainly so the team can weight the conclusions.

- **Logged-out observation caps the attainable evidence count.** With Grok and Perplexity walked unauthenticated, no rule about the shell, history, the account row or the answer lifecycle can reach `n=5/5`. Counts in Parts 1 and 2 are stated against what was observable, not against five.
- **Several rules adopted here rest on one or two products** (S-12 search, S-2 message asymmetry, S-4 retained reasoning). They are adopted on quality and on domain fit, not on consensus, and are labelled as such rather than dressed up as universal.

- **Grok and Perplexity were observed logged out.** Signing in was out of scope. Grok's authenticated shell, history, projects and chat lifecycle are entirely untested; Perplexity's Projects, Artifacts and history are untested. Grok's `n=1` grammar contribution may understate it.
- **Mobile was excluded by scope.** No native app and no mobile-web emulation. All mobile guidance downstream is inference from responsive structure, and is labelled as such.
- **Failure behavior was tested in depth in ChatGPT only** (invalid conversation URL) and observed incidentally in FactoryLM (a real 412). Network loss, mid-stream generation failure and attachment failure were tested nowhere.
- **Back/forward scroll restoration was verified in 2 products**, not 5.
- Screenshots were captured live; the recon environment returned no retrievable disk paths, so every evidence index entry is recorded as a **reproducible journey** (route → action → resulting state) that the team can re-run directly.
