"""Community corpus scraper — Reddit maintenance posts.

Supports two modes:
  - PRAW (authenticated): set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
  - httpx fallback (unauthenticated): used automatically when credentials are absent

Usage:
    python corpus/scraper.py --subreddits all --limit 500 --time-filter year
    python corpus/scraper.py --subreddits PLC,electricians --limit 100 --time-filter month
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path

import httpx

logger = logging.getLogger("corpus-scraper")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

_ALL_SUBREDDITS = [
    "PLC",
    "electricians",
    "HVAC",
    "IndustrialMaintenance",
    "maintenanceworkers",
    "AskAnElectrician",
    "MechanicalEngineering",
    "Machinists",
    "Welding",
    "Automation",
]

_SEARCH_QUERY = "troubleshoot OR fault OR error OR alarm OR diagnosis OR repair OR fix"

_RAW_DIR = Path(__file__).parent / "raw"

# ---------------------------------------------------------------------------
# PRAW path
# ---------------------------------------------------------------------------


def _praw_available() -> bool:
    import importlib.util
    if importlib.util.find_spec("praw") is None:
        return False
    return bool(
        os.environ.get("REDDIT_CLIENT_ID")
        and os.environ.get("REDDIT_CLIENT_SECRET")
    )


def _scrape_praw(subreddit: str, limit: int, time_filter: str) -> list[dict]:
    import praw  # type: ignore

    reddit = praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ.get("REDDIT_USER_AGENT", "mira-corpus-scraper/1.0"),
    )

    results: list[dict] = []
    sub = reddit.subreddit(subreddit)
    for post in sub.search(_SEARCH_QUERY, sort="relevance", time_filter=time_filter, limit=limit):
        if post.is_self and post.selftext:
            top_comment = ""
            post.comments.replace_more(limit=0)
            if post.comments:
                top_comment = post.comments[0].body or ""
            results.append({
                "id": post.id,
                "title": post.title,
                "selftext": post.selftext,
                "score": post.score,
                "num_comments": post.num_comments,
                "created_utc": int(post.created_utc),
                "subreddit": subreddit,
                "top_comment": top_comment[:500],
            })
    return results


# ---------------------------------------------------------------------------
# httpx fallback (unauthenticated Reddit JSON API)
# ---------------------------------------------------------------------------

_HEADERS = {"User-Agent": "mira-corpus-scraper/1.0 (by factorylm)"}
_RATE_LIMIT_SLEEP = 2.0  # seconds between requests


def _scrape_httpx(subreddit: str, limit: int, time_filter: str) -> list[dict]:
    results: list[dict] = []
    after: str | None = None
    fetched = 0
    batch = min(limit, 100)

    with httpx.Client(headers=_HEADERS, timeout=30, follow_redirects=True) as client:
        while fetched < limit:
            params: dict[str, str | int] = {
                "q": _SEARCH_QUERY,
                "restrict_sr": "1",
                "sort": "relevance",
                "t": time_filter,
                "type": "link",
                "limit": batch,
            }
            if after:
                params["after"] = after

            url = f"https://www.reddit.com/r/{subreddit}/search.json"
            try:
                resp = client.get(url, params=params)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning("HTTP error for r/%s: %s", subreddit, exc)
                break

            data = resp.json()
            children = data.get("data", {}).get("children", [])
            if not children:
                break

            for child in children:
                p = child.get("data", {})
                if p.get("is_self") and p.get("selftext"):
                    results.append({
                        "id": p.get("id", ""),
                        "title": p.get("title", ""),
                        "selftext": p.get("selftext", ""),
                        "score": p.get("score", 0),
                        "num_comments": p.get("num_comments", 0),
                        "created_utc": int(p.get("created_utc", 0)),
                        "subreddit": subreddit,
                        "top_comment": "",
                    })
                    fetched += 1
                    if fetched >= limit:
                        break

            after = data.get("data", {}).get("after")
            if not after:
                break

            time.sleep(_RATE_LIMIT_SLEEP)

    return results


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def scrape_subreddit(subreddit: str, limit: int, time_filter: str) -> list[dict]:
    if _praw_available():
        logger.info("r/%s — using PRAW (authenticated)", subreddit)
        return _scrape_praw(subreddit, limit, time_filter)
    else:
        logger.info("r/%s — using httpx fallback (unauthenticated)", subreddit)
        return _scrape_httpx(subreddit, limit, time_filter)


def scrape_all(
    subreddits: list[str],
    limit_per_sub: int,
    time_filter: str,
    output_dir: Path = _RAW_DIR,
) -> dict[str, int]:
    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}

    for sub in subreddits:
        posts = scrape_subreddit(sub, limit_per_sub, time_filter)
        out_file = output_dir / f"{sub.lower()}.json"
        with out_file.open("w") as f:
            json.dump(posts, f, indent=2)
        counts[sub] = len(posts)
        logger.info("r/%s — %d posts saved to %s", sub, len(posts), out_file)

    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape Reddit maintenance posts")
    parser.add_argument(
        "--subreddits",
        default="all",
        help='Comma-separated list or "all" (default: all)',
    )
    parser.add_argument("--limit", type=int, default=500, help="Posts per subreddit")
    parser.add_argument(
        "--time-filter",
        default="year",
        choices=["hour", "day", "week", "month", "year", "all"],
    )
    parser.add_argument(
        "--output-dir",
        default=str(_RAW_DIR),
        help="Directory for raw JSON output",
    )
    args = parser.parse_args()

    subs = _ALL_SUBREDDITS if args.subreddits == "all" else [s.strip() for s in args.subreddits.split(",")]
    counts = scrape_all(subs, args.limit, args.time_filter, Path(args.output_dir))

    total = sum(counts.values())
    print(f"\nHarvest complete — {total} posts across {len(subs)} subreddits")
    for sub, n in counts.items():
        print(f"  r/{sub:<30} {n:>4} posts")
