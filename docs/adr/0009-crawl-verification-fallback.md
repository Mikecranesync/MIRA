# ADR-0009: Crawl Verification + Fallback Routing

## Status
Accepted

**Follows:** ADR-0008 (Deprecate mira-sidecar)
**Closes:** Issue #209

---

## Context

### Current state

The reactive KB gap-filler path in mira-ingest is:

```
GET_DOCUMENTATION intent detected
  → engine._fire_scrape_trigger()        # asyncio.create_task, fire-and-forget
    → POST /ingest/scrape-trigger        # returns 200 immediately
      → _run_scrape_and_ingest()         # background task
        → Apify website-content-crawler  # actor runs
          → _apify_items_to_docs()       # converts result set to {filename, content}
            → _ingest_scraped_text()     # POST /api/v1/files/ + /knowledge/{id}/file/add
              → Telegram notification    # "New knowledge added ✅"
```

There is **zero validation** at any step. The system has no way to distinguish:

- A successful crawl that produced real manual content
- A crawl that "succeeded" but returned only nav-bar / listing pages (JS-rendered site,
  Cheerio only sees shell HTML)
- A crawl that returned 0 bytes of content
- A crawl that returned content completely unrelated to the target model
- A crawl whose KB write silently 401'd (the v2.4.0 OPENWEBUI_API_KEY incident)

**Observed failure — 2026-04-14, Yaskawa V1000 crawl:**

- Apify run `Brgo1xN4QLjhr0Pgc`: status=SUCCEEDED, duration=1.9 min
- Dataset `Uv6DPMIUzzNLQNoeu`: 100 items returned
- Every item was a download-directory listing page (`/downloads?productGroup=...`)
- No actual manual content; all pages 699–3,454 chars with no fault-code tables,
  no parameter specs, no installation instructions
- Shell ratio: 0.31 / Keyword hit rate: misleading (all pages hit "yaskawa" because
  it's the yaskawa.com domain, not because of model-specific content)
- KB write result: unknown — no CRAWL_VERIFY log line exists because verification
  didn't exist
- Technician notification said "New knowledge added ✅" regardless

**Observed failure — 2026-04-14, Pilz safety gate crawl:**

- 1/1 docs ingested, HTTP 200 on KB write — success _appeared_ logged
- Pilz.com is fully JS-rendered; Cheerio-only crawler returns shell HTML
- Content stored was likely navigation/header skeleton, not actual safety gate manual
- No way to verify without fetching back the stored chunk and inspecting it

### The selling-point gap

MIRA's core promise is: "ask about a piece of equipment you've never asked about before,
and within 2 minutes you get real manufacturer documentation." That promise is **broken**
if:

1. The primary crawl route fails silently (shell pages ingested as if they were manuals)
2. There is no fallback when the primary route fails
3. There is no audit trail to distinguish "got the manual" from "got a nav bar"

---

## Decision

Introduce a **Crawl Verification Layer** (Phase 1) and a **Route Fallback Registry**
(Phase 2).

### Phase 1 — Crawl Verifier (ships immediately)

After every Apify run completes, run a quality gate before notifying the technician.

**Outcome codes:**

| Code | Condition |
|------|-----------|
| `SUCCESS` | page_count ≥ 3, shell_ratio < 0.5, content_density > 0.3, model keyword in ≥1 page |
| `LOW_QUALITY` | pages exist, model keywords present, but content_density low (listing pages) |
| `SHELL_ONLY` | pages exist but all short (<500 chars) or nav-heavy; likely JS-rendered site |
| `EMPTY` | page_count = 0 after filtering |
| `FAILED` | Apify actor status ≠ SUCCEEDED |

**Metrics computed per crawl:**

- `page_count` — total items in Apify dataset
- `shell_ratio` — fraction of pages with `len(text) < 500` or nav-keyword density > 30%
- `content_density` — fraction of pages where text contains ≥2 of: fault code, alarm,
  parameter, specification, installation, wiring, datasheet, troubleshoot, replace
- `model_keyword_hit` — fraction of pages containing model number tokens (not brand name)
- `url_depth` — fraction of URLs that include deep path indicators (`/pdf`, `/manual`,
  `/document`, `/datasheet`, `/guide`, `/spec`, numeric doc ID)
- `kb_writes` — count of successful `POST /api/v1/knowledge/{id}/file` calls (HTTP 200)

**Verification record** written to `/opt/mira/data/crawl_verifications.sqlite`
(`crawl_runs` table) with full metrics as JSON. Queryable via
`GET /ingest/crawl-verifications`.

**If outcome ≠ SUCCESS:** log `CRAWL_VERIFY_FAILED` with classification; send
honest notification ("found pages but content wasn't detailed enough to index;
send me a PDF directly").

### Phase 2 — Route Fallback Registry (follow-up, issue #210)

YAML config `config/crawl_routes.yaml` maps each vendor to a priority-ordered list of
crawl strategies. When the verifier returns anything other than SUCCESS, the ingest
background task enqueues the next-priority strategy, up to a configurable budget (default:
3 attempts, $0.20 cap).

Strategies in priority order:
1. `apify_cheerio` — current, fast, free-tier, fails on JS-heavy sites
2. `apify_playwright` — JS-rendered, slower, higher memory cost
3. `duckduckgo_site_search` — crawl `site:vendor.com model filetype:pdf`
4. `manualslib` — manualslib.com search for model
5. `plcdocs` — plcdocs.com model search
6. `llm_discover_url` — LLM call: "give me the direct URL to the user manual PDF for
   {vendor} {model}"; structured output, URL validation, HTTP HEAD check before crawl

### Phase 3 — Live monitoring dashboard (follow-up, issue #211)

`GET /ingest/crawl-dashboard` — last 24h verifications grouped by vendor, success rate,
common failure patterns. Slack/Telegram alert when vendor success rate drops below 70%.

---

## Consequences

### Positive

- Every crawl now produces an auditable outcome code — no more silent failures
- Technician notifications are honest: SUCCESS means verified content; others give
  actionable alternatives
- Phase 2 fallback means a JS-rendered site (Pilz, Yaskawa download portal) gets a
  second attempt with a smarter strategy before giving up
- KB writes are correlated to run_id — can diagnose auth failures vs content failures
  independently

### Negative / Trade-offs

- **Latency:** +1–3 seconds per crawl for dataset fetch + quality computation (Apify
  already ran; this is just the verification pass)
- **Cost:** each Phase 2 fallback is another Apify run; Apify free tier is 8GB/month.
  Budget limit prevents runaway spend
- **Complexity:** adds a new SQLite DB + 2 endpoints + 1 new module; more surface to
  maintain

### Risks

- `content_density` heuristic may misclassify highly technical but terse pages (e.g.,
  a pure fault-code table that uses no prose keywords). Mitigation: tune thresholds
  against historical crawl data before raising the bar
- Free-tier Apify memory cap means concurrent large crawls (≥3 simultaneously) will
  exhaust the budget. Phase 1 verifier must serialize retry attempts

---

## Alternatives Considered

**Do nothing:** Every crawl reports success. Verified this results in misleading
technician notifications and invisible KB quality degradation.

**Fetch stored chunk and re-check:** Pull the chunk back from Open WebUI KB after
ingestion and re-verify content. Adds round-trip latency and requires a separate
inspection endpoint. Deferred to Phase 3.

**Replace Apify with Playwright universally:** Solves JS-rendering gap but dramatically
increases cost and memory footprint. Better handled by targeted fallback (Phase 2) than
as the primary path.
