# ADR-0038: Streaming/Turn-Event Protocol for the Conversation Surface

**Status:** Proposed
**Date:** 2026-08-30
**Resolves:** PRD §12.3; Open Decisions 1 and 2 (§22)
**Depends on:** Current-state inventory (Phase 0 deliverable 2)

## Context

MIRA has exactly one typed, persisted, stop-capable wire contract: the notebook chat SSE frame dialect (`mira-hub/src/lib/notebook-chat-types.ts`), consumed by both mobile (`createChatSseParser`) and web (`postNotebookChat`), with wire order and stopped-turn semantics pinned by `chat-stop-persist.test.ts`. Two other server dialects (asset/node untyped clones) and one non-streaming route (quickstart) orbit it. assistant-ui offers three integration tiers: `LocalRuntime`+`ChatModelAdapter`, `ExternalStoreRuntime`, and `useDataStreamRuntime` (Vercel data-stream / ui-message-stream protocol — a documented open SSE format any server can emit without adopting the AI SDK).

Hard facts the decision must respect:

1. **Capacitor buffered transport.** On device, the chat POST arrives as one buffered chunk and abort never reaches the server (#3453; verified `client.ts` honesty note). *No protocol choice changes this* — the wire format is irrelevant to a transport that delivers everything at once. Genuine incremental streaming/cancel on device is gated on Hub CORS + WebView-cookie work that requires a separate Mike-approved ADR (recovery PRD §10.2). **Open decision 2 answer: the current Capacitor transport cannot provide genuine incremental streaming or server-reaching cancel; a native transport bridge (or the #3453 CORS/cookie path) is required, and either is an APK-release/ADR-gated change outside this ADR's scope. Until then, device UX must be honest-buffered.**
2. **Persisted semantics are encoded in the current contract.** The STOPPED-TURN contract (error + partial text vs error + null text), late-arriving `sources`, the safety frame-not-status workaround for the 3-value CHECK, and the additive unknown-frame convention are all load-bearing, tested behavior.
3. **Governance:** the recovery PRD forbids a second chat route/conversation store; the copilot PRD lists the typed SSE contract as "preserve byte-for-byte"; provider-side the canonical seam (`MIRA_CANONICAL_SEAM`) already forks this route's internals — adding a protocol fork multiplies the test matrix.
4. **Five client parsers exist for two dialects** — the real duplication problem is client-side parsing and the untyped clone dialect, not the notebook frame format itself.

## Option A — Keep MIRA's wire format; custom assistant-ui transport (client-side mapping)

Keep `data:<json>` frames on the existing route. Write one MIRA "frame→parts" translator that wraps the existing `createChatSseParser` semantics and feeds an assistant-ui runtime (`LocalRuntime`'s `ChatModelAdapter.run({messages, abortSignal})` yields chunks; or `ExternalStoreRuntime` with MIRA-owned state). Extend the contract only additively (new frame kinds unknown clients ignore).

- **Pro:** zero server change to the one persisted route mid-recovery-window; byte-for-byte preservation satisfied; both granularities (incremental web, single-chunk device) already handled by the parser; the CHECK-constraint workaround pattern (frames over status values) continues to work; asset/node clone dialects can be migrated onto the typed dialect as ordinary server cleanup, independent of the UI program.
- **Pro:** the adapter is where §12.2 says translation lives anyway; assistant-ui explicitly supports this tier as first-class (dependency assessment §3).
- **Con:** MIRA keeps owning a wire format; interop tooling built for the Vercel protocol (observability, replay viewers) doesn't apply directly.
- **Con:** turn/thread IDs and lifecycle states still don't exist on the wire — Option A must add them additively (see recommendation) rather than getting them "free" from the ui-message-stream shape.

## Option B — Adopt the Vercel AI SDK data-stream protocol server-side

Re-emit the notebook route's output as ui-message-stream parts (`x-vercel-ai-ui-message-stream: v1`), consume with `useDataStreamRuntime`. No Vercel hosting or AI SDK adoption required (the format is open).

- **Pro:** standard part vocabulary (text/tool/source/data parts) maps well to PRD §9.2; free client via `@assistant-ui/react-data-stream`; ecosystem tooling.
- **Con:** it is a **second wire contract on the one chat route** — either a versioned fork (double test matrix across seam-flag × protocol-flag × two client generations during OTA rollout) or a flag-day break of the shipped mobile parser (impossible: old OTA bundles in the field must keep working; unknown-frame tolerance protects additive changes, not format swaps).
- **Con:** MIRA's persisted semantics don't round-trip: stopped-vs-failed (null-text heuristic), late `sources` filtered to used `[n]`, `machine_evidence`/`observation`/`safety`/`followups`/`usage` all become custom `data-*` parts anyway — so the "standard" buys the `text` part and little else; the MIRA-specific majority still needs bespoke mapping, now constrained by someone else's envelope.
- **Con:** gains nothing on device (buffered transport) — the single place a better protocol could matter is exactly where the transport nullifies it.
- **Con:** collides with recovery-PRD "no second chat route" and the copilot-PRD preservation clause; needs Mike to overturn two standing decisions.

## Option C — Hybrid: versioned envelope

Keep the route; add `?protocol=v2` (or an `Accept` variant) emitting a superset envelope with turn IDs/lifecycle; old clients get v1.

- **Pro:** explicit versioning; no flag-day.
- **Con:** this is Option A wearing a costume plus a permanent server fork. The additive-frame convention **is already the versioning mechanism** — a parallel envelope adds a second one. Rejected as ceremony without benefit.

## Decision (recommendation)

**Option A.** Keep the MIRA typed SSE frame dialect as the single wire contract, with a custom assistant-ui transport/adapter, and evolve it **additively**:

1. **New `turn` frame** (emitted first): `{kind:"turn", turnId, threadId, userTurnId}` — server-assigned IDs from `equipment_notebook_turns` (requires the route to INSERT the accepted user turn before streaming, which also fixes the PRD §10.8 gap; migration under `mira-hub-migrations.md` discipline, Mike-gated). Old clients ignore it (FRAME_KINDS convention).
2. **New `lifecycle` frame** for `queued/running/stopping` progress, ephemeral (not persisted); terminal state stays `status` + persisted row.
3. **Safety persistence:** persist the `safety` trigger inside `evidence[]` JSONB as a `{kind:"safety_notice"}` entry (no CHECK-constraint change needed — same pattern as machine_evidence), so reload can render §9.2's `safety_notice`. Fixes the identified fabrication-adjacent gap where a safety stop reloads as an ordinary answer.
4. **Dialect consolidation (server cleanup, separate lane):** migrate `/api/assets/[id]/chat` and `/api/namespace/node/[id]/chat` to emit the typed dialect (and retire the `X-Safety-Stop` header, the inline Groq→Cerebras→**Gemini** cascade — a standing Hard-Constraint-#2 violation — via the canonical seam). Their clients are hub-only and deploy atomically with the server, so this is low-risk relative to mobile.
5. **Explicitly out of scope:** any change to device streaming granularity or cross-boundary cookies (#3453/#3454 — separate Mike-approved ADR); mira-pipeline; quickstart (stays plain JSON).

## Consequences

- The adapter (see companion ADR) owns frame→part translation; `createChatSseParser` semantics are reused, not re-implemented, and the five parsers collapse toward one per app.
- Turn-ID work is the only schema-touching item; until it lands, the adapter synthesizes message identity (persisted row id / client-generated live id) and cannot do true optimistic reconciliation — acceptable for the spike, listed as a Phase 1 prerequisite.
- Revisit trigger: if a future native transport bridge lands real device streaming AND assistant-ui deprecates custom runtimes (no sign of either), re-evaluate Option B. Record that in the flag-removal review.
- PRD §12.3's "no control state from scraping Markdown" remains violated by `[n]` citation linking regardless of protocol; the mitigation (structured `sources` gate + `selector` span-anchoring later) is tracked in the adapter ADR, not here.
