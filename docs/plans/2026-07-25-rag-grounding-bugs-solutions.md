# RAG Grounding Bugs — Verified Solutions & Implementation Plan

**Date:** 2026-07-25 · **Bugs:** #2207, #2208, #2209, #2211 · **Baseline:** `origin/main` `0bd50b6ed`
**Method:** ultracode workflow (understand → adversarial-verify → synthesize) + focused agent for #2207.
**Status:** DESIGN VERIFIED — not yet implemented. Every fix's final gate is the **staging eval** (`staging-gate` CI + relevant `tests/eval/` regime), per CLAUDE.md "engine/RAG/retrieval changes MUST pass the staging gate."

> These four all live in `mira-bots/shared/neon_recall.py`, `mira-bots/shared/workers/rag_worker.py`,
> and `mira-bots/shared/engine.py`. **#2207 and #2211 both change `recall_knowledge()`'s signature and
> the `rag_worker.py:614` call site** — they MUST be coordinated. Never edit these in parallel worktrees.

---

## The conflict surface (why ordering matters)

| Bug | `neon_recall.py` | `rag_worker.py` | `engine.py` |
|---|---|---|---|
| #2208 | 276–320 (extraction gate) | — | — |
| #2207 | 99, 827 (`recall_knowledge` sig + vector filter) | 614 (call), 676–712 (gate) | — |
| #2211 | 377–381, 442–444, 730 (`recall_knowledge` sig) | 581/614/647 (calls), 720–751 (vendor filter) | — |
| #2209 | — | 549/564 (photo-vs-text asymmetry, context) | 3827–3843, 3878–3882 |

**Recommended order:** **#2208 → (#2207 + #2211 together) → #2209.**
- #2208 is source-level and isolated (safest first).
- #2207 + #2211 both extend `recall_knowledge()` and touch `rag_worker.py:614` → do as ONE coordinated change: the function gains **both** `min_similarity` (#2207) and `state`/product-fallback (#2211), and the call site passes both.
- #2209 is mostly isolated to `engine._call_with_correction()` + the Nemotron rewrite.

---

## #2207 — 0.70 cosine floor shadows triage relaxation (P1, confidence: HIGH)

**Root cause.** `MIN_SIMILARITY = float(os.getenv("MIRA_MIN_SIMILARITY","0.70"))` (`neon_recall.py:99`) filters vector rows at retrieval (`:827 if r["similarity"] >= MIN_SIMILARITY`), **before** the worker's triage-aware gate sees them. So the relaxed thresholds in `rag_worker.py:678–681` (0.55 medium / 0.45 low) are unreachable for vector-only results — chunks with 0.45–0.70 cosine were already dropped → **0 chunks** on medium/low-triage queries.

**Minimal fix.** Thread the threshold through: add `min_similarity: float | None = None` to `recall_knowledge()`; default to the env var; filter with the effective value at `:827`. Compute the triage-relaxed threshold at the `rag_worker.py:614` call site and pass it. Keep the post-retrieval gate as a backstop (do NOT delete it — precision safety).

**Patch spec.**
- `neon_recall.py:99` → rename to `_DEFAULT_MIN_SIMILARITY`; add `min_similarity` param; `eff = min_similarity if min_similarity is not None else _DEFAULT_MIN_SIMILARITY`; `:827` uses `eff`.
- `rag_worker.py:614` → before the call, derive `_recall_min_sim` from triage confidence (medium→0.55, low→0.45, else `None`) and pass `min_similarity=_recall_min_sim`.

**Regression test.** New `tests/eval/test_recall_triage_relaxation.py`: a chunk at 0.60 cosine is **returned** with `min_similarity=0.55` and **filtered** at the 0.70 default. (Prefer a seeded-fixture integration case; unit-mock acceptable.)

**Risk.** Callers of `recall_knowledge`: `rag_worker.process()` (614) + subquery decompose (581). Lowering the floor lets in 0.45–0.70 chunks → precision risk; mitigated by the retained backstop gate + citation compliance. **Staging gate:** golden suite must not regress answer quality. Interacts with #2211 (same signature).

---

## #2208 — chat path poisons its own retrieval via fault-code false positives (P1, confidence: HIGH; verify verdict: needs-revision → folded in)

**Root cause.** `_extract_fault_codes()` extracts alphanumeric (Pattern 1, `_FAULT_CODE_RE`) **and** compound-alpha (Pattern 2, `_COMPOUND_ALPHA_RE`) codes **without** the `_FAULT_CONTEXT_RE` gate that already guards Pattern 3. `_normalise_fault_query()` joins "bay 12"→"bay-12" (matches Pattern 1); "re-do"→"REDO" (matches Pattern 2). These false codes hit `_like_search()` (ILIKE at hardcoded `similarity=0.5`), which sets `_has_non_vector=True` and **bypasses the cosine gate** (`rag_worker.py:688–693`). Free-text chat surfaces (Telegram/Slack/email) build `retrieval_query` from the full message and are all vulnerable; `ask_api` is partially immune (restricts `retrieval_query`).

**Adversarial correction (must include):** gate **both Pattern 1 AND Pattern 2** behind `has_fault_context`; the original patch only gated Pattern 1. Leave Pattern 3 ungated (curated `_VFD_ALPHA_CODES`, safe).

**Patch spec.** `neon_recall.py:276–320`: compute `has_fault_context = bool(_FAULT_CONTEXT_RE.search(query_text))` once; wrap Pattern 1 (`~:292`) and Pattern 2 (`~:299`) extraction loops in `if has_fault_context:`.

**Regression test.** New `tests/test_fault_code_extraction_gate.py`: `"the conveyor in bay 12 stopped"` → `[]`; `"re-do the setup"` → no `REDO`; `"fault F0004"` / `"error E001 occurred"` → codes preserved. Plus `tests/eval` fault-recall baseline must not regress.

**Risk / KNOWN TRADE-OFF (staging gate).** Terse bare codes with **no** context word (`"F0004"` alone) now extract nothing → possible recall loss. Real techs usually say "getting F0004"/"F0004 error" (context present). **Must** run the regime2 fault-recall eval; if terse-code groundedness drops >5%, add a length/prefix heuristic for known VFD families. Document the trade-off in the PR body.

**Residual (out of scope, note it):** even with extraction fixed, other ILIKE/BM25 chunks still bypass the cosine gate via `_has_non_vector`. Closing that amplifier (gating ILIKE at >0.5 or removing the bypass) is a larger, separate change — coordinate with #2207.

---

## #2209 — multi-turn follow-ups drop equipment context → 0 chunks (P1, confidence: HIGH; verify verdict: ready-to-implement)

**Root cause.** Asymmetric enrichment. `rag_worker.py:551` prepends asset context to `embed_query` **only when a photo is attached**; text-only follow-ups pass the bare message (`:549`), and `:564 recall_query = retrieval_query or embed_query` defaults to bare. Meanwhile `engine._call_with_correction()` sets `query = message` (`:3828`) without prepending the resolved UNS context that **persists across turns** (`engine.py:1889–1923`, `session_manager.py:120`). Bare follow-ups ("Haven't meggered it yet", "Voltage at the MCC bus…") → embedding+BM25 with no equipment tokens → 0 chunks (~34% of ungrounded).

**Patch spec.**
- `engine.py:~3828` — after `query = message`, if `state["state"] != "IDLE"` and `uns_context.manufacturer` with `confidence >= 0.7`, build `enriched_query = f"{manufacturer} {model?} {message}"`; pass `enriched_query` to `rag.process()` at `:3847`.
- **Adversarial correction (must include):** the Nemotron self-critique rewrite at `~:3879–3880` currently gets **bare `message`** — pass the **enriched** query so retries keep equipment context.

**Double-enrichment guard.** The photo path enriches at `rag_worker.py:551` guarded by `if photo_b64`; the engine prepend runs before `rag.process()`. Since the text branch (`:549`) is the `else` of the photo branch, `photo_b64=None` → no double-prepend. Add a test asserting single enrichment (no `"Rockwell PowerFlex 525 Rockwell PowerFlex 525 …"`).

**Regression test.** New `tests/test_multiturn_equipment_context.py` (regime4): (1) text follow-up in active session → enriched recall query, >0 chunks; (2) photo follow-up → single enrichment; (3) IDLE session → NO enrichment (prevents stale cross-query leak). **Spy on the actual `rag.process()` call** so the test can't pass trivially.

**Risk.** 3 callers of `_call_with_correction()` (2638, 2787, 3899) all benefit. No cross-tenant leak (per-chat state). Staging gate: replay June bare-followup traces, confirm >0 chunks; sanity-check Nemotron rewrites aren't malformed by the prepended label.

---

## #2211 — retrieval extraction precision (P2, confidence: MED after correction; verify verdict: needs-revision → folded in)

**Root cause (3 compounding defects).**
1. Cross-vendor filter (`rag_worker.py:720–751`) applies **unconditionally** — a false-positive vendor alias ("delta pressure" → "Delta Electronics") suppresses **all** chunks.
2. Product-name rerank (`neon_recall.py:377–381`) uses only the hardcoded `_PRODUCT_NAME_RE`; **no fallback** to `uns_context.model`, so stranger-upload models never trigger `_product_search()`.
3. Model-suffix exclusion (`neon_recall.py:442–444`, `%{name}0%`) blocks only the `0` suffix, not 401–409 or `40A`.

**Adversarial corrections (the original patch was BROKEN — must fix):**
- **Confidence is a float**, not `"high"/"medium"` strings → gate must be `vendor_confidence >= 0.7`, not `in ("high","medium")`.
- `recall_knowledge()` has **no `state` param** → to do the product fallback either (A) add `state=None` to the signature and update all 3 callers (581/614/647), or (B) do the fallback in `rag_worker.py` before the call. **Prefer (A)** and **coordinate with #2207** (same signature change).
- `query_by_model()` **does not exist** — the exclude SQL is **inlined** at `neon_recall.py:~444`. Widen it with additional ILIKE alternation or a PostgreSQL `~` word-boundary regex `(^|[^0-9A-Za-z]){name}([0-9A-Za-z]|$)` — **verify Neon regex dialect on staging first**.
- Test path is **regime2_rag**, not `regime5_retrieval`.

**Regression test.** `tests/test_retrieval_precision_gate.py`: low-confidence vendor → filter skipped (both chunks kept); stranger model "MyDrive 42" → fallback returns `["MyDrive 42"]`; model exclude keeps `40`, drops `400/401/40A`. Plus `tests/eval` hybrid baseline.

**Risk / staging gates.** grep all `recall_knowledge` / `_extract_product_names` call sites before the signature change. Verify the confidence-distribution supports 0.7. Verify the Neon regex on staging with real PowerFlex 40x models. Upload a stranger-manufacturer manual (Magnetek IMPULSE) and confirm product rerank fires.

---

## Combined test plan (offline, what CAN be verified from Bravo)

All commands use **`python3.12`** (BRAVO `python3` is 3.14 → breaks langfuse).

```bash
# BASELINE on main first (separate pre-existing red from regressions):
python3.12 -m pytest tests/eval/test_hybrid_retrieval_baseline.py -v --tb=short > /tmp/baseline_main.log 2>&1

# Per-fix unit tests (new):
python3.12 -m pytest tests/test_fault_code_extraction_gate.py -v          # #2208
python3.12 -m pytest tests/eval/test_recall_triage_relaxation.py -v        # #2207
python3.12 -m pytest tests/test_retrieval_precision_gate.py -v            # #2211
python3.12 -m pytest tests/test_multiturn_equipment_context.py -v          # #2209

# POST-FIX regression:
python3.12 -m pytest tests/eval/test_hybrid_retrieval_baseline.py -v --tb=short > /tmp/baseline_fixed.log 2>&1
diff <(grep FAILED /tmp/baseline_main.log) <(grep FAILED /tmp/baseline_fixed.log)  # additions = regressions
```
Run each new test file from `mira-bots/` in isolation if a dual-rootdir collision appears.

## Open risks — ALL require staging (db-inspect / eval / log replay), NONE verifiable statically
1. #2211 confidence type/threshold — confirm float + that 0.7 matches the prod confidence distribution.
2. #2209 Nemotron rewrite with a prepended equipment label — confirm rewrites stay coherent (`NEMOTRON_ENABLED=1` on staging).
3. #2211 Neon regex word-boundary dialect — test `~` on staging Neon with real PowerFlex 40x.
4. #2211 product-fallback signature change — grep every `recall_knowledge` caller.
5. #2209 double-enrichment — confirm no `"<vendor> <model> <vendor> <model> …"` in logs.
6. #2208 terse-code recall — regime2 fault-recall eval must not drop >5%.

## Provenance
Workflow `wf_c3089557-4c4` (agents for #2208/#2209/#2211 + synthesis) + focused agent for #2207 (its workflow reader hit a stream-idle timeout). Adversarial verdicts: #2209 sound/ready; #2208 & #2211 needed-revision (corrections folded in above); #2207 high-confidence.
