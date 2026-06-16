#!/usr/bin/env python3
"""
Data canary heartbeat — proves NeonDB write/read/delete works end-to-end.

Spec: docs/specs/enforcement-layer-spec.md §4.6

Each tick:
  1. INSERT a row into system_canary with a unique value.
  2. SELECT it back and assert the value matches.
  3. DELETE the row.
  4. Sweep rows older than 24h (best-effort janitor).

Any failure → log to wiki/heartbeat.log, optionally POST to Telegram ops chat,
exit non-zero. Designed to keep working when the rest of the stack is down,
so the only deps are psycopg2-binary, requests (stdlib via urllib), and
environment-injected Doppler secrets.

Cron (Charlie, every 15m):
    */15 * * * * cd ~/MIRA && doppler run -p factorylm -c prd -- python3 scripts/heartbeat_monitor.py
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import psycopg2  # type: ignore
except ImportError:
    print("ERROR: psycopg2 is required. Install: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(2)

# ─── Configuration ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
LOG_PATH = REPO_ROOT / "wiki" / "heartbeat.log"

NEON_URL = os.getenv("NEON_DATABASE_URL", "").strip()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_OPS_BOT_TOKEN", "").strip()
TELEGRAM_CHAT = os.getenv("TELEGRAM_OPS_CHAT_ID", "").strip()
DISCORD_WEBHOOK = os.getenv("ALPHA_STATUS_WEBHOOK", "").strip()

HOSTNAME = socket.gethostname()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("heartbeat")


# ─── Alerting ───────────────────────────────────────────────────────────────


def alert(text: str) -> None:
    """Best-effort fan-out to ops channels. Never raises."""
    log.error("ALERT: %s", text)
    payload = f"🚨 NeonDB canary FAILED on {HOSTNAME}\n{text}"
    if TELEGRAM_TOKEN and TELEGRAM_CHAT:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
            data = json.dumps({"chat_id": TELEGRAM_CHAT, "text": payload}).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
        except (urllib.error.URLError, OSError) as e:
            log.warning("telegram alert failed: %s", e)
    if DISCORD_WEBHOOK:
        try:
            data = json.dumps({"content": payload}).encode()
            req = urllib.request.Request(
                DISCORD_WEBHOOK,
                data=data,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10)
        except (urllib.error.URLError, OSError) as e:
            log.warning("discord alert failed: %s", e)


# ─── Canary table bootstrap ─────────────────────────────────────────────────


CANARY_DDL = """
CREATE TABLE IF NOT EXISTS system_canary (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value       TEXT        NOT NULL
);
"""


def ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(CANARY_DDL)
    conn.commit()


# ─── Heartbeat steps ────────────────────────────────────────────────────────


def heartbeat(conn) -> None:
    canary_id = str(uuid.uuid4())
    canary_value = f"{datetime.now(timezone.utc).isoformat()}|{HOSTNAME}|{canary_id}"

    # 1. INSERT
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO system_canary (id, value) VALUES (%s, %s) RETURNING id",
            (canary_id, canary_value),
        )
        row = cur.fetchone()
        if row is None or str(row[0]) != canary_id:
            raise RuntimeError(f"INSERT did not return our id: {row!r}")
    conn.commit()

    # 2. SELECT
    with conn.cursor() as cur:
        cur.execute(
            "SELECT created_at, value FROM system_canary WHERE id = %s",
            (canary_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("SELECT returned no row — write was lost")
        if row[1] != canary_value:
            raise RuntimeError(f"SELECT returned wrong value: got {row[1]!r}, want {canary_value!r}")

    # 3. DELETE
    with conn.cursor() as cur:
        cur.execute("DELETE FROM system_canary WHERE id = %s", (canary_id,))
        if cur.rowcount != 1:
            raise RuntimeError(f"DELETE rowcount={cur.rowcount} (expected 1)")
    conn.commit()

    # 4. Janitor sweep — best effort, don't fail the heartbeat if it stalls.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM system_canary WHERE created_at < NOW() - INTERVAL '24 hours'"
            )
            swept = cur.rowcount
        conn.commit()
        if swept and swept > 0:
            log.info("janitor swept %d stale canary rows", swept)
    except Exception as e:
        log.warning("janitor sweep failed (non-fatal): %s", e)
        conn.rollback()

    log.info("canary OK id=%s value=%s", canary_id, canary_value)


# ─── Log line helper ────────────────────────────────────────────────────────


def append_log(status: str, detail: str = "", duration_ms: Optional[int] = None) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    parts = [ts, HOSTNAME, status]
    if duration_ms is not None:
        parts.append(f"{duration_ms}ms")
    if detail:
        parts.append(detail.replace("\n", " ")[:500])
    line = "\t".join(parts) + "\n"
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line)


# ─── Entrypoint ─────────────────────────────────────────────────────────────


def main() -> int:
    if not NEON_URL:
        msg = "NEON_DATABASE_URL not set — refusing to run blind"
        log.error(msg)
        append_log("ERROR", msg)
        return 2

    t0 = time.monotonic()
    conn = None
    try:
        conn = psycopg2.connect(NEON_URL, connect_timeout=15)
        ensure_table(conn)
        heartbeat(conn)
        elapsed = int((time.monotonic() - t0) * 1000)
        append_log("OK", duration_ms=elapsed)
        return 0
    except Exception as e:
        elapsed = int((time.monotonic() - t0) * 1000)
        detail = f"{type(e).__name__}: {e}"
        log.exception("heartbeat failed: %s", detail)
        append_log("FAIL", detail=detail, duration_ms=elapsed)
        alert(detail)
        return 1
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
