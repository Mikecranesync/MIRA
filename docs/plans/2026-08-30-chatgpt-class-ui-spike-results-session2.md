# ChatGPT-Class UI — Compatibility Spike Results (Session 2: real transport + device pass)

**PRD:** `docs/prd/2026-08-30-chatgpt-class-ui-prd.md` §8.3 · **Plan:** `2026-08-30-chatgpt-class-ui-spike-plan.md` · **Session 1:** `2026-08-30-chatgpt-class-ui-spike-results.md` · **ADRs:** 0038 (protocol), 0039 (adapter)
**Branch:** `spike/chat-ui-compat` · **Date:** 2026-08-30 · **Status: still HELD — ships nothing.**

Session 1 proved the adapter against a *fixture* transport (a `setInterval` replaying recorded
frames). This session replaces that with a **real HTTP stream** and runs it on **web, a physical
Pixel 9a, and the Android emulator**. Two findings came out of it that a fixture transport
structurally could not produce: one about the platform (§3) and one **defect in the adapter** (§4).

**Verdict: still no assistant-ui incompatibility.** Everything below is MIRA-side or
platform-side; the library needed no fork.

## 1. What was added

| Piece | File | Notes |
|---|---|---|
| Dev-only SSE probe route | `mira-hub/src/app/labs/chat-spike/stream/route.ts` | Emits the `ANSWERED_TRANSCRIPT` frames over a real `ReadableStream` at 250 ms cadence. `GET` returns **server-side truth** for the last run: `framesSent`, `totalFrames`, `cancelled`. 404s in production, no auth, no DB. |
| Live transport | `mira-hub/src/app/labs/chat-spike/ChatSpike.tsx` | `window.fetch` + `body.getReader()` + `AbortSignal` — the same primitives as `mira-mobile/src/api/client.ts::requestStream` (STRM-1). On-screen HTTP-chunk counter. |
| Cross-origin control | same | Toggle that swaps `localhost` ⇄ `127.0.0.1`, changing **only** the origin. This is what isolates the CapacitorHttp patch (§3). |
| Probe harnesses | `tools/chat-ui-spike/` | `web-proof` / `device-proof` / `stop-invariant` / `capture`, plus a README with the full local-only device recipe. Delete with the spike. |

## 2. Criteria status after this session

| # | Criterion | Web | Emulator | Pixel 9a | Evidence |
|---|---|---|---|---|---|
| 1 | Render a persisted MIRA thread | PASS | PASS | PASS | 3 citation chips, 1 machine-evidence card, 1 stopped partial, 1 abstain; recorded-history styling distinct from live |
| 2 | Send message with image attachment | **NOT ATTEMPTED** | — | — | still owed (`AttachmentAdapter` over the real two-step upload) |
| 3 | Stream text incrementally | PASS | PASS | PASS (same-origin) | 9 HTTP chunks; rendered text grows 0→107→140→158→191 chars |
| 4 | Structured source/tool events | PASS | PASS | PASS | typed parts; unknown frame → inspectable `data-unknown`, no crash. Tool events still N/A (no server-side tool events exist — backend gap, not a library gap) |
| 5 | Stop via real abort path | PASS | PASS | PASS (same-origin) | client stops at chunk 4 → **server** reports `framesSent:4, cancelled:true`. The abort genuinely reaches the server. |
| 6 | Restore authoritative turn after reload | PASS (translation half) | PASS | — | unchanged from session 1; real-route re-GET still owed |
| 7 | Machine-evidence card without forking | PASS | PASS | PASS | registered `data-machine-evidence` component; zero library patches |

Console errors/warnings across every run, all three surfaces: **0**.

## 3. Finding A — #3453 is the CapacitorHttp fetch patch, not "Android can't stream"

The standing description of #3453 (and the comment in `capacitor.config.ts`) says the SSE body
arrives on device as one buffered chunk. That is true, but the *attributed cause* was too broad.

Controlled experiment — same device, same WebView, same page, same server, same code; **only the
request origin varied**:

| Request origin vs page origin | HTTP chunks delivered to JS | Rendered text over time | Stop reaches server? |
|---|---|---|---|
| **Same-origin** (`localhost:3000` → `localhost:3000`) | **9** | grows progressively | **YES** (`cancelled:true`, `framesSent:4/9`) |
| **Cross-origin** (`localhost:3000` → `127.0.0.1:3000`) | **1** | nothing for ~2.4 s, then all 191 chars at once | **NO** (`cancelled:false`, `framesSent:9/9`) |

Reproduced on both the Pixel 9a and the emulator.

**Conclusion.** The Android WebView's own `fetch` streams incrementally and honors `AbortSignal`
perfectly well. The buffering and the dropped abort come from the **CapacitorHttp fetch patch**
intercepting requests it treats as remote. Production is cross-origin (local bundle origin →
`https://app.factorylm.com`), which is why it buffers there.

Consequences:
- The `capacitor.config.ts` comment and #3453 should be reworded from "on device the SSE body
  arrives in one chunk" to "**the CapacitorHttp fetch patch buffers cross-origin responses and
  drops `AbortSignal`**". The distinction matters because it identifies the fix.
- The CORS + WebView-cookie work already scoped in #3453 is therefore the *correct* fix, and it
  should deliver genuine token streaming **and** a working server-side Stop on device — not
  merely a nicer buffered path. That is a stronger claim than the issue currently makes.

**Caveat, state it wherever this is cited:** the runs above are `http`→`http` against a dev server
using a separate debug shell, not `https`→`https` against production. They isolate the variable
cleanly; they are not a production-path measurement. A prod-shaped confirmation is still owed.

## 4. Finding B — a real adapter defect: truncated streams rendered as complete answers

Found by sweeping *when* Stop lands across the stream (`tools/chat-ui-spike/stop-invariant.mjs`).

**Symptom.** Stopping after the `sources` frame produced a turn that kept **2 citation chips and
the basis badge** and showed **no stopped caption** — i.e. a cut-off stream presented as a
complete, cited answer. 4 of 5 sweep positions reproduced it.

**Root cause, two layers:**

1. `foldFrames` seeds `status: "answered"`. A stream that ends *without* a `status` frame was
   therefore indistinguishable from a completed one, so `liveAssistantMessage` emitted an
   answered turn carrying whatever `sources`/`evidence` frames had already arrived.
2. An aborted `fetch` does **not** reliably reject `reader.read()` — in the Android WebView the
   body stream is simply **closed**, so the read loop exits with `done:true` exactly as a healthy
   stream does. The transport resolved normally and the runtime took the success path instead of
   the abort path.

This is precisely what PRD §10.9 forbids ("no fabricated completion, citations, or cost") and what
§7.6 means by "the server is authoritative" — the client was inferring terminal state the server
never sent.

**Fix (this session, red-first):**
- `FrameFold` gains `sawStatus`; `liveAssistantMessage` returns the stopped shape when no `status`
  frame arrived, keeping the partial text and dropping citations / basis / usage / follow-ups.
- The transport re-asserts the abort after the read loop; the runtime guards the terminal render
  with the same check (defence in depth).
- 6 new unit tests in `frames-to-parts.test.ts` pin the truncation contract. **23/23 adapter tests
  pass; 341/341 across the adapter + equipment components + notebook API routes.**

Post-fix sweep: **0 violations** at every stop position.

**Generalized lesson for ADR-0038.** The wire has no terminal marker the client may trust other
than the `status` frame, and `[DONE]` is not modelled as one. Any client that folds frames must
track "did I actually see `status`" or it will manufacture completions on every truncation. This
belongs in the protocol ADR, because the mobile client folds the same frames.

## 5. Finding C — the tail race (client and server can disagree)

At the far end of the stream there is a window where the client has already received the
authoritative `status` frame but the server still classifies the connection as cancelled
(observed: `framesSent 7/9, cancelled:true` while the client correctly showed a completed, cited
answer — only `followups` and `[DONE]` were lost).

Rendering the answer is **correct** there; the client is not fabricating anything. But it means
client and server can hold different terminal states for the same turn, and on the real notebook
route that would surface as *the answer changing on reload*. This is exactly the reconciliation
requirement in PRD §9.3 / §10.8, and it needs an explicit rule in ADR-0038: **what the server
persists when the client disconnects after `status` but before `[DONE]`.**

## 6. Still owed before the §8.3 gate can be declared

- **Criterion 2** end-to-end (attachment plumbing over the real upload two-step) — untouched.
- **Criteria 3/5/6 against the real notebook chat route** on an authed dev/staging hub, including
  the persisted `answer_status='error'` + partial and the re-GET reload. The probe route proves
  the *transport*; it deliberately does not touch auth, the DB, or the real route.
- **Prod-shaped confirmation** of §3 (`https`, release shell, real API host).
- Phone re-test (deferred to 2026-08-31 at Mike's direction; the emulator carried the rest).
- LocalRuntime-vs-ExternalStore verdict → fold into ADR-0039 before it moves Proposed → Accepted.

## 7. Device-run hygiene

The Pixel 9a run used a **side-by-side** debug shell (`com.factorylm.mira.spike`, separate app id),
never `com.factorylm.mira`. Afterwards: spike app uninstalled, `adb reverse` removed, rotation
restored to auto. `com.factorylm.mira` verified untouched at `versionCode=9 / versionName=1.1.0`
with its login intact. All four device-run source edits are LOCAL-ONLY and were reverted
(`git checkout -- mira-mobile/`); none is in this branch — ADR-0034's "no `server.url`" is intact.

Screenshots: `docs/promo-screenshots/2026-08-30_chat-spike-*` (web desktop/mobile + `_android`).
