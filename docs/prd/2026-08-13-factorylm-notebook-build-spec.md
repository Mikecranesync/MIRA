# FactoryLM — Full Build Specification (PRD for an AI Coding Agent)

> **Authority note (2026-09-05):** This remains an implementation-rich design source, not current
> product authority. [`docs/PRODUCT_CONSTITUTION.md`](../PRODUCT_CONSTITUTION.md) supersedes its
> web-only framing, strict source-only answer rule, and any implication that setup or a manual is
> required before L0 general maintenance help. Reuse and consolidate existing mobile/web code;
> this document does not authorize an end-to-end rebuild.

> **What this document is.** A complete, self-contained blueprint for building **FactoryLM**, an AI-grounded knowledge workspace for industrial equipment. FactoryLM is a functional clone of Google's **NotebookLM** (notebook.google.com), re-purposed from a general research tool into a purpose-built assistant for factory equipment manuals, sensor/telemetry data, and technical troubleshooting.
>
> **Who this is for.** An AI coding agent (e.g., Claude Code / Cursor) building the app end-to-end. Every section is written to be actionable: concrete screens, components, data models, API endpoints, a design-token system, and a phased build plan. Where a decision is left open, a **recommended default** is given so the agent can proceed without blocking.
>
> **Design source.** The UI/UX, feature set, and design tokens described here were captured directly from the live NotebookLM product (August 2026) and adapted. The design-token values are real, extracted from the running app, then rebranded for FactoryLM. Product decisions remain governed by the Product Constitution.

---

## 0. TL;DR for the builder

Build a three-panel web application:

1. **Sources** (left) — ingest equipment documentation (manuals, SOPs, schematics, work-order history, sensor logs) and manage which sources are "in context."
2. **Chat** (center) — ask natural-language questions and get answers **grounded strictly in the ingested sources, with inline numbered citations** back to the exact passage.
3. **Studio** (right) — generate reusable artifacts from the sources: **Troubleshooting Guide, Audio Overview (shift briefing), Maintenance Report, Flashcards, Quiz, Mind Map, Data Table, Video/Slide walkthrough**.

Under the hood it is a **RAG (retrieval-augmented generation) system**: documents are parsed, chunked, embedded, and stored in a vector database; user questions retrieve the most relevant chunks, which are fed to an LLM that must answer only from retrieved context and cite sources.

Stack (recommended default): **Next.js (React) + TypeScript** frontend, **FastAPI (Python)** backend, **Postgres + pgvector** for data and vectors, **S3-compatible** object storage for files, an **LLM via API (Gemini / Claude / GPT-class)** for generation, and an **embedding model** for retrieval. Deployable to cloud **and** on-premise (a hard requirement for many factory buyers).

The rest of this document specifies each of these in detail.

---

## 1. Product overview

### 1.1 Vision
Maintenance teams lose an estimated ~30% of their time hunting through scattered PDFs, binders, and tribal knowledge to fix equipment. FactoryLM turns a plant's entire documentation corpus into a single, conversational, **citation-grounded** expert that any technician can query in plain language — on the floor, on a tablet, or at a desk — and get an answer they can trust because every claim links back to the source manual.

### 1.2 The one-line pitch
> "Upload your equipment manuals, schematics, work orders, and sensor logs. Ask FactoryLM anything. Get step-by-step, cited answers — plus auto-generated troubleshooting guides, shift-briefing audio, and reports — grounded only in your own documentation."

### 1.3 Why this wins (value propositions)
- **Cut Mean-Time-To-Repair (MTTR):** instant retrieval of the exact procedure, torque spec, or error-code meaning instead of searching binders.
- **Capture tribal knowledge:** senior technicians' notes and past work orders become permanently queryable, surviving retirement and turnover.
- **Reduce failures & cost:** industry RAG deployments report large reductions in equipment failures and maintenance cost by removing procedural ambiguity. *(Directional, cite in marketing not in-product.)*
- **Trust through citations:** unlike a generic chatbot, every answer is grounded in the plant's own documents and shows its sources — critical in safety-sensitive environments.
- **Faster onboarding:** new technicians ramp up by asking questions instead of reading 800-page manuals.

### 1.4 Non-goals (v1)
- Not a CMMS replacement (it *integrates* with CMMS, it doesn't schedule/track work orders as system-of-record).
- Not a real-time control/SCADA system. Sensor data is ingested as context/logs, not for closed-loop control.
- Not a general-purpose chatbot; answers are grounded in ingested sources by design.

---

## 2. Target users & jobs-to-be-done

| Persona | Role | Primary jobs-to-be-done | Usage pattern |
|---|---|---|---|
| **Maintenance Technician** (primary daily user) | Fixes equipment on the floor | "What does error E-142 on the Haas VF-2 mean and how do I clear it?" · "Show me the lockout/tagout steps for this press." · "What's the torque spec for the spindle bolts?" | Mobile/tablet, on the floor, hands-busy → **Audio Overview & voice matter** |
| **Reliability / Maintenance Engineer** | Prevents failures, validates procedures | "Summarize every recorded failure of Line 3's conveyor and the root causes." · "Generate a PM checklist from the OEM manual." | Desktop, deep sessions, builds Studio artifacts |
| **Plant / Maintenance Manager** | ROI, uptime, compliance | "Give me a report of downtime causes this quarter." · "Are our SOPs consistent with the latest OEM revision?" | Reviews reports, buys the tool |
| **Operator / New Hire** | Runs equipment, learning | "How do I start up the packaging line safely?" · quizzes & flashcards for training | Tablet/kiosk, study mode |

**Design implication:** the technician is the daily user and is often gloved, on the floor, and time-pressured. Prioritize: fast search, mobile-responsive layout, large tap targets, offline-tolerant reading, and audio output.

---

## 3. Concept mapping: NotebookLM → FactoryLM

FactoryLM keeps NotebookLM's proven three-panel architecture and reskins every concept for the industrial domain.

| NotebookLM concept | FactoryLM equivalent | Notes |
|---|---|---|
| **Notebook** | **Asset Workspace** (a.k.a. "Machine Notebook") | One workspace per machine, line, or equipment family. Contains all docs + generated artifacts for that asset. |
| **Sources** | **Documentation & Data** | Manuals, SOPs, schematics, work orders, sensor logs, error-code tables, safety docs. |
| Upload PDF/doc | Upload manual/SOP/schematic | Same, with OCR for scanned manuals. |
| Website/YouTube source | OEM support page / equipment video | URL + video ingest with transcript. |
| Google Drive source | SharePoint / Drive / CMMS doc library | Enterprise connectors. |
| Copied text | Paste error text / technician note | Quick capture from the floor. |
| **Chat** (grounded Q&A + citations) | **Ask FactoryLM** | Identical UX: grounded answers, inline citations, follow-ups. Tuned with a maintenance/safety system prompt. |
| Inline citation chip `[1]` | Citation to manual page/section | Clicking opens the source at the cited passage. |
| **Studio** | **Studio** (industrial outputs) | Re-mapped output types (below). |
| Audio Overview (podcast) | **Shift Briefing / Audio Walkthrough** | Hands-free audio for on-the-floor listening. |
| Video Overview | **Visual Procedure Walkthrough** | Narrated slides of a repair/PM procedure. |
| Reports | **Maintenance Report / RCA / PM Checklist** | Structured docs from sources. |
| Study Guide / Flashcards / Quiz | **Training Pack** (flashcards, quiz) | For onboarding & certification. |
| Mind Map | **System Map** | Visual map of subsystems/components. |
| Data Table | **Spec / Parts / Error-Code Table** | Structured extraction (torque specs, part numbers, error codes). |
| Featured notebooks | **Template Library** | Prebuilt workspaces per common OEM/equipment type. |
| Public sharing | **Team / Plant sharing** | Role-based, org-scoped. |

### 3.1 FactoryLM-only additions (differentiators vs. a plain clone)
These are the features that make FactoryLM worth money beyond a NotebookLM reskin:
1. **Error-code lookup mode** — structured ingestion of error/fault-code tables; a query like "E-142" returns the definition, cause, and fix with citation.
2. **Sensor/telemetry context** — ingest CSV/time-series logs; chat can reference recent readings ("bearing temp trending up 12% over 3 shifts") alongside manual guidance.
3. **CMMS integration** — pull work-order history in; push a generated work order / RCA out (Phase 3).
4. **Safety-first guardrails** — LOTO (lockout/tagout) and PPE steps surfaced prominently; answers that involve hazardous procedures show a safety banner.
5. **Offline/floor mode** — cached read-only access to a workspace's key procedures and last answers when connectivity is poor.
6. **On-premise deployment** — many plants cannot send docs to the cloud; the whole stack must be self-hostable.

---

## 4. Information architecture & screens

```
FactoryLM
├── Auth (sign in / SSO)
├── Home / Dashboard              → list of Asset Workspaces (grid + list view)
│   ├── Controls: search, view toggle, sort ("Most recent"), + Create new
│   ├── Tabs: All · My workspaces · Templates · Collections
│   └── Workspace cards (cover, asset name, source count, last-updated)
├── Asset Workspace (the 3-panel core)
│   ├── Top bar: logo, workspace title (editable), + Create, duplicate,
│   │            analytics, share, settings, account
│   ├── Panel 1 — Sources
│   ├── Panel 2 — Chat ("Ask FactoryLM")
│   └── Panel 3 — Studio
├── Source Viewer (opens when a source is clicked; shows doc + highlighted citation)
├── Settings (account, org, members, integrations, model config, theme)
└── Admin (org management, on-prem config, audit log)   [Phase 3]
```

### 4.1 Responsive behavior (from the live product)
- **Wide (≥1200px):** all three panels visible side-by-side (Sources | Chat | Studio), panels resizable/collapsible.
- **Medium/Narrow (<1200px) & mobile:** the three panels collapse into a **top tab switcher** — `Sources · Chat · Studio` — showing one panel at a time. This is exactly how NotebookLM degrades and is the mobile pattern to replicate.
- Chat is the default active tab on entry.

### 4.2 Home / Dashboard — spec
- **Header:** FactoryLM logo (left), `Settings`, plan badge, app-switcher, account avatar (right).
- **Control row:** circular **search** button; **view toggle** (grid / list); **sort** dropdown (default "Most recent", also "Title", "Recently opened"); black pill **"+ Create new"** button (primary CTA).
- **Filter tabs:** `All`, `My workspaces`, `Templates` (prebuilt per common equipment), `Collections` (user-grouped).
- **Workspace card:** colored cover tile (category-colored, see design system), pinned asset/OEM badge, **title**, footer line = `{date} · {N} sources`, and a small type/visibility icon. Grid = 3-up cards; list = compact rows.
- **Empty state:** prompt to create the first workspace or start from a template.

### 4.3 Create-new flow (from the live product)
Clicking **"+ Create new"** immediately creates an **"Untitled workspace"** and drops the user into the workspace with an **empty state**:
- A friendly headline ("Let's set up your machine…") and a subtitle.
- A **unified prompt box**: *"Ask a question or create something"* with a live **"0 sources"** counter and submit arrow. With zero sources the app nudges the user to add sources first.
- The **Add sources** modal is one click away (see §5.2).

---

## 5. Panel 1 — Sources (Documentation & Data)

### 5.1 Layout
- Full-width **"+ Add sources"** button at the top of the panel.
- A **"Search the web for new sources"** inline box with two dropdowns — a **source-type filter** (default `Web`) and a **research-depth** selector (`Fast Research` / deep) — plus a search icon. (FactoryLM: scope this to OEM/support domains, and add an internal option to search the plant's connected doc libraries.)
- **Sources list** below: one row per source = `[type icon] {title} … [include/exclude checkbox]`, with a **"Select all"** control and a **filter/sort** icon in the list header.
- **Empty state:** document icon + "Saved sources will appear here" + "Drop files here or add a source".

### 5.2 Add-sources modal — ingestion options (from the live product)
The modal offers (replicate all):
- **Drag-and-drop drop zone:** "or drop your files — pdf, images, docs, audio, and more".
- **Upload files** — `pdf, docx, txt, md, images (png/jpg), audio`. FactoryLM adds: `csv/xlsx` (sensor logs, parts lists), `dwg/dxf/svg` schematics (rendered / OCR'd), scanned PDFs → **OCR pipeline required**.
- **Websites** — URL ingest, including video URLs (transcript extraction).
- **Drive / Enterprise** — Google Drive (v1); SharePoint / CMMS doc library / Box connectors (Phase 2–3).
- **Copied text** — paste raw text / a pasted error message / a technician note.
- **Web search for new sources** — same box as in-panel; returns candidate sources the user can add.

### 5.3 Source-type taxonomy (FactoryLM)
Tag every source with a type so the UI can icon/color it and so retrieval can filter:
`manual` · `sop` · `schematic` · `work_order` · `error_code_table` · `sensor_log` · `safety_loto` · `parts_list` · `oem_bulletin` · `technician_note` · `training` · `other`.

### 5.4 Behaviors
- **Include/exclude checkbox** per source controls whether that source is part of the retrieval context for chat & Studio (mirrors NotebookLM's "Select all"/per-source checkboxes). Excluded sources are stored but not retrieved.
- **Source click → Source Viewer:** opens the parsed document; when arrived at via a citation, scroll to and highlight the cited passage.
- **Processing state:** after upload, show per-source status (`Parsing → Chunking → Embedding → Ready`), with error handling for unreadable files.
- **Source limits:** enforce a configurable max sources & total token budget per workspace (NotebookLM-class context is large; default generous, e.g. up to 300 sources / large context, tunable).

---

## 6. Panel 2 — Chat ("Ask FactoryLM")

### 6.1 The defining feature: grounded, cited answers
This is the product's core and must be built faithfully:
- Answers are generated **only** from retrieved passages of the **included** sources. If the sources don't contain the answer, the assistant says so rather than hallucinating.
- Answers render **Markdown** (headings, **bold lead-ins**, bulleted steps, tables, code/mono for error codes & specs).
- **Inline citation chips**: small numbered pills (e.g. `1`, `2`) placed immediately after the sentence/claim they support. **Clicking a chip opens the Source Viewer at the exact cited passage** (highlighted).
- Multi-step "thinking" status while generating (observed states: *"Searching your docs…" → "Refining response approach…"*). Show a lightweight animated status line.

### 6.2 Message & interaction spec
- **User message:** right-aligned, light-grey rounded bubble.
- **Assistant answer:** left-aligned, no bubble, full-width markdown, with inline citations.
- **Per-answer actions** (row under each answer): **Save to note**, **Copy**, **thumbs up**, **thumbs down**.
- **Answer tail:** the assistant often closes with a clarifying question and offers **suggested follow-up chips** (tappable) — replicate (e.g., "How do I clear this fault?", "Show the LOTO steps", "What parts do I need?").
- **Empty-state quick-starts** (chips above the input): map NotebookLM's ("Learn a new topic / Create something new / Make progress") to FactoryLM: **"Diagnose a fault"**, **"Look up a spec or part"**, **"Generate a procedure"**.
- **Composer:** bottom input "Ask a question or create something", with a live **"{N} sources"** counter and a submit arrow; **Chat options** menu (set answer "goal": *Technician steps* / *Engineer detail* / *Manager summary*, and length/format) — this maps to NotebookLM's chat customization (topic, audience, expertise level).
- **Scroll-to-bottom** affordance appears on scroll-up.
- **Notes:** "Add note" creates a saved note in the workspace (notes can themselves become a source / feed Studio).

### 6.3 System-prompt requirements (maintenance tuning)
The RAG generation prompt must:
1. Answer strictly from retrieved context; cite each claim; if unknown, say so.
2. Prefer **numbered, step-by-step** procedures for repair/PM questions.
3. **Surface safety first**: if a procedure involves hazardous energy, lead with a LOTO/PPE safety note and a visible **safety banner** in the UI.
4. Preserve exact values verbatim (torque specs, part numbers, error codes, voltages) — never paraphrase a number.
5. Respect the selected answer "goal"/persona for depth and tone.

---

## 7. Panel 3 — Studio (generated artifacts)

Studio turns the workspace's sources into **reusable, storable outputs**. The panel is a grid of output-type tiles; clicking one generates that artifact (grounded in the included sources) and stores it in the workspace. Multiple outputs of the same type can be stored (e.g., several reports).

### 7.1 Output types (mapped from the live NotebookLM Studio)
NotebookLM's Studio exposes: **Audio Overview, Video Overview, Slide Deck, Mind Map, Reports, Flashcards, Quiz, Infographic, Data Table**. FactoryLM maps them:

| Tile | What it generates | Primary persona |
|---|---|---|
| **Audio Overview** → *Shift Briefing* | A narrated audio walkthrough / two-voice "briefing" summarizing the asset's key procedures or a specific fix. Hands-free for the floor. Customizable (topic, audience, length, language). | Technician |
| **Video Overview** → *Visual Procedure Walkthrough* | Narrated slides showing a repair/PM procedure with the manual's diagrams & callouts. | Technician / Trainee |
| **Slide Deck** → *Procedure Deck* | Editable slide deck of a procedure or asset overview. | Engineer / Trainer |
| **Reports** → *Maintenance Report / RCA / PM Checklist* | Structured documents: Root-Cause Analysis, Preventive-Maintenance checklist, downtime summary, "how this machine works" brief. Offer templates. | Engineer / Manager |
| **Mind Map** → *System Map* | Interactive node map of subsystems/components and their relations. | Engineer |
| **Flashcards** → *Training Flashcards* | Q/A cards for onboarding & certification. | Trainee |
| **Quiz** → *Competency Quiz* | Auto-graded quiz from the sources for skills sign-off. | Trainee / Manager |
| **Data Table** → *Spec / Parts / Error-Code Table* | Structured extraction into a table (torque specs, part numbers, fault codes → cause → fix). Exportable to CSV. | Technician / Engineer |
| **Infographic** → *One-page Asset Sheet* | A single visual reference sheet for an asset. | All |

### 7.2 Studio behaviors
- **Customization dialog** before generating (mirrors NotebookLM): focus topic, target audience/persona, expertise level, length, language. Store these with the output so it can be regenerated.
- **Empty/locked state:** with 0 sources, tiles show "After adding sources, click to create." (observed behavior).
- **Stored outputs list:** generated artifacts appear as cards in the panel; each can be opened, renamed, regenerated, downloaded/shared, or deleted.
- **Grounding + citations** apply to generated artifacts too (a report cites its sources).
- **Async generation:** long outputs (audio/video) generate in the background with progress + notification on completion.

### 7.3 Priority for MVP
Ship in this order: **Reports (RCA/PM checklist)** and **Data Table (error-code/spec extraction)** first — highest maintenance value and cheapest to build — then **Audio Overview (Shift Briefing)**, then **Flashcards/Quiz**, then **Mind Map**, then **Video/Slide** (most expensive).

---

## 8. Design system

The live product is built on **Angular Material (Material Design 3)** with a custom token layer. FactoryLM should reproduce the *feel* (clean, calm, high-contrast, light/dark) while rebranding color and (optionally) type. The token values below are **real values extracted from the running NotebookLM app**, then adapted. A ready-to-use `factorylm-design-tokens.css` accompanies this spec.

### 8.1 Typography
- **NotebookLM uses:** `Google Sans` (display/headings) and `Google Sans Text` (body/UI). Headings 24px/weight 400; body 16px; UI labels 14px/weight 500.
- **FactoryLM recommendation:** since Google Sans isn't licensable for third-party apps, use **`Inter`** (UI/body) + a slightly wider display face such as **`Inter Display`** or **`Space Grotesk`** for headings — near-identical geometric feel, open-license. Add **`JetBrains Mono`** (or `Roboto Mono`) for **error codes, part numbers, torque specs, and telemetry** so exact values are visually distinct and unambiguous.
- Scale: `display 28/32` · `headline 24/32` · `title 18/24` · `body 16/24` · `label 14/20` · `mono 14/20`.

### 8.2 Color tokens (extracted, then rebranded)
NotebookLM's real tokens (for reference): Material primary `#0b57d0`, action-accent indigo `#4259ff` (dark `#c3cafc`), surface `#fff` / dark `#22262b`, surface-container `#f0f4f9`, on-surface text `#1f1f1f`, outline `#747775`, error `#b3261e`, pastel tiles (yellow `#f2f2e8`, green `#e1f1e5`, blue `#edeffa`), corner radii large `16px` / medium `12px` / buttons pill `100px`, full **light/dark** via CSS `light-dark()`.

**FactoryLM palette** (industrial rebrand — trust-blue primary + high-visibility "safety amber" accent, with equipment-state semantic colors):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--flm-primary` | `#1558d6` | `#a9c7ff` | Primary actions, links, active states |
| `--flm-on-primary` | `#ffffff` | `#08152e` | Text on primary |
| `--flm-accent` (safety amber) | `#ff7a00` | `#ffb861` | High-visibility CTAs, highlights, "attention" |
| `--flm-surface` | `#ffffff` | `#1a1d21` | Page/panel background |
| `--flm-surface-container` | `#f2f5f9` | `#22262b` | Cards, raised surfaces |
| `--flm-on-surface` | `#1a1c1e` | `#e3e3e6` | Body text |
| `--flm-on-surface-muted` | `#5e6265` | `#a8abb0` | Secondary text |
| `--flm-outline` | `#d3d8df` | `#3a3d42` | Borders, dividers |
| `--flm-btn-primary-bg` | `#101317` | `#f2f2f2` | Black pill primary button (as in NotebookLM) |
| `--flm-btn-primary-fg` | `#ffffff` | `#101317` | Primary button text |
| **Status — operational** `--flm-status-ok` | `#1c8a4d` | `#7fe0a6` | Machine running / healthy |
| **Status — warning** `--flm-status-warn` | `#c47f00` | `#ffcf70` | Degraded / watch |
| **Status — fault/down** `--flm-status-fault` | `#c0261e` | `#ff9b93` | Fault / stopped |
| **Category tiles** | `#e7eefc` / `#eafaf0` / `#fff3e6` / `#f1eefc` | dark equivalents | Workspace card covers by equipment category |

- **Radii:** cards `16px`, inputs/menus `12px`, **buttons `100px` (pill)** — keep NotebookLM's pill buttons.
- **Elevation:** subtle; rely on 1px `--flm-outline` borders and soft shadows, not heavy drop-shadows.
- **Mode:** implement both light & dark from day one using CSS custom properties + `prefers-color-scheme` (with a manual toggle in Settings).
- **Safety banner** style: amber/red bordered callout used above hazardous procedures.

### 8.3 Core components (build as a reusable library)
`AppTopBar`, `WorkspaceCard`, `PanelTabs` (responsive Sources/Chat/Studio switcher), `AddSourceButton`, `AddSourceModal`, `WebSearchBox` (type + depth dropdowns), `SourceRow` (icon + title + include checkbox), `SourceViewer` (doc + highlighted citation), `ChatMessage` (user bubble / assistant markdown), `CitationChip`, `AnswerActions` (save/copy/👍/👎), `FollowUpChips`, `Composer` (input + source counter + submit), `StudioTile`, `StudioOutputCard`, `CustomizeOutputDialog`, `SafetyBanner`, `ProcessingStatus`, `ThemeToggle`, `EmptyState`.

Use **shadcn/ui + Tailwind** (recommended) or **MUI (Material)** to match the MD3 origin most closely. Either is acceptable; shadcn/Tailwind is lighter and easier for an AI agent to customize.

---

## 9. Architecture (RAG system)

```
                         ┌─────────────────────────────────────────┐
                         │              Frontend (SPA)              │
                         │  Next.js + React + TS + Tailwind/shadcn  │
                         └───────────────┬─────────────────────────┘
                                         │ HTTPS / JSON + SSE (streaming)
                         ┌───────────────▼─────────────────────────┐
                         │              API (backend)               │
                         │   FastAPI (Python)  ·  Auth  ·  RBAC     │
                         └───┬───────────────┬───────────────┬──────┘
        Ingestion pipeline   │               │ Chat/RAG      │ Studio jobs
   ┌──────────────────────┐  │   ┌───────────▼──────────┐   ┌▼───────────────┐
   │ parse → OCR → chunk   │  │   │ retrieve top-k chunks │   │ async workers   │
   │ → embed → index       │  │   │ → build prompt → LLM  │   │ (audio/video/    │
   └───────┬──────────────┘  │   │ → stream + citations  │   │  report gen)     │
           │                 │   └───────────┬──────────┘   └──────────────────┘
   ┌───────▼─────────┐  ┌────▼─────┐  ┌───────▼────────┐  ┌────────────────────┐
   │ Object storage  │  │ Postgres │  │ Vector store   │  │ LLM + Embedding APIs│
   │ (S3/MinIO) files│  │ metadata │  │ (pgvector)     │  │ (Gemini/Claude/GPT) │
   └─────────────────┘  └──────────┘  └────────────────┘  └────────────────────┘
```

**RAG flow (chat):**
1. User asks a question in a workspace with N included sources.
2. Embed the query; **retrieve** top-k chunks (vector similarity + optional keyword/BM25 hybrid + metadata filter by source type) from the workspace's included sources only.
3. **Re-rank** (optional cross-encoder) and assemble a context window that stays within the model budget; keep chunk→source/page provenance.
4. Build the prompt (system rules from §6.3 + retrieved chunks with IDs + chat history + selected persona/goal).
5. **Stream** the LLM answer; parse citation markers the model emits (e.g., `[chunk_id]`) and map them to numbered chips + source/page anchors.
6. Persist the turn (question, answer, cited chunk IDs) to chat history.

**Ingestion pipeline:** upload → detect type → **parse** (PDF/office/text) → **OCR** scanned pages/images → **normalize** → **chunk** (structure-aware: keep tables, steps, and error-code rows intact; ~500–1000 tokens with overlap) → **embed** → **upsert** to vector store with metadata `{workspace_id, source_id, source_type, page, section}`. Emit per-source status events to the UI.

---

## 10. Data model (Postgres)

```sql
-- Core entities (abridged; use UUID PKs, created_at/updated_at on all)
organizations(id, name, plan, on_prem BOOLEAN, settings JSONB)
users(id, org_id, email, name, role)              -- role: admin | engineer | technician | viewer
workspaces(id, org_id, owner_id, title, asset_category, cover_color,
           visibility, settings JSONB)             -- "Asset Workspace"
sources(id, workspace_id, type, title, filename, storage_key,
        status, page_count, meta JSONB, included BOOLEAN DEFAULT true)
        -- type: manual|sop|schematic|work_order|error_code_table|
        --       sensor_log|safety_loto|parts_list|oem_bulletin|
        --       technician_note|training|other
chunks(id, source_id, workspace_id, ordinal, text, page, section, token_count)
embeddings(chunk_id, embedding VECTOR(1536))       -- pgvector; dim per model
chat_messages(id, workspace_id, role, content, citations JSONB, goal, created_at)
notes(id, workspace_id, author_id, title, content)
studio_outputs(id, workspace_id, type, title, status, params JSONB,
               content JSONB, asset_key, created_by)
               -- type: audio|video|slide|report|mindmap|flashcards|quiz|datatable|infographic
error_codes(id, workspace_id, source_id, code, meaning, cause, fix, severity)  -- structured extract
sensor_series(id, workspace_id, source_id, tag, unit, points JSONB)            -- ingested telemetry
integrations(id, org_id, kind, config JSONB)       -- drive|sharepoint|cmms|box
audit_log(id, org_id, user_id, action, target, at)  -- Phase 3, on-prem/compliance
```

Indexes: pgvector IVFFlat/HNSW on `embeddings.embedding`; btree on `chunks(workspace_id)`, `sources(workspace_id)`, `error_codes(workspace_id, code)`.

---

## 11. API surface (representative REST)

```
Auth
  POST /auth/login · /auth/sso/callback · GET /me

Workspaces
  GET  /workspaces                       list (dashboard)
  POST /workspaces                       create ("Untitled workspace")
  GET/PATCH/DELETE /workspaces/{id}

Sources
  POST /workspaces/{id}/sources          upload (multipart) / url / pasted text
  GET  /workspaces/{id}/sources          list + processing status
  PATCH /sources/{id}                    toggle `included`, rename
  DELETE /sources/{id}
  GET  /sources/{id}/content             parsed doc for Source Viewer
  POST /workspaces/{id}/web-search       "search the web for new sources"

Chat  (streaming)
  POST /workspaces/{id}/chat             {message, goal} → SSE tokens + citations
  GET  /workspaces/{id}/chat             history
  POST /messages/{id}/feedback           👍/👎
  POST /workspaces/{id}/notes            save-to-note

Studio  (async)
  POST /workspaces/{id}/studio           {type, params} → job id
  GET  /studio/{jobId}                   status/result
  GET  /workspaces/{id}/studio           list stored outputs
  GET  /studio/{id}/export               download (pdf/csv/mp3/mp4/pptx)

Integrations / Admin (Phase 2–3)
  POST /orgs/{id}/integrations · GET /orgs/{id}/audit-log
```

Streaming: use **SSE** (or WebSocket) for chat token streaming and the "Searching your docs… / Refining…" status events, and for Studio job progress.

---

## 12. Recommended tech stack (with rationale & alternatives)

| Layer | Recommended default | Why / alternatives |
|---|---|---|
| **Frontend** | Next.js 14+ (React, TypeScript, App Router) + Tailwind + shadcn/ui | Fast to build, great streaming/SSE support, easy for an AI agent. *Alt:* Angular + Angular Material to match the original 1:1. |
| **State/data** | TanStack Query + Zustand | Server-cache + light client state. |
| **Backend** | FastAPI (Python) | Best-in-class for AI/RAG glue, async, typed. *Alt:* Node/NestJS if you want one language. |
| **DB + vectors** | Postgres + **pgvector** | One system for metadata + vectors; simplest ops, on-prem friendly. *Alt:* Qdrant/Weaviate/Pinecone if scale demands. |
| **Object storage** | S3 (cloud) / **MinIO** (on-prem) | Store original files; MinIO keeps it self-hostable. |
| **Ingestion/parsing** | `unstructured` / `pymupdf` + **OCR (Tesseract / PaddleOCR)** | Scanned manuals are common → OCR is mandatory. Structure-aware chunking (LlamaIndex/LangChain helpers). |
| **Embeddings** | A strong embedding model via API (or local `bge`/`e5` for on-prem) | Local option is essential for air-gapped plants. |
| **LLM** | Gemini / Claude / GPT-class via API | Pluggable provider; for strict on-prem, support a local model (Llama-class) behind the same interface. |
| **Async jobs** | Celery/RQ + Redis (or Dramatiq) | Studio audio/video/report generation off the request path. |
| **Audio/Video** | TTS provider for Audio Overview; slide-render + TTS + ffmpeg for Video Overview | Start with audio; video is Phase 2+. |
| **Auth** | Auth.js / Clerk (cloud) or Keycloak (on-prem) + SSO/SAML | Enterprise SSO expected. |
| **Deploy** | Docker Compose (single-node on-prem) + Kubernetes (cloud/multi-tenant) | **On-prem is a hard requirement** — ship a self-contained compose file. |

**Model-provider abstraction:** put all LLM/embedding/TTS calls behind a provider interface so cloud vs. on-prem/local is a config switch. This is the single most important architectural decision for selling into factories.

---

## 13. Build plan (phased)

### Phase 0 — Foundations (week 1)
Repo scaffold (frontend + backend + docker-compose), design tokens (`factorylm-design-tokens.css`), component library skeleton, auth, org/user/workspace CRUD, Home dashboard (grid/list, create-new → empty workspace).

### Phase 1 — MVP: Sources + Chat (weeks 2–4)  ← *the core loop*
- Add-sources modal (upload PDF/docx/txt, paste text, URL) + ingestion pipeline **with OCR** → parse/chunk/embed/index.
- Sources panel: list, include/exclude checkboxes, processing status, Source Viewer.
- Chat: RAG retrieval + **streaming grounded answers with inline citation chips** → clicking a chip opens the cited passage. Per-answer actions, follow-up chips, "goal" selector, save-to-note.
- Responsive 3-panel ↔ tab-switcher layout; light/dark.
- **Definition of done for MVP:** a technician uploads a real equipment manual and gets a correct, cited, step-by-step answer to a maintenance question on desktop and mobile.

### Phase 2 — Studio + differentiators (weeks 5–8)
- Studio: **Reports (RCA/PM checklist)** and **Data Table (error-code/spec extraction)** first, then **Audio Overview (Shift Briefing)**, then Flashcards/Quiz, then Mind Map.
- Error-code lookup mode; sensor/telemetry CSV ingest + reference-in-chat.
- Web-search-for-sources; Google Drive connector; Templates library.
- Safety guardrails + safety banner; export (pdf/csv/mp3).

### Phase 3 — Enterprise & scale (weeks 9–12+)
- On-prem packaging (MinIO + local embedding/LLM), SSO/SAML, RBAC, audit log.
- CMMS/SharePoint connectors (pull work orders, push RCA/work order).
- Video/Slide Overviews; offline/floor mode; team sharing & collections; analytics.

---

## 14. Non-functional requirements

- **Grounding integrity:** answers must not assert facts absent from retrieved sources; must cite; must say "not found in your sources" when appropriate. This is a *correctness* requirement, not a nicety — test it.
- **Exact-value fidelity:** numbers/codes/part-numbers rendered verbatim (mono), never paraphrased.
- **Security & tenancy:** strict per-org / per-workspace data isolation; retrieval filtered to the workspace; encryption at rest & in transit.
- **On-prem / air-gapped mode:** entire stack runnable with no outbound internet (local models + MinIO). No telemetry leaves the plant when in this mode.
- **Performance:** first chat token < ~2s typical; ingestion of a 300-page manual < a few minutes with visible progress.
- **Accessibility:** WCAG AA, keyboard-navigable, large tap targets (floor/gloved use), high-contrast mode.
- **Reliability of citations:** every citation chip must resolve to a real, highlightable passage (no dangling citations).
- **Mobile/tablet first for technicians:** the Chat + Source Viewer must be excellent on a tablet.

---

## 15. Acceptance criteria (build-verifiable)

1. Create a workspace, upload a scanned PDF manual → it OCRs, processes to "Ready," and appears in Sources.
2. Toggle a source off → its content no longer influences answers.
3. Ask a question answerable from the manual → streamed markdown answer with ≥1 inline citation chip; clicking it opens the Source Viewer at the highlighted passage.
4. Ask something *not* in the sources → assistant declines/answers "not found," does not fabricate.
5. A hazardous-procedure answer shows the **safety banner** and leads with LOTO/PPE.
6. Generate a **Maintenance Report** and an **Error-Code Table** in Studio; both cite sources and are exportable.
7. Generate a **Shift Briefing** audio; it plays and reflects the sources.
8. Resize below 1200px → panels collapse into the `Sources · Chat · Studio` tab switcher; all features usable on a tablet.
9. Toggle dark mode → all screens render correctly with the FactoryLM tokens.
10. Run the entire stack via `docker compose up` with a local model config (no external API) → chat still works (on-prem proof).

---

## 16. Appendix A — Live-capture checklist (what the clone must match)

Captured directly from notebook.google.com (Aug 2026) and reflected above:
- **Dashboard:** logo · Settings · plan badge · app-switcher · avatar; search / view-toggle / "Most recent" sort / **black pill "+ Create new"**; tabs **All · My notebooks · Featured · Collections**; colored notebook cards with `{date} · {N} sources`.
- **Create-new** → instantly opens an **"Untitled notebook"** empty workspace with a unified prompt box + live source counter.
- **Sources panel:** **"+ Add sources"** · **"Search the web for new sources"** (Web + Fast Research dropdowns) · source rows with **include/exclude checkboxes** + **Select all** + filter · empty state "Saved sources will appear here / Drop files here".
- **Add-sources modal:** drop zone ("pdf, images, docs, audio, and more") · **Upload files · Websites (incl. YouTube) · Drive · Copied text** · web search.
- **Chat:** grey user bubbles (right) · full-width markdown answers (left) with **inline numbered citation chips** · multi-step status ("Searching your docs…", "Refining response approach…") · per-answer **save/copy/👍/👎** · **suggested follow-up chips** · quick-start prompts · bottom composer with **"{N} sources"** counter.
- **Studio tiles:** **Audio Overview · Video Overview · Slide Deck · Mind Map · Reports · Flashcards · Quiz · Infographic · Data Table**; multiple stored outputs per type; customization by topic/audience/level/language.
- **Design:** Google Sans / Google Sans Text · black pill buttons · Material blue `#0b57d0` · accent indigo `#4259ff` · 16/12/pill radii · full **light/dark** (`light-dark()` tokens).

## 17. Appendix B — Assumptions & open questions for Mike

Decided as sensible defaults (change if you disagree):
- **Brand color:** trust-blue primary + safety-amber accent + equipment-state semantics (green/amber/red). Swap in your real FactoryLM brand colors in the token file when you have them.
- **Type:** Inter + JetBrains Mono as open substitutes for Google Sans (which can't be licensed for third-party apps).
- **LLM provider:** pluggable; pick your preferred API for cloud and a local model for on-prem.

Worth your input before/**during** build:
1. **Cloud-first or on-prem-first?** Many factory buyers demand on-prem/air-gapped — it changes model choices. (Spec supports both; which do we optimize first?)
2. **CMMS/systems you must integrate** (e.g., Fiix, UpKeep, SAP PM, Maximo)? Determines Phase 3 connectors.
3. **First target equipment/vertical** (CNC, packaging, HVAC, robotics…)? Lets us seed the Templates library and tune ingestion.
4. **Pricing model** (per-seat, per-plant, per-asset) — affects org/workspace limits & metering.

---

*End of specification. Companion files: `factorylm-design-tokens.css` (drop-in CSS variables) and the captured reference screenshots.*
