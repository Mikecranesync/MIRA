"""#3328 — the approved-retrieval gate must be PLUMBED and ENFORCED, not just set.

Doppler had `MIRA_ENFORCE_APPROVED_RETRIEVAL='true'` in prd while no compose file
forwarded it, so every container evaluated the `"false"` default. Two layers:

  1. Plumbing — every consumer named in CAPABILITY_CLOSURE.yaml (plus mira-hub,
     which reads the same flag in `manual-rag.ts`) forwards the variable in its
     resolved compose environment, in both the prod and staging compose files.
  2. Enforcement — with the exact value compose would forward, the deployed
     execution path (`recall_knowledge`) emits `AND verified = true` on every
     knowledge_entries stream. Hermetic: `sqlalchemy.create_engine` is replaced
     by a recorder, so no DB/network is touched and the assertion is on the SQL
     the container would actually run.
"""

from __future__ import annotations

import contextlib
import importlib
import pathlib
import re
import sys

import pytest
import yaml

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "mira-bots"))

FLAG = "MIRA_ENFORCE_APPROVED_RETRIEVAL"
REGISTRY = _ROOT / "docs/architecture/convergence/CAPABILITY_CLOSURE.yaml"

# container_name → compose service key. mira-hub is added explicitly: the
# registry lists only the engine consumers, but the Hub's manual-rag.ts reads the
# same flag and would otherwise stay silently unenforced.
PROD_COMPOSE = _ROOT / "docker-compose.saas.yml"
STAGING_COMPOSE = _ROOT / "docker-compose.staging-vps.yml"
STAGING_CONSUMERS = ["stg-mira-pipeline", "stg-mira-bot-telegram", "stg-mira-hub"]


def _registry_consumers() -> list[str]:
    reg = yaml.safe_load(REGISTRY.read_text())
    caps = reg["capabilities"] if isinstance(reg, dict) else reg
    (cap,) = [c for c in caps if c.get("feature_flag") == FLAG]
    return list(cap["consumers"]) + ["mira-hub"]


def _env_names(service: dict) -> set[str]:
    env = service.get("environment") or {}
    if isinstance(env, dict):  # map form (yaml merge keys already resolved)
        return set(env)
    return {item.split("=", 1)[0] for item in env}  # list form "K=V"


def _service_by_container(compose: pathlib.Path, container: str) -> dict:
    """Registry consumers are logical names (`mira-ask`); prod container_names
    carry a `-saas` suffix for some services (`mira-ask-saas`). Exact match wins,
    then the suffixed form."""
    services = yaml.safe_load(compose.read_text())["services"]
    by_name = {svc.get("container_name"): svc for svc in services.values()}
    for candidate in (container, f"{container}-saas"):
        if candidate in by_name:
            return by_name[candidate]
    raise AssertionError(f"{compose.name}: no service with container_name={container}[-saas]")


# ---------------------------------------------------------------- plumbing


@pytest.mark.parametrize("container", _registry_consumers())
def test_prod_compose_forwards_flag_to_every_consumer(container):
    svc = _service_by_container(PROD_COMPOSE, container)
    assert FLAG in _env_names(svc), (
        f"{container} does not forward {FLAG} — Doppler sets it, but compose "
        "passes a variable only when the service's environment block names it (#3328)"
    )


@pytest.mark.parametrize("container", STAGING_CONSUMERS)
def test_staging_compose_forwards_flag(container):
    svc = _service_by_container(STAGING_COMPOSE, container)
    assert FLAG in _env_names(svc)


def test_compose_default_is_off_not_on():
    """The compose fallback must be 'false' — the value comes from Doppler, and an
    unset Doppler must not silently turn a retrieval-restricting gate ON."""
    for compose in (PROD_COMPOSE, STAGING_COMPOSE):
        for m in re.finditer(rf"{FLAG}[:=]\s*\$\{{{FLAG}:-([^}}]*)\}}", compose.read_text()):
            assert m.group(1) == "false", f"{compose.name}: default is {m.group(1)!r}"


# ------------------------------------------------------------- enforcement


class _Recorder:
    """Stand-in for a SQLAlchemy engine that records every SQL text it is handed."""

    def __init__(self):
        self.sql: list[str] = []

    @contextlib.contextmanager
    def connect(self):
        yield self

    def execute(self, clause, params=None):
        self.sql.append(str(getattr(clause, "text", clause)))

        class _Result:
            def mappings(self_inner):
                return self_inner

            def fetchall(self_inner):
                return []

            def fetchone(self_inner):
                return None

        return _Result()


def _run_recall(monkeypatch, flag_value: str | None) -> list[str]:
    if flag_value is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, flag_value)
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://hermetic/none")
    import sqlalchemy

    rec = _Recorder()
    monkeypatch.setattr(sqlalchemy, "create_engine", lambda *a, **k: rec)
    from shared import neon_recall

    nr = importlib.reload(neon_recall)
    nr.recall_knowledge(
        embedding=[0.0] * 8,
        tenant_id="00000000-0000-0000-0000-000000000001",
        limit=3,
        query_text="GS10 F0004 overcurrent",  # exercises fault + BM25 streams too
    )
    return [s for s in rec.sql if "knowledge_entries" in s]


def test_container_shaped_true_enforces_on_every_stream(monkeypatch):
    """The value compose forwards from Doppler prd is the literal 'true'."""
    streams = _run_recall(monkeypatch, "true")
    assert streams, "recall_knowledge issued no knowledge_entries query"
    unguarded = [s for s in streams if "verified = true" not in s]
    assert not unguarded, (
        f"{len(unguarded)} stream(s) would cite unapproved chunks:\n" + "\n---\n".join(unguarded)
    )


def test_compose_default_false_is_byte_identical_to_off(monkeypatch):
    assert not any("verified = true" in s for s in _run_recall(monkeypatch, "false"))
    assert not any("verified = true" in s for s in _run_recall(monkeypatch, None))
