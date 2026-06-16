#!/usr/bin/env python3
"""
apify_reddit_scraper.py
-----------------------
Uses the Apify Reddit Scraper actor (silentflow/reddit-scraper) to pull posts
from target subreddits, filter for high-upvote troubleshooting questions, and
export the results to CSV.

Doppler secrets expected:
  APIFY_API_KEY           — your Apify API token
  MIN_UPVOTES             — (optional) minimum score threshold, default 10
  MAX_ITEMS_PER_SUB       — (optional) posts to fetch per subreddit, default 100

Actor: silentflow/reddit-scraper  (https://apify.com/silentflow/reddit-scraper)
"""

import csv
import logging
import os
import re
from datetime import datetime, timezone

from apify_client import ApifyClient

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ACTOR_ID = "silentflow/reddit-scraper"

SUBREDDITS = [
    "techsupport",
    "fixit",
    "AskElectricians",
    "DIY",
    "HomeImprovement",
    "MechanicAdvice",
    "electricians",
    "PLC",                   # industrial / MIRA-relevant
    "HVAC",
    "plumbing",
]

# Keywords that strongly indicate a troubleshooting question.
# See also: mira-bots/reddit/post_filter.py DIAGNOSTIC_KEYWORDS
# (different purpose — reply-gating with heavier industrial focus)
QUESTION_KEYWORDS = [
    r"\bhow (do|can|should|to)\b",
    r"\bwhy (is|does|won't|did|isn't)\b",
    r"\bwhat (is|causes|should|does)\b",
    r"\bnot working\b",
    r"\bkeeps? (failing|tripping|shutting|rebooting|resetting)\b",
    r"\bkeeps? (throwing|giving|showing)\b",
    r"\bfault\b",
    r"\balarm\b",
    r"\berror\b",
    r"\btroubleshoot\b",
    r"\bfix\b",
    r"\bhelp\b",
    r"\bissue\b",
    r"\bproblem\b",
    r"\bbroken\b",
    r"\bno power\b",
    r"\btripping\b",
    r"\boverload\b",
    r"\b(wont|won't|doesn't|does not|can't|cannot) (start|run|work|turn on|power)\b",
    r"\?$",   # ends with a question mark
]

COMPILED_KEYWORDS = [re.compile(p, re.IGNORECASE) for p in QUESTION_KEYWORDS]

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def is_question(title: str, body: str = "") -> bool:
    """Return True if the post looks like a troubleshooting question."""
    text = f"{title} {body}"
    return any(pat.search(text) for pat in COMPILED_KEYWORDS)


def build_actor_input(subreddit: str, max_items: int, sort: str = "hot") -> dict:
    return {
        "startUrls": [{"url": f"https://www.reddit.com/r/{subreddit}/"}],
        "maxItems": max_items,
        "sort": sort,
        "includeNSFW": False,
    }


# ---------------------------------------------------------------------------
# Main scraping function
# ---------------------------------------------------------------------------
def scrape_reddit(
    output_csv: str = "reddit_questions.csv",
    min_upvotes: int | None = None,
    max_items_per_sub: int | None = None,
) -> list[dict]:
    """
    Run the Apify actor for each subreddit, filter results, and write to CSV.
    Returns a list of filtered post dicts.
    """
    api_token = os.environ.get("APIFY_API_KEY")
    if not api_token:
        raise EnvironmentError(
            "APIFY_API_KEY is not set. "
            "Add it via Doppler: doppler secrets set APIFY_API_KEY <value>"
        )

    min_upvotes = int(os.environ.get("MIN_UPVOTES", 10) if min_upvotes is None else min_upvotes)
    max_items = int(
        os.environ.get("MAX_ITEMS_PER_SUB", 100) if max_items_per_sub is None else max_items_per_sub
    )

    client = ApifyClient(api_token)
    all_filtered: list[dict] = []

    for sub in SUBREDDITS:
        log.info("Scraping r/%s (max %d items, min %d upvotes)...", sub, max_items, min_upvotes)
        actor_input = build_actor_input(sub, max_items, sort="hot")

        try:
            run = client.actor(ACTOR_ID).call(run_input=actor_input)
        except Exception as exc:
            log.error("Actor run failed for r/%s: %s", sub, exc)
            continue

        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            log.warning("No dataset returned for r/%s — skipping.", sub)
            continue

        log.info("  Dataset ID: %s", dataset_id)
        count = 0
        kept = 0

        for item in client.dataset(dataset_id).iterate_items():
            # The silentflow actor marks posts with dataType == "post"
            if item.get("dataType") != "post":
                continue

            count += 1
            title = item.get("title", "") or ""
            body = item.get("body", "") or ""
            upvotes = item.get("upVotes", 0) or 0

            if upvotes < min_upvotes:
                continue
            if not is_question(title, body):
                continue

            post = {
                "subreddit": item.get("communityName", sub),
                "post_id": item.get("id", ""),
                "title": title,
                "body": (body[:500] + "...") if len(body) > 500 else body,
                "upvotes": upvotes,
                "upvote_ratio": item.get("upVoteRatio", ""),
                "num_comments": item.get("numberOfComments", 0),
                "author": item.get("username", "[deleted]"),
                "url": item.get("url", ""),
                "created_at": item.get("createdAt", ""),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
            all_filtered.append(post)
            kept += 1

        log.info("  r/%s — %d posts fetched, %d passed filters.", sub, count, kept)

    log.info("Total qualifying posts: %d", len(all_filtered))

    # Sort by upvotes descending
    all_filtered.sort(key=lambda x: x["upvotes"], reverse=True)

    # Write CSV
    if all_filtered:
        fieldnames = list(all_filtered[0].keys())
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(all_filtered)
        log.info("CSV saved → %s", output_csv)
    else:
        log.warning("No posts matched filters — CSV not written.")

    return all_filtered


# ---------------------------------------------------------------------------
# Standalone test run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    results = scrape_reddit()
    print(f"\n{len(results)} posts exported.")
    for p in results[:5]:
        print(f"  [{p['upvotes']:>5}] r/{p['subreddit']}: {p['title'][:80]}")
