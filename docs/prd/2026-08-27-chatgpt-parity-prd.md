# FactoryLM Technician Copilot — ChatGPT-parity PRD (the conversation half)

**Status:** Execution PRD, HELD for Mike's review (docs-only; merges are Mike's)
**Owner:** Mike Crane · **Written:** 2026-08-27 · **Verified against:** `origin/main` @ `7fd07ba12`
(audit performed at `b04821ca1`, 3 commits earlier; no notebook-surface changes in between)
**Parent contract:** `docs/prd/2026-08-25-technician-copilot-prd.md` (the ChatGPT × NotebookLM PRD).
This PRD *extends* its CONV pillar; it amends nothing.
**Constitution:** `docs/specs/mira-technician-app-dogfood-system.md` §1.1–§1.4 — still wins on conflict.
**Companion rule:** `.claude/rules/commodity-before-custom.md` — every commodity behavior here
(markdown, streaming, clipboard, auto-grow) is a library or platform primitive, never custom.
**Evidence:** four read-only audits of `mira-mobile/src`, `mira-hub/src` notebook surfaces, the
server conversation model, and a primary-source inventory of ChatGPT's 2026 interface
(help.openai.com release notes through 2026-08-27). Every gap row below has a `file:line`.

> The parent PRD says the Notebook is "ChatGPT fused with NotebookLM." The audit found we
> built the NotebookLM half and almost none of the ChatGPT half. This document cuts the
> ChatGPT half into requirements an agent session can execute and verify without re-deriving
> intent. It does not re-litigate the evidence half, the tab contract, or grounding law.

---

## 1. The gap in one paragraph

A technician opening the phone app beside a machine gets a single-line text box and a
`Send` button. The answer arrives all at once after up to 120 s (no streaming on mobile), as
plain text (tables, lists and code render as raw `|` and `**` on both clients), with no way
to copy, retry, rate, or share it, and no way to stop it. If the send fails, the typed
question is gone. One notebook is one endless thread: no "new chat," no titles, no search,
no way to find last Tuesday's diagnosis. The web notebook is not in the hub navigation and
cannot reach general mode at all. Everything ChatGPT users do *to a message* is absent on
both clients. What we have instead — page citations that open the original, a persisted
evidence badge, per-source scope, deterministic follow-ups, refusal without a provider call
— is better than ChatGPT and stays byte-for-byte.

## 2. Laws restated (from the constitution — not amended)

1. **Universal Technician (§1.1)** — asking never requires create/pick/scan first. The
   empty state must *invite* the zero-setup user, not hide affordances from them.
2. **Progressive Context (§1.2)** — the conversation is the same object at L0–L3.
3. **Evidence ladder (§1.3)** — every ChatGPT-style affordance added here renders basis
   honestly; a regenerated or copied answer carries its badge and citations with it.
4. **Grounding not relaxed (§1.4)** — no new provider paths; one conversation store; the
   frozen 5-tab `nav.ts` contract stands; **no 6th Chat tab**; no canvas/side-panel (OpenAI
   itself retired canvas for inline blocks in May 2026 — inline is the right target).

**Standing non-goals:** model picker, tools/plugins menu, ChatGPT-style memory or custom
instructions, temporary chat, voice mode, control writes. See §6.

## 3. Verified current state (2026-08-27)

What exists — reuse, don't rebuild:

| Capability | State |
|---|---|
| Typed SSE contract `content*→sources→evidence→[usage]→status→[followups]→[DONE]` (actual wire order; header comments claim sources-first — fix the comments, not the code) | Live, `chat/route.ts:845-913` |
| Web token streaming via `getReader` | Live, `NotebookChat.tsx:259-296` |
| History: client `slice(-12)` + server `sanitizeHistory(12, 2000)` on both clients | Live (CONV-3 shipped) |
| Persisted `basis`, citations with `originFileId`, read-time heal | Live (mig 084/085) |
| Deterministic follow-ups, last-turn-only, both clients | Live (`notebook-followups.ts`) |
| Add-sources sheet: PDF / photo / Files / paste-text (mobile) | Live, `NotebookScreen.tsx:925-1179` |
| `PATCH /api/equipment-notebooks/[id]` accepts `displayName` | Live, no UI caller |
| `POST /api/decision-trace/[id]/feedback` (good/bad/missing_context/needs_review) | Live, unreachable from notebook (traceId never leaves `persist-usage.ts:93`) |
| AbortController pattern | Exists in `AssetChat.tsx:108` / `NodeChat.tsx:147` — not in NotebookChat, not on mobile |
| Offline work-order queue (`lib/offline-queue.ts`) | Live — the pattern chat retry should copy |

What is broken or missing — the gap this PRD closes:

| # | Gap | Evidence |
|---|---|---|
| C1 | No markdown rendering on either client; Studio "Spec & parts table" prompts for a markdown table and renders it raw | `app.css:375` `pre-wrap`; `NotebookScreen.tsx:97,905`; no markdown dep in either `package.json` |
| C2 | No token streaming on mobile — full body awaited then parsed once (up to 120 s blind) | `api/resources.ts:1070-1083`; `lib/sse.ts:3` "Phase-4" |
| C3 | No stop-generation anywhere in the notebook | no `AbortController` in `mira-mobile/src`; none in `NotebookChat.tsx` |
| C4 | Mobile composer is a single-line `<input>`: no auto-grow, no Enter-to-send, no key handling | `NotebookScreen.tsx:555-573`; zero `onKeyDown` in `src/**/*.tsx` |
| C5 | Web composer fixed `rows={1}`; no drag-drop, no paste (`onPaste` = 0 repo-wide), no IME guard | `NotebookChat.tsx:393-408` |
| C6 | No attach affordance in either composer; upload lives in the Sources panel/sheet | mobile `:347`; web sheet `equipment/[id]/page.tsx:300-403` (PDF only) |
| C7 | Failed mobile send clears and loses the typed question; no retry | `NotebookScreen.tsx:198`, `:553` |
| C8 | No per-message actions on either client: copy / regenerate / 👍👎 / share | mobile transcript `:483-551`; web `Bubble` `:57-192` |
| C9 | Server: no UPDATE path on turns, no regenerate, no per-turn feedback link (traceId never emitted in any frame) | `equipment-notebooks.ts:1116-1159`; `persist-usage.ts:93` |
| C10 | Starter chips hidden when `scope.length === 0` — invisible to exactly the §1.1 user; web pills prefill-only | `NotebookScreen.tsx:472-480`; `NotebookChat.tsx:41-46,346` |
| C11 | Server 4000-char message cap → bare 400; no client `maxLength` or paste-to-attachment | `chat/route.ts:402-406` |
| C12 | One notebook = one endless linear thread; no thread entity, no title, no "new chat," no turn search | mig 073 `equipment_notebook_turns` keyed on `notebook_id` only; `listNotebooks` no `q` |
| C13 | Rename: API exists, no UI on either client; new notebook on web is `window.prompt` | `[id]/route.ts:35-48`; `equipment/page.tsx:56-73` |
| C14 | `/equipment` absent from hub `NAV_ITEMS` — web notebooks reachable only by URL | `access-control.ts:87-136` |
| C15 | Web never posts `mode:"general"`; zero-sources short-circuits client-side → general mode is mobile-only | `NotebookChat.tsx:232-245,262` |
| C16 | Web parses and drops `safety` + `usage` frames; a safety hard-stop renders as a normal answer; mobile has no safety render path at all | `NotebookChat.tsx:286-294`; mobile `grep safety` = 0 |
| C17 | Follow-up chips not persisted (vanish on reload, both clients); mobile chip builder re-suggests the question just asked | `equipment/[id]/page.tsx:66-79`; #3427 note |
| C18 | Any tenant user can read/chat/delete any notebook — no notebook capability in `capabilities.ts:29-60`, `created_by` never read | `equipment-notebooks.ts:223` |
| C19 | No share/export of a turn or notebook | `src/app/api/public/` has only `report` |
| C20 | No chat rate limit; `plan`/`trial_expires_at` never consulted on the chat route | `chat/route.ts`; `session.ts:6-24` |
| C21 | Mobile: theme never settable (`data-theme` unused); web theme toggle hidden inside immersive notebook | `tokens.css:77-118`; `globals.css:321-333` |
| C22 | Only 2 of 6 basis values ever emitted; `oem_documentation` gets no badge | `chat/route.ts:856-866` |

**Where we already beat ChatGPT (preserve, and lead with):** page-cited answers that open
the original PDF page or photograph; persisted evidence badge; per-source scope
checkboxes; deterministic follow-up chips (ChatGPT ships none); refusal with zero provider
call; nameplate → manual discovery; photo OCR as evidence; offline WO queue (ChatGPT has no
offline retry or queue at all).

## 4. Requirements

Each requirement has an ID, an acceptance gate an agent can run, and its phase. "Device"
means physical-Pixel proof — **Mike-only**, never claimed by an agent. Commodity-before-
custom applies to every item: name the library (MIT/Apache) in the PR.

### RNDR — rendering (the answer looks like an answer)

- **RNDR-1 [Q1]** Markdown on both clients via one MIT renderer (`react-markdown` +
  `remark-gfm`; no `rehype-raw`, no HTML passthrough). Tables, lists, bold, code, headings.
  Citation `[n]` chips keep working *inside* rendered markdown (custom `text` node
  renderer, not a pre-split). Links open through the existing `requestBinary`/deep-link
  seams on mobile, never `window.open`. *Gate: fixture answer with a GFM table + `[1]` + a
  list renders a `<table>`, a citation button, and `<li>`s on both clients; Studio
  "Spec & parts table" renders as a table; refusal + safety copy unchanged; snapshot tests.*
- **RNDR-2 [Q1]** Code blocks get a copy button and language label (commodity: the
  renderer's `code` node + `navigator.clipboard` / Capacitor Clipboard). No run, no
  preview. *Gate: unit test on the code node; device-visible on Pixel (Mike).*
- **RNDR-3 [Q3]** Basis badge for every emitted basis, not only `general_reasoning`:
  `oem_documentation` / `workspace_evidence` / `machine_history` render a muted
  one-line basis caption (no amber). Server emits the correct value (C22). *Gate: route
  test — grounded answer streams `evidence.basis=oem_documentation`; both clients render
  the caption from the persisted row.*
- **RNDR-4 [Q3]** Safety frame renders distinctly on both clients (red-rule card, no
  citations, no follow-ups, no regenerate); mobile gains a safety render path. *Gate:
  safety-stop fixture renders the card; `X-Safety-Stop` path snapshot on both clients.*

### STRM — streaming & control

- **STRM-1 [Q1]** Mobile token streaming: `askNotebook` consumes the SSE body
  incrementally (Capacitor HTTP lacks a body stream → use `fetch` with the cookie jar
  header via the existing `request()` seam; document the choice). Same frame parser as
  today (`lib/sse.ts`), fed chunk-by-chunk. *Gate: fixture stream of 5 `content` frames
  produces 5 state updates; final turn byte-identical to the non-streaming parse;
  200-turn fuzz.*
- **STRM-2 [Q1]** Stop generation on both clients: `AbortController` wired to the
  composer's Stop button while `busy`. Server persists the partial turn as
  `answer_status='error'` with `answer_text` = what was streamed and no citations (a
  stopped answer is not an answer). *Gate: abort mid-stream → client shows the partial
  text + "Stopped" caption; route test confirms the persisted row; no provider retry.*
- **STRM-3 [Q2]** Pending state: skeleton/typing indicator with the retrieval stage
  ("Searching your docs…" → "Answering…") driven by the first `content` frame, not a
  static string. *Gate: snapshot before/after first content frame.*

### CMPS — composer

- **CMPS-1 [Q1]** Mobile composer becomes an auto-growing `<textarea>` (1–6 rows,
  CSS `field-sizing: content` with a `scrollHeight` fallback), `enterKeyHint="send"`,
  Enter sends / Shift+Enter newline on hardware keyboards, IME `isComposing` guard.
  Web gets auto-grow + the IME guard. *Gate: unit tests on key handling incl. composing;
  Pixel proof of on-screen-keyboard send (Mike).*
- **CMPS-2 [Q1]** Failure keeps the question: the typed text stays in the composer on
  any send error and a Retry chip re-sends it with the same history. *Gate: mocked 502 →
  input unchanged, retry sends identical body.*
- **CMPS-3 [Q2]** Attach from the composer: a `+` button that opens the *existing*
  Add-sources sheet (mobile) / Sources sheet (web) — no second upload path (one-pipeline
  law). An attached file becomes a scoped source for this turn onward. Web accepts
  images and `.txt` through the same `POST /api/files` door mobile already uses.
  *Gate: `+` → sheet; upload → source row → checkbox on → next turn's
  `sourceDocIds` includes it; no new upload route.*
- **CMPS-4 [Q2]** Long text honesty: client `maxLength=4000` with a live counter past
  3500; server 400 mapped to copy ("Too long — trim to 4000 characters"). Paste-to-
  attachment (ChatGPT's >10k rule) is deferred. *Gate: 4001 chars blocked client-side;
  route 400 renders the sentence.*
- **CMPS-5 [Q2]** Zero-setup empty state (C10): starter chips render when scope is empty
  with general-mode copy ("What does fault F004 mean on a PowerFlex 525?" …), tapping
  *sends*; the scoped variant keeps the existing three. Web pills also send. No copy
  anywhere implies setup first (CONV-5 stays green). *Gate: scope=0 → chips visible →
  tap → request with `mode:"general"`; CONV-5 grep unchanged.*
- **CMPS-6 [Q2]** Web reaches general mode: remove the client short-circuit at zero
  sources and post `mode:"general"` exactly as mobile does; badge renders from the
  `evidence` frame. *Gate: web zero-sources ask → server route hits the general path →
  amber badge; grounded path byte-identical.*

### MSG — per-message actions (the minimum viable set)

- **MSG-1 [Q2]** Copy answer (plain text with `[n]` markers and a trailing
  "Sources: [1] Title p.N" block so a pasted answer stays cited). Commodity clipboard.
  *Gate: unit test on the formatter; clipboard call asserted.*
- **MSG-2 [Q2]** Regenerate = a new turn with the same question, same scope, same
  history window, marked `regenerated_from` (new nullable UUID column on turns, mig
  next-free). Never edits or deletes the prior row (evidence record is append-only).
  Client renders a subtle "regenerated" caption. *Gate: route test — second row with
  `regenerated_from` set; list shows both; abort/refusal paths unchanged.*
- **MSG-3 [Q2]** 👍/👎 per answer: the chat route emits `traceId` in the `status` frame
  (seam on) and persists it on the turn (`decision_trace_id`); clients POST the existing
  `decision-trace/[id]/feedback` with verdict + optional reason chips
  (`wrong_answer | missing_source | wrong_citation | unsafe`). Seam off → no thumbs
  rendered (never a dead button). *Gate: frame carries `traceId`; feedback row written;
  thumbs hidden when `traceId` absent.*
- **MSG-4 [Q4]** Share a turn: tenant-scoped read-only link
  (`/equipment/[id]/turn/[turnId]`, session-gated — **not** public) rendering question,
  answer, badge, citations. Native share sheet on mobile (Capacitor Share). No
  anonymous links until MSG-6. *Gate: link 200 for tenant member, 401 outside; snapshot.*
- **MSG-5 [Q4]** Edit-and-resend a user message = MSG-2 with a new question
  (`regenerated_from` set, `question` differs). No branching pager; the log stays linear
  (evidence law). *Gate: same as MSG-2 with differing question.*
- **MSG-6 [Q4]** Export a notebook conversation (Markdown, citations as footnotes) via
  the existing `/api/export` shape. *Gate: export contains every persisted turn with
  basis + footnotes; tenant-scoped.*

### THRD — conversation model (decision first, then code)

- **THRD-0 [Q3, Mike's decision — blocks THRD-1..4]** Choose between:
  **(A) threads-per-notebook** — `equipment_notebook_threads` (id, notebook_id, title,
  created_at, archived_at) + nullable `thread_id` on turns, backfilled to one "Log"
  thread per notebook; auto-title from the first question (deterministic truncation,
  no LLM call); "New chat" inside a notebook; ChatGPT's Project ≈ our Notebook.
  **(B) one running log per machine** — declared doctrine; add day/session separators
  in the transcript and rely on THRD-2 search. The audit's recommendation is **A**: a
  machine's diagnoses are episodic, and technicians will want "the one from Tuesday"
  as a unit to share (MSG-4) and to hand off as a WO draft (parent IDNT-3).
  *Gate: Mike's call recorded on this PR; migration shape settled on ephemeral
  postgres BEFORE the file enters `db/migrations/` (rule 8 of mira-hub-migrations).*
- **THRD-1 [Q3]** Implement THRD-0's choice. If A: migration + `POST/GET .../threads`,
  chat route takes `threadId` (default = latest open thread), `listTurns` scoped by
  thread; both clients get a thread list (mobile: inside the Chat panel header; web: a
  left rail ≥ `md`, drawer below) and a "New chat." *Gate: create thread → ask → other
  thread unaffected; backfill idempotent; drift gate green; device proof (Mike).*
- **THRD-2 [Q3]** Search: tsvector GIN over `question || answer_text` per tenant;
  `GET /api/equipment-notebooks/search?q=` returning notebook + thread + turn hits;
  notebook-home search box on mobile, `Ctrl/Cmd+K` palette on web (commodity: `cmdk`,
  MIT). *Gate: query hits a turn by answer text across notebooks; RLS in-type; p95 <
  300 ms on staging corpus.*
- **THRD-3 [Q3]** Rename in UI on both clients (API exists); web "New notebook" replaces
  `window.prompt` with the mobile create form's copy. *Gate: rename persists; no
  `window.prompt` in `src/`.*
- **THRD-4 [Q4]** Persist follow-ups on the turn (`followups JSONB`) so chips survive
  reload; suppress a chip equal to the question just asked. *Gate: reload shows chips on
  the last turn only; duplicate suppressed.*

### PLAT — platform & policy (parallel; some Mike-gated)

- **PLAT-1 [Q1]** `/equipment` joins hub `NAV_ITEMS` ("Notebooks", capability
  `notebooks.read`) and the mobile-web drawer. *Gate: nav renders; sitemap test.*
- **PLAT-2 [Q2]** Notebook ACL: new capability pair `notebooks.read` /
  `notebooks.write` in `capabilities.ts`; DELETE and rename require `admin` or
  `created_by = userId`; chat/read stay tenant-wide (shift handoff is the point).
  *Gate: technician cannot delete another user's notebook (403); admin can.*
- **PLAT-3 [Q2]** Chat rate limit: reuse `ip-rate-limit.ts` keyed by tenant+user
  (default 60 turns / 10 min, env-tunable) → 429 with copy; trial-expired sessions get
  the existing trial banner path, not a silent 200. *Gate: 61st call 429; expired trial
  renders the banner.*
- **PLAT-4 [Q3]** Theme: mobile More tab gets a theme selector writing `data-theme`;
  web notebook header exposes the existing toggle. *Gate: `data-theme` set and
  persisted; both themes screenshot-checked (Screenshot Rule).*
- **PLAT-5 [Q3]** SSE contract comments corrected to the real wire order
  (`chat/route.ts:11-13`, `notebook-chat-types.ts:7-8`); `usage` frame rendered as a
  collapsed "answered by {provider} · {n} tokens" caption behind a debug flag.
  *Gate: doc drift test on the frame order.*
- **PLAT-6 [Q4]** Chat send queue on mobile: an offline/failed send is queued through
  the offline-queue pattern (never a background provider call — the queue replays the
  same POST when connectivity returns, with the user's consent chip). *Gate: airplane
  mode → queued → reconnect → sent once; idempotency key on the request.*

## 5. Phases and gates

Phases are ordered by perceived-quality-per-line and dependency. Q1 has no server
schema change and no decision gate — it can start today. Every phase ends with tests
green, lint clean, CHANGELOG note, PR opened and **HELD — merges are Mike's**.

| Phase | Contents | Exit gate |
|---|---|---|
| **Q1 — Looks like an answer** | RNDR-1, RNDR-2, STRM-1, STRM-2, CMPS-1, CMPS-2, PLAT-1 | Markdown tables render on both clients; phone streams tokens and can stop; composer grows, sends on Enter, keeps text on failure; web notebooks in nav. Unit gates offline; device proof (Mike) for streaming + keyboard. |
| **Q2 — Do things to a message** | MSG-1, MSG-2, MSG-3, CMPS-3, CMPS-4, CMPS-5, CMPS-6, STRM-3, PLAT-2, PLAT-3 | Copy/regenerate/thumbs live on both clients with the feedback row written; `+` attaches through the existing sheet; zero-setup chips send in general mode on both clients; ACL + rate limit enforced. |
| **Q3 — Find the conversation** | THRD-0 (decision) → THRD-1, THRD-2, THRD-3, RNDR-3, RNDR-4, PLAT-4, PLAT-5 | Mike's thread decision recorded; search finds a turn by answer text across notebooks; rename in UI; every basis and the safety frame render honestly. |
| **Q4 — Hand it to someone** | MSG-4, MSG-5, MSG-6, THRD-4, PLAT-6 | A turn can be shared tenant-scoped and exported; edit-and-resend; chips persist; offline sends queue and replay once. |

**Agent rules for every phase:** worktree off fresh `origin/main` (never the shared
checkout); read the constitution + the parent PRD + this PRD's gap rows before coding;
commodity-before-custom (name the library); no new provider paths, upload doors, or
conversation stores; regression sets named in the gate run before the PR claims them;
grounded/refusal/safety paths byte-identical unless the diff is shown; device claims are
Mike's alone. Any PR whose deployed code reads a new column applies its migration
immediately after merge (the #3421 trap) — the drift gate (#3317) now blocks the deploy
otherwise.

## 6. Explicitly out of scope

- **Model picker, reasoning slider, tools/plugins menu, `/` `@` `$` triggers** — the
  server owns the cascade; there is nothing for a technician to choose.
- **ChatGPT-style memory / custom instructions / personalities** — grounding law. A
  per-tenant *site glossary* ("our plant calls the packer CV-101") is a different,
  doctrine-safe feature and belongs in the namespace builder, not here.
- **Temporary chat** — every turn is an evidence record; a "don't persist" mode would
  be a second conversation store by another name.
- **Voice mode / dictation** — parked as in the parent PRD (§6). Note for later: ChatGPT's
  newest voice mode cannot use the camera; a field app that can is a differentiator.
- **Canvas / side-panel documents, code execution, image generation, web search** —
  OpenAI retired canvas for inline blocks; we stop at markdown + Studio artifacts.
- **Response branching pager (`< 1/2 >`)** — the log stays linear; MSG-2/MSG-5 append.
- **Anonymous public share links** — tenant-scoped only until a legal/data-controls
  review exists.
- **Group chats, projects-with-collaborator-roles, push notifications, widgets** — not
  this PRD.

## 7. Traceability

| Issue/PR/Doc | Requirement |
|---|---|
| Parent PRD CONV-1..5 | preserved; CMPS-5/CMPS-6 extend CONV-1/CONV-5 |
| #3387 (basis persistence, shipped) | RNDR-3 extends it to all basis values |
| #3224 / notebook-followups (CONV-4, shipped) | THRD-4 |
| #3427 note: chip re-suggests the asked question | THRD-4 |
| #3353 / #3436 camera | CMPS-3 reuses its sheet; no overlap |
| `.claude/rules/commodity-before-custom.md`, PR #3431 | every RNDR/STRM/CMPS item |
| `.claude/rules/one-pipeline-ingest.md` | CMPS-3 (no second upload door) |
| `.claude/rules/mira-hub-migrations.md` rule 8 | THRD-0/THRD-1, MSG-2, MSG-3 migrations |
| #3317 drift-gated deploys | all migration-bearing items |
| `lib/sse.ts:3` "Phase-4 streaming" comment | STRM-1 |
| `decision-trace/[id]/feedback` route | MSG-3 |
| `access-control.ts` NAV_ITEMS | PLAT-1 |
| `capabilities.ts` | PLAT-2 |
| Audit: `chatgpt-divergence-audit-2026-08-27` (session scratchpad; summary in memory `project_chatgpt_divergence_audit_2026_08_27`) | §3 gap table C1–C22 |
| ChatGPT reference: help.openai.com release notes through 2026-08-27 | §6 decisions (canvas retired May 28 2026; no follow-up chips; no offline queue) |
