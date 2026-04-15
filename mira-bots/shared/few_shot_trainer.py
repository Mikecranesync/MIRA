"""FewShotTrainer — confidence boosting from tech /good confirmations.

Reads historical /good feedback counts per (vendor, intent) from the
mira.db SQLite store (WAL). Returns a multiplier intended to scale
base confidence scores at run-time so the system compounds with every
confirmation rather than plateauing.

Vision doc Problem 6.

Schema (confirmed 2026-04-15):

  feedback_log(chat_id, feedback, reason, last_reply, exchange_count, created_at)
      feedback is 'good' | 'bad' (set by Supervisor.log_feedback).
  interactions(chat_id, platform, user_message, bot_response, fsm_state, intent, ...)
      intent is the ('industrial' | 'safety' | 'greeting' | ...) label
      produced by guardrails.classify_intent() at the time of the turn.
  conversation_state(chat_id, state, context, asset_identified, ...)
      asset_identified is typically "Manufacturer, Model" — we take
      the substring before the comma as the vendor.

Vendor + intent buckets are joined three-way on chat_id. A /good
feedback row contributes to the bucket (vendor, intent) if BOTH the
intent (from any interaction on that chat) AND the vendor (from
conversation_state.asset_identified) resolve.

Formula: boost = 1.0 + min(log1p(good_count) * 0.5, 2.0)
  0 confirmations   -> 1.000
  1  -> 1.347
  20 -> ~2.522
  1k -> 3.000 (capped)
"""
from __future__ import annotations

import logging
import math
import os
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger("mira-few-shot")

_CAP = 3.0
_COEF = 0.5
_MAX_BOOST_DELTA = 2.0  # 1.0 + 2.0 = 3.0 cap


def _resolve_db_path(explicit: str | None) -> str:
    if explicit:
        return explicit
    return os.environ.get("MIRA_DB_PATH", "./mira.db")


def _boost_from_count(count: int) -> float:
    if count <= 0:
        return 1.0
    delta = min(math.log1p(count) * _COEF, _MAX_BOOST_DELTA)
    return round(1.0 + delta, 6)


class FewShotTrainer:
    """In-memory cached reader for historical /good confirmation counts."""

    def __init__(self, db_path: str | None = None, cache_ttl_s: int = 3600):
        self.db_path = _resolve_db_path(db_path)
        self.cache_ttl_s = cache_ttl_s
        self._cache: dict[tuple[str, str], tuple[float, float]] = {}
        self._missing_logged = False

    def confidence_boost(self, vendor: str, intent: str) -> float:
        """Return a multiplier in [1.0, 3.0] for (vendor, intent).

        Normalizes both keys to lowercase. Falls back to 1.0 on any DB
        error, missing file, or missing table (fail-open).
        """
        key = (vendor.lower().strip(), intent.lower().strip())
        now = time.time()
        cached = self._cache.get(key)
        if cached is not None and (now - cached[1]) < self.cache_ttl_s:
            return cached[0]
        count = self._count_good(key[0], key[1])
        boost = _boost_from_count(count)
        self._cache[key] = (boost, now)
        logger.info(
            "few-shot lookup vendor=%s intent=%s good=%d boost=%.3f",
            key[0], key[1], count, boost,
        )
        return boost

    def refresh(self) -> None:
        """Clear the in-memory cache; next lookup re-queries SQLite."""
        self._cache.clear()

    def stats(self) -> dict[str, object]:
        good = bad = 0
        try:
            with sqlite3.connect(self.db_path) as db:
                db.execute("PRAGMA journal_mode=WAL")
                good = db.execute(
                    "SELECT COUNT(*) FROM feedback_log WHERE feedback = 'good'"
                ).fetchone()[0]
                bad = db.execute(
                    "SELECT COUNT(*) FROM feedback_log WHERE feedback = 'bad'"
                ).fetchone()[0]
        except sqlite3.Error:
            pass
        return {
            "db_path": self.db_path,
            "good_count": int(good or 0),
            "bad_count": int(bad or 0),
            "cache_size": len(self._cache),
            "cache_ttl_s": self.cache_ttl_s,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _count_good(self, vendor_lc: str, intent_lc: str) -> int:
        """Count distinct /good feedback rows whose chat has BOTH a matching
        intent (in interactions) and a matching vendor (prefix of
        conversation_state.asset_identified, case-insensitive)."""
        if not Path(self.db_path).exists():
            if not self._missing_logged:
                logger.warning(
                    "few-shot DB path missing: %s — boost defaults to 1.0",
                    self.db_path,
                )
                self._missing_logged = True
            return 0
        try:
            with sqlite3.connect(self.db_path) as db:
                db.execute("PRAGMA journal_mode=WAL")
                row = db.execute(
                    """
                    SELECT COUNT(DISTINCT f.id)
                      FROM feedback_log f
                     WHERE f.feedback = 'good'
                       AND EXISTS (
                           SELECT 1 FROM interactions i
                            WHERE i.chat_id = f.chat_id
                              AND LOWER(IFNULL(i.intent, '')) = ?
                       )
                       AND EXISTS (
                           SELECT 1 FROM conversation_state cs
                            WHERE cs.chat_id = f.chat_id
                              AND LOWER(
                                  IFNULL(
                                      SUBSTR(
                                          cs.asset_identified,
                                          1,
                                          CASE
                                              WHEN INSTR(cs.asset_identified, ',') > 0
                                              THEN INSTR(cs.asset_identified, ',') - 1
                                              ELSE LENGTH(cs.asset_identified)
                                          END
                                      ),
                                      ''
                                  )
                              ) = ?
                       )
                    """,
                    (intent_lc, vendor_lc),
                ).fetchone()
                return int(row[0] or 0)
        except sqlite3.Error as exc:
            logger.warning("few-shot DB query failed (fail-open): %s", exc)
            return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _cli() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="FewShotTrainer inspection")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--db-path", default=None)
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING)
    trainer = FewShotTrainer(db_path=args.db_path)
    boost = trainer.confidence_boost(args.vendor, args.intent)
    print(
        f"vendor={args.vendor} intent={args.intent} boost={boost:.3f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
