---
fetched_date: 2026-04-19
summary: >
  Mobile chat UX pattern library for five leading LLM products (Grok, Gemini,
  ChatGPT, Claude, Perplexity) as of April 2026. Produced as a gap analysis
  against MIRA's Open WebUI deployment at app.factorylm.com. Weighted toward
  plant-floor technician constraints: gloves, sunlight, one-handed use,
  intermittent connectivity.
sources:
  - https://grokipedia.com/page/grok-mobile-app
  - https://www.blutrumpet.com/post/grok-voice-mode-update-march-2026
  - https://apps.apple.com/app/grok/id6670324846
  - https://9to5google.com/2026/04/07/gemini-live-redesign-android/
  - https://9to5google.com/2026/03/19/gemini-voice-input-redesign/
  - https://www.findarticles.com/google-tests-cleaner-gemini-ui-on-android/
  - https://www.emergingtechdaily.com/post/chatgpt-real-time-voice-mode-2026-how-to-use-now
  - https://www.findarticles.com/chatgpt-voice-mode-comes-home-to-chats-right-inside-threads/
  - https://apps.apple.com/au/app/claude-by-anthropic/id6473753684
  - https://pborenstein.dev/posts/claude-product-ecosystem-complete-technical-analysis
  - https://aionx.co/claude-ai-reviews/claude-pro-mobile-app-features/
  - https://perplexityaimagazine.com/perplexity-hub/how-to-use-perplexity-ai-on-iphone/
  - https://github.com/open-webui/open-webui/issues/20722
  - https://github.com/open-webui/open-webui/discussions/18970
  - https://toolchase.com/compare/chatgpt-vs-open-webui/
---

## Pattern library overview

In 2026, modern LLM mobile chat UX has converged on a small set of non-negotiable foundations: a permanently docked bottom composer that survives keyboard raises, a swipe-accessible left-drawer for conversation history, streaming token output with a blinking cursor, per-message action bars (copy / regenerate / thumbs), and a model picker that lives in or immediately adjacent to the composer rather than buried in settings. Beyond these table stakes, the products diverge sharply. Voice has matured from a novelty to a first-class input with waveform feedback and sub-2-second latency. Source attribution is now inline with numbered superscripts rather than footnote dumps. "Deep work" surfaces — split-pane artifact views, canvas editors, deep research sub-UIs — have moved from desktop-only to responsive mobile layouts. The products that feel most polished in 2026 share one design philosophy: every affordance has a one-tap path, and every state transition is animated so the user always knows where they are. For industrial use cases on a plant floor, the most important deltas are large touch targets, high-contrast rendering, offline-tolerant message queuing, and voice that works without looking at the screen.

---

## Product-by-product breakdown

### 1. Grok (xAI)

**A. First-run experience.** Clean splash with the xAI "X" wordmark on black. No onboarding tour. The home screen opens directly to a composer with three to four suggested prompt chips ("Analyze a photo", "Search X", "Write code"). No account required to start; optional sign-in with X, Apple, or Google. Rated 4.9/5 on 1.1M iOS App Store reviews as of April 2026.

**B. Input affordances.** Composer fixed at the bottom. Microphone icon lives inside the input field for dictation; a separate "Speak" button activates full Voice Mode. A `+` attachment button opens a sheet with camera, photo library, and file options. Model picker (Grok 4, Grok 4 Reasoning, etc.) sits at the top of the conversation as a dropdown. Input field auto-expands to roughly four lines before scrolling internally.

**C. Message rendering.** User messages right-aligned in a dark pill bubble. Assistant messages left-aligned, full-width, with markdown (bold, lists, code fences with syntax highlighting). Streaming is token-by-token with a blinking cursor. Web search citations appear as numbered inline superscripts that expand to source cards on tap. Per-message actions: copy, share, regenerate, thumbs up/down, and a "Post to X" shortcut — Grok's unique differentiator.

**D. Navigation.** Left drawer for conversation history; swipe-right gesture from the left edge opens it. New chat button is a pencil icon in the top-right. Settings accessible via profile avatar top-left. No thread branching in mobile UI.

**E. Power-user affordances.** "Think" mode toggle in the composer toolbar activates Grok's extended reasoning (visible in the model picker). Web search toggle in composer. Image/video generation ("Imagine") is a tab. No canvas equivalent. Voice-only mode with multimodal responses (audio + text + images simultaneously) added March 2026.

**F. Visual design language.** Near-black background (#0A0A0A) with white text. Minimal corner radius on assistant bubbles (4 px). Dense but readable at 15 px base. Smooth spring transitions on sheet openings. Dark mode is the default and only mode. Animated starfield or gradient on the thinking state.

**G. Signature details.** The "Post to X" action on every message is unique. Live Camera integration in Voice Mode — Grok can see what you see in real time. Home-screen and lock-screen widget for one-tap access. Control Center shortcut. xAI also ships a voice playground for developers.

---

### 2. Gemini (Google)

**A. First-run experience.** Opens to a clean composer with four rotating "Try asking" prompt chips below it. Signed-in users see a personalized greeting. No formal onboarding tour; tooltips appear contextually. The April 2026 Android redesign replaced a sparse chat-first home with a prompt-led layout.

**B. Input affordances.** Composer fixed at bottom. Microphone redesigned March 2026 to a "voice memo" style: tap mic, speak, waveform shows, tap Stop or Send. No live transcription preview during recording (deliberate UX choice; avoids premature commits). A `+` pill opens a bottom sheet carousel: Photos, Camera, Files, Drive, Notebooks. Then a second row of tool cards: Create image, Create video, Canvas, Deep research, Guided learning, Personal Intelligence toggle. Model picker reduced to an icon-only selector (less text, smaller footprint) in the April 2026 redesign.

**C. Message rendering.** User messages right-aligned in a tinted pill. Assistant messages full-width left. Markdown, code blocks, tables, math (MathJax). Streaming with incremental reveal and auto-scroll. Citations inline next to specific passages (not bottom-clustered) per February 2026 redesign. Per-message: thumbs up/down, copy, share, read aloud (moved to end-of-response in April 2026 redesign). No avatars; subtle "G" color flash during generation.

**D. Navigation.** Floating overlay mode (used when Gemini is layered over other apps) condensed to a small floating circle during navigation. Full-app left drawer for history. Temporary chats (non-saving) promoted to single-tap from the main screen. New chat button top-right.

**E. Power-user affordances.** Deep Research mode: a dedicated sub-UI that runs a multi-step, multi-source research workflow and returns a structured long-form report with a progress indicator. Canvas for document/code editing. Gemini Live: real-time conversational voice with screen-sharing, redesigned April 2026 to a floating waveform overlay rather than full-screen takeover. Guided learning mode. Personal Intelligence toggle (accesses your Gmail, Calendar, Drive context).

**F. Visual design language.** Google Material You — adaptive color from user's wallpaper. Large rounded corners (16–20 px). Generous white space. Light mode default, dark mode supported. Subtle ripple animations on taps. The April 2026 redesign adds a gap between response card and input field to reduce visual crowding on small screens.

**G. Signature details.** Deep Research sub-UI with visible progress steps is the most distinctive feature on mobile. Personal Intelligence (cross-app context from Google ecosystem) has no peer competitor. The floating Gemini Live orb that shrinks to a circle as you navigate other apps is a signature interaction.

---

### 3. ChatGPT (OpenAI)

**A. First-run experience.** White splash with OpenAI logo, then a clean home with a "Start a new chat" composer and four suggestion cards. A "Liquid Glass" redesign began rolling out on iOS in early 2026 — translucent blur panels, frosted chrome. Rollout has been inconsistent (some users see mixed old/new UI per March 2026 Reddit reports).

**B. Input affordances.** Composer pinned at bottom. Voice Mode is now in-chat: tap the waveform icon in the composer to start; live transcript appears as you speak. A separate "Advanced Voice" mode (Plus/Pro) with 1.5 s WebRTC latency and 9 voice options is also accessible from the composer. Attachment via a `+` button (camera, library, file). All tools (Browse, Code Interpreter, Image Gen, Memory) consolidated into a "Skills" slider button in the composer, replacing individual icons. Model picker (GPT-5.x, o-series reasoning models) lives at the top of the chat as a tap-to-switch label.

**C. Message rendering.** User messages right-aligned in a gray pill. Assistant messages left-aligned, full-width. Markdown, code blocks with syntax highlighting and copy button, tables, math. Streaming token-by-token. Voice Mode streams audio and text simultaneously with inline context cards (maps, images). Per-message: copy, regenerate, edit (opens inline text field), thumbs up/down, share. Small spinner during generation.

**D. Navigation.** Left sidebar drawer for conversation history; swipe-right to open. New chat is a pencil icon top-right. Settings via profile icon. No thread branching on mobile.

**E. Power-user affordances.** Canvas (formerly a web-only feature) available on mobile: opens a split view with chat on left and document/code editor on right. o-series reasoning models toggle extended thinking. Memory (persistent facts about the user) managed in Settings. Background Voice Mode continues when phone is locked. Screen/video sharing during voice for Plus/Pro.

**F. Visual design language.** Moving to "Liquid Glass" — translucent panels, gaussian blur backgrounds, frosted sheet modals. High rounded corners (20 px+). System font. Light and dark modes with true black dark. Rich spring animations on sheet transitions. The Liquid Glass rollout is iOS 26 influenced and still partially staged.

**G. Signature details.** In-chat voice that integrates with the text thread (no mode switch) is a key differentiator. Canvas split-pane on mobile. Memory across sessions. Background locked-screen voice. The waveform icon placement inside the chat thread is unique — voice does not feel like a separate product.

---

### 4. Claude (Anthropic)

**A. First-run experience.** Clean white or dark splash with the Anthropic wordmark. iOS 18+ required. No formal tour. Home screen shows recent conversations and a "New Chat" composer. Suggested prompts shown contextually on empty state. 4.7/5 App Store rating, 5.4K reviews (Australian store), 100K ratings (US store).

**B. Input affordances.** Composer pinned at bottom. Voice dictation via microphone icon in the composer — transcribes and inserts text (not a real-time conversational voice mode like Grok/ChatGPT). No "conversational voice" mode on mobile as of April 2026 (voice mode is exclusive to the iOS app but is dictation, not back-and-forth spoken dialog per multiple sources). Attachment via paper-clip icon: photos, files, screenshots. Model picker (Sonnet, Opus, Haiku) available in Settings or as a tap at the top of chat. No tool/skill toggle in composer on mobile.

**C. Message rendering.** User messages right-aligned in a tinted pill. Assistant messages full-width left. Best-in-class markdown rendering: bold, italic, code fences, tables, nested lists. Streaming with smooth incremental reveal. No inline citations (Claude does not do web search in the standard chat path; citations available only in Research mode). Per-message: copy, thumbs up/down, regenerate ("Retry"), edit (re-submit prompt). No avatars.

**D. Navigation.** Left drawer for conversation history. Swipe-right gesture supported. New chat via pencil icon. Projects (conversation + knowledge base bundles) available on web but NOT on mobile — mobile can read but not create Projects. Settings via profile icon.

**E. Power-user affordances.** Artifacts: on web, a split-pane view with chat left and rendered output (code, SVG, HTML app, document) right. On mobile, Artifacts render full-screen with a toggle back to chat — no side-by-side split. No Artifacts library view on mobile. Extended Thinking (Claude's reasoning mode, equivalent to Grok Think / o-series) available in API and web but surface on mobile varies. No web search in standard mobile chat. No canvas beyond Artifacts.

**F. Visual design language.** Warm off-white (#FAF9F7 equivalent) light mode, near-black dark mode. Humanistic sans serif (custom). Large rounded corners (16 px). Generous line height. Subtle fade-in transitions. Dark mode well-executed. Empty state: a subtle dot grid with the Anthropic logo. The warmest, most "reading-optimized" typography of the five.

**G. Signature details.** Artifacts split-pane on desktop is industry-leading for code/document work; the mobile degradation to full-screen toggle is the product's biggest mobile gap. Projects as persistent knowledge workspaces (web/desktop only). The "Yours, Claude" tone in app update notes is a signature brand moment. Best raw markdown and code rendering in class.

---

### 5. Perplexity (bonus reference)

**A. First-run experience.** Opens to a centered search bar with a mic icon. No suggested prompt chips on home — instead, a "Discover" tab shows trending research topics. Account optional. Minimal onboarding. The March 2026 Comet browser (separate app) extends the experience to full AI-native browsing on iOS.

**B. Input affordances.** Search bar centered at top of home, shifts to a bottom composer inside threads. Mic icon for voice (ASR + intent parse). Focus Mode selector (Web, Academic, YouTube, Reddit, Wolfram Alpha, etc.) attached to the composer — lets users restrict which source types are searched. Attachment via `+` (images, files). Pro Search toggle in composer for deeper multi-step retrieval.

**C. Message rendering.** No user/assistant bubble alignment — Perplexity uses a Q&A layout: question in a header, answer below in full-width text. Answer text uses numbered citation superscripts inline. Source cards appear as a horizontal scrollable carousel below the answer (not in a sidebar). Follow-up questions auto-suggested as tappable chips below each answer. Per-message: copy, share, regenerate. No avatars.

**D. Navigation.** Bottom tab bar: Home, Discover, Spaces, Library. Spaces = team or personal research collections (like Claude Projects but with cross-session retrieval). Library = all past threads. No left sidebar drawer — bottom nav is the primary navigation pattern, different from all four peers.

**E. Power-user affordances.** Deep Research mode: multi-step, multi-source report generation with a visible progress UI showing sources being gathered. Pro Search (lighter version). Focus modes for source filtering. Spaces for contextual memory across sessions. Comet browser for ambient, page-level AI assistance.

**F. Visual design language.** Perplexity uses a dark default on mobile with teal/cyan accents. Source cards use rounded large-image thumbnails with domain favicon + title. High information density but clean hierarchy. Source carousel is the most visually distinctive component in the space.

**G. Signature details.** The source card carousel below answers is unique — horizontal scroll through cited sources with thumbnail previews. The Focus mode selector in the composer (restricting search domains) has no equivalent in other products. The "answer engine" framing (Q&A layout vs chat layout) means the UX resembles a search result page more than a conversation, which reduces ambiguity about what was asked.

---

## Cross-product consensus patterns

These patterns appear in all five products. For MIRA, they are **table stakes** — absence creates immediate UX friction.

| Pattern | Notes |
|---|---|
| Composer fixed at screen bottom | Never hidden by scroll; always reachable |
| Auto-grow text input | Expands up to ~4 lines before internal scroll |
| Voice/mic button in or next to composer | One tap from text input to voice |
| Left drawer (or equivalent) for history | Swipe-right gesture supported in 4/5 |
| New chat button always visible | Top-right pencil or equivalent |
| Streaming token output | Token-by-token reveal, not full-response dump |
| Blinking cursor during generation | Visual signal that output is live |
| Per-message copy button | Mandatory; present in all five |
| Per-message regenerate / retry | All five provide this |
| Markdown rendering | Bold, italic, code fences, lists minimum |
| Code block with copy button | Syntax highlighting + one-tap copy |
| Dark mode | All five support; Grok defaults to it |
| Settings via profile/avatar icon | Consistent placement top-left or right |
| Thumbs up/down feedback | All five collect inline feedback |

---

## Differentiation patterns

These are intentional product choices — the areas where products diverge. For MIRA, these are opportunities.

| Pattern | Who does it | Who doesn't |
|---|---|---|
| Conversational back-and-forth voice (not just dictation) | Grok, ChatGPT, Gemini Live | Claude (dictation only), Perplexity |
| In-chat voice (no mode switch) | ChatGPT 2026 | Grok (separate Speak button), Gemini (overlay) |
| Voice + live camera ("see what I see") | Grok, ChatGPT (Pro), Gemini Live | Claude, Perplexity |
| Inline source citations with tap-to-open | Grok, Gemini, Perplexity | Claude (no web search by default), ChatGPT (search optional) |
| Source card carousel / tiles | Perplexity | All others use list or inline superscripts |
| Split-pane artifact / canvas on mobile | ChatGPT (Canvas), Claude (web only) | Grok, Gemini, Perplexity |
| Deep research sub-UI with progress indicator | Gemini, Perplexity | Grok (standard search), Claude, ChatGPT |
| Reasoning / extended thinking mode toggle in composer | Grok (Think), ChatGPT (o-series), Claude (Sonnet Thinking) | Gemini (implicit), Perplexity (n/a) |
| Focus mode (restrict source domain) | Perplexity | All others |
| Bottom tab bar navigation | Perplexity | All others use left drawer |
| Post to social action on message | Grok (Post to X) | All others |
| Persistent Projects / Spaces (cross-session context) | Claude (web), Perplexity (Spaces) | Grok, ChatGPT (Memory but not structured), Gemini (Personal Intelligence) |
| Home-screen / lock-screen widget | Grok | Claude, Gemini partial, ChatGPT partial |
| Temporary chat (no history saved) | Gemini, ChatGPT | Grok, Claude, Perplexity |
| Background locked-screen voice | ChatGPT | Others require screen on |

---

## MIRA UX gap list

Scored for a plant-floor technician: gloves, sunlight, one-handed use, intermittent connectivity. Sorted by impact.

| # | Gap | Category | Best-in-class reference |
|---|---|---|---|
| 1 | **Composer scrolls off screen** on long responses — not permanently docked at bottom | `table-stakes` | ChatGPT, Grok, Gemini all pin it |
| 2 | **Keyboard raise does not resize viewport** — composer is hidden behind keyboard on iOS PWA (confirmed GitHub #20722) | `table-stakes` | All native apps handle `100dvh` correctly |
| 3 | **No conversational voice mode** — technician needs to ask "why is VFD fault 7 showing?" without removing gloves | `table-stakes` | Grok voice, ChatGPT in-chat voice |
| 4 | **No per-message copy button** visible without extra taps | `table-stakes` | All five show it immediately |
| 5 | **Touch targets too small** for gloved hands — sidebar, model picker, message actions all < 44 px (GitHub discussion #18970) | `table-stakes` | All native apps use 44–48 px minimum |
| 6 | **No swipe-right gesture** for sidebar — requires two-handed tap on top-left corner | `table-stakes` | Grok, ChatGPT, Claude, Gemini all support swipe |
| 7 | **Streaming not smooth** on slow connections — Open WebUI chunks responses unpredictably | `table-stakes` | All five stream token-by-token with graceful degradation |
| 8 | **No suggested prompts / starter cards** on empty state — blank input is cognitively heavy for a tech who just walked up | `table-stakes` | All five show prompts; Perplexity's Discover tab is particularly good |
| 9 | **Model picker buried in settings** rather than in or adjacent to composer | `table-stakes` | Grok (top of chat), ChatGPT (top label), Gemini (icon in composer) |
| 10 | **No regenerate / retry button** per message without re-scrolling | `table-stakes` | All five |
| 11 | **No dark mode with high-contrast option** — unreadable in direct sunlight | `table-stakes` | Grok true-black, ChatGPT Liquid Glass dark, Gemini Material You dark |
| 12 | **No inline source citations** for equipment manual lookups — MIRA's RAG results have no visible provenance | `high-impact-differentiator` | Perplexity numbered superscripts + source cards; Gemini inline citations |
| 13 | **No voice dictation** in composer — technician must type fault codes with gloves | `high-impact-differentiator` | All five have mic in composer |
| 14 | **No "send on release" voice** — tap-hold-speak-release pattern used in industrial radio comms is natural; Gemini's "memo-style" voice is closest | `high-impact-differentiator` | Gemini March 2026 voice redesign |
| 15 | **No equipment context card** on responses — Perplexity's source tile pattern could show "VFD GS20, chapter 3" as a tappable card | `high-impact-differentiator` | Perplexity source carousel |
| 16 | **No reasoning / deep-think toggle** exposed to user — technician can't ask MIRA to "think harder" about a fault diagnosis | `high-impact-differentiator` | Grok Think, ChatGPT o-series, Claude Sonnet Thinking |
| 17 | **No offline queue** — if connectivity drops mid-repair, message is lost silently | `high-impact-differentiator` | No competitor does this either, but it is a table stake for industrial use |
| 18 | **No per-conversation context card** showing what equipment/manual context is loaded — tech doesn't know what MIRA "knows" | `high-impact-differentiator` | Claude Projects (web), Perplexity Spaces |
| 19 | **Font size not adjustable** within the UI — important for sunlight/distance reading (GitHub discussion #18970) | `nice-to-have` | No competitor exposes this in-chat either, but it is raised in industrial PWA feedback |
| 20 | **No haptic feedback** on send / response-complete — gloved users can't always see the screen | `nice-to-have` | Native apps (Grok iOS, ChatGPT iOS) use standard iOS haptics |
| 21 | **No waveform / activity animation** during generation — unclear whether MIRA is processing or stalled | `nice-to-have` | Grok animated starfield, ChatGPT spinner, Gemini gradient pulse |
| 22 | **No tappable follow-up question chips** below responses — Perplexity's "people also ask" chips reduce typing burden for gloved users | `nice-to-have` | Perplexity auto-suggested follow-ups |

---

*Compiled by Researcher agent from App Store listings, product documentation, 9to5Google coverage, GitHub issues, and third-party reviews. Fetched 2026-04-19.*
