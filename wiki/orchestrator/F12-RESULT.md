# F12 Result — Lens F (Beta-blocker ledger) — 2026-06-21

> **Why this file exists:** mid-run, a concurrent process `git stash`ed the orchestrator's
> living working-tree `BETA_READINESS.md` + `HISTORY.md` (→ `stash@{0}: WIP on
> feat/inference-together-replaces-gemini`) and fast-forward-pulled to `origin/main@f3856eb2`.
> The working tree reverted to the thin committed 06-09 versions. Per the hard rules
> ("do not destabilize the repo"; "never touch a stash you didn't create") I did **not**
> rewrite the scorecard onto the stub (would lose the curated rolling history / conflict on
> stash-pop). The F12 result is persisted here + in `kg/f12-findings.jsonl` + the pushed
> `mira-orchestrator` artifact. **Re-apply the two edits below onto the RESTORED living
> scorecard** (after `git stash pop stash@{0}`, or onto whatever the next run sees as the
> 116KB E12 `# … Audit Scorecard` version) — not onto the 06-09 stub.

## Verdict

**Lens F: YELLOW → GREEN (recovery).** Scorecard **4G/2Y/0R → 5G/1Y/0R** (D the lone YELLOW).

Both F11 downgrade drivers are **cleared on deploy truth** (`origin/main@f3856eb2`):

1. **Coverage gap closed** — the HubV3/i3x stranger-reachable surface F11 flagged un-audited got
   formal **A13 + B12 + C12** lens passes (all GREEN), and **all three resulting findings are now
   MERGED**:
   - **A13-1** zip-bomb / OOM cap → `974717bb` (`maxOutputLength` in
     `mira-hub/src/lib/contextualization/unzip.ts` + 413 `file.size` pre-check in `import/route.ts`).
   - **B12-1** publish-gate route test → `3783dea7`
     (`…/contextualization/batches/[batchId]/review/review.integration.test.ts` present on main).
   - **C12-1** verified-only signals → `7b491b0d`
     (`mira-bots/shared/ctx_enrichment.py:45` `AND approval_state = 'verified'` + train-before-deploy comment).
2. **Doc-staleness closed** — `a66fbefe` refreshed `docs/known-issues.md` to 06-21 with a full
   **HubV3 Contextualization + i3x** section and the **migration head correctly stated as 056**;
   `wiki/hot.md` top is now **2026-06-21 — HubV3/i3x** (was 06-12 PLC laptop).

Plus on deploy truth: **beta gate PASSING** (CI-enforced #2077), **A10 leak CLOSED + durable**,
**#736 version-tag pin FIXED** (`ffcc8636`). No confirmed leak / break / lie on the stranger path
→ North-Star holds. No code edited (audit-only); 0 new patches (the 3 fixes already merged).

## Two residuals (neither blocks the stranger beta flow)

- **(a) D eval-replay store is a 0-BYTE STUB.** `tests/eval/fixtures/llm_replay/cascade.json` now
  exists on `origin/main` but is **empty (0 bytes)**. `eval-replay-gate.yml:46` keys its `present`
  flag off `hashFiles()` of that path — an empty-but-present file can flip the gate to replay-mode
  against an empty store → still no real pre-deploy regression detection (arguably a trap). D's
  YELLOW driver persists. **Fix:** record a real store from a Tailnet node, or delete the 0-byte
  stub so the gate's `present` check is honest.
- **(b) NEW optimistic doc-drift.** `wiki/hot.md` + `docs/known-issues.md` (both 06-21) still call
  the 3 Round 13 fixes "open fix branches," but all three are **merged** on deploy truth. Deploy
  truth is *ahead* of the docs. 5-min doc fix.

**In-flight (not yet deploy truth):** `#2205` landed the secret-shopper **setup** runbook
(`docs/runbooks/secret-shopper-testing-setup.md`); the **findings** reports
(`docs/user-manual/SECRET-SHOPPER-REPORT*.md`) are UNTRACKED local QA artifacts. The GREEN is
as-of committed deploy truth — fold the secret-shopper findings in once committed.

## Top blockers (ranked, none RED)

1. **D eval-replay 0-byte stub** (YELLOW, founder-keyed) — `env MIRA_EVAL_REPLAY=record python tests/eval/offline_run.py` from Charlie/Bravo → commit non-empty `tests/eval/fixtures/llm_replay/{cascade,retrieval}.json` (or delete the stub).
2. **Optimistic doc-drift** (doc, 5 min) — mark A13-1/B12-1/C12-1 RESOLVED (merged `974717bb`/`3783dea7`/`7b491b0d`) in `hot.md` + `known-issues.md`.
3. **#2093 prod embedding backfill** — founder-pending; run from a Tailnet node.
4. **Gemini key 403** (non-blocking) — refresh `GEMINI_API_KEY` in `factorylm/prd`; cascade falls through to Groq → Cerebras.
5. **i3x defense-in-depth** (non-blocking) — add `expires_at` to `i3x_api_keys` + per-key rate-limit; document `openssl rand -hex 32` issuance.

## KG

Nightly graph 4,464 nodes / 83,544 edges; this run **+12 nodes / +6 edges** → `kg/f12-findings.jsonl`.
graphify UNINSTALLABLE (all LLM keys unset); `kg_query.py insights` + `search` RAN on the existing graph.
**Insight:** `kg_query search "contextualization import bundle"` and `"i3x bearer tenant"` both
return **(none)** — the entire HubV3/i3x stranger-reachable surface is **invisible to the code graph**
(god-nodes: engine 1418, sessionOr401 1393, withTenantContext 1245). Code-nav would have missed the
very surface that drove F11's downgrade → validates the deploy-truth-bytes discipline.

---

## Re-apply onto the restored living scorecard

### 1) Replace the F row in the lens table of `BETA_READINESS.md`

```
| **F — Beta-blocker ledger** | 🟢 GREEN | **2026-06-21 (F12 — this run)** | **YELLOW→GREEN (recovery): both F11 downgrade drivers CLEARED on deploy truth.** (1) **Coverage gap closed** — the HubV3/i3x stranger surface F11 flagged un-audited got formal **A13+B12+C12** passes (all GREEN) and **all 3 resulting findings are now MERGED**: A13-1 zip-bomb cap `974717bb` (`maxOutputLength` in `unzip.ts` + 413 pre-check), B12-1 publish-gate integration test `3783dea7` (`review.integration.test.ts`), C12-1 verified-only `7b491b0d` (`ctx_enrichment.py:45 approval_state = 'verified'`). (2) **Doc-staleness closed** — `a66fbefe` refreshed `known-issues.md` to 06-21 with a **HubV3 Contextualization + i3x** section + **mig head correctly 056**; `hot.md` top now **06-21 HubV3/i3x**. **Beta gate PASSING** (#2077), **A10 CLOSED+durable**, **#736 version-tag FIXED** (`ffcc8636`). No confirmed leak/break/lie on the stranger path → **5G/1Y/0R** (D lone YELLOW). **Two residuals (non-stranger-blocking):** (a) **D eval-replay store is a 0-BYTE STUB** — `cascade.json` exists on origin/main but is empty; `eval-replay-gate.yml:46` keys `present` off `hashFiles()` so the stub can flip the gate to replay vs nothing → regression gate still inert; (b) **NEW optimistic doc-drift** — `hot.md`+`known-issues.md` still call the 3 merged fixes "open branches" (deploy truth AHEAD of docs). **In-flight:** secret-shopper **setup** landed (#2205); **findings** reports untracked — GREEN is as-of committed deploy truth | **Founder (30 min, highest leverage):** from a Tailnet node `env MIRA_EVAL_REPLAY=record python tests/eval/offline_run.py` → commit non-empty `tests/eval/fixtures/llm_replay/{cascade,retrieval}.json` (flips D's gate inert→real; or delete the 0-byte stub so the check is honest). **Doc PR (5 min):** mark A13-1/B12-1/C12-1 RESOLVED (merged `974717bb`/`3783dea7`/`7b491b0d`) in `hot.md` + `known-issues.md`. **Then:** run #2093 prod embedding backfill; refresh Gemini key. Rotation Round 14 → **A** next |
```

### 2) Append this line to `HISTORY.md`

```
2026-06-21 | F12 (origin/main @f3856eb2; HEAD feat/inference-together-replaces-gemini 4 BEHIND/0 ahead; freshness-guard exit 3 STALE but all 3 F-lens canonical paths [known-issues.md, hot.md, master-plan] match origin/main byte-for-byte → audited origin/main via git show) | Lens F Beta-blocker ledger | status: YELLOW→GREEN (recovery); scorecard 4G/2Y/0R → 5G/1Y/0R (D lone YELLOW) | BOTH F11 downgrade drivers CLEARED on deploy truth: (1) coverage gap closed — HubV3/i3x got formal A13+B12+C12 passes (all GREEN) AND all 3 findings MERGED: A13-1 zip-bomb cap 974717bb (maxOutputLength unzip.ts + 413 pre-check import/route.ts), B12-1 publish-gate integration test 3783dea7 (review.integration.test.ts present), C12-1 verified-only 7b491b0d (ctx_enrichment.py:45 approval_state='verified' + train-before-deploy comment); (2) doc-staleness closed — a66fbefe refreshed known-issues.md to 06-21 (HubV3 Contextualization + i3x section + mig head correctly 056) and hot.md top to 06-21 HubV3/i3x. Beta gate PASSING (#2077 CI-enforced), A10 leak CLOSED+durable, #736 version-tag FIXED (ffcc8636). No confirmed leak/break/lie on stranger path. TWO residuals (neither blocks stranger flow): (a) D eval-replay store is a 0-BYTE STUB — tests/eval/fixtures/llm_replay/cascade.json exists on origin/main but empty; eval-replay-gate.yml:46 keys present off hashFiles() so empty stub can flip gate to replay-vs-nothing → D regression gate still inert (founder: record from Tailnet OR delete stub); (b) NEW optimistic doc-drift — hot.md+known-issues.md still call the 3 merged fixes "open branches" (deploy truth AHEAD of docs). IN-FLIGHT: secret-shopper setup runbook landed #2205; findings reports UNTRACKED local QA — GREEN as-of committed deploy truth. No code edited (audit-only); 0 new patches (3 fixes already merged). CONCURRENCY: mid-run a concurrent process git-stashed the living BETA_READINESS.md + HISTORY.md (stash@{0}) and ff-pulled to f3856eb2; F12 persisted via artifact + kg/f12-findings.jsonl + F12-RESULT.md; row/banner/this line owed on restored living scorecard; stash NOT touched. Rotation Round 14 → A next. | KG +12 nodes/+6 edges → kg/f12-findings.jsonl (graphify UNINSTALLABLE: all LLM keys unset; kg_query.py insights+search RAN on 4464n/83544e graph). Insight: search "contextualization import bundle" + "i3x bearer tenant" = (none) → entire HubV3/i3x stranger surface INVISIBLE to code graph (god-nodes engine 1418/sessionOr401 1393/withTenantContext 1245); code-nav would have missed the very surface that drove F11's downgrade → validates deploy-truth-bytes discipline.
```

### 3) Banner — promote F12 to the lead `>` block, demote E12 into a `<details>` (text is in the pushed artifact + the `f12` findings).
