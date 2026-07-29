# OEM Crawler → Retrieval Bridge (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OEM manual chunks the Bravo crawler ingests reachable by MIRA's grounded answering — route them to the shared OEM tenant pool, mark them trusted, and retro-fit the chunks already written to the wrong tenant.

**Architecture:** Three independent changes. (1) `mira-crawler/ingest/store.py` gains a `verified` parameter threaded through both write functions, defaulting to today's behavior. (2) Trust becomes a **per-crawler-class property** (`oem_trusted`) that `ManufacturerCrawler` opts into — `BaseCrawler.process()` branches on it to pick the tenant and the verified flag. (3) A one-time idempotent SQL seed moves the already-stored crawler rows from the garage tenant to the shared pool, applied staging-first through `apply-seeds.yml` (which needs a `target` input added — it is prod-only today).

**Tech Stack:** Python 3.12, `uv`, `ruff`, `pytest`, SQLAlchemy + NullPool against NeonDB (Postgres 16), GitHub Actions + Doppler.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-28-oem-crawler-retrieval-bridge-design.md` (PR #2982). This plan supersedes the spec where the two disagree — see "Corrections to the spec" below.
- **Python:** 3.12 target, `ruff check` + `ruff format --check` must pass (`.claude/rules/python-standards.md`).
- **Commits:** Conventional Commits, scope `crawler` / `ingest` / `ci` (`fix(crawler):`, `feat(ingest):`).
- **VERSION:** this PR touches shippable code → bump `/VERSION` and add a `docs/CHANGELOG.md` note. Base is `3.224.4`; feat → **`3.225.0`**. CI-enforced by `version-gate.yml`.
- **Never** `psql` prod. Seeds go staging → prod via `apply-seeds.yml` (`dry-run` then `apply`). `docs/environments.md`.
- **Never** `git add -A` — the shared checkout carries foreign WIP. Stage explicit paths (`.claude/rules/session-discipline.md` rule 3).
- **Worktree:** implement in an isolated worktree off `main`, not the primary checkout (which sits on `codex/dogfood-useful-work` with uncommitted foreign work).
- **No paid inference.** Nothing in this plan spends money.
- **Scope is SP1 only.** Do not touch `print_worker.py` or any PrintSense path — that is SP2, a separate spec.

## Decisions (the spec's three open questions, resolved against the code)

1. **Collision sweep → move-only.** The seed's `NOT EXISTS` guard keys on `(tenant_id, source_url, (metadata->>'chunk_index')::int)`, which is exactly the real unique index used by `ON CONFLICT` at `mira-crawler/ingest/store.py:113`. Skipped rows stay inert under the garage tenant as `verified = false`. Measure skippage in the staging dry-run; only sweep duplicates later if the count is meaningful.
2. **Trust scope → trust by crawler class, not by tier string.** `mira-crawler/crawler/manufacturer.py:71-78` *deliberately* searches every tier (including `5_reference`) when a specific manufacturer is named — that is the #2959 fix. Filtering trust to `3_manufacturer` would undo it. `ManufacturerCrawler` is the unit of trust; whatever it reaches through curated `sources.yaml` entries is OEM content.
3. **Shared-pool-only → confirmed correct.** Retrieval ORs the shared tenant in: `WHERE (tenant_id = :tid OR tenant_id = :shared_tid)` (`mira-bots/shared/neon_recall.py:385`, and `shared_tid` is bound on every stream — lines 428/526/643/915/1123/1216). The house bot reaches the shared pool anyway, so it loses nothing. No dual-write.

## Corrections to the spec (do NOT implement the spec verbatim)

- **Spec Unit 2c is wrong about where the flag goes.** It puts `verified=True` + `oem_tenant_id` at `base_crawler.py:151` — inside `BaseCrawler.process()`, which `CurriculumCrawler` and `CSVCrawler` both inherit (`csv_crawler.py:151` calls `super().process(...)`). As written it would auto-trust and re-tenant curriculum and CSV crawls too, which is wider than the Unit 1 doctrine allows. **Task 2 fixes this** with a class-level `oem_trusted` flag that only `ManufacturerCrawler` sets.
- **Spec Unit 3 assumes `apply-seeds.yml` can target staging. It cannot** — it hardcodes `--config prd` and `environment: production`. **Task 3 adds a `target` input**, mirroring `db-inspect.yml:14-20` and `apply-migrations.yml:23-29`, so the staging gate is real rather than aspirational.
- **Rollout order should be flipped.** The spec deploys the write-path change first, then backfills. Running the crawler against the shared pool *before* the backfill creates shared-pool copies of URLs already stored under the garage tenant, which the backfill's `NOT EXISTS` guard then skips — inflating orphan count. **Backfill first (Task 6), then deploy the code (Task 7).** The two are independent, so the reorder is free.
- **No knowledge-graph blast radius.** `BaseCrawler.process()` calls `store_chunks(...)` without `model_number`, so the KG branch in `store_chunks` (`if kg_writer is not None and manufacturer and model_number`) never fires on this path. Changing the tenant does **not** move `kg_entities` rows. Do not add KG handling.

---

### Task 1: Thread a `verified` flag through the store write path

Pure, default-preserving plumbing. No behavior changes for any existing caller.

**Files:**
- Modify: `mira-crawler/ingest/store.py` (`insert_chunk` ~line 62, the INSERT SQL ~line 103-116, `store_chunks` ~line 138)
- Test: `mira-crawler/tests/test_store_verified.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `insert_chunk(..., verified: bool = False) -> str` and `store_chunks(chunks_with_embeddings, tenant_id, manufacturer="", model_number="", image_embedding=None, verified=False) -> int`. Task 2 calls `store_chunks` with `verified=`.

- [ ] **Step 1: Write the failing test**

Create `mira-crawler/tests/test_store_verified.py`:

```python
"""The `verified` flag on the crawler write path (SP1 Unit 2b).

Zero real DB calls — the SQLAlchemy engine is faked so we can assert on the
exact bound parameters.
"""

from __future__ import annotations

import pytest
from ingest import store


class _FakeConn:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, _stmt, params):
        self.captured.update(params)

    def commit(self):
        pass


class _FakeEngine:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def connect(self):
        return _FakeConn(self.captured)


@pytest.fixture
def captured(monkeypatch) -> dict:
    box: dict = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
    return box


def test_insert_chunk_defaults_to_unverified(captured: dict) -> None:
    """Every existing caller keeps writing verified=false."""
    entry_id = store.insert_chunk(
        tenant_id="t1",
        content="x",
        embedding=[0.1],
        source_url="u",
        chunk_index=0,
    )
    assert entry_id
    assert captured["verified"] is False


def test_insert_chunk_binds_verified_true_when_asked(captured: dict) -> None:
    entry_id = store.insert_chunk(
        tenant_id="t1",
        content="x",
        embedding=[0.1],
        source_url="u",
        chunk_index=0,
        verified=True,
    )
    assert entry_id
    assert captured["verified"] is True


def test_store_chunks_passes_verified_through(monkeypatch) -> None:
    seen: dict = {}

    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

    def _fake_insert(**kwargs):
        seen.update(kwargs)
        return "entry-1"

    monkeypatch.setattr(store, "insert_chunk", _fake_insert)

    inserted = store.store_chunks(
        [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        manufacturer="AutomationDirect",
        verified=True,
    )
    assert inserted == 1
    assert seen["verified"] is True


def test_store_chunks_defaults_to_unverified(monkeypatch) -> None:
    seen: dict = {}

    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

    def _fake_insert(**kwargs):
        seen.update(kwargs)
        return "entry-1"

    monkeypatch.setattr(store, "insert_chunk", _fake_insert)

    store.store_chunks(
        [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
    )
    assert seen["verified"] is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_store_verified.py -v`
Expected: FAIL — `TypeError: insert_chunk() got an unexpected keyword argument 'verified'`, and `KeyError: 'verified'` on the default cases (the SQL binds a literal, not a param).

- [ ] **Step 3: Add the parameter to `insert_chunk`**

In `mira-crawler/ingest/store.py`, add `verified` as the last keyword parameter of `insert_chunk`:

```python
def insert_chunk(
    tenant_id: str,
    content: str,
    embedding: list[float],
    source_url: str = "",
    source_type: str = "equipment_manual",
    manufacturer: str = "",
    model_number: str = "",
    equipment_id: str = "",
    page_num: int | None = None,
    section: str = "",
    chunk_index: int = 0,
    chunk_type: str = "text",
    image_embedding: list[float] | None = None,
    verified: bool = False,
) -> str:
```

- [ ] **Step 4: Bind `verified` in the INSERT instead of the hardcoded literal**

In the same function, change the VALUES line (currently `cast(:metadata AS jsonb), false, false, :chunk_type,`) so only `is_private` stays a literal:

```python
                    VALUES
                        (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                         :content, cast(:embedding AS vector), :source_url, :source_page,
                         cast(:metadata AS jsonb), false, :verified, :chunk_type,
                         cast(:image_embedding AS vector))
```

and add the parameter to the bound dict, next to `"chunk_type"`:

```python
                    "chunk_type": chunk_type,
                    "verified": verified,
```

`is_private` stays hardcoded `false` — OEM content is public, and customer-upload privacy is governed by `.claude/rules/knowledge-entries-tenant-scoping.md`, which this change does not touch.

- [ ] **Step 5: Thread it through `store_chunks`**

Add the parameter to the signature:

```python
def store_chunks(
    chunks_with_embeddings: list[tuple[dict, list[float]]],
    tenant_id: str,
    manufacturer: str = "",
    model_number: str = "",
    image_embedding: list[float] | None = None,
    verified: bool = False,
) -> int:
```

and pass it in the `insert_chunk(...)` call inside the loop, after `image_embedding=image_embedding,`:

```python
            image_embedding=image_embedding,
            verified=verified,
        )
```

Add one line to the docstring under the existing text:

```
    verified: when True the chunk is written as trusted (citable while
    MIRA_ENFORCE_APPROVED_RETRIEVAL is on). Only OEM-trusted crawlers pass
    True — see .claude/rules/oem-crawler-trusted.md.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd mira-crawler && python -m pytest tests/test_store_verified.py -v`
Expected: 4 passed.

- [ ] **Step 7: Run the neighbouring suites to prove nothing regressed**

Run: `cd mira-crawler && python -m pytest tests/test_manufacturer_normalize.py tests/test_ingest.py tests/test_crawlers.py -q`
Expected: all pass, same counts as on `main`. If any of these are red on `main` too, note it — that is pre-existing, not yours (`.claude/rules/session-discipline.md` rule 2).

- [ ] **Step 8: Lint**

Run: `ruff check mira-crawler/ingest/store.py mira-crawler/tests/test_store_verified.py && ruff format --check mira-crawler/ingest/store.py mira-crawler/tests/test_store_verified.py`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add mira-crawler/ingest/store.py mira-crawler/tests/test_store_verified.py
git commit -m "feat(ingest): thread a verified flag through the crawler write path"
```

---

### Task 2: OEM crawls write to the shared pool as trusted

The behavior change, plus the doctrine rule it encodes. This is where the spec's defect gets fixed.

**Files:**
- Create: `.claude/rules/oem-crawler-trusted.md`
- Modify: `mira-crawler/config.py` (add `oem_tenant_id` after `mira_tenant_id`, ~line 19)
- Modify: `mira-crawler/crawler/base_crawler.py` (class attribute after line 28; the `store_chunks(...)` call at ~line 149)
- Modify: `mira-crawler/crawler/manufacturer.py` (class attribute on `ManufacturerCrawler`, ~line 25)
- Test: `mira-crawler/tests/test_oem_trust.py` (create)

**Interfaces:**
- Consumes: `store_chunks(..., verified=...)` from Task 1.
- Produces: `CrawlerConfig.oem_tenant_id: str`; `BaseCrawler.oem_trusted: bool = False`; `ManufacturerCrawler.oem_trusted = True`.

- [ ] **Step 1: Write the failing test**

Create `mira-crawler/tests/test_oem_trust.py`:

```python
"""OEM crawls land in the shared pool as trusted; nothing else changes.

SP1 Unit 2. The whole ingest pipeline is stubbed — no network, no DB, no Ollama.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from config import CrawlerConfig
from crawler import base_crawler
from crawler.curriculum import CurriculumCrawler
from crawler.manufacturer import ManufacturerCrawler

SHARED = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
GARAGE = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"


def _make_config(tmp_path: Path) -> CrawlerConfig:
    sources_file = tmp_path / "sources.yaml"
    sources_file.write_text(yaml.dump({"tiers": {}}))
    config = CrawlerConfig()
    config.cache_dir = tmp_path / "cache"
    config.dedup_db_path = tmp_path / "dedup.db"
    config.sources_file = sources_file
    config.rate_limit_sec = 0.0
    config.mira_tenant_id = GARAGE
    config.oem_tenant_id = SHARED
    return config


@pytest.fixture
def captured(monkeypatch) -> dict:
    """Stub the convert → chunk → embed → store pipeline, capture the store call."""
    box: dict = {}

    monkeypatch.setattr(
        base_crawler, "extract_from_html", lambda data, min_chars=0: [{"text": "block"}]
    )
    monkeypatch.setattr(
        base_crawler, "extract_from_pdf", lambda data, min_chars=0: [{"text": "block"}]
    )
    monkeypatch.setattr(
        base_crawler,
        "chunk_blocks",
        lambda blocks, **kwargs: [
            {"text": "chunk", "source_url": kwargs.get("source_url", "u"), "chunk_index": 0}
        ],
    )
    monkeypatch.setattr(
        base_crawler, "embed_batch", lambda chunks, **kwargs: [(chunks[0], [0.1])]
    )

    def _fake_store(
        valid,
        tenant_id,
        manufacturer="",
        model_number="",
        image_embedding=None,
        verified=False,
    ):
        box.update({"tenant_id": tenant_id, "verified": verified})
        return len(valid)

    monkeypatch.setattr(base_crawler, "store_chunks", _fake_store)
    return box


def _entry() -> dict:
    return {
        "format": "pdf",
        "source_type": "equipment_manual",
        "manufacturer": "AutomationDirect",
        "equipment_id": "",
    }


def test_manufacturer_crawl_writes_shared_pool_verified(tmp_path, captured) -> None:
    crawler = ManufacturerCrawler(_make_config(tmp_path))
    stored = crawler.process("https://example.com/gs20m.pdf", b"%PDF-1.4", _entry())

    assert stored == 1
    assert captured["tenant_id"] == SHARED
    assert captured["verified"] is True


def test_curriculum_crawl_is_unchanged(tmp_path, captured) -> None:
    """The inherited process() must NOT auto-trust non-OEM crawlers."""
    crawler = CurriculumCrawler(_make_config(tmp_path))
    stored = crawler.process("https://example.com/book.pdf", b"%PDF-1.4", _entry())

    assert stored == 1
    assert captured["tenant_id"] == GARAGE
    assert captured["verified"] is False


def test_base_crawler_defaults_to_untrusted() -> None:
    assert base_crawler.BaseCrawler.oem_trusted is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mira-crawler && python -m pytest tests/test_oem_trust.py -v`
Expected: FAIL — `AttributeError: 'CrawlerConfig' object has no attribute 'oem_tenant_id'` / `type object 'BaseCrawler' has no attribute 'oem_trusted'`.

- [ ] **Step 3: Add `oem_tenant_id` to the config**

In `mira-crawler/config.py`, immediately after the `mira_tenant_id` field:

```python
    # The shared OEM pool that retrieval actually reads
    # (mira-bots/shared/neon_recall.py binds it as :shared_tid on every stream).
    # Deliberately NOT mira_tenant_id: MIRA_TENANT_ID was repointed to the garage
    # bench tenant during the CV-101 work, and OEM crawls must not follow it.
    oem_tenant_id: str = field(
        default_factory=lambda: os.getenv(
            "MIRA_SHARED_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
        )
    )
```

- [ ] **Step 4: Add the trust flag to `BaseCrawler` and branch in `process()`**

In `mira-crawler/crawler/base_crawler.py`, add a class attribute directly under the `BaseCrawler` docstring:

```python
class BaseCrawler:
    """Abstract base for all crawlers."""

    #: OEM-trusted crawlers write to the shared OEM pool as verified content.
    #: Default False — only ManufacturerCrawler opts in. Subclasses that
    #: inherit process() (CurriculumCrawler, CSVCrawler) keep prior behavior.
    #: See .claude/rules/oem-crawler-trusted.md.
    oem_trusted: bool = False
```

Then replace the `# Store` block in `process()`:

```python
        # Store. OEM-trusted crawlers write to the shared pool as verified so the
        # content is citable with MIRA_ENFORCE_APPROVED_RETRIEVAL on; every other
        # crawler keeps its prior tenant and stays unverified.
        stored = store_chunks(
            valid,
            tenant_id=(
                self.config.oem_tenant_id
                if self.oem_trusted
                else self.config.mira_tenant_id
            ),
            manufacturer=manufacturer,
            verified=self.oem_trusted,
        )
```

- [ ] **Step 5: Opt `ManufacturerCrawler` in**

In `mira-crawler/crawler/manufacturer.py`, add the attribute under the class docstring:

```python
class ManufacturerCrawler(BaseCrawler):
    """Crawl manufacturer documentation portals."""

    #: Curated OEM sources — trusted by construction. The human gate is
    #: sources.yaml curation (#2961), not per-chunk review.
    oem_trusted = True
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd mira-crawler && python -m pytest tests/test_oem_trust.py -v`
Expected: 3 passed.

- [ ] **Step 7: Write the doctrine rule**

Create `.claude/rules/oem-crawler-trusted.md`:

```markdown
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
```

- [ ] **Step 8: Run the full crawler suite + lint**

Run: `cd mira-crawler && python -m pytest tests/ -q`
Expected: no new failures vs. `main`. Record any pre-existing reds explicitly.

Run: `ruff check mira-crawler/ .claude/ && ruff format --check mira-crawler/config.py mira-crawler/crawler/base_crawler.py mira-crawler/crawler/manufacturer.py mira-crawler/tests/test_oem_trust.py`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add .claude/rules/oem-crawler-trusted.md mira-crawler/config.py mira-crawler/crawler/base_crawler.py mira-crawler/crawler/manufacturer.py mira-crawler/tests/test_oem_trust.py
git commit -m "fix(crawler): OEM crawls write to the shared pool as trusted content"
```

---

### Task 3: Give `apply-seeds.yml` a staging target

Without this the staging gate in Task 5 cannot run — the workflow is prod-only today.

**Files:**
- Modify: `.github/workflows/apply-seeds.yml` (`inputs:` block ~line 15; the `environment:` line ~line 46; the Doppler resolve step ~line 71)

**Interfaces:**
- Consumes: nothing.
- Produces: a `target` workflow input with values `staging` | `prod`, default `staging`.

- [ ] **Step 1: Add the `target` input**

In `.github/workflows/apply-seeds.yml`, add as the **first** entry under `inputs:` (mirroring `db-inspect.yml:14-20`):

```yaml
      target:
        description: 'NeonDB target. staging = factorylm/stg, prod = factorylm/prd. Default staging — promote to prod only after staging is verified.'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - prod
```

- [ ] **Step 2: Make the environment gate follow the target**

Replace `environment: production` in the `apply` job with the `db-inspect.yml:30` pattern:

```yaml
    environment: ${{ inputs.target == 'prod' && 'production' || 'staging' }}
```

- [ ] **Step 3: Resolve the Doppler config from the target**

In the "Authenticate Doppler + resolve DATABASE_URL" step, replace the hardcoded `--config prd` line with:

```bash
          DOPPLER_CFG=$([ "${{ inputs.target }}" = "prod" ] && echo "prd" || echo "stg")
          echo "Doppler config: factorylm/${DOPPLER_CFG}"
          DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --project factorylm --config "${DOPPLER_CFG}" --plain)"
```

- [ ] **Step 4: Update the workflow header comment**

Change the second comment line from "against prod NeonDB" to:

```
# Manually-triggered workflow to apply tools/seeds/*.sql against staging or prod
# NeonDB. Default target is staging — promote to prod only after verifying.
```

- [ ] **Step 5: Lint the workflow**

Run: `actionlint .github/workflows/apply-seeds.yml`
Expected: no findings. (`actionlint` runs in `.githooks/pre-commit` for workflow files — a failure here blocks the commit anyway.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/apply-seeds.yml
git commit -m "ci(seeds): let apply-seeds target staging, not prod only"
```

---

### Task 4: The one-time backfill seed

**Files:**
- Create: `tools/seeds/backfill_oem_crawler_chunks.sql`

Do **not** add it to `tools/seeds/README.md` — that table lists tenant-scoped *demo* seeds only, and the sibling `backfill_verified_corpus.sql` is correctly absent from it too.

**Interfaces:**
- Consumes: the `target` input from Task 3 (for the staging apply in Task 5).
- Produces: a seed applied by basename `backfill_oem_crawler_chunks` — `apply-seeds.yml` resolves any `tools/seeds/<basename>.sql` that exists, so no allowlist edit is needed.

- [ ] **Step 1: Write the seed**

Create `tools/seeds/backfill_oem_crawler_chunks.sql`:

```sql
-- Move already-stored OEM crawler chunks into the shared pool and mark them trusted.
--
-- WHY: mira-crawler wrote chunks under config.mira_tenant_id (MIRA_TENANT_ID), which
-- was repointed to the garage/bench tenant during the CV-101 work. Retrieval reads the
-- shared OEM pool (MIRA_SHARED_TENANT_ID, mira-bots/shared/neon_recall.py), so those
-- chunks are invisible to customers and /quickstart. Separately they were written
-- verified=false, which MIRA_ENFORCE_APPROVED_RETRIEVAL filters out.
--
-- POLICY: .claude/rules/oem-crawler-trusted.md — curated OEM sources are trusted by
-- source; the human gate is sources.yaml curation (#2961), not per-chunk review.
-- This mirrors tools/seeds/backfill_verified_corpus.sql.
--
-- SAFETY: metadata->>'source' = 'mira_crawler' (stamped by ingest/store.py) is the
-- selector that keeps this off garage-native rows — CV-101 machine memory, live
-- Ignition rows, and customer uploads are untouched.
--
-- Idempotent and safe to re-run. STAGING FIRST (apply-seeds.yml target=staging,
-- mode=dry-run then apply), verify retrieval, then prod. Never psql prod.
--
-- Verify before/after:
--   SELECT tenant_id, verified, count(*) FROM knowledge_entries
--    WHERE metadata->>'source' = 'mira_crawler' GROUP BY 1,2 ORDER BY 3 DESC;

BEGIN;

UPDATE knowledge_entries ke
   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid,   -- MIRA_SHARED_TENANT_ID
       verified  = true
 WHERE ke.tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid  -- garage MIRA_TENANT_ID
   AND ke.metadata->>'source' = 'mira_crawler'
   -- Collision guard keyed on the real unique index used by ON CONFLICT in
   -- mira-crawler/ingest/store.py: (tenant_id, source_url, (metadata->>'chunk_index')::int).
   -- Rows that would collide stay under the garage tenant as inert verified=false
   -- duplicates; measure the skipped count before deciding whether to sweep them.
   AND NOT EXISTS (
     SELECT 1 FROM knowledge_entries dup
      WHERE dup.tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid
        AND dup.source_url = ke.source_url
        AND (dup.metadata->>'chunk_index')::int = (ke.metadata->>'chunk_index')::int
   );

COMMIT;
```

- [ ] **Step 2: Stand up an ephemeral Postgres to test it**

Run:

```bash
docker run --rm -d --name oem-seed-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
sleep 5
```

- [ ] **Step 3: Seed a deliberate mix and run the seed**

Run:

```bash
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE knowledge_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  source_url text,
  verified boolean NOT NULL DEFAULT false,
  metadata jsonb
);

-- 1. a garage crawler row that should MOVE
INSERT INTO knowledge_entries VALUES
  (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'https://oem/a.pdf', false,
   '{"source":"mira_crawler","chunk_index":0}');
-- 2. a garage crawler row that COLLIDES with an existing shared row → must stay
INSERT INTO knowledge_entries VALUES
  (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'https://oem/b.pdf', false,
   '{"source":"mira_crawler","chunk_index":0}');
INSERT INTO knowledge_entries VALUES
  (gen_random_uuid(), '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'https://oem/b.pdf', true,
   '{"source":"mira_crawler","chunk_index":0}');
-- 3. a garage-NATIVE row (CV-101 machine memory) → must be untouched
INSERT INTO knowledge_entries VALUES
  (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'https://garage/cv101', false,
   '{"source":"hub_upload","chunk_index":0}');
SQL

PGPASSWORD=test psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f tools/seeds/backfill_oem_crawler_chunks.sql
```

- [ ] **Step 4: Assert the outcome**

Run:

```bash
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -c \
  "SELECT source_url, tenant_id, verified, metadata->>'source' AS src FROM knowledge_entries ORDER BY source_url, tenant_id;"
```

Expected, exactly:
- `https://oem/a.pdf` → tenant `78917b56…`, `verified = t` (moved)
- `https://oem/b.pdf` → **two** rows: the original `78917b56…` `t`, and the garage `e88bd0e8…` `f` (collision skipped)
- `https://garage/cv101` → tenant `e88bd0e8…`, `verified = f` (untouched)

- [ ] **Step 5: Prove idempotency**

Run the seed a second time, then re-run the assertion query from Step 4.
Expected: byte-identical output — re-running changes nothing.

- [ ] **Step 6: Tear down**

Run: `docker rm -f oem-seed-test`

- [ ] **Step 7: Commit**

```bash
git add tools/seeds/backfill_oem_crawler_chunks.sql
git commit -m "feat(seeds): backfill orphaned OEM crawler chunks into the shared pool"
```

---

### Task 5: Version bump, changelog, and PR

**Files:**
- Modify: `VERSION`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Bump the version**

Set `VERSION` to `3.225.0` (feat → minor; base was `3.224.4`). Re-check `git show origin/main:VERSION` first — if `main` has moved past `3.224.4`, bump the minor from whatever is actually there.

- [ ] **Step 2: Add the changelog entry**

Add at the top of the current section of `docs/CHANGELOG.md`:

```markdown
### 3.225.0 — OEM crawler → retrieval bridge (SP1)

- `fix(crawler)`: OEM crawls write to the shared OEM pool (`MIRA_SHARED_TENANT_ID`) as
  `verified = true` instead of following the repointed `MIRA_TENANT_ID` (garage tenant)
  as unverified. Trust is a per-crawler-class property (`oem_trusted`) — only
  `ManufacturerCrawler` opts in; curriculum/CSV crawls are unchanged.
- `feat(ingest)`: `insert_chunk`/`store_chunks` take a `verified` flag (default `False`,
  every existing caller unchanged).
- `feat(seeds)`: `backfill_oem_crawler_chunks.sql` moves already-stored crawler chunks
  into the shared pool, with a collision guard on the real unique index.
- `ci(seeds)`: `apply-seeds.yml` can target staging, not just prod.
- Doctrine: `.claude/rules/oem-crawler-trusted.md`.
```

- [ ] **Step 3: Commit**

```bash
git add VERSION docs/CHANGELOG.md
git commit -m "chore(release): v3.225.0 — OEM crawler retrieval bridge"
```

- [ ] **Step 4: Push and open the PR**

Branch the work off `main` as `fix/oem-crawler-retrieval-bridge-sp1`, write the body to a scratchpad file first (heredocs into `gh` hang this shell), then:

```bash
git push -u origin fix/oem-crawler-retrieval-bridge-sp1
gh pr create --base main \
  --title "fix(crawler): OEM crawler to retrieval bridge (SP1)" \
  --body-file "$SCRATCH/oem_bridge_pr_body.md"
```

The PR body must state: the two gaps closed, the three resolved design decisions, the spec defect this plan corrects (`oem_trusted` per class, not in `process()` unconditionally), and that Task 6's seed has **not** been applied to prod yet.

- [ ] **Step 5: Poll CI to green**

Run: `gh pr checks <number> --watch`
Expected: green. `Version Bump Check` must pass — if it fails, `VERSION` did not change relative to `main`.

---

### Task 6: Apply the backfill (staging → prod) — operator, gated

Do this **before** Task 7, so the crawler does not create shared-pool copies the guard then skips. Requires a human with workflow-dispatch rights; the agent cannot mutate prod (`MIRA_ALLOW_PROD=1` is human-only).

- [ ] **Step 1: Read-only pre-count on staging**

Run `db-inspect.yml` with `target=staging` and the query:

```sql
SELECT tenant_id, verified, count(*) FROM knowledge_entries
 WHERE metadata->>'source' = 'mira_crawler' GROUP BY 1,2 ORDER BY 3 DESC;
```

Record the numbers — they are the before-half of the evidence.

- [ ] **Step 2: Staging dry-run**

`gh workflow run apply-seeds.yml -f target=staging -f seeds=backfill_oem_crawler_chunks -f mode=dry-run -f tenant_id=78917b56-f85f-43bb-9a08-1bb98a6cd6c3`

Read the pre-flight output in the step summary. Confirm the garage-tenant crawler row count matches Step 1.

- [ ] **Step 3: Staging apply, then re-count**

Same command with `mode=apply`. Re-run Step 1's query.
Expected: garage-tenant `mira_crawler` rows drop to the collision-skipped remainder; shared-tenant `verified = true` rows rise by the moved count. **Record the skipped count** — that is the input to the "do we sweep duplicates?" follow-up.

- [ ] **Step 4: Prove retrieval actually changed on staging**

Against the **staging** Neon branch, with the gate on, query as a **non-garage** tenant. `recall_knowledge` accepts `embedding=None` and falls through to the BM25/ILIKE streams, so this needs no Ollama:

```bash
cd mira-bots && doppler run --project factorylm --config stg -- python -c "
from shared.neon_recall import recall_knowledge
import os
os.environ['MIRA_ENFORCE_APPROVED_RETRIEVAL'] = 'true'
hits = recall_knowledge(
    embedding=None,
    tenant_id='00000000-0000-0000-0000-0000000000d1',  # demo tenant, NOT the garage
    limit=5,
    query_text='Siemens G120 fault F30001 overcurrent',
)
for h in hits:
    print(h.get('manufacturer'), '|', h.get('source_url'), '|', (h.get('content') or '')[:80])
print('HITS:', len(hits))
"
```

Expected: at least one hit whose `source_url` is a crawler-ingested OEM PDF. Run the identical command **before** Step 3's apply to capture the zero-hit baseline. This is the acceptance test for the whole sub-project — if it fails, stop and diagnose before touching prod.

- [ ] **Step 5: Prod dry-run, then apply**

Same two dispatches with `target=prod`. Re-run the count query via `db-inspect.yml target=prod`. Never `psql` prod directly.

---

### Task 7: Deploy the crawler change to Bravo — operator

- [ ] **Step 1: Update the live crawler checkout**

The production crawler runs from `~/mira-crawler-prod` on Bravo (a detached-HEAD worktree, currently at `1d58c8c6d`). Fast-forward it to the merged `main`:

```bash
ssh bravo-tailscale 'cd ~/mira-crawler-prod && git fetch origin --quiet && git status -s && git checkout --detach origin/main && git log --oneline -1'
```

`git status -s` must show only the known-untracked `mira-crawler/mira-crawler/` and `requirements-host.lock` — if anything else is dirty, stop and inspect before checking out.

- [ ] **Step 2: Restart the daemon**

The launch agent is `com.mira.crawler` (a watchdog, `com.mira.crawler-watchdog`, sits alongside it):

```bash
ssh bravo-tailscale 'launchctl unload ~/Library/LaunchAgents/com.mira.crawler.plist && sleep 2 && launchctl load ~/Library/LaunchAgents/com.mira.crawler.plist && launchctl list | grep com.mira.crawler'
```

Then confirm a fresh heartbeat (the `ts` must be newer than the restart):

```bash
ssh bravo-tailscale 'tail -3 ~/mira-crawler-prod/mira-crawler/data/job_heartbeat.jsonl'
```

- [ ] **Step 3: Verify the next crawl writes to the right place**

After the next scheduled manufacturer crawl, run the Step 1 count query from Task 6 against staging/prod as appropriate.
Expected: **new** rows appear under `78917b56…` with `verified = true`, and **zero** new `mira_crawler` rows appear under `e88bd0e8…`.

- [ ] **Step 4: Close the loop**

Update `wiki/hot.md` with the outcome and the recorded counts, and note in PR #2982 that SP1 shipped so SP2 (PrintSense manual grounding) can be specced.

---

## Deferred / explicitly out of scope

- **SP2 — PrintSense manual grounding.** `print_worker.py` is OCR-only and never calls `recall_knowledge`. Needs its own spec once SP1 is verified end-to-end.
- **Duplicate sweep.** A `DELETE` of collision-skipped garage rows, only if Task 6 Step 3 shows a meaningful count.
- **The `MIRA_TENANT_ID` naming problem.** The var still means "garage bench tenant" while its name suggests otherwise. Renaming it is a separate cleanup with its own blast radius.
- **#2968 mis-pagination remediation.** Tracked separately; do not fold in.
