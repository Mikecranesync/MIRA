# Turn Flight Recorder — OpenTelemetry per-turn tracing for notebook chat

**Status:** design accepted for implementation (staging-first) — 2026-09-22
**Claim:** #3939 · branch `feat/otel-turn-flight-recorder` · base `c1398461a`
**Acceptance case:** `docs/proofs/2026-09-22-pixel9a-staging-first-session-log.md` (+ `…-session/persisted-turns.json`)
**Goal:** after a bad answer on the phone, Mike opens ONE trace (or one Turn Evidence Packet) and sees which stage failed — vision → persistence → identity → retrieval → context assembly → generation → answer gate — without anyone SSHing into staging.

## 1. Decision

```
Pixel (MIRA Staging app)                          mira-hub (Next.js 16, Node 22, standalone)
  POST /look  ──(photo)──────────────────────▶  instrumentation.ts → NodeSDK (OTel JS)
  POST /chat  ──(question + visualEvidence)──▶     ├─ auto: http (inbound), undici (provider fetch), pg
                                                   ├─ manual domain spans (mira.turn + 9 children)
                                                   ├─ BatchSpanProcessor → OTLP/HTTP protobuf ──▶ Langfuse (staging project)
                                                   └─ TurnRecorder → decision_traces (packet + otel_trace_id + anomalies)
                                                            ▲ single writer: persist-usage.ts
  GET /api/equipment-notebooks/{id}/turns/{turnId}/diagnostics  ◀── Mike reads packet + anomalies + trace id (no SSH)
```

- **OpenTelemetry JS Node SDK, direct OTLP/HTTP (protobuf) export. No Collector in v1 (Option A).** One service, one backend; the SDK's `BatchSpanProcessor` already bounds memory and never blocks the request. A Collector is inserted later by changing `OTEL_EXPORTER_OTLP_ENDPOINT` only — no code change.
- **Backend = Langfuse cloud (US), configuration only.** Verified 2026-09-22: `POST https://us.cloud.langfuse.com/api/public/otel/v1/traces` with `Authorization: Basic base64(pk:sk)` from Doppler `factorylm/stg` returns 200; without auth 401. MIRA code knows only OTLP + env vars. Langfuse maps `gen_ai.*` spans to its Generation view natively.
- **Caveat recorded:** Doppler `dev`/`stg`/`prd` currently hold the SAME Langfuse project keys. v1 tags every span with `deployment.environment.name=staging` (resource attribute, filterable in Langfuse). A dedicated staging Langfuse project is a Mike-side account action (see §9).
- **Reuse, don't duplicate:** the durable per-turn record extends `decision_traces` (the canonical audit/spend ledger, single TS writer `persistTurnUsage`) and correlates to `equipment_notebook_turns` by row id + `client_request_id`. No new registry (materialized-evidence rule 15).
- **Traces first.** No OTel logs/metrics program. Existing `console.*` logs stay; structured error events keep the `persist-usage.ts` JSON shape and now carry `traceId`.
- **Mobile v1 unchanged.** Server ingress is the root span. The `/look` trace and the `/chat` trace are joined server-side with an OTel **span link** (chat → the look trace of the same `fileId`) and by `vision_trace_id` on the packet. Client `traceparent` is a documented follow-up (needs an APK + guarded transport file).

## 2. Correlation model (what already exists — use it)

| Identifier | Exists today | Where |
|---|---|---|
| `clientRequestId` | yes — client-minted UUID on the chat body, validated by regex, persisted (088) and used for the idempotency claim (089) | `route.ts` ~699, `recordTurn({clientRequestId})` |
| `threadId` | yes — client conversation id, persisted (087) | `route.ts` ~695 |
| `notebookId` | yes — route param | |
| `turn row id` | yes — `equipment_notebook_turns.id`, minted at `recordTurn` INSERT (after stream close) | `equipment-notebooks.ts` recordTurn |
| `fileId` | yes — `namespace_direct_uploads.id` from `/look` (`parkOrReuseFile`) | `look/route.ts` ~156 |
| `equipmentEntityId` / `assetUnsPath` | yes — turn snapshot (081) | `resolveBoundAsset` |
| `decision_traces.trace_id` | yes — UUID PK of the ledger row (NOT the OTel trace id) | `persist-usage.ts` |
| OTel `trace_id` | **new** — 32-hex, minted by the SDK at ingress | root span |

Rules:
- `mira.turn.id` on spans = `clientRequestId` when present, else a server-minted UUID (`crypto.randomUUID()`) at request.receive. Never wait for the DB row.
- After `recordTurn` returns, set `mira.turn.row_id` on the root span and write both ids to the packet.
- The SSE response carries header `x-mira-trace-id: <32-hex>` and an additive frame `{"kind":"trace","traceId","turnId"}` emitted FIRST (before any `content`). `FRAME_KINDS` in `notebook-chat-types.ts` must include `trace` (lockstep rule). Existing clients ignore unknown kinds.
- Root span ends AFTER persistence (recordTurn + persistTurnUsage), not at `controller.close()` — persistence failures must land inside the trace.

## 3. Span model

Root: `mira.turn` (SpanKind SERVER child of Next's own HTTP span is fine — do not fight Next's root; if Next's span exists, `mira.turn` is its child and carries the domain attributes). Children, in order:

| Span | Where (chat route unless noted) | Required attributes (low-cardinality; ids allowed) |
|---|---|---|
| `request.receive` | body parse → claim | `mira.notebook.id`, `mira.thread.id`, `mira.turn.id`, `mira.turn.mode` (general\|grounded), `mira.request.has_visual_evidence`, `mira.request.has_machine_evidence`, `mira.request.message_chars`, `mira.request.source_doc_count`, `mira.client.flavor` if a safe header exists |
| `attachment.persist` | `/look` route: `parkOrReuseFile` + `attachFileToTargets` | `mira.file.id`, `mira.file.mime`, `mira.file.bytes`, `mira.file.sha256_present`, `mira.file.dedup_hit`, `mira.file.link_ok` |
| `vision.analyze` | `/look` route: `togetherVisionCall` | `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.*` if returned, `mira.vision.observation_chars`, `mira.vision.hazard_count`, `mira.vision.ok`; span name `chat <model>` |
| `evidence.materialize` | chat route visualEntry block (`photoLinkedToTarget`) | `mira.visual.file_id`, `mira.visual.link_verified`, `mira.visual.observation_available` (a look packet with observation text exists for this file), `mira.visual.observation_in_context` (was any observation text projected into the prompt — today always false), `mira.evidence.count` |
| `identity.resolve` | `resolveBoundAsset` | `mira.identity.ran`, `mira.identity.state` (notebook `identityStatus`), `mira.asset.id` (entity id) if bound, `mira.identity.manufacturer_present`, `mira.identity.model_present`, `mira.identity.candidate_count` (0 when no nameplate flow ran), `mira.identity.unresolved_reason` (`not_bound` \| `nameplate_flow_not_invoked` \| …) |
| `retrieval.execute` | chunks block | `mira.retrieval.strategy` (`skipped_general_mode` \| `notebook_sources_bm25` \| `machine_history` …), `mira.retrieval.executed` (bool), `mira.retrieval.candidate_count`, `mira.retrieval.returned_doc_ids` (array of ids, capped 32), `mira.retrieval.oem_corpus_searched` (false today), `mira.retrieval.zero_result_reason`, `mira.retrieval.prior_visual_observations_considered` (count) |
| `context.assemble` | prompt/messages build | **critical**: `mira.context.evidence_doc_ids` (ids passed to generation), `mira.context.chunk_count`, `mira.context.visual_evidence_count` (observation texts included), `mira.context.identity_included` (bool), `mira.context.history_turns`, `mira.context.prompt_chars` (approx), `mira.context.system_prompt_kind` (general\|grounded\|machine) |
| `chat <model>` (gen_ai) | each provider attempt in the cascade | `gen_ai.operation.name=chat`, `gen_ai.provider.name` (groq\|cerebras\|together\|gemini), `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id` if present, `gen_ai.usage.input_tokens/output_tokens`, `mira.gen.attempt_index`, `mira.gen.route_reason`, `mira.gen.outcome` (served\|http_error\|exception\|client_stop), `mira.gen.has_image_input=false`, `mira.gen.has_observation_text` — content (`gen_ai.input.messages`/`gen_ai.output.messages`) ONLY when `MIRA_OTEL_CAPTURE_CONTENT=1`, sanitized + truncated |
| `answer_gate.evaluate` | isRefusal + status decision | `mira.answer_gate.invoked`, `mira.answer_gate.decision` (answered\|insufficient_evidence\|blocked\|error), `mira.answer_gate.reason` (`gate_g_no_evidence` \| `refusal_regex` \| `safety_stop:<trigger-name>` \| `served` \| …), `mira.answer_gate.answer_chars`, `mira.answer_gate.refusal_phrase_matched`, `mira.answer_gate.evidence_phrase_matched`, `mira.safety.classification` (none\|hazard_directive\|safety_stop), `mira.evidence.sufficient` |
| `turn.persist` | recordTurn + persistTurnUsage | `mira.turn.row_id`, `mira.persist.evidence_entries`, `mira.persist.outcome` (ok\|failed), `mira.persist.error_code`, `mira.packet.persisted` |

Resource (set once in `instrumentation.node.ts`): `service.name` (from `OTEL_SERVICE_NAME`, default `mira-hub`), `service.version` = `MIRA_APP_VERSION`, `deployment.environment.name` from `OTEL_RESOURCE_ATTRIBUTES` (Doppler), `vcs.ref.head.revision`… keep it simple: `mira.git_sha` = `MIRA_GIT_SHA` as a resource attribute (the stable `service.version` stays the app version).

Attribute policy: an **allowlist** in the tracing helper — only `mira.*`, `gen_ai.*`, and standard `http.*/db.*` from auto-instrumentation. Values are scalars or short id arrays. Any key not on the allowlist is dropped by a `SpanProcessor` in `onEnd`/`onStart`; any value matching secret shapes (`Bearer `, `pk-lf-`, `sk-lf-`, `gsk_`, `csk-`, `next-auth.session-token`, `Cookie`) is redacted. Auto-instrumentation header capture stays OFF.

## 4. Turn Evidence Packet (durable, compact, references only)

Migration `090_decision_traces_turn_packet.sql` (additive, idempotent, TEXT tenant, no backfill, `GRANT` already present from 032):

```sql
ALTER TABLE decision_traces
  ADD COLUMN IF NOT EXISTS otel_trace_id     TEXT,      -- 32-hex OTel trace id
  ADD COLUMN IF NOT EXISTS turn_id           UUID,      -- equipment_notebook_turns.id (no FK: cross-runtime ledger)
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS notebook_id       UUID,
  ADD COLUMN IF NOT EXISTS environment       TEXT,      -- deployment.environment.name
  ADD COLUMN IF NOT EXISTS git_sha           TEXT,
  ADD COLUMN IF NOT EXISTS evidence_packet   JSONB,     -- schema below, ids only
  ADD COLUMN IF NOT EXISTS anomalies         JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS decision_traces_otel_trace_idx ON decision_traces (otel_trace_id);
CREATE INDEX IF NOT EXISTS decision_traces_turn_idx       ON decision_traces (turn_id);
CREATE INDEX IF NOT EXISTS decision_traces_notebook_ts_idx ON decision_traces (notebook_id, ts DESC);
```

`evidence_packet` (TS type `TurnEvidencePacket`, version `"1"`):

```jsonc
{
  "v": "1", "kind": "chat" | "look",
  "trace_id": "…32hex…", "vision_trace_id": "…|null",
  "environment": "staging", "git_sha": "…", "service_version": "…",
  "ids": { "tenant_id", "notebook_id", "thread_id", "turn_id", "client_request_id", "owner_user_id",
           "file_ids": [], "visual_observation_ids": [], "asset_id", "equipment_entity_id", "asset_uns_path" },
  "request": { "mode": "general|grounded", "message_chars": 0, "has_visual_evidence": false, "has_machine_evidence": false, "source_doc_count": 0 },
  "vision": { "ran": false, "provider", "model", "latency_ms", "observation_chars", "hazard_count", "ok" },
  "visual_evidence": { "file_id", "link_verified", "observation_available", "observation_in_context", "prior_turn_observation_count": 0 },
  "identity": { "ran": true, "state": "unknown", "candidate_count": 0, "selected_entity_id": null, "manufacturer_present": false, "model_present": false, "order_number_present": false, "unresolved_reason": "…" },
  "retrieval": { "strategy": "skipped_general_mode", "executed": false, "candidate_count": 0, "returned_doc_ids": [], "oem_corpus_searched": false, "zero_result_reason": "…" },
  "context": { "evidence_doc_ids": [], "chunk_count": 0, "visual_evidence_count": 0, "identity_included": false, "history_turns": 0, "prompt_chars": 0 },
  "generation": { "attempts": [{ "provider", "model", "outcome", "latency_ms", "route_reason", "response_id" }], "served_provider", "served_model", "input_tokens", "output_tokens", "has_image_input": false, "has_observation_text": false },
  "answer_gate": { "invoked": true, "decision": "answered", "reason": "served", "answer_chars": 0, "refusal_phrase_matched": false, "evidence_phrase_matched": false, "safety_classification": "none", "evidence_sufficient": false },
  "persistence": { "turn_row_id", "evidence_entries": 0, "outcome": "ok", "error_code": null },
  "timings_ms": { "total", "vision", "identity", "retrieval", "context", "generation_ttfb", "generation", "persist" },
  "errors": [ { "stage", "code" } ]
}
```

Never in the packet: message text, answer text, chunk text, prompts, image bytes, cookies, headers, keys. (The ledger's existing `user_question`/`recommendation` columns keep their current PII-sanitised behaviour from `persistTurnUsage`; this design does not add content.)

**Writer:** `persistTurnUsage(scope, usage, packet?)` gains an optional third argument and fills the new columns — one row per turn, one writer. The chat route calls it on EVERY completed path (answered / abstain / stopped / error), not only under `MIRA_CANONICAL_SEAM`; on the legacy cascade the `TurnUsage` is built from the served provider/model with `null` tokens and `routeReason="legacy_cascade"` (unknown cost stays NULL — existing rule). The `/look` route writes a `kind:"look"` row via the same function (`platform="hub_notebook_look"`, `user_question=""`).

**TurnRecorder** (`mira-hub/src/capabilities/observability/turn-recorder.ts`): a per-request accumulator the route feeds as stages complete.

```ts
const rec = startTurnRecorder({ kind: "chat", tenantId, notebookId, threadId, clientRequestId, ownerUserId, mode, ... });
rec.stage("retrieval", { strategy: "skipped_general_mode", executed: false, ... });   // also sets attrs on the active span
rec.generation.attempt({...}); rec.answerGate({...}); rec.persistence({ turnRowId, ... });
const { packet, anomalies } = rec.finish();        // pure; deterministic checks run here
await persistTurnUsage(scope, usage, { packet, anomalies, otelTraceId: rec.traceId });
```
`finish()` never throws; every stage method is try/caught internally. If the SDK is not started, `rec.traceId` is `null` and everything else still works (packet without trace id).

**Read surface:** `GET /api/equipment-notebooks/[id]/turns/[turnId]/diagnostics` → `{ traceId, turnId, packet, anomalies, viewerUrl? }` (session-scoped: `sessionOr401`, tenant predicate on the query; `viewerUrl` only when `MIRA_TRACE_VIEWER_URL_TEMPLATE` is set, e.g. `https://us.cloud.langfuse.com/project/<id>/traces/{traceId}`). Also `GET …/[id]/turns/diagnostics?limit=20` listing recent packets for the notebook (ids + decision + anomaly codes only).

## 5. Deterministic anomaly checks (v1, pure functions over the packet)

| Code | Fires when | Acceptance case |
|---|---|---|
| `PHOTO_WITH_NO_OBSERVATIONS` | `ids.file_ids.length>0 && vision.ran && vision.observation_chars==0` (look) — or chat: `has_visual_evidence && !visual_evidence.observation_available` | — |
| `VISUAL_EVIDENCE_DROPPED` | `(visual_evidence.observation_available \|\| visual_evidence.prior_turn_observation_count>0) && context.visual_evidence_count==0` | turns 2 and 3 |
| `EQUIPMENT_ANSWER_WITH_NO_EVIDENCE` | `(identity.state!="unknown" \|\| request.has_visual_evidence \|\| request.has_machine_evidence) && answer_gate.decision=="answered" && context.evidence_doc_ids.length==0 && context.visual_evidence_count==0` | turns 1, 2, 3 |
| `IDENTITY_PIPELINE_DROPPED` | `identity.ran && (visual_evidence.observation_available \|\| identity.candidate_count>0) && identity.state=="unknown" && !identity.unresolved_reason` | turn 2 (order number never became identity) |
| `STAGING_TO_PROD_ROUTE` | `environment=="staging"` and any resolved destination host (provider/internal URLs, OTLP endpoint) is a known production host — computed once at SDK start and stamped on every packet | — |
| `GENERIC_ANSWER_UNGROUNDED_CLAIM` (bonus, cheap) | `answer_gate.decision=="answered" && retrieval.executed==false && generation.has_image_input==false && answer_text matched /\d+(\.\d+)?\s*(in|mm|cm|°C|V|A)\b/` — evaluated in-route on the answer text, only the boolean is stored | turns 1 and 3 |

Anomalies are stored on the row, set as `mira.anomalies` (array of codes) on the root span, and emitted as one structured log line `{"event":"turn.anomaly","traceId","turnId","codes":[…]}`. Toggle: `MIRA_TURN_ANOMALY_CHECKS` (default `1`). Diagnostics never fail the technician's request.

**Replay fixture:** `mira-hub/src/capabilities/observability/__fixtures__/pixel-2026-09-22/*.json` — three packets hand-built from `persisted-turns.json` + the session log (no fabricated traces; `trace_id: null`, `fixture: true`). A test asserts exactly which codes fire per turn (table above).

## 6. Configuration (standard OTel first)

| Var | Where | Staging value |
|---|---|---|
| `OTEL_SERVICE_NAME` | Doppler stg → compose passthrough | `mira-hub` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Doppler stg | `https://us.cloud.langfuse.com/api/public/otel` (SDK appends `/v1/traces`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Doppler stg | `http/protobuf` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Doppler stg | `Authorization=Basic <base64(pk:sk)>` |
| `OTEL_RESOURCE_ATTRIBUTES` | Doppler stg | `deployment.environment.name=staging` |
| `OTEL_TRACES_SAMPLER` / `_ARG` | Doppler stg | `parentbased_always_on` (100%) |
| `MIRA_OTEL_CAPTURE_CONTENT` | MIRA-specific | `0` (staging may set `1` deliberately) |
| `MIRA_TURN_ANOMALY_CHECKS` | MIRA-specific | `1` |
| `MIRA_TRACE_VIEWER_URL_TEMPLATE` | MIRA-specific, optional | Langfuse trace URL template |

No endpoint ⇒ SDK does not start; `@opentelemetry/api` no-op tracer; packets still written (with `otel_trace_id=null`). `/api/health` gains `telemetry: { tracing: "enabled"|"disabled", exporter: "otlp-http"|null, environment }` — no secrets, no endpoint host.

Compose: `docker-compose.staging-vps.yml` stg-mira-hub gets `${VAR:-}` passthrough for all of the above. `docs/env-vars.md` documents them. Production compose is NOT touched in this PR.

## 7. Failure behaviour

- Export is async and batched (`BatchSpanProcessor`: `maxQueueSize` 2048, `exportTimeoutMillis` 10000, `scheduledDelayMillis` 5000). A dead backend drops spans, never blocks a response, never grows memory. Exporter errors are logged once per minute (rate-limited), not per turn.
- `sdk.shutdown()` on SIGTERM to flush on redeploy.
- Every recorder/packet call is wrapped; a packet write failure is the existing `turn.usage.persist_failed` event (now with `traceId`).

## 8. Privacy (what is intentionally not captured)

Never: cookies, `Authorization`/provider keys, next-auth tokens, signed evidence tokens, Doppler values, image bytes, prompts, technician text, answer text, chunk text — in spans, span events, or the packet. Ids/counts/flags/durations only. Content capture (`gen_ai.input.messages`/`gen_ai.output.messages`) exists behind `MIRA_OTEL_CAPTURE_CONTENT=1`, sanitized (IP/MAC/serial patterns, mirroring `langfuse_setup._scrub`) and truncated (4 KB), and is OFF in staging by default and never enabled in production by this work.

## 9. Rollout

1. PR → CI green (Hub Unit Tests picks up `src/**/*.test.ts`), exact-head independent review, human merge.
2. Doppler `factorylm/stg`: set the six `OTEL_*` values above (agent can set; Mike informed). Optional Mike action: create a dedicated **staging** Langfuse project and swap the keys in `OTEL_EXPORTER_OTLP_HEADERS` so staging traces stop sharing the production project.
3. `apply-migrations.yml` dry-run → apply on staging for `090`.
4. `deploy-staging.yml` on the merged SHA (staging-only; Mike's standing authorization covers staging after gates).
5. Real Pixel turn with a photo → find the trace in Langfuse by `x-mira-trace-id` / the `trace` frame / the diagnostics endpoint → record trace id + turn id in `docs/proofs/`.

## 10. Lane ownership (non-overlapping files)

| Lane | Owns |
|---|---|
| **I1 OTel foundation** | `mira-hub/package.json` + `bun.lock` + `package-lock.json` (OTel deps), `mira-hub/src/instrumentation.ts`, `mira-hub/src/instrumentation.node.ts`, `mira-hub/src/capabilities/observability/tracing.ts` (tracer, `withSpan`, allowlist/redaction processor, `activeTraceId()`), `…/config.ts`, `…/__tests__/tracing.test.ts`, `mira-hub/src/app/api/health/route.ts` (+ its test), `docker-compose.staging-vps.yml`, `docs/env-vars.md` |
| **I3 packet + anomalies** | `mira-hub/db/migrations/090_decision_traces_turn_packet.sql`, `…/observability/turn-evidence-packet.ts` (types + builder), `…/observability/turn-recorder.ts`, `…/observability/anomalies.ts`, `…/observability/__fixtures__/pixel-2026-09-22/*`, `…/observability/__tests__/{packet,anomalies,recorder}.test.ts`, `mira-hub/src/lib/inference/persist-usage.ts` (+ its tests), `mira-hub/src/app/api/equipment-notebooks/[id]/turns/[turnId]/diagnostics/route.ts` and `…/turns/diagnostics/route.ts` (+ tests) |
| **I2 route wiring** (wave 2) | `…/[id]/chat/route.ts`, `…/[id]/look/route.ts`, `mira-hub/src/lib/notebook-chat-types.ts` (`trace` frame), `mira-hub/src/lib/equipment-notebooks.ts` only if `recordTurn` must return more than the id, route tests under `mira-hub/src/app/api/equipment-notebooks/__tests__/` (new files only: `chat-flight-recorder.test.ts`, `look-flight-recorder.test.ts`) |
| **I4 tests / security / docs** (wave 2) | `…/observability/__tests__/{redaction,propagation,exporter-down,staging-isolation}.test.ts`, `docs/runbooks/turn-flight-recorder.md`, `docs/adr/0037-otel-turn-flight-recorder.md`, staging validation plan section, `docs/observability/README` pointer |

Interfaces between lanes are the exports named in §4 and `tracing.ts`: `getTracer()`, `withSpan(name, attrs, fn)`, `setSpanAttrs(attrs)`, `activeTraceId()`, `addSpanLink(traceId, spanId)`, and `startTurnRecorder(...)`/`TurnRecorder`. I1 and I3 ship those signatures exactly; I2 consumes them.
