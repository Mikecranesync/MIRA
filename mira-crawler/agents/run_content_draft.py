"""
Content Team — 12:00 ET daily.
Reads KB growth + lead scout results. Drafts a LinkedIn post.
Appends to linkedin_queue.json for review before publishing.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import get_agent_result, run_agent  # noqa: E402

QUEUE_FILE = _REPO / "mira-crawler" / "social" / "linkedin_queue.json"


def _draft_post(manual: str, leads: int) -> str:
    parts: list[str] = []

    if manual and manual != "none":
        parts.append(
            f"Just added the {manual} to the FactoryLM knowledge base.\n\n"
            f"Every technician at every plant running FactoryLM now has instant access "
            f"to every fault code, every spec, every procedure — cited by page.\n\n"
            f"That's not a search engine. That's institutional memory."
        )
    elif leads > 0:
        parts.append(
            f"Identified {leads} manufacturing facilities in today's search that match "
            f"our ICP — maintenance-heavy, multi-line, paper-based.\n\n"
            f"The problem we solve is everywhere. The buyers are ready.\n\n"
            f"factorylm.com"
        )
    else:
        parts.append(
            "The gap between what's in your OEM manuals and what your techs can actually "
            "find at 2 AM is the real cost of unplanned downtime.\n\n"
            "FactoryLM closes that gap.\n\nfactorylm.com"
        )

    return "\n".join(parts)


def _run() -> dict:
    kb = get_agent_result("kb_growth") or {}
    leads = get_agent_result("lead_scout") or {}

    manual = kb.get("manual", "none")
    lead_count = leads.get("found", 0)

    post = _draft_post(manual, lead_count)

    # Load existing queue
    queue: list[dict] = []
    if QUEUE_FILE.exists():
        try:
            queue = json.loads(QUEUE_FILE.read_text())
        except Exception:
            queue = []

    # Check if we already have a pending post for today
    today_str = str(date.today())
    already_queued = any(
        item.get("date") == today_str and item.get("status") == "pending"
        for item in queue
    )

    draft_ready = False
    if not already_queued:
        queue.append({
            "date": today_str,
            "status": "pending",
            "content": post,
            "source": "content_agent",
            "based_on": {
                "manual": manual,
                "leads_found": lead_count,
            },
        })
        QUEUE_FILE.write_text(json.dumps(queue, indent=2))
        draft_ready = True

    return {
        "draft_ready": draft_ready,
        "based_on_manual": manual,
        "based_on_leads": lead_count,
        "preview": post[:100] + "...",
    }


def _telegram(result: dict) -> str:
    if not result["draft_ready"]:
        return "Draft already queued for today — skipped."
    return (
        f"Draft ready for review:\n"
        f"_\"{result['preview']}\"\n_"
        f"\nApprove to publish Thu · "
        f"Based on: {result['based_on_manual'] or str(result['based_on_leads']) + ' leads'}"
    )


if __name__ == "__main__":
    run_agent("content_draft", _run, name="Content Team", emoji="📱",
              telegram_template=_telegram)
