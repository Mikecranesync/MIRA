"""Lane health monitoring: initialization, usage limits, and state derivation."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger("fleet-gateway")

# Default grace period for initialization (in seconds)
INIT_GRACE_S = int(os.getenv("FLEET_GATEWAY_INIT_GRACE_S", "75"))

# Default backoff when usage limit reset time cannot be parsed (in seconds)
LIMIT_BACKOFF_S = int(os.getenv("FLEET_GATEWAY_LIMIT_BACKOFF_S", "3600"))

# Usage limit patterns
# A limit line is one that STARTS with the message once TUI glyphs/whitespace are
# stripped. Matching anywhere would let a lane that merely prints the string (a grep,
# a `git show` of a test fixture, a cat of a log) block a whole node until midnight.
_LIMIT_LINE = re.compile(r"^You've hit your (weekly|session) limit\b", re.IGNORECASE)
_TUI_PREFIX = re.compile(r"^[\s⏺●⎿│>❯*·✻✶✢✽✳-]+")
_LIMIT_TAIL_LINES = 20
_LIMIT_STATES = ("idle", "completed")  # a lane still processing has not been refused

# "resets 12am (America/New_York)" · "resets 3:30pm (…)" · "resets Sep 12 at 12am (…)"
_RESET_RE = re.compile(
    r"resets\s+(?:(?P<mon>[A-Z][a-z]{2,8})\s+(?P<day>\d{1,2})(?:,)?\s+(?:at\s+)?)?"
    r"(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ampm>am|pm)?\s*\((?P<tz>[A-Za-z_]+/[A-Za-z_]+)\)",
    re.IGNORECASE,
)
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _limit_line(output: str) -> str | None:
    """The usage-limit line, if one of the last _LIMIT_TAIL_LINES lines IS that message."""
    for raw in output.splitlines()[-_LIMIT_TAIL_LINES:]:
        line = _TUI_PREFIX.sub("", raw).strip()
        if _LIMIT_LINE.match(line):
            return line
    return None


def format_reset(epoch: float) -> str:
    """Reset time for user-facing text, WITHOUT colons: the public-payload redactor's
    IPv6 pattern matches any HH:MM:SS and would turn an ISO-8601 time into [redacted]."""
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d %H%MZ")


def derive_lane_state(session: dict[str, Any], now: float | None = None) -> tuple[str, str | None]:
    """Derive lane state from session data.

    Returns: (lane_state, lane_error_or_none)
    - "initializing" if under grace period and not idle
    - "ready" if terminal reached idle/processing/completed/waiting_user_answer
    - "stopped" if terminal was once ready but is now gone
    - "init_failed" if past grace period and never reached idle/terminal gone
    - "blocked_usage_limit" if usage limit detected
    """
    if now is None:
        now = time.time()

    # Check for usage limit first (overrides other states)
    limit_state, limit_error = _check_usage_limit(session, now)
    if limit_state == "blocked_usage_limit":
        return "blocked_usage_limit", None  # lane_error handled in task_status

    launched_at = session.get("launched_at")
    if launched_at is None:
        # No launch time recorded; assume we're initializing
        return "initializing", None

    # Terminal status
    terminal_status = session.get("terminal_status")

    # Track ready states (D3: mark ever_ready when first reached)
    ready_states = ("idle", "processing", "completed", "waiting_user_answer")
    if terminal_status in ready_states:
        # Mark as ever_ready on first encounter
        if not session.get("ever_ready"):
            session["ever_ready"] = True
            session["ready_at"] = now
        return "ready", None

    # D3: If terminal is gone but was once ready, return "stopped" not "init_failed"
    ever_ready = session.get("ever_ready", False)
    confirmed_gone = session.get("_session_confirmed") and session.get("_terminals_in_response") and terminal_status is None

    if ever_ready:
        # Once ready, a lane that is no longer in a ready state stopped (404 after
        # teardown, handed off, or stopped) — it never "failed to initialize".
        # The 404 path returns the stored dict WITHOUT the _session_confirmed /
        # _terminals_in_response flags, so this must not depend on confirmed_gone.
        return "stopped", None

    # Time since launch
    elapsed = now - launched_at

    # Within grace period
    if elapsed < INIT_GRACE_S:
        return "initializing", None

    # Past grace period and never reached ready states
    if confirmed_gone:
        error = "Lane terminal was destroyed; initialization may have failed or been interrupted."
        return "init_failed", error
    if terminal_status is None or terminal_status == "running":
        error = "Lane did not reach a ready state (idle/processing/completed) within initialization grace period."
        return "init_failed", error

    # Fallback (should not reach here)
    return "ready", None


def _check_usage_limit(session: dict[str, Any], now: float) -> tuple[str, str | None]:
    """("blocked_usage_limit", None) when the lane's own last answer is the limit refusal."""
    if session.get("terminal_status") not in _LIMIT_STATES:
        return "", None
    line = _limit_line(session.get("terminal_output") or "")
    if line is None:
        return "", None
    reset_time = _parse_reset_time(line, now)
    if reset_time is None:
        logger.warning("usage-limit reset unparseable; backing off %ss", LIMIT_BACKOFF_S)
        reset_time = now + LIMIT_BACKOFF_S
    session["blocked_until"] = reset_time
    return "blocked_usage_limit", None


def _parse_reset_time(text: str, now: float | None = None) -> float | None:
    """Epoch of the reset named in a limit line, or None if it can't be parsed.

    Time-only ("12am") = next occurrence. Dated ("Sep 12 at 12am") = that date this
    year, or next year if it has already passed (weekly limits render with a date).
    """
    m = _RESET_RE.search(text)
    if not m:
        return None
    try:
        tz = ZoneInfo(m.group("tz"))
    except Exception:  # noqa: BLE001 — unknown zone → caller backs off
        logger.warning("unknown timezone in usage-limit line: %s", m.group("tz"))
        return None
    hour, minute = int(m.group("h")), int(m.group("m") or 0)
    ampm = (m.group("ampm") or "").lower()
    if ampm == "am" and hour == 12:
        hour = 0
    elif ampm == "pm" and hour != 12:
        hour += 12
    if hour > 23 or minute > 59:
        return None
    current = datetime.fromtimestamp(now if now is not None else time.time(), tz)
    if m.group("mon"):
        month = _MONTHS.get(m.group("mon")[:3].lower())
        if month is None:
            return None
        target = current.replace(month=month, day=int(m.group("day")), hour=hour,
                                 minute=minute, second=0, microsecond=0)
        if target <= current:
            target = target.replace(year=target.year + 1)
    else:
        target = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= current:
            target += timedelta(days=1)
    return target.timestamp()


def check_repo_trust(repo_path: str, reader_func: Any = None, provisioner: Any = None) -> bool:
    """Check if repository is trusted in ~/.claude.json.

    D2: Reads ~/.claude.json ON THE TARGET NODE when provisioner has ssh_host set.

    Args:
        repo_path: Full path to the repository
        reader_func: Optional injected reader function for testing
        provisioner: Optional WorktreeProvisioner with ssh_host for remote reads

    Returns:
        True if trusted, False if not trusted or cannot determine

    Raises:
        ValueError: If trust state cannot be determined (file unreadable, etc.)
    """
    if reader_func is not None:
        return reader_func(repo_path)

    # Skip check if env var is set
    if os.getenv("FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT"):
        logger.warning("Skipping repository trust preflight (FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT=1)")
        return True

    # D2: Read from target node if provisioner has ssh_host
    if provisioner and provisioner.ssh_host:
        # Ask the TARGET node for ONE value. Only "True"/"False"/"MISSING"/"BADKEY"
        # crosses the wire, so the rest of its ~/.claude.json (account/key
        # material) never enters this process. repo_path travels as argv, not code.
        import subprocess

        probe = (
            "import json,os,sys\n"
            "p=json.load(open(os.path.expanduser('~/.claude.json'))).get('projects',{})\n"
            "e=p.get(sys.argv[1])\n"
            "print('MISSING' if not isinstance(e,dict) else "
            "('BADKEY' if 'hasTrustDialogAccepted' not in e else bool(e['hasTrustDialogAccepted'])))\n"
        )
        try:
            result = provisioner._run(["python3", "-c", probe, repo_path], timeout=10)
        except subprocess.TimeoutExpired:
            raise ValueError("trust state unknown: timeout reading ~/.claude.json on target node")
        verdict = (result.stdout or "").strip().splitlines()[-1:] if result.returncode == 0 else []
        if verdict == ["True"]:
            return True
        if verdict == ["False"]:
            return False
        reason = verdict[0] if verdict else f"probe exit {result.returncode}"
        raise ValueError(f"trust state unknown on target node for {repo_path}: {reason}")
    else:
        # Local read (Bravo, no ssh_host)
        try:
            claude_json_path = os.path.expanduser("~/.claude.json")
            with open(claude_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            raise ValueError("trust state unknown: ~/.claude.json not found")
        except (json.JSONDecodeError, OSError) as e:
            raise ValueError(f"trust state unknown: failed to read/parse ~/.claude.json: {e}")

    projects = data.get("projects", {})
    if repo_path not in projects:
        raise ValueError(f"trust state unknown: project entry not found for {repo_path}")

    entry = projects[repo_path]
    if not isinstance(entry, dict):
        raise ValueError("trust state unknown: project entry is not an object")

    trust = entry.get("hasTrustDialogAccepted", False)
    if not trust:
        return False

    return True
