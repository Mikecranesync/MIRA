# ChatGPT-Class UI — Compatibility Spike Results (Session 1)

**PRD:** `docs/prd/2026-08-30-chatgpt-class-ui-prd.md` §8.3 · **Plan:** `2026-08-30-chatgpt-class-ui-spike-plan.md` · **ADRs:** 0038 (protocol), 0039 (adapter)
**Branch:** `spike/chat-ui-compat` · **Date:** 2026-08-30 · **Verdict so far: NO INCOMPATIBILITIES FOUND** — assistant-ui `ExternalStoreRuntime` + registered `data-*` part components accommodate every MIRA-specific shape tried, with zero forks of the library core.

## What was built

| Piece | File | Notes |
|---|---|---|
| Canonical part contract (PRD §9.2 subset) | `mira-hub/src/lib/chat-adapter/contract.ts` | text / source / machine_evidence / observation / safety_notice / basis / error / usage / followups / **unknown** |
| Frame→part translation (pure) | `mira-hub/src/lib/chat-adapter/frames-to-parts.ts` | REUSES `parseFrame` + `persistedTurns` — no second parser semantics |
| Library boundary | `mira-hub/src/lib/chat-adapter/convert.ts` | only module speaking assistant-ui types inbound (ADR-0039 isolation) |
| ExternalStoreRuntime wiring | `mira-hub/src/lib/chat-adapter/runtime.tsx` | MIRA owns messages/isRunning/abort; injectable transport |
| Contract-shaped fixtures | `.../__fixtures__/transcripts.ts` | answered / abstain / safety / stopped-partial / provider-error / machine-evidence / unknown-frame |
| Unit tests (17, all green) | `.../__tests__/frames-to-parts.test.ts` | + full-thread snapshot pin |
| Dev-only spike page | `mira-hub/src/app/labs/chat-spike/` | `notFound()` in production; fixture transport, 400 ms cadence |

Deps added (pinned exact, MIT): `@assistant-ui/react@0.15.17`, `@assistant-ui/react-markdown@0.14.13`.

## §8.3 exit criteria — status

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Render a persisted MIRA thread | **PASS (fixture)** | `hydrateMessages(PERSISTED_ROWS)` renders answered+citations, stopped partial, abstain, machine-evidence turns; unit snapshot + browser proof (`docs/promo-screenshots/2026-08-30_chat-spike-assistant-ui-thread_*.png`) |
| 2 | Send message with image attachment | **NOT ATTEMPTED** | needs the two-step upload plumbing (`AttachmentAdapter`); next session |
| 3 | Stream text incrementally | **PASS (fixture transport)** | token-growth visible; late `sources` frame attaches citations to already-rendered text; basis label renders live; real-route SSE still owed (needs authed dev hub) |
| 4 | Structured source/tool events | **PASS for source/evidence; tool half N/A** | typed parts, never scraped from text; unknown frame kind → inspectable `data-unknown` part, no crash. Tool events don't exist server-side (inventory §8) — documented backend gap, not a library incompatibility |
| 5 | Stop via real abort path | **PASS (UI/STRM-2 half)** | Stop replaces Send while running; abort mid-stream keeps the partial, zero citations, "Stopped" caption; Send returns. Server-side `clientAbort` persistence proof owed (real route) |
| 6 | Restore authoritative turn after reload | **PASS (translation half)** | `comparableProjection(live) === comparableProjection(hydrated)` asserted for answered / stopped / machine-evidence pairs. Known asymmetry recorded: abstain hydration substitutes fallback copy for empty live content |
| 7 | Machine-evidence card without forking library | **PASS** | registered `data-machine-evidence` component; frozen freshness/reason strings from the `replay.ts` cross-lane contract rendered verbatim; `git diff` clean of any library source |

Console: **0 errors, 0 warnings** across the whole browser session.

## Deviations / notes for review

1. **`src/middleware.ts` matcher now excludes `labs/chat-spike`.** The dev shell has no Doppler auth secrets, and the middleware bounces everything cookie-less to `/login`. The page hard-404s in production (`NODE_ENV` gate) and its transport touches no API route. Remove with the spike. Flagged deliberately — reviewer should confirm comfort.
2. **Fixture transport, not the real route, for criteria 3/5.** Deterministic contract-shaped transcripts (PRD §17 sanctions recorded-fixture contract tests). The real-route pass (criteria 2/3/5 server halves) needs an authed dev/staging hub and is the next spike session.
3. **Pre-existing local test failures (NOT branch regressions), reproduced on clean `origin/main` in this Windows worktree:** `cmms-deploy-env.test.ts` (compose-file regex vs CRLF) and `sitemap-drift.test.ts` (SyntaxError importing `scripts/sitemap.mjs`). Linux CI is the truth; branch adds 17 passing tests, 2460 others unchanged.
4. **LocalRuntime was skipped** — ExternalStoreRuntime matched the server-truth-hydration model directly (ADR-0039 predicted this); no conflict encountered, so the spike-plan's "try LocalRuntime first" step was unnecessary.

## Remaining before the §8.3 gate can be declared

- Criterion 2 end-to-end (attachment plumbing against the real upload routes).
- Criteria 3/5 against `POST /api/equipment-notebooks/[id]/chat/` on an authed dev/staging hub, incl. persisted `answer_status='error'` + partial after Stop, re-GET reload.
- Device pass (buffered single-chunk render, cookie-jar transport, BACK ordering, keyboard, `ota-guard` diff check) per spike plan "cannot be proven on web".
- Write-up of LocalRuntime-vs-ExternalStore verdict → fold into ADR-0039 before it moves Proposed → Accepted.
