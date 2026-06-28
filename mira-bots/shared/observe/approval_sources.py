"""Approval-source resolution for live-turn governance checks (Phase 3).

The governance/incident checks need an ``ApprovalRegistry``. On a live turn the
trace is assembled inside ``engine._schedule_decision_trace``, which runs in the
reply path (before ``return reply``). So the approval source here MUST be
**in-memory and cheap** — never a per-turn database read, which would add latency
to every answer.

This module resolves a registry from ``MIRA_APPROVALS_PATH`` (a JSON file in the
``approvals.example.json`` shape) and caches it by (path, mtime), so an operator
edit is picked up without re-reading on every turn, and a missing/unset path
costs nothing. When unset, an empty registry is returned (governs-closed — every
answer is flagged; that is why live checks are opt-in via ``MIRA_TRACE_CHECKS=1``).

**Deliberately NOT done here:** reading the live ``asset_agent_status`` table per
turn. That is the canonical asset-approval source, but a blocking DB read in the
reply path is unacceptable. The correct wiring is a background refresher that
periodically dumps ``asset_agent_status`` into the cached registry (or the JSON
file) out-of-band; ``ApprovalRegistry.with_agent_store`` is the hook for it. That
non-blocking refresh is the remaining Phase-3 slice — see the plan.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from shared.observe.approval_registry import ApprovalRegistry

logger = logging.getLogger("mira-gsd.observe")

# Cache: path -> (mtime, registry). Avoids re-reading the JSON every turn.
_CACHE: dict[str, tuple[float, ApprovalRegistry]] = {}
_EMPTY = ApprovalRegistry.empty()


def resolve_registry() -> ApprovalRegistry:
    """Return the approval registry for live checks (cached, no DB, fail-open).

    Source is ``MIRA_APPROVALS_PATH`` (JSON). Cached by file mtime so edits are
    picked up but unchanged files are not re-read. Any error → the empty registry
    (govern-closed), never an exception into the reply path.
    """
    path = os.getenv("MIRA_APPROVALS_PATH")
    if not path:
        return _EMPTY
    try:
        p = Path(path)
        mtime = p.stat().st_mtime
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == mtime:
            return cached[1]
        registry = ApprovalRegistry.load(p)
        _CACHE[path] = (mtime, registry)
        return registry
    except Exception as exc:  # noqa: BLE001 — fail-open to empty registry
        logger.debug("approval registry load failed (%s): %s", path, exc)
        return _EMPTY


def checks_enabled() -> bool:
    """True when live-turn governance/incident checks are opted in."""
    return os.getenv("MIRA_TRACE_CHECKS") == "1"


def _clear_cache() -> None:
    """Test hook — drop the mtime cache."""
    _CACHE.clear()


def registry_or_none() -> Optional[ApprovalRegistry]:
    """The registry to run checks against, or None when checks are disabled."""
    return resolve_registry() if checks_enabled() else None
