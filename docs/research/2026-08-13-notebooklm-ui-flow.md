# NotebookLM UI & Page Flow — Screen-by-Screen Inventory (Web + Android, 2025–2026)

**Date:** 2026-08-13
**Purpose:** Document Google NotebookLM's screens and interactions against primary sources so another app (MIRA mobile / Equipment Notebook) can mirror the flow.
**Method:** WebSearch + WebFetch against blog.google, support.google.com, and reputable hands-on coverage (9to5Google, Android Police, XDA). Every claim carries a source URL. Web-app vs Android-app behavior is split explicitly. Uncertain items are flagged **[UNCERTAIN]**.

> **Naming note:** NotebookLM was renamed **"Gemini Notebook"** in July 2026
> ([Google Workspace Updates](https://workspaceupdates.googleblog.com/2026/07/notebooklm-now-gemini-notebook.html)).
> Current support pages live under both `support.google.com/notebooklm` and
> `support.google.com/gemininotebook`. This doc uses "NotebookLM" throughout since that is
> the UI generation being mirrored.

---

## 1. Home screen — notebook list

### 1a. Android app home screen

Verified layout (launch version, May 2025, still current shape):

| Element | Position | Details | Source |
|---|---|---|---|
| Filter/sort chips | Top of screen | **"Recent, Shared, Title, and Downloaded"** — four chips/tabs above the notebook list | [9to5Google launch hands-on](https://9to5google.com/2025/05/19/notebooklm-app-launch/), [9to5Google I/O gallery](https://9to5google.com/2025/05/01/notebooklm-android-iphone/), [Google support: mobile app get-started](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid) |
| Notebook cards | Scrolling list/grid | "Colorful cards" — each shows the notebook's **emoji**, **title/name**, **number of sources**, **date**, and a **play button** for the Audio Overview | [9to5Google launch hands-on](https://9to5google.com/2025/05/19/notebooklm-app-launch/), Android Police coverage (via [search](https://www.androidpolice.com/google-teases-notebooklm-android-app/)) |
| "Create new" button | Bottom of screen, wide pill-shaped FAB | Starts the notebook-creation flow (goes straight to add-source) | [9to5Google I/O gallery](https://9to5google.com/2025/05/01/notebooklm-android-iphone/), [support](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid) |
| Camera FAB | Homepage (also in Sources tab) | Added ~Dec 2025. Opens the device's native camera; the photo (handwritten notes, whiteboards, printed pages, infographics) becomes a source | [9to5Google camera article](https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/) |
| "Downloaded" section | Reached via the Downloaded chip | Where offline-downloaded Audio Overviews live: "you can find your downloaded audios in the Downloaded section on the main page of the app" | [support](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid) |
| Theme | Global | Light/dark follows the device system theme; no in-app toggle | [9to5Google launch hands-on](https://9to5google.com/2025/05/19/notebooklm-app-launch/) |

Interactions:
- Tap a card → opens the notebook (Sources/Chat/Studio bottom-tab view, §4).
- Tap the card's **play button** → plays that notebook's Audio Overview directly from the home screen (background playback supported). ([9to5Google](https://9to5google.com/2025/05/19/notebooklm-app-launch/))
- Tap **Create new** → add-source flow for a fresh notebook (§5).
- Tap **camera FAB** → native camera → photo becomes a source (new or existing notebook). ([9to5Google](https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/))

**[UNCERTAIN]** The chip set **"All / My notebooks / Shared / Downloaded"** (as phrased in the research question) could **not** be confirmed in any primary or hands-on source. Every source found documents the Android chips as **Recent / Shared / Title / Downloaded** (which read as sort+filter options). If the app has since relabeled the chips, no citable source captured it — do not assume "All / My notebooks" on mobile.

**[UNCERTAIN]** "Pastel background colors" — sources consistently say "colorful cards" ([9to5Google](https://9to5google.com/2025/05/19/notebooklm-app-launch/)); screenshots show muted pastel-like tints, but no source names the palette. Treat exact colors as unverified.

### 1b. Web app home screen

- The web homepage is a card list of "Notebooks" plus (since June 2025) a **"Featured notebooks"** row of expert-curated public notebooks (The Economist, The Atlantic, etc.) ([blog.google featured notebooks](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-featured-notebooks/), [nembal UX teardown](https://www.nembal.com/blog/notebooklm_fixes) — that teardown calls the sections "Notebooks" and "Example Notebooks").
- Cards carry an auto-generated **emoji** per notebook; clicking the emoji opens an emoji picker to override it ([XDA](https://www.xda-developers.com/notebooklm-notebook-emoji-customization/)).
- Notebooks shared with you "appear at the top of the notebook list" ([Google Cloud docs: share notebooks](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/share-notebooks)).
- **[UNCERTAIN]** Exact web-home filter-chip labels and a grid/list toggle could not be confirmed from primary sources; no support page enumerates them. Mirror the card anatomy (emoji + title + "N sources · date"), not specific chip labels.

---

## 2. Add-source flow

### 2a. Web — the "Add sources" dialog

Opened from the **Add** button in the Sources panel (and automatically for a brand-new notebook, §5). Contents per the official support page ([Add or discover new sources — computer](https://support.google.com/notebooklm/answer/16215270?hl=en)):

1. **Search/research box at top** — type a research question, then find sources from the **web** or from **Google Drive**:
   - **Fast Research** — quick web/Drive search; results show title + a relevance description; you check the ones to import.
   - **Deep Research** toggle — agentic browsing "across hundreds of websites," generates a multi-page report, then lets you import selected sources.
   - This evolved from the original **"Discover sources"** button (launched 2025-04-02): describe a topic → NotebookLM returns "up to 10 of the most relevant web sources, complete with annotated summaries" → one-click add; plus an **"I'm Feeling Curious"** random-topic button ([blog.google Discover sources](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-discover-sources/), [Workspace Updates](https://workspaceupdates.googleblog.com/2025/04/updates-to-sources-for-NotebookLM-and-NotebookLMPlus.html)).
2. **Upload area** — a large drag-and-drop / "choose file" zone dominates the dialog ([nembal](https://www.nembal.com/blog/notebooklm_fixes), [geshan hands-on](https://geshan.com.np/blog/2025/11/how-to-use-notebooklm/)).
3. **Source-type options** (all from [support](https://support.google.com/notebooklm/answer/16215270?hl=en)):
   - Google Drive: **Google Docs**, **Sheets** (100k-token limit), **Slides** (≤100 slides)
   - Files: **PDF**, **.txt**, **Markdown (.md)**, **Word (.docx)**, **PowerPoint (.pptx)**, **CSV**, **ePub**
   - **Audio files** (MP3, WAV, others — transcribed on import)
   - **Images** (AVIF, BMP, GIF, HEIC, HEIF, ICO, JP2, JPEG, PNG, TIFF, WebP) — images-as-sources reached web ~Nov 2025 ([9to5Google](https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/))
   - **Link**: web URLs (text only — embedded images/videos of the page excluded) and **YouTube URLs** (public videos with captions only)
   - **Copied text** (paste; you can create/edit its title)
   - **Gemini chats** as context
4. After picking a type: file picker / URL field / paste field as appropriate; the source is ingested and appears in the Sources panel list, and chat/suggested questions refresh against it ([gist of NotebookLM docs](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3)).

**Limits** (official, [support](https://support.google.com/notebooklm/answer/16215270?hl=en)):
- **Up to 50 sources per notebook (Free)** — higher on paid tiers (third-party guides cite ~300 for Pro; treat the exact paid number as **[UNCERTAIN]**, e.g. [elephas.app](https://elephas.app/blog/notebooklm-source-limits)).
- **Per source: up to 500,000 words OR 200 MB** for uploaded files, whichever hits first. Imports exceeding either limit fail; copy-protected PDFs fail.

### 2b. Android — add-source flow

- Entry points: **Add** in the Sources tab, the **Create new** button (new notebook), the **camera FAB**, and the **system share sheet** ("tap the share icon and select [NotebookLM] to add it as a new source" from any app — web pages, PDFs, YouTube) ([blog.google app launch](https://blog.google/innovation-and-ai/products/notebooklm-app/), [support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)).
- The mobile add-source sheet offers a **reduced type set**: **"PDF, Website, YouTube, Audio File, or Copied Text"** ([support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid); [support Android add-sources](https://support.google.com/notebooklm/answer/16215270?hl=en&co=GENIE.Platform%3DAndroid) — "Adding sources is limited to PDF, website, audio, YouTube, and copied text"). Google Drive import is **web-only**.
- Since ~Dec 2025 the app also has an **"Image"** button in the "Add a source" menu (photo library / screenshots) and the **camera** capture path ([9to5Google](https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/)). The support page's shorter list appears not to have caught up — minor doc/app discrepancy, noted as such.
- Mobile source *discovery*: no dedicated Discover button; Fast/Deep Research is available "where available" per support **[UNCERTAIN** how it surfaces in current builds**]** ([support Android](https://support.google.com/notebooklm/answer/16215270?hl=en&co=GENIE.Platform%3DAndroid)).
- Same 50-source / 200 MB / 500k-word limits as web ([support Android](https://support.google.com/notebooklm/answer/16215270?hl=en&co=GENIE.Platform%3DAndroid)).

---

## 3. Inside a notebook — web three-panel layout

Introduced in the December 2024 redesign ([blog.google Dec 2024](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-new-features-december-2024/)): three columns, left→right = **Sources / Chat / Studio**. Panels resize fluidly — e.g. "expanding the source viewer and notes editor side by side," or chatting while an Audio Overview plays.

### 3a. Sources panel (left)

- List of all sources with **per-source checkboxes**; unchecking scopes Chat *and* Studio generations: "the response is only based on the sources you care about right now" ([9to5Google](https://9to5google.com/guides/notebooklm/), [gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3) — "focus the AI on selected sources").
- **Add** button at top → §2a dialog.
- Clicking a source opens the **source viewer** (document text rendered in-panel) with a per-source "Source guide" summary; the panel can be collapsed to focus on chat/notes ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3)).
- In the source viewer you can select text → **"Add to note"** or **"Summarize to note"** ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3)).

### 3b. Chat panel (center)

- Shows an auto-generated **notebook summary** of all sources plus **suggested questions** ("automatically suggests followup questions … based on your recent conversation history and the content of your sources") ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3)).
- Conversational Q&A "with citations" ([blog.google Dec 2024](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-new-features-december-2024/)).
- **Citation chips:** inline numbered chips ("little numbers in grey ovals"). **Hover** → popover with the exact quoted passage; **click** → the source viewer opens/auto-scrolls to the cited passage, highlighted ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3) — "clicking a citation will scroll you directly to the most relevant section of your sources"; [geshan](https://geshan.com.np/blog/2025/11/how-to-use-notebooklm/); [pasqualepillitteri source-attribution writeup](https://pasqualepillitteri.it/en/news/4248/notebooklm-source-attribution-prompts-sources)).
- **Save to note** (pin icon on a response) copies the answer into Notes in Studio ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3)).
- 2026 additions: **"Configure Chat"** (response style/length) and **"Delete Chat History"** ([Jeff Su, 2026](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/)).

### 3c. Studio panel (right)

August 2025 redesign ([9to5Google Studio redesign](https://9to5google.com/2025/08/06/notebooklm-studio-redesign/)):

- **Top: a colorful 2×2 grid of tiles** — **Audio Overview**, **Video Overview**, **Mind Map**, **Reports** (Reports bundles Briefing doc, Study guide, FAQ, Timeline). Audio/Video tiles have **three-dot menus** to customize before generating.
- **Below the grid: a list of everything generated** in the notebook, including in-progress generations. **Multiple outputs of the same type** per notebook are allowed (e.g. Audio Overviews in several languages, per-chapter study guides).
- **"Add note" FAB** at the bottom of the panel; Notes live here.
- An Audio Overview can keep playing (mini **playback controls at the bottom of the Studio panel**) while you browse a Study Guide or Mind Map.
- By 2026 the tile set had grown to: Audio Overview, Video Overview, Mind Map, Reports, **Flashcards**, **Quiz** ([9to5Google Sept 2025](https://9to5google.com/2025/09/08/notebooklm-flashcards-quizzes/)), **Slide Decks**, **Infographics**, **Data Tables** ([Jeff Su 2026](https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/)); slide decks can be revised per-slide with feedback ([Workspace Updates Mar 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)).
- **Audio Overview interactive mode:** generate → "Interactive mode (BETA)" → play → tap **"Join"** to voice-ask the AI hosts questions ([blog.google Dec 2024](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-new-features-december-2024/)).

### 3d. Top bar (web)

- Notebook title (editable) + emoji (click to re-pick — [XDA](https://www.xda-developers.com/notebooklm-notebook-emoji-customization/)).
- **Share** button top-right → access levels incl. **"Anyone with a link"** public sharing (June 2025) ([9to5Google](https://9to5google.com/2025/06/03/notebooklm-public-links/), [blog.google public notebooks](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-public-notebooks/)).

---

## 4. Android app — inside a notebook

- **Bottom tab bar with three tabs: Sources | Chat | Studio** — "when you open a notebook, there's a bottom bar for the list of Sources, Chat Q&A, and Studio," mirroring the mobile-web arrangement ([9to5Google launch](https://9to5google.com/2025/05/19/notebooklm-app-launch/), [support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)). Tab-switch, not swipe, is the documented navigation. **[UNCERTAIN]** whether horizontal swipe also switches tabs — no source states it.
- **Sources tab:** source list + Add button (+ camera FAB). Same reduced type set as §2b.
- **Chat tab:** "a generated summary of all your sources" + question input; a **source selector inside the prompt box** lets you select/unselect sources per-question ([support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)).
- **Studio tab:** Audio Overviews joined over time by **Flashcards and Quiz** (Nov 2025 — [9to5Google](https://9to5google.com/2025/11/06/notebooklm-app-flashcards-quizzes/)), plus **Video Overviews, infographics, slide decks** ([support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)); redesigned to allow multiple Audio Overviews per notebook ([9to5Google guide](https://9to5google.com/guides/notebooklm/)). Video Overviews share via a **"Share"** control at top; infographics download as PNG.
- **Audio Overview player:** fullscreen player with an animated **waveform/"glow"**; controls: **play/pause, skip forward/back, playback-speed**; **background playback**; **Join (beta)** to interrupt and question the hosts; **Download** button for offline listening — downloads surface in the home screen's **Downloaded** section ([9to5Google launch](https://9to5google.com/2025/05/19/notebooklm-app-launch/), [blog.google app launch](https://blog.google/innovation-and-ai/products/notebooklm-app/), [support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)).
- **Offline:** downloaded Audio Overviews play without connectivity ([blog.google](https://blog.google/innovation-and-ai/products/notebooklm-app/)). **[UNCERTAIN]** whether whole notebooks (sources + chat) are available offline — sources only document *audio* downloads.

---

## 5. Notebook creation flow

### Web
1. Click **"Create new"** on the homepage.
2. The **Add sources dialog opens immediately** — a new notebook starts at the upload step, not an empty shell; the drag-and-drop upload zone is the dominant element ([nembal](https://www.nembal.com/blog/notebooklm_fixes), [geshan](https://geshan.com.np/blog/2025/11/how-to-use-notebooklm/)). **[UNCERTAIN]** the exact interstitial (some builds show the dialog over an "Untitled notebook" shell) — no primary source pins the intermediate state.
3. After the first source lands: NotebookLM generates the **notebook title** context, a **summary/notebook guide**, **suggested questions**, and an **auto-generated emoji** "based on the content of the documents and sources uploaded" ([gist](https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3), [XDA emoji article](https://www.xda-developers.com/notebooklm-notebook-emoji-customization/)). Title and emoji are user-overridable.

### Android
1. Tap the wide **"Create New"** pill at the bottom of the home screen.
2. "Once created, [you] can immediately begin adding source materials" — the app goes straight into the add-source sheet (PDF / Website / YouTube / Audio File / Copied Text, plus Image/camera) ([support mobile](https://support.google.com/gemininotebook/answer/16296687?hl=en&co=GENIE.Platform%3DAndroid)).
3. Alternative creation paths: **share sheet** from another app, and the **camera FAB** ([blog.google](https://blog.google/innovation-and-ai/products/notebooklm-app/), [9to5Google](https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/)).

---

## 6. Navigation flow map

```
WEB
Home (card list + Featured notebooks)
 ├─ click "Create new" ──────────────► Add sources dialog ──(first source ingested)──► Notebook view (3-panel)
 ├─ click notebook card ─────────────► Notebook view (3-panel)
 └─ click card emoji ────────────────► Emoji picker (in place)

Notebook view (Sources | Chat | Studio panels)
 ├─ Sources: Add ────────────────────► Add sources dialog (upload / Drive / link / paste / research)
 │            search box ────────────► Fast Research / Deep Research results ► check ► import
 ├─ Sources: click a source ─────────► Source viewer (in left panel) + Source guide
 │            select text ───────────► "Add to note" / "Summarize to note" ► Studio Notes
 ├─ Sources: checkbox toggle ────────► scopes Chat + Studio to checked sources (no navigation)
 ├─ Chat: suggested question / typed ► answer with numbered citation chips
 │        hover chip ────────────────► quoted-passage popover
 │        click chip ────────────────► Source viewer auto-scrolled to highlighted passage
 │        pin response ──────────────► saved to Notes (Studio)
 ├─ Studio: tile (Audio/Video/Mind Map/Reports/…) ► generation job ► appears in Studio output list
 │        Audio Overview ► play ► "Join" (interactive beta)
 │        "Add note" FAB ────────────► note editor
 └─ Top bar: Share ──────────────────► share dialog ("Anyone with a link" public option)

ANDROID
Home (chips: Recent | Shared | Title | Downloaded)
 ├─ tap card ────────────────────────► Notebook (bottom tabs: Sources | Chat | Studio)
 ├─ tap card play button ────────────► Audio Overview player (fullscreen, background-capable)
 ├─ tap "Create New" pill ───────────► Add-source sheet (PDF/Website/YouTube/Audio/Copied text/Image) ► Notebook
 ├─ tap camera FAB ──────────────────► native camera ► photo becomes a source
 └─ Downloaded chip ─────────────────► offline Audio Overviews

Notebook (bottom tabs)
 ├─ Sources tab: Add / camera ───────► add-source sheet
 ├─ Chat tab: summary + Q&A; source selector in prompt box scopes answers
 ├─ Studio tab: Audio Overview | Video Overview | Flashcards | Quiz | Infographic | Slides
 │        tap Audio Overview ────────► fullscreen player (play/pause, skip, speed, Join beta, Download)
 └─ (from any app) system share sheet ► "NotebookLM/Gemini Notebook" ► source added to a notebook

LIMITS (both surfaces): 50 sources/notebook (Free); per source 500k words or 200 MB, whichever first.
```

---

## 7. Source index

Primary (Google):
- https://blog.google/innovation-and-ai/products/notebooklm-app/ — mobile app launch
- https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-new-features-december-2024/ — three-panel redesign, interactive audio
- https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-discover-sources/ — Discover sources
- https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-featured-notebooks/ — featured notebooks
- https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-public-notebooks/ — public sharing
- https://support.google.com/notebooklm/answer/16215270 (web + `co=GENIE.Platform%3DAndroid` variants) — add/discover sources, types, limits
- https://support.google.com/gemininotebook/answer/16296687 — mobile app get-started (home chips, tabs, player, downloads)
- https://workspaceupdates.googleblog.com/2026/07/notebooklm-now-gemini-notebook.html — rename
- https://workspaceupdates.googleblog.com/2025/04/updates-to-sources-for-NotebookLM-and-NotebookLMPlus.html — source updates
- https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html — slide-deck revision

Hands-on / secondary:
- https://9to5google.com/2025/05/19/notebooklm-app-launch/ · https://9to5google.com/2025/05/01/notebooklm-android-iphone/ — app launch UI
- https://9to5google.com/2025/08/06/notebooklm-studio-redesign/ — Studio grid redesign
- https://9to5google.com/2025/09/08/notebooklm-flashcards-quizzes/ · https://9to5google.com/2025/11/06/notebooklm-app-flashcards-quizzes/ — Flashcards/Quiz
- https://9to5google.com/2025/12/04/notebooklm-camera-image-sources/ — camera FAB, image sources
- https://9to5google.com/2025/06/03/notebooklm-public-links/ — Share button / public links
- https://www.xda-developers.com/notebooklm-notebook-emoji-customization/ — auto emoji + picker
- https://gist.github.com/dazzaji/5abdc3e7befabdee508ed0b298bfe3d3 — mirrored official docs (citations, notes, suggested questions)
- https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/ — 2026 panel/Studio state
- https://geshan.com.np/blog/2025/11/how-to-use-notebooklm/ · https://www.nembal.com/blog/notebooklm_fixes — web flow observations
