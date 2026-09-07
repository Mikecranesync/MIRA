# PRODUCT ANATOMY — ChatGPT (web)

**Recon date:** 2026-09-07
**Surface:** chatgpt.com, desktop web, logged in (Pro), dark theme
**Method:** hands-on walkthrough — real prompt sent, real navigation, real error triggered
**Role in this study:** BASELINE. Every other product is recorded as a delta against this file.

---

## 1. Product thesis

**ChatGPT is optimized to make the cost of starting a thought as close to zero as possible, and to make everything else disappear until asked for.**

Three observations carry that thesis:

1. The home screen contains exactly two things: a sentence and a text box. There is no dashboard, no feature grid, no tour, no stats. The product does not explain itself; it presents an input.
2. Every capability the product has — image generation, web search, deep research, Gmail, Drive, Canva, plugins, files, skills — lives behind **one** `+` button. Nothing is promoted to the surface. The composer's visible controls never exceed four.
3. Structure (Projects, Library, Scheduled, Sources) exists, but the product never asks you to set it up first. You can use ChatGPT for a year without creating a Project. Organization is opt-in, always retrofittable.

The corollary, which matters for FactoryLM: **ChatGPT teaches its structure by letting you outgrow the simple case, not by explaining the structure up front.** There is no onboarding for Projects. You find them when the flat list stops serving you.

---

## 2. Screen map

```
┌─ PERSISTENT SHELL ────────────────────────────────────────────────┐
│ SIDEBAR (fixed, ~260px)          MAIN (fluid, content ~640px max) │
│                                                                   │
│ ┌ wordmark  [search] [collapse]  ┌ surface switch: Chat | Work    │
│ │                                │ ...........[Share] [ ⋯ ]       │
│ ├ New chat        (sticky top)   │                                │
│ ├ Library                        │  ← MAIN SLOT, swaps by route   │
│ ├ Projects              [+]      │                                │
│ ├ Scheduled                      │                                │
│ ├ Customize                      │                                │
│ ├ More ▸ (flyout: Images,        │                                │
│ │        Health, Finances,       │                                │
│ │        Sites NEW, GPTs)        │                                │
│ │                                │                                │
│ ├ ── Pinned ⌄ ──   (scrolls)     │                                │
│ │   conversation rows            │                                │
│ ├ ── Recents ──                  │                                │
│ │   conversation rows            │                                │
│ │                                │                                │
│ └ [avatar] Mike Harper / Pro     │  ┌ COMPOSER (translucent,      │
│           [apps]  (sticky btm)   │  │  floats over scroll)        │
└───────────────────────────────────┴──┴─────────────────────────────┘
```

**Routes observed**

| Route | Main slot contains |
|---|---|
| `/` | Greeting + centered composer + 3 suggestion rows |
| `/c/<id>` | Message list + bottom-docked composer |
| `/projects` | H1 + search + `New` + filter chips + table |
| `/projects/<id>` | H1 + **top-mounted scoped composer** + Chats\|Sources tabs + list |
| `/library`, `/scheduled`, `/plugins` | (secondary, same shell) |
| bad `/c/<id>` | falls back to `/` + error toast |

**The rule that governs the map:** the sidebar and the surface switch never unmount. Only the main slot swaps. Across every route change observed there was no flash, no spinner over the shell, and no sidebar re-render.

---

## 3. Interaction grammar

Rules that held consistently everywhere in the product.

**G1 — One control, many states.** The composer's right-hand slot is a single position occupied by different controls depending on state:

| State | Right slot |
|---|---|
| idle, empty | 🎤 mic + ◉ voice |
| has text | ↑ send (filled, high contrast) |
| generating | ■ stop (filled) |

The user never learns three buttons. They learn one place where the next action lives.

**G2 — Collapsed shows the value, expanded shows the label.** The effort control reads `Extra High` when closed and `Thinking effort` when open. The closed state answers "what is it set to"; the open state answers "what is this". Zero pixels wasted on a label you already understand.

**G3 — Magnitude before taxonomy.** Opening that control gives a 5-notch **slider**, not a list of models. The model list (`Latest ✓ / GPT-5.6 Sol / GPT-5.5`) is one level deeper behind a `›`. The default option is named by recency semantics — "Latest" — so a non-expert never has to know a model name to make a correct choice.

**G4 — Menus are also search fields.** The `+` menu shows 8 items and ends with `Type to search plugins, files, folders & skills`. The menu does not grow or nest as capabilities are added; it stays 8 rows and becomes searchable. **Progressive disclosure by search, not by submenu.**

**G5 — Two-tier rows.** Every menu row is `icon · bold label · muted description`, e.g. `Add photos & files — Upload from computer`. Label says what, description says why. Applied consistently in the `+` menu, Sources list, search results.

**G6 — Actions live where their object is.** `Add sources` is the first row *of the sources list*, not a button in the page header. Unpin/overflow appear *on the conversation row*. `New project` appears *on the Projects nav row*. Nothing is centralized into a toolbar.

**G7 — Chrome floats, content is continuous.** Header and composer are translucent, blurred layers. Text scrolls *under* them and is visible through them. There is one scroll surface; nothing is clipped by a hard edge.

**G8 — Asymmetric message treatment.**

| | User message | Assistant message |
|---|---|---|
| container | rounded bubble, filled surface | none |
| alignment | right | left, full column |
| avatar | none | none |
| actions | hover-only, right-aligned under bubble: copy, export, **edit** | always visible, left-aligned: copy, 👍, export, regenerate, ⋯ |

The asymmetry is the point: user text reads as *a message*, assistant text reads as *a document*. Neither is wrapped in a chat-app skin.

**G9 — Feedback is de-emphasized.** Only 👍 is surfaced; 👎 is not in the visible row. The product does not stage a rating prompt after every answer.

---

## 4. Navigation grammar

**N1 — Depth is at most 3.** Home → conversation. Projects → project → conversation. Nothing observed goes deeper than three levels, and level 3 is always a conversation.

**Tap counts from cold home:**

| Action | Taps |
|---|---|
| Start a new chat | 0 (composer is already focused) |
| Reopen any recent conversation | 1 |
| Attach a photo | 2 (`+` → Add photos) |
| Search all history by content | 2 (search icon → type) |
| Change reasoning effort | 2 |
| Change model | 3 |
| Open a project's files | 3 |

**N2 — Back is the browser's back, and it is honest.** Home → conversation → Back returned to home. Forward returned to the conversation **at the identical scroll position**, with its own per-conversation model setting restored. Route restoration and scroll restoration are both implemented. This is the single highest-value navigation behavior in the product and it is easy to get wrong.

**N3 — Per-conversation state is real state.** Opening an older conversation set the composer to `5.5 Medium` while a new chat was `Extra High`. Settings belong to the thread, not to the app.

**N4 — Conversations open at the bottom.** Opening an existing thread lands on the newest message, not the top. The user's mental model is "return to where we left off", not "read from the beginning".

**N5 — Modals are dismissible and non-trapping.** The search palette floats over the content column with **no backdrop dim**, the sidebar stays visible and clickable behind it, and `Escape` closes it. The `+` menu and effort menu behave identically. No modal observed took over the screen or blocked the shell.

**N6 — Secondary destinations get a flyout, not a page.** `More` opens a right-anchored flyout (Images, Health, Finances, Sites `NEW`, GPTs) rather than navigating. `NEW` badges mark recent additions.

**Trap audit:** no dead end found. Every state tested — bad URL, open menu, open modal, mid-stream — left the composer reachable or one `Escape` away.

---

## 5. Chat lifecycle

Each state, and what visibly changes.

**5.1 Empty / home**
Rotating greeting (`Ready when you are.` → `What's on your mind today?` → `Good to see you, Mike.` → `What's on the agenda today?`), centered composer, three suggestion rows.
The suggestions are **not generic prompt starters**. Each carries a source glyph and describes real pending work drawn from connected systems:
`✉ Check the new Vercel domain configuration warning` · `🐙 Review PR #3661 before testing the fixed mobile canary` · `🤖 Let me know when the FactoryLM fleet has a change that needs a decision…`
They rotate between renders. Long ones truncate with `…`.

**5.2 Composer focused (empty)**
A quick-scope shelf appears beneath the composer: `Project | Files | [connector avatars] Plugins | Open desktop app`. A second, lighter disclosure layer distinct from the `+` menu — scope selection rather than capability selection.

**5.3 Typing**
Composer grows from pill to rounded rect and wraps. Mic + voice are replaced by ↑ send. Suggestions stay and are pushed down.

**5.4 Send**
Instant route change to `/c/<id>`. The composer **animates from centre to bottom** — same element, new position, so continuity is never broken. Placeholder becomes `Follow up`. Header swaps `Temporary chat` for `Share` + `⋯`. A sidebar row is inserted at the top of Recents immediately, optimistically titled with the raw prompt text.

**5.5 Thinking**
The word `Thinking`, plain text, left-aligned, in the position the answer will occupy. No spinner, no skeleton, no avatar, no progress bar. Roughly 2s.

**5.6 Streaming**
Markdown renders progressively including bold. Paragraphs complete then the next begins. Stop button (■) live in the send slot. `ChatGPT can make mistakes. Check important info.` sits above the composer.

**5.7 Scrolling while streaming**
Scrolling up detaches autoscroll and a circular `↓` button fades in above the composer. It fades out at the bottom. Content passes under the translucent composer, never hidden by it.

**5.8 Titling**
Three titles for one thread, in sequence: raw prompt text → `Failing Bearing Sounds` (during stream) → `Conveyor Bearing Sounds` (after completion). The list is never empty and the title improves as evidence arrives.

**5.9 Complete**
Action row appears under the answer, permanently: `copy · 👍 · export · regenerate · ⋯`. Muted, unlabelled, borderless, left-aligned. Composer returns to idle (mic + voice) and placeholder returns to `Ask ChatGPT`.

**5.10 Edit / retry**
Hovering the user bubble reveals `copy · export · ✏️ edit` right-aligned beneath it. Regenerate lives on the assistant message. Both paths are one hover + one click.

**5.11 History persistence**
Conversation appears in Recents instantly and survives navigation and reload. Pinned section sits above Recents. There is **no date grouping** — just `Pinned` then `Recents`, flat. (Older ChatGPT grouped by Today / Previous 7 days; that has been removed.)

---

## 6. Multimodal / tools

Everything is behind `+`, in one menu, in three unlabelled groups separated by spacing:

| Group | Items |
|---|---|
| Input | Add photos & files · Add from library |
| Capabilities | Create image · Web search · Deep research |
| Connectors | Gmail · Google Drive · OpenAI Developers · Canva `Connect` |

**How complexity is hidden**
- One entry point, never more.
- A connector that is not yet connected shows an inline `Connect` on its own row — no trip to a settings page, no separate "integrations" section.
- The menu is width-matched and left-aligned to the composer, so it reads as the composer expanding rather than a popup arriving.
- Search at the bottom absorbs unbounded growth.

**Voice** gets a dedicated always-visible circular button, the only capability promoted out of the `+` menu. It is the one capability that cannot wait for a menu.

---

## 7. Organization model

**The mental model: a flat stream of conversations, with optional folders that are themselves small workspaces.**

**Chats** — flat, reverse-chronological, `Pinned` above `Recents`. Pinning is the only manual organization at this level and it is one click on the row.

**Projects** — index is a *table* (Name | Modified), not a card grid. Filter chips `All / Created by you / Shared with you`. Projects are treated as folders, not as apps.

**Project detail — the most instructive screen in the product:**

```
📁 Factory LM and Mira                          [Share] [⋯]
┌──────────────────────────────────────────────────────┐
│ +  New chat in Factory LM and Mira    Extra High 🎤 ◉ │   ← composer ON TOP
└──────────────────────────────────────────────────────┘
  [Chats] [Sources]                                       ← tabs
  ─────────────────────────────────────────────────────
  Industrial Question Scan                        Sep 6
  how do i continue implementation
  ─────────────────────────────────────────────────────
  Unify Repositories Platform Plan                Sep 5
  i need to unify and construct from these code bases…
```

Three decisions worth stealing outright:

1. **The composer is at the top, not the bottom.** A project is not a document you read; it is a place you start work. The primary action is physically first.
2. **The placeholder carries the scope** — `New chat in Factory LM and Mira`. The user is told what context they are inside, in the place they are about to type, rather than by a breadcrumb they must notice.
3. **Tabs change the list, never the shell.** Switching Chats → Sources leaves title and composer pixel-identical. Only the panel swaps.

**Sources tab** — sort (`Newest`) and filter (`All`) right-aligned on the tab row; `⊕ Add sources` is the first *row of the list*; each row is thumbnail + bold filename + `Type · Date`.

**Search** — content-level, not title-level. Results show the matched sentence with the query term bolded in context, plus relative dates for recent items (`Today`, `Yesterday`) and absolute for older (`Aug 28`). Scope chips `All / Chats / Images / Documents / Projects` and a connected-source selector.

**Memory** is invisible. Nothing in the UI surfaces it; it shows up only as personalization in greetings and suggestions.

**How the structure is taught without documentation:** it isn't taught. It is *discovered* — Projects sits in the nav from day one, does nothing until used, and the moment a user creates one the project page's own layout (composer on top, tabs below) teaches the concept in a single glance.

---

## 8. Component vocabulary

| Component | Where it repeats | Anatomy |
|---|---|---|
| **Composer** | home (centre), thread (bottom), project (top) | pill/rect, translucent, `+` left, text, effort control, mic, voice/send/stop |
| **Two-tier menu row** | `+` menu, Sources, search | icon · bold label · muted description |
| **List row w/ date** | Recents, project chats, search, Sources | title + preview, right-aligned date; date slot **swaps to `⋯` on hover** |
| **Filter chip row** | Projects, search, project tabs | pill, filled when active, transparent when not |
| **Segmented control** | header `Chat \| Work` | rounded track, filled thumb |
| **Toast** | errors | top-centre, icon + message + `×`, dismissible, non-blocking |
| **Message action row** | under assistant messages | 5 borderless muted icons |
| **Slider control** | thinking effort | 5 notches, blue fill, `›` to deeper taxonomy |
| **Flyout** | sidebar `More` | right-anchored panel, `NEW` badges |
| **Skeleton** | search results only | grey bars matching final row shape + thumbnail square |
| **Scroll-to-bottom** | thread | circular `↓`, fades in on detach |

**Button hierarchy** — exactly three levels, and only one instance of the top level per screen:
1. **Filled white/high-contrast** — `New` on Projects, `↑` send. One per screen.
2. **Subtle filled surface** — `Share`, chips, pills.
3. **Borderless icon** — everything else.

---

## 9. Presentation rules

- **Ground:** near-black. Surfaces are lifted by a few percent of lightness, never by borders. Borders appear only as hairline row dividers.
- **Radius:** two values in practice — fully-round for pills/buttons/bubbles, ~12–16px for cards, menus, and the composer.
- **Shadows:** effectively none. Depth is communicated by lightness + blur/translucency.
- **Measure:** the answer column is capped around 640px and centred. User bubbles right-align to that same measure. The text column does not widen on a wide screen — density is held constant.
- **Type:** one family. Three sizes in the whole app — greeting (~28px), body (~16px), meta (~13px). Hierarchy is carried by **weight and colour**, not size. Bold inside answers is the only in-body emphasis.
- **Colour:** monochrome + one accent (blue), used only for the effort slider fill and a single unread dot. No status colours, no category colours, no illustrations, no gradients.
- **Icons:** single-weight line icons, consistent stroke, always paired with text in nav, always unlabelled in action rows.
- **Empty states:** never blank. Search with no query shows Recent chats. Home shows suggestions. The product does not render an empty box with instructions.
- **Loading:** streamed text gets a word (`Thinking`); lists get skeletons; nothing gets a spinner.
- **Disabled:** rare. Observed once — the dimmed send on the Work surface. Elsewhere the control is *replaced* rather than disabled.

**How a large system stays visually quiet:** one accent colour, no shadows, no borders except hairlines, three type sizes, one high-emphasis button per screen, and every optional capability collapsed behind a single `+`.

---

## 10. Failure behavior

**Test:** navigated to `chatgpt.com/c/00000000-0000-0000-0000-000000000000`.

**Result:** no error page. The app rendered the **fully working home state** and floated a dismissible toast:

> ⓘ You don't have access to this conversation. Make sure you're logged into the right account, or ask the conversation owner to send you a share link. `×`

Against the three questions an error must answer:

1. **What happened** — stated in plain language, no code, no ID.
2. **Is my work safe** — answered structurally rather than in words: the sidebar, history, and composer are all intact and visible behind the toast. Nothing was lost, and you can see that nothing was lost.
3. **What do I do next** — two concrete actions, and a third implicit one: the composer is focused and usable *right now*.

**The rule:** an error never costs the user the ability to act. Degrade to the nearest working state; explain in a dismissible layer.

**Not tested this pass:** hard network loss, failed generation mid-stream, attachment upload failure. Noted as an evidence gap.

---

## 11. Mobile / web differences

**Not tested.** Per scope decision, native apps and mobile-web emulation were excluded from this study; window resizing in the recon environment did not change the rendered viewport. Mobile is an acknowledged gap in this document.

What is *structurally* observable from the desktop build and should be treated as inference, not evidence:
- The sidebar has an explicit `Open sidebar` / `Close sidebar` control pair, implying it becomes a drawer at narrow widths.
- The content column is already capped at ~640px, so the phone layout is the desktop layout minus the sidebar — the reading measure does not need to change.
- The composer already carries every primary action, so a bottom nav bar is not required.

---

## 12. Excellent decisions — FactoryLM should learn from these

1. **Zero-cost start.** Home is a sentence and a text box; the composer is pre-focused. A technician can ask before understanding anything.
2. **One `+` for all capability.** No tool bar, no feature rail, no mode buttons. Complexity is one tap deep and searchable.
3. **Back and forward restore scroll position and per-thread settings.** Not just the route — the exact pixel and the exact configuration.
4. **Project = scoped composer on top + history below + Sources tab.** This is directly transplantable to a machine/asset page.
5. **The placeholder carries the scope.** `New chat in Factory LM and Mira` tells you where you are at the moment you type, instead of relying on a breadcrumb.
6. **Errors degrade to a working state + a dismissible toast.** Never an error page, never a lost composer.
7. **Magnitude before taxonomy, and a default named "Latest".** No user needs to know a model name to make a correct choice.
8. **Optimistic, self-correcting titles.** The history entry exists before the answer does, and improves twice.
9. **Suggestions drawn from real connected work**, source-attributed, rather than generic prompt starters.
10. **Chrome floats; content is one continuous surface.** Nothing is clipped, nothing jumps.
11. **Three type sizes, one accent colour, one high-emphasis button per screen.** The system stays quiet as it grows.
12. **Actions live on their object.** `Add sources` is the first row of the sources list.

---

## 13. Weak decisions — FactoryLM should avoid these

1. **Flat `Recents` with no date grouping.** Once history is long, "when was that" becomes unanswerable without search. For a technician tracking a recurring fault across weeks this is a real loss.
2. **Source filenames are raw.** `image-1781126450592.jpg` in the Sources list is worthless. Anything ingested must be renamed by *what it is*.
3. **Image thumbnails render as flat grey squares** with no shimmer and no fallback glyph — indistinguishable from a broken image.
4. **The active-conversation highlight persists after navigating home**, so the sidebar claims a thread is open when it isn't.
5. **Inconsistent empty-input handling across surfaces.** Chat replaces send with mic; Work shows a greyed-out send. Two answers to one question.
6. **The rotating greeting teaches nothing.** Four different greetings observed, none of which orient a new user. Charm occupies the most valuable line on the screen.
7. **Connector rows in the `+` menu drop their icons** while capability rows keep them — a small break in the two-tier row rule.
8. **`Thinking` is unqualified.** No indication of expected duration or what is being done. Tolerable at 2s; not tolerable if a nameplate OCR round-trip takes 20s.
9. **Feedback is asymmetric** (👍 present, 👎 hidden), which quietly biases the signal being collected.

---

## 14. Evidence index

Screenshots were captured live in-session. The recon environment did not return retrievable disk paths for saved captures, so each observation below is recorded as a **reproducible journey** — route, action, resulting state — which the team can re-run directly. This is deliberate: a repeatable step is more useful to a developer than an opaque PNG.

| ID | Route | Action | Resulting state |
|---|---|---|---|
| CGPT-A-01 | `/` | cold load | Greeting + centred composer + 3 source-attributed suggestions |
| CGPT-A-02 | `/` | scroll sidebar | `New chat` sticky top, account sticky bottom, Pinned → Recents |
| CGPT-A-03 | `/` | hover truncated row | full title tooltip |
| CGPT-D-01 | `/` | type into composer | pill→rect, mic/voice → ↑ send |
| CGPT-D-02 | `/` | press Enter | route → `/c/…`, composer animates to bottom, `Follow up` placeholder, `Thinking` |
| CGPT-D-03 | `/c/…` | +3s | streaming markdown, ■ stop, sidebar title = raw prompt |
| CGPT-D-04 | `/c/…` | +8s | complete, action row visible, title → `Conveyor Bearing Sounds` |
| CGPT-D-05 | `/c/…` | scroll up mid-thread | `↓` scroll-to-bottom appears; text visible under translucent composer |
| CGPT-D-06 | `/c/…` | hover user bubble | copy / export / ✏️ edit, right-aligned |
| CGPT-E-01 | `/c/…` | click `+` | tools menu: input / capabilities / connectors + `Connect` + search footer |
| CGPT-E-02 | `/c/…` | click effort control | label morphs to `Thinking effort`, 5-notch slider |
| CGPT-E-03 | `/c/…` | click `›` | model list `Latest ✓ / GPT-5.6 Sol / GPT-5.5` |
| CGPT-C-01 | `/` → `/c/…` → Back | browser back | home restored, greeting re-randomised |
| CGPT-C-02 | Back → Forward | browser forward | **identical scroll position + per-thread model restored** |
| CGPT-C-03 | sidebar `More` | hover | flyout: Images / Health / Finances / Sites `NEW` / GPTs |
| CGPT-F-01 | `/projects` | nav | H1 + search + `New` + chips + Name/Modified table |
| CGPT-F-02 | `/projects/<id>` | open project | **top-mounted scoped composer**, Chats\|Sources tabs |
| CGPT-F-03 | project → Sources | tab switch | shell + composer unchanged, only list swaps; `⊕ Add sources` as first row |
| CGPT-F-04 | search icon → `bearing` | type | skeletons → content-matched results w/ bolded term + relative dates |
| CGPT-I-01 | `/c/<invalid-uuid>` | direct nav | **home state + dismissible toast**, no error page |
| CGPT-B-01 | header `Work` | switch surface | same shell, new composer geometry, first-run explainer block |

**Gaps in evidence:** mobile (out of scope), network-loss behavior, mid-stream generation failure, attachment upload failure, logged-out entry experience.
