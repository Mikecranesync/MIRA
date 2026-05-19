# Staging Environment Runbook

**Last Updated:** 2026-05-18
**Owner:** Mike Harper / FactoryLM
**Companion:** `docs/specs/staging-environment-spec.md` (design) · `docs/specs/mira-answer-quality-standard.md` (rubric)

The staging environment exists so that every change to the diagnostic engine is tested against real KB data on a NeonDB clone of production **before** it touches the live Telegram bot. The 2026-05-17 8-hour BM25 debug is what this exists to prevent.

## One-time setup

These are the operator's job. They run once per account / per branch / per bot. The code is in the repo; the **activation** lives in Doppler, NeonDB, BotFather, and GitHub.

### 1. Create the NeonDB staging branch

```bash
# Install neonctl once: brew install neonctl
neonctl auth                            # opens browser

# Create the branch off production. Neon branches are copy-on-write and free.
neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name staging \
  --parent main

# Copy the staging connection string — it's the pooled URL for app use.
neonctl connection-string staging --pooled
# postgresql://...neon.tech/.../...?sslmode=require
```

Stash the URL — it's `NEON_STG_DATABASE_URL` in two places: Doppler `factorylm/stg` and GitHub Secrets.

### 2. Register `@MiraStaging_bot` with BotFather

In Telegram:
1. Open `@BotFather`.
2. `/newbot` → name: `MIRA Staging`, username: `MiraStaging_bot` (or pick a unique suffix).
3. Copy the token → `STAGING_TELEGRAM_BOT_TOKEN` (Doppler `factorylm/stg`).
4. `/setdescription` → "MIRA staging — pre-prod testing. Operator only."
5. `/setjoingroups` → Disable.
6. Send a private message to the new bot from your account so you can record your numeric Telegram user id; that goes in `STAGING_ADMIN_TELEGRAM_IDS`.

### 3. Create the Doppler `factorylm/stg` config

```bash
doppler configs create stg --project factorylm
doppler configs --project factorylm   # confirm: dev, prd, stg

# Clone prd as a starting point, then override the diff vars.
doppler secrets download --project factorylm --config prd --no-file --format json \
  | jq 'del(.NEON_DATABASE_URL, .TELEGRAM_BOT_TOKEN, .ADMIN_TELEGRAM_IDS)' \
  | doppler secrets upload --project factorylm --config stg

# Set the staging-specific overrides.
doppler secrets set NEON_DATABASE_URL="$NEON_STG_DATABASE_URL" --project factorylm --config stg
doppler secrets set TELEGRAM_BOT_TOKEN="$STAGING_TELEGRAM_BOT_TOKEN" --project factorylm --config stg
doppler secrets set STAGING_TELEGRAM_BOT_TOKEN="$STAGING_TELEGRAM_BOT_TOKEN" --project factorylm --config stg
doppler secrets set ADMIN_TELEGRAM_IDS="$YOUR_TELEGRAM_USER_ID" --project factorylm --config stg
doppler secrets set MIRA_TENANT_ID="staging" --project factorylm --config stg
```

Verify: `doppler run --project factorylm --config stg -- env | grep -E 'NEON|TELEGRAM|TENANT'`. The NeonDB host should be a different branch host than prd.

### 4. Configure GitHub repository secrets

The staging gate runs in GitHub Actions; the secrets live on a `staging` environment:

```bash
# Create the environment (Settings → Environments → New environment: "staging")
# Then set these secrets under that environment:
gh secret set NEON_STG_DATABASE_URL --env staging --body "$NEON_STG_DATABASE_URL"
gh secret set STAGING_GROQ_API_KEY  --env staging --body "$STAGING_GROQ_API_KEY"
gh secret set STAGING_CEREBRAS_API_KEY --env staging --body "$STAGING_CEREBRAS_API_KEY"
gh secret set STAGING_GEMINI_API_KEY --env staging --body "$STAGING_GEMINI_API_KEY"
```

Use a Groq key dedicated to staging — it isolates the staging rate budget from prod. If you only have one key, reuse `GROQ_API_KEY`; the staging gate still works.

### 5. Make Staging Gate a required check (branch protection)

The deploy job in `.github/workflows/deploy-vps.yml` verifies Staging Gate passed on the PR head SHA before deploying. (It resolves the squashed merge commit on `main` back to the PR's head SHA, then queries the Staging Gate run on that SHA — necessary because squash-merge creates a new commit no PR workflow ever ran on.)

Make Staging Gate a *branch protection* required check so PRs can't merge until the gate has run:

```
Settings → Branches → main → Edit
  Require status checks before merging  ✓
    Required:  Staging Gate / staging-gate
               Smoke Test / E2E smoke (factorylm.com + app.factorylm.com)
               DeepEval Quality Gate / DeepEval Benchmark (offline)
```

The check name is composed as `<workflow-name> / <job-name>`. Our workflow is named `Staging Gate` (file `.github/workflows/staging-gate.yml`) and its only job is named `staging-gate` → `Staging Gate / staging-gate`. If GitHub doesn't show the check as available until the first PR runs it, open a no-op PR to register the check, then add it as required.

Staging Gate runs on **every** PR to `main`, regardless of which paths change. This is intentional: the deploy-time verifier looks up Staging Gate by SHA, so a docs-only PR with no Staging Gate run would block the next deploy. The cost is ~3 minutes of CI per PR.

### 6. Smoke-test the gate

Open a no-op PR (e.g. fix a typo in `docs/specs/staging-environment-spec.md`). The Staging Gate workflow should run, post a comment, and report PASS. If it fails on a no-op change, your staging branch is missing data — refresh it (see §"Refreshing the staging branch").

## Day-to-day

### Run the staging bot locally on CHARLIE

```bash
cd ~/Mira

# Bring up only the bot path. Reads factorylm/stg secrets.
doppler run --project factorylm --config stg -- \
  docker compose -f docker-compose.staging.yml up -d --build

# Watch logs.
docker compose -f docker-compose.staging.yml logs -f mira-bot-telegram-staging

# Stop it when you're done.
docker compose -f docker-compose.staging.yml down
```

Then open Telegram, message `@MiraStaging_bot`, and probe the change you're about to merge.

`mira-pipeline-staging` is on `127.0.0.1:9098` if you want to curl the OpenAI-compatible endpoint:

```bash
curl -fsS http://127.0.0.1:9098/health
curl -fsS http://127.0.0.1:9098/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PIPELINE_API_KEY" \
  -d '{"model":"mira-diagnostic","messages":[{"role":"user","content":"powerflex 525 f004"}]}'
```

### Run the gate test directly

The same test the CI runs:

```bash
doppler run --project factorylm --config stg -- python tools/staging_test.py
cat tools/staging_results.json | jq '.mean_of_means, .below_3'
```

Exit code 0 = pass; 1 = fail; 2 = misconfigured env.

## Adding a new test question

1. Edit `tools/staging_questions.yaml`. New entry needs:
   - `id` — kebab-case, unique
   - `category` — one of the existing tags or a new one (e.g. `oem_model_fault`, `safety`, `uns_gate`)
   - `message` — what a real technician would actually type
   - `exercises` — 1–2 sentences describing what failure mode it catches; this is the most important field for the next operator
   - `expect_mentions` — optional, for sanity logging only; not enforced by the gate
2. Run `python tools/staging_test.py` locally to confirm the new question scores ≥ 3.0 on a known-good build of `main`. If it scores lower on `main`, you're encoding a *current* failure mode; that's fine, but flag it in the PR so reviewers understand.
3. As you add questions, watch the `MAX_BELOW_3` budget in `tools/staging_test.py`. With 10 questions, 2 are allowed below 3.0; with 15, consider raising to 3.

### Categories worth covering

The fixture is intentionally varied. When you add, lean toward filling a gap:

- OEM + model + fault code (BM25-shaped retrieval — the 2026-05-17 bug)
- OEM only, no fault (vector recall)
- Symptom only, no OEM (abbreviation expansion)
- UNS gate trigger (confirmation before troubleshooting)
- Safety keyword (LOTO / arc flash)
- Greeting hygiene (no industrial jargon leak)
- Session follow-up ("you said …")
- No-photo OCR claim (engine must not fabricate visual context)
- Off-topic (polite redirect)
- CMMS context (engine admits when it can't reach CMMS)

## Refreshing the staging branch

NeonDB branches drift from `main` as prod gets new ingests. Refresh weekly or before a major release:

```bash
# Delete + recreate gives you a fresh zero-copy clone. Cheap, fast.
neonctl branches delete staging --project-id "$NEON_PROJECT_ID"
neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name staging \
  --parent main

# Re-fetch the (possibly new) pooled URL and update Doppler + GitHub.
NEW_URL=$(neonctl connection-string staging --pooled)
doppler secrets set NEON_DATABASE_URL="$NEW_URL" --project factorylm --config stg
gh secret set NEON_STG_DATABASE_URL --env staging --body "$NEW_URL"
```

Or schedule it: `gh workflow run staging-gate.yml` weekly via cron — out of scope for this iteration but a 10-minute follow-up.

## Promoting staging changes to production

There is no "promote" step. Staging is a **clone of prod**, not a different deployment.

The flow is:

1. Open a PR.
2. Staging Gate (this workflow) runs against the NeonDB staging branch + Groq cascade.
3. PR merges only if Staging Gate (and Smoke Test, and DeepEval) pass.
4. After merge, `deploy-vps.yml` triggers on `main` — first verifies the staging gate succeeded on this commit, then deploys to the production VPS.

If a change requires NEW data on staging (e.g. testing a feature that depends on a manual chunk that doesn't exist yet on prod), do **not** hand-insert chunks into the staging branch. Instead:

- Run the ingest pipeline against the staging branch (point `NEON_DATABASE_URL` at `factorylm/stg`).
- The staging branch now has the same chunks the next prod ingest would produce.
- When the PR merges, run the same ingest against prod.

This keeps "what works in staging works in prod" honest.

## What NOT to do

- **Do not point `@MiraStaging_bot` at the production NeonDB.** It's the whole reason this environment exists.
- **Do not promote staging chunks to prod by `pg_dump`.** They were ingested against a clone; the prod ingest is the authority.
- **Do not skip the staging gate to "ship a hotfix faster."** Run `workflow_dispatch` with `skip_staging_gate=true` and record the reason in the linked issue. Anything that bypasses the gate is, by definition, untested against real data.
- **Do not store staging secrets in the prod Doppler config.** They're a separate `factorylm/stg` config for a reason — accidentally chatting with prod NeonDB while you think you're on staging is exactly the failure mode that gave us this 2026-05-17 incident.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Staging Gate exits 2 with "missing NEON_DATABASE_URL" | GitHub `staging` environment secret missing or wrong name. | `gh secret list --env staging`. Names must match `staging-gate.yml`. |
| Gate reports "engine_error" on every question | `mira-bots/telegram/requirements.txt` failed to install — usually a wheel mismatch. | Check workflow logs at the pip step. |
| All groundings score 1 on staging but 4 on prod | NeonDB staging branch is empty or stale — was refreshed after prod's last ingest? | Refresh the branch (above). |
| `@MiraStaging_bot` says "I had a problem reaching the LLM" | `STAGING_GROQ_API_KEY` is wrong or rate-limited. | `doppler run --config stg -- env \| grep GROQ`. |
| Staging gate passes but prod regresses anyway | Staging branch lagged prod data, OR test fixture missed a category. | Add a question covering the regression to `tools/staging_questions.yaml`. |
| Deploy aborts with "No Staging Gate run found" | Commit landed on main without the gate (force-push, admin merge, or rebase-merge that decoupled the PR head). | Run `gh workflow run staging-gate.yml --ref main` and wait for it to pass, then re-trigger deploy via `gh workflow run deploy-vps.yml`. |
| Deploy aborts with "No PR associated with $SHA" | Direct push to main bypassed PR flow. | Open a no-op PR that reverts and re-applies the change so it gets a Staging Gate run, or use `workflow_dispatch` with `skip_staging_gate=true` for a verified hotfix. |
