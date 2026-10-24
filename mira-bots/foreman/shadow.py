"""Foreman shadow state — FLEET-PEER-NETWORK-001 Slice B.

Slice B connects the existing pure ``ForemanPolicy`` to the live bot, gives the
bot durable memory (Slack event dedup and ``thread_ts -> mission_id``), and
**records what the policy would decide without ever acting on it**. The manual
workflow in ``.claude/rules/multi-session-protocol.md`` stays authoritative.

THE SAFETY PROPERTY, AND WHY IT IS STRUCTURAL RATHER THAN PROMISED.
"Shadow mode" is unfalsifiable if it is only asserted: a decision that was
recorded and a decision that was acted on look identical in a log. So shadow is
enforced two ways here, both tested:

1. ``ShadowRecorder`` has no actuator *by construction*. Its entire public
   surface is in ``ShadowRecorder.PUBLIC_API`` and a test fails if that set ever
   grows. It cannot post to Slack, merge, deploy, or invoke an agent, because it
   holds no client and imports nothing that could.
2. Enabling the flag must not change what the bot DOES, only what it REMEMBERS.
   A test drives the decision path with the flag off and on and asserts the
   observable output is identical.

FLAG. ``FLEET_PEER_NETWORK_ENABLED`` (default ``0``) is read here — Slice A
documents it as "read by Foreman from Slice B on", and before this module
nothing in the repository read it at all. With the flag off the bot keeps its
existing in-memory dedup and records nothing; the network is inert.

STORE. SQLite via the stdlib with ``PRAGMA journal_mode=WAL``, per
``.claude/rules/python-standards.md``. Foreman had no persistence before this,
so restart lost the dedup set (``seen_events`` is an in-memory set cleared at
500 entries) and every ``thread_ts`` was anonymous. Both survive restart now.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("foreman.shadow")

FLAG = "FLEET_PEER_NETWORK_ENABLED"
DEFAULT_DB = "foreman_shadow.db"


def network_enabled(env: dict[str, str] | None = None) -> bool:
    """Read the Slice A feature flag. Default OFF, and only an explicit truthy
    value turns it on — an unset or malformed value must never enable the
    network (PRD acceptance #12: disabling loses no evidence)."""
    raw = (env if env is not None else os.environ).get(FLAG, "0")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def mission_id_for_thread(thread_ts: str, channel: str) -> str:
    """One mission context per Slack thread (PRD Slice B).

    Deterministic and pure: the same thread always maps to the same mission id,
    so a restart re-derives the identical value rather than minting a second
    mission for a conversation already in flight. Channel is included because
    ``thread_ts`` is only unique within a channel.
    """
    if not thread_ts or not channel:
        raise ValueError("thread_ts and channel are both required to identify a mission")
    return f"foreman-{channel}-{thread_ts}"


@dataclass(frozen=True)
class ShadowDecision:
    """One recorded policy decision. Inert by construction — a value object."""

    mission_id: str
    thread_ts: str
    channel: str
    decision: str
    rationale: str
    recorded_at: str

    def as_row(self) -> tuple[str, str, str, str, str, str]:
        return (
            self.mission_id,
            self.thread_ts,
            self.channel,
            self.decision,
            self.rationale,
            self.recorded_at,
        )


_SCHEMA = """
CREATE TABLE IF NOT EXISTS seen_events (
    event_key   TEXT PRIMARY KEY,
    channel     TEXT NOT NULL,
    seen_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_missions (
    channel     TEXT NOT NULL,
    thread_ts   TEXT NOT NULL,
    mission_id  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (channel, thread_ts)
);
CREATE TABLE IF NOT EXISTS shadow_decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id  TEXT NOT NULL,
    thread_ts   TEXT NOT NULL,
    channel     TEXT NOT NULL,
    decision    TEXT NOT NULL,
    rationale   TEXT NOT NULL,
    recorded_at TEXT NOT NULL
);
"""


class ShadowStore:
    """Durable Foreman memory. Reads and writes only its own three tables."""

    def __init__(self, path: str | Path = DEFAULT_DB) -> None:
        self._path = str(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- dedup ---------------------------------------------------------------

    def mark_seen(self, event_key: str, channel: str) -> bool:
        """Record an event key. Returns True if this is the FIRST time.

        Slack redelivers on timeout, so dedup has to survive a restart — the
        pre-Slice-B in-memory set did not, and also self-cleared at 500 entries,
        which silently re-opened the window for anything older.
        """
        with self._lock:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO seen_events (event_key, channel, seen_at) VALUES (?, ?, ?)",
                (event_key, channel, _now()),
            )
            self._conn.commit()
            return cur.rowcount == 1

    def has_seen(self, event_key: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM seen_events WHERE event_key = ?", (event_key,)
            ).fetchone()
        return row is not None

    # -- thread -> mission ---------------------------------------------------

    def mission_for(self, channel: str, thread_ts: str) -> str:
        """Return this thread's mission id, creating it once if new."""
        mission_id = mission_id_for_thread(thread_ts, channel)
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO thread_missions (channel, thread_ts, mission_id, created_at)"
                " VALUES (?, ?, ?, ?)",
                (channel, thread_ts, mission_id, _now()),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT mission_id FROM thread_missions WHERE channel = ? AND thread_ts = ?",
                (channel, thread_ts),
            ).fetchone()
        # The stored value wins over the freshly derived one: if the derivation
        # ever changes, existing threads keep the identity they were created
        # with rather than silently splitting into a second mission.
        return row[0] if row else mission_id

    # -- decisions -----------------------------------------------------------

    def record(self, decision: ShadowDecision) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO shadow_decisions"
                " (mission_id, thread_ts, channel, decision, rationale, recorded_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                decision.as_row(),
            )
            self._conn.commit()

    def decisions_for(self, mission_id: str) -> list[ShadowDecision]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT mission_id, thread_ts, channel, decision, rationale, recorded_at"
                " FROM shadow_decisions WHERE mission_id = ? ORDER BY id",
                (mission_id,),
            ).fetchall()
        return [ShadowDecision(*r) for r in rows]


class ShadowRecorder:
    """Records what the policy WOULD decide. Cannot act, by construction.

    The public surface is frozen in ``PUBLIC_API`` and asserted by test. This
    class holds no Slack client, no agent handle and no subprocess — there is
    nothing here to act *with*, which is what makes "shadow" checkable instead
    of merely claimed.
    """

    PUBLIC_API = frozenset({"observe", "decisions_for", "enabled"})

    def __init__(self, store: ShadowStore, enabled: bool) -> None:
        self._store = store
        self._enabled = enabled

    @property
    def enabled(self) -> bool:
        return self._enabled

    def observe(
        self, *, channel: str, thread_ts: str, decision: str, rationale: str
    ) -> ShadowDecision | None:
        """Record one decision. Returns it, or None when the network is off.

        Returning the record rather than acting on it is the whole contract:
        the caller may log it, and may not route it anywhere.
        """
        if not self._enabled:
            return None
        mission_id = self._store.mission_for(channel, thread_ts)
        entry = ShadowDecision(
            mission_id=mission_id,
            thread_ts=thread_ts,
            channel=channel,
            decision=decision,
            rationale=rationale,
            recorded_at=_now(),
        )
        self._store.record(entry)
        logger.info("shadow: recorded (not acted) mission=%s decision=%s", mission_id, decision)
        return entry

    def decisions_for(self, mission_id: str) -> list[ShadowDecision]:
        return self._store.decisions_for(mission_id)


def policy_snapshot(policy: Any) -> str:
    """A JSON summary of a ForemanPolicy's current view, for the record.

    Deliberately read-only and defensive: the policy is a pure object owned by
    another module, so this reads what it exposes and never drives it.
    """
    state = getattr(policy, "state", None)
    summary: dict[str, Any] = {"policy": type(policy).__name__}
    for attr in ("mission_id", "phase", "status"):
        value = getattr(state, attr, None)
        if value is not None:
            summary[attr] = str(value)
    return json.dumps(summary, sort_keys=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
