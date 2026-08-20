# MIRA-1000 / P0004 — Implementation Map (read-only investigation)

**Produced:** 2026-08-20 · **Type:** archaeology / connection map · **Code changed:** none
**Investigated at:** #3339 `9771c1087` · #3340 `b7ade11ba` · #3341 `8c4bf57c7` · #3342 `66ce26976`
**Status of P0003:** GREEN (see `HISTORY.md` H0009)

> This document exists so a P0004 session can start from one file instead of re-deriving the
> repository. Every claim below is a repo citation, or is labelled HYPOTHESIS.

---

## 1. Executive summary

**Are we ready to refactor `mira-mobile` into the conversation-first MIRA interface?**
The *shell* refactor is ready and cheap. The *runtime* question underneath it is not, and it is
bigger than P0004 as written.

**The finding that reframes P0004: there are two independent MIRA implementations, and the mobile
app uses the one MIRA-1000 has not been building.**

| | Python MIRA | TypeScript MIRA (Hub) |
|---|---|---|
| Entry | `Supervisor.process()` `mira-bots/shared/engine.py:2272` | `mira-hub/src/app/api/**/chat/route.ts` |
| Inference | `InferenceRouter` → P0002 seam → P0003 telemetry | its **own** cascade, `route.ts:55-88` |
| Retrieval | `neon_recall.recall_knowledge()` | `@/lib/manual-rag` `retrieveNodeChunks` |
| Citations | `citation_compliance.py` | in-route prompt rules + `sources` frame |
| Persistence | `decision_traces` (+078 telemetry) | `equipment_notebook_turns` (073) |
| Streaming | **fake** — `main.py:1035` emits the whole reply as ONE chunk | **genuine provider deltas** |
| Consumers | Telegram, Slack, pipeline, ask_api | **Hub web *and* `mira-mobile`** |

Consequences a P0004 session must internalise:

- The P0002 provider seam and P0003 per-turn spend telemetry **do not reach technicians today**,
  because the technician client talks to the Hub TypeScript path.
- ADR-0037 gates Cloud Gold on per-turn telemetry. That telemetry exists on the Python path only.
  **Cloud Gold cannot reach mobile without resolving this split.**
- The Hub cascade lists **Gemini** (`route.ts:88`), which contradicts root `CLAUDE.md` Hard
  Constraint #2 (Groq → Cerebras → Together). Stale doc or stale code — flag, don't silently pick.

**Reuse vs new.** For the *shell and its capabilities*: ~85% reuse. Files, notebooks, citations,
work orders, PM, QR/deep-link, offline idempotency, capability gating and even **voice
transcription** already exist. Genuinely new code is small: a conversation-first root, a freeform
journal event, and the tool-call/approval render path.
For *runtime convergence*: that is not a percentage, it is a decision (§10 Q1).

**Top architectural risks**

1. **Two runtimes** (above). Choosing wrong here makes every later slice more expensive.
2. **`nav.ts` declares the 5-tab contract frozen** — "One definition; the shell renders from it and
   nothing else defines tabs", citing `docs/specs/hub-mobile-spec.md`. PRODUCT_SURFACES says
   conversation-first. **Two live documents disagree**; resolve before touching the shell.
3. **`equipment_notebook_turns.question` is `NOT NULL`** — the model is Q/A, not journal. A
   freeform observation has no home without an additive migration.
4. Streaming is genuine on the Hub path — do **not** "add streaming"; it is already there.

**First three slices** (detail in §8): **P0004A** conversation-first shell (client only, no runtime
change) → **P0004B** journal event (additive migration + write path) → **P0004C** first
deterministic read tool surfaced in conversation.

---

## 2. System map

```
                      ┌──────────────────── FactoryLM Hub (control plane) ─────────────────────┐
                      │ namespace · knowledge · assets · integrations · users/caps · evals      │
                      │ Next.js app + /api routes + Neon (RLS)                                  │
                      └────────────────────────────────────────────────────────────────────────┘

  mira-mobile (Capacitor/Vite/React)
      App.tsx  ──5 tabs──►  screens/*
          │
          └─ api/client.ts ──HTTP──►  Hub /api/*  ─────────────┐
                                                               │
                          ┌────────────────────────────────────┴──────────────┐
                          │  TS chat routes  (equipment-notebooks | assets |  │
                          │  namespace/node) — own cascade, own retrieval,    │
                          │  GENUINE SSE deltas → equipment_notebook_turns    │
                          └───────────────────────────────────────────────────┘

  Telegram / Slack / pipeline / ask_api
          │
          └─► Supervisor.process()  ─►  RAGWorker._call_llm  ─►  InferenceProvider (P0002)
                       │                                              └─ CascadeProvider → InferenceRouter
                       └─► decision_traces (+ migration 078 spend telemetry, P0003)
```

**The gap is the vertical bar between the two boxes.** Mobile never enters the Python runtime.

---

## 3. Reuse matrix

| Capability | Existing code | Status | Reuse as-is | Adapt | New | Notes |
|---|---|---|---|---|---|---|
| Tab shell | `mira-mobile/src/nav.ts`, `App.tsx` | BUILT | | ✓ | | Frozen-contract conflict (§10 Q2) |
| Session/auth, capability gating | `api/resources.ts:61,76` (`/api/me/`), `nav.ts:visibleTabs` | BUILT, fail-closed | ✓ | | | Keep exactly |
| SSE frame parser | `mira-mobile/src/lib/sse.ts` | BUILT | | ✓ | | 3 kinds; needs new kinds (§7) |
| Notebook chat | `api/equipment-notebooks/[id]/chat/route.ts` | BUILT + streaming | | ✓ | | The real technician chat today |
| Citations + passage view | `sse.ts` `ChatCitation`, `/sources/{doc}/passage/` | BUILT | ✓ | | | Do not rebuild |
| Files / one-file-many-links | `workspace_file_links` (075), `lib/workspace-files.ts` | BUILT | ✓ | | | Targets already include notebook + WO |
| Work orders (read/write) | `screens/Workorders.tsx`, Hub WO routes, `074` client_key | BUILT + idempotent | ✓ | | | Reuse for "make a WO" |
| PM schedules | `screens/Schedule.tsx` | BUILT | ✓ | | | Demote to tool/secondary |
| Assets + QR/deep link | `screens/AssetsTab.tsx`, `App.tsx:62-65` | BUILT | | ✓ | | Retarget deep link to conversation |
| Nameplate capture | `ComponentNameplateFlow.tsx`, nameplate worker | BUILT | ✓ | | | Becomes a composer action |
| Voice transcription | `mira-bots/telegram/voice_transcription.py` (Groq Whisper) | **BUILT / NOT ON MOBILE** | | ✓ | | Seam, not new infra |
| Offline queue / idempotency | `resources.ts` `clientKey`, migration 074 | BUILT | ✓ | | | Extend to journal writes |
| Provider seam | `shared/inference/provider.py` (P0002) | BUILT / **NOT ON MOBILE PATH** | | | | Runtime decision (§10 Q1) |
| Per-turn spend telemetry | migration 078 + `decision_trace.py` (P0003) | BUILT / **NOT ON MOBILE PATH** | | | | Same |
| Conversation event contract | `shared/inference/events.py` (P0003) | BUILT / NOT WIRED to any client | | ✓ | | §7 mapping |
| Deterministic tools | 26 `@mcp.tool` in `mira-mcp/server.py` | BUILT / not model-callable | | ✓ | | §L below |
| Freeform journal entry | — | **MISSING** | | | ✓ | Smallest extension in §6 |
| Tool-call / approval render | — | **MISSING** | | | ✓ | Needs new SSE kinds |

---

## 4. Connection map (real paths)

| Step | Where it happens today |
|---|---|
| User types | `screens/NotebookScreen.tsx` composer |
| Request | `api/resources.ts` → `api/client.ts` `request()` |
| Route | `POST mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` |
| AuthZ | `sessionOr401` + `withTenantContext` (`route.ts:17-18`) |
| Source scoping | `validateChatSources` — tenant ∧ notebook ∧ not-rejected **before** retrieval (`route.ts:4-7`) |
| Retrieval | `@/lib/manual-rag` `retrieveNodeChunks` (`route.ts:23-25`) |
| Inference | direct `fetch(provider.url, {stream:true})` (`route.ts:395-404`) |
| Stream out | `{kind:"sources"}` → `{kind:"content"}`×N → `{kind:"status"}` → `[DONE]` |
| Client parse | `mira-mobile/src/lib/sse.ts:55-59` |
| Persistence | `recordTurn` → `equipment_notebook_turns` (073) |
| Attachment | `workspace_file_links` (075), `target_type='equipment_notebook'` |
| Work order | mobile `resources.ts` → Hub WO route, `clientKey` idempotency (074) |
| Trace/telemetry | **none on this path** — `decision_traces`/078 are Python-side only |

**Missing links for the technician-notebook story:** freeform note (no non-question row shape),
tool call (no frame kind), approval (no frame kind), shift handoff (no aggregate read).

---

## 5. Code snippets Claude will need

**`mira-mobile/src/nav.ts`** — the frozen tab contract. *Why:* P0004A edits exactly this.
```ts
export const TABS: readonly TabDef[] = [
  { id: "workorders", title: "Workorders", icon: "🛠" },
  { id: "schedule",   title: "Schedule",   icon: "📅" },
  { id: "chat",       title: "Notebook",   icon: "📓" },
  { id: "assets",     title: "Assets",     icon: "⚙" },
  { id: "more",       title: "More",       icon: "☰" },
] as const;
```

**`mira-mobile/src/lib/sse.ts:55-59`** — the whole client frame vocabulary. *Why:* every new
event kind P0004 needs is added here first.
```ts
const frame = JSON.parse(payload) as Record<string, unknown>;
if (frame.kind === "content") answer += String(frame.content ?? "");
else if (frame.kind === "sources") citations = normalizeCitations(frame.citations);
else if (frame.kind === "status") status = String(frame.status ?? "");
```

**`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:443-449`** — proof streaming is
real. *Why:* do NOT "add streaming"; extend this loop with new frames.
```ts
const delta = parsed.choices?.[0]?.delta?.content;
if (delta) {
  const norm = normalize.push(delta);
  if (norm) {
    const frame: NotebookContentFrame = { kind: "content", content: norm };
    controller.enqueue(enc.encode(sse(frame)));
  }
}
```

**`…/chat/route.ts:55-88`** — the second cascade. *Why:* this is the runtime split; it is not the
Python `InferenceRouter`.
```ts
url: "https://api.groq.com/openai/v1/chat/completions",
url: "https://api.cerebras.ai/v1/chat/completions",
url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
```

**`mira-hub/db/migrations/073_equipment_notebooks.sql:87-97`** — why a journal does not fit today.
*Why:* `question NOT NULL` is the blocker for freeform notes.
```sql
CREATE TABLE IF NOT EXISTS equipment_notebook_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID NOT NULL, tenant_id UUID NOT NULL,
  question TEXT NOT NULL,
  answer_status TEXT NOT NULL DEFAULT 'answered'
    CHECK (answer_status IN ('answered','insufficient_evidence','error')),
  answer_text TEXT NULL, evidence JSONB NOT NULL DEFAULT '[]'::jsonb, ...);
```

**`mira-hub/db/migrations/075_workspace_file_links.sql:67-69`** — attachment target set already
includes what MIRA needs.
```sql
target_type TEXT NOT NULL
  CHECK (target_type IN ('equipment_notebook','cmms_asset','namespace_node','work_order')),
```

**`mira-bots/shared/inference/events.py`** — the P0003 contract (17 kinds) the client does not yet
speak. *Why:* §7 mapping; do not invent a second vocabulary.

**`mira-bots/shared/workers/rag_worker.py` `capture_turn_usage()`** — the per-turn telemetry
carrier. *Why:* if mobile ever routes through the Python runtime, this is what makes ADR-0037
satisfiable.

**`mira-bots/telegram/voice_transcription.py`** — Groq Whisper (`whisper-large-v3-turbo`).
*Why:* voice is a **port**, not a build.

---

## 6. Data model map

| Model | Where | Verdict |
|---|---|---|
| `equipment_notebooks` / `_sources` / `_turns` | 073 (Neon, RLS UUID) | **CANONICAL** for technician conversation. Extend, don't replace |
| `workspace_file_links` | 075 | **CANONICAL** for attachments (polymorphic, allowlisted) |
| `decision_traces` (+078) | 032/055/070/071/078 | **CANONICAL** per-turn audit + spend — but Python path only |
| `work_orders` + `client_key` | 074 + Atlas | CANONICAL for actions; idempotent |
| `conversation_state` | `shared/session_manager.py` — **SQLite** | LEGACY/local. Per-container; not tenant-queryable |
| `troubleshooting_sessions` | referenced by `decision_traces.session_id` | Canonical session id on the Python side |
| `api_usage` | `router.py:705` — **SQLite** | LEGACY local provider-health counter (P0001) |
| `TechnicianContext` | `shared/technician_context.py`, ADR-0033 | BUILT / DEFAULT-OFF (`MIRA_CONTEXT_CONTRACT`) |
| freeform journal entry | — | **MISSING** |

**Smallest extension for the journal (recommended, HYPOTHESIS pending Q3):** add
`entry_kind TEXT NOT NULL DEFAULT 'qa'` + relax `question` to nullable on
`equipment_notebook_turns`, with `entry_kind IN ('qa','observation','hypothesis','measurement','action')`.
That reuses tenant RLS, notebook scoping, evidence JSONB, ordering index and the existing
`recordTurn` writer. **Do not create a `technician_notes` table** — it would fork conversation
history, attachments and RLS for no gain.

---

## 7. Technician notebook design mapping

| Technician behavior | Existing support | Missing connection / new work |
|---|---|---|
| freeform note | `equipment_notebook_turns` (Q/A shaped) | `entry_kind` + nullable `question` (§6) |
| automatic timestamp | `created_at` default now() | none |
| photo | `workspace_file_links` + notebook target | composer action → link on the entry |
| voice note | `voice_transcription.py` (Groq Whisper) | port to mobile capture; transcribe → note |
| machine context | `notebook.identity_*`, UNS resolver, QR deep link | bind conversation to asset at creation |
| observation vs hypothesis | `TechnicianContext` `trust=candidate/verified`; `evidence` JSONB | `entry_kind` + carry trust into `evidence` |
| prior incident search | notebook turns; `decision_traces`; `get_fault_history` | expose as a read tool |
| live machine lookup | `get_equipment_status`, `list_active_faults` | expose as a read tool |
| create WO | Hub WO route + `client_key` idempotency | approval frame + tool call |
| shift handoff | turns + WOs + traces all queryable | read-only aggregate; **no new table** |
| cross-shift memory | notebook is durable + tenant-scoped | scope query by time window |

**Truth classification (§D).** The pieces exist but are not unified on the mobile path:
`TechnicianContext` distinguishes `candidate` vs `verified` (ADR-0033) and is **default-off**;
`citation_compliance.py` decides what is citable; nameplate work has an `evidence_state`.
Minimum shared schema so *"I think the prox double-triggered"* is never stored like a PLC event:
persist `entry_kind` **and** an `evidence[].trust` value on every entry, and never let model output
write `verified` (ADR-0033 rule 9 / `.claude/rules/materialized-evidence.md` rule 9).

---

## 8. P0004 PR decomposition

**P0004A — conversation-first shell (client only).**
Touch `mira-mobile/src/nav.ts`, `App.tsx`, `screens/NotebooksTab.tsx`. **Do not touch** any Hub
route, any migration, any Python. Depends on §10 Q2 resolved. Acceptance: conversation is the root
screen; other tabs reachable as secondary; capability gating unchanged (fail-closed). Rollback:
revert two files. Overlap: none known.

**P0004B — journal entry (additive).**
Touch a new migration (next free ≥ 079), `lib/equipment-notebooks.ts` `recordTurn`, mobile
composer. Acceptance: a freeform observation persists with `entry_kind='observation'` and renders
in history; existing Q/A rows unchanged. Rollback: flag the composer off; column is additive.

**P0004C — first read tool in conversation.**
Surface ONE tool (recommend `get_fault_history` — read-only, asset-scoped, already `@mcp.tool`).
Requires new SSE kinds `tool.call.started|completed|failed` mapped from `events.py`. Acceptance:
"what happened last time?" returns a tool-backed answer with provenance.

**P0004D — attachments in the composer.** Reuse `workspace_file_links`; no new storage.

**P0004E — approval + work-order action.** Requires `approval.required|accepted|rejected` frames.
Reuses the existing WO route + `client_key`. **Blocked on the approval layer, which does not exist**
(P0003 §17/§18 anticipated it; nothing implements it).

**P0004F — shift handoff.** Read-only aggregate over notebook turns + WOs + traces. No new table.

---

## 9. Do NOT rebuild

- ❌ A chat/SSE client — `sse.ts` exists and parses incremental frames.
- ❌ Streaming on the Hub path — genuine provider deltas already relayed.
- ❌ A retrieval/citation stack for the Hub — `manual-rag` + source validation exist.
- ❌ A notebook/conversation table — 073 is canonical.
- ❌ An attachment link table — 075 is canonical and polymorphic.
- ❌ A work-order create path or idempotency scheme — exists (074 `client_key`).
- ❌ Voice/transcription infra — `voice_transcription.py` exists; port it.
- ❌ A capability/RBAC model — `/api/me` + `nav.ts` fail-closed.
- ❌ A tool registry — 26 `@mcp.tool` functions exist.
- ❌ A second event vocabulary — `events.py` (P0003) is the contract.
- ❌ A per-turn telemetry ledger — `decision_traces` + 078.
- ❌ A third client — PRODUCT_SURFACES forbids it explicitly.

---

## 10. Decisions for Mike (cannot be resolved from code)

**Q1 — Which runtime serves technicians?** Mobile uses the Hub TypeScript chat path; MIRA-1000 has
been hardening the Python one. Options: (a) route mobile at the Python runtime (Cloud Gold +
telemetry reach technicians; largest change); (b) keep the TS path and port the seam/telemetry into
it (duplicates ADR-0037 machinery); (c) accept two runtimes indefinitely (Cloud Gold never reaches
mobile). **This gates P0004C onward.** No code answer exists.

**Q2 — Is the 5-tab contract still frozen?** `nav.ts` + `docs/specs/hub-mobile-spec.md` say frozen;
`PRODUCT_SURFACES.md` says conversation-first. One must be superseded in writing.

**Q3 — Journal shape.** Extend `equipment_notebook_turns` with `entry_kind` (recommended), or
model journal entries as a distinct concept? Affects every later slice.

**Q4 — Gemini in the Hub cascade** (`route.ts:88`) contradicts Hard Constraint #2. Stale code or
stale doc?

**Q5 — Approval layer owner.** Agentic writes (P0004E) need one; nothing implements it today.

---

## CLAUDE START HERE

1. **There are two MIRA runtimes.** Python (`Supervisor` → P0002 seam → P0003 telemetry) and
   TypeScript (Hub chat routes). **`mira-mobile` uses the TypeScript one.**
2. Therefore the P0002 seam and P0003 spend telemetry **do not reach technicians today**, and
   **Cloud Gold cannot reach mobile** without resolving §10 Q1 first.
3. **Streaming already works** on the Hub path — genuine provider deltas
   (`equipment-notebooks/[id]/chat/route.ts:443-449`). Do not add streaming. `mira-pipeline` is the
   fake one (`main.py:1035`).
4. The client frame vocabulary is exactly three kinds — `sources`, `content`, `status`
   (`mira-mobile/src/lib/sse.ts:55-59`). Every new event kind starts there.
5. `nav.ts` declares the 5-tab contract **frozen** and cites `docs/specs/hub-mobile-spec.md`.
   PRODUCT_SURFACES contradicts it. **Get Q2 answered before editing the shell.**
6. `equipment_notebook_turns.question` is **NOT NULL** — a freeform note has no home. Smallest fix
   is `entry_kind` + nullable question. **Do not create `technician_notes`.**
7. `workspace_file_links` (075) already links a file to `equipment_notebook`, `cmms_asset`,
   `namespace_node`, `work_order`. Attachments are solved.
8. **Voice exists**: `mira-bots/telegram/voice_transcription.py`, Groq `whisper-large-v3-turbo`.
   Mobile is a port, not a build.
9. Work-order writes are already idempotent via `clientKey` / migration 074. Reuse.
10. **26 `@mcp.tool` functions exist** in `mira-mcp/server.py`. First read tools should be
    `get_fault_history`, `get_equipment_status`, `list_active_faults`, `kg_maintenance_context`,
    `cmms_list_work_orders`.
11. **No approval layer exists.** P0004E is blocked on it; do not fake it.
12. The Hub chat path enforces source scoping **before** retrieval (`route.ts:4-7`) — preserve that
    boundary; it is described as "the retrieval boundary IS the product".
13. `TechnicianContext` (ADR-0033) distinguishes `candidate` vs `verified` and is **default-off**
    (`MIRA_CONTEXT_CONTRACT`). It is the right home for observation-vs-hypothesis.
14. Model output must never self-promote to `verified` (materialized-evidence rule 9).
15. `conversation_state` and `api_usage` are **SQLite, per-container** — legacy, not canonical.
16. The Hub cascade includes **Gemini**, contradicting Hard Constraint #2. Flag, don't pick.
17. `/api/me` capability gating is **fail-closed** (`nav.ts:visibleTabs`). Keep that posture.
18. #3340 is **CONFLICTING** on the three ledger files only — unrelated to P0004, but it will look
    alarming in `gh pr list`.
19. Paid inference budget is **$0.00** unless a new budget is declared (ADR-0037).
20. Shift handoff should be **generated from existing rows** (turns + WOs + traces). No new table.
