# OEM Crawler → Retrieval Bridge — Design

**Date:** 2026-07-28
**Status:** IMPLEMENTED (SP1), PARTIAL — PR #2999, `fix/oem-crawler-retrieval-bridge-sp1`, green, awaiting merge. Units 1–2 shipped (with one correction). Unit 3 (the one-time backfill) was built, reviewed, and deliberately dropped — see "Status update (2026-07-29)" below.
**Author:** Claude Code session (Bravo)
**Related:** #2968 (corpus mis-pagination remediation), #2961 (OEM source-URL curation),
`tools/seeds/backfill_verified_corpus.sql` (the trusted-by-default OEM policy),
[[project_crawler_runtime_hardening]], [[project_kb_ingest_topology]]

---

## Status update (2026-07-29)

SP1 shipped as **PR #2999**. Units 1 and 2 below landed close to as designed, with
one correction: trust is scoped to the crawler *class*
(`BaseCrawler.oem_trusted: bool = False`, only `ManufacturerCrawler` sets it `True`),
not applied unconditionally inside `BaseCrawler.process()` as Unit 2c originally
specified — see the correction note on Unit 2c below.

**Unit 3, the one-time SQL backfill, was evaluated and deliberately dropped — it does
not ship.** The selector it relied on (`metadata->>'source' = 'mira_crawler'`, and the
more general shape-based selector considered during review,
`source_type = 'equipment_manual' AND manufacturer <> ''`) describes an output
**shape**, not an **origin**: three different writers can produce that shape
(`ManufacturerCrawler`, trusted; `CSVCrawler`, heuristic/untrusted;
`tasks/ingest.py::ingest_url`, untrusted), and no column stored by `insert_chunk`
records which one wrote a given row. That auditability gap — not document quality —
is why the backfill was pulled. Full reasoning trail, kept intact, is under
"Unit 3 — superseded" below.

**Read the rest of this document with that correction in mind** — the "Design —
three units" section, the data-flow diagram, the rollout sequence, and the open
questions were all written as if Unit 3 would ship. Each is annotated inline below
rather than rewritten, so the original design intent is not lost.

---

## Problem

The manufacturer crawler on Bravo started producing OEM manual chunks again on
2026-07-28 (the #2959/#2961 URL fixes broke a ~2-month `0 chunks/day` drought —
**7,114 chunks** ingested from Siemens G120, Rockwell PowerFlex, AutomationDirect).
But **none of that data is reachable by MIRA's retrieval**, for two independent
reasons discovered while tracing the write path against the read path:

### Gap 1 — Tenant misroute (the bigger one)

The crawler writes chunks under `config.mira_tenant_id`, sourced from the
`MIRA_TENANT_ID` env var. In prod today `MIRA_TENANT_ID = e88bd0e8-…`, which is
the **garage/bench dev tenant** (the CV-101 live-machine-memory work —
`docs/RESUME_2026-07-04_cv101-live-machine-memory.md`,
`docs/command-center-ignition-display.md`). Historically `MIRA_TENANT_ID` *was*
the shared OEM pool (`docs/AUDIT.md`, `docs/README.md` both show
`MIRA_TENANT_ID = 78917b56-…`); it was repointed to the garage tenant for the
live work, and the crawler silently followed.

The shared OEM pool that customers and the `/quickstart` path actually read is
**`MIRA_SHARED_TENANT_ID = 78917b56-…`**. Retrieval (`mira-bots/shared/neon_recall.py`)
matches `WHERE (tenant_id = :caller OR tenant_id = :shared_tid)` with
`shared_tid = 78917b56-…`. So:

- The **house Telegram/Slack bot** is built with `tenant_id = MIRA_TENANT_ID = e88bd0e8`
  (`mira-bots/telegram/bot.py:100`), so it *does* reach `e88bd0e8` — the tenant gap
  does **not** bite the default bot.
- **Customers and `/quickstart`** read `78917b56`, never `e88bd0e8` — so tonight's
  crawler output is invisible to the surfaces the product cares about (beta =
  "a stranger uploads a manual and gets a cited answer"; the OEM corpus must live
  in the shared pool).

The existing 83.5k OEM corpus is fine — it lives under `78917b56`. Only the *new*
crawler output drifted to `e88bd0e8`.

### Gap 2 — Approval gate

Independently, `mira-crawler/ingest/store.py` hardcodes `verified = false` on every
chunk, and prod has `MIRA_ENFORCE_APPROVED_RETRIEVAL = true`. When the gate is on,
`neon_recall._approval_filter_sql()` appends `AND verified = true` to all four
retrieval streams (vector/BM25/ILIKE/product). So even for the house-bot tenant,
`verified = false` chunks are filtered out of retrieval.

### Governing policy (already exists — this design makes it code)

`tools/seeds/backfill_verified_corpus.sql` (2026-06-27) already states the policy:
> The shared OEM knowledge library (the system tenant) is **trusted by default** —
> it is curated, public, OEM-sourced manual content. Mark it `verified = true`.
> Per-tenant **customer uploads** are NOT auto-approved; they stay `verified = false`
> until a human approves them in the Hub.

Curated OEM crawler output already passed a human gate: `sources.yaml` curation
(#2961). So per-chunk human review of OEM content would fight this doctrine. The
user's decision (2026-07-28): **trust by source — OEM-sourced crawler content is
fine to auto-trust.**

---

## Scope

This design is **SP1 of two sub-projects**. SP1 is foundational and unblocks SP2.

- **SP1 (this spec): Close the ingest→retrieval gaps.** Make crawler OEM data
  citable by MIRA's grounded answering (the diagnose/chat path that already uses
  `recall_knowledge`). Route to the shared pool + auto-trust OEM + backfill the
  already-stored chunks. *(As shipped: the route-to-shared-pool and auto-trust
  goals were met; the backfill goal was not — see "Status update (2026-07-29)"
  above and "Unit 3 — superseded" below.)*
- **SP2 (separate spec, depends on SP1): PrintSense manual grounding.** Wire the
  photo/print-reading vision path (`print_worker.py`) to consult + cite the (now
  reachable) manual corpus. Today that path is OCR-only by design and never calls
  `recall_knowledge`. **Out of scope here** — gets its own spec once SP1 lands and
  we've verified grounded answering cites the fresh manuals.

**Non-goals for SP1:**
- No change to the PrintSense vision worker (that's SP2).
- No new Hub review UI for OEM content (the trust rule replaces per-chunk review).
- No change to customer-upload approval (customer uploads correctly stay
  `verified = false` → Hub approval; this design touches only OEM crawler output).
- No rotation of the garage `MIRA_TENANT_ID` / no touching legit `e88bd0e8`
  garage-tenant data (CV-101 machine memory).
- Not folding in the #2968 mis-pagination remediation (separate, already tracked).

---

## Design — three units

### Unit 1 — The trust rule (doctrine)

New file `.claude/rules/oem-crawler-trusted.md`. States:

> Content crawled from a **curated OEM source in `mira-crawler/sources.yaml`**
> (manufacturer/reference tiers) is **trusted by default**: written to the shared
> OEM pool (`MIRA_SHARED_TENANT_ID`) with `verified = true`. The human gate is
> `sources.yaml` curation (#2961), not per-chunk review. Blog / patent / YouTube /
> customer-upload content is **not** OEM-trusted and does not get this treatment.

This is the single source of truth the code (Units 2–3) points at. It aligns with
`backfill_verified_corpus.sql` and `.claude/rules/knowledge-entries-tenant-scoping.md`
(the `is_private` + shared-tenant hybrid; OEM corpus is `is_private = false`,
shared-tenant, and now also `verified = true`).

**What it does:** define which crawler content is trusted.
**Interface:** referenced by Units 2 and 3; enforced by their tests.
**Depends on:** nothing.

### Unit 2 — Fix the crawler write path (going forward)

Files: `mira-crawler/config.py`, `mira-crawler/ingest/store.py`,
`mira-crawler/crawler/base_crawler.py`.

**2a. Decouple the OEM-write tenant from `MIRA_TENANT_ID`.**
Add a config field:
```python
# config.py
oem_tenant_id: str = field(
    default_factory=lambda: os.getenv(
        "MIRA_SHARED_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
    )
)
```
The manufacturer crawler writes OEM chunks under `config.oem_tenant_id`, **not**
`config.mira_tenant_id`. `mira_tenant_id` (the repurposed garage var) is no longer
the OEM-write target. Non-OEM tasks (blog/patents/youtube) are unchanged — out of
scope.

**2b. Thread a `verified` flag through the write path.**
`insert_chunk()` and `store_chunks()` gain `verified: bool = False` (default
preserves current behavior for every other caller). The SQL at `store.py`
(currently the hardcoded `… false, false, …` for `is_private, verified`) binds the
param instead of a literal for `verified`. `is_private` stays `false` (OEM is
public — unchanged).

**2c. The manufacturer crawler opts in.**
`base_crawler.py:151` (`store_chunks(valid, tenant_id=…, manufacturer=…)`) changes to:
```python
store_chunks(
    valid,
    tenant_id=self.config.oem_tenant_id,   # shared OEM pool, not garage
    manufacturer=manufacturer,
    verified=True,                          # OEM = trusted (Unit 1 rule)
)
```

> **Correction (2026-07-29):** as designed above, this puts `verified=True` +
> `oem_tenant_id` directly in `BaseCrawler.process()`, which `CurriculumCrawler` and
> `CSVCrawler` also inherit — as written it would have silently auto-trusted both.
> What shipped in PR #2999 instead: a class-level `BaseCrawler.oem_trusted: bool =
> False` flag, with `process()` branching on it, and only `ManufacturerCrawler`
> setting it `True`. Same outcome for the manufacturer crawler; no blast radius on
> the other crawlers.

**What it does:** new OEM crawls land citable in the shared pool.
**Interface:** `store_chunks(chunks, tenant_id, manufacturer, verified=False)`.
**Depends on:** Unit 1 (the rule it encodes).
**Verify:** a hermetic test asserting the manufacturer path writes
`tenant_id = MIRA_SHARED_TENANT_ID` and `verified = true`; a test that the default
`insert_chunk`/`store_chunks` call is byte-identical to prior behavior
(`verified = false`) so no other caller regresses.

### Unit 3 — One-time backfill of already-stored crawler chunks — SUPERSEDED, NOT SHIPPED

> **This unit was designed, implemented, and reviewed, then deliberately removed
> before PR #2999 merged.** It is preserved verbatim below — not deleted — because
> the design reasoning here, and the "two design points" the original reviewer was
> asked to weigh, are exactly what the rejection argument (added at the end of this
> section, "Why it was removed") responds to. Do not re-propose this seed without
> reading that argument first.

New gated seed `tools/seeds/backfill_oem_crawler_chunks.sql`, applied
dev → staging → prod via `apply-seeds.yml` (**never** psql prod). Idempotent.

Promote the crawler chunks currently orphaned under the garage tenant into the
shared pool + verified:
```sql
BEGIN;
UPDATE knowledge_entries ke
   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid,   -- MIRA_SHARED_TENANT_ID
       verified  = true
 WHERE ke.tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid  -- garage MIRA_TENANT_ID
   AND ke.metadata->>'source' = 'mira_crawler'                      -- crawler rows ONLY
   -- collision guard: don't move a row if the shared pool already has the
   -- same (source_url, chunk_index) — the unique key is
   -- (tenant_id, source_url, (metadata->>'chunk_index')::int).
   AND NOT EXISTS (
     SELECT 1 FROM knowledge_entries dup
      WHERE dup.tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid
        AND dup.source_url = ke.source_url
        AND (dup.metadata->>'chunk_index')::int = (ke.metadata->>'chunk_index')::int
   );
COMMIT;
-- Verify after: SELECT tenant_id, verified, count(*) FROM knowledge_entries
--   WHERE metadata->>'source' = 'mira_crawler' GROUP BY 1,2;
```

**Two design points the reviewer must weigh:**

1. **Collision handling.** The `NOT EXISTS` guard skips any crawler row whose
   `(source_url, chunk_index)` already exists in the shared pool (e.g. a manual
   crawled under both tenants historically). Skipped rows remain orphaned under
   `e88bd0e8` as `verified = false` — harmless duplicates. **Alternative:** a
   follow-up `DELETE` of the skipped garage-tenant duplicates to keep the table
   clean. Recommend: move first (this seed), sweep duplicates in a separate step
   only if a count shows meaningful skippage.

2. **`metadata->>'source' = 'mira_crawler'` is the safety selector.** `store.py:93`
   stamps `"source": "mira_crawler"` on every crawler chunk. This is what keeps the
   UPDATE from touching legit garage-tenant rows (CV-101 machine memory, live
   Ignition rows). Confirm on staging with a read-only `SELECT count(*) … WHERE
   tenant_id = e88bd0e8 AND metadata->>'source' = 'mira_crawler'` before apply.

**What it does:** makes the already-ingested 7,114 chunks (and any other orphaned
crawler rows) citable.
**Interface:** a gated workflow-applied SQL seed.
**Depends on:** nothing at code level; conceptually pairs with Unit 2 (Unit 2 stops
the bleed, Unit 3 cleans up what already bled).
**Verify:** staging apply → read-only `GROUP BY tenant_id, verified` before/after →
a grounded-answer eval on a Siemens G120 / PowerFlex question returns a cited chunk
that didn't retrieve before.

#### Why it was removed (added 2026-07-29)

Both safety selectors above — `metadata->>'source' = 'mira_crawler'` here, and the
more general `source_type = 'equipment_manual' AND manufacturer <> ''` considered
during implementation review — describe an output **shape**, not an **origin**.
Three different writers can produce that shape: `ManufacturerCrawler` (trusted,
Units 1–2), `CSVCrawler` (heuristic PDF resolution, untrusted), and
`tasks/ingest.py::ingest_url` (untrusted). **No column stored by `insert_chunk`
records which of the three wrote a given row** — `metadata->>'source'` reflects which
code path ran, not whether the URL it resolved was actually a legitimate OEM manual,
so a selector on it cannot tell "the manufacturer crawler found this" apart from "a
heuristic guessed this looks like a manual."

An audit found only 10 of 311 `CSVCrawler` rows were ever ingested, and all 10
re-verified as live, valid PDFs from legitimate sources (zero third-party
aggregators) — so this was not a document-quality problem. It was an
**auditability** problem: for portal-scraped rows the crawler never persists the
resolved PDF URL, so what was actually ingested cannot be confirmed after the fact,
for any row a future promotion might touch. A one-time `UPDATE` that promotes rows
to `verified = true` across a tenant boundary by selecting on shape, with no way to
verify after the fact which rows came from a trusted writer, is exactly the pattern
Contract 7 (`tests/test_architecture.py`) now exists to reject — its bad fixture is
this seed's SQL, recovered verbatim from git.

**What shipped instead of the backfill:**
- Enforcement: class-scoped trust assertions (`mira-crawler/tests/test_oem_trust.py`)
  and the Contract 7 guard described above.
- A `sources.yaml` well-formedness guard.
- **Re-acquisition, not reclassification.** 4 OEM manuals — Interroll MultiControl,
  Demag, Magnetek Impulse G+ Mini, Allen-Bradley 100-C30 — added to
  `mira-crawler/sources.yaml` so the *trusted* crawler fetches them properly, instead
  of retroactively blessing rows a heuristic crawler already wrote. 28 of 33
  URL-bearing candidates considered were excluded: distributor/reseller hosts, portal
  roots, unreachable/bot-blocked hosts, and dynamic document-ID endpoints (Siemens,
  Yaskawa — they resolve today but are not durable addresses).
- Follow-up issue #3000: a periodic corpus-health check, deliberately an opt-in
  script, never a required CI gate.

**Still open — not fixed by SP1:**
- The already-orphaned chunks under the garage tenant remain unreachable. Nothing
  rescues them; this is the direct, accepted cost of not shipping an unauditable
  promotion.
- `tasks/ingest.py::ingest_url` still writes OEM manuals to the garage tenant
  unverified — the third untrusted writer named above is unchanged by SP1.
- Issue #2989 tracks the unsanitized path input in the seed-applying workflows,
  surfaced during this same review; it is orthogonal to this design and tracked
  separately.

---

## Data flow (after SP1)

```
sources.yaml (curated OEM, human-gated #2961)
   │
   ▼
ManufacturerCrawler.discover_urls → fetch → chunk → embed
   │  (base_crawler.py)
   ▼
store_chunks(tenant_id = MIRA_SHARED_TENANT_ID, verified = True)   ← Unit 2
   │
   ▼
knowledge_entries  (tenant_id = 78917b56, is_private = false, verified = true)
   │
   ▼
recall_knowledge  WHERE (tenant_id = caller OR tenant_id = 78917b56)
                    AND verified = true            ← gate satisfied
   │
   ▼
grounded answer with citation   ← customers + quickstart + house bot all reach it
```

**Not shipped:** the diagram above is the terminal state for *newly crawled* chunks
(Unit 2, live). The sentence that originally closed this section — "Unit 3
retro-fits the already-stored rows into the same terminal state" — does not hold;
Unit 3 was dropped (see "Unit 3 — superseded" above), and the already-orphaned rows
stay orphaned. The re-acquisition sources added to `sources.yaml` produce genuinely
new crawler rows that flow through this diagram normally — they are not retro-fits
of old rows.

---

## Error handling / safety

- **Idempotency:** ~~Unit 3 re-runnable (the `NOT EXISTS` guard + `verified` already
  true → no-op on re-apply).~~ Moot — Unit 3 was not shipped. Unit 2 default args
  preserve every non-OEM caller.
- **Blast radius:** Unit 2 changes only the manufacturer crawl path; other
  `insert_chunk` callers (blog/patents/youtube/full_ingest_pipeline) keep
  `verified = False` default. ~~Unit 3 touches only `metadata->>'source' =
  'mira_crawler'` rows under the garage tenant — never customer or garage-native
  data.~~ Moot — Unit 3 was not shipped; no rows were touched.
- **Env boundary:** ~~Unit 3 goes dev → staging → prod via `apply-seeds.yml`. No psql
  prod (`docs/environments.md`, prod-guard). Verify retrieval on staging with the
  gate ON before prod.~~ N/A — no seed shipped. The env-boundary discipline this
  point describes was still honored: `apply-seeds.yml` gained a real staging target
  (kept, see the plan's Task 3), even though nothing was applied through it for this
  design.
- **No secret in code:** tenant UUIDs are non-secret identifiers (already in docs +
  the existing backfill seed); the crawler reads `MIRA_SHARED_TENANT_ID` from
  Doppler with a documented default.

---

## Testing

- **Unit 2:** hermetic pytest — manufacturer path writes `tenant_id =
  MIRA_SHARED_TENANT_ID` + `verified = true`; default `insert_chunk`/`store_chunks`
  unchanged (`verified = false`); non-OEM callers untouched.
- **Unit 3 (superseded — not shipped):** apply on ephemeral `postgres:16` with a
  seeded mix (garage crawler rows + a colliding shared-pool row + a garage-native
  non-crawler row) → assert only crawler rows move, the collision is skipped,
  garage-native row untouched. This is the test plan that was written for the seed
  before it was dropped; kept for the reasoning trail. See "Unit 3 — superseded"
  above.
- **End-to-end (staging):** with `MIRA_ENFORCE_APPROVED_RETRIEVAL = true`, a
  `recall_knowledge` query for a Siemens G120 / PowerFlex 525 topic returns a
  crawler-sourced chunk that returned zero before the change.

---

## Rollout

> **Actual rollout (2026-07-29):** steps 1, 2, and 4 shipped as designed. Step 3 (the
> Unit 3 seed) did not run — Unit 3 was dropped, see "Unit 3 — superseded" above.
> Step 4's "fresh manual" now comes from the re-acquisition sources added to
> `sources.yaml`, not from a backfilled historical chunk.

1. Unit 1 rule + Unit 2 code + Unit 2 tests → PR → CI green → merge (stops the bleed).
2. Deploy the crawler change to the Bravo daemon (unload/load, per
   [[project_crawler_runtime_hardening]]); verify next nightly crawl writes to
   `78917b56` + `verified = true` via a read-only staging check.
3. ~~Unit 3 seed → apply staging → verify retrieval → apply prod via `apply-seeds.yml`.~~
   **Dropped — not executed.** See "Unit 3 — superseded" above.
4. Spot-check a grounded answer cites a fresh manual (from the re-acquired
   `sources.yaml` entries, not a backfill). Then open SP2 (PrintSense manual
   grounding).

---

## Open questions for reviewer

### Resolved (2026-07-29) — see PR #2999

1. **Collision sweep:** moot. Unit 3, the backfill this question was about, did not
   ship (see "Unit 3 — superseded" above). No rows were ever moved, so there is
   nothing to sweep duplicates from.
2. **Trust scope:** resolved as **trust by crawler class, not by tier string.**
   `BaseCrawler.oem_trusted: bool = False`; only `ManufacturerCrawler` sets it
   `True`. This also fixed a real defect in the original Unit 2c design (see the
   correction note there): putting `verified=True` unconditionally in
   `BaseCrawler.process()` would have silently auto-trusted `CurriculumCrawler` and
   `CSVCrawler`, which both inherit `process()`. The class-level flag is correct
   whether `ManufacturerCrawler` reaches `3_manufacturer` alone or additionally
   `5_reference` when a specific manufacturer is named (#2959) — trust follows the
   crawler, not the tier it happens to search, so scoping to one tier was never the
   right axis.
3. **Shared-pool-only:** confirmed correct. Retrieval ORs the shared tenant in on
   every stream (`mira-bots/shared/neon_recall.py`,
   `WHERE (tenant_id = :tid OR tenant_id = :shared_tid)`, `shared_tid` bound on all
   four streams), so the house bot reaches `78917b56` regardless of the crawler's
   write target and loses nothing. No dual-write was added.

### Original questions (preserved for context)

1. **Collision sweep:** move-only (leave skipped garage duplicates as inert
   `verified = false`) vs. move-then-delete-duplicates? (Recommend move-only first,
   measure skippage.)
2. **Trust scope:** manufacturer tier only, or manufacturer **and** reference tiers
   in `sources.yaml`? (This spec assumes both OEM tiers via `base_crawler`; confirm
   base_crawler is used by reference-tier crawls too, or scope to manufacturer.)
3. **Should the crawler ALSO keep a copy under the garage tenant** for the house
   bot's live-machine-memory context, or is shared-pool-only correct? (This spec
   says shared-pool-only — the house bot reaches `78917b56` via `shared_tid`, so it
   loses nothing.)
