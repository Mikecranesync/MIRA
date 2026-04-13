"""LinkedIn draft generation — Celery task applying Frankie Fihn's framework.

Reads voice profile, topic backlog, and weights from /app/linkedin/ (baked into
the Docker image). Writes markdown drafts to /data/linkedin/drafts/ (host volume
mount). Stores metadata in Redis for Grafana dashboard display.

Scheduled via Celery beat: Mon/Wed/Fri 12:00 UTC (8am ET).
Manual trigger: celery -A mira_crawler.celery_app call linkedin.draft_post
"""

from __future__ import annotations

import json
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import httpx
import redis
import yaml

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("linkedin-drafter")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
LINKEDIN_DIR = Path(os.getenv("LINKEDIN_CONFIG_DIR", "/app/linkedin"))
DRAFTS_DIR = Path(os.getenv("LINKEDIN_DRAFTS_DIR", "/data/linkedin/drafts"))

POST_TYPES = [
    "pain_story",
    "hot_take",
    "case_study",
    "myth_bust",
    "community",
    "hand_raiser",
    "insight",
    "general_ai_maintenance",
]

DRAFT_TOOL = {
    "name": "save_linkedin_draft",
    "description": "Return a LinkedIn post draft structured per Fihn framework.",
    "input_schema": {
        "type": "object",
        "required": [
            "hook",
            "qualifier",
            "body",
            "cta",
            "post_type",
            "cta_type",
            "hand_raiser_angle",
            "full_post",
        ],
        "properties": {
            "hook": {
                "type": "string",
                "description": "First 2 lines. Scene-drop, not a claim. Stops the scroll.",
            },
            "qualifier": {
                "type": "string",
                "description": "One-line audience filter.",
            },
            "body": {
                "type": "string",
                "description": "3-5 short paragraphs. Specific shop-floor language.",
            },
            "cta": {
                "type": "string",
                "description": "Single clear ask. Never more than one.",
            },
            "post_type": {
                "type": "string",
                "enum": POST_TYPES,
            },
            "cta_type": {
                "type": "string",
                "enum": ["comment", "dm", "link", "engagement"],
            },
            "hand_raiser_angle": {
                "type": "string",
                "description": "One sentence on why this should produce hand raisers.",
            },
            "full_post": {
                "type": "string",
                "description": "900-1400 chars. Ready to paste. No em-dashes. 3-5 hashtags.",
            },
        },
    },
}


def _pick_post_type(recent: list[dict]) -> str:
    """Weighted random selection from weights.yml with adjacent-duplicate guard."""
    weights_path = LINKEDIN_DIR / "weights.yml"
    weights = yaml.safe_load(weights_path.read_text())["weights"]

    # Avoid the same type as the last 2 posts
    recent_types = {x["post_type"] for x in recent[:2]}
    pool = {t: w for t, w in weights.items() if t not in recent_types}
    if not pool:
        pool = weights

    types, w = zip(*pool.items())
    return random.choices(types, weights=w, k=1)[0]


def _build_user_prompt(post_type: str, recent: list[dict], today: datetime) -> str:
    """Build the user message from the prompt template."""
    template = (LINKEDIN_DIR / "prompt_template.md").read_text()
    topics = (LINKEDIN_DIR / "topics.md").read_text()
    recent_hooks = "\n".join(
        f"- [{x['post_type']}] {x['hook'][:100]}" for x in recent
    )
    return template.format(
        post_type=post_type,
        today=today.strftime("%A %Y-%m-%d"),
        topics=topics,
        recent_hooks=recent_hooks or "(none yet — this is the first post)",
    )


def _format_markdown(draft: dict, ts: datetime) -> str:
    """Format the draft as a markdown file for review."""
    return f"""# LinkedIn Draft — {ts.strftime("%Y-%m-%d")}
**Type:** {draft.get("post_type", "unknown")}
**CTA Type:** {draft.get("cta_type", "unknown")}
**Hand Raiser Angle:** {draft.get("hand_raiser_angle", "")}

**Hook:**
{draft.get("hook", "")}

**Qualifier:**
{draft.get("qualifier", "")}

---

{draft.get("full_post", "")}

---
_Generated {ts.isoformat()} | Applied Fihn framework_
"""


@app.task(name="linkedin.draft_post", bind=True, max_retries=2, default_retry_delay=120)
def draft_post(self, post_type: str | None = None) -> dict:
    """Generate one LinkedIn draft applying Fihn's framework.

    Args:
        post_type: Force a specific type. If None, picks via weighted random.

    Returns:
        dict with filepath, post_type, and hook.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set — cannot generate LinkedIn draft")
        return {"error": "ANTHROPIC_API_KEY not set"}

    broker_url = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    r = redis.Redis.from_url(broker_url, decode_responses=True)

    # 1. Read recent history from Redis
    recent_json = r.zrevrange("linkedin:drafts", 0, 9)
    recent = [json.loads(x) for x in recent_json]

    # 2. Pick post type
    if post_type is None:
        post_type = _pick_post_type(recent)

    logger.info("Drafting LinkedIn post: type=%s", post_type)

    # 3. Build prompts
    today = datetime.now(timezone.utc)
    voice = (LINKEDIN_DIR / "voice.md").read_text()
    user_prompt = _build_user_prompt(post_type, recent, today)

    # 4. Call Claude via httpx + tool_use
    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
    try:
        resp = httpx.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 2000,
                "system": voice,
                "tools": [DRAFT_TOOL],
                "tool_choice": {"type": "tool", "name": "save_linkedin_draft"},
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=90,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Anthropic API call failed: %s", exc)
        raise self.retry(exc=exc)

    # 5. Extract tool_use block
    draft = None
    for block in resp.json().get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "save_linkedin_draft":
            draft = block["input"]
            break
    if draft is None:
        raise RuntimeError("Claude did not call save_linkedin_draft tool")

    # 6. Write markdown draft file
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    date_str = today.strftime("%Y-%m-%d")
    filename = f"{date_str}-{post_type}.md"
    filepath = DRAFTS_DIR / filename
    filepath.write_text(_format_markdown(draft, today))
    logger.info("Draft saved: %s", filepath)

    # 7. Record metadata in Redis
    metadata = {
        "date": date_str,
        "post_type": post_type,
        "hook": draft.get("hook", "")[:200],
        "cta_type": draft.get("cta_type", ""),
        "hand_raiser_angle": draft.get("hand_raiser_angle", "")[:200],
        "path": str(filepath),
        "generated_at": today.isoformat(),
    }
    ts = int(today.timestamp())
    r.zadd("linkedin:drafts", {json.dumps(metadata): ts})
    r.expire("linkedin:drafts", 90 * 86400)  # 90-day TTL
    r.incr(f"linkedin:stats:generated:{post_type}")

    return {"filepath": str(filepath), "post_type": post_type, "hook": draft.get("hook", "")}
