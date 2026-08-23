# FactoryLM Technician App Dogfood — Implementation Plan

**Governs:** `docs/specs/mira-technician-app-dogfood-system.md` (the design this plan implements; §-references below are to that document).
**Written:** 2026-08-23 · **Plan owner:** implementation sessions · **Product owner:** Mike Crane
**Code baseline:** verified in the read-only checkout `C:/wt-tel` at `c7a6fbcce` (a descendant of the spec's cited `a1f2a3d6a`; every line number quoted below was re-run at `c7a6fbcce` and agrees with the `a1f2a3d6a` dossiers).
**Spec location caveat:** `docs/specs/mira-technician-app-dogfood-system.md` was **not on `main`** when this plan was written — it existed only in commit `4ee8fe84b`, reachable from branch `codex/dogfood-useful-work`. It is now proposed for `main` in **PR #3363**; that PR should land before this plan's §-anchors are cited in review, or reviewers will follow links to nothing.

---

## 1. Verified state on 2026-08-23

The spec's §3 table is honest about what it does not know. This section is stricter: it separates *what the code does* from *what the spec assumes the code does*, with evidence. Where the spec is ahead of the code, it says so without hedging. Six read-only verification agents produced the underlying dossiers; the load-bearing claims below were re-verified directly.

### 1.1 What is genuinely real

| Claim | Evidence | Status |
|---|---|---|
| One canonical Notebook seam, used by both clients | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` (652 lines) owns validation, retrieval, cascade, citation filtering, persistence. Callers: `mira-mobile/src/api/resources.ts:990-993`, `mira-hub/src/components/equipment/NotebookChat.tsx:217-221` | Real |
| Fail-closed source scoping | `validateChatSources` requires tenant ∧ notebook ∧ `match_state ∈ {user_confirmed, verified}` ∧ `enabled_by_default` (`mira-hub/src/lib/equipment-notebooks.ts:557-596`); tested — `chat-boundary.test.ts:73,81,88` | Real, tested |
| Zero-evidence refusal never reaches a provider | `route.ts:307-342`; test `chat-boundary.test.ts:94` | Real, tested |
| Turn persistence incl. abstain and provider-exhaustion | `recordTurn`, `equipment-notebooks.ts:598-628`; table `073_equipment_notebooks.sql:87-99` | Real, tested |
| Server accepts, sanitizes and caps client history (12 turns / 2000 chars) | `sanitizeHistory`, `mira-hub/src/lib/notebook-query.ts:344-358`; 4 tests at `notebook-query.test.ts:103-140` | Real, tested |
| Mobile is a thin adapter with no secrets and no fieldbus client | `grep -rniE 'api[_-]?key\|GROQ\|CEREBRAS\|TOGETHER\|sk-' mira-mobile/src` → one comment; `grep -rniE 'modbus\|opcua\|pycomm\|ethernet/ip' mira-mobile/src` → **zero hits**. Capacitor config has no `server.url`, no `allowNavigation` | Real — §12 and §17 hold |
| No control path anywhere in the shipped surfaces | Relay route table is inbound-only (`mira-relay/relay_server.py:724-733`); WS loop accepts only `tags`/`ping` (`:378-386`); mechanical guard over `ignition/webdev/` at `tests/ignition/test_gateway_live_snapshot.py:513,540,565` | Real — §17 "no application path can command the conveyor" holds |
| Five-tab shell with the tab already titled **Notebook** | `mira-mobile/src/nav.ts:21` (`{ id: "chat", title: "Notebook" }`); §19's rename is 90 % done | Real |
| A genuine freshness/quality/replay/identity gate exists | `tools/cv101_live_gate.py:88-247`; 27 tests pass locally; hourly workflow `.github/workflows/cv101-live-gate.yml` | Real — but see 1.2 |
| The CV-101 feed is NO-GO | [Run 32625347755](https://github.com/Mikecranesync/MIRA/actions/runs/32625347755) plus the six runs after it, all `failure`. Probe: 5 028 rows, 12 tags, 1 distinct observed timestamp, observation age 380 303 s, ingest age 2 s, every row `quality='bad'` | Real, unchanged |

### 1.2 Where the spec is ahead of the code

Each row here is a place the spec describes behaviour that does not exist. None of these are small.

| Spec claim | Actual state | Evidence |
|---|---|---|
| §10 safety contract; §11 "Safety phrase → STOP"; §13 Safety STOP card | **The canonical Notebook seam has no safety classification at all.** `matchSafetyStop` is imported by exactly two routes, neither of them this one. The only occurrence of "safety" in the Notebook system prompt is a directive *against* it. | `grep -rn safety-classifier mira-hub/src --include=*.ts \| grep -v test` → `assets/[id]/chat/route.ts:24`, `namespace/node/[id]/chat/route.ts:35`. Notebook route: only hit is `route.ts:72` — *"Do NOT open with background, safety boilerplate…"* |
| §3 stream contract `sources → content* → usage? → status` | **False on the grounded path.** `sources` is emitted *last* (`route.ts:578`) after all content (`:508`, `:530`), because citations are filtered to the `[n]` markers the answer used. The abstain path is a *different* contract: `sources → status → [DONE]` (`:320`, `:325`, `:331`), with no usage frame. No test asserts either sequence. Both the route docstring (`:12`) and `notebook-chat-types.ts:7-8` repeat the wrong order. | verified `grep -n 'kind: "sources"'` → lines 320 and 578 only |
| §8 "Bind the notebook turn to the canonical asset ID and UNS path" | **No binding exists.** `equipment_notebooks` has no `equipment_entity_id`, no `uns_path`, no `cmms_equipment` reference (`073:33-62`). `createNotebook` inserts its backing `kg_entities` row with `uns_path` explicitly `NULL` (`equipment-notebooks.ts:118-120`). The chat route passes `unsPath: null` with the comment *"notebook nodes are standalone"* (`route.ts:294`). | verified |
| §8 step 7 "Record how the asset was selected and when it was confirmed" | No `confirmed_by` / `confirmed_at` columns. `identity_status='user_confirmed'` is **minted by the client** on a free-text form (`mira-mobile/src/screens/NotebooksTab.tsx:259`, `mira-hub/.../equipment/scan/page.tsx:91`) and accepted verbatim. `identity_source_ref` (`073:52`) is referenced by zero lines of application code. | verified |
| §7 "Server-persisted turns, not device memory, must become the truth" | **History is 100 % client-supplied.** The route never calls `listTurns`; the single source is `sanitizeHistory(body.history)` (`route.ts:276`). Mobile sends none at all — `askNotebook` posts `{ message, sourceDocIds }` (`resources.ts:990-994`) and the word "history" appears once in all of `mira-mobile/src`, as UI copy. A caller can post a fabricated `{role:'assistant'}` turn and it is replayed to the model. | verified |
| §11 "Partial stream → mark the turn interrupted" | The string `interrupted` appears **zero times** in `mira-hub/src`, `mira-hub/db/migrations`, `mira-mobile/src`. The CHECK constraint permits only `('answered','insufficient_evidence','error')` (`073:92-93`). Three paths persist an incomplete answer as `answered`: cost-cap, no-`finish_reason`, and a cross-provider buffer bleed (`responseBuffer` declared at `route.ts:414`, *outside* the `cascade:` loop at `:434`). There is no `cancel()` handler, so a mid-stream disconnect skips `recordTurn` entirely. | verified |
| §9 live admission gate in the request path | **The gate is a CI alarm with no runtime caller.** `classify()` is invoked only by the workflow and its unit test. The Notebook route reads no live signal of any kind. | `grep -rn cv101_live_gate` over `*.py,*.ts,*.tsx,*.yml` → workflow + test only |
| §7 "'Current' is forbidden unless the data passed the live admission gate" | **The Hub currently calls the prod replay row "live."** `classifyTagFreshness` sees only `last_seen_at`, which the relay stamps `NOW()` on every write. Worse, `machine-context-packet.ts:118-119` emits a *static* header `## Live Machine Evidence (observed now)` and the instruction *"Treat it as current, citable observations"* whenever any tag is present, regardless of per-tag freshness. | verified: `machine-context-packet.ts:92,118,119`; `command-center-freshness.ts:58-68` |
| §7 upload lifecycle "queued, uploading, indexing, ready, failed" | Two states. `uploadSourceToNotebook` is one blocking POST whose response is terminal; the UI shows a boolean `busy`. The protection is real but indirect: `canBeChatSource` requires a `docId`, so an unindexed doc cannot enter scope — the app simply never *says* a doc is indexing. | `resources.ts:442-467`; `NotebookScreen.tsx:851-868` |
| §3 / §13 camera | Confirmed defect. Both "photograph" affordances are WebView file inputs (`NotebookScreen.tsx:1036-1051`, `NotebooksTab.tsx:180-190`); no camera plugin is declared (`grep -c 'capacitor/camera' bun.lock package-lock.json` → 0/0). The app nonetheless declares `android.permission.CAMERA`. Issue [#3353](https://github.com/Mikecranesync/MIRA/issues/3353) OPEN. | verified |
| §14 staging-integration layer | **Empty for this route.** Staging Gate grades the Python Supervisor (`tools/staging_test.py:55`); Beta Gate targets `/api/namespace/node/[id]/chat/`; `mira-hub/tests/e2e/equipment-notebook.spec.ts` is wired to no workflow. Every §13 card exists only as a mocked unit test. | verified |
| §14 gating | `Mobile Unit Tests` and `Eval Offline` **run but cannot fail a merge** — absent from `ci-gate.needs` (`.github/workflows/ci.yml:1300-1315`) and from branch protection's five required contexts. | verified |
| §12 telemetry "without copying full private transcripts" | `decision_traces` stores the **full question and full answer** (`persist-usage.ts` binds `scope.question` → `user_question`, `scope.answerText` → `recommendation`). The whole row is also gated on `MIRA_CANONICAL_SEAM`, which defaults to `0` (`docker-compose.saas.yml:753`) — so §16's cost/provider measures may be dark in production, and prod notebook turns may be running the legacy cascade that still lists Gemini. | verified |

### 1.3 Schema facts that kill two proposed designs outright

Two designs in the pre-review draft were built on columns that do not exist. Recording them here so nobody re-proposes them:

- **`live_signal_cache` has no `source_connection_id`.** Its columns come from `020_signal_cache_and_trends.sql:44` plus `036_current_tag_state_freshness.sql:45-61`, which adds exactly `uns_path`, `source_system`, `latest_quality`, `freshness_status`, `expected_freshness_seconds`. `source_connection_id` exists only on `tag_events` (`033_tag_events.sql:84`). Adding it to the `fetchLiveSignals` SELECT raises `undefined_column`, which `isUndefinedRelationOrColumn` swallows into `[]` — a **silent** blanking of every live signal on the Command Center and asset chat.
- **`live_signal_cache` has no source clock at all.** It has `last_seen_at` / `last_changed_at` / `created_at` / `updated_at` only. `tag_ingest.py` states in-code that `last_seen_at` is *server receipt* time and that the client timestamp is preserved only in `tag_events.event_timestamp`. Any "observedAt comes from event_timestamp" guarantee sourced through `fetchLiveSignals` is unimplementable, and a fixture-level test of it passes green while the real path renders a 380 303-second-old value under "observed now."

Migration numbering, verified: `078` is absent, `080` is the highest file → **`081` is the next free integer.** Four separate designs each claimed it.

---

## 2. Decisions this plan makes (so two modules never do one job)

Per §6, if two modules begin doing one of these jobs the work stops. Four collisions were found across the proposed workstreams. They are resolved here, once.

1. **Conversation history has one owner: the server.** The route reads the thread from `equipment_notebook_turns`; `body.history` becomes *accepted-and-ignored* (kept in the schema so an older bundle keeps working). The competing "client history may override for the in-flight thread" proposal is **killed** — it reopens the forged-assistant-turn hole in the same PR that claims to close it, and §12 says the packaged bundle is untrusted input.
2. **Refusal / safety rate has one home: `equipment_notebook_turns.answer_status`.** It is written unconditionally. `decision_traces` is *not* the analytics surface for it: the whole row is flag-gated, and `outcome` already carries a different vocabulary (`'resolved' | 'handoff' | 'kb_gap' | 'gate_fired' | 'engine_error'`, `032_decision_traces.sql:90-92`) with a second live writer in `mira-bots/shared/decision_trace.py`.
3. **Admitted live facts come from `tag_events`, not `live_signal_cache`** (see 1.3). `LiveTag` from `machine-memory-response.ts` is reused for value/unit *formatting only*.
4. **Migration numbers are allocated up front:** `081` status vocabulary · `082` asset binding · `083` live admission columns · `084` decision_traces surface. Each header names its siblings. Per `.claude/rules/mira-hub-migrations.md` §8, a file becomes immutable the moment `migration-verify.yml` applies it to staging — develop each against an ephemeral local Postgres and add the file only when its shape is final.

One ordering decision dominates the rest. **Nothing that increases MIRA's authority ships onto the Notebook seam before the safety stop is on it.** Identity binding makes MIRA say *which machine*; live evidence makes it say *what the machine is doing*; shared history makes it say *what it said before*. All three raise the weight a technician puts on the answer, on a route that today has no hazard classifier and a prompt line telling the model not to open with safety framing. Safety is Phase 1 for that reason, and P16/P18 carry hard dependencies on it.

---

## 3. Ranked slice sequence

Sizes: **S** ≈ one sitting · **M** ≈ one focused day · **L** ≈ multi-day.
**⚙ HARDWARE** marks a slice whose *proof* needs a physical phone or the bench rig. No hardware-gated item blocks any software slice; where a software slice would naturally end in hardware evidence, the software half is scoped to merge and be reviewed on its own.

### Phase 0 — Make the gates real

---

#### P01 — Make the mobile suite and the live-gate suite able to fail a merge
*(origin: VM1)*

**Why now.** Both suites are green and neither can block anything. `ci.yml` itself names this trap: a check that runs but cannot fail the merge is not a guard. Every later slice adds tests to these suites, so the gate must exist before the tests it protects.

**Gaps closed.** `mobile-tests-cannot-fail-a-merge`, `cv101-gate-tests-run-only-in-a-non-gating-job`.

**Files.** `.github/workflows/ci.yml` only: add `mobile-unit-tests` to `ci-gate.needs` (currently `:1300-1315`) plus `MOBILE_RESULT` env and a `require_success mobile-unit-tests` line beside the existing `mira-hub-unit`; add a named `pytest tests/test_cv101_live_gate.py -v` step to the **gated** `test-unit` job beside the existing bot-regression step; correct the stale "62 tests" comment at `:678`. Do **not** gate `test-eval-offline` — it self-skips on docs-only PRs and would need a skip-allowed branch for no extra coverage.

**Tests.** The existing 105 mobile cases and 27 live-gate cases, now gated; `actionlint` on the workflow edit.

**Evidence of done — CI gating layer.** Two run URLs in the PR body: a scratch commit breaking one mobile assertion → `CI Gate` **fails** and names `mobile-unit-tests`; reverted → green. Plus one docs-only commit proving the job resolves `success`, not `skipped`. (Verified precondition: `mobile-unit-tests` has no job-level `if:` — `ci.yml:675-683` — so `require_success` is safe.)

**Size** S · **Depends on** — · **Rollback** revert the workflow diff; no runtime surface touched.

---

#### P02 — Pin the real SSE frame contract; stop three files asserting it backwards
*(origin: VM2, with the challenger's suffix fix)*

**Why now.** Three places state `sources` first; the code emits it last on the grounded path and runs a *different* contract on the abstain path. No test asserts either. **Do not reorder the frame** — `sources` is last because citations are filtered to the `[n]` markers the answer actually used (`route.ts:570`); moving it earlier would let a refusal ship unrelated pages as proof. Fix the documents and add the missing test.

**Gaps closed.** `stream-contract-sources-is-last-not-first`, `usage-frame-dropped-by-the-shared-parser`.

**Files.** New `mira-hub/src/app/api/equipment-notebooks/__tests__/chat-frame-contract.test.ts`; docstring-only edit at `route.ts:11-15`; `notebook-chat-types.ts` — correct the comment at `:7-8` and add `|| obj.kind === "usage"` to `parseFrame`'s allowlist at `:66` (today the declared `NotebookUsageFrame` is in the union but `parseFrame` returns `null` for it, so the web client can never observe per-turn cost).

**Adversarial fix applied.** The sequence assertion takes an optional leading-frame parameter and otherwise asserts the suffix from the first `content` frame onward, because **P16 will prepend a `live` frame**. Without this, P16 turns P02 red and the likely resolution under pressure is to loosen P02 back into the vagueness it exists to remove. P02 also owns the `parseFrame` allowlist edit outright; P16 consumes it.

**Tests.** Full ordered kind list for grounded (`content…, sources, usage?, status`, then literal `data: [DONE]`) and for abstain (`sources, status, [DONE]`, provider never called); one case asserting `parseFrame` returns a usage frame instead of `null`. The 103 existing notebook cases stay green unmodified.

**Evidence of done — unit/contract (§14 layer 1).** `cd mira-hub && npx vitest run src/app/api/equipment-notebooks src/lib/__tests__` green; PR body quotes both verified sequences.

**Size** S · **Depends on** — · **Rollback** revert; comment-and-test only, no behaviour change.

---

### Phase 1 — Safety on the seam

---

#### P03 — Safety hard-stop on the canonical Notebook seam
*(origin: SAFETY-S1, reordered per challenger)*

**Why now.** The route both clients call performs no hazard classification, while its two siblings hard-stop before any LLM call. A technician typing *"smoke coming out of the drive cabinet, safe to work on it?"* gets ordinary manual-grounded troubleshooting today. Closed by **reusing** the already-ported, parity-pinned `matchSafetyStop` — no new policy, no second phrase list.

**Gaps closed.** `notebook-seam-has-no-safety-stop`.

**Files.**
- `mira-hub/db/migrations/081_notebook_turn_status_vocabulary.sql` — drop and re-add the `answer_status` CHECK with the **final** six values in one decision: `('answered','insufficient_evidence','error','safety_stop','interrupted','uncited')`. Every value has a named consumer in this plan (P03, P06, P07). Header records: additive, idempotent, single transaction, `073` never reshaped, no new GRANT needed (table-level grants from `073:130-132` cover it), siblings `082/083/084`.
- `mira-hub/src/lib/notebook-chat-types.ts` — widen `NotebookStatusFrame['status']`.
- `mira-hub/src/lib/equipment-notebooks.ts` — widen `recordTurn`'s `answerStatus` union (no SQL change; already a bound param).
- `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — the gate itself; emit an empty `sources` frame, the `SAFETY_STOP` text as `content` frames, a `status:'safety_stop'` frame, `[DONE]`; set the `X-Safety-Stop` header to match the sibling routes; persist via `recordTurn` with `answerText = SAFETY_STOP` (this is what makes the warning survive a device switch). No retrieval, no fetch, no cascade on this path.
- `mira-hub/src/components/equipment/NotebookChat.tsx` — type-only widening of the local `ChatTurn['status']`, without which the TS build fails.

**Adversarial fix applied — gate placement.** The draft put the classifier *before* `validateChatSources`. That is wrong: `validateChatSources` is the only notebook-ownership check on this route, `recordTurn` validates nothing of its own, and `equipment_notebook_turns.notebook_id` has **no foreign key** (`073:88-99`). A POST naming a foreign notebook UUID plus a safety phrase would have returned 200 SSE where the tested contract is 404, and written an orphan row — and the existing "unknown notebook ⇒ 404" test uses a benign message, so it would have stayed green while the contract inverted. The gate therefore runs **after** ownership is proven and **before** retrieval and any provider call, with `no_sources_selected` special-cased to fall through to the gate so a hazard report still stops when zero sources are selected.

**Tests.** Hard stop before retrieval and before fetch, with `recordTurn` called with `safety_stop`; an educational framing ("what is arc flash?") is *not* stopped (the two-tier carve-out from `guardrails.py`); safety outranks the no-sources 422; a safety phrase against a **foreign** notebook id still 404s and calls `recordTurn` zero times; a table-driven case proving the route's decision equals `matchSafetyStop(message)`. The existing `safety-classifier.test.ts` / `safety-phrases.test.ts` parity guards (which parse `guardrails.py` at test time) stay green untouched — they are the proof this adds no second policy.

**Evidence of done — unit/contract (§14 layer 1) + migration.** `npx vitest run src/app/api/equipment-notebooks src/lib/safety-classifier.test.ts src/lib/safety-phrases.test.ts` green; `apply-migrations.yml` dry-run against staging showing `081` clean, then a second run showing idempotence.

**Size** M · **Depends on** — · **Rollback** revert the route diff (the CHECK widening is additive and can stay; it invalidates no existing row).

---

#### P04 — Render a safety stop unmistakably, live and on reload
*(origin: SAFETY-S2)*

**Why now.** P03 makes the server honest; without P04 the warning renders as an ordinary grey bubble and `humanizeAnswerStatus` falls through to a de-underscored developer token. §10 requires the warning to survive resumption on another device — P03 persists the text, P04 is what makes the *resumed* rendering as loud as the live one. `.flm-safety-banner` already exists in `mira-mobile/src/tokens.css:144` and is referenced by zero components.

**Gaps closed.** `safety-warning-not-visually-distinguished`, `safety-warning-retention-across-devices`, `humanize-leaks-developer-token`.

**Files.** `mira-mobile/src/lib/chat-copy.ts` (explicit branches for `safety_stop`, `interrupted`, `uncited`; export a pure `isSafetyTurn`); `mira-mobile/src/screens/NotebookScreen.tsx` (**both** turn renderers — persisted `:434` and in-session `:453` — so a resumed turn and a live turn look identical); `mira-hub/src/components/equipment/NotebookChat.tsx` (the already-exported pure `Bubble` leaf, testable via `renderToStaticMarkup`); `mira-hub/src/app/(hub)/equipment/[id]/page.tsx` — tag hydrated turns whose content was client-synthesized with `synthetic: true` (P08 needs the flag).

**Tests.** `humanizeAnswerStatus('safety_stop')` returns technician copy, never the raw token, never empty; `parseChatSse` carries the status through unchanged; a `Bubble` with `safety_stop` renders the safety variant and the full text; **a hydrated safety turn renders byte-identically to a live one** — the cross-device retention assertion at the render layer.

**Evidence of done — unit (both sides) + Screenshot Rule.** `npx vitest run src/components/equipment` and `bun run test` green; emulator capture at 412×915 and web at 1440×900 to `docs/promo-screenshots/YYYY-MM-DD_notebook-safety-stop_{mobile,desktop}.png`.

**Size** S · **Depends on** P03 · **Rollback** revert; purely additive rendering.

---

#### P05 — Fact-vs-inference marking; narrow the anti-boilerplate line
*(origin: SAFETY-S4)*

**Why now.** §10 requires distinguishing fact from inference; §7 requires a likely cause to be *clearly marked when inferred*. The prompt has no such rule and its only safety mention (`route.ts:72`) reads, unqualified, as suppressing a genuine hazard warning — exactly backwards next to P03.

**Gaps closed.** `no-fact-vs-inference-marking`, `notebook-system-prompt-suppresses-safety-framing`.

**Files.** `route.ts` `BASE_SYSTEM_PROMPT` only: add an INFERENCE MARKING block (a claim an excerpt states directly is asserted with its `[n]`; a claim beyond any excerpt is prefixed `Likely cause (inferred):` and carries no citation it does not support); narrow `:72` to *generic* safety boilerplate and append *"A specific hazard the excerpts document is not boilerplate — state it."*

**Tests.** A prompt-contract case asserting the directive is present and the unqualified phrasing is gone. **This guards the text, not the behaviour** — say exactly that in the PR.

**Evidence of done — unit for the guard; manual A/B for behaviour.** Five fixture questions (two answerable-from-excerpt, two requiring inference, one unanswerable) run against the deployed seam, before/after answers pasted into the PR. Do not claim a measured improvement from one run — the repo's own judge-variance lesson applies.

**Size** S · **Depends on** — (lands with P03/P04) · **Rollback** revert the prompt block.

---

### Phase 2 — Turn honesty

---

#### P06 — Interrupted and partial turns are labelled, never saved as successful answers
*(origin: SAFETY-S3)*

**Why now.** §11 requires it, and three live paths violate it. A technician acting on a sentence cut off mid-procedure is the concrete harm.

**Gaps closed.** `interrupted-turn-status-absent`, `partial-answer-persisted-as-answered`, `partial-stream-not-labelled-interrupted`, `cross-provider-response-buffer-bleed`.

**Files.** `route.ts`: extract and **export** a pure `finalizeStatus({served, refused, capped, sawStop, internalError})` replacing the inline ternary at `~:571`; track `sawStop` (set only on `finish_reason: 'stop'` or the provider's `[DONE]`); **move `responseBuffer` and `makeCitationNormalizer()` inside the cascade loop** (declared at `:414-415`, loop at `:434`) so provider 1's partial bytes can never be appended to provider 2's answer and attributed to provider 2's model; wrap the post-loop enqueues in try/catch; add a `cancel()` handler recording the turn as `interrupted` with whatever was buffered — today a disconnect makes an enqueue throw inside `start()` and `recordTurn` (which sits after `controller.close()`) never runs at all. `mira-mobile/src/lib/sse.ts`: `parseChatSse` returns `interrupted` when the body has ≥1 content frame but no terminating status frame and no `[DONE]` — today that yields status `''`, which renders as ordinary success.

**Tests.** Exhaustive `finalizeStatus` table; a capped turn persists as `interrupted` (the existing cap test asserts only the usage record); **a provider that streams bytes then aborts does not bleed into the next provider** — mock provider 1 to emit two deltas then throw a `DOMException`, provider 2 to return 200 with no deltas; a stream ending without `finish_reason: stop` is `interrupted`; a truncated body parses as `interrupted`, not silent success.

**Evidence of done — unit/contract.** Both suites green, with the `finalizeStatus` table and the bleed regression named in the PR. **The `cancel()` behaviour under a real aborted request is reasoning-derived from ReadableStream/undici semantics, not observed** — say so and log a follow-up to confirm against a deployed Hub.

**Size** M · **Depends on** P03 (needs the status value) · **Rollback** revert; `finalizeStatus` is a pure extraction so the revert is mechanical.

---

#### P07 — An answer with no surviving citation is withheld, not decorated
*(origin: SAFETY-S5, materially revised by both challengers)*

**Why now.** Refusal is half-real: the deterministic half (zero chunks) is solid; the other half is a regex over LLM prose at temperature 0.3 with no seed and a 400-character bound, so the same question with the same chunks can persist as `answered` on one run and `insufficient_evidence` on the next. Do **not** widen that regex — add the deterministic complement the citation-entailment filter already computes for free.

**Gaps closed.** `refusal-status-is-nondeterministic-prose-regex`, `uncited-prose-recorded-as-a-grounded-answer`, `retrieval-evidence-pool-not-reproducible`.

**Files.** `route.ts` — extend `finalizeStatus` with `citationCount`; `served && !refused && citationCount === 0` → `'uncited'`. `isRefusal` is left byte-identical; the new rule sits beside it. `mira-hub/src/lib/manual-rag.ts` — deterministic ordering on **all three** lanes. `mira-mobile/src/lib/chat-copy.ts` + both clients — the `uncited` presentation.

**Adversarial fixes applied — two, and both change the shape of the slice.**
1. **The answer body is withheld, not banner-labelled.** The draft kept the full text under an amber "treat as unverified" strip. An LLM-authored maintenance procedure labelled unverified is still a procedure a technician will follow; the banner removes MIRA's accountability, not the instruction. `uncited` therefore renders *"I produced an answer I can't ground in your sources — ask again or check the manual."* The full text is still persisted on the turn for review; if it must be reachable it goes behind an explicit "Show unverified answer" tap, never inline over rendered steps.
2. **The ordering fix was incomplete and its test was vacuous.** `manual-rag.ts` has two `ORDER BY rank DESC` sites (`:350`, `:511`) — and the exact-token lane has **none**: it selects `0::float4 AS rank` (`:539`) with `content ILIKE ANY($3)` (`:546`) and a bare `LIMIT`, and its rows join the same candidate pool, which a JS rerank then narrows. Ordering only the ranked lanes leaves the dominant nondeterminism untouched. Order the exact lane too (`ORDER BY doc_id, page_start`), make the rerank comparator total, and replace "assert the SQL contains the tiebreaker" (which verifies the edit, not the behaviour) with: run the same query twice against a tied-rank fixture and assert **byte-identical chunk id sequences**.

**Tests.** `finalizeStatus` table extended (`uncited`; a refusal still outranks it); a normal cited answer stays `answered` (the explicit false-positive guard); fancy-bracket `【4†…】` markers normalized to `[4]` count as cited, proving the rule runs *after* the normalizer; the twice-run determinism test; `humanizeAnswerStatus('uncited')`.

**Evidence of done — unit/contract + a measured false-positive count.** Report the number of correctly-grounded fixture answers downgraded to `uncited` (target zero). Report the number, not a verdict — a non-zero result indicts the normalizer, not the rule.

**Risk note for reviewers.** The `manual-rag` ordering change has blast radius beyond this slice: `retrieveNodeChunks` is shared with assets chat and namespace chat. It is ordering-only and additive, but re-run those suites in the same PR.

**Size** M · **Depends on** P03, P06 · **Rollback** the `uncited` branch and the ordering change revert independently; ship them in one PR but keep the commits separate.

---

### Phase 3 — History authority

---

#### P08 — The server reconstructs the thread; `body.history` stops being the conversation
*(origin: A1, absorbing the surviving half of SAFETY-S7)*

**Why now.** Highest value-per-line in the plan and it needs no migration and no mobile change. Mobile sends no history at all, so a phone follow-up reaches the model with no antecedent **and** no retrieval augmentation (`buildRetrievalQuery` / `buildTopicHint` both no-op on empty history). Reconstructing server-side gives the phone full continuity with zero mobile lines changed, and closes the forged-assistant-turn hole in the same stroke.

**Gaps closed.** `mobile-history-not-sent`, `history-is-purely-device-supplied`, `web-synthesizes-a-refusal-string-into-history`, `safety-warning-not-retained-across-devices`.

**Files.**
- `notebook-chat-types.ts` — one exported `INSUFFICIENT_EVIDENCE_MESSAGE` const. That sentence is currently duplicated (the route streams it; `equipment/[id]/page.tsx:72` *invents* it for display and then posts it back as if a model had said it). One owner, three readers.
- `equipment-notebooks.ts` — `listRecentHistory(tenantId, notebookId, maxRows = 6)`, same tenant-scoped inner-DESC/outer-ASC window as `listTurns`.
- `route.ts` — replace `sanitizeHistory(body.history)` (`:276`) with `sanitizeHistory(await listRecentHistory(...))`, read **after** `validateChatSources` so an unauthorized notebook is never queried. `body.history` becomes accepted-and-ignored; say so in the docstring.
- `NotebookChat.tsx` — delete the client history builder (`:207-211`) and drop `history` from the body (`:220`). A deletion, not a rewrite.
- `equipment/[id]/page.tsx` — use the shared const for the *display* fallback; it can no longer reach the model.

**Adversarial fixes applied — two, both correctness-critical.**
1. **`listRecentHistory` is default-deny over the status vocabulary, not a three-branch map.** The draft mapped `answered → text`, `insufficient_evidence → refusal sentence`, `error → drop`. P03/P06/P07 add `safety_stop`, `interrupted`, `uncited` to the same CHECK — a `safety_stop` turn would have matched no branch and been **silently dropped from the reconstructed thread**. A technician who reports smoke, gets the STOP, then asks "ok so what do I check first?" would have received ordinary troubleshooting as if the hazard report never happened. The function switches over every value in the `081` CHECK; an unrecognised status is included as an assistant message carrying its status label. A test enumerates the CHECK values and asserts each is handled, so widening the constraint without handling the new value fails CI.
2. **The most recent persisted `safety_stop` turn is always pinned into the window**, even when it falls outside the 6-turn slice — §10's "retain safety warnings when resumed on another device," implemented rather than assumed. This is the one surviving requirement from the competing S7 proposal; its "client override" clause is **killed** (see §4).

**Tests.** Thread reconstructed from persisted turns when the body sends none (assert the exact `[system, user, assistant, user, assistant, user]` message array); **a forged assistant turn in the body never reaches the provider**; a persisted `insufficient_evidence` turn contributes the *server's* sentence; an `error` turn contributes nothing; a `safety_stop` turn is always present; 20 rows in → ≤12 messages out, most-recent, chronological; an empty notebook produces an unaugmented retrieval query (guards against failing open into a fabricated topic); history is read only after source validation; the CHECK-enumeration exhaustiveness test.

**Evidence of done — unit/contract.** The 103-case notebook suite plus ~9 new cases green. Behavioural cross-device proof is P22's job, not this slice's.

**Behaviour change to state in the PR.** Web previously sent the in-flight thread including turns not yet persisted. In practice `recordTurn` runs before the next send, so the reconstruction is equivalent — but a silent persist failure now removes that turn from the model's memory instead of it surviving in client state. That is the correct trade (the server is the authority) and it should be written down.

**Size** M · **Depends on** P03 (needs `safety_stop` to exist before the pinning rule is meaningful) · **Rollback** restore the one-line `sanitizeHistory(body.history)`; the web client change reverts independently.

---

#### P09 — Turn read-back returns what it stored
*(origin: A2, de-scoped)*

**Why now.** `recordTurn` writes `enabled_source_doc_ids` (`equipment-notebooks.ts:612-615`) but `listTurns`' SELECT omits it (`:651-653`), so a turn resumed on the other device cannot show which sources produced it — §6 "Durable evidence: stores the source snapshot" is satisfied on write and broken on read. P12 also needs the **turn id** exposed to mobile.

**Gaps closed.** `source-snapshot-and-model-not-readable-back`.

**Files.** `equipment-notebooks.ts` (`listTurns` SELECT + row mapper); `equipment-notebooks/[id]/route.ts` (docstring: widen the documented response shape); `mira-mobile/src/api/resources.ts` (`NotebookServerTurn`); `equipment/[id]/page.tsx` (carry onto the hydrated `ChatTurn`).

**Adversarial fix applied.** `model` is **not** exposed to clients. The draft added it to both the mobile and web turn types; that puts provider/model identity — and by extension the cascade order — on a technician's phone and in every screenshot, with no named consumer in the slice's own tests or UI. Only `enabled_source_doc_ids` and the turn `id` cross the boundary. If a per-turn model is ever needed for support it belongs on an admin surface.

**Tests.** `listTurns` returns the snapshot and the id; a legacy row with an empty snapshot does not throw; the mobile `NotebookDetail` mapping preserves both (extend the existing `files-nameplate.test.ts` case that already owns turn-shape assertions).

**Evidence of done — unit.** `npx vitest run src/lib/__tests__/equipment-notebooks-domain.test.ts` and `bun run test` green.

**Size** S · **Depends on** — · **Rollback** trivial; additive columns on an existing SELECT.

---

### Phase 4 — Equipment identity

---

#### P10 — Migration 082 and the asset-binding write path
*(origin: A3, materially revised)*

**Why now.** There is nothing to bind a turn *to*. §8 steps 6–7 are unimplementable until the columns exist. Shipping schema + write path separately from the read path keeps each reviewable and lets `migration-verify.yml` apply `082` to staging before behaviour depends on it.

**Gaps closed.** `notebook-not-bound-to-canonical-asset`, `no-asset-confirmation-record`.

**Files.**
- `mira-hub/db/migrations/082_notebook_asset_binding.sql` — on `equipment_notebooks`: `equipment_entity_id UUID NULL` (soft reference, matching the deliberate no-hard-FK posture documented at `073:17-19`), `asset_selected_via TEXT NULL CHECK (… IN ('asset_picker','qr','work_order','nameplate','manual_entry'))`, `asset_confirmed_by TEXT NULL`, `asset_confirmed_at TIMESTAMPTZ NULL`. On `equipment_notebook_turns`: `equipment_entity_id UUID NULL`, `asset_uns_path TEXT NULL` — a per-turn immutable **snapshot**, TEXT not LTREE, because an audit record must not acquire an ltree dependency or re-resolve at read time. Index `(tenant_id, equipment_entity_id)`. **Deliberately absent:** `uns_path` on `equipment_notebooks` — the path is resolved live from `kg_entities` so exactly one row owns it (`.claude/rules/uns-compliance.md` #1).
- `equipment-notebooks.ts` — `bindNotebookAsset` / `unbindNotebookAsset`. Bind resolves inside `withTenantContext` with `tenant_id = $1::uuid AND (id::text = $2 OR entity_id = $2) AND approval_state = 'verified' AND uns_path IS NOT NULL` — the same predicate `/api/assets/[id]/chat` already uses, so the two surfaces agree on what a resolvable asset is. Returns a discriminated union: `{ok:true, …} | {ok:false, error:'asset_not_found'|'asset_not_verified'|'asset_has_no_uns_path'|'notebook_not_found'}`.
- New `mira-hub/src/app/api/equipment-notebooks/[id]/asset/route.ts` — `PUT` binds, `DELETE` unbinds. A dedicated sub-route, deliberately *not* a field on the existing `PATCH`: `PATCH` is the free-text identity editor, and conflating a canonical binding with a typed-in metadata edit is the exact trust inversion `sources/route.ts:28-34` already refuses ("a client may NOT mint `verified`").

**Adversarial fix applied — selection is not confirmation.** The draft stamped `asset_confirmed_by` + `asset_confirmed_at` for *every* `via`, including `qr`, `nameplate` and `work_order`. A QR sticker is an assertion by whoever printed and applied it, not a technician confirming identity. Two identical conveyors with stickers swapped during a rebuild: the technician scans CV-102's sticker, the notebook binds to `cv_101`, P11 prepends `cv_101`'s canonical key to the prompt as certified identity, the card renders green "confirmed," and P18 would render `cv_101`'s live values — while the technician's hands are on CV-102. §8 step 7 asks how the asset was **selected** *and* when it was **confirmed**; the draft collapsed them. So: `asset_selected_via` records provenance; `asset_confirmed_by`/`asset_confirmed_at` are written **only** by an explicit human affirmation of the named asset. Non-picker routes leave the notebook *selected-but-unconfirmed*. Both fields are derived server-side from the session and clock and are never accepted from the body.

**Tests.** Binds a verified, uns-pathed, same-tenant asset; a foreign-tenant entity is `asset_not_found` (404) — assert the tenant param; `approval_state != 'verified'` → 422 (`no auto-promote`); a verified entity with `uns_path IS NULL` → 422 — **this is the case a notebook's own backing node hits** (`equipment-notebooks.ts:118-120` creates it with NULL), so it must be refused rather than self-binding; the confirmation record comes from the session, not the body (post a `confirmedBy`/`confirmedAt` in the payload and assert they are ignored); **`via:'qr'` alone never populates `asset_confirmed_by`**; `DELETE` clears all binding columns together (a half-unbound row would be a lie about provenance).

**Evidence of done — unit/contract + staging migration.** Suite green; `migration-verify.yml` applies `082` to the staging Neon branch on the PR. Prod apply is a separate gated dispatch and is **not** claimed here.

**Size** M · **Depends on** — · **Rollback** the endpoint and lib functions revert cleanly; the migration is additive and stays (an applied migration is never rewritten — `.claude/rules/mira-hub-migrations.md` §8).

---

#### P11 — Bind the turn, reject unresolvable identity, and make it visible — one PR
*(origin: A4 + A5, merged per challenger)*

**Why now.** The model's only equipment grounding today is `[manufacturer, model].join(' ') || 'an unspecified machine'` (`route.ts:354`), and the turn record has no asset column, so an answer cannot be re-interpreted against the asset it was about. §17's Definition of Done requires the binding. Critically, binding **pulls a rejection contract in with it**: the moment a notebook carries an `equipment_entity_id` it becomes the "asset detail page" row of `.claude/rules/direct-connection-uns-certified.md`, whose clause 2 requires a turn with a missing or unresolvable identifier to be **rejected** with `{"error":"uns_required"}` — never downgraded to asking the technician. This slice is where that cost is paid deliberately.

**Gaps closed.** `chat-turn-carries-no-asset-context`, `no-test-asserts-asset-binding`, `notebook-has-no-asset-context-card`.

**Files.** `equipment-notebooks.ts` — `resolveBoundAsset(tenantId, notebookId)` returning `unbound | resolved | unresolvable`, reusing P10's predicate (one definition of "resolvable", two callers); `recordTurn` gains optional `equipmentEntityId` / `assetUnsPath`. `route.ts` — call it after `validateChatSources`; `unresolvable` → 422 `uns_required` with **no** retrieval, **no** provider call, **no** recorded turn (a rejected request is not a turn); `resolved` → prepend a canonical identity line (name, key, UNS path) ahead of the existing free-text line; `unbound` → today's behaviour verbatim; pass the snapshot to **both** `recordTurn` sites. New `mira-hub/src/lib/notebook-asset-card.ts` — a *pure* `assetCardState(asset)` → `{tone, headline, detail}`, pure so it is unit-testable without a DOM (mira-hub has no component-test harness and this slice must not build one). `equipment-notebooks/[id]/route.ts` GET returns an `asset` block. `equipment/[id]/page.tsx` — render the card and a "Confirm asset" action that PUTs the chosen entity with `via:'asset_picker'`, reusing the existing assets route.

**Adversarial fixes applied — two.**
1. **A4 and A5 merge into one PR.** The 422 is a hard failure mode, and between two separate merges (or on mobile before P12) a technician at the machine meets an opaque wall: mira-mobile renders the generic `ErrorState` with no `onRetry`, and the composer is cleared before the request and never restored. On a plant floor that reads as "the app is broken," and the technician proceeds without MIRA. The 422 body therefore carries the technician sentence and the notebook/entity id from the first commit, so *any* client can render an honest reason, and the card ships alongside.
2. **Binding must not widen retrieval.** `retrieveNodeChunks` keeps `unsPath: null`. Passing the bound path would trigger `manual-rag`'s ltree subtree expansion and silently overrule the validated doc set that is the notebook's entire safety model. There is an explicit regression test for this and it is the most important assertion in the phase.

**Tests.** A bound notebook puts the canonical key and UNS path in the prompt; a bound turn persists both fields — **including on the abstain path** (an `insufficient_evidence` turn must still be attributable); an unresolvable binding is **rejected 422** with no retrieval, no fetch, no `recordTurn`; the rejection **never asks a confirmation question** and opens no SSE stream; an unbound notebook behaves exactly as before (proving the slice is additive for every existing notebook); **`retrieveNodeChunks` still receives `unsPath: null` and exactly the validated docIds** under a fully resolved asset; the card mapper renders confirmed / selected-but-unconfirmed / unresolvable tones and **emits no colour literal** (guards `.claude/rules/ui-style.md`).

**Evidence of done — unit/contract + Screenshot Rule.** Suite green; desktop and mobile screenshots of the context card in confirmed and unconfirmed states to `docs/promo-screenshots/`.

**Scope fence.** The card shows asset identity and confirmation state **only**. §7's "newest admitted live observation time and quality" belongs to Phase 5; rendering any freshness here, before an admission gate exists in the request path, would be an unearned currency claim.

**Size** L · **Depends on** P10 · **Rollback** the 422 is the risky half — gate it behind an env flag defaulting to permissive for one deploy if staging shows unexpected `unresolvable` volume, then remove the flag.

---

#### P12 — Mobile: one merged turn list, resume refetch, asset card, question preserved
*(origin: A6)*

**Why now.** After P08 the phone has full model-side continuity with no mobile change — but it still renders two unmerged blocks (`NotebookScreen.tsx:434` server, `:453` local), never refetches after a send or on resume (`refresh()` runs only from the mount effect at `:163-167`), and shows no asset identity. §17: "Phone and web show the same persisted notebook turns and evidence."

**Gaps closed.** `mobile-two-unmerged-turn-lists`, `notebook-has-no-asset-context-card` (mobile), `failed-ask-discards-the-question`.

**Files.** New pure `mira-mobile/src/lib/turns.ts` (`mergeTurns`); `NotebookScreen.tsx` (render one merged list; `refresh()` after a successful ask; visibilitychange/resume refetch mirroring the existing foreground-drain pattern in `Workorders.tsx:132` — reuse it, do not invent a second; `setQ(question)` in the ask catch block plus an `onRetry` so `ErrorState`'s Retry button actually renders, since `common.tsx:25-29` gates on it; asset card above the panel switcher using existing `--fl-*` tokens); `resources.ts` (type the `asset` block).

**Adversarial fix applied — id matching is mandatory, not preferred.** The draft matched a live turn to its persisted twin on question + answer text and noted the collision risk as an aside. With P03 landed, a `safety_stop` turn and a retry of the same question produce byte-identical text, so the phone could **drop one of them** — quietly reducing the number of visible hazard warnings. P09 exposes the persisted turn id; `mergeTurns` matches on **id only**, using text matching solely for a not-yet-persisted optimistic turn.

**Tests.** Chronological interleave; a live turn is dropped once its persisted twin arrives (no duplicate); an unpersisted optimistic turn is preserved; a turn asked on another device appears after refresh; `mergeTurns` is idempotent under repeated application (so a resume refetch cannot reorder the thread); **a turn whose status is not `answered` is never dropped under any input**.

**Evidence of done — unit (§14 layer 2, gated by P01).** `bun run test` green. The genuinely cross-device leg is claimed by P22 plus a physical run — do not report it from unit tests.

**Size** M · **Depends on** P08, P09, P11 · **Rollback** revert; client-only.

---

### Phase 5 — Live evidence, honesty first

The ordering inside this phase is deliberate and inverted against instinct: the product learns to say *"unavailable, and here is why"* before it earns the right to say *"current."* The real feed is NO-GO, so every honesty slice can be built, tested and merged today, while the GO path (P18) is last and is the only one that can manufacture a false claim.

---

#### P13 — Stop calling a replayed, bad-quality row "live" — and stop telling the model to treat it as current
*(origin: C3, extended by challenger #2)*

**Why now.** This is a live wrong-label defect today on `/api/assets/[id]/chat`, independently of everything else in the phase. Fixing the shared primitive once prevents P18 inheriting the same lie.

**Gaps closed.** `hub-serving-path-calls-the-prod-replay-row-live`, `hub-live-read-never-selects-quality`.

**Files.** `machine-memory.ts` — add `latest_quality`, `freshness_status`, `source_system` to the `fetchLiveSignals` SELECT and to `LiveSignalRow`. `command-center-freshness.ts` — `classifyTagFreshness` takes an optional `quality`; precedence mirrors the reader that already gets this right (`mira-bots/shared/factorylm_live.py::_freshness_for`): simulated → `simulated`; quality ∈ {bad, stale, uncertain} → `stale` regardless of `last_seen_at`; else the existing age window. A null/absent quality preserves today's behaviour byte-for-byte, so no other caller regresses. Update the file header, which currently states freshness is computed from `last_seen_at` alone. `machine-context-packet.ts` — thread quality onto `LiveTag`.

**Adversarial fixes applied — two, one fatal.**
1. **`source_connection_id` is removed from the SELECT.** It does not exist on `live_signal_cache` (§1.3); adding it raises `undefined_column`, which `fetchLiveSignals` swallows into `[]` — a silent blanking of every live signal on the PR whose stated purpose is more honest live evidence. Per-connection provenance comes from the `tag_events` probe (P15), not the cache.
2. **The block header and directive must change too, not just the per-tag label.** The draft's claim that "the CV-101 live block flips from live to stale" is false: `machine-context-packet.ts:118-119` emits a *static* `## Live Machine Evidence (observed now)` and *"Treat it as current, citable observations"* whenever `live_tags` is non-empty, with no reference to per-tag freshness. Relabelling one tag `(stale)` underneath that header leaves the model explicitly instructed to treat a 380 000-second-old sample as current. So: when **no** tag classifies `live`, suppress the section entirely or retitle it *"Last known values — NOT current; do not describe present state"* and drop the "treat it as current" sentence.

**Tests.** The prod replay shape (`last_seen_at: now-2000ms`, `simulated:false`, `quality:'bad'`) → `stale`, not `live`; `stale`/`uncertain` also → `stale` at any age; `good` + fresh → `live` (no over-correction); `good` + old → `stale`; `simulated` + `good` → `simulated` (provenance still wins); **quality undefined → identical result to the pre-change function across the whole existing matrix** (regression fence for `tagStatuses`, `rollupFreshness`, `machine-current-state`); an all-stale packet emits neither "observed now" nor "Treat it as current."

**Evidence of done — unit.** `npx vitest run src/lib/command-center-freshness.test.ts src/lib/machine-current-state.test.ts src/lib/machine-context-packet.test.ts` green.

**Blast-radius note.** This changes a primitive shared with the Command Center tree roll-up. Expect visible status changes wherever a gateway reports bad quality — that is the point, and reviewers should be told to expect it.

**Size** M · **Depends on** — · **Rollback** the optional argument makes this revertible in one commit with no schema involvement.

---

#### P14 — Pure live-admission classifier, parity-pinned to the CV-101 gate
*(origin: C1)*

**Why now.** The honest-unavailable *decision*, and the only piece needing nothing else to exist. Mergeable and provable while the notebook has no binding, while the publisher is NO-GO, and while nothing renders it. Converts a CI-only gate into a reusable server primitive **without forking it**.

**Gaps closed.** `gate-is-ci-only-not-a-runtime-admission-gate` (the decision half).

**Files.** New `mira-hub/src/lib/live-admission.ts` — framework-free, no DB, no clock beyond an injected `nowMs`. Exports the cause union, `LIVE_ADMISSION_THRESHOLDS = {maxObservedAgeS: 300, maxIngestAgeS: 120, minLiveRatio: 0.5}` mirroring `tools/cv101_live_gate.py:88-96`, `LiveProbeGroup`, and `classifyLiveAdmission(...)`. Port the check **order** and first-fail cause selection exactly, and port `live_ratio = distinctObservedTs / (rows / tagCount)` — the per-**scan** divisor, with the comment explaining that a per-row divisor caps the ratio at 1/N and made GO unreachable for a healthy 12-tag stream. A `REASON_COPY` map gives every cause a technician sentence with no developer token in it. New `mira-hub/src/lib/__tests__/live-admission.test.ts`. `.github/workflows/ci.yml` — add `tools/cv101_live_gate.py` to the Hub Unit Tests `paths-filter` list (the same seam already used for `guardrails.py`), so a Python-only threshold edit still runs the TS parity guard; `tests/test_hub_unit_filter_contract.py` gains the matching contract test.

**Cause vocabulary.** `NO_ASSET_BOUND` (new, TS-only, `display:'silent'`), `PHYSICAL_OR_GATEWAY`, `REPLAY`, `ALLOWLIST_IDENTITY`, `PROVENANCE`, `GATEWAY_QUALITY`, `STALE_OBSERVATION`, `SCOPE`, plus **`ADMISSION_UNAVAILABLE`** — added per challenger #2: when the assembler itself throws, the honest statement is *"I could not check whether this machine's live data is trustworthy, so I am not using it,"* **not** *"nothing is arriving from this machine's gateway"* — the latter is a claim about the plant MIRA cannot prove and would dispatch someone to check a gateway that is fine.

**Tests.** The **verbatim prod probe row** from [run 32625347755](https://github.com/Mikecranesync/MIRA/actions/runs/32625347755) classifies `REPLAY`; empty groups → `PHYSICAL_OR_GATEWAY`; all-bad + fresh observation → `GATEWAY_QUALITY`; fresh ingest + 900 s observation → `STALE_OBSERVATION`; simulator-only → `PROVENANCE`; wrong path → `ALLOWLIST_IDENTITY`; short tag count → `SCOPE`; the measured healthy bench shape → **admitted:true** (pins the 2026-08-16 regression where a healthy stream scored REPLAY forever); **parity** — thresholds, the cause literals and the presence of the `/ scans` divisor are extracted from the Python and must equal the TS constants, failing loudly with the drifted values named; no `REASON_COPY` string contains a cause token, an underscore-token, or the phrase "NO-GO."

**Evidence of done — unit + a quotable product statement.** Suites green; the PR quotes: *the real production row the CV-101 gate called NO-GO: REPLAY is fed to the server-side classifier as a fixture and produces the exact sentence the Notebook will show.*

**Standing rule.** Thresholds are never widened to manufacture a GO. The parity test makes any such edit a two-file change a reviewer sees.

**Size** M · **Depends on** — · **Rollback** delete the module; nothing consumes it yet.

---

#### P15 — Tenant-scoped read-only probe and the assembler
*(origin: C2)*

**Why now.** Gives the classifier real data under the tenant boundary, and makes "no asset bound" a first-class zero-DB answer — which is what every notebook is today. After this, the server can compute the honest unavailable state for every existing notebook with all five §18C negative cases proven.

**Gaps closed.** `no-live-admission-in-the-request-path`, `no-serving-layer-negative-tests-for-replay-or-wrong-asset-live`.

**Files.** New `mira-hub/src/lib/notebook-live-evidence.ts`. `assembleLiveEvidence(client, tenantId, unsPath, nowMs, windowMinutes = 10)`: (1) `unsPath == null` → `NO_ASSET_BOUND` with **zero queries**; (2) `expectedTagCount` read from `approved_tags` (`tenant_id ∧ enabled ∧ uns_path <@ $2::ltree`), never hardcoded — zero rows → `SCOPE` with the no-allowlist reason; (3) one grouped read-only probe over `tag_events`, tenant-predicated **first**, the same shape as `cv101-live-gate.yml:96-119` plus the tenant clause, returning `source_system, source_connection_id, simulated, rows, distinct_observed_ts, tag_count, bad_quality_rows, newest_observed_age_s, newest_ingest_age_s, uns_paths`; (4) map → `classifyLiveAdmission`; (5) degrade, never throw — reuse the `isUndefinedRelationOrColumn` guard so an env without `033`/`035` returns an unavailable verdict rather than breaking a chat turn.

**Adversarial fix applied — identity scoping is stated honestly, not asserted equal.** The CI probe deliberately has an OR-arm on `source_connection_id` with no tenant predicate, so it can see a stream arriving under the *wrong* path. A tenant-scoped ltree probe cannot: a foreign-path stream is simply zero rows → `PHYSICAL_OR_GATEWAY`. Either give the Hub probe the same OR-arm (the asset's approved `source_connection_id`s, tenant-scoped) so `ALLOWLIST_IDENTITY` is genuinely reachable, or document in P14 that `ALLOWLIST_IDENTITY` is CI-only. **Decide it here, in this slice, and record the choice** — because P28's parity check depends on it (see P28's revised gate).

**Tests.** `NO_ASSET_BOUND` with `client.query` called **zero** times; relay-down; the verbatim prod replay group; stale; all-bad; **wrong asset in two parts** — (a) assert the *emitted SQL* carries `tenant_id = $1::uuid` and `uns_path <@ $2::ltree` with the caller's values (recorded params, so a future "optimisation" that drops the tenant predicate fails), (b) telemetry belonging only to another asset yields the honest "nothing for THIS machine," never a borrowed reading; `SCOPE` for both short tag count and empty allowlist; a missing table returns an unavailable verdict and does not throw.

**Evidence of done — unit, with all five §18C negative cases named in the test titles** plus the two this repo actually needs today (no asset bound, no allowlist).

**Size** M · **Depends on** P14 · **Rollback** delete the module; still unconsumed.

---

#### P16 — Wire the admission into the turn: a `live` frame first, and a directive the model cannot talk around
*(origin: C5)*

**Why now.** This is where the product becomes honest. Every notebook turn carries a server-decided verdict, the model is explicitly forbidden from claiming current state on NO-GO, and the verdict is persisted. It ships value with zero client work — both parsers ignore unknown frame kinds.

**Gaps closed.** `notebook-turn-has-no-live-context`, `no-live-admission-in-the-request-path`.

**Files.**
- `mira-hub/db/migrations/083_notebook_turn_live_admission.sql` — `ALTER TABLE equipment_notebook_turns ADD COLUMN IF NOT EXISTS live_admission JSONB NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS live_facts JSONB NOT NULL DEFAULT '[]'::jsonb;`. Never touches `073`. No new GRANT (table-level grants already cover it); no policy or GiST index touches these columns, so no drop/recreate ordering.
- `equipment-notebooks.ts` — `recordTurn` accepts both; `listTurns` returns both, carrying the **original** `observedAt`, never re-stamped.
- `notebook-chat-types.ts` — `NotebookLiveFrame` added to the union (`kind:'live'`, `admitted`, `cause`, `reason`, `display`, `observedAt`, `source`, `facts`).
- `route.ts` — call `assembleLiveEvidence` after the notebook fetch; emit the live frame as the **first** enqueue in **both** `ReadableStream` constructors (unavailability is true regardless of document evidence); when not admitted, append to `machineContext`: `LIVE MACHINE DATA: UNAVAILABLE — <reason>` plus *"You have NO current readings for this machine. Do not state, guess, or imply what it is doing right now."*; pass the admission to `recordTurn` on both paths; wrap so a failure yields `ADMISSION_UNAVAILABLE` and the documents-only answer still ships — **fail-open on the document answer, fail-closed on any live claim**.

**Adversarial fixes applied.** (a) The `live` frame is safe first — unlike `sources`, it is not filtered against the answer's `[n]` markers, so the sources-last constraint does not apply, and both parsers are order-independent (`mira-mobile/src/lib/sse.ts:45-64` assigns by kind and silently ignores unknowns; `NotebookChat.tsx` is an if/else chain). P02 already accommodates the leading frame. (b) The `unsPath` comes from **P11's `resolveBoundAsset`**, not from a column — P10 deliberately does not create `equipment_notebooks.uns_path`. All three P11 states are handled: `unbound` → `NO_ASSET_BOUND` (silent), `resolved` → probe, `unresolvable` → P11 already rejected the turn before this code runs, so P16 sits *after* the rejection. (c) The `parseFrame` allowlist edit belongs to P02.

**Tests.** Full frame sequence on the grounded path `['live','content',…,'sources','usage'?,'status']` and on abstain `['live','sources','status']`; **a REPLAY turn still answers from documents** — provider IS called and a cited answer streams (an unavailable feed must never suppress the manual); the directive appears in the machine-context block, not the history array, with the server's copy verbatim; **no "observed now"/"current" block appears anywhere in the provider body when not admitted** (the negative that keeps P18 honest); the admission is persisted on both the grounded and abstain paths; a thrown assembler yields `ADMISSION_UNAVAILABLE`, a live frame, a normal cited answer, and never a 500.

**Evidence of done — unit/contract.** Suite green. Reviewable product statement: *a Notebook turn asked against the real CV-101 feed now says "Live data for this machine is unavailable: the gateway is repeatedly sending one old observation" and answers from the manual only.*

**Size** M · **Depends on** **P03** (a turn that surfaces machine state must be behind the safety stop), P11, P15 · **Rollback** the frame and the directive revert together; migration `083` stays (defaults are inert).

---

#### P17 — Render the unavailability with the server's words
*(origin: C6)*

**Why now.** Until this ships the honest state exists in the transcript and the database, but the technician at the conveyor cannot see it. Phone and web must land together — if only one renders it, the two surfaces disagree about whether MIRA knows the machine's current state, which is worse than neither showing it.

**Gaps closed.** the rendering half of `notebook-turn-has-no-live-context`.

**Files.** `mira-mobile/src/lib/sse.ts` (explicit field-by-field mapper next to `normalizeCitations` — a new server field is a deliberate addition, never a cast); `NotebookScreen.tsx` (banner above the answer when `admitted === false && display === 'banner'`, showing `reason` **verbatim**; suppressed on `silent`; also rendered from a **persisted** turn's `live_admission` so a phone opening a web-answered turn sees the warning that applied at the time); `mira-mobile/src/app.css`; `NotebookChat.tsx` (same, off the same frame and the same read-back); tests in `pure.test.ts` and a new `notebook-chat-types.test.ts`.

**Adversarial fix applied — tokens and severity band.** The draft used `--fl-amber`, a mira-mobile-invented token absent from canonical `docs/design/factorylm-tokens.css` (canonical state tokens are `--fl-ok` / `--fl-warn` / `--fl-fault`), violating `.claude/rules/ui-style.md`'s "per-tool copies must match." And amber is the wrong band for one case: on a notebook bound to a machine whose gateway is dead, *"I have no readings at all for this machine"* is a fault, not a warning. Use canonical tokens (adding them to the mobile alias layer) and map cause → band: `NO_ASSET_BOUND` silent; `STALE_OBSERVATION` / `REPLAY` / `SCOPE` / `ADMISSION_UNAVAILABLE` warn; `PHYSICAL_OR_GATEWAY` / `GATEWAY_QUALITY` on a bound asset fault. Assert the mapping in P14's `REASON_COPY` table.

**Tests.** The live frame parses regardless of position; a body with no live frame yields `null` (backward compatible with every existing fixture); unknown extra fields do not throw; **the rendered banner text equals the server's `reason` byte-for-byte** — no client-authored copy, and grep-assert that no threshold constant or age arithmetic exists anywhere in `mira-mobile/src`; `display:'silent'` renders nothing; `parseFrame` accepts `sources|content|status|live|usage` and rejects junk; a persisted unavailable admission renders on read-back with the **original** `observedAt`.

**Evidence of done — unit + Screenshot Rule.** Both suites green; `docs/promo-screenshots/YYYY-MM-DD_notebook-live-unavailable-replay_{mobile,desktop}.png` — the technician-facing proof that the product can say it does not know.

**Watch-out.** `tools/mobile-e2e/journey.py` taps literal text; a new banner shifts layout. Check its assertions before merging.

**Size** M · **Depends on** P16 · **Rollback** revert; client-only.

---

#### P18 — Admitted live facts enter the turn as evidence
*(origin: C7, heavily revised — the original design was unimplementable)*

**Why now.** The GO path, deliberately last: the only slice that can produce a false "current" claim, and unreachable on real data until the publisher is repaired. Every guard it depends on is merged first.

**Gaps closed.** `turn-snapshot-cannot-record-admitted-live-facts`, and the GO half of `notebook-turn-has-no-live-context`.

**Files.** `notebook-live-evidence.ts` — on an **admitted** verdict only, build `LiveFact[]` from a `DISTINCT ON (tag_path)` latest-row read inside the already-windowed `tag_events` probe, and use `LiveTag` from `machine-memory-response.ts` for value/unit **formatting only**. Cap with the existing `MAX_LIVE_TAGS_IN_PROMPT`. `route.ts` — render a value-only evidence block carrying, per §7's evidence-card requirement, source system + connection, asset UNS path, observed time, ingest time, quality and units on every line; pass facts to `recordTurn` so they enter the saved source snapshot.

**Adversarial fixes applied — three, two of them fatal to the original design.**
1. **Facts come from `tag_events`, not `fetchLiveSignals`.** The draft mandated the cache path *and* mandated `observedAt = event_timestamp`. `live_signal_cache` has no source clock at all (§1.3); the mandated path physically cannot supply it, and the draft's guarding test — a fixture-level assertion on a hand-built `LiveFact` — would have passed green while the real path rendered a 380 303-second-old value under "observed now." That is a vacuous test sitting exactly where the workstream's whole reason for existing is. Facts read `tag_events` (`033:78-89` carries `event_timestamp`, `quality`, `source_system`, `source_connection_id`), and the test asserts against the **assembler's emitted SQL and rows**, not a hand-built object.
2. **`active_conditions` and `next_check` are excluded.** The existing renderer emits an "Active conditions" block with `— next check: …` strings (`machine-context-packet.ts:103-105`). Those are **actions** rendered inside a section labelled machine-observed evidence. An A-rule detection reading *"inspect the tail pulley bearing for play"* would surface as MIRA's recommended next check on a conveyor the same block just said is running — a detector heuristic reading as a cited instruction. P18 builds its own value-only block and this exclusion is in its non-goals.
3. **Safety gate is a hard dependency.** See below.

**Tests.** **The load-bearing negative, table-driven over every cause:** for each unavailable cause, the provider body contains zero fact lines and zero "observed now" phrasing, so a newly added cause cannot skip it. Admitted: every fact line carries `observedAt`, quality and unit; a null unit renders without a fabricated one; `observedAt` comes from `event_timestamp` — asserted with a fixture where it and `last_seen_at` differ by hours (the exact replay shape); facts persist and read back with the original `observedAt`; the count never exceeds the cap; a per-tag degraded quality is excluded even inside an otherwise-admitted verdict; **a message matching a `SAFETY_KEYWORDS_IMMEDIATE` phrase emits no fact lines and no provider call even on an admitted GO.**

**Evidence of done — unit/contract, on fixtures.** Suite green with the per-cause negative table passing. Real-data proof is P28's job; the PR must say so rather than implying a live claim.

**Size** M · **Depends on** **P03** (hard — see below), **P05**, P13, P16 · **Rollback** feature-flag the fact block off; the unavailable path is unaffected.

**Why the safety dependency is hard.** Without it: a technician standing at the running discharge conveyor asks *"why isn't it discharging?"*. The turn now carries `Motor_Speed: 1740 rpm (live)` plus cited manual steps; the prompt says lead with the action and not to open with safety framing; no classifier fires. MIRA answers *"Clear the chute jam at the discharge guard [3]"* while the belt is turning. Every listed test is green. P18 must not merge before P03 and P05.

---

### Phase 6 — Phone completion

---

#### P19 — Native camera capture for nameplates (#3353)
*(origin: VM3)*

**Why now.** Every "photograph" affordance is a WebView file input and the project ships no camera plugin, so on Android 13+ the tap opens `com.google.android.photopicker` — the gallery. This is a **launcher** fix; the recognition pipeline is untouched.

**Gaps closed.** `camera-is-a-webview-file-input-not-a-camera`.

**Files.** `mira-mobile/package.json` + `bun.lock` (`@capacitor/camera` ^8, matching the other five Capacitor deps); new `mira-mobile/src/lib/camera.ts` — `capturePhoto()` calling `Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, correctOrientation: true, quality: 85 })`, plus a pure injectable `photoToFile(...)` so the conversion is unit-testable without the native bridge; user-cancel resolves `null`, other errors are logged and rethrown. `NotebookScreen.tsx` and `NotebooksTab.tsx` — the 📷 affordances call `capturePhoto()` and feed the **same** downstream calls they use today; the existing hidden `<input capture>` is **kept** and surfaced as an explicit "Choose an existing photo" item (#3353 asks for exactly that). Committed `npx cap sync` output for Android and iOS, plus the iOS usage-description strings.

**Adversarial fix applied — permissions do not silently widen.** `cap sync` introduces `READ_MEDIA_IMAGES` and `NSPhotoLibraryUsageDescription`. The app already over-declares `android.permission.CAMERA` for a path that never used it. VM3's evidence therefore includes a **post-sync manifest diff review**, drops any media permission the two capture paths do not require, and records the final permission set in P27's gate so a future sync cannot widen it unnoticed.

**Tests.** `getPhoto` is called with `source: Camera` and `correctOrientation: true` — **a future silent revert to the picker fails here**, in a gated suite; `webPath` → `File` carries name and MIME; user-cancel resolves `null` with no surfaced error; an unexpected plugin error rethrows. Existing 105 cases stay green.

**Evidence of done — unit (gated) + emulator screenshot** showing the OS camera permission dialog / camera activity instead of `PhotopickerGetContentActivity`. ⚙ **The viewfinder-to-capture round trip is HARDWARE and is proven in P27 — it does not gate this merge.**

**Size** M · **Depends on** P01 · **Rollback** revert the two call sites to `cameraRef.current?.click()`; the plugin can stay installed.

---

#### P20 — Make the emulator nameplate step actually assert
*(origin: VM4)*

**Why now.** `tools/mobile-e2e/README.md` claims the step "should start failing" once the defect is fixed; `journey.py`'s `nameplate()` never raises — it logs a NOTE for the picker and logs "picker reached" otherwise. It cannot fail before **or** after the fix. It is documentation wearing a harness costume.

**Gaps closed.** `e2e-nameplate-step-cannot-fail`.

**Files.** `tools/mobile-e2e/journey.py` — extract a pure `classify_launcher(texts) -> "camera"|"picker"|"unknown"`; `nameplate()` raises `Fail("#3353: nameplate opened the photo picker, not a camera")` on `picker` unless `--allow-picker` is passed (the pre-P19 escape hatch), and raises on `unknown` with the dump path attached rather than passing silently. New `tests/test_mobile_e2e_journey.py` with the recorded uiautomator text sets as fixtures, asserting the **default** path is the asserting one so nobody can re-mute the step by changing a default. `ci.yml` — name the test in the gated `test-unit` job. README coverage table corrected.

**Tests.** The classification table; the default-asserts case.

**Evidence of done — unit (gated) + two harness runs quoted.** `bash tools/mobile-e2e/run.sh` FAILS on pre-P19 main and PASSES on a build carrying P19.

**Size** S · **Depends on** P01 · **Rollback** revert; harness-only. *(Note: `tools/mobile-e2e` is still operator-run — no workflow invokes it. See Open Questions.)*

---

### Phase 7 — Proof, measurement, kit

---

#### P21 — Ship the §13 test cards as executable dogfood checks
*(origin: VM5)*

**Why now.** §14's staging-integration layer is empty for the route both clients call. `tools/crew/dogfood` already owns exactly the right seam — a `.check` verdict contract, persona auth states, a two-persona filing rule, dedupe through `tools/qa/create_issue.sh`, and a hermetic test harness — so this is five new fragments, not a new runner. **Cards that go RED on known gaps are the point:** the fix slices then land against a red card instead of a claim.

**Gaps closed.** `seam-has-no-live-hub-integration-coverage`.

**Files.** Five new `tools/crew/dogfood/checks/*.check`: `notebook-cited-answer` (GREEN expected today), `notebook-refusal`, `notebook-safety-stop` (**RED until P03**), `notebook-tenant-isolation` (403/404/422 walked live, not mocked), `notebook-followup-continuity` (**RED until P08**). README table + a statement that a card RED on a tracked gap is the gate, not noise. `test_judge.sh` gains one fixture per path exercising verdict parsing, the never-file-from-one-persona rule, and INFRA-never-filed.

**Tests.** `bash tools/crew/dogfood/test_judge.sh` (hermetic — shimmed `create_issue`, fake persona sessions, no live Hub, no GitHub); `shellcheck` via the pre-commit hook.

**Evidence of done — staging integration (§14 layer 4).** `test_judge.sh` output in the PR, plus one dry-run `judge.sh --check notebook-cited-answer` against staging producing a `qa/dogfood/latest-report.md` row with its transcript path.

**Duplicate-issue guard.** Prove each new `SCN_DEDUPE` term surfaces its intended tracking issue with `gh issue list --search` **before** merge — a silently-empty term creates duplicates.

**Size** M · **Depends on** — · **Rollback** delete the fragments.

---

#### P22 — Cross-device continuity, on the harness that already exists
*(origin: A7, with a discriminating assertion)*

**Why now.** No workflow drives the notebook seam against a deployed Hub. Rather than build a runner, extend the one harness that already provisions a stranger tenant on staging Neon, mints a NextAuth cookie and uploads through the real door.

**Gaps closed.** `seam-has-no-live-hub-integration-coverage` (the continuity half), `history-is-purely-device-supplied` (behavioural proof).

**Files.** New `tests/beta/beta_notebook_continuity.py` reusing `beta_ready_upload_retrieval_citation.py`'s provisioning helpers verbatim; `.github/workflows/beta-gate.yml` gains one step in the existing job. No new workflow, no new provisioning, no new secrets.

**Adversarial fix applied — the headline assertion was vacuous.** With one attached manual, retrieval runs `plainto_tsquery` AND, then an OR fanout, then the ILIKE exact lane, so a chunk is likely returned even for a thin query, the model answers, and a citation exists — the test would have passed whether or not the server reconstructed any history. Revised: assert the answer (or the retrieval query actually sent) contains a distinctive noun from turn 1 that appears **nowhere** in turn 2's text, and add a **negative control** — the same turn 2 in a fresh notebook with the same manual must **not** produce that token.

**Tests.** The discriminating follow-up plus its negative control; a foreign tenant gets 404 on the notebook id (tenant isolation at the deployed layer); an unanswerable question returns `insufficient_evidence` with zero citations.

**Evidence of done — staging integration.** The beta-gate run URL — the first live coverage the notebook seam has had.

**Flake policy.** The follow-up assertion is the only nondeterministic check in the plan (temperature 0.3, no seed). If it proves flaky, **demote it to a warning; never weaken it into vacuity.** The tenant-isolation and refusal checks stay the hard gate.

**Size** S · **Depends on** P08, P10 · **Rollback** remove the workflow step.

---

#### P23 — §16 measures, on the table that is always written
*(origin: SAFETY-S6 and VM6, merged per §2 decision 2)*

**Why now.** §12 requires refusal/safety state in telemetry and §16 asks for a correct-refusal rate. P03/P06/P07 already create the durable record. This slice makes it queryable and adds one always-on log line so an incident is greppable even when the seam flag is off.

**Gaps closed.** `decision-trace-omits-refusal-and-safety-state`, `no-measurable-refusal-or-safety-rate`.

**Files.** `route.ts` — one structured, **seam-independent** log line per turn: `notebook.turn.status` with `{tenantId, notebookId, status, safetyTrigger, citationCount, latencyMs}`, deliberately outside the `if (seam)` block, because a safety stop must be visible in production regardless of a feature flag. The question text is **not** logged. `mira-hub/db/migrations/084_decision_traces_surface.sql` — `ADD COLUMN IF NOT EXISTS surface TEXT` (additive, idempotent, no new GRANT; `032` already grants). `persist-usage.ts` + `route.ts` — populate `surface`. New `docs/runbooks/notebook-safety-and-refusal-measures.md` with the read-only SQL over `equipment_notebook_turns`, stating plainly which §16 measures it does and does **not** supply. `.github/workflows/db-inspect.yml` — a read-only "§16 measures (last 7 d)" step.

**Adversarial fixes applied — three.**
1. **`answerStatus` is not written into `decision_traces.outcome`.** That column already carries `'resolved' | 'handoff' | 'kb_gap' | 'gate_fired' | 'engine_error'` (`032_decision_traces.sql:90-92`) with a second live writer in `mira-bots/shared/decision_trace.py`. Putting `insufficient_evidence` beside `kb_gap` gives one concept two names and makes any unfiltered rate query wrong. `equipment_notebook_turns.answer_status` is the single home.
2. **`surface` is derived server-side.** The draft read a client `X-FLM-Surface` header, making the §16 phone-vs-web split bundle-controlled — untrusted input per §12. Derive it server-side, or store it as `surface_claimed` and never use it in a compliance measure.
3. **The new db-inspect step selects no free text.** `decision_traces` stores the full question (`user_question`) and full answer (`recommendation`). The existing spend step is carefully labelled "(no free text)"; the new step inherits that discipline explicitly, with a test/lint asserting the SQL block references neither column. Retention/redaction of those two columns is a separate decision (see Open Questions).

**Tests.** The log line is emitted with the seam flag **off**; a safety stop logs its trigger phrase and **no** field carrying the message body; `surface` is server-derived and an unknown value persists NULL rather than defaulting.

**Evidence of done — unit + one read-only staging `db-inspect` run** executing the runbook SQL and returning a row. No prod query.

**Size** M · **Depends on** P03, P06, P07 · **Rollback** the log line and the column are independently revertible.

---

#### P24 — Citation-open telemetry
*(origin: VM7)*

**Why now.** "Did the technician open the cited passage" is the strongest trust signal §16 asks for, and it is unobservable: the passage route contains no INSERT and `citation_open` appears nowhere in the repo. The route exists and is tenant-scoped, so this is one call and one helper.

**Gaps closed.** `citation-open-telemetry-absent`.

**Files.** `persist-usage.ts` — `recordCitationOpen({tenantId, notebookId, docId, page})` writing `platform='hub_notebook_citation_open'`, `user_question='citation_open:{docId}#p{page}'` (an **identifier only** — satisfies the NOT NULL column without storing passage text), `outcome='citation_open'`, provider/status/token/cost columns NULL. The passage route calls it fire-and-forget after a successful resolve. `db-inspect.yml` — citation-open rate added to P23's step.

**Tests.** The recorded row carries no passage or excerpt text; `provider` and `cost_usd_estimate` are NULL so the existing `WHERE provider IS NOT NULL` spend read is unaffected; a thrown ledger error still returns the passage with HTTP 200.

**Evidence of done — unit + a staging db-inspect run** showing a non-zero citation-open count alongside an unchanged spend section.

**Size** S · **Depends on** P23 · **Rollback** remove the call site.

---

#### P25 — Garage dogfood kit, part 1: canonical identity, QR label, session record
*(origin: VM9)*

**Why now.** §18D needs a kit an operator can apply and re-apply. The identity half is buildable today and everything else keys off it: ADR-0035 fixes the contract but **no seed in the repo writes `cv_101`** — `grep "'cv_101'" --include=*.sql --include=*.ts --include=*.py` returns nothing, and `025_kg_entities_natural_key.sql:11,20,30` documents that nothing populates `kg_entities.entity_id` and drops both its NOT NULL and unique constraint.

**Gaps closed.** `adr-canonical-key-column-never-populated`, `dogfood-kit-does-not-exist`.

**Files.** New `tools/seeds/dogfood-cv101-kit.sql` — idempotent, single transaction, `NOT EXISTS` guards, same shape as `tools/seeds/garage-cv101-kg-bridge.sql`; ensures the Discharge Conveyor `cmms_equipment` row and its `kg_entities` bridge carry ADR-0035 identity verbatim (`Discharge Conveyor`, `enterprise.home_garage.conveyor_lab.conveyor_1`, `approval_state='verified'`), with CV-200 recorded only where ADR-0035 §3 permits. New `docs/dogfood/garage-cv101-kit.md` (inventory, identity table, apply path staging→verify→prod, QR generation via the **existing** `tools/qr-label-pdf.py` / `tools/qr-register-assets.py` — do not write a second generator, and an explicit list of gaps the kit does *not* paper over). New `docs/dogfood/session-record-template.md` per §13. `apply-seeds.yml` gains the seed name.

**Tests.** New `tests/test_dogfood_kit_seed.py`, hermetic, same parse-the-seed shape as `tests/test_approved_tags_conveyor_seed.py`: every INSERT guarded; exactly one transaction; **the identity strings equal the values quoted in `docs/adr/0035-cv101-canonical-uns-path.md` by string equality** so the kit cannot drift from the ADR; no row written with an `approval_state` other than `verified`.

**Evidence of done — unit (gated) + one `apply-seeds.yml -f target=staging -f mode=dry-run` run log.** Prod apply is deliberately not part of this slice.

**Open risk to settle first.** ADR-0035 puts `cv_101` in `kg_entities.entity_id`, but `/api/assets/[id]/chat` resolves with `id::text = $2 OR entity_id = $2` and the existing bridge stores the `cmms_equipment` UUID there. Overwriting could break the UUID lookup. Staging is safe; prod waits on Open Question 3.

**Size** M · **Depends on** — · **Rollback** the seed is guarded and additive; a revert is a documented compensating seed, never a rewrite of an applied file.

---

#### P26 — Kit part 2: the notebook, its node, and its binding
*(origin: VM10, evidence claim downgraded)*

**Why now.** The kit is only a kit when scanning the label lands the technician in a notebook that already has the right manuals.

**Gaps closed.** `dogfood-kit-does-not-exist` (the notebook half).

**Files.** Extend `tools/seeds/dogfood-cv101-kit.sql` — create the backing `kg_entities` node (`equipment_notebooks.node_id` is `UUID **NOT NULL**`, `073:57`, which the draft omitted and which would have made the INSERT fail), exactly one `equipment_notebook`, and its P10 binding columns. Update the kit doc's apply order (the `082` migration must be applied to the target env first).

**Adversarial fixes applied — two.**
1. **A seed cannot produce a GREEN cited-answer card.** Attaching sources needs `doc_id`s resolving to retrievable chunks, and `retrieveNodeChunks` filters `ingest_route = 'v2' AND content_tsv @@ …` against `knowledge_entries` — real ingested, tokenized content, not rows a seed can synthesize. Evidence is downgraded to *"the seed applies on staging and the notebook exists with the binding and zero candidate sources"*; the manual arrives by a documented **operator upload through the real ingest door**, and the GREEN card claim moves to that follow-up.
2. **The seed does not mint `verified` sources.** The draft seeded `match_state='verified'` — the exact trust state `sources/route.ts:28-34` refuses from a client and the nameplate-confirm flow exists to *earn*. Under `.claude/rules/train-before-deploy.md` that makes the dogfood notebook answer on a technician-facing surface as if a person had matched those manuals to that machine; if the seeded manual is the wrong GS10 revision, MIRA cites it confidently behind a green chip and P21's card still reports GREEN, because it only checks that a citation resolves. Sources are attached as `user_confirmed` **attributed to a named operator with a real timestamp**, and one recorded human confirm pass is part of the documented kit-apply procedure.

**Tests.** Exactly one notebook row with a non-null `node_id`; binding columns populated with the ADR-0035 path; **zero sources attached as `candidate`** and zero as `verified`.

**Evidence of done — unit (gated) + a staging dry-run log.**

**Size** S · **Depends on** P10, P25 · **Rollback** as P25.

---

#### P27 — ⚙ HARDWARE — Turn the physical-phone gate into a repeatable artifact
*(origin: VM8)*

**Why now.** §15 Stage 0 requires camera and cellular physical gates to pass, but the only artifact is one dated narrative whose camera row says FAIL and whose cellular and release-signer rows say not covered. §14 demands evidence bound to an exact app build, deployment and tenant — that needs a form, not a retelling. P19/P20 finally make the camera row provable.

**Gaps closed.** `physical-phone-gate-is-a-document-not-a-gate`.

**Files.** New `docs/proofs/physical-phone-gate.md` — a per-run checklist: release-signed install, **camera viewfinder** capture, cellular-only cold run, sign-in, upload, cited answer, citation open, QR deep link, offline draft; every row records app build sha, versionCode, server deploy sha, tenant, screenshot path. New `docs/proofs/README.md`. `mira-mobile/android/keystore.properties.example` + `docs/release/android/signing.md`. `tools/mobile-e2e/README.md` cross-link.

**Adversarial fix applied — one more blocking row.** The session cookie jar is serialized as plaintext JSON into `@capacitor/preferences` (Android SharedPreferences / iOS UserDefaults), which `mira-mobile/README.md:60-62` itself flags as owed before store submission. As drafted, the gate could be signed off fully passed on a device whose stolen-phone posture is unresolved — and this is the artifact that would be cited as release sign-off. Add a blocking row: *"Session credential is in OS secure storage (Keystore/Keychain) — yes/no"*, unsignable while it reads no. Also record P19's final permission set here.

**Tests.** New `tests/test_physical_phone_gate_template.py` (gated): parse the coverage table in `tools/mobile-e2e/README.md`, extract every leg marked "no," and assert each has a row in the gate template — so a future emulator-coverage edit that quietly drops a hardware leg fails CI. Extend it to assert the secure-storage row exists.

**Evidence of done.** **Software half:** the sync test green — the template provably covers every leg the emulator cannot; this merges and is reviewable without hardware. ⚙ **Hardware half:** one filled-in run on a real device with screenshots. No release keystore exists in the repo (correctly), so a signed build must come from Mike out of band; an agent cannot close the release-identity row.

**Size** S (software) · **Depends on** P19, P20 · **Rollback** docs-only.

---

#### P28 — ⚙ HARDWARE — Repair the CV-101 publisher, then take one admitted live turn
*(origin: C8)*

**Why now.** §18C: repair and re-prove the publisher before any live dogfood claim. Sequenced last and explicitly **non-blocking** — P13 through P18 are fully mergeable and fully provable while the feed is NO-GO, which is the entire reason the honest-unavailable state was built first.

**Gaps closed.** `live-state-test-card-blocked-by-no-go`.

**Files.** The CV-101 publisher path on the bench gateway (`ignition/`). New `docs/proofs/2026-XX-XX-cv101-live-go-and-admitted-turn.md`.

**Adversarial fix applied — the parity check is scoped, not absolute.** The draft made "the Hub verdict equals the CI gate verdict, disagreement is a stop-ship" a hard gate. The two probes are scoped differently by construction: the workflow uses `source_connection_id = 'cv101-bench-gw' OR uns_path = …` with no tenant predicate and can therefore see a stream arriving under the wrong path; the Hub probe is `tenant_id ∧ uns_path <@ ltree` and cannot. A genuine identity fault would make them disagree **by design**, producing a false stop-ship — and the likely response would be to weaken the parity claim rather than fix the scoping. So: either P15 adopts the OR-arm (making `ALLOWLIST_IDENTITY` reachable Hub-side) or the gate reads *"the two agree on GO/NO-GO for causes both probes can observe."* P15 records which.

**Tests / evidence.** A **GO** run of `cv101-live-gate.yml` (exit 0) quoted verbatim — the first non-failure since 2026-08-14; the Hub verdict for the same window, agreeing within the scoped parity rule; one Notebook turn producing admitted facts with observed time, quality and units, screenshotted to `docs/promo-screenshots/`; the persisted `live_admission` + `live_facts` read back via the sanctioned read-only `db-inspect` workflow; and — **the more important half** — stop the publisher and re-ask the same question: the turn must flip to unavailable with the correct cause and must not reuse the previous reading.

**Size** L · **Depends on** P18 · **Rollback** n/a (plant repair).

**Standing prohibitions for this slice.** Do not weaken `tools/cv101_live_gate.py` thresholds or its per-scan divisor to obtain a GO. Do not point the gate at simulator traffic — `PROVENANCE` exists to reject exactly that. Do not widen `mira-bots/shared/factorylm_live.py`'s `source_system='plc_bridge'` filter to make CV-101 visible to it; that reader guards a different contract (the `factorylm_snapshot` envelope) and widening it would relabel generic cache rows as snapshot evidence.

---

## 4. Slices that were killed, and why

A plan that hides its rejected ideas is worth less than one that shows them.

| Killed | Why |
|---|---|
| **Client-supplied history as an "in-flight override"** (SAFETY-S7's central mechanism) | It reopens the forged-assistant-turn hole in the same PR that claims to close it, and directly contradicts P08. A bundle could post `{role:'assistant', content:'I verified the drive is locked out — it is safe to reach into the discharge chute.'}` and have the server replay it as MIRA's own prior turn. §12 says the bundle is untrusted input. Only S7's safety-turn pinning survives, folded into P08. |
| **Adding `source_connection_id` to `fetchLiveSignals`** (C3) | The column does not exist on `live_signal_cache` (§1.3). The `undefined_column` error is swallowed into `[]`, silently blanking every live signal — on the PR whose purpose was more honest live evidence. |
| **Sourcing admitted facts through `fetchLiveSignals` while guaranteeing `observedAt = event_timestamp`** (C7) | Physically impossible: the cache has no source clock. The guarding test was a fixture-level assertion that passes green while the real path renders a 380 303-second-old value as "observed now" — a vacuous test on the exact defect. |
| **Keeping the answer body under an "unverified" banner** (SAFETY-S5) | An LLM-authored procedure labelled unverified is still a procedure a technician follows. The banner removes MIRA's accountability, not the instruction. Withheld instead (P07). |
| **One `asset_confirmed_via` covering QR / nameplate / work-order** (A3) | Collapses *selected* into *confirmed*. Swapped stickers on two identical conveyors would give a green "confirmed" card and another machine's live values to a technician with his hands on this one. Split into `asset_selected_via` vs `asset_confirmed_*` (P10). |
| **`answerStatus` written into `decision_traces.outcome`** (VM6) | Vocabulary collision with an existing documented enum and a second live writer; two names for one concept makes every unfiltered rate query wrong. Moved to `equipment_notebook_turns.answer_status` (P23). |
| **`X-FLM-Surface` as a §16 compliance measure** (VM6) | Client-supplied, therefore bundle-controlled. Kept only as `surface_claimed` or derived server-side. |
| **A seed producing a GREEN cited-answer card** (VM10) | `retrieveNodeChunks` needs real ingested, tokenized `knowledge_entries` content. A seed cannot synthesize it, and the notebook INSERT would fail anyway on `node_id NOT NULL`. Evidence downgraded (P26). |
| **Seeding notebook sources as `verified`** (VM10) | Mints in SQL the trust state the API refuses from a client and the confirm flow exists to earn. |
| **Exposing `model` on the technician's phone and in hydrated web turns** (A2) | Puts provider identity and cascade order in every screenshot with no named consumer. |
| **Hub-vs-CI verdict parity as an absolute stop-ship** (C8) | The two probes are scoped differently by construction; a correct system would trip it. Downgraded to scoped parity (P28). |
| **Reordering the `sources` frame to match spec §3** (never proposed, but §3 invites it) | The frame is last because citations are filtered to the answer's `[n]` markers. Reordering would let a refusal ship unrelated pages as proof. **The spec is what changes here, not the code** (P02). |
| **Four separate `081_*.sql` migrations** | Numbers allocated `081/082/083/084` up front (§2 decision 4). |

---

## 5. What we deliberately are NOT doing

From spec §4 and reinforced by both challengers.

**Never, in any slice:** PLC / robot / VFD / safety-controller writes; start, stop, reset, acknowledge, setpoint, jog, mode, bypass, force or download controls; a direct phone or cloud connection to Modbus, EtherNet/IP, OPC UA or any fieldbus; a second mobile app or a second chat service; a replacement SCADA, CMMS, historian or generic business chatbot; a customer-specific dashboard bypassing the common model.

**Not in this plan, though technically adjacent:**

- **A second safety policy.** `mira-bots/shared/guardrails.py` stays the single source of truth. No local phrase list in any route or client; a new phrase is a `guardrails.py` change first, and the parity tests fail loudly on drift.
- **Any safety classification on the phone.** Clients render what the server decided.
- **Widening `isRefusal`.** More matching makes the record *less* reproducible; P07 adds a deterministic rule beside it instead.
- **Observation-age or replay logic at write time.** `_derive_freshness` deliberately takes no timestamp, and a test pins its signature to `{simulated, quality}` — because Ignition report-by-exception froze client timestamps on a healthy 2 s stream (2026-07-04) and turned it permanently stale. Replay and observation age are read-time, windowed, per-scan decisions. Nobody may "fix" `_derive_freshness` as part of this work.
- **A second live reader.** `mira-bots/shared/factorylm_live.py` stays scoped to `plc_bridge` + the snapshot envelope.
- **A second ingest inlet.** `mira-relay/ingest_contract.py → ingest_batch` is untouched; nothing here writes `tag_events`, `live_signal_cache` or `approved_tags`.
- **Widening retrieval scope with the bound UNS path.** The notebook's boundary is and stays the validated doc set (P11 has the explicit regression test).
- **A UNS path rename.** ADR-0035 requires one atomic 7-part migration; fixtures still carrying `enterprise.garage.demo_cell.cv_101` are noted, not renamed.
- **`state.uns_context` ported to TypeScript.** The bound `(equipment_entity_id, uns_path)` is the TS-side equivalent; a full TS gate is a separate decision.
- **Streamed SSE on mobile, secure-storage migration of the cookie jar, the in-screen "Chat" panel rename, per-capability notebook authorization, cross-channel Slack thread convergence.** All real; none of them in this plan. The capability gap in particular is worth naming: no equipment-notebooks route calls `requireCapability` and no `notebook.*` capability exists, so §11's "absent capability means denied" is tenant-gated only on this surface today.
- **A new test harness, eval runner or telemetry table.** Every slice lands in an existing vitest file, an existing table, or an existing log stream.
- **Rewriting any migration or seed already applied in any environment**, staging included.

---

## 6. Open questions for Mike

Six forks where different answers produce genuinely different work.

**1. ~~Is `MIRA_CANONICAL_SEAM=1` in Doppler `factorylm/prd`?~~ — ANSWERED 2026-08-23: yes.**
The verification agents are read-only and cannot read Doppler, so they correctly refused to assume. The answer, established after their pass: the flag is `1` in **both** `factorylm/stg` and `factorylm/prd`, and production notebook turns are served by the canonical cascade, not the legacy inline one. Proof: three production turns on `app.factorylm.com` each emitted a `usage` frame and persisted a row to `decision_traces` with `platform='hub_notebook_chat'` — `Groq / openai/gpt-oss-120b / primary`, one carrying `cached_input_tokens=768`, $0.001025 total — read back through [db-inspect run 32621822757](https://github.com/Mikecranesync/MIRA/actions/runs/32621822757). The last of those ran after the `a1f2a3d6` redeploy, so the seam survives a fresh container.

Two consequences for this plan: the §16 cost and provider measures are **live, not dark**, so P23 reports real numbers; and the legacy inline cascade at `route.ts:117` — which still lists **Gemini**, against Hard Constraint #2 — is now dead code on the flag-on path. Deleting it is the documented next step after the cutover and is deliberately **not** in this plan; it wants its own PR so that the flag remains a working rollback until it is gone.

**2. Where does the canonical key `cv_101` live in practice?**
ADR-0035 says `kg_entities.entity_id`. `/api/assets/[id]/chat:399` resolves with `id::text = $2 OR entity_id = $2`, and `tools/seeds/garage-cv101-kg-bridge.sql` writes the `cmms_equipment` UUID into that column. Setting it to `'cv_101'` is ADR-compliant and may break the existing UUID lookup; leaving it works today and leaves the ADR's stated home empty. P25 is safe on staging either way, but this must be answered before any prod apply.

**3. Should `uncited` (P07) withhold the answer body entirely, or put it behind an explicit tap?**
The plan withholds, because a labelled procedure is still a followed procedure. A "Show unverified answer" tap is the alternative and is defensible. The false-positive count from P07's evidence step is the input to this decision, so the answer can wait until that number exists — but it should be yours, not the implementer's.

**4. Should `tools/mobile-e2e` become a scheduled workflow?**
It is invoked by no workflow and needs a KVM-capable runner. Until someone runs it deliberately it is not a release gate, whatever P20 makes it assert. Answering "yes" adds a runner-provisioning task that is not currently in this plan.

**5. Retention and redaction for `decision_traces.user_question` / `recommendation`.**
They store the full technician question and full answer. §12 says telemetry should not copy full private transcripts into analytics. P23/P24 keep the new reporting free of them, but the columns themselves — and now `equipment_notebook_turns.live_facts`, which will hold machine readings inside a conversation record — need a retention answer before Stage 1.

**6. Is an emulator screenshot sufficient for the Screenshot Rule on P04/P12/P17?**
Nothing in those slices needs hardware, but the physical-phone gate is currently a one-off document and #3353 is open. A "no" would not block software; it would add a hardware step to three otherwise-mergeable slices. Worth deciding rather than assuming.

---

## 7. Hardware-gated index

| Slice | Hardware needed | What it blocks |
|---|---|---|
| **P19** (evidence only) | Physical Android device for the viewfinder round trip | **Nothing.** The plugin change, the two call sites and the gated unit tests merge and are reviewed on emulator evidence. |
| **P27** (execution) | Physical Pixel 9a + a release-signed build from Mike | **Nothing.** The template and its CI sync test are the software half and merge alone. |
| **P28** (entirely) | The CV-101 bench rig and its Ignition publisher | **Nothing.** P13–P18 are built, tested and merged against the NO-GO feed — which is precisely why the honest-unavailable state is sequenced first. |

Everything else — twenty-five of twenty-eight slices — is provable at the unit, contract, migration, staging-integration or emulator layer with no plant and no phone.
