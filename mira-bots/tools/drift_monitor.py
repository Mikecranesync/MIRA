"""drift_monitor.py — Production query distribution vs. fixture coverage.

Samples recent production queries from the interactions table, embeds them
via Ollama nomic-embed-text, and measures cosine distance to the centroid
of fixture inputs. When the drift score exceeds threshold, flags the top
unfamiliar queries as fixture candidates.

This is the eval framework's "measure what you're not measuring" step —
Karpathy's jagged intelligence warning applied to MIRA: the fixture suite
can pass 90% while production queries drift into a region the fixtures
don't cover.

Usage (dry-run — no Discord post):
    python drift_monitor.py --dry-run

Environment:
    MIRA_DB_PATH              SQLite path (default: /opt/mira/data/mira.db)
    OLLAMA_BASE_URL           Ollama URL (default: http://host.docker.internal:11434)
    EMBED_TEXT_MODEL          Embedding model (default: nomic-embed-text:latest)
    DRIFT_THRESHOLD           Cosine distance threshold (default: 0.15)
    DRIFT_SAMPLE_SIZE         Max prod queries to sample (default: 500)
    DRIFT_TOP_N               Top-N unfamiliar queries to report (default: 10)
    DRIFT_LOOKBACK_DAYS       Days of prod data to sample (default: 7)
    DRIFT_OUTPUT_DIR          Where to write weekly JSON (default: tests/eval/drift)
    DRIFT_FIXTURES_DIR        Eval fixtures dir (default: tests/eval/fixtures)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger("mira-drift-monitor")

_DEFAULT_THRESHOLD = 0.15
_DEFAULT_SAMPLE = 500
_DEFAULT_TOP_N = 10
_DEFAULT_LOOKBACK_DAYS = 7


# ── Math helpers ───────────────────────────────────────────────────────────


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity in [-1, 1]. Returns 0 for zero vectors."""
    if len(a) != len(b):
        raise ValueError(f"Vector dim mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def cosine_distance(a: list[float], b: list[float]) -> float:
    """Cosine distance in [0, 2]. 0 = identical, 1 = orthogonal, 2 = opposite."""
    return 1.0 - cosine_similarity(a, b)


def centroid(vectors: list[list[float]]) -> list[float]:
    """Return the mean vector (centroid) of a list of vectors."""
    if not vectors:
        return []
    dim = len(vectors[0])
    sums = [0.0] * dim
    for v in vectors:
        if len(v) != dim:
            raise ValueError("Inconsistent vector dimensions in centroid")
        for i, x in enumerate(v):
            sums[i] += x
    return [s / len(vectors) for s in sums]


# ── Data collection ────────────────────────────────────────────────────────


def sample_production_queries(
    db_path: Path, sample_size: int, lookback_days: int
) -> list[str]:
    """Return up to sample_size recent user_message strings from interactions."""
    if not db_path.exists():
        logger.warning("DB not found: %s", db_path)
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    cutoff_iso = cutoff.isoformat()

    try:
        db = sqlite3.connect(str(db_path))
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT DISTINCT user_message FROM interactions "
            "WHERE created_at >= ? AND user_message IS NOT NULL "
            "AND length(user_message) > 2 "
            "ORDER BY created_at DESC LIMIT ?",
            (cutoff_iso, sample_size),
        ).fetchall()
        db.close()
        return [r["user_message"] for r in rows if r["user_message"]]
    except Exception as e:
        logger.error("sample_production_queries failed: %s", e)
        return []


def load_fixture_inputs(fixtures_dir: Path) -> list[tuple[str, str]]:
    """Return list of (scenario_id, first_user_turn_content) for every fixture."""
    results: list[tuple[str, str]] = []
    for f in sorted(fixtures_dir.glob("[0-9][0-9]_*.yaml")):
        try:
            data = yaml.safe_load(f.read_text())
            turns = data.get("turns", [])
            if turns:
                # Use first user turn — represents how a technician opens the chat
                first = next(
                    (t for t in turns if t.get("role") == "user"), None
                )
                if first and first.get("content"):
                    results.append((data.get("id", f.stem), first["content"]))
        except Exception as e:
            logger.warning("Failed to load %s: %s", f, e)
    return results


# ── Embedding via Ollama ───────────────────────────────────────────────────


async def embed_text(
    text: str, ollama_url: str, embed_model: str
) -> list[float] | None:
    """Embed text via Ollama nomic-embed-text. Returns None on failure."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{ollama_url}/api/embeddings",
                json={"model": embed_model, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
    except Exception as e:
        logger.warning("Ollama embed failed for %r: %s", text[:60], e)
        return None


async def embed_batch(
    texts: list[str], ollama_url: str, embed_model: str, concurrency: int = 4
) -> list[tuple[str, list[float]]]:
    """Embed a list of texts, returning (text, embedding) pairs for successes."""
    sem = asyncio.Semaphore(concurrency)

    async def _one(t: str) -> tuple[str, list[float]] | None:
        async with sem:
            emb = await embed_text(t, ollama_url, embed_model)
            return (t, emb) if emb else None

    results = await asyncio.gather(*(_one(t) for t in texts))
    return [r for r in results if r]


# ── Drift analysis ──────────────────────────────────────────────────────────


@dataclass
class DriftReport:
    drift_score: float  # cosine distance between prod centroid and fixture centroid
    threshold: float
    drift_flagged: bool
    prod_sample_size: int
    fixture_count: int
    top_unfamiliar: list[dict] = field(default_factory=list)
    timestamp: str = ""
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "drift_score": round(self.drift_score, 4),
            "threshold": self.threshold,
            "drift_flagged": self.drift_flagged,
            "prod_sample_size": self.prod_sample_size,
            "fixture_count": self.fixture_count,
            "top_unfamiliar": self.top_unfamiliar,
            "timestamp": self.timestamp,
            "error": self.error,
        }

    def to_markdown(self) -> str:
        status = "⚠️ DRIFT" if self.drift_flagged else "✓ stable"
        lines = [
            f"# Drift Monitor Report — {self.timestamp}",
            "",
            f"**Status:** {status}",
            f"**Drift score:** {self.drift_score:.4f} (threshold: {self.threshold})",
            f"**Production sample:** {self.prod_sample_size} queries",
            f"**Fixtures:** {self.fixture_count}",
            "",
        ]
        if self.top_unfamiliar:
            lines.append(f"## Top {len(self.top_unfamiliar)} unfamiliar production queries")
            lines.append("")
            lines.append("| Min distance | Query |")
            lines.append("|---|---|")
            for item in self.top_unfamiliar:
                q = item["query"][:80].replace("|", "\\|").replace("\n", " ")
                lines.append(f"| {item['min_distance']:.3f} | {q} |")
        if self.error:
            lines.append("")
            lines.append(f"**Error:** {self.error}")
        return "\n".join(lines)


def compute_drift(
    prod_embeddings: list[tuple[str, list[float]]],
    fixture_embeddings: list[tuple[str, list[float]]],
    threshold: float,
    top_n: int,
) -> DriftReport:
    """Compute drift score and top-N unfamiliar prod queries."""
    ts = datetime.now(timezone.utc).isoformat()

    if not prod_embeddings:
        return DriftReport(
            drift_score=0.0, threshold=threshold, drift_flagged=False,
            prod_sample_size=0,
            fixture_count=len(fixture_embeddings),
            timestamp=ts,
            error="no_prod_queries",
        )
    if not fixture_embeddings:
        return DriftReport(
            drift_score=0.0, threshold=threshold, drift_flagged=False,
            prod_sample_size=len(prod_embeddings),
            fixture_count=0,
            timestamp=ts,
            error="no_fixtures",
        )

    prod_vecs = [v for _, v in prod_embeddings]
    fixture_vecs = [v for _, v in fixture_embeddings]

    prod_centroid = centroid(prod_vecs)
    fixture_centroid = centroid(fixture_vecs)
    drift_score = cosine_distance(prod_centroid, fixture_centroid)

    # Top-N unfamiliar: for each prod query, find its MIN distance to any fixture.
    # High min distance = far from all fixtures = unfamiliar pattern.
    unfamiliar: list[tuple[float, str]] = []
    for text, pv in prod_embeddings:
        min_dist = min(cosine_distance(pv, fv) for fv in fixture_vecs)
        unfamiliar.append((min_dist, text))
    unfamiliar.sort(key=lambda x: -x[0])  # largest distance first

    return DriftReport(
        drift_score=drift_score,
        threshold=threshold,
        drift_flagged=drift_score > threshold,
        prod_sample_size=len(prod_embeddings),
        fixture_count=len(fixture_embeddings),
        top_unfamiliar=[
            {"min_distance": round(d, 4), "query": t}
            for d, t in unfamiliar[:top_n]
        ],
        timestamp=ts,
    )


# ── Monitor class ───────────────────────────────────────────────────────────


@dataclass
class DriftMonitorConfig:
    db_path: Path
    ollama_url: str
    embed_model: str
    fixtures_dir: Path
    output_dir: Path
    threshold: float = _DEFAULT_THRESHOLD
    sample_size: int = _DEFAULT_SAMPLE
    top_n: int = _DEFAULT_TOP_N
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS


class DriftMonitor:
    def __init__(self, config: DriftMonitorConfig) -> None:
        self.cfg = config

    async def run(self, dry_run: bool = False) -> DriftReport:
        logger.info(
            "Drift monitor starting (lookback=%d days, sample=%d)",
            self.cfg.lookback_days, self.cfg.sample_size,
        )

        prod_queries = sample_production_queries(
            self.cfg.db_path, self.cfg.sample_size, self.cfg.lookback_days
        )
        logger.info("Sampled %d production queries", len(prod_queries))

        fixture_inputs = load_fixture_inputs(self.cfg.fixtures_dir)
        logger.info("Loaded %d fixture inputs", len(fixture_inputs))

        if not prod_queries or not fixture_inputs:
            report = DriftReport(
                drift_score=0.0, threshold=self.cfg.threshold, drift_flagged=False,
                prod_sample_size=len(prod_queries),
                fixture_count=len(fixture_inputs),
                timestamp=datetime.now(timezone.utc).isoformat(),
                error="insufficient_data",
            )
            if not dry_run:
                self._write_report(report)
            return report

        # Embed
        prod_embs = await embed_batch(
            prod_queries, self.cfg.ollama_url, self.cfg.embed_model
        )
        fixture_texts = [t for _, t in fixture_inputs]
        fixture_embs = await embed_batch(
            fixture_texts, self.cfg.ollama_url, self.cfg.embed_model
        )
        logger.info(
            "Embedded %d prod + %d fixture queries",
            len(prod_embs), len(fixture_embs),
        )

        report = compute_drift(
            prod_embs, fixture_embs, self.cfg.threshold, self.cfg.top_n
        )

        if not dry_run:
            self._write_report(report)
        return report

    def _write_report(self, report: DriftReport) -> Path:
        """Write JSON report to output_dir/YYYY-WW.json (ISO week)."""
        self.cfg.output_dir.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        year, week, _ = now.isocalendar()
        filename = f"{year}-W{week:02d}.json"
        path = self.cfg.output_dir / filename
        path.write_text(json.dumps(report.to_dict(), indent=2))
        logger.info("Wrote drift report to %s", path)
        return path


# ── CLI entry point ────────────────────────────────────────────────────────


def _build_monitor() -> DriftMonitor:
    return DriftMonitor(DriftMonitorConfig(
        db_path=Path(os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db")),
        ollama_url=os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
        embed_model=os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"),
        fixtures_dir=Path(os.getenv(
            "DRIFT_FIXTURES_DIR", "/opt/mira/tests/eval/fixtures"
        )),
        output_dir=Path(os.getenv(
            "DRIFT_OUTPUT_DIR", "/opt/mira/tests/eval/drift"
        )),
        threshold=float(os.getenv("DRIFT_THRESHOLD", _DEFAULT_THRESHOLD)),
        sample_size=int(os.getenv("DRIFT_SAMPLE_SIZE", _DEFAULT_SAMPLE)),
        top_n=int(os.getenv("DRIFT_TOP_N", _DEFAULT_TOP_N)),
        lookback_days=int(os.getenv("DRIFT_LOOKBACK_DAYS", _DEFAULT_LOOKBACK_DAYS)),
    ))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="MIRA eval drift monitor")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute report but do not write JSON or post")
    args = parser.parse_args()

    monitor = _build_monitor()
    report = asyncio.run(monitor.run(dry_run=args.dry_run))
    print(report.to_markdown())
    print()
    print(json.dumps(report.to_dict(), indent=2))
    sys.exit(0)
