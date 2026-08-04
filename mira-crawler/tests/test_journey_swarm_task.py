"""Tests for the journey-swarm Celery task, scheduler wiring, and worker image.

Covers the operational matrix the PRD requires: eligible/disabled/missing/
ineligible tenants, duplicate schedule delivery, overlapping execution,
transient retry vs permanent failure, feature flags, queue routing, timezone,
and task discovery in the built image's layout.

Offline: no broker, no database, no network. Redis is faked.

Run from the crawler's own working directory (its conftest puts the package
on sys.path):  cd mira-crawler && python -m pytest tests/test_journey_swarm_task.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tasks import journey_swarm as js  # noqa: E402

TENANT = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
OTHER_TENANT = "11111111-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Every test starts from a fully disabled, unconfigured worker."""
    for var in (
        "JOURNEY_SWARM_ENABLED",
        "JOURNEY_SWARM_TENANTS",
        "SWARM_PIPELINE_URL",
        "MIRA_TENANT_ID",
        "MIRA_CONTEXT_CONTRACT",
        "MIRA_FACTORYLM_LIVE",
        "CELERY_BROKER_URL",
    ):
        monkeypatch.delenv(var, raising=False)


def _enable(
    monkeypatch, *, tenants=TENANT, tenant=TENANT, flags=True, url="http://127.0.0.1:14099"
):
    monkeypatch.setenv("JOURNEY_SWARM_ENABLED", "1")
    monkeypatch.setenv("JOURNEY_SWARM_TENANTS", tenants)
    monkeypatch.setenv("MIRA_TENANT_ID", tenant)
    monkeypatch.setenv("SWARM_PIPELINE_URL", url)
    if flags:
        monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
        monkeypatch.setenv("MIRA_FACTORYLM_LIVE", "1")


class _FakeRedis:
    """Minimal SET NX EX / GET / DELETE, shared across instances by store."""

    store: dict[str, bytes] = {}

    @classmethod
    def from_url(cls, _url):
        return cls()

    def set(self, key, value, nx=False, ex=None):  # noqa: ARG002
        if nx and key in self.store:
            return False
        self.store[key] = value.encode() if isinstance(value, str) else value
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, key):
        self.store.pop(key, None)

    def ping(self):
        return True


@pytest.fixture
def fake_redis(monkeypatch):
    _FakeRedis.store.clear()
    monkeypatch.setitem(sys.modules, "redis", types.SimpleNamespace(Redis=_FakeRedis))
    monkeypatch.setenv("CELERY_BROKER_URL", "redis://fake:6379/0")
    return _FakeRedis


# ── tenant eligibility (fail-closed) ─────────────────────────────────────────


def test_disabled_by_default_exits_cleanly(monkeypatch):
    out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "JOURNEY_SWARM_ENABLED" in out["reason"]


def test_empty_tenant_allowlist_means_no_tenant_is_eligible(monkeypatch):
    """A missing allowlist must NEVER be read as 'all tenants'."""
    monkeypatch.setenv("JOURNEY_SWARM_ENABLED", "1")
    monkeypatch.setenv("MIRA_TENANT_ID", TENANT)
    out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "allowlist empty" in out["reason"]
    assert js.eligible_tenants() == []


def test_ineligible_tenant_is_skipped(monkeypatch):
    _enable(monkeypatch, tenants=OTHER_TENANT, tenant=TENANT)
    out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "not eligible" in out["reason"]


def test_missing_tenant_is_skipped(monkeypatch):
    _enable(monkeypatch, tenant="")
    monkeypatch.delenv("MIRA_TENANT_ID", raising=False)
    out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "no tenant" in out["reason"]


def test_spine_flags_off_skips_without_side_effects(monkeypatch):
    _enable(monkeypatch, flags=False)
    out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "spine flags off" in out["reason"]


def test_eligible_tenant_reaches_the_executor(monkeypatch, fake_redis):
    _enable(monkeypatch)
    calls = {}

    def _main() -> int:
        calls["ran"] = True
        return 0

    fake = types.SimpleNamespace(
        assert_target_matches_environment=lambda env, url: calls.setdefault("bound", (env, url)),
        main=_main,
    )
    monkeypatch.setattr(js, "_load_executor", lambda: fake)
    out = js.run_journey_swarm()
    assert out["ok"] is True
    assert out["verdict"] == "GREEN"
    assert calls["ran"] is True
    assert calls["bound"][0] == "staging"


# ── environment binding is re-checked in the worker ──────────────────────────


def test_production_target_is_refused_permanently(monkeypatch):
    _enable(monkeypatch, url="https://app.factorylm.com")

    def _refuse(_env, _url):
        raise RuntimeError("refusing to run: 'app.factorylm.com' is a PRODUCTION host")

    monkeypatch.setattr(
        js,
        "_load_executor",
        lambda: types.SimpleNamespace(assert_target_matches_environment=_refuse),
    )
    out = js.run_journey_swarm()
    assert out["ok"] is False
    assert out["verdict"] == "REFUSED"
    assert out["permanent"] is True  # never retried


# ── overlap / duplicate delivery ─────────────────────────────────────────────


def test_overlapping_run_is_blocked(monkeypatch, fake_redis):
    _enable(monkeypatch)
    with js.scope_lock("tech-journey-core:staging:" + TENANT) as first:
        assert first is True
        monkeypatch.setattr(
            js,
            "_load_executor",
            lambda: types.SimpleNamespace(
                assert_target_matches_environment=lambda *a: None, main=lambda: 0
            ),
        )
        out = js.run_journey_swarm()
    assert out["skipped"] is True
    assert "overlap" in out["reason"]


def test_duplicate_schedule_delivery_is_deduplicated(monkeypatch, fake_redis):
    """Two deliveries of the same tick: the second must not run a second time."""
    _enable(monkeypatch)
    runs = []
    monkeypatch.setattr(
        js,
        "_load_executor",
        lambda: types.SimpleNamespace(
            assert_target_matches_environment=lambda *a: None,
            main=lambda: (runs.append(1), 0)[1],
        ),
    )
    # Simulate the first delivery still holding the lock when the second lands.
    with js.scope_lock("tech-journey-core:staging:" + TENANT):
        second = js.run_journey_swarm()
    assert second["skipped"] is True
    assert runs == []  # the executor never ran twice


def test_lock_is_released_so_the_next_tick_can_run(monkeypatch, fake_redis):
    scope = "s:staging:" + TENANT
    with js.scope_lock(scope) as a:
        assert a is True
    with js.scope_lock(scope) as b:
        assert b is True  # released, not wedged


def test_lock_falls_open_when_redis_is_unreachable(monkeypatch):
    """A monitoring dependency must not become an availability dependency."""

    class _Broken:
        @staticmethod
        def from_url(_u):
            raise ConnectionError("no redis")

    monkeypatch.setitem(sys.modules, "redis", types.SimpleNamespace(Redis=_Broken))
    with js.scope_lock("x") as acquired:
        assert acquired is True


# ── failure classification ───────────────────────────────────────────────────


def test_executor_exception_is_transient(monkeypatch, fake_redis):
    _enable(monkeypatch)

    def _boom():
        raise OSError("connection reset")

    monkeypatch.setattr(
        js,
        "_load_executor",
        lambda: types.SimpleNamespace(
            assert_target_matches_environment=lambda *a: None, main=_boom
        ),
    )
    with pytest.raises(js.TransientSwarmError):
        js.run_journey_swarm()


def test_missing_executor_package_is_permanent_not_retried(monkeypatch):
    _enable(monkeypatch)

    def _missing():
        raise js.PermanentSwarmError("image does not ship tools/journey_swarm")

    monkeypatch.setattr(js, "_load_executor", _missing)
    out = js.run_journey_swarm()
    assert out["permanent"] is True
    assert out["verdict"] == "INFRA"


def test_not_green_run_is_reported_without_raising(monkeypatch, fake_redis):
    _enable(monkeypatch)
    monkeypatch.setattr(
        js,
        "_load_executor",
        lambda: types.SimpleNamespace(
            assert_target_matches_environment=lambda *a: None, main=lambda: 1
        ),
    )
    out = js.run_journey_swarm()
    assert out["ok"] is False
    assert out["verdict"] == "NOT_GREEN"


# ── health check ─────────────────────────────────────────────────────────────


def test_health_check_reports_each_dependency(monkeypatch, fake_redis):
    out = js.health_check()
    for name in (
        "broker",
        "task_registered",
        "executor",
        "database",
        "tenant_allowlist",
        "spine_flags",
        "enabled",
        "target_url",
    ):
        assert name in out["checks"], f"health check missing {name}"


def test_health_check_fails_loudly_when_unconfigured(monkeypatch, fake_redis):
    out = js.health_check()
    assert out["ok"] is False
    assert out["checks"]["tenant_allowlist"]["ok"] is False


# ── scheduler wiring ─────────────────────────────────────────────────────────


def test_schedule_is_registered_on_the_synthetic_profile(monkeypatch):
    monkeypatch.setenv("CELERY_BEAT_PROFILE", "synthetic-dogfood")
    sys.modules.pop("celeryconfig", None)
    import celeryconfig

    assert "journey-swarm-staging-cycle" in celeryconfig.beat_schedule
    entry = celeryconfig.beat_schedule["journey-swarm-staging-cycle"]
    assert entry["task"] == "tasks.journey_swarm.run_journey_swarm"
    assert entry["options"]["queue"] == "synthetic"
    # expires < interval so a missed tick cannot pile up behind the next one
    assert entry["options"]["expires"] < 6 * 3600


def test_schedule_uses_utc_so_cadence_does_not_shift_with_dst(monkeypatch):
    sys.modules.pop("celeryconfig", None)
    import celeryconfig

    assert celeryconfig.timezone == "UTC"
    assert celeryconfig.enable_utc is True


def test_task_is_routed_to_the_dedicated_synthetic_queue():
    sys.modules.pop("celeryconfig", None)
    import celeryconfig

    routes = celeryconfig.task_routes
    assert routes["tasks.journey_swarm.*"]["queue"] == "synthetic"
    assert routes["mira_crawler.tasks.journey_swarm.*"]["queue"] == "synthetic"


def test_task_has_a_rate_limit():
    sys.modules.pop("celeryconfig", None)
    import celeryconfig

    assert "tasks.journey_swarm.run_journey_swarm" in celeryconfig.task_annotations


def test_module_is_in_the_celery_app_task_list():
    src = (Path(__file__).resolve().parents[1] / "celery_app.py").read_text(encoding="utf-8")
    assert '"journey_swarm"' in src


# ── worker image ─────────────────────────────────────────────────────────────


def test_worker_image_ships_the_executor_package():
    """The image gap the PRD addendum flagged must actually be closed."""
    repo = Path(__file__).resolve().parents[2]
    dockerfile = (repo / "mira-crawler" / "Dockerfile.synthetic-dogfood").read_text(
        encoding="utf-8"
    )
    assert "COPY tools/journey_swarm/" in dockerfile


def test_executor_needs_only_dependencies_the_worker_already_has():
    """Guards the claim that no new requirement is needed in the image."""
    repo = Path(__file__).resolve().parents[2]
    reqs = (repo / "mira-crawler" / "requirements-celery.txt").read_text(encoding="utf-8").lower()
    for pkg in ("httpx", "pyyaml", "psycopg2"):
        assert pkg in reqs, f"worker image lacks {pkg}, which the executor imports"


def test_time_limits_sit_below_the_beat_interval():
    """A run must not still be going when the next tick fires."""
    assert js.HARD_TIME_LIMIT < 6 * 3600
    assert js.SOFT_TIME_LIMIT < js.HARD_TIME_LIMIT
    assert js.LOCK_TTL_S > js.HARD_TIME_LIMIT  # lock outlives the run, then self-heals
