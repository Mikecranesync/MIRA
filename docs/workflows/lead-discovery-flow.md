# Lead Discovery Flow

**One-line:** Hourly cron (launchd or Celery) → city rotation → web search (Serper + DDG) → ICP scoring → NeonDB upsert → HubSpot push → biweekly enrichment.

**Cross-links:**
- `tools/lead-hunter/hunt.py` — full discovery + HubSpot push logic
- `tools/lead-hunter/run_hourly.py` — hardened hourly entry point (singleton lock + timeout)
- `tools/lead-hunter/celery_tasks.py` — Celery task + city rotation + enrichment loop
- `tools/lead-hunter/discover.py` — MSCA directory scraper + DDG medium-biz queries (14 `MEDIUM_BIZ_QUERIES`, `scrape_msca()`, `search_ddg_medium()`)
- `tools/lead-hunter/enrich.py` — deep enrichment (Hunter.io API + website scraping; `scrape_facility_deep()`, `apply_enrichment()`, `find_contacts_hunter()`)
- `tools/lead-hunter/hardening.py` — reliability primitives (singleton lock, retries, timeout, RunReport)
- `tools/lead-hunter/schema.sql` — NeonDB schema (`prospect_facilities`, `prospect_contacts`)
- `tools/lead-hunter/probe_serper.py` — Serper API quota probe tool
- `marketing/prospects/` — output directory for reports, CSV exports, JSONL, logs

**WARNING: This pipeline writes REAL prospect data to NeonDB and HubSpot CRM.** There is no staging mode for the lead-hunter. Every run against a configured `NEON_DATABASE_URL` and `HUBSPOT_ACCESS_TOKEN` affects production prospect records.

---

## Summary

The lead-hunter discovers manufacturing facilities near Lake Wales, FL using web search (Serper API preferred; DuckDuckGo as fallback) and a curated seed list of 65+ known industrial sites. Each run rotates through 22 cities, scores facilities by ICP criteria, persists to NeonDB, and optionally pushes qualified leads (ICP ≥ 10) to HubSpot CRM. A separate enrichment phase scrapes facility websites and probes Serper for maintenance contacts.

---

## The Flow

### Step 1 — Trigger (cron / launchd / Celery)

**Cron source of truth:** `scripts/install_crons.sh` — contains the VPS crontab. Lead-hunter is NOT currently in this cron file (as of the 2026-06-07 read). The `run_hourly.py` docstring says "Called by: launchd (com.mira.lead-hunter) or Celery beat."

**Current scheduling status:** ⚠️ UNVERIFIED. `run_hourly.py:4` says `launchd (com.mira.lead-hunter) or Celery beat`, but:
- No `com.mira.lead-hunter` plist was found under `tools/lead-hunter/`
- `mira-crawler/celeryconfig.py` `beat_schedule` does NOT include `lead_hunter.discover_and_enrich`
- `tools/lead-hunter/celery_tasks.py:16` shows a sample `beat_schedule` fragment that must be ADDED to `mira-crawler/celeryconfig.py` to activate the Celery path

**Standalone run (verified working):**
```bash
doppler run --project factorylm --config prd -- python3 tools/lead-hunter/run_hourly.py
```

**Full manual discovery run:**
```bash
doppler run --project factorylm --config prd -- python3 tools/lead-hunter/hunt.py --push-hubspot
```

### Step 2 — Singleton lock + preflight

**File:** `tools/lead-hunter/run_hourly.py`
**File:** `tools/lead-hunter/hardening.py`
**Functions:** `singleton_lock("lead-hunter")`, `preflight_secrets(REQUIRED_SECRETS, OPTIONAL_SECRETS)`

`run_hourly.py:main()` wraps execution in:
1. `singleton_lock("lead-hunter")` (`hardening.py:40`) — file-based `fcntl.LOCK_EX|LOCK_NB` on `/tmp/.lead-hunter.lock`. If another instance holds it, exits cleanly with code 0 (not an error).
2. `hard_timeout(1500)` — SIGALRM deadline of 25 minutes. Guarantees the process dies before the next hourly trigger.
3. `preflight_secrets(REQUIRED_SECRETS, OPTIONAL_SECRETS)` — checks env. Required: `NEON_DATABASE_URL`. Optional: `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `HUNTER_API_KEY`, `HUBSPOT_API_KEY`, `HUBSPOT_ACCESS_TOKEN`. Missing optional secrets degrade gracefully (DDG fallback, no enrichment, no HubSpot push); missing required secret exits with code 2.

`RunReport` (`hardening.py`) tracks per-step pass/fail/skip with timings. After each run, `alert(report)` appends a JSON line to `marketing/prospects/hardening-alerts.jsonl` and optionally POSTs to a Discord webhook if `DISCORD_ALERT_WEBHOOK` env var is set (`hardening.py:259`; non-fatal if not set or if the POST fails).

### Step 3 — Schema apply (idempotent)

**File:** `tools/lead-hunter/run_hourly.py:86`
**Function:** `hunt.apply_schema(db_url)` → `tools/lead-hunter/hunt.py:1553`

Reads `tools/lead-hunter/schema.sql` and applies all statements. Idempotent (`CREATE TABLE IF NOT EXISTS`). Creates:
- `prospect_facilities` — primary table
- `prospect_contacts` — linked via `facility_id FK`
- Indexes: `idx_prospects_name_city`, `idx_prospects_city`, `idx_prospects_icp_score`, `idx_prospects_status`, `idx_contacts_facility`

### Step 4 — City rotation (hourly mode only)

**File:** `tools/lead-hunter/celery_tasks.py`
**State file:** `tools/lead-hunter/.hourly_state.json`
**Functions:** `_load_state()`, `_save_state(state)`, `_check_daily_budget(state)`

State JSON fields:
- `city_index` — index into `hunt.CITIES` (22 cities); advances by 1 each run, wraps at 22
- `requests_today` — running count of HTTP requests; resets at UTC day rollover
- `last_date` — YYYY-MM-DD of last request-count reset
- `total_discovered` — cumulative facility count across all runs

`DISCOVERY_RATE` caps: `max_facilities_per_run=50`, `max_enrichments_per_run=20`, `max_requests_per_run=120`, `daily_request_budget=500`.

If `requests_today >= 500`, the run is skipped with `{"skipped": True, "reason": "daily_budget"}`.

**Full-run mode** (`hunt.py:main()`) does NOT use city rotation — it iterates all 22 cities every time.

### Step 5 — Seed phase (full-run mode only)

**File:** `tools/lead-hunter/hunt.py`
**Function:** `seed_facilities() -> list[Facility]`

Loads 65+ known Central Florida manufacturing/industrial sites from the `_SEEDS` list (hard-coded in `hunt.py:192`). Each seed is scored via `score_facility()` immediately. Seeds are deduplicated in-memory by `Facility.key = f"{name.lower()}|{city.lower()}"`.

Hourly mode SKIPS seed loading — it only discovers new facilities for the current city rotation.

### Step 6 — Web search (discovery phase)

**File:** `tools/lead-hunter/hunt.py` + `tools/lead-hunter/celery_tasks.py`

8 query templates per city (`QUERY_TEMPLATES`):
- "manufacturing plant {city} FL"
- "food processing plant {city} FL"
- "machine shop {city} FL"
- (etc.)

**Search backends (in priority order):**

1. **Serper API** (preferred) — `hunt.search_serper(query, api_key, client)` → `POST https://google.serper.dev/search`
   - Key: `SERPER_API_KEY` from Doppler
   - Returns `organic` results + `places` (with phone/rating/reviews)
   - No rate-limit sleep needed (API handles throttling)

2. **DuckDuckGo HTML scraping** (fallback when no `SERPER_API_KEY`) — `hunt.search_duckduckgo(query, client)`
   - Scrapes `https://html.duckduckgo.com/html/`
   - Circuit breaker: after `DDG_FAIL_LIMIT=5` consecutive `None` returns (rate-limit 403/429), sets `ddg_dead=True` and skips remaining queries
   - Rate-limit sleep: `RATE_LIMIT_SECS=3.0` between requests

**Hourly mode additional sources:**
- Phase 1a: `discover.scrape_msca(client)` — MSCA directory scrape (`tools/lead-hunter/discover.py`). Only runs when `city_idx == 0` (once per 22-city cycle). Fetches `https://mscafl.com/msca-member-directory/` and parses `div.et_pb_text_inner` for member entries. Filters on `MSCA_MFG_KEYWORDS` list to keep only manufacturing members. Infers city from address text. Returns a list of `Facility` objects with `source="msca_directory"`.
- Phase 1b: `discover.search_ddg_medium(city, lat, lon, client, queries, ddg_fails)` (`tools/lead-hunter/discover.py`) — runs 14 `MEDIUM_BIZ_QUERIES` per city via DuckDuckGo HTML scraping (`_ddg_search(query, client)`). `MEDIUM_BIZ_QUERIES` are distinct from `hunt.QUERY_TEMPLATES`: they target medium-biz categories like "electrical contractor", "HVAC commercial", "industrial supply", etc. Shares the `ddg_fails` counter with the caller — if it crosses `DDG_FAIL_LIMIT`, remaining queries are skipped.

### Step 7 — Parse + ICP score

**File:** `tools/lead-hunter/hunt.py`
**Functions:** `extract_facilities_from_results()`, `score_facility(f: Facility) -> int`

`extract_facilities_from_results()` filters raw search results:
- Skips known aggregator domains (`SKIP_DOMAINS`: yelp.com, yellowpages.com, linkedin.com, etc.)
- Skips if text doesn't match `MFG_CATEGORIES` keywords
- Parses address, phone, website from snippet text via regex
- Constructs `Facility` dataclass

`score_facility()` computes ICP score (0–24) by summing weights from `ICP_WEIGHTS`:
| Signal | Weight |
|--------|--------|
| Manufacturing keywords in name/category | 3 |
| Food/bev/chemical/pharma keywords | 3 |
| VFD/conveyor/pump/PLC/SCADA keywords in notes | 4 |
| Maintenance-title contact found | 3 |
| Has email contact | 2 |
| Medium/large (≥20 reviews) | 2 |
| Multi-site signals | 2 |
| Within 60mi of Lake Wales | 2 |
| Within 100mi | 1 |
| Has website | 1 |
| Has phone | 1 |

In-memory dedup: if `Facility.key` already exists in the run's `facilities` dict, only the ICP score, phone, and website are merged (existing record wins identity fields).

### Step 8 — Enrichment phase

**File:** `tools/lead-hunter/hunt.py:enrich_facilities()` (full run)
**File:** `tools/lead-hunter/celery_tasks.py:_enrich_unenriched()` (hourly run)
**File:** `tools/lead-hunter/enrich.py` — `scrape_facility_deep()`, `apply_enrichment()`, `find_contacts_hunter()`, `generate_email_patterns()`, `domain_has_mx()`

Eligibility gate (full run): `icp_score >= 4` AND has a website AND website is NOT in `DIRECTORY_LISTING_HOSTS` (chamberofcommerce.com, superpages.com, etc.).

Eligibility gate (hourly run, `_enrich_unenriched()`): facility has website AND no contacts yet AND `icp_score >= 6`.

**Deep website scrape** (`enrich.scrape_facility_deep(f, client)` — `tools/lead-hunter/enrich.py`):
- Fetches up to 5 pages (homepage + `/contact`, `/about`, `/team`, `/staff`) with `httpx.AsyncClient`; 0.8-second sleep between pages to avoid rate limits
- Extracts `employee_count_hint` from phrases like "team of X" or "X employees"
- Extracts emails, phones, and maintenance/plant manager contact names
- Returns an enrichment dict consumed by `apply_enrichment()`

**Hunter.io contact lookup** (`enrich.find_contacts_hunter(domain, api_key, client)` — `tools/lead-hunter/enrich.py`):
- `GET https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}`
- Returns structured contact list with name, title, email, confidence
- Only called when `HUNTER_API_KEY` is set in Doppler

**Email pattern generation + MX verification** (`enrich.generate_email_patterns(first, last, domain)` + `enrich.domain_has_mx(domain)`):
- Generates candidate patterns: `first@domain`, `f.last@domain`, `first.last@domain`, etc.
- `domain_has_mx()` verifies via `dig {domain} MX` subprocess, falling back to `socket.getaddrinfo()` — only generates patterns for domains with valid MX records

**`apply_enrichment(f, enrichment, hunter_key, client)`** (`tools/lead-hunter/enrich.py`):
- Merges deep-scrape results onto the `Facility` dataclass
- Calls `find_contacts_hunter()` if `hunter_key` is set
- Updates `f.icp_score` via `score_facility()` after merging

**Website scrape via hunt.py** (`hunt.scrape_site(url, client)` — also called in full-run enrichment):
- Fetches up to 4 pages: homepage + `/contact`, `/about`, `/team`, `/management`
- Extracts emails via `EMAIL_RE`, phones via `PHONE_RE`
- Extracts maintenance contacts via `_TITLE_SNIPPET_RE` (regex matching "Name, Title" patterns for titles like "maintenance manager", "plant manager", etc.)
- Filters fake names via `_is_real_name()` (rejects stopword-containing tokens, all-caps, single-word)
- Checks for VFD keywords in full-page text → sets `vfd_hit`
- Contact confidence tag: `"website-direct"`

**Serper contact probe** (`hunt.search_contacts_via_serper()`):
- 2–3 Serper queries per facility: `"maintenance manager" OR "plant manager" "{name}"`, site-scoped, LinkedIn
- Counts against `enrich_budget` (default 500 queries)
- Contact confidence tag: `"search-snippet"`
- `_is_real_name()` filter applied to avoid snippet noise

After enrichment, `score_facility()` is re-run to update ICP score.

### Step 9 — NeonDB persist

**File:** `tools/lead-hunter/hunt.py`
**Function:** `upsert_facilities(facilities, db_url) -> int`

Two-step upsert (avoids `ON CONFLICT` ambiguity with two unique indexes: `(name, address)` and `(name, city)`):
1. `SELECT id FROM prospect_facilities WHERE (name=? AND address=?) OR (name=? AND city=?) LIMIT 1`
2. If found: `UPDATE` non-identity fields (phone, website, category, rating, icp_score, notes) using `COALESCE(NULLIF(new,''), existing)` and `GREATEST(existing, new)` for scores
3. If not found: `INSERT ... RETURNING id` with `ON CONFLICT DO NOTHING` safety net

Then inserts contacts into `prospect_contacts`:
```sql
INSERT INTO prospect_contacts (facility_id, name, title, email, phone, source, confidence)
VALUES ... ON CONFLICT DO NOTHING
```

Returns count of newly INSERTED rows (not updated rows).

**Hourly-run DB path** (`celery_tasks.py:_enrich_unenriched()`): uses `psycopg2` directly rather than the `upsert_facilities` function — writes phone/notes/icp_score UPDATE and contact INSERT in the same connection/transaction.

**Run log:** Every hourly run appends a JSON line to `marketing/prospects/hourly-runs.log` (`celery_tasks.py:RUNS_LOG`).

### Step 10 — HubSpot push (optional)

**File:** `tools/lead-hunter/hunt.py`
**Function:** `push_to_hubspot(facilities, token, min_score=10) -> dict`

Requires: `HUBSPOT_ACCESS_TOKEN` or `HUBSPOT_API_KEY` from Doppler.

Only facilities with `icp_score >= 10` are qualified. For each:
1. `_hs_search_company(name, domain, token)` — dedup check via `POST /crm/v3/objects/companies/search` by `domain` then by `name`
2. If found: `PATCH /crm/v3/objects/companies/{id}` — update properties
3. If not found: `POST /crm/v3/objects/companies` — create; if 401 → circuit breaker returns immediately
4. For each contact: `_hs_search_contact(email, token)` then create + associate to company via `PUT .../associations/...`
5. Facilities with `icp_score >= 15`: create a deal (`MIRA Pilot — {name}`, amount $499, stage `appointmentscheduled`) and associate to company

On HubSpot auth failure: falls back to `write_hubspot_csv()` → `marketing/prospects/hubspot-import-{date}.csv`.

### Step 11 — Report generation

**File:** `tools/lead-hunter/hunt.py`
**Function:** `write_report(facilities, path, hs_stats)`

Writes a Markdown report to `marketing/prospects/central-florida-{date}.md`:
- Top 20 by ICP score table
- Enriched contacts section
- Full facility list
- HubSpot sync stats or CSV import instructions

---

## ASCII Flow Diagram

```
Trigger: launchd (com.mira.lead-hunter) OR Celery beat OR manual
          |
          v
run_hourly.py:main()                              [run_hourly.py:149]
  |-- singleton_lock("lead-hunter")               [hardening.py:40]
  |-- hard_timeout(1500s)                         [hardening.py]
  |-- preflight_secrets(REQUIRED, OPTIONAL)
  |-- hunt.apply_schema(db_url)                   [hunt.py:1553]
          |
          v
celery_tasks.run_discover_and_enrich()            [celery_tasks.py:87]
  |
  |-- _load_state() from .hourly_state.json       [celery_tasks.py:62]
  |-- _check_daily_budget(state)  (budget=500)    [celery_tasks.py:74]
  |-- pick city[state.city_index]                 [celery_tasks.py:104]
  |-- state.city_index += 1 (mod 22)
  |
  |-- Phase 1a: discover.scrape_msca() if city_idx==0
  |-- Phase 1b: discover.search_ddg_medium()
  |-- Phase 1c: hunt.QUERY_TEMPLATES × DDG/Serper
  |               extract_facilities_from_results()  [hunt.py:1146]
  |               score_facility()                   [hunt.py:868]
  |               in-memory dedup by Facility.key
  |
  |-- Phase 2: _enrich_unenriched(db_url, limit=20) [celery_tasks.py:255]
  |               scrape → contacts → upsert phone/contacts
  |
  |-- hunt.upsert_facilities(fac_list, db_url)    [hunt.py:1568]
  |       → INSERT/UPDATE prospect_facilities
  |       → INSERT prospect_contacts
  |
  |-- hunt.push_to_hubspot(qualified, hs_token)   [hunt.py:1748]
  |       → search/create/update companies
  |       → create/associate contacts
  |       → create deals (ICP >= 15)
  |
  |-- _save_state(state) → .hourly_state.json
  |-- append to hourly-runs.log
  |
          v
RunReport finalized, alert() called
  → marketing/prospects/hardening-alerts.jsonl

FULL-RUN MODE (hunt.py --push-hubspot):
  seed_facilities() → all 22 cities → enrich_facilities() → upsert → push
  → marketing/prospects/central-florida-{date}.md
  → marketing/prospects/hubspot-import-{date}.csv
```

---

## Tables Touched

| Table | DB | Location | When |
|-------|----|----------|------|
| `prospect_facilities` | NeonDB | `tools/lead-hunter/schema.sql` | Step 3 (create), Step 9 (upsert) |
| `prospect_contacts` | NeonDB | `tools/lead-hunter/schema.sql` | Step 9 (insert contacts) |

**No Hub migrations** — lead-hunter uses its own schema in the same NeonDB instance. Tables are in the default schema (no RLS). Schema is applied by `hunt.apply_schema()` on each run.

**HubSpot objects written (CRM, not NeonDB):**
- Companies (`/crm/v3/objects/companies`)
- Contacts (`/crm/v3/objects/contacts`)
- Deals (`/crm/v3/objects/deals`) for ICP ≥ 15

---

## What Can Go Wrong

### 1. HubSpot rate limits
HubSpot free-tier enforces 100 API calls per 10 seconds. The `push_to_hubspot()` function uses `httpx.Client(timeout=15)` sequentially — no rate-limit sleep. On a large batch, a 429 will appear as an `errors` increment in `stats`, not a crash. The next call to `push_to_hubspot()` will re-attempt. A 401 immediately returns (circuit breaker at `hunt.py:1801`).

### 2. Duplicate companies
The dedup check (`_hs_search_company()`) searches by `domain` then `name`. Companies without a website (no domain) may create duplicates across runs. On the NeonDB side, the two-step upsert handles duplicates correctly, but the HubSpot CRM has no equivalent dedup merge — check for and merge duplicate companies in HubSpot manually if `companies_created` grows unexpectedly.

### 3. `.hourly_state.json` corruption
`_save_state()` does `STATE_FILE.write_text(json.dumps(state))` — no atomic write. If the process is killed mid-write (e.g. by the hard timeout), the JSON file is truncated. `_load_state()` catches `Exception` on parse and returns the default state `{city_index: 0, requests_today: 0}` — so corruption is self-healing but resets city rotation and request budget.

### 4. Serper quota exhaustion
`probe_serper.py` probes the Serper API balance. The discovery loop uses Serper for each query template (up to 8 per city × 22 cities = 176 queries in a full run). Enrichment adds up to 500 more. A $50/mo Serper account allows ~50,000 queries. Use `probe_serper.py` to check remaining balance before a large run. On quota exhaustion, `search_serper()` returns `[]` with a warning log — the run continues with empty results, silently producing no new discoveries.

### 5. DDG circuit breaker trips
If DuckDuckGo rate-limits (403/429), `search_duckduckgo()` returns `None`. After `DDG_FAIL_LIMIT=5` consecutive `None` returns, `ddg_dead=True` and all remaining queries for that run are skipped. This can cause a full run to discover zero facilities from web search (seeds still load). Check `marketing/prospects/lead-hunter.log` for "DDG circuit breaker tripped" lines.

### 6. Rotation state mismatch after Celery restart
If the Celery worker is restarted and `.hourly_state.json` is missing, city rotation restarts from index 0. This means Lake Wales (the anchor city) gets re-scraped. Not a data-correctness issue (upsert handles duplicates) but wastes budget. Check the file exists before worker restart.

### 7. Missing schedule (no launchd plist or Celery beat entry)
The `com.mira.lead-hunter` launchd plist was not found in the repository. The Celery beat schedule entry shown in `celery_tasks.py:16` is a COMMENT/SAMPLE — it must be manually added to `mira-crawler/celeryconfig.py`'s `beat_schedule` dict to activate. Without either mechanism, the hourly runner only executes when called manually. Verify with `launchctl list | grep lead` or `celery -A mira_crawler.celery_app inspect scheduled`.

### 8. `FIRECRAWL_API_KEY` in preflight vs. code

`run_hourly.py` lists `FIRECRAWL_API_KEY` as an **optional** secret in its preflight check, but `enrich.py` does NOT call any Firecrawl endpoint — it uses website scraping via `httpx` and Hunter.io via `find_contacts_hunter()`. `FIRECRAWL_API_KEY` appears to be a legacy preflight entry or reserved for a future code path. Its absence does NOT degrade enrichment; the only real enrichment API dependency is `HUNTER_API_KEY` (for domain-search contacts).
