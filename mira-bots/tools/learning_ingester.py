"""learning_ingester.py — Nightly: 👍 feedback → FAQ chunks in NeonDB KB (#189).

Closes the learning loop: every night at 02:00 UTC, query ``mira.db``
feedback_log for thumbs-up entries since last run, reconstruct the
conversation, format as a structured FAQ markdown, embed via Ollama, and
insert into NeonDB ``knowledge_entries`` with ``source_type='approved_faq'``.

These approved Q&A pairs become retrieval context for future conversations,
so tomorrow's MIRA answers the same question better than today's.

Usage (dry-run — no KB write):
    python learning_ingester.py --dry-run --output /tmp/learning_dryrun

Environment:
    MIRA_DB_PATH              SQLite path (default: /opt/mira/data/mira.db)
    NEON_DATABASE_URL         NeonDB connection string
    MIRA_TENANT_ID            Tenant for KB writes
    OLLAMA_BASE_URL           Ollama URL (default: http://host.docker.internal:11434)
    EMBED_TEXT_MODEL          Embedding model (default: nomic-embed-text:latest)
    LEARNING_STATE_PATH       State JSON (default: /opt/mira/data/learning_state.json)
    LEARNING_MAX_PER_RUN      Max entries per run (default: 50)
    LEARNING_INGEST_DISABLED  Set to "1" to disable
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger("mira-learning-ingester")


@dataclass
class LearningIngesterConfig:
    db_path: Path
    neon_url: str
    tenant_id: str
    ollama_url: str
    embed_model: str
    state_path: Path
    max_per_run: int = 50


class LearningIngester:
    """Ingest positive-feedback conversations into the KB as FAQ chunks."""

    def __init__(self, config: LearningIngesterConfig) -> None:
        self.cfg = config

    # ── State persistence ───────────────────────────────────────────────────

    def _load_state(self) -> dict:
        if self.cfg.state_path.exists():
            try:
                return json.loads(self.cfg.state_path.read_text())
            except Exception:
                pass
        return {"last_run_ts": None, "ingested_total": 0}

    def _save_state(self, state: dict) -> None:
        self.cfg.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.cfg.state_path.write_text(json.dumps(state, indent=2))

    # ── SQLite queries ──────────────────────────────────────────────────────

    def collect_positives_since(self, checkpoint_ts: str | None) -> list[dict]:
        """Return feedback_log rows with feedback='good' since checkpoint_ts."""
        if not self.cfg.db_path.exists():
            logger.warning("DB not found: %s", self.cfg.db_path)
            return []
        try:
            db = sqlite3.connect(str(self.cfg.db_path))
            db.row_factory = sqlite3.Row
            if checkpoint_ts:
                rows = db.execute(
                    "SELECT * FROM feedback_log "
                    "WHERE feedback = 'good' AND created_at > ? "
                    "ORDER BY created_at LIMIT ?",
                    (checkpoint_ts, self.cfg.max_per_run),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM feedback_log WHERE feedback = 'good' "
                    "ORDER BY created_at LIMIT ?",
                    (self.cfg.max_per_run,),
                ).fetchall()
            db.close()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error("collect_positives_since failed: %s", e)
            return []

    def reconstruct_qa(self, chat_id: str, up_to_ts: str) -> tuple[str, str] | None:
        """Return (question, answer) pair from the interactions table.

        The "question" is the last user_message before the thumbs-up, and
        the "answer" is the corresponding bot_response.
        """
        try:
            db = sqlite3.connect(str(self.cfg.db_path))
            db.row_factory = sqlite3.Row
            row = db.execute(
                "SELECT user_message, bot_response FROM interactions "
                "WHERE chat_id = ? AND created_at <= ? "
                "ORDER BY created_at DESC LIMIT 1",
                (chat_id, up_to_ts),
            ).fetchone()
            db.close()
            if not row:
                return None
            q = (row["user_message"] or "").strip()
            a = (row["bot_response"] or "").strip()
            if len(q) < 5 or len(a) < 20:
                # Too short to be useful as KB content
                return None
            return q, a
        except Exception as e:
            logger.error("reconstruct_qa failed for %s: %s", chat_id, e)
            return None

    # ── Formatting ──────────────────────────────────────────────────────────

    @staticmethod
    def format_faq(question: str, answer: str, chat_id: str, rated_at: str) -> str:
        """Format a Q&A pair as a retrievable FAQ chunk with provenance."""
        chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
        return (
            "## Approved FAQ\n\n"
            f"**Question:** {question}\n\n"
            f"**Answer:** {answer}\n\n"
            f"_Approved by technician on {rated_at[:10]}. "
            f"Source: production conversation {chat_hash}._\n"
        )

    # ── Embedding ──────────────────────────────────────────────────────────

    def embed(self, text: str) -> list[float] | None:
        try:
            resp = httpx.post(
                f"{self.cfg.ollama_url}/api/embeddings",
                json={"model": self.cfg.embed_model, "prompt": text},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
        except Exception as e:
            logger.warning("embed failed: %s", e)
            return None

    # ── NeonDB insert ──────────────────────────────────────────────────────

    def insert_faq(self, content: str, embedding: list[float], chat_id: str) -> bool:
        """Insert one FAQ chunk into NeonDB knowledge_entries."""
        try:
            from sqlalchemy import create_engine, text
            from sqlalchemy.pool import NullPool
        except ImportError:
            logger.error("sqlalchemy not available — cannot insert")
            return False

        try:
            engine = create_engine(
                self.cfg.neon_url, poolclass=NullPool,
                connect_args={"sslmode": "require"}, pool_pre_ping=True,
            )
            chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
            with engine.connect() as conn:
                conn.execute(text(
                    "INSERT INTO knowledge_entries "
                    "(id, tenant_id, source_type, manufacturer, model_number, "
                    " equipment_type, content, embedding, source_url, source_page, "
                    " metadata, is_private, verified, chunk_type, created_at) "
                    "VALUES (:id, :tid, 'approved_faq', '', '', '', :content, "
                    "        cast(:emb AS vector), :url, 0, cast(:meta AS jsonb), "
                    "        false, true, 'faq', now())"
                ), {
                    "id": str(uuid.uuid4()),
                    "tid": self.cfg.tenant_id,
                    "content": content,
                    "emb": str(embedding),
                    "url": f"feedback://approved/{chat_hash}",
                    "meta": json.dumps({"source_chat_hash": chat_hash}),
                })
                conn.commit()
            return True
        except Exception as e:
            logger.warning("Insert FAQ failed: %s", e)
            return False

    # ── Orchestrator ───────────────────────────────────────────────────────

    def run(self, dry_run: bool = False, output_dir: Path | None = None) -> dict:
        run_ts = datetime.now(timezone.utc).isoformat()
        state = self._load_state()
        checkpoint_ts = state.get("last_run_ts")

        logger.info("Learning ingester start (checkpoint=%s)", checkpoint_ts)

        positives = self.collect_positives_since(checkpoint_ts)
        logger.info("Found %d positive feedback entries", len(positives))

        ingested = 0
        skipped = 0
        samples: list[str] = []

        for entry in positives:
            chat_id = entry["chat_id"]
            created_at = entry["created_at"]

            qa = self.reconstruct_qa(chat_id, created_at)
            if not qa:
                skipped += 1
                continue
            question, answer = qa

            content = self.format_faq(question, answer, chat_id, created_at)

            if dry_run:
                out_dir = output_dir or Path("/tmp/learning_dryrun")
                out_dir.mkdir(parents=True, exist_ok=True)
                chat_hash = hashlib.sha256(chat_id.encode()).hexdigest()[:12]
                (out_dir / f"faq_{chat_hash}.md").write_text(content)
                samples.append(content[:200])
                ingested += 1
                continue

            emb = self.embed(content)
            if not emb:
                skipped += 1
                continue

            if self.insert_faq(content, emb, chat_id):
                ingested += 1
            else:
                skipped += 1

        self._save_state({
            "last_run_ts": run_ts,
            "ingested_total": state.get("ingested_total", 0) + ingested,
        })

        result = {
            "status": "ok",
            "ingested": ingested,
            "skipped": skipped,
            "positives_found": len(positives),
            "ts": run_ts,
        }
        if dry_run:
            result["dry_run"] = True
            result["samples"] = samples[:3]
        return result


def _build_ingester() -> LearningIngester:
    return LearningIngester(LearningIngesterConfig(
        db_path=Path(os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db")),
        neon_url=os.getenv("NEON_DATABASE_URL", ""),
        tenant_id=os.getenv("MIRA_TENANT_ID", ""),
        ollama_url=os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
        embed_model=os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"),
        state_path=Path(os.getenv(
            "LEARNING_STATE_PATH", "/opt/mira/data/learning_state.json"
        )),
        max_per_run=int(os.getenv("LEARNING_MAX_PER_RUN", "50")),
    ))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="MIRA learning ingester")
    parser.add_argument("--dry-run", action="store_true",
                        help="Write FAQs to disk, skip NeonDB insert")
    parser.add_argument("--output", type=Path,
                        default=Path("/tmp/learning_dryrun"),
                        help="Dry-run output dir")
    args = parser.parse_args()

    ingester = _build_ingester()
    result = ingester.run(dry_run=args.dry_run, output_dir=args.output)
    print(json.dumps(result, indent=2))
