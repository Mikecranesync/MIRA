# KB Ingest Pipeline — Ops Runbook

Companion to `docs/specs/kb-ingest-hardening-spec.md`. This is the playbook
for the on-call human dealing with the cron when something goes sideways.

---

## 1. Doppler `OLLAMA_BASE_URL` rotation (KB-INGEST-8)

The current value points at a node that does not exist (`100.72.2.99`).
The correct value is Bravo on Tailscale (`100.86.236.11`).

**Symptom that triggered this fix:** kb_growth_cron logs were silent on
embed errors because `full_ingest_pipeline.py` swallows them. KB row count
on Charlie was tracking +3–4 k/day from the Celery worker, but the cron's
contribution was 0.

**Apply (Mike — needs Doppler write access):**

```bash
# 1. Rotate the secret
doppler secrets set OLLAMA_BASE_URL=http://100.86.236.11:11434 \
  --project factorylm --config prd

# 2. Verify
doppler secrets get OLLAMA_BASE_URL --project factorylm --config prd --plain
# expected:  http://100.86.236.11:11434

# 3. Sanity-check Bravo is reachable from VPS
ssh vps 'curl -s http://100.86.236.11:11434/api/tags | head -c 200'

# 4. Restart cron + Celery
ssh vps 'systemctl restart mira-celery; systemctl restart mira-kb-cron.timer || true'
```

**Verify:** the next cron tick should print a `preflight ok summary` JSON line
and a `pipeline_runs` row should land with `status='ok'`. If you see
`preflight failed` with `OLLAMA_BASE_URL=… unreachable`, rotate again — your
shell environment was probably cached from the old value.

The cron's preflight will refuse to do work if Ollama is unreachable, so a
broken value can no longer silently rot the queue.

---

## 2. Apply the `pipeline_runs` migration

NeonDB has a single instance. There is no transactional DDL drama.

```bash
# from the repo root, with NEON_DATABASE_URL exported
psql "$NEON_DATABASE_URL" -f docs/migrations/006_pipeline_runs.sql
# verify
psql "$NEON_DATABASE_URL" -c "\d pipeline_runs"
```

Idempotent — safe to re-run.

---

## 3. Watching live ingestion

```bash
# Tail structured logs on VPS
ssh vps 'tail -f /var/log/kb_growth.log | jq -c "{ts, step, status, error}"'

# Last 24h of runs from NeonDB
psql "$NEON_DATABASE_URL" -c "
  SELECT started_at, status, manufacturer, model, chunks_created, error
  FROM pipeline_runs
  WHERE started_at > now() - interval '24 hours'
  ORDER BY started_at DESC
  LIMIT 50;"

# Failure cluster (top hosts)
psql "$NEON_DATABASE_URL" -c "
  SELECT split_part(regexp_replace(pdf_url,'^https?://',''),'/',1) AS host,
         COUNT(*) AS fails, MAX(started_at) AS last
  FROM pipeline_runs
  WHERE status IN ('failed','partial')
    AND started_at > now() - interval '7 days'
  GROUP BY host ORDER BY fails DESC LIMIT 10;"
```

---

## 4. When the queue is stuck

`pipeline_runs.status = 'running'` rows older than 30 minutes are reaped to
`failed` automatically by the next cron preflight. If you still see a stuck
row after one cron cycle:

```bash
psql "$NEON_DATABASE_URL" -c "
  UPDATE pipeline_runs
  SET status='failed', step_failed='manual-reap', completed_at=now()
  WHERE status='running' AND started_at < now() - interval '1 hour';"
```

---

## 5. URL allowlist additions

Edit `mira-crawler/config/url_allowlist.yml`, commit, deploy. Subdomain
matching is automatic — `foo.com` covers `cdn.foo.com`. PRs that try to
download from non-allowlisted hosts fail at queue time, not at runtime.

---

## 6. Disabling ingest in an emergency

```bash
doppler secrets set KB_INGEST_ENABLED=false --project factorylm --config prd
ssh vps 'systemctl restart mira-kb-cron.timer'
```

The cron will log `cron skipped reason=KB_INGEST_ENABLED=false` and exit 0.
Nothing else changes — `knowledge_entries` queries still serve the existing
80 k+ rows.

---

## 7. When Docling is down

The pipeline will fall through to `pdfplumber` → `pypdf`. Quality drops; KB
keeps growing. The structured log line will read
`{"step": "extract", "method": "pdfplumber" }`.

If Docling is down for more than a day, consider disabling ingest entirely
(§6) until it's back — you'd rather pause growth than fill the KB with
low-quality fallback extractions.

---

*Last updated: 2026-05-07*
