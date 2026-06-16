"""Post filtering logic for the MIRA Reddit bot.

Three-layer filter:
1. Eligibility — self-post, not locked/deleted, within age limit
2. Content relevance — diagnostic keywords + question heuristic (ported from reddit_harvest.py)
3. Not already well-answered — comment count threshold
"""

from __future__ import annotations

import re
import time

# Ported from mira-core/scripts/reddit_harvest.py — proven on the target subreddits
DIAGNOSTIC_KEYWORDS = re.compile(
    r"(fault|error|alarm|trip|fail|diagnos|troubleshoot|not working|won'?t start"
    r"|keeps? (tripping|failing|shutting|stopping|faulting|blowing|overload)"
    r"|help (with|me)|how (do|can|to|would)|what (is|does|could|should|causes?)"
    r"|why (does|is|did|would)|need help|anyone (know|have|seen|dealt)"
    r"|overload|overcurrent|overheat|vibrat|bearing|blown|tripped"
    r"|vfd|drive|motor|pump|compressor|plc|hmi|sensor|actuator|valve|conveyor"
    r"|wiring|voltage|current|pressure|temperature|replace|check|reading|showing)",
    re.IGNORECASE,
)

QUESTION_STARTS = (
    "how",
    "why",
    "what",
    "when",
    "is it",
    "can i",
    "does anyone",
    "anyone",
    "need help",
    "help with",
    "trying to",
    "fault",
    "error",
    "alarm",
    "not working",
    "keeps",
    "will not",
    "wont",
    "won't",
)


def _is_maintenance_question(title: str, selftext: str) -> bool:
    """Check if post content looks like a maintenance diagnostic question."""
    combined = title + " " + selftext
    if not DIAGNOSTIC_KEYWORDS.search(combined):
        return False
    t = title.strip().lower()
    if t.endswith("?"):
        return True
    return any(t.startswith(p) for p in QUESTION_STARTS)


def should_respond(
    post: dict,
    *,
    max_post_age_hours: int = 24,
    max_existing_comments: int = 10,
) -> bool:
    """Three-layer filter deciding whether MIRA should reply to a Reddit post.

    Args:
        post: Reddit post data dict (from API listing)
        max_post_age_hours: Ignore posts older than this
        max_existing_comments: Skip posts that already have many replies

    Returns:
        True if the bot should respond to this post
    """
    # Layer 1: basic eligibility
    if not post.get("is_self"):
        return False
    if post.get("locked") or post.get("removed_by_category"):
        return False
    author = post.get("author", "")
    if not author or author == "[deleted]":
        return False
    selftext = post.get("selftext", "")
    if selftext == "[removed]":
        return False

    # Age check
    created_utc = post.get("created_utc", 0)
    if created_utc:
        age_hours = (time.time() - created_utc) / 3600
        if age_hours > max_post_age_hours:
            return False

    # Layer 2: content relevance
    title = post.get("title", "")
    if not _is_maintenance_question(title, selftext):
        return False

    # Layer 3: not already well-answered
    if post.get("num_comments", 0) > max_existing_comments:
        return False

    return True
