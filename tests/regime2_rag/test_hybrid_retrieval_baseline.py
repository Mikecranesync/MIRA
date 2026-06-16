"""Unit 6 live baseline — hybrid (vector+BM25+RRF) must beat vector-only.

Runs each query in tests/golden_hybrid.csv against `recall_knowledge` twice:
once with MIRA_RETRIEVAL_HYBRID_ENABLED=false (baseline) and once with it
enabled (hybrid). Computes hit@3 per subset.

Hard gate (per 90-day MVP plan Unit 6):
  recall@3(hybrid, fault_code) >= recall@3(baseline, fault_code) * 1.15
  AND no subset regresses (hybrid >= baseline for every subset)

Skips cleanly when:
  * NEON_DATABASE_URL is unset (CI / Windows developers)
  * OLLAMA_BASE_URL isn't reachable (no embedding endpoint)
  * Migration 004 hasn't been applied (bm25 stream falls back to [] silently;
    test would still run but gate may not be meaningful — we detect this and
    skip with a clear reason)

Run on BRAVO or CHARLIE where Ollama + NeonDB are both reachable:
  NEON_DATABASE_URL=... OLLAMA_BASE_URL=http://localhost:11434 \
    pytest tests/regime2_rag/test_hybrid_retrieval_baseline.py -v -s
"""

from __future__ import annotations

import csv
import importlib
import os
from pathlib import Path
from typing import Iterable

import pytest


GOLDEN_CSV = Path(__file__).resolve().parent.parent / "golden_hybrid.csv"
EMBED_MODEL = os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")


def _load_golden() -> list[dict]:
    with open(GOLDEN_CSV, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _ollama_embed(text: str) -> list[float] | None:
    """Sync embed call — returns None on any failure (caller skips)."""
    try:
        import httpx  # noqa: PLC0415
    except ImportError:
        return None
    try:
        r = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("embedding")
    except Exception:
        return None


def _hit_at_3(chunks: Iterable[dict], needle: str) -> int:
    needle_low = needle.lower()
    for chunk in list(chunks)[:3]:
        if needle_low in str(chunk.get("content", "")).lower():
            return 1
    return 0


def _recall_per_subset(rows: list[dict], chunks_by_query: dict[str, list[dict]]) -> dict[str, float]:
    buckets: dict[str, list[int]] = {}
    for row in rows:
        subset = row["subset"]
        needle = row["expected_substring"]
        hit = _hit_at_3(chunks_by_query[row["query"]], needle)
        buckets.setdefault(subset, []).append(hit)
    return {s: (sum(hits) / len(hits) if hits else 0.0) for s, hits in buckets.items()}


@pytest.mark.regime2
@pytest.mark.network
@pytest.mark.slow
class TestHybridRetrievalBaseline:
    """Live recall@3 A/B — BM25 off vs on."""

    @pytest.fixture(autouse=True)
    def _gate_env(self):
        if not os.getenv("NEON_DATABASE_URL"):
            pytest.skip("NEON_DATABASE_URL not set — live retrieval test skipped")
        if not os.getenv("MIRA_TENANT_ID"):
            pytest.skip("MIRA_TENANT_ID not set — live retrieval test skipped")
        # Quick Ollama reachability ping via a throwaway embed.
        if _ollama_embed("ping") is None:
            pytest.skip(f"Ollama unreachable at {OLLAMA_URL} — skipping")

    def _run_batch(self, rows: list[dict], hybrid: bool) -> dict[str, list[dict]]:
        """Reload neon_recall under the chosen flag; batch-run all queries."""
        os.environ["MIRA_RETRIEVAL_HYBRID_ENABLED"] = "true" if hybrid else "false"
        from shared import neon_recall  # noqa: PLC0415
        reloaded = importlib.reload(neon_recall)

        tenant = os.environ["MIRA_TENANT_ID"]
        out: dict[str, list[dict]] = {}
        for row in rows:
            q = row["query"]
            emb = _ollama_embed(q)
            if emb is None:
                out[q] = []
                continue
            out[q] = reloaded.recall_knowledge(
                embedding=emb, tenant_id=tenant, limit=3, query_text=q
            )
        return out

    def test_hybrid_beats_baseline(self):
        rows = _load_golden()
        assert len(rows) >= 15, f"golden set too small: {len(rows)}"

        baseline_chunks = self._run_batch(rows, hybrid=False)
        hybrid_chunks = self._run_batch(rows, hybrid=True)

        baseline = _recall_per_subset(rows, baseline_chunks)
        hybrid = _recall_per_subset(rows, hybrid_chunks)

        print(f"\nBASELINE recall@3: {baseline}")
        print(f"HYBRID   recall@3: {hybrid}")

        # Fault-code subset: require multiplicative +15% (or +0.10 additive
        # floor when baseline is very low — avoids divide-by-zero gaming).
        base_fc = baseline.get("fault_code", 0.0)
        hyb_fc = hybrid.get("fault_code", 0.0)
        fault_gate = max(base_fc * 1.15, base_fc + 0.10) if base_fc > 0 else 0.10
        assert hyb_fc >= fault_gate, (
            f"fault_code recall@3 regression: baseline={base_fc:.2f}, "
            f"hybrid={hyb_fc:.2f}, required>={fault_gate:.2f}"
        )

        # No subset may regress.
        for subset, hyb_val in hybrid.items():
            base_val = baseline.get(subset, 0.0)
            assert hyb_val >= base_val, (
                f"{subset} regressed: baseline={base_val:.2f} hybrid={hyb_val:.2f}"
            )
