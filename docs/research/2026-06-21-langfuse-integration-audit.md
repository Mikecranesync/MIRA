# Langfuse Integration Audit — Does what's wired give us the observability we wanted?

**Date:** 2026-06-21
**Author:** Claude (Opus 4.8) session, at Mike's request
**Question that started this:** "Make the observability layer a dashboard for easier viewing + control."
We discovered Langfuse is already half-wired. This audit answers: **does the existing
Langfuse integration actually deliver the traces / observability this thread was after —
and what does it cost us (privacy, gaps, drift)?**

---

## TL;DR

1. **Langfuse Cloud (US) is live in production today** — but only on *some* surfaces.
   `mira-pipeline` (the main VPS phone→OpenWebUI chat path, langfuse v2 SDK) actively
   ships **raw customer queries + retrieved KB content** to `us.cloud.langfuse.com`,
   **unsanitized**.
2. **The primary prod bot — Telegram (`@FactoryLM_Diagnose`) — traces NOTHING.** It pins
   langfuse **v4** SDK, but the tracing code uses the **v2** API (`lf.trace()`), which v3+
   removed. The code's own `hasattr(lf, "trace")` guard then silently no-ops. So the most
   important customer surface produces zero traces.
3. **What IS captured is the RAG mechanics only** (query → retrieve → generate, 4 spans).
   It does **NOT** capture the things this thread + PR #2154 actually care about: asset/UNS
   path, citations, confidence, **governance/incident warnings**, eval pass/fail, or the
   7-step orchestration arc.
4. **The new observe layer (PR #2154) is not connected to Langfuse at all.** Two parallel,
   disconnected observability systems.
5. **Dev/staging Langfuse is misconfigured** (region mismatch) → silently fails auth → your
   own dev dashboard won't work as-is.

**Bottom line:** the existing integration is a *partial RAG-latency tracer that's broken on
the main bot and leaks customer data on the chat path* — not the answer-level observability +
eval + governance dashboard this thread set out to build. It is complementary plumbing, not
the finished product.

---

## 1. What's actually wired

### The one real runtime call site
`mira-bots/shared/workers/rag_worker.py:413`
```python
async with trace_rag_query(message, metadata=metadata) as spans:
    async with spans.embed_query(message): ...
    async with spans.vector_search(query, chunk_ids, scores): ...
    async with spans.context_compose(chunk_ids, composed_text): ...
    async with spans.llm_inference(prompt_len, response, latency): ...
```
This is the **only** production tracing call. Everything that routes through `RAGWorker`
inherits it; nothing else traces. (`evals/test_langfuse_connection.py` is a manual test only.)

### Setup code
Two near-identical copies (drift): `evals/langfuse_setup.py` and
`mira-bots/shared/langfuse_setup.py`. Both: singleton client + `trace_rag_query` context
manager + a `_SpanHelper` with 4 spans. Client is created only if `LANGFUSE_SECRET_KEY` +
public key are set; otherwise every span is a no-op (fail-open, never raises to the caller).

### What each span captures
| Span | Input | Output |
|---|---|---|
| trace `rag_query` | `{"query": <raw message>}` | — |
| `embed_query` | raw query | **hardcoded** `"(1,768)"` (fake — not a real embedding) |
| `vector_search` | query | retrieved `chunk_id` + `score` list |
| `context_compose` | chunk_ids | `context[:500]` — **excerpt of retrieved KB / manual text** |
| `llm_inference` | prompt-token estimate | `response[:200]` + latency_ms |
| metadata | `fsm_state`, `photo` bool, `prompt_codename`, `prompt_version` | — |

---

## 2. Surface coverage matrix (the Telegram bug)

| Surface | langfuse SDK pin | Routes through RAGWorker? | Actually traces? |
|---|---|---|---|
| **mira-pipeline** (VPS phone/OpenWebUI chat) | `>=2.50,<3` (v2) | yes | ✅ **yes — emits to US cloud** |
| **Telegram** (`@FactoryLM_Diagnose`, prod) | `>=4.7.1,<5` (v4) | yes | ❌ **no — v4 SDK, v2 code → `hasattr(lf,"trace")` False → no-op** |
| Slack | `>=2.50,<3` (v2) | yes | ✅ would emit if deployed w/ keys |
| Reddit / WhatsApp | `>=2.50,<3` (v2) | via shared worker | ✅ would emit if deployed w/ keys |
| AskMira `/ask` kiosk fast-path | (in mira-bots) | **bypasses `process()`** (per PR #2154 doc) | ❌ likely not traced |

**Why Telegram is dead:** langfuse v3 removed the low-level `lf.trace()` / `trace.span()`
constructor API (moved to OTEL `start_span` / `@observe`). The shared setup guards with
`hasattr(lf, "trace")`; on the v4 SDK that attribute is gone, so `trace` stays `None` and all
four spans no-op. The `evals` copy lacks the guard and would instead hit an
`AttributeError` that's swallowed by try/except — same net result: nothing recorded.

So the **most-used prod customer bot emits zero observability**, while the secondary chat
path leaks the most. Worst of both.

---

## 3. What leaves the network (privacy)

On every traced query (i.e. mira-pipeline today), sent to **Langfuse Cloud, US region**,
**without** the `InferenceRouter.sanitize_context()` IP/MAC/serial scrub:

- **Raw technician question text** (`input={"query": message}`) — verbatim customer input
- **Retrieved KB context** (`context_compose` → first 500 chars) — may include customer
  manual / document excerpts
- **Answer preview** (`llm_inference` → first 200 chars of MIRA's reply)
- chunk IDs + retrieval scores; FSM state; prompt codename/version

No `session_id`/`chat_id` is passed at the call site (good — no user-id leak there).
Retention is whatever the Langfuse account's plan sets (Hobby = 30 days).

**Governance status:** this is paying/beta customers' equipment + fault data on a third-party
US SaaS subprocessor. GDPR DPA is available from Langfuse; SOC2 report access needs their Pro
tier. Today there is no sanitization on this path and (likely) no customer disclosure.

---

## 4. Gap analysis — existing Langfuse vs. the goal of this thread

The thread + PR #2154 (`shared/observe` AnswerTrace, the Bhaumik five pillars) wanted
**answer-level** observability. Here's what Langfuse currently does / doesn't give:

| Wanted (AnswerTrace / 5 pillars) | In current Langfuse? |
|---|---|
| Query → retrieve → generate latency spans | ✅ yes (its strength) |
| Resolved **asset / UNS path** | ❌ no |
| **Citations** present / which sources | ❌ no |
| **Confidence band** (high/med/low) | ❌ no (only start-of-turn `fsm_state`) |
| **Groundedness** score | ❌ no |
| **Governance / incident warnings** (pillar 5 — unapproved asset, stale doc, safety-review-missing, unsupported advice) | ❌ no |
| **Eval pass/partial/fail** scorecards (pillar 1) | ❌ no |
| 7-step orchestration arc (receive→resolve→govern→generate→validate→return) | ❌ partial — only 4 RAG spans |
| Approval gates / human-in-loop | ❌ no |
| Real model/provider used per call | ❌ no |
| The new PR #2154 AnswerTrace feed | ❌ **not connected** |

**Verdict:** Langfuse today = a (partly broken) **RAG latency/retrieval tracer**. Useful for
"why was retrieval slow / what chunks came back", which is real. But it is **not** the
answer-correctness + governance + eval observability this thread is about. The PR #2154 observe
layer is, and it isn't plugged into Langfuse.

---

## 5. Config + code issues found

1. **Telegram v4 SDK vs v2 code → silent no-op** (§2). Either downgrade telegram to
   `>=2.50,<3`, or migrate the tracing code to the v3 API. Until then, fix is one-line in
   `telegram/requirements.txt`.
2. **Dev/staging region mismatch.** `factorylm/dev` + `stg` have `LANGFUSE_PUBLIC_API_KEY` +
   `LANGFUSE_SECRET_KEY` but **no `LANGFUSE_HOST`** → code defaults to `cloud.langfuse.com`
   (EU). The keys are from the **US** project (prd host = `us.cloud.langfuse.com`). A US key
   won't auth against the EU host → silent 401 → no-op. **Your dev dashboard is dead until
   `LANGFUSE_HOST=https://us.cloud.langfuse.com` is set in `factorylm/dev`.**
3. **Duplicate setup files** (`evals/` + `mira-bots/shared/`) — only differ in formatting and
   the `hasattr` guard. Should be one module imported in both places.
4. **Fake `embed_query` output** — hardcoded `"(1,768)"`; records no real data.
5. **Stale docstring** — `langfuse_setup.py` says "Phase 4 integration target" as if not yet
   wired, but `rag_worker.py:413` already integrated it. `docs/architecture/KNOWN_ISSUES.md:45`
   correctly marks it "✅ wired (4 spans, …)".
6. **Dep without use** — slack/reddit/whatsapp/pipeline/telegram all pin langfuse, but only the
   shared RAGWorker path uses it. Fine, but worth knowing it's not per-adapter instrumentation.

---

## 6. Recommendations (pick per appetite)

**A. If the goal is the dashboard from this thread (answer-level observability + eval + control):**
The existing Langfuse integration does **not** deliver it, and self-hosting Langfuse is a
6-container / 16 GiB job (separately audited). Cheapest path to the actual goal is still the
local `shared/observe` viewer (PR #2154 data) — OR bridge the PR #2154 **AnswerTrace** into
Langfuse so its asset/citation/confidence/governance fields become first-class. The bridge is
~30 lines but only pays off once the surface/version/region issues below are fixed.

**B. If the goal is "stop leaking + make what's wired correct":** prioritized, low-effort:
1. **Decide governance** on customer data → US cloud (sanitize, disclose, or pull `prd` keys).
   Pulling `prd` LANGFUSE keys is an instant fail-open no-op (no redeploy logic needed).
2. **Fix the Telegram no-op** (version) if you actually want the prod bot traced.
3. **Fix dev region** (`LANGFUSE_HOST` in `factorylm/dev`) so your own dashboard works.
4. Sanitize the `query` + `context_compose` payloads (reuse `sanitize_context`) before send.

**C. First move regardless:** log into the existing Langfuse Cloud (US) account and see what's
actually been captured + which plan/retention. The dashboard you wanted may already have weeks
of mira-pipeline traces in it.

---

## Appendix — evidence

- Runtime call site: `mira-bots/shared/workers/rag_worker.py:413`
- Setup + spans: `mira-bots/shared/langfuse_setup.py` (and dup `evals/langfuse_setup.py`)
- Version pins: `mira-bots/telegram/requirements.txt:7` (`>=4.7.1,<5`) vs
  `mira-pipeline/requirements.txt:10`, `mira-bots/{slack,reddit,whatsapp}/requirements.txt`
  (`>=2.50,<3`)
- Config: Doppler `factorylm/{dev,stg,prd}` have `LANGFUSE_PUBLIC_API_KEY` +
  `LANGFUSE_SECRET_KEY`; only `prd` has `LANGFUSE_HOST=https://us.cloud.langfuse.com`
- Compose injection: `docker-compose.saas.yml:252-254`, `mira-core/docker-compose.yml:191-193`,
  `mira-bots/docker-compose.yml:26-30`, `docker-compose.staging.yml:48-50`
- New, disconnected layer: PR #2154 `mira-bots/shared/observe/` + `simlab/observe/`
- Known-issues note: `docs/architecture/KNOWN_ISSUES.md:45`
