# Synthetic Dogfood Agents

This is the autonomous beta-polish loop for the seeded production QA tenant.
It runs the Hub synthetic persona Playwright suite, turns failures into
redacted findings, and files or updates deduplicated GitHub issues.

## What It Does

- Runs `mira-hub/tests/e2e/synthetic-day.spec.ts` against `DOGFOOD_TARGET_URL`.
- Uses the four production QA personas: Carlos, Dana, Jordan, and Pat.
- Writes raw and summarized artifacts to `/opt/mira/data/synthetic-dogfood`.
- Files only P0/P1/P2 GitHub issues.
- Skips P3 noise in GitHub; P3s remain in the run artifact.
- Dedupes by a stable `DOGFOOD-FINGERPRINT` comment in the issue body.
- Reopens a closed duplicate only for P0/P1 repeats.

## Production Switches

Set these in Doppler `factorylm/prd`; never commit values.

| Variable | Default | Purpose |
|---|---:|---|
| `SYNTHETIC_DOGFOOD_ENABLED` | `0` | Set to `1` to let scheduled runs execute. |
| `DOGFOOD_ISSUE_MODE` | `dry_run` | Set to `write` to create/comment/reopen GitHub issues. |
| `DOGFOOD_TARGET_URL` | `https://app.factorylm.com` | Hub URL to test. |
| `GITHUB_ISSUE_TOKEN` | empty | Fine-scoped GitHub token with issues write access. |
| `SYNTHETIC_CARLOS_EMAIL` / `PASSWORD` | empty | Technician persona credentials. |
| `SYNTHETIC_DANA_EMAIL` / `PASSWORD` | empty | Maintenance manager credentials. |
| `SYNTHETIC_PLANTMGR_EMAIL` / `PASSWORD` | empty | Plant manager credentials. |
| `SYNTHETIC_CFO_EMAIL` / `PASSWORD` | empty | CFO persona credentials. |

Keep `DOGFOOD_ISSUE_MODE=dry_run` until the first production artifact looks sane.

## Deploy

```bash
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d --build \
  mira-redis mira-synthetic-dogfood-worker mira-synthetic-dogfood-beat
```

The beat service uses `CELERY_BEAT_PROFILE=synthetic-dogfood`, so it schedules
only `tasks.synthetic_dogfood.run_synthetic_dogfood_cycle` every six hours.

## Run One Cycle Manually

```bash
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml exec mira-synthetic-dogfood-worker \
  celery -A mira_crawler.celery_app call tasks.synthetic_dogfood.run_synthetic_dogfood_cycle
```

Then check:

```bash
docker compose -f docker-compose.saas.yml logs --tail=100 mira-synthetic-dogfood-worker
ls -la /opt/mira/data/synthetic-dogfood
```

## Rollback

The loop is safe to disable without rolling back code:

```bash
doppler secrets set --project factorylm --config prd SYNTHETIC_DOGFOOD_ENABLED=0
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.saas.yml up -d mira-synthetic-dogfood-worker
```

To remove the containers entirely:

```bash
docker compose -f docker-compose.saas.yml stop mira-synthetic-dogfood-worker mira-synthetic-dogfood-beat
```

Artifacts remain in `/opt/mira/data/synthetic-dogfood` for review.
