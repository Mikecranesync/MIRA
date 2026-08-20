# MIRA-1000 / P0001 — Current-to-Target Map

**Prompt:** P0001 — Discovery and Convergence
**Executed:** 2026-08-19
**Baseline main:** `5dfcbb8940bc2e724cf2b9b111f1837182f20688`
**Parent architecture PR:** #3339
**Code changed by this prompt:** none (docs only)

> **Headline.** The divergence MIRA-1000 asks for is **much smaller than the PRD assumes**, because
> the shared runtime already exists. All 13 client surfaces already call one entry point
> (`Supervisor.process`), every current provider is already OpenAI-compatible through one function,
> the OpenAI SDK and `OPENAI_API_KEY` plumbing are already in the repo and in prod compose, and
> 26 deterministic MCP tools already exist. The real gaps are **four**: no tool-calling in the
> provider contract, no real streaming anywhere, cost telemetry that cannot answer §23, and a
> **doctrine conflict** that must be ratified before any Cloud Gold chat code ships.

---

## 0. Coordination check (per the global multi-session protocol)

```
git fetch origin main            → 5dfcbb894
gh pr list --state open          → 100 open PRs
MIRA-1000 claims                 → only #3339 (the architecture anchor)
PRs touching mira-1000/ or engine.py → #3339 (docs), #3191, #2985, #2984, #2983 (engine.py)
```

**Overlap risk:** four open PRs touch `mira-bots/shared/engine.py`. P0001 is discovery-only and
changes no code, so there is no collision. **P0002 must re-run this check** — the seam lives next
to `engine.py`.

---

## 1. The production turn path (answered)

```
client surface  ──► Supervisor.process(...)  ──► Supervisor.process_full(...) ──► InferenceRouter.complete(...)
                                                                                        │
                                                                            _call_openai_compat(provider, …)
                                                                                        │
                                                                       Groq ──► Cerebras ──► Together
```

| Stage | Exact location |
|---|---|
| HTTP entry (VPS chat) | `mira-pipeline/main.py:437` `POST /v1/chat/completions` |
| Runtime entry | `mira-bots/shared/engine.py:2272` `Supervisor.process()` → `str` |
| Structured entry | `mira-bots/shared/engine.py:2960` `Supervisor.process_full()` → `dict` (`reply`, `confidence`, `trace_id`, `next_state`) |
| Provider selection | `mira-bots/shared/inference/router.py:459` `InferenceRouter.complete()` |
| Cascade definition | `router.py:253` `_build_providers()` |
| Single HTTP call | `router.py:530` `_call_openai_compat()` |

---

## 2. The capability table

| MIRA-1000 capability | Current implementation | Runtime path | Env/flag state | Evidence it is live | Keep / wrap / replace | Cloud impact | On-Prem impact | Gap |
|---|---|---|---|---|---|---|---|---|
| Provider routing | `InferenceRouter` `router.py:330` | all chat turns | `GROQ/CEREBRAS/TOGETHERAI_API_KEY` | 11 prod call sites | **wrap** | add 4th provider or seam above | unchanged | no tools/stream/policy in contract |
| Provider abstraction | `_Provider` dataclass `router.py:240` | cascade | env-built | `_build_providers()` | **keep** | OpenAI fits this shape *for Chat Completions only* | unchanged | not Responses-API-shaped |
| Local inference | Open WebUI/Ollama fallback | cascade tail | `INFERENCE_BACKEND=local` | CLAUDE.md build state | **keep** — this is On-Prem | none | is the baseline | no parity harness |
| Conversation state | `session_manager.py:23` `conversation_state` **SQLite** | every turn | `MIRA_DB_PATH` | table created at import | **wrap** | cross-client continuity needs shared store | same | SQLite is per-container, not per-tenant |
| Streaming | `mira-pipeline/main.py:1064` `_stream_response()` | `/v1/chat/completions` | always | SSE emitted | **replace** | **fake** — see §4 | same | no token streaming exists |
| Telegram | `mira-bots/telegram/bot.py` | own `Supervisor()` | prod bot | live | **keep** | renders MIRA | same | own instance |
| Slack | `mira-bots/slack/bot.py` | own `Supervisor()` | prod | live | **keep** | renders MIRA | same | own instance |
| Web/Hub, Ask, email, gchat, teams, whatsapp, reddit | 13 sites total (§3) | each own `Supervisor()` | mixed | grep-verified | **keep** | already converged | same | instance-per-adapter |
| Approved retrieval | `neon_recall.py:822` `recall_knowledge()`; `_product_search():485` | engine | `MIRA_ENFORCE_APPROVED_RETRIEVAL` | prod corpus | **keep — expose as tool** | first Gold tool | reused | not model-callable |
| Evidence / citations | `citation_compliance.py` (`evaluate_citation_relevance:357`) | post-reply | `MIRA_CITATION_ENFORCE` | prod | **keep** | must wrap OpenAI output too | reused | assumes single-shot reply, not tool loop |
| Context contract | `technician_context.py`; `materialized_evidence/context_contract.py` | assembly | **`MIRA_CONTEXT_CONTRACT` default OFF** | ADR-0033 *Proposed* | **keep — adopt** | this *is* §14 | shared | **built, not adopted — no prod call site** |
| Knowledge graph | `kg_entities`/`kg_relationships`; `mira-mcp/server.py:681,721` | MCP | live | prod tables | **keep — expose as tool** | Gold tool | reused | not on chat path |
| UNS identity | `uns_resolver.py`; `uns_source` param `engine.py:2272` | every turn | — | direct-connection rule | **keep** | unchanged | unchanged | none |
| CMMS / work orders | `mira-mcp/server.py:331–434` (9 tools) | MCP | live | Atlas | **keep** | write path needs approval | reused | no approval wrapper on tool call |
| Tool registry | **26 `@mcp.tool` in `mira-mcp/server.py`** | MCP | live | grep count | **keep — re-expose** | §17 largely built | reused | no schema/scope/side-effect metadata |
| RBAC / tenant | `tenant_id` threaded through `process()`; RLS | every turn | — | prod | **keep** | unchanged | unchanged | not enforced *per tool call* |
| Cost telemetry | `router.py:685` `write_api_usage()` → `api_usage` **SQLite** | every call | `MIRA_DB_PATH` | table at `router.py:705` | **replace** | see §7 | same | **missing 8 of §23's fields** |
| Evals | `tests/eval/`, `tests/regime*`, `conversation_suite` | CI | live | CI jobs | **keep — extend** | §24 rides these | parity harness | no Gold behavioral suite |
| OpenAI SDK | `printsense/interpret.py:349` lazy `openai.OpenAI(...)` | print vision only | `PRINT_VISION_PROVIDER=openai` | CHANGELOG v3.153.1 | **reuse** | **SDK + key already plumbed** | n/a | scope-limited by doctrine (§8) |
| `OPENAI_API_KEY` plumbing | `docker-compose.saas.yml:287,395`; `staging-vps.yml:463` | containers | mapped | compose | **reuse** | **no new infra needed** | n/a | prd Doppler value is human-only |

---

## 3. Single-source-of-truth question (answered: mostly already true)

All 13 surfaces instantiate `Supervisor` and call the **same** `process()`:

```
ask_api/app.py · email_adapter/ses_webhook.py · gchat/bot.py · reddit/bot.py
slack/bot.py · teams/bot.py · telegram/bot.py · whatsapp/bot.py
mira-pipeline/main.py · benchmarks ×2 · scripts ×2
```

`process()` already carries `platform`, `tenant_id`, `mira_user_id`, `uns_source`, `tag_evidence`,
`live_tags`, `retrieval_query` — i.e. **client normalization is already a solved problem**.

**The divergence is not reasoning, it is instantiation and return type.** Each adapter builds its
own `Supervisor`, and `process()` returns a bare `str`. `process_full()` returns a 4-key dict. Neither
can express a tool call, a citation set, an approval request, or a token stream.

**Smallest route to one logical runtime:** keep `process()` as the contract; widen the *return* to a
structured turn result; leave the 13 call sites unchanged.

---

## 4. Streaming — a PRD assumption the repo contradicts

`mira-pipeline/main.py:1034` `_stream_response(reply, …)` takes the **already-complete reply string**
and emits it as **one** `chat.completion.chunk`, then `[DONE]`.

```python
def _stream_response(reply: str, completion_id: str, created: int):
    """Yield SSE chunks in OpenAI streaming format."""
    async def _generate():
        chunk = {... "delta": {"role": "assistant", "content": reply} ...}   # the WHOLE reply
```

**No token-level streaming exists anywhere in MIRA.** §29 ("responses stream correctly") is therefore
not a provider-only change: it requires provider → runtime → adapter plumbing, because
`Supervisor.process()` is `async def … -> str` and cannot yield.

---

## 5. The provider seam (the core recommendation)

### Two candidate seams

**Seam A — a 4th `_Provider` entry (≈20 lines).**
`_call_openai_compat` already speaks OpenAI Chat Completions. Adding
`api.openai.com/v1/chat/completions` is nearly free and inherits sanitization, retries, budget
tracking, gibberish detection and usage logging.
❌ **But it forecloses the PRD.** Chat Completions gives no Responses-API server-side conversation
state, no typed streaming events, and different tool semantics. It is a *cost/quality experiment*,
not Cloud Gold.

**Seam B — `InferenceProvider` above the router (recommended).**

```
Supervisor.process_full()
        │
        ▼
InferenceProvider.respond(conversation, context, tools, policy, metadata) -> TurnResult
        ├── CascadeProvider   # wraps today's InferenceRouter verbatim  → On-Prem + free tier
        └── OpenAIResponsesProvider  # POST /v1/responses               → Cloud Gold
```

**Why above, not inside:** `InferenceRouter.complete()` is
`(messages, max_tokens, session_id, sanitize) -> (str, dict)`. Tools, policy and streaming cannot be
added inside it without breaking **11 production call sites** (`engine.py` ×7, `pm_extractor`,
`quality_gate`, `nameplate_worker`, `query_triage`, `rag_worker`). Wrapping preserves all of them.

**Minimum refactor:** introduce the interface + `CascadeProvider` that delegates to the existing
router **with zero behavior change**, and contract-test old-vs-new. That is exactly Phase 2, and it
is genuinely behavior-preserving.

**Rollback boundary:** one env flag selecting the provider; `CascadeProvider` is today's code path
byte-for-byte.

---

## 6. First five read-only tool candidates (ranked)

| # | Function | Location | Why first |
|---|---|---|---|
| 1 | `recall_knowledge()` | `neon_recall.py:822` | The core value prop; already tenant-scoped and approval-gated; citations already flow from it |
| 2 | `get_equipment_status()` / `get_fault_history()` | `mira-mcp/server.py:161,243` | Already `@mcp.tool`, already schema'd, read-only, asset-scoped |
| 3 | `kg_maintenance_context()` | `mira-mcp/server.py:681` | Takes `tenant_id` explicitly — tenant-safe by construction |
| 4 | `cmms_list_work_orders()` | `mira-mcp/server.py:383` | Read-only sibling of the write tools; proves the read/write split |
| 5 | `answer_question()` (drive packs) | `shared/drive_packs/` | Frozen pack data, deterministic, zero-token, highest evidence quality |

All five are **read-only, already tenant-scoped, and reused unchanged by On-Prem.**

---

## 7. Cost architecture (answered)

**Where stable prefix is built:** `router.py:148` `get_system_prompt()` + the tool schemas. This is
already a stable prefix — cacheable **as-is** provided dynamic context is appended *after* it.

**Prompt caching is compatible**, verified against current OpenAI docs (below): the cacheable prefix
is "instructions, tools, schemas, and shared context", minimum **1,024 tokens**, cached input billed
at **0.1×**, reported as **`usage.input_tokens_details.cached_tokens`** (Responses API), 30-minute
TTL via `prompt_cache_options.ttl` on GPT-5.6+.
⚠️ **Ordering hazard:** today's assembly interpolates asset/live data *into* the prompt. Any
timestamp, live tag value or retrieved chunk placed before the breakpoint destroys the cache.

**Flex candidates** (`service_tier: "flex"`, Batch rates, 429/408 risk, 10-min default timeout):
eval judging (`eval_score_rubric.py`), `quality_gate.py`, overnight enrichment, `pm_extractor.py`.
**Never** interactive technician chat.

**Batch candidates:** embeddings, `mira-crawler` document enrichment, KG construction, large eval
suites, bulk summarization.

**Telemetry gap — this is the §23 blocker.** `api_usage` (`router.py:705`) has:
`tenant_id, platform, session_id, input_tokens, output_tokens, model, has_image, response_time_ms, timestamp`.

§23 additionally requires: **`cached_input_tokens`, `cost_estimate`, `provider`, `tool_calls`,
`route_reason`, `success/failure`, `user`, `conversation`, `request`** — 9 missing fields. It is also
**SQLite at `/data/mira.db`**, per-container, so no cross-tenant cost view is possible today.

---

## 8. ⚠️ Doctrine conflicts — must be ratified before Cloud Gold chat code ships

**These are the most important findings in P0001.** Two standing repository rules currently
prohibit what MIRA-1000 §19 describes. Neither is a reason to abandon the program; both need an
explicit owner decision and an ADR.

### 8.1 Hard Constraint #2 (root `CLAUDE.md:29`)

> **Cloud LLMs:** Groq + Cerebras + Together cascade (all free-tier, OpenAI-compat) … Sole
> owner-authorized carve-out: the PrintSynth print-vision interpreter (PR #2661) — **print-photo
> vision only, never chat/diagnosis.**

Cloud Gold puts a **paid frontier model on the chat/diagnosis path** — precisely what the existing
carve-out excludes. The constraint must be amended, not quietly bypassed.

### 8.2 Zero-Token Architecture, Hard Rule 1 (`.claude/rules/zero-token-architecture.md`)

> Metered paid inference runs **ONLY** as the bounded acceptance test of the artifact currently being
> developed … Every paid lane declares a dollar budget BEFORE it runs and hard-stops at the budget.

Cloud Gold makes metered paid inference the **product runtime**, not a validation instrument. This
is the deeper conflict: it is not a detail, it is the rule's central claim.

**Recommendation:** P0002 (or a dedicated ADR prompt) should carry an ADR amending both, scoped to
"Cloud Gold edition, budget-capped, telemetry-enforced". Do not let implementation outrun this.

---

## 9. Budget reality — $9.25 OpenAI credit

Verified pricing (2026-08-19): **gpt-5.6-sol** $5.00/Mtok input · $0.50 cached · $30.00/Mtok output.
Batch = 50% off. **gpt-5-nano** $0.05 / $0.005 / $0.40.

A representative MIRA turn (~4k input incl. tools+context, ~600 output):

| Mode | Cost/turn | Turns for $9.25 |
|---|---|---|
| Frontier, uncached | ~$0.038 | **~240** |
| Frontier, 2k prefix cached | ~$0.029 | **~320** |
| nano (routing/classification) | ~$0.0004 | ~23,000 |

**Honest implication:** $9.25 funds the **Phase 3 spine proof and one small eval slice** — roughly
240–320 interactive turns. It does **not** fund §24's full behavioral suite (≈30 families, run
through Cloud Gold *and* On-Prem for parity). §19 says "do not prematurely route through the
lowest-cost model", and that is right for *quality calibration* — but at this budget a nano tier for
routing/classification is needed almost immediately, and the eval suite should be sized to the
credit, not the other way round.

---

## 10. On-Prem baseline (not disparaged, not deleted)

The local path is the Open WebUI/Ollama fallback reached when the cascade is exhausted
(`INFERENCE_BACKEND=local` → `qwen2.5vl:7b`), plus `rag_worker._call_llm()` which sanitizes
independently. It already satisfies: tenant scoping, UNS gate, citation compliance, approved
retrieval, decision traces.

**Contracts it currently bypasses:** no tool calling, no structured turn result, no streaming, and
`MIRA_CONTEXT_CONTRACT` is off there too. These are the *same four gaps as Cloud Gold* — which is
the strongest argument for Seam B: fix them once, above the provider, and both editions inherit them.

---

## 11. OpenAI verification gate — docs checked 2026-08-19

| Topic | Verified fact | Source |
|---|---|---|
| Responses API | `POST /v1/responses`; params `input`, `instructions`, `tools`, `stream`, `store` (default true), `previous_response_id`; typed SSE events (`response.created`, `response.output_text.delta`, `response.completed`) | developers.openai.com/api/docs/guides/migrate-to-responses |
| Conversation state | 3 options: `previous_response_id` (chained; **prior input tokens still billed**), manual item replay, Conversations API | same |
| Prompt caching | prefix = instructions/tools/schemas/shared context; **1,024-token minimum**; **0.1×** cached rate; `usage.input_tokens_details.cached_tokens`; 30-min TTL via `prompt_cache_options.ttl` (GPT-5.6+) | developers.openai.com/api/docs/guides/prompt-caching |
| Flex | `service_tier: "flex"`; Batch rates; `429`/`408` risk (not charged on 429); 10-min default timeout | developers.openai.com/api/docs/guides/flex-processing |
| Pricing | gpt-5.6-sol $5/$0.50/$30 per Mtok; gpt-5-nano $0.05/$0.005/$0.40; Batch −50% | developers.openai.com/api/docs/pricing |

⚠️ `platform.openai.com/docs/*` now **301s to `developers.openai.com/api/docs/*`**; the API-reference
path returned **403** to unauthenticated fetch. Use the `developers.openai.com` host.

---

## 12. MIRA-1000 assumptions the repository proved wrong

1. **"Responses stream correctly" is not a provider concern.** Nothing token-streams today; §29's
   streaming bullet is a full-stack change (§4).
2. **The tool registry is not greenfield.** 26 `@mcp.tool` functions already exist, including the
   CMMS write tools §17 anticipates.
3. **Clients have not diverged.** All 13 already call one `Supervisor.process()` with a normalized
   signature — G4 is largely satisfied.
4. **OpenAI is not a new dependency.** The SDK is used at `printsense/interpret.py:349` and
   `OPENAI_API_KEY` is already mapped in prod and staging compose.
5. **The context architecture (§14) exists.** `MIRA_CONTEXT_CONTRACT` / ADR-0033 `TechnicianContext`
   is built — but **default-off with no production call site**. §14 is an *adoption* task, not a
   design task.
6. **Cost telemetry exists but cannot answer §23** — 9 required fields missing, and it is SQLite.
7. **Cloud Gold is not doctrinally authorized yet** (§8). The PRD does not mention either rule.
8. **`InferenceRouter.complete()` is not a usable provider interface** — no tools, no policy, no
   stream, no structured result.

---

## 13. Recommended P0002 scope (do NOT execute without authorization)

**P0002 — Provider seam, behavior-preserving.**

In scope:
- Define `InferenceProvider` (`respond(conversation, context, tools, policy, metadata) -> TurnResult`).
- Implement **`CascadeProvider`** wrapping today's `InferenceRouter` with **zero behavior change**.
- Contract tests proving old path == new path on the existing golden set.
- One env flag to select the provider; default = today's behavior.
- **An ADR resolving §8** — the two doctrine conflicts — submitted for owner ratification.

Explicitly **out** of P0002: no OpenAI provider, no tools on the model, no streaming, no `/v1/responses`
call, **no paid inference** (P0002 spends **$0.00** of the $9.25).

Rationale: this is the only change that makes every later phase small, it touches no client, and it
is fully revertible by one flag.

---

## 14. P0001 acceptance gate

| Required answer | Status |
|---|---|
| Where the real production turn enters | ✅ §1 |
| Where inference is selected | ✅ `router.py:459` |
| How local inference differs | ✅ §10 |
| Where retrieval/evidence occurs | ✅ table §2 |
| How client surfaces converge | ✅ §3 — already converged |
| Where the OpenAI provider seam should live | ✅ §5 — Seam B |
| Which code is reused not duplicated | ✅ §2, §6 |
| Smallest real-path Gold proof slice | ✅ §13 → then Phase 3 |
| Rollback boundary | ✅ §5 — one flag |
| Measured implications for On-Prem | ✅ §10 |

**P0001 status: COMPLETE (docs-only).** No runtime code was changed. **$0.00 of OpenAI credit spent.**
