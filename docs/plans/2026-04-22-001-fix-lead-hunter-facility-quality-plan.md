---
title: "fix: lead-hunter facility-quality fixes (upsert crash + directory-listing pollution + generic-email re-probe)"
type: fix
status: active
date: 2026-04-22
origin: in-session observation from 2026-04-21 enrichment run (100 Serper queries lost to directory-listing probes + upsert crash)
---

# fix: lead-hunter facility-quality — 3 fixes in order

## Overview

The 2026-04-21 enrichment run (`--enrich-only --enrich-budget 100`) surfaced three defects that prevent lead-hunter from reliably finding named decision-makers at real SMB manufacturers. All three block the user's stated goal of "fully find their contact info" for qualified Central Florida leads.

## Problem Frame

Concrete symptoms observed in the 2026-04-21 Charlie run:

- **100 Serper queries spent (~$0.10), zero named managers added.** All 32 enrichment targets were either directory-listing pages (Chamber of Commerce, SuperPages, DexKnows, Angi, Alignable, industrynet.com) or low-ICP companies with no useful snippets.
- **Run crashed on DB upsert** (`psycopg2.errors.UniqueViolation: prospect_facilities_name_address_key`) after enrichment completed — any enriched contacts from the run were lost because the transaction aborted before the contacts INSERT.
- **The first run's wins (Warren Chandler/Coca-Cola, Luciano Ferreira/Florida Natural Growers, Mark Hopkins) are not extendable** via `--enrich-only`. That mode's SELECT excludes facilities that already have any contact — even a generic `info@` email — so the high-ICP facilities that got partial enrichment on day 1 are permanently skipped on day 2.

## Requirements Trace

- **R1.** Next `--enrich-only` run commits cleanly (no UniqueViolation) — a crashed transaction must not be the failure mode.
- **R2.** Serper budget spent on real manufacturers, not directory listings. Concretely: ≥80% of probed facilities should be actual manufacturing sites, not listings pages.
- **R3.** High-ICP facilities with only generic contacts (`info@`, `sales@`) can be re-probed for named managers without manual SQL.
- **R4.** Nothing in these fixes breaks the 125 contacts already persisted from the 2026-04-21 first run.

## Scope Boundaries

- **In scope:** code-level fixes in `tools/lead-hunter/hunt.py` only. Schema migration is in scope IF it's the cleaner fix for R1.
- **Not in scope:** redesigning the ICP scoring, switching Serper for a different provider, scraping LinkedIn directly, adding Apollo/Clay paid enrichment, improving the discovery phase's URL filters (only the enrichment-time filter).

### Deferred to Separate Tasks

- **Dedup / normalize existing `prospect_facilities` rows** that have the wrong website (e.g., `https://www.superpages.com/...` where `website` should be the facility's own domain) — data cleanup, separate follow-up.
- **HubSpot push of enriched contacts** — sales integration, separate flow.

## Context & Research

### Relevant Code

- `tools/lead-hunter/hunt.py:919-971` — `upsert_facilities()`. The ON CONFLICT clause at line 931 names `(name, city)`; the DB's unique constraint (per the 2026-04-21 crash) is `(name, address)` (index name `prospect_facilities_name_address_key`). The contacts INSERT at line 962-968 uses `ON CONFLICT DO NOTHING` which is lenient.
- `tools/lead-hunter/hunt.py:1352-1426` — `enrich_facilities()`. Walks `fac_list` and probes Serper. Already skips facilities without websites and with ICP < 4. No filter for directory-listing hosts.
- `tools/lead-hunter/hunt.py:1936-2003` — `--enrich-only` main branch. SELECT at 1945-1956 filters out any facility that has any `prospect_contacts` row — the exclusion that hides high-ICP generic-email facilities.
- `tools/lead-hunter/hunt.py:511` — `scrape_site()`. Entry point for website scraping during enrichment. Runs against whatever URL is in `Facility.website` — directory pages included.

### Institutional Learnings

- `feedback_verify_before_done.md` (+ completion-semantics extension) — "done" means the acceptance gate passed, not that the command returned 0. The 2026-04-21 run "completed exit 0" despite the crash traceback in output.
- `feedback_no_throwaway_scripts.md` — extend hunt.py, don't fork it. All three fixes below land in hunt.py.

## Key Technical Decisions

- **Fix #1 (upsert) does NOT add a migration.** The existing unique index `(name, address)` is reasonable — it prevents duplicate facility rows with the same name+address. The bug is purely in the code's conflict target. Changing the code is less risky than changing the schema.
- **Fix #2 uses a blocklist of directory-listing hostnames**, not a positive allowlist. Blocklist is maintainable (add rows as new aggregators show up); allowlist would require curating 1000+ real manufacturer domains.
- **Fix #3 adds a new `--reprobe-generic` flag**, not a change to `--enrich-only`'s default SELECT. The current SELECT (exclude facilities with any contact) is still the right default for first-pass enrichment. The new flag flips to "include facilities whose contacts lack a `name` field" — opt-in, doesn't surprise existing users.

## Open Questions

### Resolved During Planning

- **Should the fix change the unique index on `prospect_facilities`?** → No. `(name, address)` is semantically correct. The bug is the code using `(name, city)`.
- **Should we delete the 28 directory-listing rows already in the DB?** → Out of scope. Deferred to a separate data-cleanup task. For now, the fix just prevents future runs from spending budget on them; existing junk rows sit dormant.

### Deferred to Implementation

- Exact blocklist of directory-listing hostnames — start with the 6 observed in the 2026-04-21 run (`chamberofcommerce.com`, `superpages.com`, `dexknows.com`, `angi.com`, `alignable.com`, `industrynet.com`), expand by grepping existing `prospect_facilities.website` for obvious patterns.
- Whether `--reprobe-generic` should preserve the facility's existing contacts (generic emails) and merely add new ones, or replace them → preserve (append-only semantics matches the existing contacts INSERT behavior).

## Implementation Units

Work in order: Unit 1 → 2 → 3. Unit 1 unblocks everything (without it, DB writes from Units 2 + 3 still crash).

- [ ] **Unit 1: Fix ON CONFLICT target in `upsert_facilities()`**

**Goal:** `--enrich-only` runs commit cleanly to `prospect_facilities` without `UniqueViolation`.

**Requirements:** R1, R4

**Dependencies:** None. First fix.

**Files:**
- Modify: `tools/lead-hunter/hunt.py` (only the `upsert_facilities` function, lines 919-971)

**Approach:**
- Change `ON CONFLICT (name, city) DO UPDATE SET ...` → `ON CONFLICT (name, address) DO UPDATE SET ...` at line 931.
- Update the contact-lookup SELECT at line 952 from `WHERE name=%s AND city=%s` → `WHERE name=%s AND address=%s` so it retrieves the row we just upserted.
- Risk: existing rows in prod NeonDB with NULL address vs empty-string address. Normalize: `Facility.address = ""` default (line 124) is fine; but if any DB row has NULL address, `(name, NULL)` ≠ `(name, '')` under Postgres equality. Safest guard: `COALESCE(address, '')` in the WHERE.

**Patterns to follow:**
- Contacts INSERT at line 962-968 already uses safe ON CONFLICT DO NOTHING. No change needed.

**Test scenarios:**
- Happy path: upsert 5 facilities with distinct `(name, address)` — all land, `inserted` count = 5.
- Conflict: upsert 1 facility twice — first inserts, second updates in place (phone/website/notes fields merge via COALESCE).
- Empty address collision: upsert 2 different facilities with name="Same Name" and address="" — should upsert onto the same row (expected: `name + address` IS the unique key).
- Error path: test that a broken INSERT (e.g. too-long name) still raises — we're not silencing errors, just routing conflicts correctly.

**Verification:**
- `python -c "import ast; ast.parse(open('tools/lead-hunter/hunt.py').read())"` still returns syntax OK.
- Post-merge: re-run `hunt.py --enrich-only --enrich-budget 10 --dry-run` and confirm the dry-run log path hits cleanly (no live execution needed).
- Post-merge real run: `hunt.py --enrich-only --enrich-budget 10` commits to NeonDB; check `SELECT COUNT(*) FROM prospect_facilities WHERE updated_at > NOW() - INTERVAL '5 minutes'` matches expected count.

- [ ] **Unit 2: Filter directory-listing URLs out of the enrichment target list**

**Goal:** Serper budget stops being spent on `chamberofcommerce.com`, `superpages.com`, etc. 100-query runs produce ≥10 named-manager finds (baseline: current run produces 0).

**Requirements:** R2

**Dependencies:** Unit 1 must land first — otherwise Unit 2 improves the probe quality but the DB write still crashes.

**Files:**
- Modify: `tools/lead-hunter/hunt.py` — `enrich_facilities()` (lines 1352+) AND the `--enrich-only` SELECT (lines 1945-1956).

**Approach:**
- Add a module-level constant near other constants (~line 113): `DIRECTORY_LISTING_HOSTS = frozenset({"chamberofcommerce.com", "superpages.com", "dexknows.com", "angi.com", "alignable.com", "industrynet.com", "yellowpages.com", "yelp.com", "dnb.com", "zoominfo.com", "cortera.com", "machineshop.directory", "findingmfg.com"})`.
- Add helper `_is_directory_listing(website: str) -> bool` — parse domain, check against set.
- In `enrich_facilities()`, before the Serper-probe branch: skip with log if `_is_directory_listing(f.website)`. Still runs website scrape attempt (cheap, sometimes yields emails even from junk pages — fall back).
- In the `--enrich-only` SELECT: add `AND website NOT LIKE '%chamberofcommerce.com%' AND website NOT LIKE '%superpages.com%' ...` — OR simpler, filter the Python-side `fac_list` after fetching using the same helper.
- Python-side filter preferred: one source of truth for the blocklist.

**Test scenarios:**
- Happy path: facility with `website="https://coca-cola.com"` → probed normally.
- Filtered: facility with `website="https://www.superpages.com/..."` → skipped with log `"Skip directory listing: <name>"`.
- Edge: facility with `website=""` → still skipped by existing ICP-filter logic; no change.
- Edge: `website="https://foo.dexknows.com"` (subdomain) — blocklist uses domain suffix check so this is also skipped. Verified by parsing via `urlparse().netloc` then endswith-iterating the blocklist.
- Integration: run `hunt.py --enrich-only --enrich-budget 30 --dry-run` — dry-run output shows expected count AFTER filter, not before.

**Verification:**
- Re-run `--enrich-only --enrich-budget 100`. Check: `grep "Skip directory listing" output.log | wc -l` is non-zero; `grep "+ [0-9]* contact(s) from Serper probe" output.log` is higher than the previous 0.

- [ ] **Unit 3: Add `--reprobe-generic` mode to re-enrich facilities with only generic contacts**

**Goal:** Facilities like "Coca-Cola Bottling Lakeland" that have `info@coca-cola.com` from site-scraping can be re-probed for named managers (Warren Chandler etc.) without first manually deleting their contacts.

**Requirements:** R3

**Dependencies:** Units 1 + 2.

**Files:**
- Modify: `tools/lead-hunter/hunt.py` — add new CLI flag, new branch in main, reuse `enrich_facilities()`.

**Approach:**
- Add `parser.add_argument("--reprobe-generic", action="store_true", help="Re-probe facilities whose existing contacts lack a name (generic emails only)")`.
- New main branch (after the existing `--enrich-only` branch) — when `args.reprobe_generic` is set, run a modified SELECT that INCLUDES facilities with contacts if NONE of those contacts have a non-null `name`:
  ```sql
  SELECT ... FROM prospect_facilities f
  WHERE website IS NOT NULL AND website <> ''
    AND NOT EXISTS (SELECT 1 FROM prospect_contacts c WHERE c.facility_id = f.id AND c.name IS NOT NULL AND c.name <> '')
  ORDER BY icp_score DESC
  ```
- Apply the Unit-2 directory-listing filter to the resulting list.
- Pass to `enrich_facilities()` — existing contact-dedup inside the Serper probe (by name) handles merging: new named contacts get appended, generic `info@` contacts already present stay.
- The `upsert_facilities()` call at the end persists via the existing path.

**Test scenarios:**
- Happy path: Coca-Cola Bottling Lakeland has `info@coca-cola.com` but no named manager. `--reprobe-generic` includes it in the SELECT, Serper probes, appends Warren Chandler to contacts.
- Filtered: Florida Natural Growers already has Luciano Ferreira (named) — SELECT excludes it because it has a named contact.
- Edge: facility with 2 contacts, one named + one generic — EXISTS check sees the named one, excludes the facility (don't double-probe).
- Budget enforcement: `--reprobe-generic --enrich-budget 20` stops at 20 queries, same as `--enrich-only`.
- Empty result: all facilities have named contacts already → "Nothing to re-probe" log + clean exit.

**Verification:**
- Manual SQL sanity: `SELECT COUNT(*) FROM prospect_facilities f WHERE website IS NOT NULL AND website <> '' AND NOT EXISTS (SELECT 1 FROM prospect_contacts c WHERE c.facility_id = f.id AND c.name IS NOT NULL AND c.name <> '')` — matches the count reported by `--reprobe-generic`.
- Post-run: named-manager contact count for 2026-04-21's already-enriched facilities increases by ≥5 (hypothesis: 5 of the top-20 ICP facilities with generic emails will yield named managers via Serper).

## System-Wide Impact

- **Interaction graph:** `upsert_facilities()` is called from 3 main branches: discovery path (line ~2000), `--enrich-only` path (line 1999), and (after Unit 3) `--reprobe-generic` path. All three benefit from Unit 1.
- **Error propagation:** Unit 1 changes a crash-on-conflict into an update-on-conflict. No silent data loss — rows that previously failed now merge per the COALESCE rules at lines 932-936.
- **Unchanged invariants:** `prospect_contacts` INSERT logic (lines 962-968) is untouched; the 125 existing contact rows remain intact. `enrich_facilities()` core probe behavior unchanged — just gains a pre-filter.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unit 1 changes the ON CONFLICT target — could mask legitimate duplicates-with-different-address | Test scenario covers this: the conflict IS `(name, address)` which is the DB's actual unique key; it's WHAT the DB was going to enforce anyway. Prior code was just miscommunicating intent. |
| Unit 2 blocklist is incomplete — new aggregators (e.g., `buzzfile.com`, `opencorporates.com`) would still burn budget | Blocklist starts with 6 observed hosts; expandable. Log matched-for-skip entries so it's visible when a new aggregator shows up. |
| Unit 3's re-probe finds contacts we ALREADY have — duplicates | Existing `ON CONFLICT DO NOTHING` on contacts INSERT (line 964) handles this; de-dup is semantically correct (same (facility_id, name, title, email) = same contact). |
| Directory-listing rows remain in `prospect_facilities` and clutter reports | Deferred — data cleanup task. These fixes stop NEW budget waste; cleaning up legacy rows is a separate migration. |

## Execution Order

1. **Unit 1 (upsert fix)** — small, unblocks everything. Open PR immediately, merge when green.
2. **Unit 2 (directory-listing filter)** — builds on Unit 1. Open PR after #1 merges.
3. **Unit 3 (reprobe-generic)** — opens more budget spend; open PR after #2 merges so filtering protects the bigger run.

Do NOT stack all three in one branch — each is independently reviewable, and stacking maximizes blast radius if any one is wrong.

## Sources & References

- **Origin incident:** 2026-04-21 Charlie enrichment run, background task `bnr8t3fu2`, output archived at `~/.../tasks/bnr8t3fu2.output`. Key lines: `Enrichment complete — 100 Serper queries used (budget 100)` followed by `psycopg2.errors.UniqueViolation: duplicate key value violates unique constraint "prospect_facilities_name_address_key"` at `hunt.py:1463` → which calls `upsert_facilities()` at `hunt.py:1999`.
- **hunt.py current tip:** `6fd713d` on main after PR #483 merge (2026-04-21 23:41 UTC).
- **Related PR:** #456 (merged 2026-04-21) added the Serper probe that revealed these defects downstream.
- **Related memory:** `project_lead_hunter_state_2026_04_20.md` — 330 facilities discovered, 85 qualified, HubSpot token in place.
