#!/usr/bin/env python3
"""
main.py
-------
Orchestrator for the Reddit → Telegram troubleshooting-question pipeline.

Usage:
  # Normal run (scrape + forward)
  python main.py

  # Dry run (no Telegram messages sent)
  python main.py --dry-run

  # Skip scraping, forward from an existing CSV
  python main.py --from-csv reddit_questions.csv

  # Only scrape, skip Telegram forwarding
  python main.py --scrape-only

  # Limit how many posts to forward
  python main.py --limit 20

Doppler secrets (run via doppler run or run_charlie.sh):
  APIFY_API_KEY            — Apify API token
  TELEGRAM_API_ID          — Telegram app ID (my.telegram.org)
  TELEGRAM_API_HASH        — Telegram app hash
  TELEGRAM_TARGET          — Target channel/chat (@username or numeric ID)
  TELEGRAM_SESSION_NAME    — (optional) .session file name
  TELEGRAM_BOT_TOKEN       — (optional) use bot mode instead of user mode
  MIN_UPVOTES              — (optional) int, default 10
  MAX_ITEMS_PER_SUB        — (optional) int, default 100
  MESSAGE_DELAY_SECS       — (optional) float, default 3.0
  DRY_RUN                  — (optional) "1" to skip sending
"""

import argparse
import csv
import logging
import os
import sys
from datetime import datetime

from apify_reddit_scraper import scrape_reddit
from telethon_forwarder import forward_posts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CSV loader (for --from-csv mode)
# ---------------------------------------------------------------------------
def load_from_csv(path: str) -> list[dict]:
    posts = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Coerce numeric fields back from strings
            row["upvotes"] = int(row.get("upvotes", 0) or 0)
            row["num_comments"] = int(row.get("num_comments", 0) or 0)
            posts.append(row)
    log.info("Loaded %d posts from %s", len(posts), path)
    return posts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(
        description="Scrape Reddit troubleshooting questions → forward to Telegram"
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        default=os.environ.get("DRY_RUN", "0").lower() in ("1", "true"),
        help="Print messages to stdout instead of sending to Telegram",
    )
    p.add_argument(
        "--scrape-only",
        action="store_true",
        help="Run the scraper and export CSV, skip Telegram forwarding",
    )
    p.add_argument(
        "--from-csv",
        metavar="FILE",
        default=None,
        help="Skip scraping and load posts from this CSV file instead",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of posts to forward (defaults to all)",
    )
    p.add_argument(
        "--output-csv",
        metavar="FILE",
        default=None,
        help="CSV output path (default: reddit_questions_YYYYMMDD_HHMMSS.csv)",
    )
    p.add_argument(
        "--min-upvotes",
        type=int,
        default=None,
        help="Override MIN_UPVOTES environment variable",
    )
    p.add_argument(
        "--max-items",
        type=int,
        default=None,
        help="Override MAX_ITEMS_PER_SUB environment variable",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    args = parse_args()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = args.output_csv or f"reddit_questions_{timestamp}.csv"

    # ── Step 1: Acquire posts ──────────────────────────────────────────────
    if args.from_csv:
        posts = load_from_csv(args.from_csv)
    else:
        log.info("Starting Apify Reddit scrape...")
        posts = scrape_reddit(
            output_csv=csv_path,
            min_upvotes=args.min_upvotes,
            max_items_per_sub=args.max_items,
        )
        log.info("Scrape complete. CSV → %s", csv_path)

    if not posts:
        log.warning("No qualifying posts found. Exiting.")
        sys.exit(0)

    # ── Step 2: Apply limit ────────────────────────────────────────────────
    if args.limit and args.limit < len(posts):
        log.info("Limiting to top %d posts (out of %d).", args.limit, len(posts))
        posts = posts[: args.limit]

    # ── Step 3: Optionally skip forwarding ─────────────────────────────────
    if args.scrape_only:
        log.info("--scrape-only set. Skipping Telegram forwarding.")
        print(f"\n✓ Done. {len(posts)} posts saved to: {csv_path}")
        return

    # ── Step 4: Forward to Telegram ────────────────────────────────────────
    log.info("Starting Telegram forwarding (%d posts)...", len(posts))
    stats = forward_posts(posts, dry_run=args.dry_run)

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 50)
    print(f"  Pipeline complete — {timestamp}")
    print("=" * 50)
    print(f"  Posts scraped / loaded : {len(posts)}")
    print(f"  Messages sent          : {stats['sent']}")
    print(f"  Messages skipped       : {stats['skipped']}")
    print(f"  Errors                 : {stats['errors']}")
    if not args.from_csv:
        print(f"  CSV path               : {csv_path}")
    print("=" * 50)

    if stats["errors"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
