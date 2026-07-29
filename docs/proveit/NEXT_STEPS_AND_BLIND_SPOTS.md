# ProveIt — Next Steps & Blind Spots (brutally honest)

**Date:** 2026-06-24. **Audience:** anyone preparing the FactoryLM ProveIt demo. **Tone:** no
spin. This document says what the current proof *actually* proves, what it does **not**, and the
smallest honest path to a conference-credible end-to-end story. Every claim is grounded in the repo.

The ProveIt story we are building toward:
> **Ingest factory context → approve structure → attach live data → diagnose with evidence.**

---

## 1. What the current proof DOES prove

The proof packets (`docs/proof-packets/*.pdf`, harness `tools/proof/run_proof.py`) demonstrate, with
DB-backed evidence, **for the SimLab juice-bottling line**:

- A fault's **live signals land** through the *deployed relay ingest path* into `tag_events` +
  `live_signal_cache`, UNS-mapped (`accepted=89/89`, provenance `simulated=true`).
- Seeded **maintenance docs are retrievable** (242 chunks under `SIMLAB_TENANT_ID`).
- The **real Supervisor** (not the deterministic oracle) returns, for the filler underfill, a
  **grounded diagnosis** — names the asset, states the root cause (`bowl_pressure 5.3 PSI < 10-18`),
  cites the manual, recommends an action, **no clarifying question** — graded **PASS by the repo's own
  rubric** (`simlab/diagnostic.grade`).
- The packets are **self-verifying**: git SHA, config, corpus md5, retrieval mode, and the exact
  read-only SQL to re-check every number.

**Net:** *signals → asset → seeded-doc → grounded diagnosis* is real and auditable for at least one
fault, on the deployed ingest + retrieval + engine stack.

## 2. What the current proof does NOT prove (read this twice)

1. **It is NOT "approve structure → diagnose."** The docs were **seeded directly** into
   `knowledge_entries`; **no human approval step gates what MIRA cites.** The diagnosis path
   (`mira-bots/shared/neon_recall.py::recall_knowledge`) has **no `WHERE approval_state='verified'`
   clause** — it cites every chunk in the tenant's corpus regardless of approval. Only
   `ctx_enrichment.fetch_ctx_approved_signals` (signals only) respects approval. **So the
   approve→diagnose half of the ProveIt thesis is currently aspirational, not demonstrated.** This is
   the single most important gap.
2. **Only 1 of 3 real scenarios passes the strict rubric.** Under `simlab.diagnostic.grade`
   (not my earlier loose heuristic): **filler = PASS**, **capper = REVIEW** (root-cause phrase
   "chuck wear" not stated; said "under-torque"), **casepacker = REVIEW** (`asset_hit=False` —
   "casepacker01" vs "case packer"; root-cause not matched). Some REVIEWs are rubric-matching
   artifacts (asset tokenization, citation-by-filename vs by-section), some are genuine. **We do not
   yet have 3/3 clean grounded diagnoses.**
3. **Retrieval is degraded.** Every answer ran **`bm25-only`** — the embedder (Ollama nomic-embed)
   and reranker (Nemotron/NVIDIA) were not serving vectors, so ranking is lexical-only. It worked
   only because the SimLab corpus is tiny and clean. **This will not hold for a larger/mixed corpus.**
4. **`citations_hit=[]` for every scenario.** MIRA cites doc *sections* ("Process Tags", "intro");
   the rubric matches *filenames*. So citation-accuracy scores 0 even when the cited content is
   correct — a real mismatch between what MIRA emits and what the grader (and a human) expects.
5. **No pasteurizer exists in SimLab.** The 4th packet is a **clearly-labeled CIP-temperature
   substitute**. A `tools/proof/integrity.py` guard + tests **fail the build** if a substitute is
   ever labeled "pasteurizer".
6. **Discovery/contextualization is not in the loop at all.** The proof started from seeded docs +
   a scripted scenario; it never exercised documents/photos/PLC-exports → *proposed* assets/tags/UNS.

---

## 3. Repo-grounded gap report (the full ProveIt flow)

Flow: **Documents/photos/PLC exports → proposed assets/tags/docs/UNS → human approval → live
telemetry attached to approved context → scenario fault → MIRA diagnosis → proof packet →
Langfuse/DB/SQL verification → repeatable demo script.**

| Stage | State | Where (file) |
|---|---|---|
| Docs/PLC → **proposed** structure | ✅ **REAL** | `mira-contextualizer/` (regex+table mining → `extractions`), `mira-plc-parser/` (L5X/CSV→IR), `mira-crawler/ingest/proposal_writer.py` (→ `relationship_proposals` + `ai_suggestions`) |
| Photos → proposed | 🟡 partial | `mira-bots/shared/workers/nameplate_worker.py` + `photo_ingest_worker.propose_from_nameplate` (writes `ai_suggestions`) — not in the proof |
| Proposed structure persisted | ✅ REAL | `ai_suggestions` (mig 027), `relationship_proposals`+`relationship_evidence` (mig 018), `kg_entities/kg_relationships.approval_state` (mig 029), `asset_agent_status` (mig 046) |
| **Human approval UI** | ✅ REAL | `mira-hub` `/knowledge/suggestions`, `/api/proposals`, `/api/proposals/[id]/decide` (the only proposed→verified path) |
| **Diagnosis reads APPROVED context** | ❌ **MISSING (the gap)** | `neon_recall.recall_knowledge` has **no approval filter**; only `ctx_enrichment.py` (signals) does. Approval UI is currently **cosmetic for documents/fault-codes.** |
| Live telemetry → attached context | 🟡 partial | landing is REAL (`mira-relay` → `live_signal_cache`); but the proof **injects `live_tags` directly** into `process()` — it does **not** read `live_signal_cache` into the engine, and there is **no streaming** (no MQTT subscriber landed; `/api/mira/ask` reads the cache Hub-side, untested here) |
| Scenario fault | ✅ REAL | `simlab/scenarios.py` (6 replayable, ground-truth rubrics) — **no pasteurizer, no standalone conveyor-jam** |
| MIRA diagnosis | 🟡 1/3 rubric-PASS | `mira-bots/shared/engine.py` (real Supervisor, `MIRA_DIRECT_ANSWER_MODE=1`) |
| Proof packet | ✅ REAL | `tools/proof/run_proof.py` + `build_pdf.py` (now with provenance + rubric) |
| Langfuse verification | ❌ not emitted this run | `mira-bots/shared/telemetry.py` (langfuse v2 `.trace()` API; **Py3.14 ↔ langfuse-version skew** here; deployed Py3.12+langfuse2.50 emits `supervisor.process`). DB/SQL verification IS provided instead. |
| Repeatable demo script | 🟡 partial | `run_proof.py --clean` reproduces from a known-seeded DB; **no one-command clean-room from empty DB**, and it assumes the SimLab docs are already seeded |

---

## 4. Forward blind spots (named, with the honest risk)

1. **Discovery/contextualization not proven** — the proof skips docs/PLC→proposed→approved. Until a
   packet starts from an *uploaded* doc and ends at a cited diagnosis, "ingest context" is unproven.
2. **Approval not enforced in retrieval** — `recall_knowledge` ignores `approval_state`. A demo that
   claims "approve, then it answers" is **currently false**; rejecting a doc in the Hub does not stop
   it being cited unless it's removed from the corpus. **Highest-credibility risk.**
3. **Tenant-scoped recall risk** — recall tenant comes from the **global** `MIRA_TENANT_ID` env
   (which ships as the literal `"staging"` in `factorylm/stg`), not reliably per-request. A
   misconfigured env silently recalls the wrong tenant or zero docs.
4. **Seeded-doc contamination risk** — the proof scopes recall to SimLab by also setting
   `MIRA_SHARED_TENANT_ID=SIMLAB` (drops the shared OEM corpus). A real tenant wants *both* its docs
   and the OEM library; mixing them needs working ranking (see #6).
5. **Tiny-corpus overfitting** — 242 clean synthetic chunks make BM25 look good. A plant with
   thousands of mixed manuals will surface wrong chunks without vectors+rerank.
6. **BM25-only ranking weakness** — every proof answer used `bm25-only`. Lexical match ≠ semantic
   relevance at scale.
7. **Embedder/reranker outage** — Ollama nomic-embed + Nemotron have **no health check / recovery**;
   they fail silently to BM25. The packet now *reports* `retrieval_mode`, but nothing *alerts*.
8. **Langfuse Python/version skew** — telemetry needs langfuse v2 (Py≤3.12); the proof host is
   Py3.14. Traces silently no-op. Documented in every packet; not yet a compat *check* in CI.
9. **Substitute-scenario honesty** — enforced by `integrity.assert_substitute_honest` + tests; keep
   it. Never let a CIP/temperature fault be presented as a pasteurizer.
10. **No real pasteurizer asset** — SimLab's juice line has none. Either add a pasteurizer asset+docs
    to SimLab (new content, deliberate) or keep the labeled CIP substitute. **Do not fake one.**
11. **Conveyor-jam naming ambiguity** — there is no standalone conveyor-jam scenario; `D` is a
    **case-packer** jam that *blocks `conveyorzone02`*. Label it precisely.
12. **`live_tags` injected, not streamed** — the proof passes `live_tags` into `process()` directly;
    it does **not** read `live_signal_cache`, and there is **no live stream**. "Attach live data" is
    a strong overstatement of the current proof.
13. **MQTT/UNS bridge bypassed** — the foreign-feed/Sparkplug path is design-only; the proof uses the
    HTTP relay + direct injection. MQTT is **not** part of the proof.
14. **Hub approval state unused by diagnosis** — see #2. The Hub `decide` route writes
    `approval_state='verified'`, but the engine never reads it for knowledge retrieval.
15. **Clean-DB reproducibility** — `--clean` removes the SQLite session db, but a true "from an empty
    Neon branch" rerun (apply migrations → seed → run) is not yet one command.
16. **Third-party runnability** — reproduction needs Doppler `factorylm/stg`, the seed step, and the
    three `MIRA_*` env overrides. Not yet runnable without tribal knowledge (documented below).
17. **Garage conveyor as a real discharge conveyor** — only safe **read-only / supervised**; any
    actuation path must stay behind the bench-only + e-stop + LOTO rules (`.claude/rules/
    fieldbus-readonly.md`, `plc-ccw-deploy` skill). Not part of this proof; do not wire it live.

---

## 5. What we hardened in this pass (config/health/docs/repro — no new architecture)

- **Reused the real rubric grader** (`simlab.diagnostic.grade`) for the verdict — replaced loose
  heuristics; this is what exposed capper/casepacker as REVIEW. (Honest > flattering.)
- **Provenance metadata** in every packet: git SHA + dirty flag, config snapshot, corpus chunk count
  + doc-set md5, embedder/reranker/langfuse health, Python version.
- **Retrieval mode reported** from `neon_recall` `retrieval_streams` → each packet states `bm25-only`.
- **Substitute honesty guard** (`integrity.assert_substitute_honest`) — build fails if a substitute
  is mislabeled as pasteurizer. Covered by tests.
- **Langfuse degraded-mode documented**, not silently passed (`health.langfuse_note`).
- **Clean-rerun flag** (`run_proof.py --clean`) removes the only hidden local state (the SQLite
  session db).
- **Deterministic tests** (`tools/proof/test_proof_integrity.py`, 9 passing, no DB/net).

We did **not** change MIRA prompts, add MQTT/UI, or build new systems.

---

## 6. ProveIt readiness checklist

### DEMO-CRITICAL (must be true to show the story honestly)
- [ ] **Approval gate in retrieval** — add `approval_state` (or a "published" view) filter to
      `recall_knowledge` so "approve → it answers, reject → it stops citing" is *real*. (Smallest:
      a `knowledge_entries.published`/approval join, opt-in via flag.) **This is the #1 demo-critical fix.**
- [ ] **One end-to-end discovery packet** — upload a real doc → contextualizer proposes →
      human approves in Hub → that approval makes the chunk citable → MIRA cites it. Even *one* proves
      the full thesis.
- [ ] **3/3 real scenarios rubric-PASS** — fix the rubric/answer mismatches (asset tokenization;
      decide citation-by-section vs by-filename) OR tune scenarios' expected phrases to what a correct
      answer actually says. No prompt changes unless unavoidable.
- [ ] **Read live data from `live_signal_cache`** into the engine (not direct `live_tags` injection)
      so "attach live data" is honest. (`/api/mira/ask` already does this Hub-side — prove that path.)

### CREDIBILITY-CRITICAL (a sharp attendee will catch these)
- [ ] **Embedder + reranker up** (or the packet loudly says "degraded BM25-only" — it now does).
- [ ] **Bigger/mixed corpus test** — prove retrieval survives the OEM library + SimLab docs together.
- [ ] **Langfuse trace on the deployed Py3.12 path** — capture one real `supervisor.process` trace.
- [ ] **Per-request tenant** — stop relying on the global `MIRA_TENANT_ID="staging"` env.
- [ ] **Clean-room reproduction** — one script from an empty Neon branch (migrate → seed → run).

### NICE-TO-HAVE
- [ ] Command-Center live-value panel (visual signal change on screen).
- [ ] Citation rendering that shows the doc + section a human recognizes.
- [ ] A pasteurizer asset+docs in SimLab (deliberate new content) to retire the CIP substitute.

### DO-NOT-BUILD-YET
- [ ] MQTT/Sparkplug subscriber (gated; design-only — see the Lane-3 plan).
- [ ] Any PLC/control write or live garage-conveyor actuation.
- [ ] New UI polish beyond what the demo needs.
- [ ] A second diagnostic engine / parallel retrieval path.

---

## 7. What must NOT be faked
- **No fake pasteurizer.** SimLab has none; the substitute is labeled and guard-enforced.
- **No "approved" claim** until `recall_knowledge` actually filters on approval.
- **No "streaming live data"** claim while the proof injects `live_tags` directly.
- **No hiding `bm25-only`** — the retrieval mode is in every packet.
- **No green verdict from loose heuristics** — the rubric grader is the verdict.

## 8. How to reproduce (third-party, no tribal knowledge beyond Doppler access)
```bash
# 1. one-time: seed the SimLab docs (staging tenant) — idempotent
doppler run --project factorylm --config stg -- python tools/seeds/seed-simlab-docs.py --commit
# 2. run the proof (clean removes the SQLite session db; harness force-sets the 3 MIRA_* env vars)
doppler run --project factorylm --config stg -- python tools/proof/run_proof.py --clean
# 3. build the PDFs
python tools/proof/build_pdf.py
# 4. verify integrity (deterministic, offline)
pytest tools/proof/test_proof_integrity.py -q
```
Each packet's §6 (Provenance) and §9 (the SQL) let a reviewer re-check every number against staging.

## 9. The honest CIP/pasteurizer explanation (say this out loud at the demo)
> "The SimLab line doesn't have a pasteurizer, so we did **not** fake one. The temperature-fault
> packet is the closest *real* process-temperature fault — the CIP skid supply-temp-low (CIP002) —
> and it's labeled SUBSTITUTE on every page. A build-time guard rejects any attempt to call it a
> pasteurizer."

## 10. The next 3 tasks (in order)
1. **Make approval real in retrieval.** Add an approval/published filter to `recall_knowledge`
   (flag-gated) + a test that an *unapproved* chunk is NOT cited and an *approved* one IS. This turns
   the Hub approval UI from cosmetic into the ProveIt centerpiece.
2. **One discovery→approve→diagnose packet.** Upload one real manual → contextualizer proposal →
   Hub approve → cited diagnosis, captured as a packet. Proves the full thesis once.
3. **Close the rubric gap to 3/3** (asset tokenization + citation section/filename) and **prove the
   `live_signal_cache→engine` read path** (via `/api/mira/ask`) so "attach live data" is literal.

## Cross-references
- `docs/proof-packets/*.pdf`, `tools/proof/{run_proof,build_pdf,integrity}.py`, `tools/proof/test_proof_integrity.py`
- `mira-bots/shared/neon_recall.py` (recall — the approval gap), `ctx_enrichment.py` (the one approval-aware path)
- `mira-hub` migrations 018/027/029/046 (the approval model), `/api/proposals/[id]/decide` (the verify path)
- `simlab/scenarios.py`, `simlab/diagnostic.py` (rubric), `mira-bots/shared/telemetry.py` (Langfuse)
- `docs/plans/2026-06-24-contextualization-demo-plan.md`, `docs/plans/2026-06-23-lane3-phase3a-plain-json-mqtt-codec.md`
