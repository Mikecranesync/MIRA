# Channel-neutral Manual Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram, Slack, Hub, and mobile use one durable Hub workflow for nameplate identity, official-manual discovery, canonical File intake, document association, grounded retrieval, citations, idempotent delivery, and reset.

**Architecture:** Add a versioned normalized contract and an RLS-scoped Hub operation/workspace layer above the canonical Equipment Notebook routes from #3245. The new Hub endpoint invokes the existing Files, nameplate-confirm, manual security/applicability, and notebook-chat handlers through a shared service-auth context; Python adapters only transport and render. Migrate Telegram and Slack behind `MIRA_CHANNEL_WORKFLOW_ENABLED`, retaining the old paths as explicit rollback fallbacks until live proof and Mike's GO.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5, Vitest 3, PostgreSQL/Neon RLS migrations, Python 3.12 dataclasses, httpx, pytest, python-telegram-bot, Slack Bolt, Docker Compose, GitHub Actions.

**Spec:** `docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md`

## Global Constraints

- Apache 2.0 or MIT dependencies only; add no new dependency unless unavoidable.
- Hub/Neon is the system of record; no bot-owned database, manual finder, retrieval policy, or possession decision.
- Preserve #3245's SSRF, redirect, size, MIME, PDF-magic, tenant, applicability, positive-source, grounding, and citation protections.
- Preserve the existing Hub/mobile browser-session flow while adding service-auth reuse.
- `HUB_INGEST_TOKEN` remains secret and is never printed, committed, provisioned, or mutated by this work.
- Automatic provider-backed nameplate/manual discovery remains dark unless ADR-0036 and staging configuration are separately approved.
- No crawler/#3295, CU-03/#3268/#3297, unrelated refactor, destructive migration, backfill, merge, or deploy.
- Base/R0 is `b2b1fca6923ceb1bdb45defee82791fef2a1d7bd`; the pre-existing untracked `docs/prd/2026-08-03-cited-technician-turn.md` is never staged.
- Use red→green TDD for every behavioral change and preserve exact failure output in the convergence record/PR.
- Final architecture/security review is xhigh on the exact immutable SHA; all substantiated BLOCKER/HIGH findings are fixed and re-reviewed.

---

### Task 1: Durable Danfoss fixture and versioned normalized contract

**Files:**
- Create: `tests/fixtures/channel_workflow/danfoss_fc202_telegram.json`
- Create: `contracts/channel-workflow.v1.schema.json`
- Create: `mira-hub/src/lib/channel-workflow-contract.ts`
- Create: `mira-hub/src/lib/__tests__/channel-workflow-contract.test.ts`
- Create: `mira-bots/shared/channel_workflow.py`
- Create: `mira-bots/tests/test_channel_workflow_contract.py`
- Modify: `mira-bots/shared/chat/types.py`

**Interfaces:**
- Produces: `parseChannelWorkflowRequest(raw): ChannelWorkflowRequest`
- Produces: `semanticFingerprint(request): string`
- Produces: Python `build_channel_request(event, *, action, actor_id, context) -> dict`
- Produces: `NormalizedChatResponse.operation_id`, `.operation_state`, `.semantic_kind`, `.citations`, `.provenance`, `.terminal_delivery_token`, and `.suppress_delivery`
- Consumes: existing `NormalizedChatEvent` and `NormalizedAttachment`

- [ ] **Step 1: Add the literal regression fixture and failing TypeScript contract tests**

The fixture must contain the ten observed failures verbatim, the full Telegram sequence,
and these hand-derived values:

```json
{
  "manufacturer": "Danfoss",
  "productFamily": "VLT AQUA Drive",
  "series": "FC-202",
  "model": "FC-202",
  "typeCode": "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
  "partNumber": "131H4017",
  "serialNumber": "02334H073",
  "rating": "15 kW / 20 HP",
  "input": "3-phase 200-240 V"
}
```

Tests must prove a complete request parses, unknown properties/invalid UUID tenant/missing
event/conversation IDs fail, attachment hashes are required when bytes are declared, and
equivalent `telegram`, `slack`, `hub`, and `mobile` requests differ only in transport fields
after `semanticProjection()`.

- [ ] **Step 2: Run the TypeScript tests and record RED**

Run:

```bash
cd mira-hub
npx vitest run src/lib/__tests__/channel-workflow-contract.test.ts
```

Expected: FAIL because `channel-workflow-contract.ts` and its exported parser/projection do
not exist.

- [ ] **Step 3: Add failing Python contract/parity tests**

Construct real `NormalizedChatEvent` instances for Telegram and Slack, including image/PDF
metadata and bytes. Assert literal request fields, SHA-256, canonical conversation IDs
(`telegram:<chat>` and `slack:<channel>:<thread-root>`), and semantic parity with hand-built
Hub/mobile requests. Assert empty event ID, tenant, actor, and attachment bytes fail closed.

- [ ] **Step 4: Run the Python tests and record RED**

Run:

```bash
PYTHONPATH=/tmp/mira-py312-deps pytest -q mira-bots/tests/test_channel_workflow_contract.py
```

Expected: FAIL because `build_channel_request` and the response fields do not exist.

- [ ] **Step 5: Implement the JSON schema and both contract normalizers**

Use this request/result vocabulary exactly:

```ts
export type Channel = "telegram" | "slack" | "hub" | "mobile";
export type ChannelAction = "message" | "reset" | "confirm_identity";
export type OperationState =
  | "queued" | "running" | "complete" | "candidate_review"
  | "insufficient_evidence" | "failed" | "cancelled";

export interface ChannelWorkflowRequest {
  contractVersion: "1.0";
  tenantId: string;
  actor: { userId: string; externalUserId: string; uploaderId: string };
  channel: Channel;
  eventId: string;
  conversation: {
    id: string;
    sessionId?: string;
    notebookId?: string;
    assetId?: string;
    nodeId?: string;
  };
  action: ChannelAction;
  priorOperationId?: string;
  text: string;
  caption: string;
  attachments: Array<{
    attachmentId: string;
    kind: "image" | "pdf" | "other";
    mimeType: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
  }>;
}
```

`semanticFingerprint` must hash a stable, sorted JSON encoding of the full request; the
cross-client parity projection deliberately removes only `channel`, `eventId`, external
actor ID, conversation transport ID, and attachment ID while retaining semantic text,
context, MIME, filename, size, and SHA.

- [ ] **Step 6: Run contract tests GREEN and mutation-check them**

Run both commands from steps 2 and 4. Then temporarily remove attachment SHA or include
`eventId` in semantic projection and confirm the corresponding literal test fails; restore.

- [ ] **Step 7: Commit the contract/fixture slice**

```bash
git add contracts/channel-workflow.v1.schema.json \
  tests/fixtures/channel_workflow/danfoss_fc202_telegram.json \
  mira-hub/src/lib/channel-workflow-contract.ts \
  mira-hub/src/lib/__tests__/channel-workflow-contract.test.ts \
  mira-bots/shared/channel_workflow.py \
  mira-bots/shared/chat/types.py \
  mira-bots/tests/test_channel_workflow_contract.py
git commit -m "test(workflow): lock channel-neutral Danfoss contract"
```

### Task 2: RLS operation ledger and canonical conversation workspace

**Files:**
- Create: `mira-hub/db/migrations/078_channel_workflow.sql`
- Create: `mira-hub/src/lib/channel-operations.ts`
- Create: `mira-hub/src/lib/channel-workspaces.ts`
- Create: `mira-hub/src/lib/__tests__/channel-operations.test.ts`
- Create: `mira-hub/src/lib/__tests__/channel-workspaces.test.ts`
- Modify: `mira-hub/src/lib/equipment-notebooks.ts`
- Modify: `mira-hub/db/check-migration-order.mjs`

**Interfaces:**
- Consumes: `ChannelWorkflowRequest`, `semanticFingerprint`, `withTenantContext`
- Produces: `prepareOperation(request): Promise<PreparedOperation>`
- Produces: `beginOperation(tenantId, operationId, ownerToken): Promise<BeginResult>`
- Produces: `finalizeOperation(...): Promise<boolean>`
- Produces: `claimTerminalDelivery(...): Promise<DeliveryClaim | null>`
- Produces: `ackTerminalDelivery(...): Promise<boolean>`
- Produces: `getOrCreateChannelWorkspace(request): Promise<ChannelWorkspace>`
- Produces: `resetChannelWorkspace(...): Promise<ChannelWorkspace>`
- Produces: `updateChannelWorkspaceState(...)`

- [ ] **Step 1: Write failing operation behavior tests**

Use an injectable `ChannelOperationStore` fake to prove:

```ts
// Same event/fingerprint: same operation, one owner.
expect(first.disposition).toBe("execute");
expect(replay.operationId).toBe(first.operationId);
expect(replay.disposition).toBe("running");

// Same event/different fingerprint: never reuse.
await expect(prepareOperation(changed)).rejects.toThrow("event_id_conflict");

// Token-fenced finalization and delivery ACK.
expect(await finalizeOperation(wrongOwner)).toBe(false);
expect(firstDelivery.token).toBeTruthy();
expect(secondBeforeLease).toBeNull();
expect(await ackTerminalDelivery(wrongToken)).toBe(false);
expect(await ackTerminalDelivery(firstDelivery.token)).toBe(true);
expect(afterAck).toBeNull();
```

Also prove expired execution/delivery leases can be reclaimed and `cancelled` operations can
neither finalize nor claim delivery.

- [ ] **Step 2: Write failing workspace tests**

With a transaction-shaped fake client, assert one active workspace per
tenant/channel/conversation, supplied notebook/asset/node IDs are tenant-validated, reset
abandons the old session, cancels its running operations except the reset operation, creates
a larger generation, and returns a notebook with no prior source/identity state.

- [ ] **Step 3: Run both suites RED**

```bash
cd mira-hub
npx vitest run src/lib/__tests__/channel-operations.test.ts src/lib/__tests__/channel-workspaces.test.ts
```

Expected: FAIL because the service modules and migration-backed store do not exist.

- [ ] **Step 4: Add migration 078**

The migration must create `channel_operations` with UUID `tenant_id`, `request_fingerprint`,
the normalized request envelope (durable uploader/channel/conversation/attachment
provenance), owner/lease fields, terminal result JSON, delivery lease/ACK fields, unique
`(tenant_id, channel, event_id)`, status CHECK, indexes, RLS honoring both tenant setting
names, and `factorylm_app` grants. Extend `troubleshooting_sessions` with:

```sql
external_conversation_id TEXT,
generation INTEGER NOT NULL DEFAULT 1,
notebook_id UUID,
equipment_identity JSONB,
last_file_id UUID,
last_doc_id UUID
```

Replace the channel CHECK to include `hub` and `mobile`, and add a partial unique active
workspace index over `(tenant_id, channel, external_conversation_id)` where status is
`awaiting_namespace` or `confirmed`. Keep the migration one transaction, idempotent, and
forward-only; include an application-first recovery note but execute no DOWN statements.

- [ ] **Step 5: Implement atomic notebook/session creation and reset**

Extract `createNotebookTx(client, tenantId, input)` from `createNotebook` so the public
function retains its behavior while workspace creation can atomically insert the backing
`kg_entities` node, notebook, and troubleshooting session. Every query includes the tenant
predicate even under RLS. On conflict, select the existing active row in the same
transaction; no orphan notebook survives a race.

- [ ] **Step 6: Implement the operation store and lease service**

Use `INSERT ... ON CONFLICT DO NOTHING RETURNING` followed by a tenant-scoped read. Begin,
finalize, reclaim, delivery claim, and ACK are compare-and-swap `UPDATE ... WHERE` statements
that include tenant, operation ID, state, token, and lease predicates. Never use the
fail-open `runWorkflow` wrapper for execution ownership.

- [ ] **Step 7: Run GREEN, migration order, and mutation checks**

```bash
cd mira-hub
npx vitest run src/lib/__tests__/channel-operations.test.ts src/lib/__tests__/channel-workspaces.test.ts src/lib/__tests__/equipment-notebooks-domain.test.ts
npm run db:check-order
```

Mutate away the tenant predicate, unique event index assumption, owner token, and generation
increment one at a time; each must fail a named test. Restore each mutation.

- [ ] **Step 8: Commit the durable-state slice**

```bash
git add mira-hub/db/migrations/078_channel_workflow.sql \
  mira-hub/db/check-migration-order.mjs \
  mira-hub/src/lib/channel-operations.ts \
  mira-hub/src/lib/channel-workspaces.ts \
  mira-hub/src/lib/equipment-notebooks.ts \
  mira-hub/src/lib/__tests__/channel-operations.test.ts \
  mira-hub/src/lib/__tests__/channel-workspaces.test.ts
git commit -m "feat(hub): add tenant-scoped channel operations"
```

### Task 3: Shared service-auth context and canonical route reuse

**Files:**
- Create: `mira-hub/src/lib/service-request-context.ts`
- Create: `mira-hub/src/lib/__tests__/service-request-context.test.ts`
- Modify: `mira-hub/src/app/api/files/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/recognize/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/confirm/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`
- Modify: affected route tests under those directories

**Interfaces:**
- Produces: `requestContextOr401(req): Promise<RequestContext | NextResponse>`
- Produces: `internalServiceHeaders(ctx): HeadersInit` for same-process canonical calls
- Consumes: existing `sessionOr401`

- [ ] **Step 1: Write failing auth tests**

Prove browser requests still delegate to `sessionOr401`; a correct constant-time Bearer
token plus UUID tenant and actor headers returns a service context; missing server token is
503; bad bearer is 401 and never falls back to a browser session; malformed/missing tenant
is 422; and request body tenant mismatch is rejected by the channel routes.

- [ ] **Step 2: Run RED**

```bash
cd mira-hub
npx vitest run src/lib/__tests__/service-request-context.test.ts
```

- [ ] **Step 3: Implement constant-time service authentication**

Hash both supplied and configured token with SHA-256 before `timingSafeEqual`, so unequal
token lengths do not throw or leak timing. Service requests require:

```text
Authorization: Bearer <HUB_INGEST_TOKEN>
X-Mira-Tenant-Id: <UUID>
X-Mira-User-Id: <canonical actor id>
```

An Authorization header that attempts service auth never falls back to a cookie session.

- [ ] **Step 4: Switch the four canonical routes to the shared context helper**

Change only their authentication seam; preserve the existing request parsing, status codes,
parking, ingestion, manual security, source validation, streaming, and route-level tests.
Update mocks from `sessionOr401` to `requestContextOr401` where necessary and add one service
context case per route. For `/api/files`, permit the authenticated service caller to set the
existing canonical File `source` field to `channel:<channel>`; browser callers remain pinned
to `user_upload`. Per-event provenance remains in the RLS `channel_operations.request` row,
so exact-byte File reuse does not overwrite the history of earlier or later intake events.

- [ ] **Step 5: Run the existing #3245 suites GREEN**

```bash
cd mira-hub
npx vitest run src/lib/__tests__/workspace-files.test.ts \
  src/lib/__tests__/manual-discovery.test.ts \
  src/lib/__tests__/manual-applicability.test.ts \
  src/lib/__tests__/safe-download.test.ts \
  src/app/api/files/__tests__/upload.test.ts \
  'src/app/api/equipment-notebooks/[id]/nameplate/__tests__/recognize.test.ts' \
  'src/app/api/equipment-notebooks/[id]/nameplate/__tests__/confirm.test.ts' \
  'src/app/api/equipment-notebooks/[id]/chat/__tests__/answer-hygiene.test.ts'
```

- [ ] **Step 6: Commit the shared-auth/reuse slice**

```bash
git add mira-hub/src/lib/service-request-context.ts \
  mira-hub/src/lib/__tests__/service-request-context.test.ts \
  mira-hub/src/app/api/files/route.ts \
  'mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/recognize/route.ts' \
  'mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/confirm/route.ts' \
  'mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts' \
  mira-hub/src/app/api/files/__tests__ \
  'mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/__tests__' \
  'mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__'
git commit -m "refactor(hub): expose canonical notebook workflow to services"
```

### Task 4: Nameplate identity preservation and canonical orchestration

**Files:**
- Modify: `mira-hub/src/lib/nameplate/index.ts`
- Modify: `mira-hub/src/lib/nameplate/passes.ts`
- Modify: `mira-hub/src/lib/__tests__/nameplate-normalize.test.ts`
- Modify: `mira-hub/src/lib/__tests__/nameplate-passes.test.ts`
- Create: `mira-hub/src/lib/channel-workflow-orchestrator.ts`
- Create: `mira-hub/src/lib/__tests__/channel-workflow-orchestrator.test.ts`
- Create: `mira-hub/src/app/api/channel-workflow/operations/route.ts`
- Create: `mira-hub/src/app/api/channel-workflow/operations/[id]/execute/route.ts`
- Create: `mira-hub/src/app/api/channel-workflow/operations/[id]/delivery/route.ts`
- Create: `mira-hub/src/app/api/channel-workflow/operations/__tests__/route.test.ts`

**Interfaces:**
- Consumes: operation/workspace services and existing canonical route handlers
- Produces: `executeChannelWorkflow(request, attachments, deps): Promise<SemanticResult>`
- Produces: `isLikelyNameplate(candidate, evidence): boolean`
- Produces: prepare/execute/delivery-ACK HTTP endpoints

- [ ] **Step 1: Add the red Danfoss orchestration test**

Load the durable fixture. Inject real contract logic and deterministic fakes only at the
external vision/search/download/provider boundaries. Assert:

- selected route is `nameplate_manual`, never `printsense`;
- identity equals Danfoss, VLT AQUA Drive, FC-202, full type code, P/N 131H4017,
  S/N 02334H073;
- discovery is called once with persisted identity;
- the result is an official Danfoss PDF candidate or honest `candidate_review`;
- a subsequent model-number text event reads the session identity and makes zero recognition
  calls.

- [ ] **Step 2: Add red PDF, retrieval, reset, idempotency, and negative-control tests**

Use strict fakes that mirror full route response shapes. Prove:

1. `VLT User Manual.pdf` invokes `/api/files` semantics once with notebook+asset targets,
   stores returned File/document IDs, and reports indexing truthfully.
2. The next question invokes Notebook chat with that exact doc ID; the normalized result
   carries the answer and page/file citation.
3. A candidate/unofficial/inapplicable manual never enters the selected source set.
4. A foreign notebook/File/doc produces the same not-found result as missing.
5. Duplicate prepare/execute calls invoke orchestration once and expose one delivery lease.
6. Reset prevents every old identity/File/doc/notebook source from influencing the next
   generation and cancels an old running operation.
7. A fixture electrical print yields `handled=false`, `delegatedRoute="printsense"`, and no
   manual discovery call.

- [ ] **Step 3: Run orchestration/route tests RED**

```bash
cd mira-hub
npx vitest run src/lib/__tests__/channel-workflow-orchestrator.test.ts \
  src/app/api/channel-workflow/operations/__tests__/route.test.ts
```

- [ ] **Step 4: Preserve Danfoss's distinct identity fields**

Extend `EquipmentIdentityCandidate` and the vision prompt with `productFamily`, `series`,
`typeCode`, and `partNumber`. Preserve `catalogNumber` as the backwards-compatible legacy
field. Deterministic raw-line assignment must keep `TYPE FC-202P...` as `typeCode`, `P/N
131H4017` as `partNumber`/catalog number, and provider model/series `FC-202` as model; it must
not overwrite the series with the full type code.

- [ ] **Step 5: Implement prepare/execute/ACK routes**

Prepare accepts JSON only, validates service context equals request tenant, resolves the
workspace, fingerprints the request, and returns `execute`, `running`, or terminal replay.
Execute requires the operation owner token, recomputes request and actual-byte SHA hashes,
then runs synchronously under the durable operation. It updates real lifecycle steps
(`recognizing`, `discovering`, `ingesting`, `answering`) and returns a terminal delivery
lease only after fenced finalization. ACK marks that lease delivered.

- [ ] **Step 6: Implement the canonical decision ladder**

The order is fixed:

```text
reset
  -> rotate workspace and cancel prior operations
confirm_identity
  -> invoke existing nameplate confirm handler
PDF
  -> invoke existing Files handler with notebook + asset/node targets
image
  -> invoke existing recognize handler
     -> likely nameplate + manual intent: persist identity, shared discovery, candidate
     -> likely nameplate without intent: persist identity, candidate result
     -> not nameplate: explicit PrintSense delegation
text with persisted identity + manual intent
  -> shared discovery without image inference
text with positive notebook sources
  -> existing Notebook chat handler; parse SSE into one answer/citation result
otherwise
  -> handled=false, legacy diagnostic fallback
```

Never call confirm automatically for provider-only identity. A `confirm_identity` client
action is the user decision and invokes the existing confirm route, including safe download
and applicability.

- [ ] **Step 7: Run GREEN and mutation checks**

Run the commands from step 3 plus the entire #3245 baseline. Mutate route order so PrintSense
wins, drop the PDF notebook target, change the selected doc ID, accept `candidate` source,
and reuse stale session identity after reset; each mutation must fail a named test.

- [ ] **Step 8: Commit the Hub orchestrator slice**

```bash
git add mira-hub/src/lib/nameplate \
  mira-hub/src/lib/__tests__/nameplate-normalize.test.ts \
  mira-hub/src/lib/__tests__/nameplate-passes.test.ts \
  mira-hub/src/lib/channel-workflow-orchestrator.ts \
  mira-hub/src/lib/__tests__/channel-workflow-orchestrator.test.ts \
  mira-hub/src/app/api/channel-workflow
git commit -m "feat(hub): orchestrate channel-neutral manual workflow"
```

### Task 5: Shared Python client with truthful progress and delivery ACK

**Files:**
- Modify: `mira-bots/shared/channel_workflow.py`
- Create: `mira-bots/tests/test_channel_workflow_client.py`
- Modify: `mira-bots/shared/chat/dispatcher.py`
- Modify: `mira-bots/tests/test_dispatcher_gate.py`

**Interfaces:**
- Produces: `ChannelWorkflowClient.prepare_execute(event, actor, action=...)`
- Produces: `ChatDispatcher.try_channel_workflow(event, *, action="message")`
- Produces: `ChatDispatcher.ack_channel_delivery(response)`
- Consumes: Hub prepare/execute/ACK API and `NormalizedChatResponse`

- [ ] **Step 1: Write failing client protocol tests with `httpx.MockTransport`**

Prove request order is prepare then execute, actual attachment bytes match declared hashes,
the durable operation ID exists before the progress callback fires, running duplicate and
delivered replay suppress terminal output, a terminal delivery token becomes a normalized
response, ACK is sent only after the caller reports successful render, and timeout/error
copy never promises a later response after the request has ended.

- [ ] **Step 2: Write failing dispatcher identity/parity tests**

Prove the identity service's canonical tenant/user overwrite adapter hints before submission,
strangers remain blocked, disabled workflow makes no Hub call, handled result bypasses the
engine, delegated/unknown result reaches the engine, and a replay with
`suppress_delivery=true` produces no second terminal.

- [ ] **Step 3: Run RED**

```bash
PYTHONPATH=/tmp/mira-py312-deps pytest -q \
  mira-bots/tests/test_channel_workflow_client.py \
  mira-bots/tests/test_dispatcher_gate.py
```

- [ ] **Step 4: Implement config validation and the two-phase client**

When `MIRA_CHANNEL_WORKFLOW_ENABLED=1`, require a valid HTTP(S) `HUB_URL`, normalized
`HUB_BASE_PATH`, non-empty `HUB_INGEST_TOKEN`, and UUID `MIRA_TENANT_ID`; raise
`ChannelWorkflowConfigError` during bot construction, before polling/socket mode starts.
When disabled, no new request is made. Do not read secrets into logs or exception strings.

- [ ] **Step 5: Implement normalized result rendering**

Map semantic results into platform-neutral blocks: identity key/value pairs, honest manual
candidate/verified state, canonical File/document operation IDs, answer paragraph, one block
per citation, and a `confirm_identity` button whose value is the prior operation UUID. Do not
recompute identity, trust, possession, applicability, or citations in Python.

- [ ] **Step 6: Run GREEN and timeout/replay mutations**

Run step 3. Mutate the client to execute before prepare, ACK before render, resend a delivered
result, and return “I'll send the answer later” on timeout; each must fail. Restore.

- [ ] **Step 7: Commit the client slice**

```bash
git add mira-bots/shared/channel_workflow.py \
  mira-bots/shared/chat/dispatcher.py \
  mira-bots/tests/test_channel_workflow_client.py \
  mira-bots/tests/test_dispatcher_gate.py
git commit -m "feat(bots): add canonical Hub workflow client"
```

### Task 6: Telegram and Slack thin-adapter migration plus complete reset

**Files:**
- Modify: `mira-bots/telegram/bot.py`
- Modify: `mira-bots/telegram/chat_adapter.py`
- Modify: `mira-bots/slack/bot.py`
- Modify: `mira-bots/slack/chat_adapter.py`
- Modify: `mira-bots/shared/chat/drive_context.py`
- Modify: `mira-bots/tests/test_telegram_hub_intake.py`
- Modify: `mira-bots/tests/test_telegram_photo_hub_wiring.py`
- Modify: `mira-bots/tests/test_slack_fast_paths.py`
- Create: `mira-bots/tests/test_channel_workflow_adapter_parity.py`
- Modify: `tests/integration/test_slack_pdf_intake.py`

**Interfaces:**
- Consumes: dispatcher `try_channel_workflow` and `ack_channel_delivery`
- Produces: Telegram/Slack transport order and callback handling only
- Produces: `clear_drive_context(source, session_key)`

- [ ] **Step 1: Add red Telegram ordering/intake/reset tests**

Use realistic update doubles from the existing suites. Assert the Danfoss photo/manual text
reaches the canonical gateway before local drive pack or PrintSense, the PDF is awaited (no
`create_task`) and returns durable IDs, a duplicate update renders one final, confirmation
callback posts `confirm_identity`, and `/new` rotates Hub state then clears engine,
PrintSense, Telegram-local drive context, shared drive context, and session memory.

- [ ] **Step 2: Add red Slack ordering/intake/reset tests**

Assert Slack downloads attachment bytes then calls canonical gateway before `pdf_handler` or
fast paths, uses `client_msg_id`/`ts` idempotency, renders and ACKs once, confirmation action
posts `confirm_identity`, and `/mira-reset` rotates the Hub workspace plus all legacy caches.

- [ ] **Step 3: Run adapter suites RED separately**

Keep the repository's known import contamination isolated:

```bash
PYTHONPATH=/tmp/mira-py312-deps pytest -q \
  mira-bots/tests/test_telegram_hub_intake.py \
  mira-bots/tests/test_telegram_photo_hub_wiring.py \
  mira-bots/tests/test_channel_workflow_adapter_parity.py

PYTHONPATH=/tmp/mira-py312-deps pytest -q mira-bots/tests/test_slack_fast_paths.py

pytest -q tests/integration/test_slack_pdf_intake.py
```

- [ ] **Step 4: Move canonical attempt ahead of Telegram business fast paths**

For text, photo, and PDF, normalize once, attach downloaded bytes, call the gateway, render
only when `handled` and not suppressed, and ACK only after successful send. If the Hub
explicitly delegates to PrintSense or the feature is disabled, continue the existing code.
Remove new-path `Analyzing...`, timeout, and fire-and-forget Hub messages; the progress
callback may emit one operation-ID-bearing message only after prepare returns.

- [ ] **Step 5: Move canonical attempt ahead of Slack business fast paths**

Download PDFs/images into the normalized attachment before the attempt. Replace the active
`pdf_handler` branch under the feature flag with the canonical result, retaining the old
handler only for flag-off rollback. Use Slack blocks only to render returned semantic blocks.

- [ ] **Step 6: Implement complete local reset hygiene**

Add deletion functions for both drive-context stores, call `session_memory.clear_session`
for raw and platform-prefixed keys, clear PrintSense/visual workspace and engine state, and
cancel any in-memory Telegram burst collector owned by the old chat. Canonical reset must
succeed or return an honest error before the client claims a fresh start.

- [ ] **Step 7: Run GREEN, parity, and electrical-print negative control**

Run step 3 plus:

```bash
PYTHONPATH=/tmp/mira-py312-deps pytest -q \
  mira-bots/tests/test_fast_paths_router.py \
  mira-bots/tests/test_telegram_nameplate_ask.py \
  mira-bots/tests/test_telegram_print_translator.py \
  mira-bots/tests/test_printsense_commercial_telegram.py
```

Mutate ordering so a local fast path runs first and mutate one reset clear call away; the
Danfoss and stale-state tests must fail. Restore.

- [ ] **Step 8: Commit the adapter slice**

```bash
git add mira-bots/telegram mira-bots/slack \
  mira-bots/shared/chat/drive_context.py \
  mira-bots/tests/test_telegram_hub_intake.py \
  mira-bots/tests/test_telegram_photo_hub_wiring.py \
  mira-bots/tests/test_slack_fast_paths.py \
  mira-bots/tests/test_channel_workflow_adapter_parity.py \
  tests/integration/test_slack_pdf_intake.py
git commit -m "fix(bots): route manuals through canonical Hub workflow"
```

### Task 7: Deployment fail-fast contract and architecture documentation

**Files:**
- Modify: `docker-compose.saas.yml`
- Modify: `docker-compose.staging-vps.yml`
- Modify: `mira-bots/docker-compose.yml`
- Modify: `docker-compose.staging.yml`
- Modify: `docker-compose.hub.yml`
- Modify: `docs/env-vars.md`
- Modify: `docs/architecture/convergence/REGISTRY.yaml`
- Modify: `docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md`
- Create: `tests/test_channel_workflow_config.py`

**Interfaces:**
- Consumes: Python `validate_channel_workflow_config`
- Produces: compose/env startup contract that cannot expose an enabled but unconfigured flow

- [ ] **Step 1: Write red executable configuration tests**

Parse/render each relevant compose with controlled environment values and assert:

- enabled Telegram and Slack both receive Hub URL/base/token and UUID tenant;
- Hub receives the same token;
- missing token or UUID tenant makes enabled config validation exit non-zero before bot start;
- flag-off config remains valid for rollback;
- no rendered config or error output contains the sentinel secret value.

- [ ] **Step 2: Run RED**

```bash
pytest -q tests/test_channel_workflow_config.py
```

- [ ] **Step 3: Wire the feature-gated environment consistently**

Add `MIRA_CHANNEL_WORKFLOW_ENABLED` and the same Hub variables to Telegram, Slack, and Hub in
production/staging/local compose. Remove the non-UUID `staging` fallback for services that
enable this flow; require the UUID when enabled through startup validation. Keep the default
flag `0`, because no secret/provider/deploy authorization has been granted.

- [ ] **Step 4: Update env docs and Architecture Registry**

Document owner, consumers, secret source, valid values, fail-fast behavior, staging-first
enablement, and rollback. Update registry observations so Hub owns the channel workflow and
bot nameplate/PDF logic is marked `LEGACY`/feature-gated rather than silently canonical.
Record every newly discovered drift rather than silently folding it into this slice.

- [ ] **Step 5: Run config tests GREEN and compose validation**

Use non-secret sentinels:

```bash
MIRA_CHANNEL_WORKFLOW_ENABLED=0 docker compose -f docker-compose.saas.yml config --quiet
MIRA_CHANNEL_WORKFLOW_ENABLED=0 docker compose -f docker-compose.staging-vps.yml config --quiet
pytest -q tests/test_channel_workflow_config.py
```

Do not run an enabled real deployment. The tests supply a UUID and fake token only inside
their subprocess environment.

- [ ] **Step 6: Commit config/docs**

```bash
git add docker-compose.saas.yml docker-compose.staging-vps.yml \
  mira-bots/docker-compose.yml docker-compose.staging.yml docker-compose.hub.yml \
  docs/env-vars.md docs/architecture/convergence/REGISTRY.yaml \
  docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md \
  tests/test_channel_workflow_config.py
git commit -m "chore(deploy): fail fast on channel workflow config"
```

### Task 8: Final verification, independent review, draft PR, and no-deploy handoff

**Files:**
- Modify: `docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md`
- Modify: `wiki/hot.md` or create the dated `wiki/hot.d/` entry selected by its schema
- Modify: draft PR body through `gh`

**Interfaces:**
- Consumes: all prior deliverables
- Produces: immutable verified SHA, Gate 7 evidence, pushed branch, draft PR, rollback and
  `PENDING-HUMAN` handoff

- [ ] **Step 1: Read and invoke verification-before-completion**

Read `superpowers:verification-before-completion` fully. Re-run every targeted red→green
suite from Tasks 1–7 without relying on prior output.

- [ ] **Step 2: Run affected lint/type/build/security suites**

```bash
cd mira-hub
npx eslint src/lib/channel-*.ts src/lib/service-request-context.ts src/app/api/channel-workflow
npx tsc --noEmit
npm run db:check-order
npm test

cd ..
PYTHONPATH=/tmp/mira-py312-deps pytest -q mira-bots/tests
pytest -q tests/integration/test_slack_pdf_intake.py tests/test_channel_workflow_config.py tests/test_architecture.py
```

If a repository-wide suite has pre-existing/flaky failures, capture exact failing test names
and compare the same selection against a clean `origin/main` worktree; never compare failure
counts alone.

- [ ] **Step 3: Verify diff scope and all introduced symbols**

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Use CodeGraph (or `rg` only for pending/unindexed files) to ground every new referenced
symbol, import, route export, DB column, state literal, environment variable, and function
signature. Confirm the preserved untracked user document is absent from `git diff` and the
index.

- [ ] **Step 4: Commit any final evidence/docs on a clean tested tree**

```bash
git add docs/architecture/convergence/units/CU-CHANNEL-WORKFLOW.md wiki/hot.md
git commit -m "docs(workflow): record channel convergence evidence"
```

If `wiki/hot.md` routes this work to a dated `wiki/hot.d` entry, stage that file instead.

- [ ] **Step 5: Push and open/update a draft PR**

```bash
git push -u origin fix/channel-neutral-manual-workflow
gh pr create --draft \
  --title "fix(workflow): converge channel manual intake" \
  --body-file /tmp/channel-workflow-pr-body.md
```

The PR body must contain the ten-answer root-cause map, before/after architecture, R0 and
rollback, fixture/test evidence, negative controls, config gate, dependencies, #3295 as
related-only, CU-03 collision avoidance, no-merge/no-deploy statement, and all
`PENDING-HUMAN` actions. Do not include secrets or claim live proof not performed.

- [ ] **Step 6: Run Gate 7 on the exact pushed SHA**

Read and follow the repo Gate 7 command. Run:

```bash
python tools/gate7_review.py <draft-pr-number>
```

Confirm reported effort is xhigh. Fix every substantiated BLOCKER/HIGH, rerun affected and
full verification, commit/push, and re-run Gate 7 on the changed SHA until PASS. Record false
positives with evidence rather than blindly changing correct code.

- [ ] **Step 7: Check CI without merging**

```bash
gh pr checks <draft-pr-number> --watch
```

Record the exact final SHA and each check. Compare any red check against `origin/main` using
the repository policy; do not merge, auto-merge, or deploy.

- [ ] **Step 8: Evaluate live-proof authorization honestly**

Run a read-only configuration check. If migration 078, service token, approved nameplate
provider, and official-discovery service are not already valid in staging, stop live replay
at this exact handoff:

```text
PENDING-HUMAN: Mike must approve staging migration/deploy and provision/confirm
HUB_INGEST_TOKEN + ADR-0036-approved nameplate/manual provider configuration in
Doppler factorylm/stg. No secret mutation or deploy was authorized.
```

If and only if those items are already valid and Mike separately gives staging GO, replay
the exact Danfoss sequence through real Telegram and Hub/mobile, recording operation IDs,
timing, route, identity, official URL, File/document/link IDs, cited answer, and one terminal.

- [ ] **Step 9: Read and invoke finishing-a-development-branch**

The user already selected the “commit/push/draft PR, stop before merge/deploy” outcome. Use
the skill to verify the branch is ready, then report original/final SHAs, branch/worktree,
claim/issue/PR, root causes, before/after architecture, changed services/files, red-first and
green evidence, negative controls, CI/Gate 7/live status, rollback, and remaining human
actions. Do not present or execute a merge option without Mike's explicit GO.
