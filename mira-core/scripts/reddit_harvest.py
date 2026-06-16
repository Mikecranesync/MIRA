#!/usr/bin/env python3
"""Reddit Question Harvester — Public JSON endpoints, zero credentials.

Uses Reddit search to find help-seeking / diagnostic posts, stores title + selftext
so the Supervisor has enough context to produce real diagnoses.

Usage:
    python mira-core/scripts/reddit_harvest.py

Env vars (optional):
    MIRA_DB_PATH — SQLite path (default: ./data/mira.db)
"""

import logging
import os
import re
import sys
import time

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("reddit-harvest")

# Add mira-bots to path so we can import shared.benchmark_db
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.benchmark_db import count_questions, ensure_tables, insert_question  # noqa: E402

SUBREDDITS = [
    "IndustrialMaintenance",
    "PLC",
    "electricians",
    "HVAC",
    "AutomationTechnology",
]

USER_AGENT = "MIRA-Benchmark/1.0 by FactoryLM (non-commercial research)"

# Search queries — each query is run per subreddit via /search.json
SEARCH_QUERIES = [
    "fault code troubleshoot",
    "error not working help",
    "VFD drive motor problem",
    "sensor alarm tripping",
    "PLC fault diagnosis",
    "overload failure bearing",
]

# Keywords that indicate a real diagnostic / help-seeking post
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


def _is_relevant(title: str, selftext: str) -> bool:
    """Post must contain a diagnostic keyword in title or body AND look like a question."""
    combined = title + " " + selftext
    if not DIAGNOSTIC_KEYWORDS.search(combined):
        return False
    # Must end with ? OR start with a question/help word
    t = title.strip().lower()
    if t.endswith("?"):
        return True
    question_starts = (
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
    return any(t.startswith(p) for p in question_starts)


def _normalize_title(title: str) -> str:
    """Normalize title for dedup: lowercase, strip non-alphanumeric."""
    return re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()


def _fetch_search(sub: str, query: str, client: httpx.Client) -> list[dict]:
    """Search a subreddit via /search.json. Returns up to 100 posts."""
    params = {
        "q": query,
        "restrict_sr": "on",
        "sort": "relevance",
        "t": "year",
        "limit": 100,
        "type": "link",
    }
    url = f"https://www.reddit.com/r/{sub}/search.json"
    try:
        resp = client.get(url, params=params)
    except httpx.HTTPError as exc:
        logger.warning("r/%s search '%s' — HTTP error: %s", sub, query, exc)
        return []

    if resp.status_code == 429:
        logger.warning("Rate limited on r/%s — skipping", sub)
        return []
    if resp.status_code in (403, 404):
        logger.warning("r/%s returned %d — skipping", sub, resp.status_code)
        return []
    if resp.status_code != 200:
        logger.warning("r/%s search '%s' — status %d", sub, query, resp.status_code)
        return []

    data = resp.json().get("data", {})
    return data.get("children", [])


def harvest(db_path: str | None = None) -> dict:
    """Harvest Reddit questions via public JSON search and store in benchmark_questions.

    Returns {"harvested": int, "skipped": int, "total": int}.
    """
    ensure_tables(db_path)

    total_inserted = 0
    total_skipped = 0
    seen_norms: set[str] = set()
    seen_post_ids: set[str] = set()

    headers = {"User-Agent": USER_AGENT}

    with httpx.Client(headers=headers, timeout=30, follow_redirects=True) as client:
        for sub in SUBREDDITS:
            logger.info("Searching r/%s ...", sub)
            sub_inserted = 0
            sub_filtered = 0
            sub_fetched = 0
            sub_skipped = 0

            for query in SEARCH_QUERIES:
                time.sleep(2)  # rate-limit between requests

                try:
                    raw_posts = _fetch_search(sub, query, client)
                except Exception as exc:
                    logger.error("r/%s search '%s' — error: %s", sub, query, exc)
                    continue

                sub_fetched += len(raw_posts)

                for child in raw_posts:
                    post = child.get("data", {})
                    title = post.get("title", "").strip()
                    selftext = post.get("selftext", "").strip()
                    post_id = post.get("id", "")

                    if not title or not post_id:
                        continue

                    # Skip if already seen this post in this run (cross-query dedup)
                    if post_id in seen_post_ids:
                        continue
                    seen_post_ids.add(post_id)

                    # Must be a self post with actual content
                    if not post.get("is_self", False):
                        continue

                    if not _is_relevant(title, selftext):
                        continue
                    sub_filtered += 1

                    # Title-normalization dedup
                    norm = _normalize_title(title)
                    if norm in seen_norms:
                        sub_skipped += 1
                        total_skipped += 1
                        continue
                    seen_norms.add(norm)

                    score = post.get("score", 0)
                    permalink = post.get("permalink", "")
                    url = f"https://reddit.com{permalink}" if permalink else ""

                    row_id = insert_question(
                        title=title,
                        body=selftext[:2000],  # store selftext, capped at 2k chars
                        subreddit=sub,
                        post_id=post_id,
                        score=score,
                        url=url,
                        db_path=db_path,
                    )
                    if row_id > 0:
                        sub_inserted += 1
                        total_inserted += 1
                    else:
                        sub_skipped += 1
                        total_skipped += 1

            print(
                f"r/{sub}: fetched {sub_fetched}, filtered {sub_filtered}, "
                f"inserted {sub_inserted}, skipped {sub_skipped} (duplicate)"
            )

    total = count_questions(db_path)
    print(f"\nTotal inserted: {total_inserted} | Total pending: {total}")
    return {"harvested": total_inserted, "skipped": total_skipped, "total": total}


if __name__ == "__main__":
    result = harvest(db_path=os.getenv("MIRA_DB_PATH"))
    print(f"Result: {result}")
