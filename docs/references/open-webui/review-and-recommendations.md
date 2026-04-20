---
title: "MIRA Chat UX — Review & Recommendations"
date: 2026-04-19
audience: MIRA core team (Mike + engineering)
status: draft-for-discussion
related_refs:
  - mobile-and-theming.md
  - feature-catalog.md
  - competitive-ux-patterns.md
---

# MIRA Chat UX — Review & Recommendations

## Bottom line

MIRA's mobile chat experience sits on a near-stock Open WebUI (`v0.8.10`) with one CSS rule, a logo swap, and zero PWA config. That's why it feels un-elegant next to Grok / Gemini / ChatGPT / Claude: **OW is an admin tool with a chat UI bolted on, not a mobile product.** We can close ~60% of the gap on OW in one sprint (PWA, touch targets, composer dock, voice input, hybrid search, agents). Closing the last 40% — the polish that makes Grok *feel* inevitable on a plant floor — probably requires a MIRA-branded chat front-end in `mira-web` that talks to `mira-pipeline` directly, with OW relegated to admin / KB management.

## Why it feels un-elegant (honest diagnosis)

Three structural issues, in order of severity:

1. **The shell is wrong for mobile.** OW's mobile layout has documented viewport bugs (composer disappears behind the iOS keyboard — GitHub issue #20722), no permanent bottom-docked input on long threads, sub-44px touch targets, and no swipe gestures. None of this is MIRA's fault; it's inherited. The `100dvh` viewport fix is one CSS line but we haven't shipped it. (See `competitive-ux-patterns.md` for the 22-item gap list.)

2. **The chrome screams "admin panel," not "product."** Model picker, temperature slider, system-prompt controls, settings gears, API key UI — every one of those elements is visible to a technician who just wants to ask "why is my drive tripping?" Grok / Gemini / Claude hide all of this behind a single FAB or a long-press. OW's chrome is always on. Enterprise license or nginx `sub_filter` are the two known paths to hide it instance-wide.

3. **The defaults are under-configured.** Out of ~90 features in OW's feature matrix (`feature-catalog.md`), we're meaningfully using ~15. No hybrid search. No named agents. No suggested prompts. No welcome state. No channels. No per-model TTS voice. No filter functions for PII. No model preset that looks like "MIRA Diagnostic" vs "MIRA CMMS" vs "MIRA PM Planner." The raw capability is already installed and running — we just haven't turned it on.

A secondary issue: our SaaS compose drops the RAG config that local has. Production may be running OW's stock 256-token chunker against documents we chunked to 1000 tokens in NeonDB. Worth verifying.

## The fork in the road

| Path | Effort | Ceiling | Risk |
|---|---|---|---|
| **A. Push Open WebUI as far as it goes** | 1–2 sprints | ~75% of Grok-grade polish | Hits the enterprise-feature wall on branding and chrome hiding; we're one OW upgrade away from churn |
| **B. Custom MIRA chat front-end in `mira-web`** | 3–4 sprints | ~95% of Grok-grade polish | Owns the whole stack; requires maintaining streaming SSE, reconnect, message state, etc. |
| **C. Hybrid — B for end users, A for admins** | 4–6 sprints | Best of both | More surface area |

**Recommendation: commit to C, but ship A immediately.** We already have `mira-web` running PWA + custom CSS on the same infra (`mira-chat.css`, manifest, apple-mobile-web-app tags all configured). Adding a chat view that pipes SSE to `mira-pipeline:9099/v1/chat/completions` is ~1 sprint of work and gives us total control over the mobile shell. OW remains the KB admin and power-user panel. This is the architecture Perplexity and Grok use — thin owned chat UI, fat backend.

The reason to ship A first: we have paying beta users today. Grok-grade polish in 3 sprints is worthless if they churn in week 2 because the composer keeps disappearing behind the iOS keyboard. Get OW to "good enough" in 1 week, then start the mira-web chat build in parallel.

---

## Tier 1 — Stop the bleeding (1 week on Open WebUI)

Ship these before building anything new. All are env var or CSS changes, no custom code.

| # | Fix | How | Effort | Impact |
|---|---|---|---|---|
| 1 | iOS viewport keyboard bug | Append `WEBUI_CUSTOM_CSS` rule: `body, #app { height: 100dvh; min-height: 100dvh; }` — the existing red-outline hack already shows we have the injection path | 15 min | Huge — fixes the #1 dealbreaker |
| 2 | PWA manifest for MIRA | Host `manifest.webmanifest` on `app.factorylm.com/manifest.webmanifest` with MIRA name, orange `#f5a623` theme, 192/512 icons. Set `EXTERNAL_PWA_MANIFEST_URL` env var | 1 hr | Installable "MIRA" app icon on home screen (iOS; Android degrades but still improves) |
| 3 | Hide admin chrome from technicians | Set `DEFAULT_USER_ROLE=user` (not `pending`), set `ENABLE_SIGNUP=false`, provision techs via admin API. Optional: nginx `sub_filter` to remove model picker + settings icon from tech role | 2 hr | Clean first impression; removes 6 confusing UI elements |
| 4 | Hybrid search for RAG | `ENABLE_RAG_HYBRID_SEARCH=true` + configure BM25 reranker (Cohere or local). Closes the "why didn't MIRA find my fault code" gap | 2 hr | RAG quality lift — specific to MIRA's high-value use case |
| 5 | SaaS RAG parity with local | Copy `RAG_EMBEDDING_ENGINE=ollama` + `RAG_CHUNK_SIZE=1000` + `RAG_CHUNK_OVERLAP=100` into `docker-compose.saas.yml` | 10 min | Prevents silent retrieval quality regression in prod |
| 6 | Voice input in composer | `AUDIO_STT_ENGINE=openai` already set — verify the mic button shows up on prod mobile Safari + Chrome. Likely needs HTTPS (have it) + microphone permission prompt flow | 30 min | Gloves make typing brutal; voice is table stakes |
| 7 | Suggested prompts on empty state | Admin → Prompts → add 4 starter prompts: "drive is faulting," "motor won't start," "find manual for [model]," "create work order". Render via OW's built-in suggested-prompts feature | 20 min | Empty state goes from "what do I do" to "oh, it can do these" |
| 8 | Name agents for workflows | Create 3 OW "agents" (model presets): `MIRA Diagnostic`, `MIRA CMMS`, `MIRA PM`. Each points to `mira-pipeline` with a different system prompt hint | 1 hr | Technicians pick the task, not a model; matches Grok's "Think" / Gemini's Gems mental model |
| 9 | CSP + security headers | Nginx: `add_header Content-Security-Policy "default-src 'self' ..."`, `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`. Audit ran this morning; currently none are set | 1 hr | Table-stakes security; also blocks some OW footer-leak edge cases |
| 10 | Favicon persistence fix | Bake favicons into a custom Docker layer over `ghcr.io/open-webui/open-webui:v0.8.10` — current entrypoint `sed` approach loses icons on restart in some environments | 30 min | Eliminates a sporadic branding regression |

**Total: ~7 hours of engineering. Do this as one "UX hotfix" PR.**

## Tier 2 — Close the polish gap (2–3 sprints, still on OW)

After Tier 1, we're functional. Tier 2 is where it starts to feel like a product.

| Feature | Source | Why it matters for MIRA |
|---|---|---|
| Permanent bottom-docked composer on long threads | CSS override targeting OW's scroll container | Matches every modern LLM; stops the "where did the input go" hunt |
| 44×44px touch targets minimum | CSS audit of all buttons | Plant-floor users wear gloves; sub-44px is unusable |
| Swipe-right for conversation history | Custom JS or CSS `scroll-snap` on a side drawer | Gemini / ChatGPT pattern; eliminates the two-handed tap |
| Per-message actions (copy, share, regenerate, thumbs) | OW has these — verify they render on mobile | Feedback loop into `log_feedback` table |
| Streaming cursor + smooth auto-scroll | OW does SSE; check CSS animation + scroll-behavior | The "it's thinking" moment is 30% of perceived polish |
| Inline citations as cards | Pipeline already returns `{"citations": [...]}` (per mira-pipeline CLAUDE.md); OW needs `CITATIONS_ENABLED` or custom renderer | Closes the "was this hallucinated" trust gap |
| URL deep-links to agents (`?agent=diagnostic&q=drive+tripping`) | OW supports query param preload | QR code on equipment → opens MIRA pre-scoped to that asset |
| Channel webhooks for PLC alarms | OW Channels (beta) + webhook in | PLC fault → pushes a card into the tech's MIRA feed. This is the feature nobody else has. |
| Filter functions for PII scrubbing | OW Python filter — runs in-process | Compliance win; logs stay clean |
| Auto-login via trusted header | `WEBUI_AUTH_TRUSTED_EMAIL_HEADER` + nginx auth | Zero-friction entry from mira-web or a QR link |
| Dark mode default + forced | Enterprise setting OR JS override | Plant floors are dim; forced dark reduces glare |
| Per-agent TTS voice | `AUDIO_TTS_ENGINE=kokoro` or similar; assign per-model | Voice mode becomes useful; distinct persona per workflow |

## Tier 3 — The architectural bet (3–4 sprints, `mira-web` chat)

This is the path to Grok-grade polish. Build a `/chat` route in `mira-web` (Hono/Bun, already PWA-configured). Talks to `mira-pipeline:9099/v1/chat/completions` via SSE, stores conversation state in the same SQLite/Postgres mira-bridge uses, reuses `PLG_JWT_SECRET` for auth.

What this unlocks that OW never will:

- **Single-page shell, zero admin chrome.** Just composer, message list, and one menu button.
- **Offline message queue.** Tech on bad LTE types a question, MIRA pipelines it when reconnected. Service worker already in `mira-web`.
- **Equipment context cards.** Scan a QR on a drive → chat view opens pre-loaded with asset state, recent faults, open work orders. Nothing else on the market does this.
- **Haptic feedback + push-to-talk.** Native browser APIs; only useful if you own the shell.
- **Full MIRA visual identity.** Orange/steel industrial palette, typography, motion language. No OW ceiling.
- **Unified with CMMS.** `/chat` and `/cmms` share layout, auth, state, and PWA install.
- **Shareable conversation links** (signed JWT), with per-conversation expiry. Technician shares a thread with their supervisor without an account.

Scope:
- Week 1: SSE wiring, message list, composer, optimistic updates, basic markdown
- Week 2: Attachments (camera for nameplates, PDF for manuals), voice input, streaming cursor
- Week 3: Conversation persistence, history drawer, PWA install prompt, offline queue
- Week 4: Equipment cards, deep-links, polish pass, perf

Cost of *not* doing this: we stay on OW forever, hit the branding ceiling, churn at the exact moment we try to charge $97/mo to a beta user who compares us to ChatGPT Enterprise.

## Decision points for you

Three concrete asks:

1. **Approve Tier 1 as a one-week UX hotfix PR.** I have all the commands and env var values ready. This is low-risk, reversible, and fixes the worst of the "un-elegance."

2. **Decide on Tier 2 vs. Tier 3 ordering.** My recommendation: do Tier 2 items 1–6 (the ones that are pure CSS / env vars on OW) in parallel with starting Tier 3 mira-web chat. Skip Tier 2 items 7–12 because Tier 3 will obsolete them.

3. **Commit to the mira-web chat bet or say no.** The worst outcome is half-committing — paying for both OW customization and a custom front-end indefinitely. If we're on OW for the long haul, we should license enterprise and stop fighting it. If we're going custom, we should do Tier 1 only on OW and redirect engineering into `mira-web/chat`.

---

## Reference docs saved this session

- `docs/references/open-webui/mobile-and-theming.md` — every mobile / PWA / theming env var with citations
- `docs/references/open-webui/feature-catalog.md` — all ~90 OW features; flags the 8 we under-use
- `docs/references/open-webui/competitive-ux-patterns.md` — Grok / Gemini / ChatGPT / Claude / Perplexity 2026 patterns + 22-item MIRA gap list

Next session opens these three plus this review and has everything needed to either execute Tier 1 or kick off the Tier 3 design.

## Caveats on the research

- Two of the agents reported slightly different OW versions (0.8.6 and 0.6.x) — our actual deployed version is `v0.8.10` per grep of every compose file. Where the reference docs cite version-specific behavior, verify against `v0.8.10` before taking action.
- Some "known issues" in the mobile doc may already be patched in `v0.8.10`. Run each Tier 1 item through a quick mobile QA before declaring the fix live on prod.
- The competitive UX patterns were gathered from App Store descriptions, review sites, and GitHub issues; exact interaction details on competitor apps should be spot-checked by installing them on a test phone.
