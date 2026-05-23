# MIRA vs Claude/ChatGPT — Grounded-Answer Benchmark Evaluation

**Date:** 2026-05-23
**Author:** Claude Code (CHARLIE)
**Status:** Evaluation only — no code written
**Benchmark anchor:** Reading a GS10/GS11 parameter from a Micro820 over Modbus RTU in CCW
**Decision asked:** Go / no-go on building a Claude-Code-driven benchmark harness that scores MIRA's grounded answers vs Claude/ChatGPT given manual docs

---

## TL;DR

**Recommendation: GO — but build the *thinnest possible* harness, and reuse what already exists.**

The proposed architecture is mostly already in the repo. We do not need a network of specialist subagents, a new RAG layer, or new APIs. We need three small things wired together:

1. A **read-only MCP entrypoint** that exposes `recall_knowledge` + a few KG/manual reads (consolidated under the existing `mira-mcp/server.py`).
2. **One** Claude Code subagent (`mira-knowledge`) that is *forbidden* from answering without citing MIRA's response.
3. **Extending the existing `tests/mira_eval.py` harness** to add a "MIRA-grounded" mode and an "LLM + manually supplied docs" mode, then scoring both against the golden CSV that *already exists* (`tests/golden_gs11_conveyor.csv`).

The whole MVP is days, not weeks. Most of the risk is in the **fairness of the comparison and the embedding-sidecar dependency** that already broke us in May 2026 (#1385), not in building anything new.

---

## 1. Product value

**High strategic value, modest immediate value.**

| Why it matters | Notes |
|---|---|
| The product wedge depends on the claim "we ground answers in your factory's docs." If we can't show a measurable gap between Claude-alone and MIRA-grounded, the wedge isn't real. | Today this is asserted, not measured. |
| Sales narrative: "Here is the same question with and without your manuals plugged in." That demo sells subscriptions; the screenshot pair is more compelling than any feature list. | This benchmark *is* a sales asset. |
| Engineering regression net: every time we ship engine/RAG changes, the benchmark tells us if grounding got better or worse. | Existing 5-regime tests catch breakage; this would catch *value loss.* |
| Customer-specific KBs: when an OEM onboards, we re-run the same battery against their docs and report "MIRA can/can't currently answer X of your top 20 maintenance questions." That's a tangible deliverable. | Onboarding artifact. |

**What it is NOT:**
- Not a feature for end users.
- Not a replacement for golden-case regression tests.
- Not a substitute for the diagnostic-quality work in `tests/eval/`.

It is **an evaluation harness**, and should stay framed that way to avoid scope creep.

---

## 2. Technical feasibility

**Easy. Most of the substrate already exists.** Inspection summary:

| Capability | Lives in | Already does what we need? |
|---|---|---|
| Hybrid retrieval (vector + fault code + product + BM25) | `mira-bots/shared/neon_recall.py` → `recall_knowledge()` (line 606) | ✅ Returns content + manufacturer/model + source_type + similarity. Already handles the "no embedding" degraded path (the GS11 demo regression fix). |
| KB coverage probe | `mira-bots/shared/neon_recall.py` → `kb_has_coverage`, `kb_has_pair_coverage` | ✅ Per (vendor, model) pair. |
| KG entity/relationship walks | `mira-mcp/server.py` → `kg_maintenance_context`, `kg_impact_analysis`, `kg_root_cause_chain`, `kg_traverse_chain` | ✅ Already FastMCP-tool-decorated. |
| Manual / doc retrieval | `mira-mcp/server.py` → `get_maintenance_notes`; `recall_knowledge` carries `source_url` + `source_page` in metadata | ✅ Citations available. |
| Citation compliance / groundedness scoring | `mira-bots/shared/citation_compliance.py`; engine has 1–5 groundedness + evidence_packet (`mira-bots/shared/benchmark_db.py`) | ✅ Already enforces "every reply should be grounded." |
| MCP server skeleton | `mira-mcp/server.py` (FastMCP 3.2, ~25 tools today) | ✅ Just needs a stdio entry + 2 new read tools wrapping `recall_knowledge` + `kb_has_coverage`. |
| Evaluation harness | `tests/mira_eval.py` already supports `--claude --rag` (full) and `--claude` (RAG ablation) modes against `tests/benchmark/mira_mcq_benchmark.json`. | ✅ Add a third mode for "MIRA via MCP" and a fourth for "LLM + manually pasted docs." |
| Benchmark dataset | `tests/golden_gs11_conveyor.csv` — already has the **exact** scenario the user proposed: wiring, run-forward register (8192), troubleshooting checklist, 30 Hz frequency value (3000), command-word parameters. Ideal answer + curated contexts per row. | ✅ Reuse. Extend with 5–10 more rows for the parameter-read scenario. |
| Subagent / skills convention | `.claude/agents/`, `.claude/skills/`, `.claude/mcp/` already in use | ✅ Add one agent + one skill. |

**What's missing (small):**

1. `mira-mcp/server.py` is an HTTP FastMCP server. Claude Code reaches MCP via stdio (per `.mcp.json`). We need either (a) a stdio wrapper that runs `mira-mcp` as a child process and proxies the MCP tools, or (b) the FastMCP server registered over HTTP transport in `.mcp.json`. FastMCP 3.x supports both — pick stdio for local dev simplicity.
2. `recall_knowledge` is **not currently exposed** as an MCP tool. It needs a thin `@mcp.tool` wrapper.
3. A `tenant_id` for the benchmark — we should not borrow a customer tenant. Define `MIRA_BENCH_TENANT_ID` and ingest the GS11 field guide once into that tenant.
4. The "LLM-with-manually-supplied-docs" condition needs a frozen doc-pack per question (PDFs/text snippets pasted into Claude/ChatGPT context) so the comparison is reproducible.

**Tenant + read-only safety:** the benchmark must run against **staging Neon** (or a snapshot), not prod. CLAUDE.md is explicit; `tools/hooks/prod-guard.sh` already blocks direct prod `psql`. The new MCP tools must be read-only — no writes, no proposes.

---

## 3. Architecture fit

The proposed architecture in the prompt — main agent → specialist subagent (modbus / plc / docs) → MIRA → answer back → Claude generates artifacts — is **over-decomposed** for what we actually need. Per `.claude/rules/karpathy-principles.md` rule #2 ("simplicity first") and the MIRA `CLAUDE.md` ("no LangChain/n8n abstractions over the LLM call"), three subagents for one tool call is a wrapper smell.

**Recommended simplification:**

- **One** subagent: `mira-knowledge`. Its job is to call MIRA's read-only MCP tools and return the structured response. It has no other reasoning role.
- The "specialist" framing (modbus, plc, docs) is a *prompt template choice*, not a separate agent. We can give the main Claude Code different scoring rubrics or different artifact templates based on question category without ever spawning a subagent.
- All MIRA brain logic stays inside `mira-bots/shared/` and inside MIRA's NeonDB. The MCP server is a window onto it, not a re-implementation.

This matches the existing pattern in `.claude/mcp/README.md`: "Consolidate into `mira-mcp/` rather than spawning new repos." It also avoids creating a parallel-universe answer path that diverges from the production Slack engine.

**Where this plugs in vs the production chat path:**

- Production Slack/Telegram path: `bot → engine.py (Supervisor) → recall_knowledge → cascade LLM → reply`.
- Benchmark path: `Claude Code → MCP tool → recall_knowledge → return raw evidence pack → Claude composes answer from evidence + cites`.

These intentionally diverge. The benchmark wants to isolate **MIRA's retrieval quality** from the engine's composition step. Comparing engine output to LLM-alone-with-docs would conflate two variables.

---

## 4. Best implementation path

### Phase 0 — Inspection (this doc)
Already done. The repo has more substrate than the prompt assumed.

### Phase 1 — MVP harness (1–2 dev sessions)

**Goal:** answer the GS10/GS11 parameter-read benchmark question end-to-end, on a single tenant, with citations, in three conditions:

| Condition | Description |
|---|---|
| `A` baseline | Claude (cascade) gets the question, no docs, no MIRA. |
| `B` MIRA-grounded | Claude calls `mira-knowledge` subagent → MCP tools → returns evidence pack → Claude composes answer citing it. |
| `C` manual docs | Claude (cascade) gets the question + the GS11 field-guide PDF text pasted into its context window. No MIRA. |

The hypothesis MIRA must beat:  **B ≥ C, and both ≫ A.** If B < C, the KB is missing chunks the manual contains; that's an *ingestion gap*, not a retrieval bug. If B ≈ A, the KB isn't actually being consulted (the GS11 demo regression pattern).

### Phase 2 — Scoring + report

- Score with the existing `tests/eval/grader.py` + `tests/eval/judge.py` rubric (citation, recall, correctness, safety).
- Produce a one-page markdown report: per-question A vs B vs C, with deltas.
- Save to `docs/evaluations/runs/YYYY-MM-DD/`.

### Phase 3 (later, optional) — Generalize

- Add 4 more equipment scenarios (PowerFlex 525, Siemens S7-1200, GuardLogix safety, Atlas CMMS work-order lookup).
- Add CI integration so the report is regenerated weekly.

**Do not** build Phase 3 until Phase 1+2 are running.

---

## 5. Risks and failure modes

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Embedding sidecar down → recall silently returns 0 chunks, MIRA looks bad for the wrong reason. This **already happened** (#1385, May 2026). | High | High | Benchmark runner asserts `recall_knowledge` returns ≥1 row from the BM25 stream even when embedding is unavailable. Log embedding status per question. |
| R2 | The "manual docs" condition is fuzzy — what exactly did we paste in? Different runs use different PDFs. | High | High | Freeze a `tests/benchmark/docs/gs11/` folder with the exact PDF + extracted text snippets. The condition-`C` runner reads from disk, not from a screenshot. |
| R3 | Benchmark run hits **prod NeonDB** by accident, contaminates `kg_*` audit trails. | Medium | High | Hard guard: harness refuses to run unless `NEON_DATABASE_URL` ends in the staging branch hostname. `prod-guard.sh` is a floor, not a ceiling. |
| R4 | Claude "cheats" via parametric memory — its training knows the GS11 register map and answers correctly even in condition `A`. | Medium | Medium | Already mitigated by `tests/mira_eval.py`'s RAG-ablation mode. Report `rag_chunks: true/false` per question; flag questions where condition `A` already passes (means the benchmark isn't discriminating). |
| R5 | "Citation correctness" is hard to judge automatically. | High | Medium | Two-tier: (a) does the answer cite *anything* MIRA returned? (b) human review of 10 random rows per run. Don't over-engineer the judge until the binary version is failing usefully. |
| R6 | Specialist-subagent over-decomposition creeps back in ("we need a modbus-agent next…"). | Medium | Low | Keep `mira-knowledge` as the **only** MIRA-side subagent. Rubric variations go in skill templates, not new agents. (`.claude/rules/karpathy-principles.md` #2.) |
| R7 | `mira-mcp` server adds a stdio entrypoint and that breaks the existing HTTP container. | Low | Medium | Make stdio a *second* entrypoint in the same file. Don't refactor the HTTP path. |
| R8 | Golden answers in `tests/golden_gs11_conveyor.csv` drift from what the manuals actually say. | Low | Medium | Trace each golden ideal back to a page in the GS11 field guide; record `source_url` + `source_page` in the CSV `contexts` column (already partially done). |
| R9 | Tenant isolation: benchmark tenant accidentally returns prod customer data. | Low | High | `MIRA_BENCH_TENANT_ID` is a fresh UUID with no overlap. Recall is tenant-scoped today (`recall_knowledge` line 634). Add an explicit assertion in the harness that returned rows have `tenant_id == bench_tenant OR tenant_id == SHARED_TENANT_ID`. |

**Two risks (R1, R2) are existential to the validity of the benchmark.** Address them first.

---

## 6. Objective test plan

### 6.1 Benchmark scenario

> *"How do I read the output frequency parameter from an AutomationDirect GS10/GS11 drive using an Allen-Bradley Micro820 PLC over Modbus RTU in Connected Components Workbench (CCW)?"*

This decomposes into the question set already partly captured in `tests/golden_gs11_conveyor.csv`. Extend it with these specific rows:

| # | Question | Required answer components |
|---|---|---|
| Q1 | What Modbus register holds the GS11 output frequency? | Register 8451 (0x2103) for output frequency feedback (or 8195 in some doc revisions — must cite the page). Hz × 100 scaling. |
| Q2 | What CCW MSG instruction parameters do I configure for a read? | `MSG_MODBUS` block; `LocalCfg` = serial port, `TargetCfg.Addr` = slave id matching P09.00, `LocalCfg.Func` = 03 (Read Holding), `LocalCfg.ElementCnt` = 1, `LocalCfg.Addr` = 8451. |
| Q3 | What's the GS11 P09 configuration before this works? | P09.00 = slave id, P09.01 = baud, P09.04 = frame code (parity + stop). Power cycle to apply. |
| Q4 | What wiring? | Micro820 D+ ↔ GS11 SG+, D- ↔ SG-, G ↔ SGND. Shielded twisted pair, shield grounded one end, 120-ohm termination at far end. **NOT** the RJ45 jack. |
| Q5 | The read returns 0 always — what do I check? | (1) Slave id mismatch P09.00 vs MSG; (2) function code 03 not 06; (3) D+/D- polarity (silent failure); (4) common ground bonded; (5) drive is actually running (output freq is 0 at standstill). |
| Q6 | How do I scale the returned value to Hz in CCW ladder? | Read INT to a tag, divide by 100.0 into a REAL. (Register is Hz × 100.) |
| Q7 | Cite the manual page for the answer to Q1. | Concrete page reference from GS-Series Modbus communication parameters table. |

Q4, Q5 are largely covered by existing golden rows. Q1, Q2, Q6, Q7 are new — write them once, freeze.

### 6.2 Expected documents MIRA must retrieve

For Q1–Q7, MIRA's retrieval should return chunks from:

- AutomationDirect GS-Series user manual, Modbus communication section (P09 parameters table; register address table).
- AutomationDirect GS-Series Modbus comms appendix (function-code support, scaling table).
- Allen-Bradley Micro820 CCW programming guide, `MSG_MODBUS` instruction page.
- Anything in `kb_entries` tagged `manufacturer='automation_direct'` AND `model_number IN ('gs10','gs11')`.

Probe with `kb_has_pair_coverage('AutomationDirect', 'GS11', bench_tenant)` before scoring — if `False`, the benchmark is testing nothing; ingest first.

### 6.3 Required citations

Each MIRA answer must include, for every claim:

- `source_url` (the manual)
- `source_page` (the page in that manual)
- `manufacturer` and `model_number` matching the question's equipment

If `source_page` is null (legacy ingestion), the answer is downgraded — that's a signal to re-ingest with page-preserving chunking.

### 6.4 Comparison method (A vs B vs C)

For each question:

1. **A: LLM-alone.** Send question to cascade (Groq → Cerebras → Gemini). Capture answer text.
2. **B: MIRA-grounded.** Claude Code main agent receives question → invokes `mira-knowledge` subagent → subagent calls MCP `mira_search_knowledge(question, tenant=bench)` → returns evidence pack {`chunks`, `citations`, `confidence`, `gaps`} → main agent composes final answer **with the requirement that every factual claim must trace to a returned chunk**. Reject the answer if `gaps` is non-empty and the answer didn't acknowledge it.
3. **C: LLM + manual.** Send question + the frozen GS11 doc-pack text to cascade. Capture answer text.

Run all three for each of Q1–Q7 (and the existing GS11 golden rows). Save raw responses + metadata to `docs/evaluations/runs/2026-05-23/raw.jsonl`.

### 6.5 Scoring criteria (4 axes, 0–4 each)

Reuse the scoring shape in `tests/eval/grader.py` / `tests/eval/judge.py`. The four axes:

| Axis | What it measures | How to score |
|---|---|---|
| **Correctness** | Did the answer get the technical facts right? | LLM judge (Groq, deterministic temp=0) compares answer to `ideal_answer` from the golden CSV. 0 = wrong/contradicts manual. 4 = matches ideal in substance. |
| **Citation quality** | Are sources cited, specific, and verifiable? | 0 = no citations. 2 = vague ("the manual says"). 4 = page-level, manufacturer-specific, traceable to a returned chunk. Condition `A` cannot exceed 1 (no citations possible). |
| **Usefulness** | Could a tech act on this in front of the drive in 60 seconds? | LLM judge with rubric: "Imagine a tech with the drive in front of them. Would this answer let them act without asking another question?" 0–4. |
| **Safety** | Does the answer admit unknowns rather than confabulate? Does it flag LOTO / arc-flash where relevant? | 0 = invents a register address or guesses a P-parameter without citation. 4 = explicit "I don't have a source for X; verify against your manual page Y." |

**Aggregate score per condition** = mean across questions × 4 axes. Plot A vs B vs C as a grouped bar chart (one bar trio per question, plus an aggregate trio).

**Pass condition for the benchmark itself:** `mean(B) ≥ mean(C) − 0.3` and `mean(B) ≥ mean(A) + 1.0`. If either fails, do not ship the harness as a sales asset until ingestion is improved.

### 6.6 Reproducibility

- Pin LLM model versions in the run manifest (Groq `llama-3.x`, Cerebras `…`, Gemini `…`).
- Pin the doc-pack hash for condition `C`.
- Pin the NeonDB snapshot id (or the staging branch commit hash) used for condition `B`.

Without these, A/B/C numbers drift session-to-session and the harness is not a regression net.

---

## 7. First working prototype

**Scope:** condition `B` only, single question (Q1 above), end-to-end, no scoring loop yet.

Concretely, after Phase 1 lands the developer can run:

```bash
doppler run --project factorylm --config stg -- \
  python tests/mira_bench.py \
    --question "What Modbus register holds the GS11 output frequency?" \
    --mode mira-grounded \
    --tenant $MIRA_BENCH_TENANT_ID
```

…and see:

```
Q: What Modbus register holds the GS11 output frequency?
[MCP] mira_search_knowledge → 4 chunks
  • automation_direct/gs11 — manual p.42 (sim 0.81)
  • automation_direct/gs11 — manual p.43 (sim 0.74)
  • automation_direct/gs-series — modbus appendix p.7 (sim 0.69)
  • automation_direct/gs11 — P09 params table (BM25 hit, sim n/a)

A: GS11 register 8451 (0x2103) is the output-frequency feedback,
   scaled Hz × 100. Read with Modbus function code 03 (Read Holding
   Register). Source: AutomationDirect GS-Series user manual,
   p.42 (Modbus register map).
```

That single end-to-end run proves all the moving pieces work. Add the comparison conditions + scoring next.

---

## 8. Subagent / MCP / API — what should it be?

**Answer: MCP tool + ONE subagent. No new internal MIRA API.**

| Piece | Why this shape |
|---|---|
| MCP tool (stdio) | Claude Code's native integration point. Already how `playwright`, `sqlite`, `obsidian` are wired in `.mcp.json`. Lets the harness be invoked from any Claude Code session, not just a Python script. Keeps Claude Code's tool-call telemetry as the source of truth for "did the model actually consult MIRA." |
| Subagent (`mira-knowledge`) | Provides a single, terse system prompt that forces the calling agent to (a) call the MCP tool, (b) never paraphrase without citing, (c) explicitly emit `unknown` when MIRA returns no coverage. Keeps the rule out of every consumer's prompt. |
| ~~Internal API~~ | Rejected. `recall_knowledge` is already callable from Python. Adding an HTTP layer in front would duplicate `mira-pipeline`. The MCP tool *is* the API for this use. |
| ~~Multiple specialist subagents~~ | Rejected — Karpathy rule #2 (simplicity first). One subagent + skill-templates handle the variation. |

**File-level layout:**

```
mira-mcp/
├── server.py                       # existing HTTP FastMCP
└── stdio_entry.py                  # new: stdio MCP transport, same tool registry,
                                    #      + new read tools (see below)

.mcp.json                            # add "mira-knowledge": stdio command launching stdio_entry.py

.claude/agents/
└── mira-knowledge.md               # new: subagent prompt — call MCP tools, cite or say "unknown"

.claude/skills/
└── mira-vs-llm-benchmark.md        # new: skill explaining how to run a benchmark sweep

tests/
├── mira_bench.py                   # new: ~150 LOC. Drives A/B/C runs, writes JSONL.
├── benchmark/
│   ├── docs/gs11/                  # new: frozen doc-pack for condition C
│   │   ├── gs-series-manual.pdf
│   │   ├── gs-series-manual.txt    # extracted text used for condition C
│   │   └── manifest.json           # sha256 + page index
│   └── mira_vs_llm_questions.json  # new: question set for the harness (extends golden_gs11_conveyor.csv)
└── eval/
    └── score_mira_bench.py         # new: scoring loop, calls existing grader.py / judge.py

docs/evaluations/
├── mira-vs-llm-benchmark-evaluation-2026-05-23.md   # ← this file
└── runs/
    └── 2026-05-23/
        ├── raw.jsonl
        └── report.md
```

**No changes** required to: `mira-bots/shared/engine.py`, `recall_knowledge` itself, KG schema, the production Slack/Telegram path, the LLM cascade, Doppler config layout.

**Two new MCP tools** (read-only, wrap existing Python):

```
mira_search_knowledge(query: str, tenant_id: str, limit: int = 5)
  → { chunks: [{content, manufacturer, model, source_url, source_page,
                similarity, source_type}],
      coverage: {has_coverage: bool, vendor: str, model: str},
      embedding_available: bool,
      streams_used: ["vector"?, "bm25", "fault", "product"],
      gaps: [str] }

mira_kb_coverage(vendor: str, model: str, tenant_id: str)
  → { has_coverage: bool, chunk_count: int, sample_pages: [int] }
```

That's it. The five MCP specs already drafted in `.claude/mcp/` are the *next* horizon, not the MVP.

---

## 9. Files / modules likely to change

| File | Change | Risk |
|---|---|---|
| `mira-mcp/server.py` | Add `@mcp.tool` wrappers for `recall_knowledge` and `kb_has_coverage` (import from `mira-bots/shared/neon_recall.py`). | Low — additive, read-only. |
| `mira-mcp/stdio_entry.py` (new) | Run the FastMCP `server` over stdio transport (FastMCP 3.x supports this natively). | Low — new file. |
| `.mcp.json` | Add `mira-knowledge` server entry pointing at `stdio_entry.py` via `python -m`. | Low — additive. |
| `.claude/agents/mira-knowledge.md` (new) | Subagent prompt. | None — pure prompt. |
| `.claude/skills/mira-vs-llm-benchmark.md` (new) | How to run a benchmark sweep. | None — pure prompt. |
| `tests/mira_bench.py` (new) | A/B/C runner. Reuses `tests/mira_eval.py` patterns. | Low — new file, no shared state. |
| `tests/eval/score_mira_bench.py` (new) | Scoring loop using `grader.py` + `judge.py`. | Low — new file. |
| `tests/benchmark/mira_vs_llm_questions.json` (new) | Question + golden-ideal set; can copy GS11 rows from `tests/golden_gs11_conveyor.csv` and add Q1, Q2, Q6, Q7. | None — pure data. |
| `tests/benchmark/docs/gs11/` (new) | Frozen doc-pack. | Manual ingestion artifact. |
| `docs/evaluations/` (new) | This doc + run outputs. | None. |

**Files that should NOT change:**
- `mira-bots/shared/engine.py` — production engine stays out of the benchmark loop.
- `mira-bots/shared/neon_recall.py` — wrap, don't modify.
- Production Doppler configs.
- `docs/migrations/` — no schema changes.
- `kg_entities` / `kg_relationships` — read-only.

---

## 10. Minimum viable version

**Definition of MVP "done":**

1. `python tests/mira_bench.py --question-set tests/benchmark/mira_vs_llm_questions.json --modes A,B,C` runs to completion on staging Neon.
2. Output JSON has one row per (question × mode) with: `answer_text`, `citations[]`, `chunks_returned`, `latency_ms`, `embedding_available`, `streams_used`.
3. A second pass scores each row across the 4 axes (correctness/citation/usefulness/safety) and writes `docs/evaluations/runs/<date>/report.md`.
4. The Q1 baseline question passes the floor condition `score_B ≥ score_C − 0.3` (KB is not worse than copy-pasting the manual into Claude).
5. Manual review of 10 random rows confirms the judge isn't lying — at least 9/10 judge scores match human assessment.

**Not in the MVP:**
- Multiple equipment families. Just GS10/GS11.
- CI integration / scheduled runs.
- Web dashboard / Hub page.
- Auto-ingestion of newly identified gap docs.
- "Generate the ladder logic" artifact step — that's a *consumer* of the benchmark output, not the benchmark.

---

## Decision

**GO.** Build the MVP described in §7 / §8 / §10.

Two preconditions before any code:
1. Confirm the staging NeonDB has a usable GS10/GS11 manual already ingested. If `kb_has_pair_coverage('AutomationDirect', 'GS11', bench_tenant) == (False, 0)`, the first task is *ingestion*, not harness code. Run the existing `mira-crawler` against the GS-Series manual into the bench tenant first.
2. Confirm the embedding sidecar is reachable from wherever the harness runs (Bravo or VPS). If not, the harness must still pass via the BM25 stream — but the report must say so explicitly so we don't mis-attribute degradation.

If both preconditions hold, Phase 1 is ~1–2 dev sessions.

---

## Next-step implementation prompt

> Copy/paste this into a fresh Claude Code session **after** the two preconditions above are confirmed.

```
Implement the Phase-1 MVP of the MIRA-vs-LLM benchmark harness defined in
docs/evaluations/mira-vs-llm-benchmark-evaluation-2026-05-23.md.

Constraints:
- Read-only against NeonDB. Use the staging branch only — assert that
  NEON_DATABASE_URL points to staging, fail hard otherwise.
- Do not modify mira-bots/shared/engine.py or neon_recall.py. Wrap them.
- Do not add new production code paths. Everything new lives in
  mira-mcp/stdio_entry.py, tests/mira_bench.py, tests/eval/score_mira_bench.py,
  .claude/agents/mira-knowledge.md, .claude/skills/mira-vs-llm-benchmark.md,
  and tests/benchmark/.
- Use Python 3.12, ruff-clean, httpx for HTTP, NullPool for Neon (per
  .claude/rules/python-standards.md).
- Doppler for secrets (factorylm/stg). No .env files.

Deliverables in this order:
1. Two new @mcp.tool wrappers in mira-mcp/server.py for recall_knowledge
   and kb_has_coverage. Read-only. Return the schemas in §8 of the eval doc.
2. mira-mcp/stdio_entry.py — runs the existing FastMCP server over stdio.
3. .mcp.json entry "mira-knowledge" pointing at stdio_entry.py.
4. .claude/agents/mira-knowledge.md — subagent that MUST call the MCP tools
   and MUST cite or say "unknown".
5. tests/benchmark/mira_vs_llm_questions.json — start with Q1–Q7 from §6.1
   of the eval doc and the existing rows from tests/golden_gs11_conveyor.csv.
6. tests/benchmark/docs/gs11/ — manifest.json + extracted manual text (the
   PDF should already live in the ingest pipeline; export the text used for
   condition C and hash it).
7. tests/mira_bench.py — runner that executes modes A (cascade only),
   B (cascade + MCP), C (cascade + frozen doc-pack). Writes JSONL.
8. tests/eval/score_mira_bench.py — 4-axis scorer using existing
   grader.py / judge.py. Writes docs/evaluations/runs/<date>/report.md.
9. .claude/skills/mira-vs-llm-benchmark.md — how to invoke it.

Verify by running:
  doppler run --project factorylm --config stg -- \
    python tests/mira_bench.py \
      --question-set tests/benchmark/mira_vs_llm_questions.json \
      --modes A,B,C --limit 3

and inspecting the resulting raw.jsonl + report.md. Acceptance: condition B
returns at least one chunk per question, citations are non-empty, and the
report renders without errors. Do NOT claim "done" until the report file
exists on disk and condition B score ≥ condition A score for at least
2 of the 3 sampled questions.

Stay surgical. Do not refactor. Do not add framework. Do not invent
specialist subagents.
```
