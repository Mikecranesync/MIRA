"""Failure-penalized median minutes from replayed sessions (Pain 3 metric).

Input: JSONL, one session per line:
  {"session_id": str, "fault_asked_at": ISO-8601 (tz-aware),
   "first_cited_step_at": ISO-8601 (tz-aware) or null,
   "outcome": "resolved" | "failed" | "abandoned", "arm": str (optional)}

Rules:
  * completed = outcome "resolved" AND first_cited_step_at not null.
  * completed elapsed minutes = first_cited_step_at - fault_asked_at.
  * every other session ranks at +infinity for the median.
  * median over all sessions in the group (penalized); even n = mean of the
    two middle values; an infinite middle value makes the median infinite.
  * p25 / p75 use completed sessions only (linear interpolation).
  * always reported beside n and completion rate. No means.

Stdlib only. Deterministic. No LLM.
Usage: python3 median_minutes.py <sessions.jsonl>
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime

OUTCOMES = frozenset({"resolved", "failed", "abandoned"})
UNLABELED = "unlabeled"


def _parse_ts(value: object, field: str, session_id: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{session_id}: {field} must be an ISO-8601 string")
    try:
        ts = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{session_id}: {field} not ISO-8601: {value!r}") from exc
    if ts.tzinfo is None:
        raise ValueError(f"{session_id}: {field} must be timezone-aware: {value!r}")
    return ts


def load_sessions(path: str) -> list[dict]:
    """Read and validate a JSONL file. Raises ValueError on any bad row."""
    sessions: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"line {lineno}: invalid JSON: {exc}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"line {lineno}: row must be a JSON object")
            for key in ("session_id", "fault_asked_at", "first_cited_step_at", "outcome"):
                if key not in row:
                    raise ValueError(f"line {lineno}: missing key {key!r}")
            penalized_minutes(row)  # validates timestamps and outcome
            sessions.append(row)
    return sessions


def _is_completed(session: dict) -> bool:
    return session["outcome"] == "resolved" and session["first_cited_step_at"] is not None


def _elapsed_minutes(session: dict) -> float | None:
    """Elapsed minutes for a completed session; None when unsuccessful. Validates input."""
    sid = session.get("session_id")
    if session.get("outcome") not in OUTCOMES:
        raise ValueError(f"{sid}: outcome must be one of {sorted(OUTCOMES)}")
    asked = _parse_ts(session.get("fault_asked_at"), "fault_asked_at", sid)
    cited_raw = session.get("first_cited_step_at")
    if cited_raw is None:
        return None
    cited = _parse_ts(cited_raw, "first_cited_step_at", sid)
    delta = (cited - asked).total_seconds() / 60.0
    if delta < 0:
        raise ValueError(f"{sid}: first_cited_step_at is before fault_asked_at")
    return delta if _is_completed(session) else None


def penalized_minutes(session: dict) -> float:
    """Minutes for a completed session; +infinity for any other session."""
    elapsed = _elapsed_minutes(session)
    return math.inf if elapsed is None else elapsed


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    vals = sorted(values)
    n = len(vals)
    mid = n // 2
    if n % 2:
        return vals[mid]
    lo, hi = vals[mid - 1], vals[mid]
    if math.isinf(lo) or math.isinf(hi):
        return math.inf
    return (lo + hi) / 2.0


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    floor_i = math.floor(k)
    ceil_i = math.ceil(k)
    frac = k - floor_i
    return sorted_vals[floor_i] + (sorted_vals[ceil_i] - sorted_vals[floor_i]) * frac


def _group_stats(sessions: list[dict]) -> dict:
    penalized = [penalized_minutes(s) for s in sessions]
    completed = sorted(p for p in penalized if not math.isinf(p))
    n = len(sessions)
    median = _median(penalized)
    median_is_inf = median is not None and math.isinf(median)
    return {
        "n": n,
        "completed": len(completed),
        "completion_rate": len(completed) / n if n else None,
        "median_minutes": None if (median is None or median_is_inf) else median,
        "median_is_inf": median_is_inf,
        "p25_minutes": _percentile(completed, 0.25),
        "p75_minutes": _percentile(completed, 0.75),
    }


def summarize(sessions: list[dict]) -> dict:
    """Return {"arms": {arm: stats}, "overall": stats}. Raises ValueError if empty."""
    if not sessions:
        raise ValueError("no sessions to summarize")
    by_arm: dict[str, list[dict]] = {}
    for s in sessions:
        arm = s.get("arm") or UNLABELED
        by_arm.setdefault(str(arm), []).append(s)
    return {
        "arms": {arm: _group_stats(by_arm[arm]) for arm in sorted(by_arm)},
        "overall": _group_stats(sessions),
    }


def _fmt(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _table(result: dict) -> str:
    header = f"{'arm':<16}{'n':>5}{'done':>6}{'compl%':>8}{'median':>10}{'p25':>9}{'p75':>9}"
    rows = [header, "-" * len(header)]
    groups = list(result["arms"].items()) + [("overall", result["overall"])]
    for name, st in groups:
        median = "inf" if st["median_is_inf"] else _fmt(st["median_minutes"])
        rows.append(
            f"{name:<16}{st['n']:>5}{st['completed']:>6}"
            f"{st['completion_rate'] * 100:>7.1f}%{median:>10}"
            f"{_fmt(st['p25_minutes']):>9}{_fmt(st['p75_minutes']):>9}"
        )
    return "\n".join(rows)


def _json_safe(result: dict) -> dict:
    """JSON cannot hold inf; median_minutes is null and median_is_inf carries the fact."""
    out = {"arms": {}, "overall": None}
    for name, st in result["arms"].items():
        out["arms"][name] = dict(st)
    out["overall"] = dict(result["overall"])
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: median_minutes.py <sessions.jsonl>", file=sys.stderr)
        return 2
    try:
        result = summarize(load_sessions(args[0]))
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(_table(result))
    print(json.dumps(_json_safe(result), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
