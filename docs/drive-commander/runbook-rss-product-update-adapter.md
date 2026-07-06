# Runbook — RSS / feed / product-update adapter (staged, not built)

How to add an OEM update source **safely**, and why this is staged *behind the
manual source registry* rather than built as a scraper fleet now. Design-level;
no production RSS daemon ships in the first slice (per the discovery record,
`discovery-manual-ingest-and-update-workflow.md`).

## Doctrine: registry first, adapters later

The repo already has generic update plumbing (crawler RSS `mira-crawler/tasks/rss.py`,
sitemaps `tasks/sitemaps.py` with `lastmod`, freshness TTL `tasks/freshness.py`, the hourly
KB-growth cron) — but **none** tracks a *specific drive manual's* identity or hash. And the
bulk crawler was disabled twice for taking down the VPS (#1318/#1336). So:

1. **Register** each drive manual as a source (`workflow-register-a-manual-source.md`).
2. **Detect** change by hash (`workflow-check-for-manual-updates.md`) — the reliable signal.
3. **Only then** consider automating *discovery* of new editions per vendor.

Do not hardcode a fragile per-vendor scraper as the first answer.

## Source classification (record on every registry entry)

Classify each source with one or more of: `official` · `unofficial` ·
`downloadable_pdf` · `metadata_only` · `update_advisory_only` · `requires_login` ·
`manual_review_only`. A source that is `requires_login` or `metadata_only` (no direct
PDF) is **manual-review-only** for now — set `automatable: false`.

## The adapter contract (generic "manual/product update source")

An adapter's only job is to answer **"is there a newer edition, and where?"** — it
must **never** extract, grade, or promote. It emits a *candidate signal* the existing
pipeline turns into a reviewable candidate:

```
adapter.poll(source) -> [ { manual_id, discovered_url|null, revision|null,
                            lastmod|null, requires_manual_fetch: bool } ]
```

Then, per hit: fetch (or ask a human to fetch) the PDF → `check.py` (hash) →
`update_candidate.py` (candidate) → human acceptance. The adapter feeds step 1;
everything downstream is the trust-preserving path already built.

## Per-OEM starting notes (DriveSense priority)

| OEM | Likely source | First-cut classification |
|---|---|---|
| Rockwell / PowerFlex | Literature Library (publication numbers) | official · downloadable_pdf · often requires_login |
| AutomationDirect GS10/GS11 | product docs pages / PDFs | official · downloadable_pdf |
| Yaskawa, ABB, Schneider, Siemens, Danfoss, Mitsubishi, Eaton, WEG | vendor doc portals | classify per-vendor; many `requires_login` → manual-review-only |

Do not assume any vendor has a clean RSS feed. Discover what exists per vendor, record the
classification, and default to `manual_review_only` when unsure.

## Safe-to-automate gate

Only flip a source to `automatable: true` when **all** hold: a stable, no-login,
direct-PDF URL; a reproducible `generator` + `gold_path` for its family; and a
tested extraction over that manual. Otherwise it stays manual-review-only.

## Status

**Not built in the first slice.** The registry + hash-check + candidate command are the
foundation this adapter would sit on. Build a single adapter (start with the easiest
direct-PDF vendor) only after the registry is in use and the acceptance runbook is exercised.
