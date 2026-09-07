# PRODUCT ANATOMY — Gemini (web)

**Recon date:** 2026-09-07 · **Surface:** gemini.google.com/app, logged in (Pro), dark theme
**Pass type:** DELTA against ChatGPT baseline

---

## Product thesis

**Gemini is optimized for breadth of output type.** Where ChatGPT hides Images under `More` and Claude collects outputs into one `Artifacts` index, Gemini promotes **Images** and **Videos** to their own top-level nav destinations and adds **Notebooks** as a separate section. The organizing question is not "what did we talk about" but "what kind of thing do you want".

That breadth is bought at the cost of the conversation itself: Gemini has the least informative waiting state, the least explained model behavior at the point of generation, and — most seriously — **no visible message actions at all**.

---

## What Gemini does the same as ChatGPT

- Persistent left sidebar; only the main slot swaps
- Centred question-greeting + one composer as the whole home screen
- Surface switch as a segmented control at the top of the sidebar (`Chat | Spark BETA`)
- One `+` as the only attach/tools entry point
- Model control inline in the composer showing current value (`Flash ⌄`)
- Send slot swaps identity: mic → send → stop
- Composer animates centre → bottom on send
- Conversation auto-titled and inserted into `Recents`
- `Recents` is flat with no date grouping (same weakness as baseline)
- Account row sticky at sidebar bottom; disclaimer under the composer

---

## NEW rules Gemini introduces

**GEM-1 — Every model option carries a plain-English job description.**

```
3.5 Flash-Lite     Fastest answers
3.8 Flash      ✓   All-around help
3.1 Pro            Advanced reasoning
─────────────────────────────────────
Extended thinking  Complex problem solving
```

This is **the best model selector in the study.** ChatGPT hides names behind `Latest`; Grok replaces names with intent words; Gemini keeps the names *and* tells you the job each one is for. A user who must justify a choice to a supervisor can. The separated `Extended thinking` group correctly signals that it is a different axis, not a fourth model — the exact distinction Grok got wrong.

**GEM-2 — Capability menus nest with submenus rather than search.**
`Upload files · Add from Drive · More uploads ›` — separator — `Create image · Create video · More tools ›`. A direct fork from ChatGPT's flat-list-plus-type-to-search. Browsable without knowing a name; but depth grows as capability count grows, and each level costs a precise tap. **For gloved hands on a phone, ChatGPT's model is better.**

**GEM-3 — The `+` becomes `×` while its menu is open.** The trigger is its own dismiss control. Small and strictly better than ChatGPT's highlight-only treatment.

**GEM-4 — Answers render structure-first, then fade in.**
Rather than streaming token by token, Gemini paints the *shape* of the answer — one paragraph plus four list placeholders — at low opacity, then fades the content in. The user learns the answer's structure before they can read a word of it. Genuinely different from every other product here, and arguably better for a skimming reader: you know immediately whether you got four stages or a wall of prose.

**GEM-5 — The pending conversation appears in the sidebar as a skeleton row.**
ChatGPT inserts optimistic raw prompt text and rewrites it twice; Gemini inserts a grey bar and fills it once. Honest but uninformative — during generation, the user cannot identify their own new thread in the list.

**GEM-6 — Media types are top-level destinations.** `Images` and `Videos` sit in primary nav beside `Library`. Outputs are organized by medium rather than by project or by artifact.

**GEM-7 — Notebooks are a parallel object type with their own nav section**, listed individually (`New notebook`, then each notebook, then `All notebooks`).

**GEM-8 — Pinning happens in place.** Pin glyphs sit on `Recents` rows and pinned items stay in `Recents` rather than being hoisted into a separate `Pinned` section. Fewer sections, but pinned items are no longer guaranteed to be visible without scrolling — which is the entire point of pinning.

**GEM-9 — Promotional cards float in the content area's top-right corner.**
`Your business, organized with Gemini … [Not now] [Connect]`, dismissible, non-blocking, occupying the slot where ChatGPT and Claude put `Share`. Better than Claude's blocking modal; still commercial furniture in the primary work area.

**GEM-10 — A soft radial gradient sits behind the composer.** The only non-flat ground in the study. Subtle, and it does draw the eye to the input.

---

## Chat lifecycle — deltas

| Stage | Gemini | vs baseline |
|---|---|---|
| Typing | composer splits into two rows — **text gets its own row above the controls** | ChatGPT keeps controls inline with text |
| Sidebar during generation | skeleton bar | optimistic raw prompt text |
| Thinking | small animated dot cluster, **no word** | `Thinking` / `Figuring` |
| Rendering | structure-first, whole-block fade-in | token stream |
| Complete | **no action row, persistent or on hover** | 5-icon persistent row |
| Header in thread | `⋮` only, **no title** | ChatGPT same; Claude shows a title bar |
| Scroll detach | **no scroll-to-bottom control observed** | present in ChatGPT and Claude |

---

## Presentation notes

- Very large, light-weight sans greeting (~34px) — `What should we focus on?` — no personalization, no brand glyph.
- Title case for conversation titles (`Conveyor Motor Bearing Failure Noises`) where ChatGPT and Claude use sentence case.
- Answer body uses heavier bold lead-ins on list items (`High-Pitched Whine or Hiss (Early Stage):`) — the most scannable answer formatting of the four, and well suited to a technician skimming for a stage.
- Hollow circle list bullets rather than filled dots.
- Composer sits on an opaque band; content does not read through it as it does in ChatGPT and Claude.
- Accent is Google's multicolour mark, used only in the logo; the functional accent is a single blue.

---

## Excellent decisions — FactoryLM should learn from these

1. **Give every model/mode option a plain-English job description.** `Fastest answers` / `All-around help` / `Advanced reasoning` is the clearest solution to model choice found anywhere in this study. Adopt this wording pattern directly.
2. **Separate the effort axis from the model axis with a divider and a label** (`Extended thinking — Complex problem solving`). Grok fused them and created a category error; Gemini gets it right.
3. **The trigger button becomes its own dismiss control** (`+` → `×`).
4. **Structure-first rendering.** Showing the answer's shape before its content is a real win for a reader who is scanning for one stage out of four — which is exactly what a technician does.
5. **Bold lead-ins on list items.** The most scannable answer typography observed.

---

## Weak decisions — FactoryLM should avoid these

1. **No message action row.** After a complete answer, scrolled to the bottom, hovering the message — copy, retry and feedback are simply not discoverable. This is the single worst regression against convention found in the study. A technician who wants to paste a diagnosis into a work order has no visible path.
2. **A wordless thinking indicator.** A dot cluster says something is happening but not what or for how long. Against Claude's `Thought for 10s ›` it is a clear loss, and it will be worse in a product where a lookup involves OCR and a document fetch.
3. **No scroll-to-bottom control.** Present in both ChatGPT and Claude; its absence in a long answer means manual scrolling back.
4. **Two nav items both labelled `Untitled notebook`.** The product auto-titles chats but not notebooks, producing unresolvable duplicates in the primary navigation. Whatever object type FactoryLM creates — asset, work order, inspection — it must be auto-named at creation.
5. **Pinned items stay inside `Recents`.** Pinning that does not guarantee visibility is not pinning.
6. **Menu rows carry descriptions in the model menu but not in the `+` menu.** One product, two answers to the same question.
7. **Nested submenus for capabilities.** Each `›` is another precise tap; on a phone with gloves this is materially worse than a flat searchable list.
8. **A promotional card in the content area's action corner** on cold launch.

---

## Delta verdict

**New interaction conventions contributed: 2 substantive** — job-described model options, and structure-first rendering. The remainder are variations on established grammar (menu nesting vs search; skeleton vs optimistic text; media-type nav vs artifact index) rather than new rules.

Sequence so far — Grok: 1 new rule. Claude: 6. Gemini: 2. **Convergence signal: STRONG but not yet declarable.** One more product required.

---

## Evidence index

| ID | Route | Action | Resulting state |
|---|---|---|---|
| GEM-A-01 | `/app` | cold load | greeting `What should we focus on?`; `Chat\|Spark BETA` sidebar switch; Images/Videos/Library; Notebooks section; **promo card top-right**; radial gradient |
| GEM-D-01 | `/app` | type | composer splits — text row above control row |
| GEM-D-02 | `/app` | send | sidebar **skeleton row**; wordless dot-cluster thinking indicator |
| GEM-D-03 | thread | +5s | **structure-first fade-in** — paragraph + 4 list placeholders ghosted before content |
| GEM-D-04 | thread | complete, scroll to bottom, hover answer | **no action row of any kind**; no scroll-to-bottom control |
| GEM-E-01 | composer | open model menu | `3.5 Flash-Lite / Fastest answers`, `3.8 Flash ✓ / All-around help`, `3.1 Pro / Advanced reasoning`, sep, `Extended thinking / Complex problem solving` |
| GEM-E-02 | composer | open `+` | `Upload files · Add from Drive · More uploads ›` sep `Create image · Create video · More tools ›`; `+` becomes `×` |

**Gaps:** logged-out entry, error/failure behavior, search, notebook interior, back/forward restoration, mobile.
