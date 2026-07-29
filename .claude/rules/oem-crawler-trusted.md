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

## Cross-references

- `.claude/rules/knowledge-entries-tenant-scoping.md` — the `is_private` + shared-tenant hybrid
- `tools/seeds/backfill_verified_corpus.sql` — the pre-existing trusted-by-default policy
- `docs/superpowers/specs/2026-07-28-oem-crawler-retrieval-bridge-design.md` — the design
