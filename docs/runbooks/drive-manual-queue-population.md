# Runbook — Drive Manual Queue Population (Phase 4)

**Purpose:** safely give the `kb_growth` cron *fuel* — add real vendor manuals to
`mira-crawler/cron/manual_queue.json` with provenance and dedupe, **without**
hand-editing the queue or scraping. Issue #2562 Phase 4.

**Golden rule:** manuals enter the queue only through the **populator + a
version-controlled allowlist**. Never hand-edit `manual_queue.json`.

## The pieces

| Piece | Path | Role |
|---|---|---|
| Allowlist(s) | `mira-crawler/cron/allowlists/*.yaml` | Curated, version-controlled list of manual URLs + provenance |
| Populator | `mira-crawler/cron/queue_populate.py` | Reads an allowlist → appends eligible, deduped, provenance-stamped entries to the queue |
| Queue | `mira-crawler/cron/manual_queue.json` | Runtime state (git-ignored); the cron's work list |
| Consumer | `mira-crawler/cron/kb_growth_cron.py` | The hourly cron that downloads → OCR/extract → chunk → embed → `knowledge_entries` |

## The flow

```
allowlist YAML ──queue_populate.py──▶ manual_queue.json ──kb_growth_cron (hourly)──▶
  download → extract (pdfplumber/pypdf) → OCR via Tika if 0-char →
  chunk → embed (Ollama on Bravo) → knowledge_entries row (source_url = citation)
```

## Provenance (required on every entry)

Each allowlist entry MUST have `url`, `vendor`, `model` (required) plus
`family`, `type`, `trust_status`, `queue_reason`. The populator stamps each queue
entry with: `source: allowlist`, `family`, `trust_status`, `queue_reason`,
`discovered_at`, so every queued manual is auditable back to *why/when/how*.

- `trust_status`: `curated` (a human vetted this exact URL) or `discovered`
  (from an automated source — lower trust).

## How to add manuals (the intended workflow)

1. **Verify the URL first.** The populator does NOT fetch. Confirm the URL serves
   a real PDF to the pipeline's UA before adding (a dead URL fails gracefully in
   the cron, but don't queue known-dead ones):
   ```
   curl -sIL -A 'MIRA-KB/1.0 (+https://factorylm.com; ops@factorylm.com)' \
     -o /dev/null -w '%{http_code} %{content_type}\n' <URL>
   ```
   Want `200`/`206` + `application/pdf`.
2. **Add an entry** to `mira-crawler/cron/allowlists/drive_manuals.yaml` (or a new
   allowlist) with full provenance. Commit it (it's version-controlled).
3. **Dry-run** to preview what would be queued (no writes):
   ```
   cd /opt/mira && doppler run -- python3 mira-crawler/cron/queue_populate.py \
     --allowlist mira-crawler/cron/allowlists/drive_manuals.yaml --dry-run
   ```
4. **Populate** for real (dedupes against the queue + already-ingested URLs):
   ```
   cd /opt/mira && doppler run -- python3 mira-crawler/cron/queue_populate.py \
     --allowlist mira-crawler/cron/allowlists/drive_manuals.yaml \
     --reason "cohort N onboarding"
   ```
5. **Let the cron consume it** (hourly), or kick one run now:
   ```
   cd /opt/mira && doppler run -- python3 mira-crawler/cron/kb_growth_cron.py
   ```

## Inspect progress

```
cd /opt/mira && doppler run -- python3 mira-crawler/cron/kb_growth_cron.py --status
# queue counts by state: pending / done / needs_ocr / failed / failed_retryable / skipped_dedup
```
Per-run detail: `/var/log/mira-agents/kb_growth.log`. A stored manual → a row in
`knowledge_entries` with `source_url` = the manual URL (the citation).

## Pause / rollback

- **Pause new ingest:** empty the queue (`echo '[]' > manual_queue.json`) or drop
  a `~/.mira/STOP_INGEST` sentinel (honored by the ingest guardrails). The cron
  then logs "no eligible entries" and does nothing.
- **Remove a queued (not-yet-ingested) manual:** delete its entry from
  `manual_queue.json` (or empty the queue). Provenance makes entries easy to find.
- **Un-ingest a manual:** delete its `knowledge_entries` rows
  `WHERE source_url = '<url>'` — a **prod DB write**; do it only through a
  sanctioned/gated path (never ad-hoc raw SQL on prod; see `docs/environments.md`).
- **Deploy note:** `manual_queue.json` is git-ignored runtime state, so a deploy's
  `git checkout` no longer resets it. The allowlist IS version-controlled.

## Add a new vendor/product allowlist safely

1. Create `mira-crawler/cron/allowlists/<vendor>.yaml` (same schema), verify each
   URL (step 1 above), keep batches **small**.
2. Dry-run, review the additions, then populate with a clear `--reason`.
3. Watch `--status` + the log; if a URL fails repeatedly it lands `failed` (won't
   pollute the KB). Fix or remove the allowlist entry.
4. Scale only after provenance, dedupe, cleanup, and rollback are boringly
   repeatable — the objective is a safe loop, not maximum volume.

## Guardrails (why this is safe)

- **No hand-editing / no scraping** — manuals come from a reviewed, committed allowlist.
- **Dedupe on enqueue** — skips URLs already queued or already in `knowledge_entries`
  (`queue_populate.build_queue_entries` + `kb_growth_cron.url_already_ingested`).
- **Provenance on every entry** — auditable source/reason/trust/time.
- **Graceful failure** — a dead/blocked URL fails in the cron (retry → `failed`),
  never pollutes the KB.
- **Tested** — `mira-crawler/tests/test_queue_populate.py` (eligibility, dedupe,
  provenance, malformed handling, dry-run, allowlist validity).
- **Never promotes drive packs** — this only grows the manual KB; pack promotion
  stays human-gated (ADR-0025).

## Cross-references
- `docs/plans/2026-07-08-prod-ingest-storage-fixes.md` — the embedder/Tika fixes that make ingest actually store.
- Issue #2562 — Phase 1 (OCR proof) → Phase 4 (this).
- `.claude/rules/one-pipeline-ingest.md`, `.claude/rules/fieldbus-readonly.md` — ingest doctrine.
