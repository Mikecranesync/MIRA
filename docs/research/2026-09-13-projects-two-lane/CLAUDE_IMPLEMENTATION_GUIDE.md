# Claude implementation guide — Projects and two-lane MIRA

Date: 2026-09-13. Repository: `Mikecranesync/MIRA`. Research publication: [PR #3791](https://github.com/Mikecranesync/MIRA/pull/3791).

## Goal

Complete two connected capabilities in the existing V7 experience:

1. **Projects work predictably:** create/open a project, start/resume its chats, manage Sources and Instructions, use drawers/menus, and return without losing work.
2. **Answers show what supports them:** useful general maintenance reasoning before documentation is available; supported equipment facts from manuals, photos, and other admissible evidence once available.

The shared end-to-end outcome is: **ask generally → organize into a project → add evidence → get a cited answer → inspect the source → leave → resume the same work on phone or web**.

This document guides implementation when assigned. The current user request authorized publication of this research and guide; it does not itself authorize runtime changes, merging, deployment, destructive retirement, or phone installation. Honor any separate explicit authorization already present in your active session without asking for it again.

## Read in this order

1. Current root `AGENTS.md` and the applicable directory instructions. Follow the current repository ownership and review rules; reconcile stale summaries against code and explicit owner decisions.
2. [Projects interaction research](FactoryLM-Projects-Next-Build-Brief.md), especially sections 2–7.
3. [Two-lane assessment](TWO_LANE_RESEARCH.md), including its evidence ledger and specification corrections.
4. Existing canonical UI/cutover contracts and [#3787](https://github.com/Mikecranesync/MIRA/issues/3787), with [#3788](https://github.com/Mikecranesync/MIRA/issues/3788), [#3790](https://github.com/Mikecranesync/MIRA/issues/3790), and [baseline PR #3789](https://github.com/Mikecranesync/MIRA/pull/3789).

Read the relevant current diff rather than assuming an open PR is needed or that a merged PR works in the deployed build. Research code pin: `b5bcc102c3b46eb3cafa2afb44a74a74716a6e44`. Baseline PR pin: `38fd56e1c301111d964902b3be45c58c711da335`. Refresh both before implementation.

## Phase 0 — establish one implementation map

Inspect main, active claims, open overlapping PRs, shared shell, platform adapters, project/thread IDs, Sources, Instructions, and the actual answer-serving path. Use an isolated worktree and bounded branch under the current coordination protocol. Do not interfere with other sessions or take over an active claim.

Create a compact table with: requirement; REUSE/CONNECT/REPAIR/NEW; existing file/symbol/API; current owner/PR; smallest missing delta; acceptance test. Record the exact base SHA and verified runtime build separately. Code being present is not proof it is connected or deployed.

Reuse leads observed during research:

| Area | Inspect before adding work |
| --- | --- |
| Shared UI and contracts | `packages/factorylm-ui`, `packages/factorylm-interaction`, `packages/factorylm-theme`, and their existing host adapters. |
| UI policy and parity | [#3748](https://github.com/Mikecranesync/MIRA/pull/3748), [#3749](https://github.com/Mikecranesync/MIRA/pull/3749), [#3758](https://github.com/Mikecranesync/MIRA/pull/3758). |
| Earlier Projects/mobile work | [#3750](https://github.com/Mikecranesync/MIRA/pull/3750), [#3751](https://github.com/Mikecranesync/MIRA/pull/3751), current main, and [#3784](https://github.com/Mikecranesync/MIRA/pull/3784). Do not reintroduce earlier side-by-side app packages or UI switches. |
| Evidence and lifecycle | Existing `general_reasoning` frames, persisted basis, `basisKind`, [#3690](https://github.com/Mikecranesync/MIRA/pull/3690), [#3696](https://github.com/Mikecranesync/MIRA/pull/3696). |
| Photo evidence | Stored observations and source links; [#3557](https://github.com/Mikecranesync/MIRA/pull/3557), [#3563](https://github.com/Mikecranesync/MIRA/pull/3563), and #3788. |
| Safety and evaluation | Existing safety classifier, typed SSE route, `/evals` and mobile/browser E2E harnesses; #3785–#3790. |

Do not create another UI shell, chat store, evidence ontology, provider cascade, safety system, or evaluation framework. Add only missing behavior to the canonical components. Preserve existing IDs, history, tenancy, and source provenance. Keep a single writer for the shared-core lane as the repository requires; the two tracks below are scopes, not permission for competing agents to edit shared files.

## Phase 1 — reconcile the contracts

Record these implementation decisions in the existing canonical issue/spec records within your authorized scope:

- Reuse `general_reasoning`; the proposed `general_knowledge` value matches the current mobile adapter's OEM heuristic. Prefer explicit enum mapping. Unknown values must not become a stronger evidence claim through substring matching.
- A project has chats, shared Sources, and Instructions. A machine link is optional. General chat works before setup. User-facing notebooks do not become a competing navigation system.
- Selecting a project navigates; moving a chat changes membership through a separate explicit action. Project New chat preserves the project; global New chat is general.
- Shared project sources and chat-only attachments remain distinct. Retrieval honors the currently authorized scope, not all files the user could theoretically access.
- Two visible answer lanes preserve existing detailed bases for photos, workspace files, history, and live evidence. A source badge is not a guarantee of safety, truth, equipment identity, or authorization.
- General explanations remain fluent. Unsupported exact fault meanings, model-specific values, and repair/reset steps do not become acceptable merely by adding “usually” or a disclaimer.
- A completed-answer guard must run before its content is exposed. Do not silently add a final check behind a stream that has already displayed the answer.
- Preserve explicit manual-only requests. When a general explanation accompanies supported facts, label the sections separately and cite only the supported claims.

Do not use this research as an excuse to rewrite unrelated policies. Reconcile an actual conflict in the smallest canonical location and record the reason.

## Track A — Projects implementation

### A1. Capture the missing reference states

Use the 15-state checklist in the Projects research: signed-in sidebar/project expansion, all-projects/search, create, empty/populated project, overflow, Sources, preview, Instructions, thread/move menus, phone drawer, keyboard, and Back behavior.

Use an authorized signed-in session. The bundled images show only the signed-out desktop shell. Record OBSERVED, DOCUMENTED, PROPOSED, or BLOCKED for each state. Mobile web/emulation must not be labeled native Android. Inspecting menus does not require deleting, sharing, or moving real user work. Do not commit private chat/file content into a public screenshot pack.

If reference access is missing, record the gap and continue with the documented FactoryLM defaults; never fabricate a screenshot or keep the whole build waiting for Figma or login.

### A2. Finish the core project path

Deliver create/open project → create two separate chats → list/resume them → add a shared source → edit/save project instructions → reload/relaunch. Reuse project/thread/source APIs; prove canonical IDs survive.

The project home is a conversation workspace with recent chats and secondary Sources/settings controls. Use the shared desktop sidebar and responsive phone drawer. Implement project overflow, instructions editor, Sources list, upload state, and source preview. Every surface has a clear close/return route.

### A3. Complete navigation and organization

Implement or connect rename, scoped search, move chat, pinning, and supported archive behavior. Expose only operations that the backend can complete honestly. Permanent project deletion is not a dependency for the first useful slice.

Preserve draft text, pending attachments, selected thread, and reading position while opening/closing panels. Escape/outside click dismiss menus; modal focus returns to its trigger. Check native Back/keyboard event ordering on the actual host. No screen requires force-close to escape. Use keyboard-safe layout, existing tokens, reduced-motion support, and adequate touch targets.

Moving preserves the thread ID, transcript, and thread-owned attachments. It does not silently copy the previous project's shared documents. New project context applies to future requests; historical answers retain their original citations. Prevent moving during an active response and handle a failed move without losing membership.

## Track B — answer-lane implementation

### B1. Repair provenance through the whole lifecycle

Trace existing server evidence frames through parsing, shared interaction parts, rendering, persistence, reload, copy/export, and any active delivery adapter. Repair missing wiring and exact mappings. Separate in-progress status from an earned final evidence claim. Failed/refused turns must not acquire a successful grounded badge.

Add the manual/source upload action only where missing evidence affects the answer; concept questions do not need a sales prompt. Keep the technician's question, project, and thread while adding a source. Surface processing/ready/error states and retry without duplicate turns or uploads.

### B2. Establish the common pre-display boundary

Extend the existing route and safety components. Treat retrieved content as source data, never instructions. Check both lanes and all relevant sources. Input classification alone cannot cover hazards introduced by a source or the generated answer.

For the initial guarded path, collect candidate text, validate it, then release the accepted answer. Keep progress visible. Preserve cancellation, provider failover, timeouts, and lifecycle semantics. Stop before validation must not flush unchecked text. Store and replay only the accepted public answer; do not let rejected candidates become future chat context.

Test #3790's source-poisoning regression before calling the release safe. Do not promise unchanged first-token latency: measure time to first accepted content and completion time. Optimize streaming afterward only with evidence that restricted text cannot escape.

### B3. Enforce specificity while preserving usefulness

Use request/history/equipment context and actual source support, not a bare fault-code regex or a citation-shaped token. Distinguish quoting a code from defining it, user-supplied measurements from inferred settings, and generic calculations from model-specific specifications. Validate citations against authorized retrieved source IDs and supporting passages.

When support is missing, withhold the unsupported exact claim and offer useful general explanation, a targeted clarifying question, or the appropriate source request. Do not assert that an unverified code/model is nonexistent. Do not preserve invented meanings behind hedges. Do not repair technical prose with uncontrolled sentence splitting or string substitutions.

Existing deterministic checks can enforce bounded invariants with no extra inference call. If semantic review is necessary, use approved existing infrastructure and record its cost/latency; do not pretend regex matching establishes universal truth or safety.

### B4. Connect evidence as it arrives

Use the existing stored photo observation before paying to inspect the same image again. Revalidate ownership and relevance on the server. Keep photo provenance and uncertainty visible. An unrelated project manual must not override an explicit question about the attached photo.

When the user adds a manual, later answers can use its relevant ready passages in the same thread. Do not retroactively relabel an earlier general answer. Name the exact supporting page/location when available; never invent document names, quotes, or locators. Surface relevant source conflicts instead of silently selecting a specification.

## Integration sequence and PR boundaries

1. Establish the map and shared interaction/provenance contract.
2. Deliver A2 and B1 as bounded changes, coordinating any shared-core edits sequentially.
3. Prioritize B2 for the reported safety defect, then B3. UI work can be reviewed independently, but a polished badge is not completion of output protection.
4. Finish A3 and B4 on the accepted contracts.
5. Run the integrated acceptance flow and evidence matrix below on identified builds.

Choose PR boundaries by actual file ownership and reuse findings. Each PR explains the defect, change, resulting behavior, exact verification, and remaining gap. Keep framework/CI/governance changes separate unless truly necessary. Preserve applicable gates and use the repository's required independent review workflow; never substitute self-review for a required independent verdict.

## Acceptance matrix

All rows begin NOT RUN for the new implementation. Fill PASS/FAIL/BLOCKED with evidence rather than copying results from the research.

| ID | Workflow / adversarial case | Required result and proof |
| --- | --- | --- |
| E01 | Ask a general maintenance concept before setup | Useful response; general basis; no forced project, QR, or upload. |
| E02 | Create project, create two chats, reload | One project ID; distinct thread IDs/transcripts; preserved membership. |
| E03 | Draft → drawer → Sources → preview → Back | Same draft/attachments/thread/scroll; no forced restart. |
| E04 | Save project Instructions | Reopen persisted text; request trace confirms scoped application. |
| E05 | Upload a benign project manual, ask in a new chat | Ready status; answer supported by the actual passage; citation opens it. |
| E06 | Attach a photo and ask for visible information | Uses authorized stored observation; photo attribution; no unnecessary reread. |
| E07 | Photo question beside an unrelated manual | Photo remains the relevant source; no answer about another machine. |
| E08 | Two projects with distinct benign markers | No cross-project instructions, sources, badge, or search-result leakage. |
| E09 | Rename and move a chat; simulate failed save | ID/history intact; destination/origin lists correct; failure preserves original state. |
| E10 | Known fabricated-code probes and new variants | No guessed exact meaning/procedure or fake document; useful limited answer remains. |
| E11 | Numbers, quoted codes, calculations, terse follow-ups | No blanket refusal from lexical matches; support requirements still enforced. |
| E12 | Poisoned source and unsafe-answer regressions | Common protection applies; no rejected candidate is displayed, persisted as accepted, or reused as chat context. |
| E13 | Stop, disconnect, provider failure during validation | Upstream cancellation; honest lifecycle; unchecked buffer never flushed. |
| E14 | Sourced fact plus diagnostic hypotheses; conflicting sources | Clear provenance separation; conflict disclosed; citation does not validate unsupported diagnosis. |
| E15 | Replay and copy/export | Same accepted text, evidence basis, and usable source references. |
| E16 | Web and actual phone, same account | Same saved projects/chats/context; keyboard/Back usable; builds identified. |
| E17 | Latency and cost comparison | Baseline/candidate on comparable conditions; time to first accepted text, total time, and inference cost reported separately. |

Use existing eval/browser/mobile harnesses and authorized test data, preferably staging. Include positive and negative controls so an always-refusing guard cannot pass the usefulness tests and a no-op guard cannot pass protection tests. Wire fixed regressions into the existing gate; retain failing cases honestly until fixed. A finite suite does not establish that all possible issues are found.

## Required handoff evidence and stop conditions

Record repository, base/head SHA, PR, changed files, test commands/results, test-data setup, screenshot/recording paths, and actual serving build. For a native run, record verified phone model, package/version, APK or bundle identity, and install evidence. Prior context identifies a Pixel 9a; verify it. An emulator pass is not a physical-device pass.

Keep raw evidence free of credentials and private user content. Provide the updated reference catalog, reuse map, focused PRs, completed acceptance matrix, and a short plain-English status: current state; changed behavior; blocked items; decision needed; next action.

Continue independent authorized work when reference access or hardware is unavailable. Pause only the blocked operation for missing access, an ownership collision, destructive changes beyond authorization, or required gates that cannot be completed. A failed protection test blocks a release claim. Do not modify guards or old results to manufacture success. Honor existing merge/deploy/install authorization; this guide neither grants it nor revokes it.

Before ending, inventory session-owned worktrees/branches, local-only work, spawned workers, Gateway claims, processes/watchers, and terminal sessions. Preserve unmerged work; stop only resources owned by your session that are authorized to stop. Do not declare cleanup complete while owned resources are unaccounted for.

## Copy/paste start prompt

```text
Implement the Projects and two-lane MIRA work described in docs/research/2026-09-13-projects-two-lane/CLAUDE_IMPLEMENTATION_GUIDE.md (research PR #3791). Read its linked research and current canonical contracts first.

Goal: one V7 conversation where a technician can ask generally, create/open a Project, start/resume separate chats, manage Sources/Instructions, add a manual/photo, get an honestly attributed answer, inspect evidence, and resume on phone/web.

Refresh main, ownership and overlapping PRs. Produce a compact REUSE/CONNECT/REPAIR/NEW map. Reuse existing shared UI, Projects/Threads, notebook route, typed SSE, evidence parts and eval harnesses. Check pending UI, photo, lifecycle and copy PRs before duplicating their work. Use one shared-core writer and isolated worktrees under repo rules.

Projects: finish drawer/menu/editor/preview/Back behavior; preserve drafts, IDs, attachments, scroll and tenant/project boundaries. Project New chat retains scope; global New chat is general. Navigation never silently moves a chat.

Answers: preserve fluent general explanations. Reuse general_reasoning and fix exact basis mappings; general_knowledge currently matches the mobile OEM heuristic. Unsupported model-specific meanings/specs/procedures must not survive behind a hedge or fake citation. Treat photos/history as their own evidence. No unrelated source may certify an answer.

Prioritize #3790 with the common safety/output boundary. Validate before answer content is released; the current route streams before final metadata. Preserve Stop, errors, persistence and cost accounting. Measure latency; do not promise zero impact. Connect stored observations and manual uploads to the same conversation.

Complete the signed-in reference catalog when accessible; the bundled screenshots prove only the signed-out desktop shell. Keep missing references and native-phone tests explicitly BLOCKED while finishing independent authorized work.

Deliver focused PRs, exact-SHA evidence, completed acceptance matrix and screenshots/recordings. Honor existing review/merge/deploy/install permissions. No new shell, runtime switch, backend rewrite or eval framework. Stop release claims on failed protection/parity tests; never claim unrun tests or unverified phone success. Finish with current state, changes, blockers, decision, next action and a session-owned resource inventory.
```
