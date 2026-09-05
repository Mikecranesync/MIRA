# Gate 0 Discovery — Summary & Index

**Date:** 2026-08-15 · **Program:** `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`
**Method:** 12-agent module scan (map) + 10 parallel read-only explorer agents + 1 identity probe, all evidence file:line-cited; deterministic measurements via scc. **No repo code was modified** — this PR is docs + registry only, per "Gate 0 is read-only".

![Codebase map](2026-08-15-codebase-map.png)

## Deliverables (§16 checklist)

| § | Deliverable | Where | Status |
|---|---|---|---|
| 1 | Architecture Registry | `REGISTRY.yaml` (80 modules, machine-generated sizing + scan purposes + declared-state citations) | ✅ seed |
| 2-3 | Dependency graphs (source/runtime/DB/queues/deploy) | woven through `DRIFT_REPORT.md`, `DUPLICATE_CAPABILITIES.md` §5, `ASSET_IDENTITY.md`; full agent output archived in session workflow journal | ✅ findings-level |
| 4 | Declared-vs-observed drift report | `DRIFT_REPORT.md` — 6 confirmed, 3 drifted, 1 stale | ✅ |
| 5 | Semantic duplicate report | `DUPLICATE_CAPABILITIES.md` — 4 families | ✅ |
| 6 | Canonical ownership decisions | `OWNERSHIP.md` — proposed, needs Mike's ADR ratification | ⏳ proposed |
| 7 | Executable architecture contracts | CU-06 in backlog (not yet built — implementation, so post-Gate-0) | ⏳ planned |
| 8 | Ranked migration backlog | `BACKLOG.md` — 10 units, sequenced | ✅ |
| 9 | Personal SWE-Bench starter set | `SWE_BENCH_SEED.md` — ~30 cases, 10 categories | ✅ seed |
| 10 | One evidenced pilot migration | CU-P1 ✅ DONE (PR #3249, v3.273.2) — full gate walk incl. a round-1 adversarial BLOCK on a real defect, fixed and re-passed; record in `units/CU-P1.md` | ✅ |

## The five headline discoveries

1. **Asset identity is bifurcated 5 ways** (`ASSET_IDENTITY.md`) — the product-spine invariant "same canonical asset identity throughout" is not yet true. This is the flagship convergence program (CU-05), deliberately sequenced last.
2. **The §4 ownership split describes layers, not repos** — MIRA owns both industrial truth and intelligence today; factorylm repo is cluster-infra + frozen 2026-03 predecessors; zero cross-repo runtime calls. Convergence is about truth/code ownership, not untangling a live distributed system.
3. **The mobile app is architecturally clean** — pure consumer of 12 canonical Hub endpoints, fail-closed auth (it even avoids Hub's own `role ?? 'owner'` fallback) — with exactly **one** contract drift: the asset-tag grammar. That drift is small, real, and on the product spine → chosen as the pilot (CU-P1).
4. **Apparent duplication mostly collapses under evidence** — 5 "PLC parsers" are one canonical per distinct job; 3 sim lineages reduce to SimLab canonical + bench standalones + dormant legacy. The genuinely dangerous duplicates are the frozen factorylm bot/engine predecessors (strangulation, CU-04).
5. **Two standing write-path gaps in knowledge ingestion** (is_private hardcoded false in `insert_chunk`; no sources.yaml validation in `ingest_url`) — already partially known to the rules docs, now scheduled as CU-03 with xhigh review.

## What needs Mike (the human gate)

1. **Approve this Gate 0 PR** — merging it makes the doctrine + registry canonical repo content.
2. **Ratify OWNERSHIP.md** as ADRs (esp. "factorylm repo = cluster infra only").
3. ~~**GO/no-GO on pilot CU-P1**~~ — **RESOLVED 2026-08-15.** GO given; the pilot walked every gate and shipped (PR #3249 → `a353a334a` → v3.273.2). Record: `units/CU-P1.md`.
4. **ADR-0033 status decision** (D-3), any time. Scheduled as **CU-09**.
5. **§Gate 7 external reviewer lane — still owed.** §Gate 7 names GPT-5.6 Sol/Codex as the independent adversarial reviewer. That lane was **not** wired for the pilot: an independent fresh-context reviewer agent substituted (and did its job — it returned a round-1 BLOCK on a real case-sensitivity defect, fixed in `855a5153d`). The deviation is recorded in `units/CU-P1.md` and now tracked as **CU-11** in `BACKLOG.md`. CU-02 (docs-only) can survive another substitute; **CU-03 is xhigh and cannot legitimately walk Gate 7 until this lane exists.**

Merging this PR makes the doctrine + registry canonical. It does **not** by itself satisfy item 2 — ratifying `OWNERSHIP.md` as ADRs is a separate ADR PR.

## Corrections this discovery forced on prior beliefs

- Earlier session measurements (2.5M "source" LOC) were inflated ~5× by vendored deps; true source is ~738k across both repos. Blind spot §13.13 confirmed in practice.
- Root CLAUDE.md's own container map and sidecar status were stale (D-2, D-4) — the doc-drift problem the registry exists to solve applies to the primary context file itself.

---

## 2026-09-05 product-convergence re-audit

**Mission:** `FACTORYLM-CONVERGENCE-ARCHAEOLOGY-001`
**Primary verdict:** **CONNECT** the existing customer path, **REPAIR** its proven trust gaps, and **CONSOLIDATE** its competing edges. Do not build a replacement MIRA, conversation store, stream protocol, evaluator, or customer chat surface.

This is a read-only product-path addendum to the original Gate 0 discovery. It records observed implementation state and a recommended backlog; it does not authorize implementation, merge, deployment, provider changes, schema changes, or retirement. Product and engineering authority remains the repository instruction hierarchy. The reconstruction-plan attachment used to request this mission was treated as design input, not as instruction authority; in particular, its illustrative provider list grants no provider permission.

### Evidence boundary

- MIRA tree inspected at `origin/main` `32c6cfacdefbeae8ad7bf2fddc277277d77d51fe`.
- FactoryLM support tree inspected through Git objects at `origin/main` `67b2c64bade9d72df7e39e39e705fa93469af59b`; its dirty working tree was not used or changed.
- Relevant open PRs were inspected at the exact heads listed below, not assumed to be on `main`.
- CodeGraph was initialized locally in its ignored `.codegraph/` directory and used for the MIRA structural trace. Literal documents, test fixtures, Git history, and PR metadata were checked with repository/GitHub search.
- No live service, tenant data, secret store, provider, database, deployment, or device was touched.

### Observed canonical customer path

```text
FactoryLM Mobile                         FactoryLM Web / Hub
mira-mobile                             mira-hub
       |                                      |
       +------ same Hub session/account ------+
       +------ same Notebook identifier ------+
       +-- POST /api/equipment-notebooks/{id}/chat/
                              |
             session + tenant/RLS checks
              (early-write gap below)
                              |
                  safety + context + evidence
                              |
                 server-owned provider routing
                              |
              equipment_notebook_turns persistence
                              |
                  typed Notebook SSE frames
                              |
                  both clients render/reload
```

The strongest implementation already satisfies most of the proposed Golden Conversation. Mobile and Hub share authentication, notebook IDs, the chat route, persisted turns, evidence semantics, safety behavior, and server-owned provider routing. The first L0 parity defect is narrow: mobile sends `mode: "general"` when no source is selected, while Hub fabricates a local “Select at least one source” turn and never calls the server. This audit also found two separate trust gaps: the zero-source safety branch can persist a turn before Notebook ownership is proved, and Notebook REPLAY accepts a client-supplied asset ID without proving it matches a confirmed Notebook binding.

### Convergence matrix

| Capability | Observed mobile | Observed web / Hub | Shared authority or competing path | Verdict and canonical action |
|---|---|---|---|---|
| Account and tenant | `mira-mobile/src/api/resources.ts` signs in through Hub and reads `/api/me`; the API client fails closed on auth | Hub NextAuth/session context | `sessionOr401` and tenant/RLS scoping generally hold, but the zero-source safety branch calls `recordTurn` before a tenant-scoped Notebook lookup; `equipment_notebook_turns` has no Notebook foreign key | **KEEP** the shared account/RLS model; **REPAIR** ownership proof before every early response or write |
| Customer entry point | Five-tab shell; Notebook is the `chat` tab and app currently defaults to Work Orders | `/hub` redirects to Feed; Notebooks are reachable through Hub navigation | No server concern | **REPAIR later** so MIRA is immediately reachable without deleting device-appropriate navigation |
| Conversation container | Equipment Notebook list and detail | Same Equipment Notebook list and detail | `equipment_notebooks`; the notebook UUID is today's effective thread ID | **KEEP for the first slice**; do not create another store |
| New general conversation | Requires creating/naming an unbound notebook before chatting | Requires creating/naming an unbound notebook before chatting | Existing create route requires `displayName`; no first-class general-thread kind or uniqueness rule | **FINISH after a product decision** on personal versus tenant-shared general history |
| Text chat API | `askNotebook` posts to the Notebook chat route | `postNotebookChat` posts to the same route | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | **KEEP** as the one customer conversation seam |
| L0 general help | Sends `mode: "general"` when selected source scope is empty | `NotebookChat.sendText` blocks locally when `enabledDocIds` is empty | Server already owns and tests source-free general mode | **CONNECT** Hub to the existing server behavior; no new backend |
| History and reload | Reads Notebook turns and sends bounded prior history | Reads the same turns and sends bounded prior history | `equipment_notebook_turns`, `recordTurn`, and `listTurns` | **KEEP** for Golden-path continuity; separately evaluate accepted-user-turn persistence |
| Streaming contract | Incremental parser, with honest buffered-device limits and truncation handling | Incremental parser with the same terminal-status rule | Typed frames in `mira-hub/src/lib/notebook-chat-types.ts`: `content`, `sources`, `evidence`, optional `usage`, `status`, optional `followups`, `safety`, `[DONE]` | **KEEP and extend only additively**; do not introduce the attachment's parallel event vocabulary |
| Evidence and citations | Renders source, general-basis, visual, and machine evidence | Renders the same persisted/streamed evidence families | Server validates source scope, citations, provenance, and evidence basis | **KEEP** server authority and both thin renderers |
| Safety | Renders persisted/live safety notices and treats truncation as non-answer | Same | The shared classifier stops before retrieval/provider use, but the zero-source branch mistakes `no_sources_selected` for Notebook ownership and can persist an own-tenant orphan turn for an arbitrary valid UUID | **KEEP** one safety brain; **REPAIR** with a tenant-scoped Notebook lookup before the early write and a zero-source + safety + unknown-Notebook regression |
| Attachments | Existing PDF/photo/nameplate and LOOK flows attach to a Notebook | Existing Notebook PDF upload and source inspection | Shared file, Notebook-source, and visual-evidence services | **CONNECT later** around the same Notebook; do not build a second attachment system |
| Asset identity | Can bind a Notebook and send visual/machine riders | Displays the binding and persisted evidence, with less capture/select functionality | The server re-resolves tenant-scoped assets and machine rows, but `machineEvidence.assetId` is not matched to the Notebook binding and `confirmedAt` may be null; prompt wording is the only confirmation warning | **REPAIR before asset/history/live claims:** require a confirmed server binding and match the requested evidence asset to it; preserve unbound L0 |
| Machine history | Mobile can select REPLAY evidence | Hub renders persisted machine evidence but has no equivalent selector | Server re-resolves tenant-scoped evidence | **CONNECT later**, preserving live-versus-recorded semantics |
| Tools | Technician tools exist in other MIRA paths; Notebook does not expose a complete tool-event lifecycle | Same | Tooling is fragmented across pipeline/bot/workflow code | **CONSOLIDATE later** into additive Notebook events; do not fork per client |
| Provider routing | No direct provider key/call in the canonical mobile path | No direct provider key/call in the canonical Hub Notebook path | Notebook owns the current server seam, but its Groq/Cerebras/Together cascade and legacy Gemini fallback conflict with the base root `AGENTS.md` allowlist | **REPAIR governance before calling any provider approved**; Golden UI work must not change provider configuration or treat observed runtime as authorization |
| Commercial web | Not applicable | `mira-web` remains useful for marketing, signup, billing, and activation | Its legacy `/api/mira/chat` path calls `mira-pipeline` directly and uses a different/non-current browser contract | **KEEP commercial duties; RETIRE/redirect customer chat only after replacement proof** |
| Design language | `mira-mobile/src/tokens.css` uses mobile FactoryLM tokens | `mira-hub/src/app/globals.css` uses a different token vocabulary/scale | `docs/design/factorylm-tokens.css` is guidance, not a consumed shared package | **CONSOLIDATE after functional parity**; do not create a cross-runtime component library merely for sameness |
| Outside-in proof | `tools/mobile-e2e/` drives a real Android emulator through sign-in, Notebook, upload, answer, and citation; it does not yet prove post-answer reload | Hub has authenticated Playwright Notebook loop/adversarial/visual suites | No single frozen scenario currently drives both and compares their server truth | **CONNECT** both drivers to one scenario/result contract and add the missing mobile reload/cross-client leg |
| Answer Radar | No client-specific grader should be created | No client-specific grader should be created | PR #3584 has the stronger freeze/schema/reporting machinery, but excludes `UNS_GATE` from its denominator and runs through `LocalPipeline`; PR #3589 duplicates its schema/rubric/scorer without Foreman registration | **REPAIR then CONSOLIDATE:** make source-free L0 gating a failure, adapt #3584 to the canonical Notebook seam, and have Foreman invoke that one evaluator |
| Slack / Foreman | Not a customer brain | Not a customer brain | Existing mission loop/Fleet Gateway are internal control-plane seams | **KEEP internal**; consume canonical MIRA/eval services rather than reimplement them |
| FactoryLM support repo | No customer UI authority | No customer UI authority | Current `factorylm` contains cluster operations and a versioned machine-snapshot producer; prior convergence records classify older product-shaped chat/bot code as legacy, while some root docs still present services as active | **KEEP support contracts; verify live consumers before retirement and do not revive a second product backend** |

### Competing implementations and open-PR collisions

| PR | Exact head inspected | Disposition |
|---|---|---|
| #3595 | `6f2c29b662c7a9ee91108d7936277cabb58bfb3b` | Governance baseline. Land or rebase dependent documentation onto it; do not duplicate its authority stack. |
| #3587 | `8e9e0e5cd1813b4bb93a8287f980584bfb415dba` | Valuable product-direction history but overlaps the root resolver and older North Star files. Consolidate after #3595 rather than merging two active authority models. |
| #3514 | `9cc9e366a53b5dc3ba9675582b34a39305f37454` | Contains useful proposed ADR-0038/0039 and conversation-contract material. Much of its implementation inventory is now stale because later PRs landed. Repair/rebase the durable contract; do not copy it into a second protocol document. |
| #3584 | `2bbecdbecba3c39339012e203de7118021c648b1` | Keep its freeze/schema/reporting core only after repairing two product mismatches: `UNS_GATE` currently leaves the correctness denominator despite L0, and `LocalPipeline` does not exercise the canonical Notebook route. Also resolve its `tests/eval/local_pipeline.py` collision with #3585 and recorded path/error-handling items. |
| #3589 | `9fdfb61736da6767b70695fbda7c658a91a65579` | Salvage Foreman mission intent, not its duplicate schema/reviewer/scorer stack. It is not registered in the existing Foreman mission loop or Fleet Gateway. |
| #3593 | `b069f1719825f785d845cc9996ff46eb2ac297a7` | Duplicates the existing `mira-bots/foreman/specialists/repo-archaeologist.md` role with a new standing agent/skill. Consolidate the richer search protocol into the existing role if wanted. |
| #3521 | `9395f89112465f8c4475c5886bd8f7fd9b80166e` | Directly edits `notebook-chat-utils.ts` and its tests. Rebase or salvage its safety-history fix before the proposed web L0 parity edit. |
| #3542 | `27ec496926d9117930210bf80c31b6447971473c` | Directly edits the same utility and tests for reload error copy. Resolve with #3521 and current `main` before touching that file. |
| #3300 | `0c2b62e3b35b4c22e9f467ec7a17f29eba59064f` | Broad channel-workflow implementation with high overlap in chat, identity, files, and Notebook code. Do not use it as the Golden Conversation foundation without a fresh, narrow salvage audit. |

Other open stacks that touch Notebook, mobile chat, or shared presentation must be rebased or sequenced before implementation: #3557/#3563 (source directive/photo vision), #3521/#3542 (Notebook utility/history semantics), #3531/#3545 (AssetChat/NodeChat retry and token cleanup), and #3515/#3454 (assistant adapter/device streaming). Their existence is a reason to keep the first implementation slice narrow.

### Canonical pieces to keep

1. `mira-hub` as the customer web application and server authority; `mira-mobile` as its device-appropriate client.
2. Equipment Notebook UUID as the initial shared conversation identifier and `equipment_notebook_turns` as the initial durable history.
3. The authenticated Notebook chat route, typed additive SSE dialect, and server-owned policy seam, after repairing the early Notebook-ownership write and confirmed-asset gaps. Provider authorization remains unresolved governance, not an implementation fact.
4. The existing mobile and Hub renderers, parsers, evidence cards, and outside-in harnesses, repairing parity rather than replacing them.
5. `mira-web` for commercial duties, while treating its old chat path as non-canonical.
6. PR #3584's frozen-question/schema/reporting machinery after its L0 and adapter semantics are repaired, plus the existing Foreman mission-loop/Fleet Gateway seams.

### Smallest Golden Conversation path

The next implementation should be a narrowly reversible **L0 trust-and-parity** sequence, after the governance baseline and collision owners are reconciled:

1. First prove the tenant-scoped Notebook exists before either early safety persistence or general provider use. Add a regression showing a valid unknown UUID plus zero sources plus a safety trigger returns not-found and creates no turn; a known own-tenant Notebook must retain the shared safety stop.
2. Add optional `mode: "general"` to the existing Hub Notebook `ChatBody`.
3. When `enabledDocIds` is empty, send the existing chat request with `mode: "general"` instead of creating a local refusal turn.
4. Update only the web empty-state/copy and focused unit/route/E2E assertions needed to prove a source-free answer is server-owned, carries `general_reasoning`, has no invented citations, persists, and reloads.
5. Reuse the existing unbound Notebook for the proof. Do not add a schema or auto-provisioning rule in that PR.
6. Repair #3584 so a source-free general question that receives an asset/UNS gate fails the L0 evaluation, and replace its `LocalPipeline` adapter with the canonical Notebook route before using it as this product gate.
7. Freeze `Why would a motor contactor chatter?` through that repaired contract, then have the existing Hub Playwright and Android-emulator drivers exercise the same account and Notebook. Add the missing mobile reload/cross-client leg. Compare persisted turn/evidence state rather than demanding byte-identical prose or identical pixels.
8. Grade the shared result for intelligence, evidence, safety, function, aesthetics, performance, and mobile/web parity. Foreman may orchestrate that run only by invoking the retained evaluator; it must not own another rubric.

This is **CONNECT/REPAIR**, not BUILD: mobile and the server already implement L0, and both clients already share persistence. The smallest safe work is one server ownership-ordering repair followed by removal of one web-only block, with contract-shaped tests; neither needs a new backend.

Before any later slice consumes machine history or live state, add a separate fail-closed repair that rejects evidence for an unconfirmed or mismatched asset without blocking ordinary L0 questions. That trust repair is not hidden inside the web L0 PR.

### Decisions intentionally deferred

- Whether a first-class general conversation is personal to a user or shared with the tenant. Current Notebook listing is tenant-scoped, so silently auto-provisioning a “personal” thread without a schema/access decision would be unsafe.
- Whether independent user and assistant message rows are needed beyond the current paired Notebook-turn row. Preserve current history until the canonical conversation ADR is approved.
- Provider authorization. At the audited base, root `AGENTS.md` permits Anthropic/Neon plus a narrow Together exception while lower documentation and the Notebook runtime name Groq, Cerebras, Together, and a legacy Gemini fallback. Governance must reconcile that conflict; this audit approves none of those paths and the Golden UI slice must not change them.
- Product-shell/nav changes that make MIRA the immediate home, including whether the mobile five-tab shell remains. Prove the shared conversation before changing both information architectures.
- Attachment, asset, machine-memory, and tool-event parity beyond the frozen general question.
- Design-token/component consolidation. Measure the Golden surface first; keep mobile and web implementations device-appropriate.
- Deletion of `mira-web` chat, AssetChat, NodeChat, legacy bot/provider paths, or FactoryLM legacy code. Replacement proof and a separate human-approved retirement unit are required.
- Merge, deployment, production evaluation, paid-provider use, database migration, or live-device proof.

### Proof required for the next implementation PR

- Existing Hub route tests for general mode, tenant boundaries, safety stop, approved-source scope, stopped-turn persistence, and canonical provider seam remain green.
- Focused server tests prove zero-source safety requests establish own-tenant Notebook ownership before persistence, and that a valid unknown Notebook UUID produces no orphan turn and no provider use.
- Focused Hub component/utility tests prove zero-source sends serialize `mode: "general"` and never synthesize a client answer.
- Hub outside-in test proves the frozen question reaches the server, renders general-basis labeling with zero citations, persists, and survives reload.
- Existing mobile SSE, composer, Notebook history, safety, and request-stream tests remain green; the emulator path exercises the same frozen question without changing its server contract.
- Focused server tests prove unconfirmed, unbound, foreign, and mismatched asset/history/live requests fail before evidence retrieval or provider use, while an ordinary L0 question still answers generally.
- The converged Answer Radar report counts an asset/UNS gate as an L0 failure for the frozen general question, records both client runs against exact source/build SHAs, and does not claim visual, device, or production proof it did not actually execute.
