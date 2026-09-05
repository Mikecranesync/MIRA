# ADR-0038: Streaming/Turn-Event Protocol for the Conversation Surface

**Status:** Proposed
**Date:** 2026-08-30
**Resolves:** PRD §12.3; Open Decisions 1 and 2 (§22)
**Depends on:** Current-state inventory (Phase 0 deliverable 2)
**Evidence:** Compatibility spike sessions 1–2 — source of the revised Context item 1 and of conformance rules 6 and 7. The write-ups (`docs/plans/2026-08-30-chatgpt-class-ui-spike-results.md` and `…-session2.md`) live on branch `spike/chat-ui-compat` / **PR #3515**, not on this branch; both PRs are HELD, and whichever merges second inherits the cross-reference.

## Context

MIRA has exactly one typed, persisted, stop-capable wire contract: the notebook chat SSE frame dialect (`mira-hub/src/lib/notebook-chat-types.ts`), consumed by both mobile (`createChatSseParser`) and web (`postNotebookChat`), with wire order and stopped-turn semantics pinned by `chat-stop-persist.test.ts`. Two other server dialects (asset/node untyped clones) and one non-streaming route (quickstart) orbit it. assistant-ui offers three integration tiers: `LocalRuntime`+`ChatModelAdapter`, `ExternalStoreRuntime`, and `useDataStreamRuntime` (Vercel data-stream / ui-message-stream protocol — a documented open SSE format any server can emit without adopting the AI SDK).

Hard facts the decision must respect:

1. **Capacitor buffered transport — and its actual cause.** On device the chat POST arrives as one buffered chunk and abort never reaches the server (#3453). The compatibility spike isolated *why*, and the previously recorded cause was too broad: this is **not** an Android WebView limitation. Holding device, WebView, page, server and client code fixed and varying **only the request origin**, a same-origin request delivered 9 incremental chunks and its `AbortSignal` reached the server (`cancelled:true`, `framesSent:4/9`), while a cross-origin request delivered 1 buffered chunk and the abort never arrived. The WebView's own `fetch` streams and cancels correctly; the **CapacitorHttp fetch patch** buffers responses it treats as remote and drops `AbortSignal`. Production is cross-origin (local bundle origin → `https://app.factorylm.com`), which is why it buffers there. *This still leaves the protocol choice irrelevant to today's device behaviour* — a wire format cannot unbuffer a transport that delivers everything at once — but it changes what the fix is and what it buys. **Open decision 2 answer (revised): a native transport bridge is _not_ required. The Hub CORS + WebView-cookie work already scoped in #3453 is the correct and sufficient fix, and it should deliver genuine token streaming AND a server-reaching Stop on device, not merely a nicer buffered path — a stronger claim than #3453 currently makes. It remains an APK-release/ADR-gated change outside this ADR's scope (Decision item 5); until it lands, device UX must be honest-buffered.** *Caveat to carry wherever this is cited:* the isolating runs were `http`→`http` against a dev server in a side-by-side debug shell, not `https`→`https` against production. They isolate the variable cleanly; they are not a production-path measurement, and a prod-shaped confirmation is still owed.
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

### Normative conformance rules (from the compatibility spike)

Items 1–5 above evolve the wire. These two rules govern how the wire is *read* and *committed*.
They are normative for every client and for the route itself, and each was found by a controlled
experiment rather than by inspection — see §4 and §5 of the session-2 spike write-up (`docs/plans/2026-08-30-chatgpt-class-ui-spike-results-session2.md`, on
`spike/chat-ui-compat` / PR #3515). The rules stand on their own here; the write-up is
the evidence, not a dependency.

6. **`status` is the only terminal marker a client may trust. `[DONE]` is not one.**
   A stream that ends without a `status` frame is **truncated**, and a client MUST render it as a
   stopped/partial turn — partial text kept, citations, basis, usage and follow-ups all dropped. It
   MUST NOT be rendered as a completed or cited answer.
   - *Why this needs stating.* `[DONE]` is a transport sentinel, not a state: it carries no status
     value, and it is the frame most likely to be lost to a truncation. Worse, an aborted `fetch`
     does **not** reliably reject `reader.read()` — in the Android WebView the body stream is simply
     closed, so the read loop exits with `done:true` exactly as a healthy stream does. A client that
     defaults its folded state to `answered` therefore cannot distinguish "finished" from "cut off",
     and will emit a **fabricated completion**: the spike reproduced a truncated stream rendering
     with 2 citation chips and a basis badge and no stopped caption, at 4 of 5 stop positions.
   - *Conformance requirement.* A frame-folding client MUST track "did a `status` frame actually
     arrive" as explicit state and MUST NOT infer terminal state from stream closure, from `[DONE]`,
     or from the arrival of any other frame. This is the client-side half of §7.6's "the server is
     authoritative" and is what PRD §10.9 forbids fabricating.
   - *Scope.* This binds every client that folds these frames — the mobile `createChatSseParser`,
     the web `postNotebookChat` path, and the assistant-ui adapter (ADR-0039) alike. It is a rule
     about the protocol, not about one client, which is why it lives here.
   - *Conformance status of the existing clients (audited 2026-09-01, this ADR's own review;
     both violations have since been fixed — see the disposition at the end of this bullet).*
     Both non-adapter clients violated rule 6 at the time of the audit, by different mechanisms:
     - **Web hub — violated it outright.** `readNotebookStream`
       (`mira-hub/src/components/equipment/notebook-chat-utils.ts`) seeded its fold with
       `status: "answered"` and broke the read loop on `done`. A stream ending without a `status`
       frame therefore returned `{status:"answered", citations:[…]}` — the same fabricated cited
       completion the spike found in the adapter, in the shipped hub. It also never re-asserted the
       abort inside the read loop, so it had no defence against a close-as-`done` cancellation.
     - **Mobile — narrower, but also violated it.** `createChatSseParser`
       (`mira-mobile/src/lib/sse.ts`) seeds `status` as the empty string, so it does not *invent*
       `answered`; and `requestStream` (`mira-mobile/src/api/client.ts`) already re-asserts the abort
       after every `reader.read()` — with a comment naming the buffered-Response cause — so a
       **client-side abort** is folded correctly *where one can occur*. On device it cannot: the
       composer gates the Stop control on `canCancelChatTransport()`
       (`!Capacitor.isNativePlatform()`), so a native build renders a disabled "Working…" and the
       technician has no way to initiate a Stop at all. That gating is deliberate — the CapacitorHttp
       fetch patch drops `AbortSignal` (revised Context item 1), so a Stop offered there would
       fabricate a stopped turn while the server kept generating and kept billing. Read this bullet
       as being about the abort *path*, not about a control a technician can reach on the phone
       today. The gap is that `NotebookScreen` derived
       the stopped render from the client's own `ctl.signal.aborted` flag rather than from the absence
       of `status`. A truncation the client did not cause (server-side close, dropped connection,
       proxy cut) resolves the promise normally with `status === ""`, and the turn renders through the
       ordinary `AnswerMarkdown` branch **with its citation chips and no "Stopped" caption**.
     Both are fixed: web in PR #3539, mobile in PR #3540 (neither is a wire change). The mobile
     fix also collapses the rule into ONE shared predicate, `isTruncatedTurn` in `lib/sse.ts`, so
     the two mobile surfaces cannot drift apart on it again — which is how the classic screen came
     to ship without the check the adapter already had.
     **Sequencing note:** the mobile case is rare on production today only because the buffered
     cross-origin transport delivers the body in one chunk. Landing the #3453 fix (revised Context
     item 1) makes real streaming — and therefore real mid-stream truncation — the normal case, so
     rule 6 should be satisfied in both clients **before or with** that work, not after it. That
     sequencing condition is now **met**: both client fixes (#3539, #3540) landed on `main` ahead of
     the #3453 work, so real streaming can arrive without opening a truncation window.

7. **The server's terminal classification commits before `status` reaches the wire; a later client
   disconnect MUST NOT reclassify it.**
   The client can hold a terminal state the server's connection bookkeeping disagrees with: the
   spike observed the server still classifying a connection as cancelled while the client had
   correctly received `status` and rendered a complete cited answer (only `followups` and `[DONE]`
   were lost). Rendering the answer is correct there — the client fabricated nothing. But without a
   stated rule, the same window on the real notebook route is *the answer changing on reload*.
   - *The rule.* The single client-abort check that separates the stopped-turn path from the
     answered path (`route.ts`, immediately after the provider cascade, where `onClientGone` is
     detached) is the **commit point**. A disconnect observed **before** it persists the stopped-turn
     contract (`answer_status='error'` + partial text, no citations, no basis). A disconnect
     **after** it — including one during the `evidence`/`usage`/`status`/`followups` tail — persists
     the turn the server actually computed, unchanged. Because the commit point precedes the `status`
     enqueue, **`status` on the wire implies the server has already committed to that state**, so a
     client holding `status` and a server logging a cancelled connection are not in conflict: the
     persisted row matches what the client rendered.
   - *Status: this codifies existing behaviour, it does not change it.* The route already commits
     this way. The rule exists so a future refactor cannot quietly add an abort check between the
     commit point and `recordTurn` and turn a delivered, cited answer into a stopped turn on reload.
   - *Test gap — CLOSED (PR #3541).* `chat-stop-persist.test.ts` now pins the post-commit
     disconnect. Note what that took: a purely behavioural test **cannot** guard this rule, because
     the tail is synchronous — the write is already in flight before any disconnect a black-box
     test can trigger lands. Three reintroductions of the bug were applied to `route.ts` and all
     three left every behavioural assertion green. The guard is therefore on the SHAPE of the tail
     (no re-read of the abort signal, no reclassification inside the write call, no `await` before
     the write), with the behavioural tests pinning the outcome and one before-the-commit-point
     contrast so they cannot pass vacuously. **If the tail ever grows an `await`, rule 7 stops
     being structurally true and needs a real mechanism — reopen this ADR rather than deleting
     the test.**

## Consequences

- The adapter (see companion ADR) owns frame→part translation; `createChatSseParser` semantics are reused, not re-implemented, and the five parsers collapse toward one per app.
- Turn-ID work is the only schema-touching item; until it lands, the adapter synthesizes message identity (persisted row id / client-generated live id) and cannot do true optimistic reconciliation — acceptable for the spike, listed as a Phase 1 prerequisite.
- Revisit trigger: if the #3453 CORS/cookie work lands real device streaming AND assistant-ui deprecates custom runtimes (no sign of the latter), re-evaluate Option B. Record that in the flag-removal review. Note the first half is now *expected* rather than speculative — per the revised Context item 1 the fix is scoped and does not need a native bridge — so this trigger is gated on the assistant-ui half.
- PRD §12.3's "no control state from scraping Markdown" remains violated by `[n]` citation linking regardless of protocol; the mitigation (structured `sources` gate + `selector` span-anchoring later) is tracked in the adapter ADR, not here.
- Rule 6 makes truncation a **first-class client state**, not an edge case: every folding client carries a "saw `status`" flag, and the terminal render is guarded by it. The spike's adapter fix took this shape (6 unit tests pin the truncation contract; the post-fix stop sweep showed 0 violations at every stop position). The audit recorded under rule 6 found the **shipped web hub reader had the same defect** and the mobile client a narrower form of it — so this rule had two live call sites to fix, not just a spike lesson to remember. Both have since been fixed (#3539 web, #3540 mobile) and both were client-side changes; neither touched the wire.
- Rule 7 costs nothing to honour today (it describes what the route already does) but constrains future edits: the commit point is load-bearing, and the abort check that defines it must not be duplicated later in the terminal block. That test is no longer owed — it landed in #3541, and it is the enforcement mechanism.
- Neither rule is a wire change, so neither affects OTA-deployed clients in the field: old bundles keep parsing the same frames. Rule 6 is the one place where an old bundle is *behaviourally* wrong (it can still fabricate a completion on truncation) — fixing that in mobile is an OTA-shippable client change, tracked as a Phase 1 prerequisite, not a protocol migration.
