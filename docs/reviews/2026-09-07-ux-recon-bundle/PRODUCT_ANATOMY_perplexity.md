# PRODUCT ANATOMY — Perplexity (web)

**Recon date:** 2026-09-07 · **Surface:** perplexity.ai desktop web, **logged out**, dark theme
**Pass type:** DELTA against ChatGPT baseline · **Convergence checkpoint**

---

## Product thesis

**Perplexity is optimized for a defensible answer.** Everything structural follows from that. The answer is not the whole output — it is one tab of a result object (`Answer | Links | Images`). Claims carry inline source pills naming the actual publisher. The action row is split into *act on this* and *judge this*. And every answer ends with five suggested follow-up queries, because a research answer's job is to produce the next question.

For FactoryLM this is the most directly relevant product in the study. A technician acting on a diagnosis has the same requirement a researcher does: **show me where this came from, at the granularity of the claim.**

---

## What Perplexity does the same as ChatGPT

The convergence list is now long enough to be the headline finding.

- Persistent left sidebar; main slot swaps by route
- Centred question-greeting + one composer as the entire home
- One `+` as the attach entry point
- Model control inline in the composer's control row
- Send slot swaps identity; circular filled send
- Composer docks to bottom after the first message
- **Placeholder changes with state**: `Type @ for connectors` → `Ask a follow-up`
- Conversation appears in sidebar history immediately, titled, with `⋯` on hover
- Nav sections carry empty states (`No projects`, `No recent sessions`)
- Escape/× dismisses overlays; overlays float without blocking the shell
- Serif answer body (matching Claude), sans chrome
- Near-black ground, one accent, no shadows, hairline dividers

---

## NEW rules Perplexity introduces

**PPX-1 — The answer is one view of a result, not the result.**
Header tabs `🔮 Answer | 🌐 Links | 🖼 Images`, active tab underlined. Every other product returns a single artifact. Perplexity returns an object you can look at three ways. **For FactoryLM the analogue is obvious and valuable: `Answer | Manual pages | Photos | Work order`.**

**PPX-2 — Inline citation chips name the source, not a number.**
A claim ends with `emersoneins +6` — a compact pill carrying one publisher name plus an overflow count. A superscript `[3]` tells the user nothing until they click. A domain name lets them judge the claim without leaving the sentence. **This is the citation pattern FactoryLM should adopt**, with the manual name and page in place of the domain.

**PPX-3 — Sources are quantified, previewed, and expandable in place.**
`🔵🟢🔴 10 sources` in the action row — stacked favicons plus a count. Clicking opens a popover where each row is `favicon · domain · bold title · truncated snippet`. Three levels of source disclosure — pill in the sentence, count in the action row, full list in a popover — none of which navigates away.

**PPX-4 — The action row is split by intent.**
Left group (act on the answer): `copy · export · ⑂ branch`. Right group (judge the answer): `sources · 👍 · 👎 · ⋯`. Every other product runs one undifferentiated row.

**PPX-5 — Branching (`⑂`) is a first-class message action.** Fork the conversation from any answer. No other product in this study offers it.

**PPX-6 — Every answer ends with suggested follow-ups.**
Five `↳` rows phrased as complete queries (`Causes of bearing failure in conveyor motors and how to diagnose`). ChatGPT puts suggestions only on the empty home; Perplexity puts them where the user actually has a next question. **For a technician this is a teaching mechanism** — it models the diagnostic sequence.

**PPX-7 — The placeholder teaches a keyboard affordance.**
`Type @ for connectors`. Not an invitation (`Ask ChatGPT`), not an advert (Grok's `Cambia al modo Build`) — an instruction that teaches a power feature at zero cost, in the one line every user reads.

**PPX-8 — The current mode is named above the greeting.**
A small `Search` label sits above `What do you want to know?`. Mode is stated in words, not only implied by a chip's highlight state.

**PPX-9 — Mode chips live in the composer's control row, and the active one carries a dropdown.**
`🔍 Search ⌄` (outlined, active) · `▭ Computer`. A fourth distinct answer to "where does the mode switch live" — ChatGPT: header segmented; Claude: sidebar segmented *plus* composer pills; Gemini: sidebar segmented; Perplexity: composer chips. **PRODUCT CHOICE, definitively.**

**PPX-10 — Process trace counts steps rather than time.** `Finished 1 step ›`, expandable. Same family as Claude's `Thought for 10s ›`. Second independent instance → retained, inspectable reasoning is now a **convention**, not a Claude quirk.

**PPX-11 — Auth is a dismissible right side-sheet, not a modal or a wall.**
The signin panel docks to the right; the composer stays reachable; `×` closes it. Compare Grok, which replaces the answer entirely. Perplexity answers logged-out users in full and asks for signup afterwards.

**PPX-12 — Empty nav sections state their emptiness plainly** (`No projects`, `No recent sessions`) — declarative where Claude's is instructive (`Pin projects to keep them here`). Claude's version is better; Perplexity's is still better than a blank space.

---

## Presentation notes

- Serif answer body, sans chrome — same split as Claude.
- Teal/cyan accent, used on the active mode chip and the highlighted capability card.
- Capability cards on the empty state: two large tiles (`Search anything — Get fast and accurate answers from the most trusted sources` / `Get work done with Computer NEW`), the active mode's tile filled with the accent. The empty state teaches the modes rather than suggesting prompts.
- History is called `Sessions`, not `Chats`.

---

## Excellent decisions — FactoryLM should learn from these

1. **Inline citation chips that name the source.** The highest-value pattern in this study for a maintenance product.
2. **Three-level source disclosure** — pill in the sentence, count in the action row, list in a popover — with no navigation at any level.
3. **The result has multiple views** (`Answer | Links | Images`). Maps directly onto `Answer | Manual pages | Photos`.
4. **Suggested follow-ups after every answer**, phrased as complete questions.
5. **Split the action row into act-on and judge-this groups.**
6. **Use the placeholder to teach an affordance.**
7. **Name the current mode in words above the greeting.**
8. **Auth as a dismissible side-sheet after value has been delivered.**
9. **Branching as a first-class action** — worth considering when a technician wants to explore a second hypothesis without losing the first.

---

## Weak decisions — FactoryLM should avoid these

1. **`Model ⌄` shows the parameter name, not the current value.** Directly opposite to ChatGPT's rule and worse: the user cannot see what they are set to without opening the menu.
2. **A persistent sign-in bar floats over the follow-up suggestions**, obscuring content the product just generated. Two of the five follow-ups were unreadable.
3. **A cookie consent dialog on cold launch**, positioned over the empty-state cards.
4. **Both a docked side-sheet and a floating bar solicit signin** on the same screen.
5. **`Sessions` as the word for history.** Every other product says chats or conversations. Inventing a noun for a familiar object costs recognition for no gain.

---

## CONVERGENCE ASSESSMENT

**Declared: PATTERN CONVERGED.**

New-rule counts across the sequence: Grok **1** · Claude **6** · Gemini **2** · Perplexity **12 (nominal)**.

Perplexity's raw count is the highest in the study, so the declaration needs justifying rather than asserting. The distinction that matters:

**Perplexity contributed no new *app grammar*.** Its shell, navigation model, composer behavior, send/stop semantics, state-dependent placeholder, history model, streaming lifecycle, empty-state handling and presentation system are all the baseline, unchanged. Everything on its NEW list is a **domain adaptation** — result views, citation chips, source disclosure, follow-up queries, branching — invented because Perplexity answers research questions and must show provenance.

That is precisely the shape of the finding this study was commissioned to produce:

> **The app grammar converged four products ago. What differentiates a mature AI product is not its shell — it is the domain object it puts inside the shell.**

Grok and Gemini, the two products in the sequence that are general-purpose assistants like the baseline, added **1 and 2** new grammar rules respectively — two consecutive mature products adding almost nothing. The convergence condition is met. Claude and Perplexity's larger contributions are both domain-object contributions (durable artifacts; cited results), not grammar.

**Broad reconnaissance stops here.** Proceed to synthesis.

---

## Evidence index

| ID | Route | Action | Resulting state |
|---|---|---|---|
| PPX-A-01 | `/` | cold load, logged out | `Search` mode label above greeting; composer mode chips; two capability cards; cookie dialog |
| PPX-A-02 | cookie dialog | `Decline optional` | **right side-sheet** signin panel, non-blocking, `×` dismissible |
| PPX-D-01 | `/` | type + Enter | header tabs `Answer\|Links\|Images`; `Finished 1 step ›`; placeholder → `Ask a follow-up` |
| PPX-D-02 | result | inspect answer | inline citation pill `emersoneins +6` at end of claim |
| PPX-D-03 | result | inspect action row | left `copy · export · ⑂` / right `🔵🟢🔴 10 sources · 👍 · 👎 · ⋯` |
| PPX-D-04 | result | below answer | five `↳` follow-up query rows; sign-in bar obscuring two of them |
| PPX-D-05 | action row | click `10 sources` | popover: `favicon · domain · bold title · truncated snippet` per row |

**Gaps:** authenticated experience, Projects interior, Artifacts, error/failure behavior, back/forward restoration, mobile.
