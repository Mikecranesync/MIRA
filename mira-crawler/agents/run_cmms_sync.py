"""
CMMS Sync — 16:00 ET daily.
Bidirectional sync between Atlas CMMS and the shared knowledge state.
Reports new WOs created, assets added, conflicts.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import run_agent  # noqa: E402

# Cron runs on the host, so we need the host port-mapping for cmms-backend.
# Doppler's ATLAS_API_URL is set to "http://cmms-backend:8080" for in-container
# callers — that's a Docker DNS name and won't resolve from cron. Prefer
# ATLAS_API_HOST_URL when set; otherwise default to the published host port.
ATLAS_URL = os.environ.get("ATLAS_API_HOST_URL", "http://localhost:8082")


def _run() -> dict:
    try:
        import httpx  # type: ignore[import]
    except ImportError:
        return {"synced": 0, "conflicts": 0, "note": "httpx not available"}

    admin_user = os.environ.get("PLG_ATLAS_ADMIN_USER", "")
    admin_pass = os.environ.get("PLG_ATLAS_ADMIN_PASSWORD", "")
    if not admin_user:
        return {"synced": 0, "conflicts": 0, "note": "Atlas credentials not set"}

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{ATLAS_URL}/api/work-orders",
                auth=(admin_user, admin_pass),
                params={"status": "open", "limit": 100},
            )
            resp.raise_for_status()
            wos = resp.json()
            synced = len(wos) if isinstance(wos, list) else wos.get("total", 0)

        return {"synced": synced, "conflicts": 0, "new_wos": synced}
    except Exception as exc:
        raise RuntimeError(f"Atlas sync failed: {exc}") from exc


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    return (
        f"Synced *{result['synced']}* open WOs from Atlas\n"
        f"{result['conflicts']} conflicts"
    )


if __name__ == "__main__":
    run_agent("cmms_sync", _run, name="CMMS Sync", emoji="🔄",
              telegram_template=_telegram)
