# Lead-Hunter Hardening Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the reliability gaps that the 2026-04-24 lead-hunter hardening (`2a7d68b`) exposed but did not fix — full test coverage on `hardening.py`, retry coverage on the discovery HTTP loop, partial-failure detection, Celery-path uniformity, and alerting that survives a reboot.

**Architecture:** Two layers of change. First, characterization tests for `tools/lead-hunter/hardening.py` so we can refactor with confidence (currently zero tests). Second, behavioral fixes in `celery_tasks.py` and `run_hourly.py` to extend the hardening's reach: discovery HTTP retries, partial-failure surface, single-conn DB lifecycle, Celery-path delegation to `run_hourly.main()`, persistent alert log, and a new env-var docs row.

**Tech Stack:** Python 3.12, pytest, httpx, psycopg2, Celery (mira-crawler app), launchd / Celery Beat scheduler.

**Out of scope (separate PRs):** psycopg2 connection pooling, splitting the mega-branch into smaller PRs, Discord webhook unit tests requiring live network.

---

## File Structure

| File | Role | Status |
|---|---|---|
| `tests/lead_hunter/test_hardening.py` | Unit tests for all hardening primitives | **Create** |
| `tests/lead_hunter/test_run_hourly.py` | Tests for silent-zero detectors and exit codes | **Create** |
| `tools/lead-hunter/hardening.py` | Default alert log path; minor doc | Modify (small) |
| `tools/lead-hunter/celery_tasks.py` | Discovery retries, partial-failure surface, conn lifecycle, schema as step, Celery → `main()` | Modify (substantial) |
| `tools/lead-hunter/run_hourly.py` | Wire schema-step + partial-failure detector | Modify |
| `docs/env-vars.md` | Document `DISCORD_ALERT_WEBHOOK`, `HARDENING_ALERT_LOG`, `HARDENING_LOCK_DIR`, `LEAD_HUNTER_TIMEOUT_SECS` | Modify |

Each task ends with a `git commit` step. Every commit is independently green (tests pass at HEAD).

---

## Task 1: Bootstrap test file + singleton_lock characterization tests

**Files:**
- Create: `tests/lead_hunter/test_hardening.py`

- [ ] **Step 1: Write the test file scaffold + singleton_lock tests**

```python
# tests/lead_hunter/test_hardening.py
"""Characterization tests for tools/lead-hunter/hardening.py.

The module already ships in production; these tests pin its current behavior
so subsequent refactors are safe.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


# ---------------- singleton_lock ----------------

def test_singleton_lock_first_acquires(tmp_path):
    from hardening import singleton_lock
    with singleton_lock("test-lh-1", lock_dir=tmp_path):
        assert (tmp_path / ".test-lh-1.lock").exists()
    # Lock file removed on exit
    assert not (tmp_path / ".test-lh-1.lock").exists()


def test_singleton_lock_second_invocation_exits_zero(tmp_path):
    """A second process holding the same lock must exit cleanly with code 0."""
    from hardening import singleton_lock

    # Hold the lock in this process; spawn a child that tries to acquire it.
    with singleton_lock("test-lh-2", lock_dir=tmp_path):
        helper = tmp_path / "child.py"
        helper.write_text(
            "import sys\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parents[2] / 'tools' / 'lead-hunter')!r})\n"
            "from hardening import singleton_lock\n"
            f"with singleton_lock('test-lh-2', lock_dir={str(tmp_path)!r}):\n"
            "    pass\n"
        )
        result = subprocess.run([sys.executable, str(helper)], capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr.decode()


def test_singleton_lock_releases_on_exception(tmp_path):
    from hardening import singleton_lock
    with pytest.raises(RuntimeError):
        with singleton_lock("test-lh-3", lock_dir=tmp_path):
            raise RuntimeError("boom")
    # Lock file gone even after exception
    assert not (tmp_path / ".test-lh-3.lock").exists()
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/bravonode/Mira && python3.12 -m pytest tests/lead_hunter/test_hardening.py -v`
Expected: 3 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/lead_hunter/test_hardening.py
git commit -m "test(lead-hunter): characterization tests for singleton_lock"
```

---

## Task 2: with_retries characterization tests

**Files:**
- Modify: `tests/lead_hunter/test_hardening.py`

- [ ] **Step 1: Append with_retries tests**

```python
# Append to tests/lead_hunter/test_hardening.py

# ---------------- with_retries ----------------

def test_with_retries_returns_value_on_first_success():
    from hardening import with_retries
    calls = []
    def fn():
        calls.append(1)
        return "ok"
    assert with_retries(fn, name="t", retries=3) == "ok"
    assert calls == [1]


def test_with_retries_retries_then_succeeds(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    monkeypatch.setattr("hardening.random.uniform", lambda a, b: 1.0)
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("transient")
        return "ok"
    assert with_retries(fn, name="t", retries=3, retry_on=(ConnectionError,)) == "ok"
    assert calls["n"] == 3


def test_with_retries_exhausts_and_raises_last(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    monkeypatch.setattr("hardening.random.uniform", lambda a, b: 1.0)
    def fn():
        raise ConnectionError("always fails")
    with pytest.raises(ConnectionError, match="always fails"):
        with_retries(fn, name="t", retries=2, retry_on=(ConnectionError,))


def test_with_retries_does_not_retry_give_up_class(monkeypatch):
    from hardening import with_retries
    monkeypatch.setattr("hardening.time.sleep", lambda s: None)
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        raise KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        with_retries(fn, name="t", retries=5)
    assert calls["n"] == 1  # No retry on KeyboardInterrupt


def test_with_retries_does_not_retry_unlisted_exception(monkeypatch):
    from hardening import with_retries
    calls = {"n": 0}
    def fn():
        calls["n"] += 1
        raise ValueError("not in retry_on")
    with pytest.raises(ValueError):
        with_retries(fn, name="t", retries=3, retry_on=(ConnectionError,))
    assert calls["n"] == 1
```

- [ ] **Step 2: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/test_hardening.py -v`
Expected: 8 PASS (3 from Task 1 + 5 new)

- [ ] **Step 3: Commit**

```bash
git add tests/lead_hunter/test_hardening.py
git commit -m "test(lead-hunter): with_retries retry/give-up semantics"
```

---

## Task 3: hard_timeout + preflight_secrets tests

**Files:**
- Modify: `tests/lead_hunter/test_hardening.py`

- [ ] **Step 1: Append tests**

```python
# Append to tests/lead_hunter/test_hardening.py
import signal as _signal

# ---------------- hard_timeout ----------------

@pytest.mark.skipif(not hasattr(_signal, "SIGALRM"), reason="SIGALRM unavailable on this platform")
def test_hard_timeout_raises_after_expiry():
    from hardening import hard_timeout
    with pytest.raises(TimeoutError):
        with hard_timeout(1):
            time.sleep(2)


def test_hard_timeout_clears_on_normal_exit():
    from hardening import hard_timeout
    with hard_timeout(5):
        pass
    # Subsequent sleep must not get interrupted
    time.sleep(0.05)


# ---------------- preflight_secrets ----------------

def test_preflight_secrets_returns_map(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.setenv("PRESENT_REQ", "value")
    monkeypatch.setenv("PRESENT_OPT", "value")
    monkeypatch.delenv("MISSING_OPT", raising=False)
    m = preflight_secrets(["PRESENT_REQ"], ["PRESENT_OPT", "MISSING_OPT"])
    assert m == {"PRESENT_REQ": True, "PRESENT_OPT": True, "MISSING_OPT": False}


def test_preflight_secrets_exits_2_on_missing_required(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.delenv("REQUIRED_X", raising=False)
    with pytest.raises(SystemExit) as exc_info:
        preflight_secrets(["REQUIRED_X"])
    assert exc_info.value.code == 2


def test_preflight_secrets_treats_blank_as_missing(monkeypatch):
    from hardening import preflight_secrets
    monkeypatch.setenv("BLANK_REQ", "   ")
    with pytest.raises(SystemExit) as exc_info:
        preflight_secrets(["BLANK_REQ"])
    assert exc_info.value.code == 2
```

- [ ] **Step 2: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/test_hardening.py -v`
Expected: 13 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/lead_hunter/test_hardening.py
git commit -m "test(lead-hunter): hard_timeout + preflight_secrets coverage"
```

---

## Task 4: RunReport + alert tests

**Files:**
- Modify: `tests/lead_hunter/test_hardening.py`

- [ ] **Step 1: Append tests**

```python
# Append to tests/lead_hunter/test_hardening.py

# ---------------- RunReport ----------------

def test_runreport_step_ok_path():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a") as step:
        step.detail["x"] = 1
    r.finalize()
    assert r.steps[0].status == "ok"
    assert r.steps[0].detail == {"x": 1}
    assert r.overall == "ok"
    assert r.is_healthy()


def test_runreport_step_fail_swallows_exception_and_marks_overall():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        raise ValueError("kaboom")
    r.finalize()
    assert r.steps[0].status == "fail"
    assert "ValueError: kaboom" in r.steps[0].error
    assert r.overall == "fail"
    assert not r.is_healthy()


def test_runreport_skip_marks_degraded():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a") as step:
        step.status = "skip"
        step.detail["reason"] = "no data"
    r.finalize()
    assert r.overall == "degraded"


def test_runreport_alert_marks_degraded():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.add_alert("something is sus")
    r.finalize()
    assert r.overall == "degraded"
    assert r.alerts == ["something is sus"]


def test_runreport_to_json_is_valid():
    from hardening import RunReport
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.finalize()
    parsed = json.loads(r.to_json())
    assert parsed["routine"] == "t"
    assert parsed["overall"] == "ok"
    assert len(parsed["steps"]) == 1


# ---------------- alert() ----------------

def test_alert_noop_on_healthy(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    assert not log_path.exists()


def test_alert_appends_jsonl_on_failure(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        raise RuntimeError("nope")
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    line = log_path.read_text().strip()
    parsed = json.loads(line)
    assert parsed["routine"] == "t"
    assert parsed["overall"] == "fail"


def test_alert_appends_jsonl_on_degraded(tmp_path, monkeypatch):
    from hardening import RunReport, alert
    monkeypatch.delenv("DISCORD_ALERT_WEBHOOK", raising=False)
    r = RunReport(routine="t")
    with r.step("a"):
        pass
    r.add_alert("partial failure")
    r.finalize()
    log_path = tmp_path / "alerts.jsonl"
    alert(r, alert_log=log_path)
    assert log_path.exists()
    parsed = json.loads(log_path.read_text().strip())
    assert parsed["overall"] == "degraded"
    assert parsed["alerts"] == ["partial failure"]
```

- [ ] **Step 2: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/test_hardening.py -v`
Expected: 21 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/lead_hunter/test_hardening.py
git commit -m "test(lead-hunter): RunReport + alert() coverage"
```

---

## Task 5: Wrap discovery HTTP loop in with_retries

The discovery loop in `celery_tasks.py:114-156` makes ~120 HTTPS requests with no retry — a transient blip kills the run. Only DB and HubSpot got retries. Discovery is the *biggest* request volume so it's where retries help most.

**Files:**
- Modify: `tools/lead-hunter/celery_tasks.py:114-156`
- Test: `tests/lead_hunter/test_celery_tasks.py` (Create)

- [ ] **Step 1: Write the failing test**

Create `tests/lead_hunter/test_celery_tasks.py`:

```python
"""Tests that retries cover the discovery HTTP loop, not just DB/HubSpot."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest


def test_discovery_msca_call_uses_with_retries(monkeypatch):
    """scrape_msca should be invoked through hardening.with_retries.

    Implementation detail: we patch hardening.with_retries and assert
    the discovery code calls it with name='scrape_msca'.
    """
    import celery_tasks

    calls = []

    def fake_with_retries(fn, *, name, **kw):
        calls.append(name)
        # Don't actually run fn — we're only checking the call shape
        return []

    monkeypatch.setattr("celery_tasks.with_retries", fake_with_retries, raising=False)
    # Patch out everything else so the function returns quickly
    monkeypatch.setattr("celery_tasks._load_state", lambda: {
        "city_index": 0, "requests_today": 0, "last_date": "", "total_discovered": 0,
    })
    monkeypatch.setattr("celery_tasks._save_state", lambda s: None)
    monkeypatch.setattr("celery_tasks._check_daily_budget", lambda s: True)
    monkeypatch.setenv("NEON_DATABASE_URL", "")
    monkeypatch.setenv("HUNTER_API_KEY", "")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "")

    import hunt as hunt_mod
    monkeypatch.setattr(hunt_mod, "CITIES", [("TestCity", 0.0, 0.0, 10)])
    monkeypatch.setattr(hunt_mod, "QUERY_TEMPLATES", [])
    monkeypatch.setattr(hunt_mod, "apply_schema", lambda *a, **k: None)
    monkeypatch.setattr(hunt_mod, "RATE_LIMIT_SECS", 0)

    import discover as discover_mod
    monkeypatch.setattr(discover_mod, "MEDIUM_BIZ_QUERIES", [])
    monkeypatch.setattr(discover_mod, "search_ddg_medium",
                        lambda *a, **k: ([], None))

    celery_tasks.run_discover_and_enrich()
    assert "scrape_msca" in calls, f"Expected scrape_msca to be wrapped; got {calls}"
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `python3.12 -m pytest tests/lead_hunter/test_celery_tasks.py::test_discovery_msca_call_uses_with_retries -v`
Expected: FAIL — scrape_msca is not currently wrapped in with_retries.

- [ ] **Step 3: Add the wrapper at top of celery_tasks.py**

In `tools/lead-hunter/celery_tasks.py`, add after the existing imports (around line 32):

```python
import httpx
from hardening import with_retries

# Exception classes that justify retrying a discovery HTTP call
_HTTP_RETRY = (
    httpx.TransportError,   # connect / read timeouts, network errors
    httpx.HTTPStatusError,  # 5xx if .raise_for_status() is called
    ConnectionError,
    TimeoutError,
)
```

Then change line ~114 (the MSCA block) from:

```python
    if city_idx == 0:
        log.info("Running MSCA directory scrape...")
        with httpx.Client(timeout=20) as client:
            msca_facs = discover.scrape_msca(client)
            requests_used += 1
```

to:

```python
    if city_idx == 0:
        log.info("Running MSCA directory scrape...")
        with httpx.Client(timeout=20) as client:
            try:
                msca_facs = with_retries(
                    lambda: discover.scrape_msca(client),
                    name="scrape_msca",
                    retries=2,
                    backoff=3.0,
                    retry_on=_HTTP_RETRY,
                )
            except Exception as e:
                log.warning("scrape_msca failed after retries: %s", e)
                msca_facs = []
            requests_used += 1
```

- [ ] **Step 4: Run test, verify PASS**

Run: `python3.12 -m pytest tests/lead_hunter/test_celery_tasks.py::test_discovery_msca_call_uses_with_retries -v`
Expected: PASS

- [ ] **Step 5: Add a similar wrapper around the standard DDG loop**

In `celery_tasks.py`, find `for qt in hunt.QUERY_TEMPLATES:` block (around line 138) and replace `results = discover._ddg_search(query, client)` with:

```python
                try:
                    results = with_retries(
                        lambda: discover._ddg_search(query, client),
                        name=f"ddg_search:{qt[:20]}",
                        retries=1,  # discovery loop already absorbs single fails via ddg_fails
                        backoff=2.0,
                        retry_on=_HTTP_RETRY,
                    )
                except Exception as e:
                    log.warning("ddg_search retry exhausted (%s): %s", qt[:30], e)
                    results = None
```

(`_ddg_search` already returns `None` on failure today; this just adds 1 retry on transient errors before falling through to the existing `ddg_fails` counter.)

- [ ] **Step 6: Add test for the DDG loop wrapper**

Append to `tests/lead_hunter/test_celery_tasks.py`:

```python
def test_discovery_ddg_search_uses_with_retries(monkeypatch):
    import celery_tasks
    import hunt as hunt_mod
    import discover as discover_mod

    calls = []
    def fake_with_retries(fn, *, name, **kw):
        calls.append(name)
        return None

    monkeypatch.setattr("celery_tasks.with_retries", fake_with_retries, raising=False)
    monkeypatch.setattr("celery_tasks._load_state", lambda: {
        "city_index": 1, "requests_today": 0, "last_date": "", "total_discovered": 0,
    })
    monkeypatch.setattr("celery_tasks._save_state", lambda s: None)
    monkeypatch.setattr("celery_tasks._check_daily_budget", lambda s: True)
    monkeypatch.setenv("NEON_DATABASE_URL", "")
    monkeypatch.setenv("HUNTER_API_KEY", "")
    monkeypatch.setenv("HUBSPOT_ACCESS_TOKEN", "")

    monkeypatch.setattr(hunt_mod, "CITIES", [("CityA", 0.0, 0.0, 10), ("CityB", 1.0, 1.0, 10)])
    monkeypatch.setattr(hunt_mod, "QUERY_TEMPLATES", ["machine shop {city}"])
    monkeypatch.setattr(hunt_mod, "apply_schema", lambda *a, **k: None)
    monkeypatch.setattr(hunt_mod, "RATE_LIMIT_SECS", 0)
    monkeypatch.setattr(hunt_mod, "extract_facilities_from_results",
                        lambda *a, **k: [])
    monkeypatch.setattr(discover_mod, "MEDIUM_BIZ_QUERIES", [])
    monkeypatch.setattr(discover_mod, "search_ddg_medium",
                        lambda *a, **k: ([], None))

    celery_tasks.run_discover_and_enrich()
    assert any(n.startswith("ddg_search:") for n in calls), \
        f"Expected ddg_search:* to be wrapped; got {calls}"
```

- [ ] **Step 7: Run all tests**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS (21 hardening + 2 celery_tasks)

- [ ] **Step 8: Commit**

```bash
git add tools/lead-hunter/celery_tasks.py tests/lead_hunter/test_celery_tasks.py
git commit -m "feat(lead-hunter): wrap discovery HTTP loop in with_retries"
```

---

## Task 6: Surface partial enrichment failures

`_enrich_unenriched` swallows exceptions at `log.debug` (silent below INFO). Today's silent-zero detector only catches *zero* enriched, not *partial* (18/20 failing).

**Files:**
- Modify: `tools/lead-hunter/celery_tasks.py:228-300` (`_enrich_unenriched`)
- Modify: `tools/lead-hunter/run_hourly.py:99-117` (health_assertions step)
- Test: `tests/lead_hunter/test_celery_tasks.py`

- [ ] **Step 1: Change `_enrich_unenriched` return type**

Modify the function signature + return:

```python
def _enrich_unenriched(db_url: str, hunter_key: str, limit: int) -> tuple[int, int]:
    """Enrich facilities that have a website but no contacts yet.

    Returns (succeeded, attempted). attempted == 0 means nothing eligible —
    not a partial failure.
    """
    # ... same body, but:
    enriched = 0
    failed = 0
    # ... in the loop:
    try:
        # ...existing enrichment code...
        enriched += 1
    except Exception as e:
        log.warning("Enrich failed %s: %s", name, e)  # WAS: log.debug
        failed += 1
    # ... return:
    return enriched, len(rows)
```

Update the call site (line 164 area):

```python
    if db_url:
        enriched_count, enriched_attempted = _enrich_unenriched(
            db_url, hunter_key, DISCOVERY_RATE["max_enrichments_per_run"]
        )
    else:
        enriched_count, enriched_attempted = 0, 0
```

And add to the `run_result` dict:

```python
        "enriched_attempted": enriched_attempted,
```

- [ ] **Step 2: Wire partial-failure detector in `run_hourly._run`**

In `tools/lead-hunter/run_hourly.py`, in the `_run()` function, capture the new field:

```python
            enriched = result.get("enriched", 0)
            enriched_attempted = result.get("enriched_attempted", 0)
            inserted = result.get("inserted", 0)
            hs_pushed = result.get("hs_pushed", 0)
            step.detail.update({
                "discovered": discovered,
                "enriched": enriched,
                "enriched_attempted": enriched_attempted,
                "inserted": inserted,
                "hs_pushed": hs_pushed,
                "city": result.get("city", "?"),
            })
```

Then in the `health_assertions` step, add (after the existing detectors):

```python
        # Partial enrichment failure — most attempts failed but we got some
        if enriched_attempted >= 4 and enriched / max(enriched_attempted, 1) < 0.5:
            report.add_alert(
                f"Enrichment partial failure: {enriched}/{enriched_attempted} succeeded "
                "(<50%) — Firecrawl/Hunter degraded or many sites blocking scrapers"
            )
```

(Threshold of 4 attempts avoids tripping on tiny batches like 1/2.)

- [ ] **Step 3: Add tests**

Create `tests/lead_hunter/test_run_hourly.py`:

```python
"""Tests for run_hourly._run silent-failure detectors and exit codes."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest


def _stub_required_env(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://stub")


def test_run_alerts_on_discovered_but_zero_enriched(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 0, "enriched_attempted": 5,
        "inserted": 0, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    # Degraded -> exit 1
    assert rc == 1


def test_run_alerts_on_inserted_but_zero_pushed(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("HUBSPOT_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 5, "enriched_attempted": 5,
        "inserted": 3, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    assert rc == 1  # degraded


def test_run_alerts_on_partial_enrichment_failure(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 1, "enriched_attempted": 5,
        "inserted": 1, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    # 1/5 < 50% -> partial failure alert -> degraded
    assert rc == 1


def test_run_returns_zero_on_clean_run(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "stub")
    monkeypatch.setenv("HUBSPOT_API_KEY", "stub")

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 5, "enriched": 5, "enriched_attempted": 5,
        "inserted": 5, "hs_pushed": 5,
    })
    rc = run_hourly._run()
    assert rc == 0


def test_run_skip_marks_degraded(monkeypatch):
    import run_hourly
    _stub_required_env(monkeypatch)

    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "skipped": True, "reason": "daily_budget",
    })
    rc = run_hourly._run()
    # skip without other failures: degraded -> exit 1
    assert rc == 1
```

- [ ] **Step 4: Run all tests**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS (21 hardening + 2 celery_tasks + 5 run_hourly = 28)

- [ ] **Step 5: Commit**

```bash
git add tools/lead-hunter/celery_tasks.py tools/lead-hunter/run_hourly.py tests/lead_hunter/test_run_hourly.py
git commit -m "feat(lead-hunter): partial enrichment failure detector + tests"
```

---

## Task 7: Move `apply_schema` into a `report.step()`

Currently `celery_tasks.py:96-98` swallows schema errors with a warning. If schema migrations fail, every downstream SQL fails silently with no alert.

**Files:**
- Modify: `tools/lead-hunter/celery_tasks.py` — extract schema-apply call out
- Modify: `tools/lead-hunter/run_hourly.py` — wrap in `report.step("apply_schema")`

The cleanest split: `_run()` in `run_hourly.py` runs the schema step *before* `discover_and_enrich`. Schema failure marks the step as failed but the routine continues (downstream queries fail visibly with their own SQL errors).

- [ ] **Step 1: Remove schema apply from `run_discover_and_enrich`**

In `tools/lead-hunter/celery_tasks.py`, delete lines 94-98:

```python
    # Apply schema if DB available
    if db_url:
        try:
            hunt.apply_schema(db_url)
        except Exception as e:
            log.warning("Schema apply (non-fatal): %s", e)
```

- [ ] **Step 2: Add a schema step in `run_hourly._run`**

Insert in `_run()` after the preflight step, before `discover_and_enrich`:

```python
    # 1b. Apply DB schema (idempotent)
    db_url = os.environ.get("NEON_DATABASE_URL", "")
    with report.step("apply_schema") as step:
        if not db_url:
            step.status = "skip"
            step.detail["reason"] = "no NEON_DATABASE_URL"
        else:
            sys.path.insert(0, str(Path(__file__).parent))
            import hunt as hunt_mod
            hunt_mod.apply_schema(db_url)
            step.detail["applied"] = True
```

(If `apply_schema` raises, the `_StepCtx.__exit__` records `status=fail` and continues — `report.overall` becomes `fail` at finalize.)

- [ ] **Step 3: Add a test**

Append to `tests/lead_hunter/test_run_hourly.py`:

```python
def test_run_marks_schema_step_as_skip_when_no_db(monkeypatch):
    import run_hourly
    monkeypatch.setenv("NEON_DATABASE_URL", "")
    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 0, "enriched": 0, "enriched_attempted": 0,
        "inserted": 0, "hs_pushed": 0,
    })
    # NEON_DATABASE_URL blank => preflight exits 2 (since it's required).
    # We must populate it.
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://stub")
    # But for the schema step itself we re-blank inside _run via env? No --
    # the schema step reads at function entry, so we test the populated path:
    import hunt as hunt_mod
    monkeypatch.setattr(hunt_mod, "apply_schema", lambda url: None)
    rc = run_hourly._run()
    # Clean run path -> exit 0
    assert rc == 0


def test_run_step_records_schema_failure(monkeypatch):
    import run_hourly
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://stub")

    def boom(url):
        raise RuntimeError("migration broke")

    import hunt as hunt_mod
    monkeypatch.setattr(hunt_mod, "apply_schema", boom)
    monkeypatch.setattr("celery_tasks.run_discover_and_enrich", lambda: {
        "city": "X", "discovered": 0, "enriched": 0, "enriched_attempted": 0,
        "inserted": 0, "hs_pushed": 0,
    })
    rc = run_hourly._run()
    # Schema failure -> step fails -> overall fail -> exit 1
    assert rc == 1
```

- [ ] **Step 4: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS (now ~30 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/lead-hunter/celery_tasks.py tools/lead-hunter/run_hourly.py tests/lead_hunter/test_run_hourly.py
git commit -m "fix(lead-hunter): apply_schema runs as a tracked report step"
```

---

## Task 8: Make Celery task delegate to `run_hourly.main()`

Current Celery `discover_and_enrich` calls `run_discover_and_enrich()` directly — bypassing the lock, hard timeout, preflight, *and* alerting. If launchd + Celery beat both fire, we get duplicate runs.

**Files:**
- Modify: `tools/lead-hunter/celery_tasks.py:307-321`

- [ ] **Step 1: Replace the Celery task body**

In `tools/lead-hunter/celery_tasks.py`, replace lines 307-321 with:

```python
try:
    from celery import shared_task

    @shared_task(name="lead_hunter.discover_and_enrich", bind=True, max_retries=0)
    def discover_and_enrich(self):
        """Celery task: hourly lead discovery + enrichment.

        Delegates to run_hourly.main() so the singleton lock, hard timeout,
        preflight checks, and alert sink ALL apply (parity with launchd path).
        Celery's own retry is disabled (max_retries=0) — run_hourly's
        with_retries layer handles transient failures internally and the
        next hour will re-run anyway.
        """
        sys.path.insert(0, str(Path(__file__).parent))
        from run_hourly import main as run_main
        rc = run_main()
        # Celery treats non-zero return as success too (only exceptions retry).
        # We log the rc so it shows up in flower/redis-insight.
        log.info("lead_hunter.discover_and_enrich rc=%d", rc)
        return {"exit_code": rc}

except ImportError:
    pass
```

- [ ] **Step 2: Add a test**

Append to `tests/lead_hunter/test_celery_tasks.py`:

```python
def test_celery_task_delegates_to_run_hourly_main(monkeypatch):
    """The @shared_task body must call run_hourly.main(), not run_discover_and_enrich()."""
    import celery_tasks
    import run_hourly

    called = {"main": 0, "direct": 0}
    monkeypatch.setattr(run_hourly, "main", lambda: (called.__setitem__("main", called["main"] + 1) or 0))
    monkeypatch.setattr(celery_tasks, "run_discover_and_enrich",
                        lambda: called.__setitem__("direct", called["direct"] + 1) or {})

    # Find the unwrapped function — Celery wraps with bind=True so we call .run
    task = celery_tasks.discover_and_enrich
    if hasattr(task, "run"):
        # Real celery task object has .run for the underlying function (bind=True signature)
        task.run(task)
    else:
        task(None)  # Stub fallback if Celery not installed

    assert called["main"] == 1, "Celery task must call run_hourly.main()"
    assert called["direct"] == 0, "Celery task must NOT call run_discover_and_enrich() directly"
```

If Celery isn't installed in the test env, the test will skip via the `ImportError` block — so guard:

```python
def test_celery_task_delegates_to_run_hourly_main(monkeypatch):
    pytest.importorskip("celery")
    # ... rest unchanged
```

- [ ] **Step 3: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS (or skip on machines without Celery)

- [ ] **Step 4: Commit**

```bash
git add tools/lead-hunter/celery_tasks.py tests/lead_hunter/test_celery_tasks.py
git commit -m "fix(lead-hunter): Celery path goes through run_hourly.main() for full hardening"
```

---

## Task 9: Refactor `_enrich_unenriched` connection lifecycle

Current code: opens `conn` at line 235, never closes it. Opens new `conn2` per row inside the loop. On exception (line 297), `conn2` leaks.

**Files:**
- Modify: `tools/lead-hunter/celery_tasks.py:228-300`

- [ ] **Step 1: Rewrite `_enrich_unenriched` body**

Replace the function body with a single connection + context-managed cursors:

```python
def _enrich_unenriched(db_url: str, hunter_key: str, limit: int) -> tuple[int, int]:
    """Enrich facilities that have a website but no contacts yet.

    Returns (succeeded, attempted). Uses a single connection across all rows.
    """
    import psycopg2
    import httpx
    import hunt
    import enrich

    enriched = 0
    attempted = 0

    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT f.id, f.name, f.city, f.website, f.phone, f.icp_score, f.notes
                FROM prospect_facilities f
                LEFT JOIN prospect_contacts c ON c.facility_id = f.id
                WHERE f.website IS NOT NULL AND f.website != ''
                  AND c.id IS NULL
                  AND f.icp_score >= 6
                ORDER BY f.icp_score DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()

        if not rows:
            return 0, 0

        attempted = len(rows)
        with httpx.Client(timeout=15) as client:
            for row in rows:
                fid, name, city, website, phone, icp_score, notes = row
                f = hunt.Facility(
                    name=name, city=city, website=website or "",
                    phone=phone or "", icp_score=icp_score or 0, notes=notes or "",
                )
                try:
                    log.info("Enriching: %s (%s)", name[:50], (website or "")[:40])
                    result = enrich.scrape_facility_deep(f, client)
                    enrich.apply_enrichment(f, result, hunter_key, client)
                    f.icp_score = hunt.score_facility(f)

                    with conn.cursor() as cur2:
                        if f.phone:
                            cur2.execute(
                                "UPDATE prospect_facilities SET phone=%s, updated_at=NOW() WHERE id=%s",
                                (f.phone, fid),
                            )
                        if "vfd_keywords_found" in f.notes:
                            cur2.execute(
                                "UPDATE prospect_facilities SET notes=%s, icp_score=%s, updated_at=NOW() WHERE id=%s",
                                (f.notes, f.icp_score, fid),
                            )
                        if f.contacts:
                            for c in f.contacts:
                                cur2.execute(
                                    """
                                    INSERT INTO prospect_contacts (facility_id, name, title, email, phone, source, confidence)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                                    ON CONFLICT DO NOTHING
                                    """,
                                    (fid, c.get("name"), c.get("title"), c.get("email"),
                                     c.get("phone"), c.get("source", "website"), c.get("confidence", "low")),
                                )
                    conn.commit()
                    enriched += 1
                except Exception as e:
                    log.warning("Enrich failed %s: %s", name, e)
                    conn.rollback()  # release transaction state on this connection

    return enriched, attempted
```

(Note: `psycopg2`'s `connect()` context manager commits on clean exit and closes on exit; cursor `with` blocks always close. `conn.rollback()` after a per-row exception keeps the connection usable for the next row.)

- [ ] **Step 2: Run tests (no behavior change for green path)**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tools/lead-hunter/celery_tasks.py
git commit -m "refactor(lead-hunter): single-connection enrichment with context-managed cursors"
```

---

## Task 10: Persistent default alert log + env-var docs

Default alert log is `/tmp/hardening-alerts.jsonl` — wiped on macOS reboot. Move to a persistent path. Document `DISCORD_ALERT_WEBHOOK`, `HARDENING_ALERT_LOG`, `HARDENING_LOCK_DIR`, `LEAD_HUNTER_TIMEOUT_SECS`.

**Files:**
- Modify: `tools/lead-hunter/hardening.py:248`
- Modify: `docs/env-vars.md` — add 4 rows

- [ ] **Step 1: Change default in `hardening.py`**

In `tools/lead-hunter/hardening.py`, line 248, replace:

```python
    alert_log = Path(alert_log or os.getenv("HARDENING_ALERT_LOG", "/tmp/hardening-alerts.jsonl"))
```

with:

```python
    # Default to a persistent path under marketing/prospects so /tmp wipe on reboot
    # doesn't lose alert history. Override with HARDENING_ALERT_LOG.
    default_log = Path(__file__).parent.parent.parent / "marketing" / "prospects" / "hardening-alerts.jsonl"
    alert_log = Path(alert_log or os.getenv("HARDENING_ALERT_LOG", str(default_log)))
```

- [ ] **Step 2: Update tests that asserted /tmp**

(Task 4 tests use `tmp_path` explicitly — they pass.) No test changes needed.

- [ ] **Step 3: Document new env vars**

In `docs/env-vars.md`, append after the last row of the main table:

```markdown
| `LEAD_HUNTER_TIMEOUT_SECS` | tools/lead-hunter — hard timeout for hourly run; default 1500 (25 min) |
| `HARDENING_LOCK_DIR`     | tools/lead-hunter — directory for singleton lock file; default `/tmp` |
| `HARDENING_ALERT_LOG`    | tools/lead-hunter — JSONL alert log path; default `marketing/prospects/hardening-alerts.jsonl` |
| `DISCORD_ALERT_WEBHOOK`  | tools/lead-hunter — optional Discord webhook URL for degraded/failed runs |
```

- [ ] **Step 4: Run tests**

Run: `python3.12 -m pytest tests/lead_hunter/ -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add tools/lead-hunter/hardening.py docs/env-vars.md
git commit -m "fix(lead-hunter): persistent alert log default + document env vars"
```

---

## Task 11: Final verification + push + open PR

**Files:** none (verification only)

- [ ] **Step 1: Run full lead-hunter test suite**

Run: `cd /Users/bravonode/Mira && python3.12 -m pytest tests/lead_hunter/ -v`
Expected: ~32 tests, all PASS.

- [ ] **Step 2: Smoke run `run_hourly.py` standalone (no DB write)**

```bash
NEON_DATABASE_URL="postgres://stub@localhost/none" \
LEAD_HUNTER_TIMEOUT_SECS=10 \
HARDENING_ALERT_LOG=/tmp/test-alerts.jsonl \
python3.12 tools/lead-hunter/run_hourly.py
echo "exit=$?"
```

Expected: exit code 1 (degraded — DB unreachable triggers schema step failure). Verify `/tmp/test-alerts.jsonl` was written with a JSON line containing `"overall": "fail"` (or `"degraded"`).

- [ ] **Step 3: Lint**

Run: `ruff check tools/lead-hunter/ tests/lead_hunter/`
Expected: clean (or fix-pass with `ruff check --fix`).

- [ ] **Step 4: Push**

```bash
git push -u origin feat/lead-hunter-firecrawl-enrichment
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base main --title "feat(lead-hunter): close hardening gaps — tests + retry coverage + Celery parity" --body "$(cat <<'EOF'
## Summary

Closes the gaps the 2026-04-24 hardening (`2a7d68b`) exposed but didn't fix:

- **Tests for `hardening.py`** — 21 unit tests across `singleton_lock`, `with_retries`, `hard_timeout`, `preflight_secrets`, `RunReport`, and `alert()` (was zero coverage)
- **Discovery HTTP retries** — MSCA scrape and DDG search loop now wrapped in `with_retries` (previously only DB upsert + HubSpot push had retries)
- **Partial enrichment failures surface** — `_enrich_unenriched` returns `(succeeded, attempted)`; `run_hourly` alerts on <50% success with ≥4 attempts
- **Schema apply as tracked step** — moved from silent `log.warning` into a `report.step("apply_schema")` so failures escalate
- **Celery path parity** — `@shared_task discover_and_enrich` now delegates to `run_hourly.main()`, so the singleton lock + hard timeout + preflight + alert sink apply on the Celery beat path (previously only launchd path got them)
- **Connection lifecycle** — `_enrich_unenriched` uses one `psycopg2.connect()` with context-managed cursors instead of opening a new connection per row
- **Persistent alert log** — default moved off `/tmp` (wiped on reboot) to `marketing/prospects/hardening-alerts.jsonl`
- **Env-var docs** — 4 new rows in `docs/env-vars.md` for `LEAD_HUNTER_TIMEOUT_SECS`, `HARDENING_LOCK_DIR`, `HARDENING_ALERT_LOG`, `DISCORD_ALERT_WEBHOOK`

## Test plan

- [ ] `pytest tests/lead_hunter/ -v` — all green
- [ ] Manual `run_hourly.py` smoke run with stub DB — exits 1, writes alert JSONL
- [ ] `ruff check tools/lead-hunter/ tests/lead_hunter/` clean
- [ ] Verify Celery worker picks up the new task body (compare `inspect registered` before/after)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Confirm PR opened**

Run: `gh pr view --json url,number,title`
Expected: PR URL printed.

---

## Self-Review Checklist (post-write)

Spec coverage — every gap from the kickoff message has a task:

| Gap | Task |
|---|---|
| `hardening.py` zero tests | Tasks 1–4 |
| Discovery HTTP loop has no retries | Task 5 |
| Per-facility enrichment errors swallowed silently | Task 6 |
| Silent-zero detector misses partial failure | Task 6 |
| `apply_schema` swallows errors | Task 7 |
| Celery path bypasses lock/timeout/preflight/alert | Task 8 |
| `_enrich_unenriched` opens conn per row, leaks on exception | Task 9 |
| Alert log defaults to `/tmp` (wiped on reboot) | Task 10 |
| New env vars undocumented | Task 10 |
| No tests for silent-zero detectors | Task 6 |
| Final verification + PR | Task 11 |

Type consistency — `_enrich_unenriched` returns `tuple[int, int]` consistently across Tasks 6 and 9. `run_discover_and_enrich` adds `enriched_attempted` key in Task 6 and tests reference it in Tasks 6 and 7.

Placeholders — none ("TBD", "TODO", "etc."). All code blocks are concrete.
