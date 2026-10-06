# Tonight's release plan — 2026-10-06 (power-outage recovery)

**Goal for tonight:** new manual uploads get vectors again in production, and a stranger on a phone
can upload a manual and get a cited answer. That is the beta gate (`CLAUDE.md` § North Star).

**Why it matters:** since the 2026-09-19 move to OVH, the Hub embeds through Bravo's tailnet
address, which the OVH host cannot reach. Every upload since then has been searchable by keyword
(BM25) only, so paraphrased questions miss. #4292 fixes that.

Order: **0 → 1 → 2 → 3 → 4**. Each step names who does it and what "done" looks like.
Optional extras are at the end. Do them only after step 4.

---

## Step 0 — Power back on (Mike, about 10 min)

- [ ] Charlie, Bravo and Alpha are up: `tailscale status` shows all three.
- [ ] Bravo's Ollama answers (the backfill in step 2 still uses it):
      `curl -s http://100.86.236.11:11434/api/tags | head -c 200`
- [ ] The Codex CLI on Charlie is signed in: `codex --version`.
- [ ] Restart the pulley print.
- [ ] Re-attach to the interrupted sessions, or archive them. Their state is in `wiki/hot.md`.

## Step 1 — Land #4292 (embedder on OVH) — Codex + Mike, about 30–45 min

State at 06:10Z: head `127bb082` (pushed by a Cursor agent at 05:40Z). 44/45 checks are green.
The only red check is **Legacy UI Lifecycle Guard**, and it is waiting on an exact-head Codex GREEN.
The PR is `behind` main.

1. [ ] **Bring the branch up to date with main** (a merge commit, never a rebase):
       ```bash
       cd ~/MIRA && git fetch origin && git switch fix/embedder-on-ovh && git pull
       git merge origin/main && git push
       ```
2. [ ] **Run the Codex review on the new head** (from Charlie):
       ```bash
       PR=4292
       BASE_SHA="$(gh pr view "$PR" --json baseRefOid --jq .baseRefOid)"
       git fetch origin main
       git show "$BASE_SHA:scripts/adversarial-review-trusted.sh" | bash -s -- "$PR" --review-only
       ```
       This is round 2 of 3. If Codex finds issues: Claude fixes them, pushes, and Codex re-reviews.
       If it is still not GREEN after round 3, Mike decides.
3. [ ] All checks are green, including the guard → **Mike merges** #4292. Note the merge SHA.

Pre-review by the cloud session (06:00Z) found Codex F1, F2 and F3 each fixed, and the PR's 13 tests
pass. Three non-blocking notes:
- If the very first model pull fails, nothing retries it, so the container stays unhealthy until
  it is restarted.
- `PRODUCTION_DEFAULT_SERVICES` does not include `mira-ollama`. Step 3 handles this.
- The pipeline, ask and other services still read the unreachable Doppler `OLLAMA_BASE_URL`. That
  is a follow-up (see the extras).

## Step 2 — Staging (Claude can trigger it; already authorized) — about 30 min

1. [ ] Deploy the merge SHA to staging:
       ```bash
       gh workflow run deploy-staging.yml -f approved_rc_sha=<MERGE_SHA> -f reset_volumes=false
       ```
       The default targets now include `mira-ollama`, so the staging receipt covers it.
2. [ ] Check the embedder is healthy: the workflow log shows `stg-mira-ollama` healthy, and the
       Hub's embedder-health report (#4293) is green.
3. [ ] Check that a fresh upload gets a vector: upload a small PDF on `app-staging`, then within
       a minute the `db-inspect` embedding-coverage probe shows its chunks with
       `embedding IS NOT NULL`.
4. [ ] Run the phone parity check on Charlie's emulator. Read the expected page out of the PDF
       first:
       ```bash
       export FLM_EMAIL='<staging test user>' FLM_PASSWORD='<...>'
       bash tools/mobile-e2e/run.sh manual.pdf "question without a question mark" <expected-page>
       ```
5. [ ] Recover the staging backlog (tailnet machine, staging first, dry-run first):
       ```bash
       doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py --dry-run
       doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py
       ```

**Done when** steps 1–4 are green. Step 5 can run alongside step 3.

## Step 3 — Production (Mike says "go") — about 30 min

Nothing new is needed on the database: no migrations have landed since the last production deploy,
and #3878/#3879 were completed 09-20/09-27 (the issues are stale and can be closed with links).

Order matters, because production deploys with `--no-deps`:
1. [ ] Embedder first, and wait for it to be healthy (the first pull is about 274 MB; it has up to
       300 s):
       ```bash
       gh workflow run deploy-vps.yml -f approved_rc_sha=<MERGE_SHA> -f services="mira-ollama"
       ```
2. [ ] Then the default set:
       ```bash
       gh workflow run deploy-vps.yml -f approved_rc_sha=<MERGE_SHA>
       ```
       The defaults are `mira-hub mira-web mira-ask`. This also ships #4288, #4289, #4291 and #4293.
3. [ ] Check that `https://app.factorylm.com/api/health/` reports `<MERGE_SHA>`.
4. [ ] Smoke test: `bash install/smoke_test.sh`, plus screenshots to `docs/promo-screenshots/`.
5. [ ] Recover the production backlog (4,184 chunks without vectors) through the gated
       `apply-seeds.yml` / `embedding-coverage-canary.yml` path, never a direct prod connection.

Disk: the image is about 3.8 GB, and the host had 18 GB free on 10-05. If it is lower, prune the
Docker build cache first (human-only; prod-guard blocks agents).

**Rollback:** redeploy `mira-hub` from the previous SHA. Retrieval falls back to BM25, which is
today's behavior, so a rollback never ends up worse than now.

## Step 4 — The beta gate: the stranger walk (Mike, real Pixel, about 15 min)

- [ ] Use a fresh account on `app.factorylm.com` (production), on the phone.
- [ ] Upload a manual you've never used, and ask a question phrased differently from the text.
- [ ] You get a cited answer, the citation opens the right page, and nobody helped.
- [ ] Record the evidence under `docs/proofs/` and update the beta-gate line in `CLAUDE.md` to
      **MET on product surface**.

A known snag on this walk is **#4290**: on a phone, `/v3` opens with the navigation drawer covering
the chat on every load. **Fixed in PR #4298** (tested, with before/after screenshots). Merge it
before step 2 so it ships in the same staging and production run.

---

## Ready-to-build extras (ranked by customer value)

1. **#4290 drawer covers the chat on a phone** — **built: PR #4298** (small, R1). The cause is confirmed:
   `mira-hub/src/factorylm-ui/hub-host.tsx:175` starts the shell with
   `set-navigation-visible: true`. On desktop that is invisible: the sidebar is static, and the
   drawer CSS (`shell.css` ~L152), `inert` and `topLayer()` all apply only under
   `(max-width: 48rem)`. The fix is to start with `visible: false`. Add a test at 412 px that
   reloads and asserts the composer is reachable and the drawer is closed, and confirm the test
   goes red without the fix. The path is an adapter root, not the guarded legacy UI.
2. **Point every other OVH service at `mira-ollama`.** pipeline, ask and the others still read
   the unreachable Doppler URL, so their query-side vectors are dead too.
3. **Retry the model pull when the embedder starts**, so a one-off network failure heals itself.
4. **Close the stale issues #3878/#3879** with links to their completing runs.

## Dependabot (don't burn tonight on these)

| PR | Verdict |
|---|---|
| #4276 stripe 23, #4277, #4279, #4281, #4282 (mira-web) | Each fails on a stale bun lockfile, and each needs a Codex GREEN on the guarded `package.json`. Batch them into one PR later; stripe is a major version (billing), so test it separately. |
| #4278, #4267 sqlalchemy 2.1 | Breaks five real-Postgres session tests. Close, or pin `<2.1`. |
| #4280 anthropic SDK 1.x | Green, but a major version, used only by the PrintSynth carve-out. Low priority. |
| others (#4268–#4275, #4283) | Not yet triaged. |
