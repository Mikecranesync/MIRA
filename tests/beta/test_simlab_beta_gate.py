"""SimLab Beta Gate — P2 tests (PRD Objective 2).

Two honest paths (same split P1 used):

* **OFFLINE** (``test_simlab_gate_offline_*``) — deterministic, runs in CI under a
  minimal ``pip install pytest pyyaml``. Uses the in-memory harness
  (``simlab_gate_harness``): retrieve from the scenario's own doc fixtures →
  deterministic mock answerer with ``[Source: …]`` markers → score with the P1
  service. Proves the harness + citation-scoring wiring deterministically. It
  does NOT prove the real upload→retrieval gap is closed (see the harness
  docstring) — that is the staging test's job.

* **STAGING-REAL** (``test_simlab_gate_staging_real_retrieval``) — seeds the
  scenario's docs into the **real** ``knowledge_entries`` (via the seed-script
  path retrieval actually reads — NOT the Open WebUI KB) under a throwaway test
  tenant, then calls the **real** ``recall_knowledge`` and asserts the expected
  citations are retrievable. SKIPS cleanly (never errors at collection) when the
  DB/embedding infra is absent. This is the path that tests the #1592 /
  migration-049 gap end-to-end.

Collection safety: NOTHING that needs a DB / embeddings / LLM is imported at
module top. ``simlab`` is pure-Python and deterministic; the staging test guards
all heavy imports (``psycopg``, ``sqlalchemy``, the seed module) inside its body.
"""

from __future__ import annotations

import importlib.util
import os
import uuid
from pathlib import Path

import pytest

# Pure-Python, deterministic, no DB/LLM — safe at collection under minimal deps.
from simlab.scenarios import SCENARIOS

from .simlab_gate_harness import run_simlab_beta_gate

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Stable A–F order so parametrize ids are deterministic and the report reads in
# scenario order.
_SCENARIO_IDS = sorted(SCENARIOS)


# ---------------------------------------------------------------------------
# OFFLINE — deterministic, CI-safe (no DB / no embeddings / no LLM)
# ---------------------------------------------------------------------------


@pytest.mark.beta_gate
@pytest.mark.parametrize("scenario_id", _SCENARIO_IDS)
def test_simlab_gate_offline(scenario_id: str) -> None:
    """Each scenario A–F: mock answerer states the root cause AND cites every
    expected doc, scored by the P1 service.

    This is the deterministic harness/scoring proof — NOT a proof that the real
    upload→retrieval gap is closed (the staging test below covers that).
    """
    scenario = SCENARIOS[scenario_id]
    result = run_simlab_beta_gate(scenario)

    assert result.content_ok, (
        f"[{scenario_id}] answer did not state the expected root cause/asset. "
        f"{result.explain}"
    )
    assert result.citations_ok, (
        f"[{scenario_id}] missing expected citations {result.missing_citations}; "
        f"cited={result.cited_filenames}. {result.explain}"
    )
    # The gate verdict is content AND citations.
    assert result.cited, result.explain
    # Every expected citation must be in the cited set (the P2 contract).
    assert set(scenario.expected_citations).issubset(set(result.cited_filenames)), (
        f"[{scenario_id}] expected_citations ⊄ cited: "
        f"expected={scenario.expected_citations} cited={result.cited_filenames}"
    )


def test_simlab_gate_offline_is_deterministic() -> None:
    """Two runs over all scenarios yield identical verdicts, citations, and scores.

    Determinism is the whole point of the offline mock answerer — zero variance.
    """
    first = {sid: run_simlab_beta_gate(SCENARIOS[sid]) for sid in _SCENARIO_IDS}
    second = {sid: run_simlab_beta_gate(SCENARIOS[sid]) for sid in _SCENARIO_IDS}
    for sid in _SCENARIO_IDS:
        a, b = first[sid], second[sid]
        assert a.cited == b.cited
        assert a.cited_filenames == b.cited_filenames
        assert a.answer == b.answer
        assert a.overall == b.overall


# ---------------------------------------------------------------------------
# STAGING-REAL — seeds knowledge_entries, calls real recall_knowledge. Skips
# without infra. Never errors at collection.
# ---------------------------------------------------------------------------


def _load_seed_module():
    """Import ``tools/seeds/seed-simlab-docs.py`` by path (dashed filename).

    The module imports ``psycopg`` at top, so this is only called INSIDE the
    guarded staging test — never at collection.
    """
    seed_path = _REPO_ROOT / "tools" / "seeds" / "seed-simlab-docs.py"
    spec = importlib.util.spec_from_file_location("simlab_seed_docs", seed_path)
    if spec is None or spec.loader is None:  # pragma: no cover — defensive
        raise ImportError(f"cannot load seed module at {seed_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# One scenario is enough to prove the real retrieval path; filler01 is the
# canonical "underfill" case with three expected citations.
_STAGING_SCENARIO_ID = "filler_underfill_low_bowl_pressure"


def test_simlab_gate_staging_real_retrieval() -> None:
    """STAGING-ONLY: seed real docs → real ``recall_knowledge`` → expected docs retrievable.

    Needs ``NEON_DATABASE_URL`` (a dev/staging Neon with the ``knowledge_entries``
    schema incl. the GENERATED ``content_tsv`` column — migration 006). An
    embedding model is NOT required: ``content_tsv`` is generated server-side, so
    the BM25 lexical stream retrieves with ``embedding=None``. SKIPS cleanly when
    the DB or its driver is absent.

    This exercises the SAME ``knowledge_entries`` path chat retrieval reads — the
    #1592 / migration-049 path — NOT the Open WebUI KB. It is the real test of
    whether an uploaded SimLab doc becomes a retrievable, cite-able chunk.
    """
    db_url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        pytest.skip(
            "staging-real path needs NEON_DATABASE_URL / DATABASE_URL (a dev/staging "
            "Neon with the knowledge_entries schema). Not provisioned — skipping."
        )

    # Heavy imports guarded here (never at collection).
    psycopg = pytest.importorskip("psycopg", reason="staging-real needs psycopg")
    try:
        from psycopg.types.json import Jsonb  # noqa: F401 — used by the seed module
    except ImportError:  # pragma: no cover — psycopg present but json extra missing
        pytest.skip("psycopg.types.json unavailable — skipping staging-real path")

    # The real retrieval function under test.
    try:
        from shared.neon_recall import recall_knowledge
    except ImportError:
        pytest.skip("mira-bots/shared.neon_recall unavailable — skipping staging-real path")

    seed = _load_seed_module()
    scenario = SCENARIOS[_STAGING_SCENARIO_ID]

    # Throwaway tenant so we never touch the real SimLab corpus or another tenant.
    test_tenant = str(uuid.uuid4())

    # Build the chunk rows for the WHOLE line (the seed's unit), then keep only
    # this scenario's asset rows, re-tenanted to the throwaway tenant. We reuse
    # the seed's collect_rows() so chunking + UNS + metadata are identical to prod.
    all_rows = seed.collect_rows()
    rows = [
        {**r, "tenant_id": test_tenant}
        for r in all_rows
        if r["equipment_id"] == scenario.asset_id
    ]
    assert rows, f"seed produced no rows for asset {scenario.asset_id}"

    params = [{**r, "metadata": Jsonb(r["metadata"])} for r in rows]

    try:
        with psycopg.connect(db_url, autocommit=False) as conn, conn.cursor() as cur:
            # Ensure the throwaway tenant exists (FK target), then seed + COMMIT
            # so the separate recall_knowledge connection can see the rows.
            cur.execute(
                "INSERT INTO tenants (id, name, contact_email, subscription_tier, "
                "subscription_status) VALUES (%s, %s, %s, 'internal', 'active') "
                "ON CONFLICT (id) DO NOTHING",
                (test_tenant, "SimLab beta-gate test tenant", "simlab-test@factorylm.local"),
            )
            cur.executemany(seed._INSERT_SQL, params)
            conn.commit()

        # Real retrieval over the throwaway tenant. embedding=None → BM25 stream
        # (content_tsv is server-generated, no embed model needed). query_text is
        # the operator's question, exactly as the engine would pass it.
        hits = recall_knowledge(
            embedding=None,
            tenant_id=test_tenant,
            limit=10,
            query_text=scenario.question,
        )
        assert hits, (
            "recall_knowledge returned no hits for the seeded SimLab docs — the "
            "upload→retrieval path did not surface the uploaded chunks."
        )

        # Which expected-citation filenames are retrievable? Extract from the
        # chunk source_url (…/<file>.md) or metadata.source_file.
        retrieved_files: set[str] = set()
        for h in hits:
            src = (h.get("source_url") or "")
            meta = h.get("metadata") or {}
            fname = (meta.get("source_file") or "").strip() or src.rsplit("/", 1)[-1]
            if fname:
                retrieved_files.add(fname)

        expected = set(scenario.expected_citations)
        overlap = expected & retrieved_files
        assert overlap, (
            f"none of the expected citations {sorted(expected)} were retrievable "
            f"via real recall_knowledge; got {sorted(retrieved_files)}. The seeded "
            "docs are present but not surfaced — the retrieval gap is NOT closed."
        )
    finally:
        # Clean up: remove the throwaway tenant's seeded rows (+ tenant row).
        try:
            with psycopg.connect(db_url, autocommit=True) as conn, conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM knowledge_entries WHERE tenant_id = %s", (test_tenant,)
                )
                cur.execute("DELETE FROM tenants WHERE id = %s", (test_tenant,))
        except Exception:  # pragma: no cover — best-effort cleanup
            pass
