# Convergence Unit — Channel-neutral equipment-document workflow

**Issue / work claim:** #3299 · **Status:** IMPLEMENTED — exact-SHA review and draft PR pending; no merge or deploy authorization
**Doctrine:** `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`
**Production incident:** Mike's Danfoss VLT AQUA Drive FC-202 Telegram floor test

## Current behavior

The intended product boundary is one MIRA workflow rendered by thin clients, but the
observed implementation is split across competing paths:

- Hub and mobile use the Equipment Notebook nameplate routes introduced by #3245. Those
  routes park the photo, produce a reviewable identity, discover an official-manual
  candidate, harden the download, verify applicability from the downloaded document,
  attach the canonical File, and constrain chat to positively trusted notebook sources.
- Telegram performs a bot-local drive-pack extraction and then a bot-local visual routing
  ladder before its normalized dispatcher. A recognized model can therefore be remembered
  locally without ever entering the Hub manual workflow. A later image can be claimed by
  PrintSense before the Hub sees it.
- Slack has another ordering: its PDF handler and photo fast paths run before the shared
  dispatcher. Its PDF handler posts to the old folder-upload door.
- Telegram and Slack document intake use `/api/uploads/folder`. That door creates a
  `hub_uploads`/Inbox record, but not the #3245 `namespace_direct_uploads` canonical File,
  not a `workspace_file_links` relationship, and not an Equipment Notebook source.
  Telegram discards even the folder response as a boolean.
- Conversation continuity is spread across SQLite `conversation_state`,
  `telegram_drive_context`, `chat_drive_context`, the visual/print workspace, equipment
  photo observations, and the Hub notebook. `/new` clears only part of those layers.
- Telegram photo work uses in-process tasks and timeout/progress messages without first
  creating a durable operation. Slack replay protection is an in-memory set. A replay or
  restart can therefore repeat work and terminal delivery. The replacement uses an
  execution lease for recoverable work, but a one-shot terminal claim so an uncertain
  client ACK can never cause the same answer to be rendered again.

The complete incident narrative and literal Danfoss identity are locked in
`tests/fixtures/channel_workflow/danfoss_fc202_telegram.json`; they are not allowed to exist
only in this record or a PR description.

## Target architecture

```text
thin client
  -> normalized channel-workflow contract
  -> Hub service-auth boundary
  -> tenant-scoped durable operation + canonical conversation workspace
  -> canonical nameplate / manual / Files / notebook-chat services
  -> semantic result + citations + one-shot delivery claim
  -> Telegram / Slack / Hub / mobile rendering only
```

The Hub remains the system of record. A channel conversation is bound to a canonical
`troubleshooting_sessions` row and an Equipment Notebook. The notebook is the durable
conversation-to-document association: canonical Files link to the notebook (and, when
present, the selected CMMS asset or namespace node), ingestion creates its source
membership, and the next turn uses the existing tenant+notebook+positive-source retrieval
gate.

The migration is branch-by-abstraction. Telegram and Slack call the new Hub operation API
first when the feature flag is on. A Hub result may claim a nameplate/manual/document turn
or may explicitly delegate an image to the existing electrical-print path. The old paths
remain as a rollback fallback until staging evidence and Mike's GO permit removal.

## Why this change exists

Mike supplied a real Danfoss nameplate and official PDF through Telegram. The bot eventually
recognized FC-202, but it did not invoke official-manual discovery; a subsequent plate was
interpreted as an electrical print; the PDF failed with `Hub intake is not configured`; and
the next text turn denied possession. #3292 repaired the slow MiniMax detour only. It did
not connect Telegram to #3245's canonical workflow.

## Root-cause map (answers from code and tests)

### 1. Where is the current canonical orchestration boundary?

There is no single channel-neutral boundary before this unit. The strongest canonical
business seam is the Hub Equipment Notebook family:

- `POST /api/equipment-notebooks/[id]/nameplate/recognize`
- `POST /api/equipment-notebooks/[id]/nameplate/confirm`
- `POST /api/files`
- `POST /api/equipment-notebooks/[id]/chat`
- `workspace-files.ts`, `manual-discovery.ts`, `safe-download.ts`,
  `manual-applicability.ts`, and `equipment-notebooks.ts`

Those routes form #3245's workflow, but orchestration and authentication are route-local.
The new boundary sits above them: a normalized Hub operation API invokes the same handlers
under a narrowly authenticated service context. Browser/mobile session callers continue to
use the same handlers.

### 2. Why can Hub/mobile invoke #3245 while Telegram cannot?

Hub and mobile already have authenticated Notebook IDs and call those session-authenticated
routes. Telegram never receives or persists a Notebook ID, has no service-auth route to the
Notebook workflow, and posts attachments to `/api/uploads/folder` instead. Slack is the same
architectural split with a separate handler.

### 3. Why did the Danfoss nameplate reach PrintSense?

`telegram/bot.py::_dispatch_single_photo` runs the local drive-pack resolver, wiring path,
print translator, and commercial PrintSense before `ChatDispatcher`. The local nameplate
path claims only a known live drive pack or a narrow recognized-manufacturer refusal. Any
unresolved Danfoss extraction falls through. The downstream visual classifier can label
the later image `ELECTRICAL_PRINT`, so PrintSense sees it before any Hub nameplate decision.

### 4. Why did the recognized identity not trigger manual discovery?

The Telegram extractor resolves local drive packs and persists bot-local photo context. It
does not call `mira-hub/src/lib/manual-discovery.ts` or the #3245 confirm workflow. Identity
recognition and manual discovery are separate, unconnected implementations.

### 5. Why was Hub intake unconfigured in production despite #2547?

#2547 added optional Telegram variables using empty defaults. In the production SaaS
compose, Telegram receives `HUB_INGEST_TOKEN=${HUB_INGEST_TOKEN:-}`, but the Hub and Slack
service blocks do not receive a matching required contract. The deployed staging bot lacks
the variables entirely. Production Telegram also defaulted `HUB_BASE_PATH=/hub` even though
the internal SaaS Hub image is built root-mounted, so a provisioned token would still target
the wrong internal route unless Doppler happened to override the path. Several staging
services default `MIRA_TENANT_ID` to the non-UUID string `staging`, which the Hub UUID
tenancy boundary rejects. Configuration was therefore allowed to deploy in a user-visible
but unusable state.

### 6. Does `/api/uploads/folder` return enough identity to associate the File?

No. It returns a `hub_uploads` intake row. The caller collapses the result to `bool`, and the
door neither creates a `namespace_direct_uploads` canonical File nor links a File to a
conversation, notebook, asset, or node. The new path uses `/api/files` semantics and returns
both canonical `fileId` and indexed `uploadId`/document ID.

### 7. How does a later text turn learn that a PDF was just uploaded?

It does not today. No returned identifier is retained and the bot engine searches a
different context. In the target path, the conversation's canonical session points at the
notebook, the File links to that notebook, source synchronization records the document, and
the session records the last File/document IDs. The next turn loads enabled positive-trust
notebook sources and calls the existing notebook chat gate.

### 8. Can duplicate updates produce multiple progress/final messages?

Yes. Telegram has no durable event claim before launching work; Slack's `seen_events` set is
process-local and periodically cleared. The generic `workflow_runs` helper cannot fix this:
its documented conflict behavior resets the row to `running` and intentionally re-executes
the body. This unit adds an RLS-scoped channel operation with a request fingerprint, owner
lease, terminal result, one-shot terminal-delivery claim, and acknowledgement.

### 9. Does `/new` clear every canonical workspace?

No. Telegram clears the engine and PrintSense workspace. It does not reliably rotate the
Hub notebook/session or clear both drive-context tables and all bot-side session memory.
Slack resets only an engine key. The target reset abandons the canonical session, cancels
its live operations, rotates to a clean generation, and then clears every legacy cache as
rollback hygiene.

### 10. Which logic is duplicated?

Identity extraction/routing exists in the Hub nameplate routes, Telegram drive-pack code,
the shared visual session, and generic vision workers. PDF intake exists in Hub Files, Hub
folder intake, Telegram helpers, and Slack's PDF handler. Conversation state exists in Hub
sessions/notebooks and several bot-local stores. Manual discovery exists in Hub, Ask API,
and bot shared modules. Retrieval/grounding is split between Notebook chat and bot engines.
This unit makes the Hub Notebook workflow authoritative and turns bot copies into gated
legacy fallbacks rather than creating another finder.

## Canonical implementation

### Normalized contract

`contracts/channel-workflow.v1.schema.json` defines one request/result shape. The request
contains the UUID tenant, canonical actor/uploader identity, source channel, stable event ID,
conversation ID, optional session/notebook/asset/node context, text/caption, attachment
metadata plus hashes, action, and optional prior operation. The result contains the durable
operation/session/notebook IDs, lifecycle state, semantic kind, recognized identity,
canonical File/document IDs, manual candidate/applicability state, grounded answer,
citations/provenance, and terminal-delivery claim.

### Durable operation

Migration 078 creates `channel_operations` in the Hub database. Unlike `workflow_runs`, it
is a UUID-tenant/RLS customer-data boundary and an exactly-once executor:

- unique `(tenant_id, channel, event_id)`;
- same event ID plus a different request fingerprint is a conflict, never silent reuse;
- the normalized request envelope is retained as tenant-scoped provenance (uploader,
  channel, conversation, filename, MIME, size, and content hash);
- one owner token may execute while its lease is live;
- a crashed owner can be recovered only after lease expiry;
- result finalization is token-fenced;
- one terminal delivery claim is issued for the life of the operation; ACK records a
  successful render, while an unacknowledged claim is never reissued;
- reset cancels prior running operations so an old turn cannot deliver into a new session.

### Canonical conversation workspace

Migration 078 extends `troubleshooting_sessions` additively with an external conversation
key, generation, Equipment Notebook ID, equipment-identity JSON, and last File/document IDs.
One active session exists per tenant/channel/conversation. Workspace creation atomically
creates the notebook backing node, notebook, and session under `withTenantContext`. Reset
abandons the old session and rotates generation; old notebook sources remain auditable but
cannot influence the new session.

### Reused business seams

- Nameplate image: the existing recognize route parks and links the original before vision.
  The normalized identity is enriched with product family, series, full type code, and part
  number so the Danfoss plate does not collapse those distinct identifiers.
- Manual request: `manual-discovery.ts` is invoked once with the persisted identity. Only an
  official OEM candidate can be offered as official. Candidate identity is never promoted
  silently; confirmation invokes the existing confirm route, which retains #3245's SSRF,
  redirect, size, MIME, PDF-magic, exact-byte, applicability, and positive-trust gates.
- Supplied PDF: the existing `/api/files` implementation parks exact bytes, attaches the
  notebook plus asset/node targets, claims ingestion, returns `fileId` and `uploadId`, and
  synchronizes the notebook source. Its existing `source` field records the channel, while
  the operation envelope retains the complete per-event provenance even when exact bytes
  reuse an older canonical File row.
- Later question: the existing Notebook chat route validates tenant+notebook+positive source
  membership, retrieves only the selected document set, abstains on zero evidence, and
  filters citations to markers actually used.

### Thin clients

Telegram and Slack normalize and download transport attachments, submit them through the
shared Python client, render returned blocks/citations/buttons, and ACK delivery. They do
not choose manuals, decide possession, attach Files, or perform grounding. When the Hub
returns an explicit `printsense` delegation for a non-nameplate image, the existing print
path remains the temporary branch-by-abstraction fallback.

### Deployment boundary

Production and VPS staging now pass the same feature flag and service token to the Hub and
each deployed bot, with the exact internal root-mounted Hub origin/path. Standalone Hub/bot
compose retains `/hub`, matching that image's build default. Bot configuration validation
runs before Telegram polling or Slack Socket Mode and requires an HTTP(S) origin, token,
UUID tenant, valid toggle, and positive timing values when enabled. Hub health accepts the
same boolean vocabulary and returns 503 for a missing token or invalid toggle. The flag
remains `0` by default: provisioning and enabling it are separate `PENDING-HUMAN` actions.

## Old implementation

The following paths remain present but stop being authoritative when
`MIRA_CHANNEL_WORKFLOW_ENABLED=1`:

- Telegram `_try_nameplate_drive_pack_reply` and fire-and-forget Hub photo/PDF intake;
- Slack `pdf_handler.py` and the pre-dispatch photo fast path;
- bot-local visual/drive/photo state for manual/document possession.

They remain available when the feature flag is off for immediate code rollback. Deletion is
not part of this unit.

## Affected modules

- `contracts/`, `tests/fixtures/channel_workflow/`
- Hub migrations, service auth, channel operation/workspace/orchestrator modules and routes
- existing Hub Files/nameplate/chat routes only at their context/reuse seams
- shared bot contract/client/dispatcher types
- Telegram and Slack transport/render/reset wiring
- production/staging/local compose validation and env documentation
- this convergence record, Architecture Registry, and `wiki/hot.md`

No crawler, #3295 corpus tagging, CU-03 write-policy work, destructive migration, backfill,
deployment, or secret mutation is in scope.

## Contracts/invariants

1. A source event creates at most one operation and executes at most once per live lease.
2. A terminal result is claimable at most once; client ACK records successful rendering but
   an uncertain or failed ACK never makes the result claimable again.
3. Tenant is checked in service auth, operation/workspace SQL, File linkage, source
   validation, retrieval, and delivery ACK; foreign IDs are indistinguishable from missing.
4. A File is never claimed indexed or citable until ingestion and source synchronization
   report the corresponding state.
5. Candidate or rejected manuals cannot enter grounding.
6. A nameplate identity remains a reviewable component identity; it never renames the parent
   machine notebook.
7. `/new` rotates the canonical workspace before clearing legacy caches.
8. A true electrical print still reaches PrintSense under the migration flag.
9. Hub/mobile and bot surfaces receive the same semantic result from equivalent normalized
   inputs; only rendering differs.
10. No external provider or production secret is used during deterministic verification.

## Risk classification

**High / automatic xhigh Gate 7 review.** This unit changes tenant-scoped schema, service
authentication, cross-service contracts, ingestion, identity, concurrency/idempotency,
retrieval, citations, and deployment configuration. It may not merge or deploy without
Mike's explicit GO.

## Behavior-lock tests

Pre-change baselines at R0:

- Hub Files/nameplate/manual suite: 193 passed.
- Telegram adapter/dispatcher/intake split suites: 24 passed.
- Slack fast-path suite: 2 passed.
- Slack PDF integration: 3 passed.

The implementation plan requires red-first tests for all ten user acceptance gates, plus
mutations that remove the route guard, notebook association, event uniqueness, delivery
ACK fence, reset generation, trust-state filter, and tenant predicate.

## Deterministic verification — 2026-08-18

The implementation was driven red-first. In addition to the original acceptance tests, the
final audit produced these concrete red states before their fixes:

- cross-conversation identity confirmation resolved when it should reject (1 failed / 9
  passed), then 10/10 green after binding the prior operation to the canonical session and
  `candidate_review` state;
- `MIRA_CHANNEL_WORKFLOW_ENABLED=1` passed deployment health but the operation route returned
  503 (1 failed / 8 passed), then 25/25 across health, routes, orchestrator, and Hub adapter
  after sharing one toggle parser;
- the Hub parser silently truncated seven overlong/type-invalid contract fields and the bot
  builder accepted two invalid boundary groups, then Hub 18/18 and bot 13/13 green after
  failing closed instead of collapsing event, conversation, identity, or filename values;
- tenant-ambiguous identity, canonical admin bypass, and client tenant mismatch produced four
  failures in a 33-test slice, then 33/33 green after tenant-scoped identity lookup, ambiguous
  lookup denial, canonical enrollment enforcement, and a pre-HTTP tenant fence;
- an expired terminal-delivery lease was reclaimable (two negative controls failed), then
  21/21 operation/route tests green after replacing it with a durable one-shot claim. Only
  execution ownership remains reclaimable.

Fresh final-tree gates before the review freeze:

- Hub: 208 test files, 1,984/1,984 tests passed;
- bots: 2,495 passed, 20 intentional environment/provider skips;
- deployment/security/review harness: 145/145 passed;
- production Next.js build: passed and enumerated all four channel-workflow routes;
- migration order: 078 is explicitly after 019 and 073; dependency checks passed;
- changed-file ESLint, Ruff check, and Ruff format: passed;
- Hub, SaaS, staging, staging-VPS, and standalone bot Compose models: parsed with inert
  placeholder values for required variables; no secret values were read or changed.

Repository-wide diagnostics retain only exact baseline populations outside this change:
Hub TypeScript has 17 errors in six untouched files, Hub ESLint has five errors in three
untouched visual files, Pyright has one error and 84 warnings with no changed-file finding,
and full-bot Ruff has 15 errors in eight untouched files. Each reported Ruff/TypeScript/
ESLint file is byte-identical to `origin/main`; changed-file gates are clean. These are not
count-only comparisons and no baseline file is modified here.

Live Danfoss proof is intentionally not claimed. Migration/configuration/provider activation
and a real Telegram plus Hub/mobile replay remain `PENDING-HUMAN` under the promotion plan.

## R0 SHA/checkpoint

`b2b1fca6923ceb1bdb45defee82791fef2a1d7bd` (`origin/main` after fetch on
2026-08-18). Branch: `fix/channel-neutral-manual-workflow`. Work claim: #3299.

The original detached checkout before refreshing from main was
`b44eaa9247cd8acf33435e011082629d1521cf43`. One pre-existing untracked user file,
`docs/prd/2026-08-03-cited-technician-turn.md`, was present and is excluded from every
change/commit.

Production was observed read-only at version `3.277.2`, SHA
`26534bc35e6e58c8e6f096930eda0e0e29a36cae`, built
`2026-08-18T04:37:34Z`; health was OK. This observation is not deployment authorization.

## Data/schema recovery procedure

Before merge/deploy: abandon this branch/worktree and return to R0; no shared schema has
changed.

If migration 078 is later applied under a separately authorized staging rollout, rollback
is application-first:

1. set `MIRA_CHANNEL_WORKFLOW_ENABLED=0` on bot services and restart them;
2. leave additive columns/tables in place while verifying old paths;
3. if Mike separately authorizes schema rollback and no operation data must be retained,
   drop the migration-078 indexes/table, then drop only the migration-078 columns and
   restore the prior channel check constraint.

No automatic down migration, destructive data deletion, or production backfill is executed
by this unit.

## Implementation plan

See `docs/superpowers/plans/2026-08-18-channel-neutral-manual-workflow.md`.

## Shadow-validation plan

With the feature flag on in staging, replay the fixture corpus twice: canonical result in
shadow/no-render mode beside the existing bot decision, then canonical-render mode. Compare
route, identity fields, operation count, Files/source membership, citations, and terminal
delivery. A true electrical-print negative control must continue to select PrintSense.

## Adversarial reviewer effort

`xhigh`, on the exact immutable final SHA, using `tools/gate7_review.py`. Required axes:
architecture ownership, service auth, tenant isolation/RLS, operation leases and replay,
reset cancellation, File ingestion/source sync, manual applicability, and citation
entailment. Every substantiated BLOCKER/HIGH is fixed and the changed SHA re-reviewed.

## Human approval requirement

Mike's explicit GO is required separately for merge, staging migration/deploy, provider
enablement, secret provisioning, production deploy, and any legacy deletion. The code may
be committed, pushed, and opened as a draft PR without that GO.

The current provider/security posture also blocks live automatic nameplate discovery:
Together nameplate vision and the external manual-discovery provider remain governed by
ADR-0036 and environment configuration. Tests use deterministic fixtures only. If those
approvals/secrets are still absent at handoff, live proof is `PENDING-HUMAN`, not simulated
or claimed.

## Promotion plan

1. Draft PR, deterministic suites, CI, exact-SHA Gate 7 PASS.
2. Mike reviews the root-cause map and grants staging/config GO.
3. Provision the existing service token and approved provider configuration in Doppler
   without exposing values; validate compose and apply migration 078 through the normal
   staging migration workflow.
4. Shadow replay, then real Telegram Danfoss replay plus Hub or mobile replay.
5. Record operation IDs, timing, route, identity, official URL, File/document/link IDs,
   cited answer, and exactly one terminal delivery.
6. Mike grants merge/deploy GO separately.

## R1 SHA/checkpoint

Pending. It will be the final reviewed immutable branch SHA before any merge. A later merge
SHA and rollback checkpoint can only be recorded after Mike's GO.

## Observation window

Pending staging authorization. Minimum evidence window: the exact Danfoss sequence, one
other client, a duplicate-update replay, reset during/after a prior context, cross-tenant
denial, unofficial/inapplicable candidate, and a real electrical print.

## Deletion criteria

The old Telegram/Slack document and nameplate routing code may be removed only in a separate
convergence unit after staging and production observation show semantic parity, no duplicate
terminals, no cross-tenant findings, correct reset isolation, and successful rollback drill.

## Evidence required for GO

- durable fixture and red→green transcript for every acceptance gate;
- targeted Hub, Telegram, Slack, tenancy/security, lint/type, migration-order, and required
  CI results on the final SHA;
- mutation/negative-control results;
- exact-SHA Gate 7 PASS after all high findings are fixed;
- staging config validation;
- real Danfoss Telegram replay and one other client with operation/File/document/citation
  identifiers and one terminal delivery;
- explicit rollback commands and remaining `PENDING-HUMAN` actions.
