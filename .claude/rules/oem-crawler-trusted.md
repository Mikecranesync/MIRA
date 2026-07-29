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

## The backfill selector is not a provenance test

`source_type = 'equipment_manual' AND manufacturer <> ''` describes an output
*shape*, not an origin. At least three writers produce that shape:
`ManufacturerCrawler` (curated, trusted), `CSVCrawler` (heuristic PDF
resolution, untrusted), and `tasks/ingest.py::ingest_url` (untrusted). No
column stored by `insert_chunk` records which one wrote a row.

Therefore: **no backfill may promote rows to `verified = true` on shape alone.**
A promotion must either (a) be restricted to rows whose provenance is provable
from stored data, or (b) not happen — the documents are re-acquired through the
trusted crawler instead, which records a re-fetchable `source_url`.

Re-acquisition is the preferred remedy. Adding a document's OEM URL to
`sources.yaml` costs minutes and yields a row that is trusted by construction
and auditable forever.

## Why the backfill was pulled (2026-07-29 audit)

An audit of the CSV corpus found only 10 manuals actually ingested out of 311
spreadsheet rows, and all 10 verified as live, valid PDFs from legitimate
sources — document quality was never the problem. The blocker is
auditability: for portal-scraped rows the crawler never persists the
resolved PDF URL, so what was ingested cannot be checked against its source
after the fact. That gap, not document quality, is why the backfill was
pulled rather than merely re-selected.

## What a reviewer must catch

- ❌ A new crawler setting `oem_trusted = True` without curated `sources.yaml` entries.
- ❌ `verified=True` passed from any non-OEM write path.
- ❌ OEM writes reverting to `config.mira_tenant_id`.
- ❌ Trust re-scoped to a tier string instead of the crawler class.
- ❌ A backfill or migration selector keyed on `metadata->>'source'`, `source_type`,
  or `manufacturer` as a stand-in for "the OEM crawler wrote this."
- ❌ Any change that grants `oem_trusted = True` to a crawler whose source URLs
  are not enumerated in `sources.yaml`.
- ❌ An ingest path that discards the resolved document URL, leaving the row
  un-auditable after the fact.

## Residual gaps — NOT closed by SP1

SP1 fixes the write path only. **No backfill ships in this branch** — the
selector that would have moved already-written rows cannot distinguish
`ManufacturerCrawler` output from `CSVCrawler`/`ingest_url` output (see
"The backfill selector is not a provenance test" above), so promoting on
shape risked citing untrusted content as grounded OEM evidence. Consequence:
**every row already written under the garage tenant stays exactly where it
is** — unverified, garage-scoped, invisible to `recall_knowledge` — until it
is re-acquired through the trusted crawler. This is a *larger* residual gap
than the original plan, which at least moved the subset it could partially
select; the remedy now is 100% re-acquisition, not partial migration.

- **The Celery ingest surface still orphans OEM manuals.** `mira-crawler/tasks/ingest.py::ingest_url`
  writes `source_type='equipment_manual'` OEM PDFs under `MIRA_TENANT_ID` with no `verified`
  (fed by `tasks/sitemaps.py`, `tasks/playwright_crawler.py`, `tasks/manualslib_scraper.py`).
  New writes keep producing garage-tenant unverified orphans until that path is fixed too —
  and now nothing sweeps the rows it already wrote, either.
- **Tier-3 sources no nightly `ManufacturerCrawler` job reaches stay orphaned**, indefinitely,
  with no backfill to rescue them. And for a tier-3 URL *both* crawlers can reach, the
  destination tenant is decided by whichever crawler hashes the content first —
  `ingest/dedup.py::is_already_indexed` is a global content-hash shared across crawlers, so
  the loser silently skips.
- **Re-acquisition is the only remedy.** Add the document's OEM URL to `sources.yaml`
  (`ManufacturerCrawler` trust, #2961) and let the crawler re-fetch it under the fixed write
  path. The orphaned garage-tenant row is left in place (harmless — `verified=false` keeps it
  out of retrieval) rather than migrated.

## Cross-references

- `.claude/rules/knowledge-entries-tenant-scoping.md` — the `is_private` + shared-tenant hybrid
- `tools/seeds/backfill_verified_corpus.sql` — the pre-existing trusted-by-default policy
- `docs/superpowers/specs/2026-07-28-oem-crawler-retrieval-bridge-design.md` — the design
