"""
Carlos (KB Growth) — 02:00 ET daily.
Ingests the next manual from the queue. Reads nothing upstream.
Writes: manual name, chunk count, entities extracted.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import run_agent  # noqa: E402

QUEUE_FILE = _REPO / "mira-crawler" / "cron" / "manual_queue.json"
PIPELINE = _REPO / "mira-crawler" / "tasks" / "full_ingest_pipeline.py"


def _run() -> dict:
    queue = json.loads(QUEUE_FILE.read_text())
    pending = [e for e in queue if e.get("status") == "pending"]
    if not pending:
        return {"manual": "none", "chunks": 0, "entities": 0, "remaining": 0, "note": "Queue empty"}

    entry = pending[0]
    name = f"{entry.get('manufacturer', '')} {entry.get('model', '')}".strip()

    result = subprocess.run(
        [sys.executable, str(PIPELINE),
         "--pdf-url", entry["url"],
         "--manufacturer", entry["manufacturer"],
         "--model", entry["model"],
         "--type", entry.get("type", "installation_manual"),
         "--no-quality-gate"],
        capture_output=True, text=True, timeout=900,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr[-300:] if result.stderr else "pipeline failed")

    # Parse chunk count from stdout if available
    chunks = 0
    for line in result.stdout.splitlines():
        if "chunk" in line.lower() and any(c.isdigit() for c in line):
            import re
            m = re.search(r"(\d+)\s+chunk", line, re.IGNORECASE)
            if m:
                chunks = int(m.group(1))
                break

    # Update queue entry status
    for e in queue:
        if e.get("url") == entry["url"]:
            e["status"] = "done"
    QUEUE_FILE.write_text(json.dumps(queue, indent=2))

    remaining = len([e for e in queue if e.get("status") == "pending"]) - 1

    return {"manual": name, "chunks": chunks, "entities": 0, "remaining": max(0, remaining)}


def _telegram(result: dict) -> str:
    if result.get("note") == "Queue empty":
        return "Queue empty — nothing to ingest today."
    return (
        f"Ingested *{result['manual']}*\n"
        f"{result['chunks']} chunks indexed · {result['entities']} entities extracted\n"
        f"Queue: {result['remaining']} remaining"
    )


if __name__ == "__main__":
    run_agent("kb_growth", _run, name="Carlos (KB Growth)", emoji="📚",
              telegram_template=_telegram)
