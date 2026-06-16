# Path B Plan — QA Assessment

**Plan:** Local-First Architecture (jaunty-swinging-creek)
**Auditor:** QA thread T-019d55bd-0c80-7378-bfd8-d3aeb1f5c87d
**Date:** 2026-04-03

---

## Verdict: APPROVE WITH FIXES

The plan is well-structured. Claude's pushback on the PRD (keep ChromaDB, don't rebuild existing abstractions) is correct — I verified every file reference against the codebase. The 60% reuse claim is accurate. Below are the issues to fix before or during execution.

---

## ERRORS IN THE PLAN

### E1 — Inference host is wrong: plan says Charlie, but Charlie has known blockers

The plan assigns Charlie (100.70.49.126) as the Path B inference host. CLAUDE.md documents two open blockers on Charlie:
- **"Charlie Doppler keychain"** — same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`
- **"Charlie HUD"** — needs local terminal session to start (keychain blocks SSH start of Doppler)

If Path B sidecar on Charlie needs Doppler for any secrets (e.g., `ANTHROPIC_API_KEY` for Tier 3 fallback), the keychain issue will block deployment. The plan doesn't mention fixing this prerequisite.

**Action:** Either fix Charlie's Doppler keychain first (Phase 0), or pass secrets via env vars in `docker-compose.pathb.yml` sourced from the VPS Doppler instance.

---

### E2 — Plan says "Bravo stays untouched running Path A" — Bravo doesn't run Path A

Path A (SaaS) runs on the **VPS** (factorylm-prod, 165.245.138.91), not Bravo. Bravo is the Mac Mini used for photo staging and local development. The plan's separation rationale is correct (don't touch Path A), but the host attribution is wrong. This matters because if someone reads this plan literally and thinks Bravo is serving production traffic, they'll avoid Bravo for the wrong reason.

**Action:** Correct to: "VPS (factorylm-prod) stays untouched running Path A. Bravo is available but reserved for photo pipeline. Charlie is dedicated to Path B."

---

### E3 — /route endpoint duplicates /rag responsibility without clear boundary

The plan adds `POST /route` to mira-sidecar. But `/rag` already does: embed → retrieve → LLM → answer. The new `/route` would do: classify → pick tier → embed → retrieve → LLM → answer. This creates two parallel query paths in the same service with overlapping logic.

The plan doesn't specify whether:
- `/rag` continues to exist alongside `/route`
- `/route` calls `/rag` internally
- `/rag` gets tier routing injected into it
- The Pipe Function switches from calling `/rag` to `/route`

**Action:** Decide one of:
- **(A)** Add tier routing as middleware inside the existing `/rag` endpoint (controlled by `tier_routing_enabled` flag). Pipe Function doesn't change. Cleanest.
- **(B)** `/route` is a new endpoint that internally calls `rag_query()` after selecting the tier. `/rag` stays as-is for backwards compatibility. More code, but clearer separation.

Recommendation: **(A)** — the Pipe Function already calls `/rag`, and the plan says tier routing is feature-flagged. Injecting it into `/rag` means zero changes to the Pipe or any other caller.

---

### E4 — Plan doesn't address the QA audit bugs that are still open

The previous QA audit (QA_AUDIT_2026-04-03_paperclip.md) flagged 5 bugs, several still unfixed:
- **B2:** Dockerfile doesn't COPY uv.lock (non-reproducible builds)
- **B4/B5:** mira-mcp and mira-ingest ports exposed to internet
- **B1:** Version string mismatch

The plan creates new files (tier_router.py, health_probe.py, docker-compose.pathb.yml) on top of the broken Dockerfile. The new `docker-compose.pathb.yml` will presumably copy the same Dockerfile — inheriting B2.

**Action:** Fix B2 before Phase 2. One-line change: `COPY pyproject.toml uv.lock ./` and remove `uv lock --no-cache`.

---

## WARNINGS

### W1 — Health probe design has a race condition risk

Plan says: "Background task pings Charlie every 30 seconds. Caches result."

If the health probe runs as a FastAPI background task (via `asyncio.create_task` in lifespan), it shares the event loop with request handlers. A slow/hung health check (Charlie network timeout) could block the event loop for `tier1_timeout` seconds (15s per the plan). During that window, all `/rag` requests stall.

**Action:** Use `asyncio.wait_for()` with a short timeout (3s) on the health probe, separate from `tier1_timeout` (which is for actual inference). Or run the probe in a background thread.

---

### W2 — Query classifier "< 40 words = SIMPLE" is brittle

The plan uses word count as the complexity heuristic: `< 40 words → SIMPLE → Tier 1`. Examples that break this:

- "What does fault code F047 mean on the PowerFlex 525 when the drive is in auto-tune mode and the motor is running at 30Hz with a 460V supply?" — 28 words, but requires cross-document reasoning (fault table + auto-tune chapter + motor specs)
- "Why?" — 1 word, but if it's a follow-up in a multi-turn diagnostic session, it's COMPLEX

**Action:** Consider a keyword-based classifier instead of (or in addition to) word count. The plan already has the right instinct ("fault code lookup, alarm, procedure, how-to, PM, work order") — encode those as pattern matches, not word count.

---

### W3 — Phase 3 creates a second ChromaDB instance on Charlie with no sync mechanism

The plan says Charlie gets "its own ChromaDB instance" with separately ingested documents. This means:
- Brain 1 (shared OEM docs) must be ingested twice — once on VPS, once on Charlie
- Any new document ingested on the VPS is NOT available on Charlie (and vice versa)
- No sync mechanism is described

For MVP this is fine (manually ingest the same 3 PowerFlex manuals on both). But it should be called out as a known limitation.

**Action:** Add to "Deferred" section: "ChromaDB sync between VPS and Charlie — manual re-ingest for now."

---

### W4 — Tier 3 fallback from Charlie requires ANTHROPIC_API_KEY on Charlie

When Charlie can't handle a query (COMPLEX) and Tier 2 is disabled, the plan falls back to Tier 3 (Claude API). But if `docker-compose.pathb.yml` runs mira-sidecar on Charlie with `LLM_PROVIDER=ollama`, there's no Anthropic provider initialized. The factory in `llm/factory.py` creates ONE provider at startup — it doesn't support runtime switching between Ollama and Anthropic.

The tier router would need to either:
- Initialize both providers at startup (Ollama for Tier 1 + Anthropic for Tier 3)
- Or proxy Tier 3 requests to the VPS sidecar instance

Neither is addressed in the plan.

**Action:** This is the biggest architectural gap. Options:
- **(A)** Tier routing lives on the VPS sidecar only. VPS decides: send to Charlie Ollama (Tier 1) or use its own Anthropic provider (Tier 3). Charlie runs bare Ollama, no sidecar. Simplest.
- **(B)** Initialize two LLM providers in the sidecar lifespan. Tier router picks which one to call. Requires refactoring `create_providers()` to return a dict of providers instead of a single tuple.

Recommendation: **(A)** — keeps Charlie stateless (just Ollama), all routing logic on VPS.

---

### W5 — Dockerfile COPY won't include new routing/ directory

`Dockerfile:19-21` currently copies:
```dockerfile
COPY llm/ llm/
COPY rag/ rag/
COPY fsm/ fsm/
```

The plan creates `mira-sidecar/routing/` with `__init__.py`, `tier_router.py`, `health_probe.py`. These won't be in the Docker image unless the Dockerfile is updated with `COPY routing/ routing/`.

**Action:** Add to Phase 2 file list: "Modify `Dockerfile` — add `COPY routing/ routing/`"

---

### W6 — No Pipe Function changes listed, but /route changes the contract

If the plan goes with a new `/route` endpoint (E3 option B), the Pipe Function (`mira_diagnostic_pipe.py:80-81`) still calls `/rag`. It would need updating to call `/route` instead, passing `user_id` and `facility_id`. This file is not in the "Files Modified" table.

If the plan goes with option A (inject routing into `/rag`), no Pipe changes needed.

---

## PLAN STRUCTURE — WHAT'S GOOD

- **Phase gating is correct.** Each phase has a clear gate check before proceeding.
- **Feature flag approach is correct.** `tier_routing_enabled: bool = False` means Path A is never at risk.
- **Embedding model decision is correct.** Keeping nomic-embed-text avoids re-ingest. Deferring EmbeddingGemma is the right call.
- **Tier 2 slot-but-disabled is correct.** Zero cost, ready when needed.
- **Benchmark harness (Phase 5) before stability run (Phase 6) is correct.** Don't run for 7 days if the model fails on 10/20 queries.

---

## RECOMMENDED CHANGES TO PLAN

| # | Change | Why |
|---|--------|-----|
| 1 | Fix Dockerfile `COPY uv.lock` before Phase 2 | Inherited bug from prior session |
| 2 | Decide /route vs inject-into-/rag (E3) | Avoids duplicate query paths |
| 3 | Address Tier 3 fallback provider initialization (W4) | Current factory can't runtime-switch providers |
| 4 | Add `COPY routing/ routing/` to Dockerfile in Phase 2 | New directory won't be in Docker image |
| 5 | Fix Charlie Doppler keychain as Phase 0 prerequisite | Blocks deployment |
| 6 | Correct "Bravo runs Path A" to "VPS runs Path A" | Factual error |
| 7 | Add ChromaDB sync limitation to Deferred section | Known gap |
