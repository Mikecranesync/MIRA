"""Coverage ledger — append-only JSONL, one record per turn + one per verdict.

Enables exact replay (campaign id, conv id, seed, deploy SHA, full turns) and
resume (completed conv ids are skipped). Server-side facts the wire cannot see
(routes, gates, tool calls) are NOT recorded here — they live in the staging
container logs; the ledger records everything observable from the Telegram side.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

LEDGER_DIR = Path(__file__).parent / "ledger"
FROZEN_DIR = Path(__file__).parent / "frozen"


def _path(campaign_id: str) -> Path:
    LEDGER_DIR.mkdir(parents=True, exist_ok=True)
    return LEDGER_DIR / f"{campaign_id}.jsonl"


def append(campaign_id: str, record: dict) -> None:
    record["ts"] = datetime.now(timezone.utc).isoformat()
    with open(_path(campaign_id), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def turn(campaign_id, conv_id, tier, idx, role, text, **kw):
    append(
        campaign_id, dict(kind="turn", conv=conv_id, tier=tier, i=idx, role=role, text=text, **kw)
    )


def verdict(campaign_id, conv_id, tier, verdict, category="", notes="", **kw):
    append(
        campaign_id,
        dict(
            kind="verdict",
            conv=conv_id,
            tier=tier,
            verdict=verdict,
            category=category,
            notes=notes,
            **kw,
        ),
    )


def completed_convs(campaign_id: str) -> set[str]:
    p = _path(campaign_id)
    done = set()
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("kind") == "verdict":
                done.add(r.get("conv"))
    return done


def freeze(campaign_id: str, conv_id: str, transcript: list[dict], meta: dict) -> Path:
    """Spec 'Automatic Defect Loop' step 1-3: freeze the conversation."""
    FROZEN_DIR.mkdir(parents=True, exist_ok=True)
    p = FROZEN_DIR / f"{campaign_id}_{conv_id}.json"
    p.write_text(
        json.dumps({"meta": meta, "transcript": transcript}, indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    return p
