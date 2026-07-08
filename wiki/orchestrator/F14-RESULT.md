# F14 — Lens F Beta-blocker ledger — DURABLE RESULT (concurrency-safe copy)

**Run:** F14 · Round 15 · 2026-06-23
**Audited:** `origin/main@47e6fb42` (deploy truth; HEAD `feat/inference-together-replaces-gemini` 48 behind/1 ahead; freshness-guard exit 3 STALE → `git show`). All 3 F-canonical docs (`known-issues.md`, `hot.md`, master-plan) match origin/main byte-for-byte.
**Verdict:** 🟢 **GREEN held.** Scorecard **5G/1Y/0R** unchanged (D lone YELLOW).

> ⚠️ **Concurrency event (mid-run):** a concurrent process reverted the working-tree `BETA_READINESS.md` to its committed HEAD (12,713-byte old "Audit Lenses" snapshot) — `git status` shows it un-modified; `git stash list` stash@{0} is on a *different* branch (`rebase/i18n-missing-keys`), i.e. a branch-switch/stash reverted the living scorecard in the tree. **Recovered from my own `BETA_READINESS.md.bak-f14` (166,007 bytes, made at run start) — NO stash touched** (hard rule honored). This durable file + `kg/f14-findings.jsonl` + `artifact.html` + the HISTORY line preserve F14 regardless of further clobbering.

## Headline
- **Deploy truth near-frozen since F13:** the only commit `84ceeddd..47e6fb42` is `47e6fb42` — a `graphify-bot` auto-refresh of the nightly `kg/graph.json`. **0 code, 0 product, 0 F-scope.** No new beta-blocker opened or closed.
- **Beta gate PASSING** (#2077, `beta-gate.yml` CI-enforced). North Star holds: no confirmed leak/break/lie on the stranger path.
- 3 Round-13 fixes stay MERGED: A13-1 `974717bb`, B12-1 `3783dea7`, C12-1 `7b491b0d`.

## Findings
- **F14-1 (NEW, patch-hygiene, non-blocking):** the E14-staged `patches/2026-06-23-E14-deploy-identity-sha-precedence.patch` **FAILS `git apply --check` vs `origin/main`** (`deploy-vps.yml:228` context mismatch) because it was diffed against the 48-behind working tree (whose `deploy-vps.yml` DIFFERS from deploy truth). F13's + D14's patches apply clean only because their target docs match origin/main byte-for-byte. ⇒ regenerate orchestrator patches against `origin/main`; stamp each with its base ref.
- **F14-2:** no top-10 item opened or closed since F13.
- **F14-3 (doc-drift persists, optimistic — truth AHEAD of docs):** `hot.md:3` + `known-issues.md:85-88` still call the 3 merged fixes "open branches"; `known-issues.md:15,24` still flags "Gemini key blocked" though #2214 swapped Gemini→Together. F13 patch still `git apply --check` CLEAN (unmerged).
- **F14-4 (master-plan baseline stale on 2 safe points):** Phase-0 baseline `:42` says `ignition_chat.py` doesn't set `source="direct_connection"` (C14 proved it ships reject-422); `:44` cascade "Gemini→Groq→Cerebras (+legacy Claude tail)" (now Groq→Cerebras→Together, no Anthropic).

## Ranked top-10 beta-blocker ledger (deploy truth `origin/main@47e6fb42`) — all NON-BLOCKING
1. **Optimistic doc-drift** (hot.md/known-issues.md/master-plan describe merged fixes as open + moot Gemini) — ⚪ orientation — Agent: apply `patches/2026-06-22-F13-docdrift-…patch` (apply-check CLEAN) + extend to master-plan `:44` cascade line.
2. **D real-LLM regression gate inert / replay store unrecorded** (keeps D YELLOW) — 🟡 — Founder (~30 min, highest leverage→6-GREEN): `env MIRA_EVAL_REPLAY=record python tests/eval/offline_run.py` from Tailnet → commit `fixtures/llm_replay/{cascade,retrieval}.json` (or land #2258).
3. **F14-1 stale-patch hazard** (E14 patch fails apply-check vs origin/main) — ⚪ patch-hygiene — Agent: regenerate `patches/2026-06-23-E14-…patch` via `git diff origin/main`; stamp base ref.
4. **#2093 prod embedding backfill** (vendor corpus grounding only) — 🟡 — Founder: off-CI backfill from Tailnet node.
5. **Branch-protection required-checks unverifiable (E13-1)** — 🟡 — Founder: `gh api repos/Mikecranesync/MIRA/branches/main/protection` confirms Smoke/Staging/Hub-E2E/SimLab/version/beta block merge.
6. **Staging HTTPS Gap-5 cutover** (team-QA only, NOT stranger-facing) — 🟡 — Founder: `stg.factorylm.com` DNS-A + certbot + `NEXTAUTH_URL`.
7. **Untracked `SECRET-SHOPPER-REPORT*.md` QA findings** — ⚪ triage — `gh issue create` per finding; then commit/remove scratch.
8. **`tools/demo_plc_poller.py` colliding `live_signal_cache` DDL** — 🟦 bench — Agent: UPSERT migration-020 shape with `tenant_id`.
9. **Teams + WhatsApp cloud setup** (code-complete) — ⚪ activation — Founder: Azure Bot Service + Twilio→webhook (`mira-bots/whatsapp/bot.py:96-113`).
10. **Phase 6 `ignition_chat.py` direct_connection** (C14 proved surface ships reject-422; engine docstring `:5666` + master-plan `:42` lag) — ⚪ post-beta — Agent nicety: 1-line docstring fix.

## KG
- graphify UNINSTALLABLE (no module/CLI; GEMINI/GROQ/CEREBRAS/OPENAI/ANTHROPIC/TOGETHERAI all unset). Nightly `kg/graph.json` auto-refreshed by `graphify-bot` (commit `47e6fb42`, built from `84ceeddd`): 4475n/83544e.
- KG +13 nodes/+6 edges → `kg/f14-findings.jsonl`.
- **Insight:** all 5 F14 doc-drift target symbols (`importFromBundle`, `ctx_enrichment`-verified, Together cascade, `/api/version`, `direct_connection` reject) = **0 hits** → drift provable only on deploy-truth bytes; the sole new commit *was* the graph refresh yet the graph can't see the commit that wrote it.

## 30-min founder play
Record the LLM replay store from a Tailnet node → flips D's inert real-LLM regression gate ACTIVE = the last step from **5G/1Y → 6-GREEN**.

**Rotation Round 15 → A next.**
