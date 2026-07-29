# OEM Crawler Content Is Trusted By Source

Content crawled from a **curated OEM source in `mira-crawler/sources.yaml`** is
**trusted by default**: written to the shared OEM pool (`MIRA_SHARED_TENANT_ID`,
`CrawlerConfig.oem_tenant_id`) with `verified = true`, so it is citable while
`MIRA_ENFORCE_APPROVED_RETRIEVAL` is on.

**The human gate is `sources.yaml` curation (#2961), not per-chunk review.**

## What is trusted

Trust is a property of the **crawler class**, not of a tier string:
`ManufacturerCrawler.oem_trusted = True`. It reaches `3_manufacturer` on broad
crawls and additionally `5_reference` when a specific manufacturer is named
(`crawler/manufacturer.py`) — both are curated OEM content, and scoping trust to
one tier would undo #2959.

## What is NOT trusted

`CurriculumCrawler`, `CSVCrawler`, blog / patent / YouTube tasks, and every
customer upload. They keep `oem_trusted = False`, write under
`CrawlerConfig.mira_tenant_id`, and stay `verified = false` until a human
approves them in the Hub. That is what the approval gate is for.

## Why the OEM tenant is a separate config field

`MIRA_TENANT_ID` was repointed to the garage/bench tenant during the CV-101
live-machine-memory work, and the crawler silently followed it — which is how
OEM chunks became invisible to customers and `/quickstart`. `oem_tenant_id` is
pinned to `MIRA_SHARED_TENANT_ID` so OEM writes can never drift with it again.

## What a reviewer must catch

- ❌ A new crawler setting `oem_trusted = True` without curated `sources.yaml` entries.
- ❌ `verified=True` passed from any non-OEM write path.
- ❌ OEM writes reverting to `config.mira_tenant_id`.
- ❌ Trust re-scoped to a tier string instead of the crawler class.
- ❌ A backfill or migration selector keyed on `metadata->>'source'` rather than on
  the crawler's actual output shape (`source_type` + `manufacturer`) — that marker is
  stamped by the **shared write library** (`insert_chunk` in `mira-crawler/ingest/store.py`
  hardcodes `"source": "mira_crawler"`), not by the OEM crawler. Every caller stamps it:
  reddit (`forum_post`), patents (`patent`), youtube (`video_transcript`), rss
  (`rss_article`), playwright (`knowledge_article`), equipment photos (`equipment_photo`),
  `CurriculumCrawler` (`curriculum`/`standard`). Since `recall_knowledge` applies no
  `source_type` filter — its only gate is `AND verified = true` — a marker-keyed selector
  promotes all of them into the cross-tenant shared pool as citable grounded evidence,
  which is precisely what "What is NOT trusted" above forbids.

## Residual gaps — NOT closed by SP1

- **The Celery ingest surface still orphans OEM manuals.** `mira-crawler/tasks/ingest.py::ingest_url`
  writes `source_type='equipment_manual'` OEM PDFs under `MIRA_TENANT_ID` with no `verified`
  (fed by `tasks/sitemaps.py`, `tasks/playwright_crawler.py`, `tasks/manualslib_scraper.py`).
  The backfill moves its *existing* rows — but only the ones that carry a manufacturer, since
  `ingest_url`'s `manufacturer` defaults to `""` and only the curated `tasks/discover.py`
  fan-out supplies one; the link-scraped playwright rows are left behind by design. Either
  way, **new writes resume producing garage-tenant unverified orphans** until that path is
  fixed too.
- **Tier-3 sources no nightly `ManufacturerCrawler` job reaches stay orphaned.** And for a
  tier-3 URL *both* crawlers can reach, the destination tenant is decided by whichever
  crawler hashes the content first — `ingest/dedup.py::is_already_indexed` is a global
  content-hash shared across crawlers, so the loser silently skips.

## Cross-references

- `.claude/rules/knowledge-entries-tenant-scoping.md` — the `is_private` + shared-tenant hybrid
- `tools/seeds/backfill_verified_corpus.sql` — the pre-existing trusted-by-default policy
- `tools/seeds/backfill_oem_crawler_chunks.sql` — the one-time backfill (its header is the
  operator runbook); guarded by `tools/seeds/tests/backfill_oem_crawler_chunks_fixture.sql`
- `docs/superpowers/specs/2026-07-28-oem-crawler-retrieval-bridge-design.md` — the design
