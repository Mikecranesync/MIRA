# PRODUCT ANATOMY — Claude (web)

**Recon date:** 2026-09-07 · **Surface:** claude.ai desktop web, logged in (Max), dark theme
**Pass type:** DELTA against ChatGPT baseline

---

## Product thesis

**ChatGPT optimizes for the cost of starting. Claude optimizes for the durability of what comes out.**

Three structural facts carry it. Claude has a third top-level object — **Artifacts** — alongside Chats and Projects, with its own index, sharing state and edit history; outputs are promoted out of the transcript and become findable things. Reasoning is retained as an inspectable `Thought for 10s ›` block rather than a discarded status word. And a conversation carries a **visible title bar** in the header, so a thread is treated as a named document you are inside, not a stream you are scrolled to.

The consequence for FactoryLM is direct: a maintenance answer is only worth as much as its evidence and its afterlife. Claude is the product in this study that treats both as first-class.

---

## What Claude does the same as ChatGPT

Convergence, recorded before novelty.

- Persistent left sidebar (~280px) that never unmounts; only the main slot swaps
- Centred greeting + one composer as the entire home screen
- One `+` as the only attach/tools entry point
- Model/effort control inline in the composer, showing current value as the label
- Send slot swaps identity: idle mic → send → stop
- Composer animates from centre to bottom on send; translucent, content scrolls under it
- Floating circular `↓` scroll-to-bottom on scroll detach
- Message asymmetry: user = right-aligned bubble; assistant = no bubble, no avatar, full column
- Persistent action row under completed assistant messages
- Sidebar sections: Projects, Pinned, then history; account row sticky at the bottom
- Escape closes popovers; popovers float over content
- **Back/forward restores the conversation at the identical scroll position** (independently confirmed here — second product, so this is now a convention, not a quirk)
- Disclaimer text adjacent to the composer

---

## NEW rules Claude introduces

**CL-1 — The conversation has a visible title bar with a dropdown.**
`Conveyor motor bearing failure sounds ⌄` sits top-left of the main area. ChatGPT shows the title only in the sidebar, so a user with a collapsed sidebar cannot name the thread they are in. Claude's answer is better and costs one row. **Adopt.**

**CL-2 — Titles are generated once, correctly, before the answer starts.**
The final title was already in place during the thinking phase. ChatGPT wrote three titles in sequence (raw prompt → draft → final). Claude's is calmer; ChatGPT's is more resilient if titling fails. Both are defensible — but no flicker is worth having.

**CL-3 — Reasoning is retained and inspectable: `Thought for 10s ›`.**
A collapsed, expandable block above the answer with an elapsed duration. ChatGPT shows `Thinking` and throws it away. **This is the single most important pattern in this study for FactoryLM.** A technician acting on a diagnosis needs to see the chain, and a duration turns dead time into visible work.

**CL-4 — Mid-generation steering, not just stopping.**
A floating `Quick answer` pill appears above the composer during generation. The user can redirect a response in flight rather than only killing it. Every other product in this study offers stop and nothing else.

**CL-5 — The product offers to hand off the wait.**
During a long generation: `Want to be notified when Claude responds?` `[Notify]` `[×]`. It admits that generation can outlast attention and offers an exit instead of demanding the user watch. For a technician who started a lookup and then climbed onto a machine, this is the correct behavior.

**CL-6 — Mode is chosen per message, not per app.**
Two levels of mode exist: app-level `Home | Code` (segmented, top of the **sidebar**) and message-level `Chat | Cowork` (segmented pills **inside the composer**, next to `+`). The message-level pills disappear once inside a thread — mode is fixed for the life of the conversation. ChatGPT has only the app-level switch, and puts it in the header.

**CL-7 — The composer sheds weight inside a thread.**
On home the composer carries `+ · Chat|Cowork · Opus 5 High · mic`. In a thread the model indicator **moves out** of the composer and down beside the disclaimer (`Opus 5  High`, bottom-right). The input gets simpler once the user is committed to a conversation.

**CL-8 — Artifacts are a first-class, indexed object type.**
`Artifacts` sits in the primary nav. The index is a card grid with preview area, title, a privacy lock glyph, and `Edited <date>`, with `All / Yours / Shared with you` chips and a `New artifact` primary button. Outputs escape the transcript and become things you can find, share and version.

**CL-9 — Structure is taught by shipping a populated example.**
The Projects index contains `How to use Claude` badged `Example project`, described as an example that doubles as a how-to. Where ChatGPT teaches Projects by not teaching them, Claude seeds a worked instance. **This is the cheapest onboarding mechanism observed in the entire study** — no tour, no modal, no empty state copy, just one real object that demonstrates the shape.

**CL-10 — Nav sections carry their own empty states.**
Under the `Projects` sidebar heading: `Pin projects to keep them here`. An empty state inside the navigation, not on a page. It explains a feature at the exact place the feature will appear.

**CL-11 — Projects are cards with descriptions, not table rows.**
`Mira Maintenance Chatbot — Helpful and intelligent maintenance co-pilot on technician phones`. ChatGPT's table gives Name and Modified and nothing else. For objects a user must recognise rather than sort, the card wins decisively.

**CL-12 — Conversations and scheduled work share one list: `Chats and tasks`.**
ChatGPT keeps `Scheduled` as a separate destination. Claude merges background work into history, so a task that ran overnight appears where the user already looks. It also injects a promoted suggestion into that same list (`Get a morning brief` badged `Try`) — see weaknesses.

**CL-13 — Messages are timestamped.** The action row ends with `just now`. ChatGPT shows no message timestamps anywhere.

**CL-14 — Symmetric feedback.** Both 👍 and 👎 are present, plus a 🔊 read-aloud control. ChatGPT surfaces only 👍.

**CL-15 — Serif body type.** Claude is the first product in this study to set answer body text in a serif (Perplexity, walked later, does the same), and the only one using a serif display face for page titles and greetings. Answers read as prose rather than as UI output.

**CL-16 — A blocking announcement modal on cold launch.**
`NEW / Claude Fable 5.1 is now available` — dimmed backdrop, three icon+text benefit rows, `Try Fable 5.1` (primary) / `Later` (secondary) / `×`. The only fully blocking modal observed in the study. See weaknesses.

---

## Screen map

```
┌ SIDEBAR (~280px, persistent) ────────┬ MAIN ───────────────────────┐
│ Claude          [collapse] [search]  │ Conveyor motor bearing… ⌄   │
│ ┌ Home | Code ┐  (segmented)         │                    [Share]  │
│ + New                                │                             │
│   Projects · Artifacts · Scheduled   │   ← route slot              │
│   Customize                          │                             │
│ ── Projects ───────────────── [+]    │   Thought for 10s ›         │
│    "Pin projects to keep them here"  │   answer…                   │
│ ── Pinned ──                         │   [copy 🔊 👍 👎 ↻  just now]│
│ ── Chats and tasks ────── [⌄][↗][⇅]  │                             │
│    Get a morning brief   [Try]       │   ┌ composer ─────────────┐ │
│    Conveyor motor bearing…    [⋮]    │   │ + Write a message… 🎤⌄│ │
│ ── Design                            │   └───────────────────────┘ │
│ [MH] Mike · Max ⌄            [⬇]     │   disclaimer      Opus 5 High│
└──────────────────────────────────────┴─────────────────────────────┘
```

---

## Chat lifecycle — deltas only

| Stage | Claude | vs ChatGPT |
|---|---|---|
| Empty home | greeting + composer, **no suggestion cards** | ChatGPT shows 3 source-attributed suggestions |
| Thinking | `✳ Figuring` — animated brand glyph + varied gerund | `Thinking`, fixed word |
| Title | final title present before first token | 3 titles in sequence |
| During generation | `Quick answer` steer pill + `Notify` offer | ■ stop only |
| Post-answer | reasoning block retained above answer | reasoning discarded |
| Action row | copy · 🔊 · 👍 · 👎 · ↻ · `just now` | copy · 👍 · export · ↻ · ⋯ |
| Header | thread title + `Share` | `Share` + `⋯`, no title |

---

## Presentation rules — deltas

- **Serif display + serif body.** Claude is the only product using a serif *display* face. Page titles (`Projects`, `Artifacts`), greetings and answer body are all set in a serif. Everything else — nav, chrome, meta — is sans. The typographic split maps exactly onto content vs interface.
- **Warm accent.** A single orange/coral, used for the brand starburst in the greeting, the thinking glyph, and a turn-separator mark below completed messages. Where ChatGPT's blue appears only in a slider fill, Claude's warm accent appears as a *character* in the conversation.
- **Cards over tables** for Projects and Artifacts.
- **Overflow is `⋮` (vertical)** where ChatGPT uses `…` (horizontal). Cosmetic; noted only so the team picks one and stays with it.
- Ground, surface lifting, radii, absence of shadows, single-accent discipline and three-size type hierarchy all match the baseline.

---

## Excellent decisions — FactoryLM should learn from these

1. **Retain reasoning as an inspectable `Thought for Xs ›` block.** Non-negotiable for a diagnostic product.
2. **Give the conversation a title bar with a dropdown.** The user should always know which thread they are in.
3. **Offer to notify instead of demanding attention** when generation runs long. Field work is interrupted work.
4. **Allow steering mid-generation**, not only stopping.
5. **Promote outputs to a first-class indexed object type.** Work orders, diagnostic reports and nameplate records must not live only inside transcripts.
6. **Teach structure with a shipped, populated example object**, not a tour.
7. **Put empty-state guidance inside the nav section it describes.**
8. **Cards with descriptions for objects the user must recognise.**
9. **Merge scheduled/background work into the history list** so results appear where the user already looks.
10. **Timestamp messages.** In maintenance, when a reading was taken is part of the reading.
11. **Symmetric 👍/👎.** Collect an honest signal.
12. **Let the composer shed controls once inside a thread.**

---

## Weak decisions — FactoryLM should avoid these

1. **A blocking announcement modal on cold launch.** It puts a dialog between the user and the primary action at the exact moment they arrived to do something. ChatGPT's equivalent — an inline explainer block *under* the composer on the new surface — achieves the same disclosure without blocking. A technician who opens the app on a plant floor to identify a part should never have to dismiss a marketing dialog first.
2. **Promoted suggestions injected into the history list.** `Get a morning brief [Try]` sits among the user's real conversations. Even badged, it makes the one list the user trusts to be *their own data* partly advertising. Suggestions belong in the empty state, not the history.
3. **No suggestion cards on the home screen at all.** Cleaner than ChatGPT, but a new user is given nothing to act on. ChatGPT's source-attributed suggestions are the better answer to the same blank screen.
4. **Two mode switches in two different places** — `Home|Code` in the sidebar, `Chat|Cowork` in the composer. Both are segmented controls, both change what the product does, and their scopes are not visually distinguished. A user cannot tell from the controls that one is app-wide and one is per-message.
5. **Artifact cards render an empty dark preview area.** Same failure as ChatGPT's grey source thumbnails: a preview that never loads is worse than no preview slot.
6. **The model indicator moves between two locations** (inside the composer on home, beside the disclaimer in a thread). Consistency of *place* is worth more than the few pixels saved.

---

## Delta verdict

**New interaction conventions contributed: 6 substantive** — retained reasoning, thread title bar, mid-generation steering, notify-on-completion, artifacts as a first-class object type, teach-by-example-object.

Claude introduced meaningfully more new UX than Grok. **Convergence signal: NOT YET.** Continue to Gemini.

---

## Evidence index

| ID | Route | Action | Resulting state |
|---|---|---|---|
| CL-A-01 | `/new` | cold load | **blocking announcement modal** over the shell |
| CL-A-02 | modal → `Later` | dismiss | greeting `✳ Back at it, Mike` + composer, no suggestions |
| CL-A-03 | `/new` | inspect sidebar | `Home\|Code` segmented; nav empty state `Pin projects to keep them here`; `Chats and tasks`; `Get a morning brief [Try]` |
| CL-D-01 | `/new` | type + Enter | thread title bar appears w/ final title; `✳ Figuring` |
| CL-D-02 | thread | during generation | `Quick answer` steer pill; `Want to be notified…[Notify][×]` |
| CL-D-03 | thread | complete | `Thought for 10s ›` retained above answer |
| CL-D-04 | thread | scroll to end | action row `copy 🔊 👍 👎 ↻ just now` + brand turn-mark |
| CL-C-01 | thread → back → forward | browser nav | **identical scroll position restored** (matches ChatGPT) |
| CL-F-01 | `/projects` | nav | serif H1 + search + sort + `New project`; **cards w/ descriptions**; `Example project` badge |
| CL-F-02 | `/artifacts` | nav | card grid, lock glyph, `Edited <date>`, `All/Yours/Shared with you` |

**Gaps:** logged-out entry, error/failure behavior, attachment flow, `+` menu contents, search, mobile.
