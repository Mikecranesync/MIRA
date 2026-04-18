#!/usr/bin/env python3
"""MIRA Reddit Bot — monitors maintenance subreddits and posts diagnostic replies.

Poll-based bot that:
1. Fetches new posts from configured subreddits
2. Filters for maintenance diagnostic questions
3. Runs them through the GSD engine
4. Posts replies as comments
5. Handles follow-up replies in the same diagnostic session

Env vars:
    REDDIT_CLIENT_ID       — OAuth2 client ID (reddit.com/prefs/apps)
    REDDIT_CLIENT_SECRET   — OAuth2 client secret
    REDDIT_USERNAME        — Bot Reddit account username
    REDDIT_PASSWORD        — Bot Reddit account password
    REDDIT_USER_AGENT      — User-Agent string (default: auto-generated)
    REDDIT_SUBREDDITS      — Comma-separated subreddit list
    REDDIT_POLL_INTERVAL   — Seconds between poll cycles (default: 120)
    REDDIT_MAX_POST_AGE_HOURS — Ignore posts older than this (default: 24)
    REDDIT_MAX_EXISTING_COMMENTS — Skip well-answered posts (default: 10)
    REDDIT_DRY_RUN         — Set to "1" to log without posting (default: 0)
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import sys
import time

from post_filter import should_respond
from reddit_client import RedditClient
from shared.engine import Supervisor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("mira-reddit")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "")
REDDIT_USERNAME = os.environ.get("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.environ.get("REDDIT_PASSWORD", "")
REDDIT_USER_AGENT = os.environ.get(
    "REDDIT_USER_AGENT",
    f"linux:MIRA-RedditBot:0.1.0 (by /u/{REDDIT_USERNAME})",
)
SUBREDDITS = [
    s.strip()
    for s in os.environ.get(
        "REDDIT_SUBREDDITS", "IndustrialMaintenance,PLC,electricians,HVAC,AutomationTechnology"
    ).split(",")
    if s.strip()
]
POLL_INTERVAL = int(os.environ.get("REDDIT_POLL_INTERVAL", "120"))
MAX_POST_AGE_HOURS = int(os.environ.get("REDDIT_MAX_POST_AGE_HOURS", "24"))
MAX_EXISTING_COMMENTS = int(os.environ.get("REDDIT_MAX_EXISTING_COMMENTS", "10"))
DRY_RUN = os.environ.get("REDDIT_DRY_RUN", "0") == "1"
TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")
DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")

BOT_DISCLAIMER = (
    "\n\n---\n"
    "*I'm MIRA, an AI maintenance assistant. My suggestions should be verified by "
    "qualified personnel before any work is performed. Reply to this comment to "
    "continue the diagnosis. | Powered by FactoryLM*"
)

# ---------------------------------------------------------------------------
# SQLite persistence for replied posts
# ---------------------------------------------------------------------------


def _ensure_reddit_tables(db_path: str) -> None:
    """Create reddit_replied table if it doesn't exist."""
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS reddit_replied (
            post_id TEXT PRIMARY KEY,
            subreddit TEXT NOT NULL,
            title TEXT NOT NULL,
            replied_at REAL NOT NULL,
            comment_fullname TEXT DEFAULT ''
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS reddit_followups (
            comment_id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            replied_at REAL NOT NULL
        )
    """)
    db.commit()
    db.close()


def _is_already_replied(db_path: str, post_id: str) -> bool:
    db = sqlite3.connect(db_path)
    row = db.execute("SELECT 1 FROM reddit_replied WHERE post_id = ?", (post_id,)).fetchone()
    db.close()
    return row is not None


def _mark_replied(
    db_path: str,
    post_id: str,
    subreddit: str,
    title: str,
    comment_fullname: str = "",
) -> None:
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "INSERT OR IGNORE INTO reddit_replied (post_id, subreddit, title, replied_at, comment_fullname) "
        "VALUES (?, ?, ?, ?, ?)",
        (post_id, subreddit, title, time.time(), comment_fullname),
    )
    db.commit()
    db.close()


def _is_followup_replied(db_path: str, comment_id: str) -> bool:
    db = sqlite3.connect(db_path)
    row = db.execute(
        "SELECT 1 FROM reddit_followups WHERE comment_id = ?", (comment_id,)
    ).fetchone()
    db.close()
    return row is not None


def _mark_followup_replied(db_path: str, comment_id: str, post_id: str) -> None:
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "INSERT OR IGNORE INTO reddit_followups (comment_id, post_id, replied_at) VALUES (?, ?, ?)",
        (comment_id, post_id, time.time()),
    )
    db.commit()
    db.close()


def _load_replied_ids(db_path: str) -> set[str]:
    """Load all replied post IDs into memory for fast lookup."""
    db = sqlite3.connect(db_path)
    rows = db.execute("SELECT post_id FROM reddit_replied").fetchall()
    db.close()
    return {r[0] for r in rows}


def _get_post_id_for_comment(db_path: str, comment_fullname: str) -> str | None:
    """Look up which post a bot comment belongs to."""
    db = sqlite3.connect(db_path)
    row = db.execute(
        "SELECT post_id FROM reddit_replied WHERE comment_fullname = ?",
        (comment_fullname,),
    ).fetchone()
    db.close()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Message formatting
# ---------------------------------------------------------------------------


def _build_message(post: dict) -> str:
    """Build the input message for the GSD engine from a Reddit post."""
    title = post.get("title", "").strip()
    selftext = post.get("selftext", "").strip()
    if selftext:
        return f"{title}\n\n{selftext}"
    return title


def _format_reply(engine_reply: str) -> str:
    """Append bot disclaimer to the engine reply."""
    return engine_reply.strip() + BOT_DISCLAIMER


# ---------------------------------------------------------------------------
# Main poll loop
# ---------------------------------------------------------------------------


async def _process_new_posts(
    client: RedditClient,
    engine: Supervisor,
    seen_posts: set[str],
) -> None:
    """Scan subreddits for new maintenance questions and reply."""
    for subreddit in SUBREDDITS:
        try:
            posts = await client.get_new_posts(subreddit, limit=25)
        except Exception as e:
            logger.error("Failed to fetch /r/%s/new: %s", subreddit, e)
            continue

        for post in posts:
            post_id = post.get("id", "")
            if not post_id or post_id in seen_posts:
                continue

            if not should_respond(
                post,
                max_post_age_hours=MAX_POST_AGE_HOURS,
                max_existing_comments=MAX_EXISTING_COMMENTS,
            ):
                seen_posts.add(post_id)
                continue

            title = post.get("title", "(no title)")
            logger.info("Matched post in /r/%s: [%s] %s", subreddit, post_id, title[:80])

            # Run through GSD engine
            session_id = f"{TENANT_ID}_reddit_{post_id}" if TENANT_ID else f"reddit_{post_id}"
            message = _build_message(post)

            try:
                reply = await engine.process(session_id, message, platform="reddit")
            except Exception as e:
                logger.error("GSD engine error for post %s: %s", post_id, e)
                continue

            if not reply or not reply.strip():
                logger.warning("Empty reply for post %s, skipping", post_id)
                seen_posts.add(post_id)
                continue

            formatted = _format_reply(reply)

            if DRY_RUN:
                logger.info("[DRY RUN] Would reply to t3_%s:\n%s", post_id, formatted[:200])
                seen_posts.add(post_id)
                _mark_replied(DB_PATH, post_id, subreddit, title)
                continue

            # Post comment
            try:
                result = await client.post_comment(f"t3_{post_id}", formatted)
                comment_fullname = ""
                things = result.get("json", {}).get("data", {}).get("things", [])
                if things:
                    comment_fullname = things[0].get("data", {}).get("name", "")
                logger.info(
                    "Replied to /r/%s post %s (comment: %s)", subreddit, post_id, comment_fullname
                )
                _mark_replied(DB_PATH, post_id, subreddit, title, comment_fullname)
            except Exception as e:
                logger.error("Failed to post comment on %s: %s", post_id, e)
                continue

            seen_posts.add(post_id)


async def _process_followups(
    client: RedditClient,
    engine: Supervisor,
) -> None:
    """Check inbox for replies to the bot's comments and continue sessions."""
    try:
        replies = await client.get_inbox_replies(limit=25)
    except Exception as e:
        logger.error("Failed to fetch inbox: %s", e)
        return

    to_mark_read: list[str] = []

    for reply in replies:
        comment_id = reply.get("id", "")
        if not comment_id:
            continue
        if _is_followup_replied(DB_PATH, comment_id):
            to_mark_read.append(f"t1_{comment_id}")
            continue

        # Find the parent — reply["parent_id"] is the fullname of what was replied to
        parent_id = reply.get("parent_id", "")
        # Look up which post this conversation belongs to
        post_id = _get_post_id_for_comment(DB_PATH, parent_id)
        if not post_id:
            # Could be a reply to someone else's comment, or we lost track
            to_mark_read.append(f"t1_{comment_id}")
            continue

        # Only respond to the original poster
        reply_author = reply.get("author", "")
        if not reply_author or reply_author == "[deleted]":
            to_mark_read.append(f"t1_{comment_id}")
            continue

        # Fetch the original post to check if this is the OP
        post_info = await client.get_post_info(post_id)
        if not post_info:
            to_mark_read.append(f"t1_{comment_id}")
            continue

        op_author = post_info.get("author", "")
        if reply_author != op_author:
            logger.debug("Ignoring reply from non-OP %s on post %s", reply_author, post_id)
            to_mark_read.append(f"t1_{comment_id}")
            _mark_followup_replied(DB_PATH, comment_id, post_id)
            continue

        # Continue the GSD session
        session_id = f"{TENANT_ID}_reddit_{post_id}" if TENANT_ID else f"reddit_{post_id}"
        followup_text = reply.get("body", "").strip()
        if not followup_text:
            to_mark_read.append(f"t1_{comment_id}")
            continue

        logger.info("Follow-up from OP on post %s: %s", post_id, followup_text[:80])

        try:
            engine_reply = await engine.process(session_id, followup_text, platform="reddit")
        except Exception as e:
            logger.error("GSD engine error for followup on %s: %s", post_id, e)
            to_mark_read.append(f"t1_{comment_id}")
            continue

        if not engine_reply or not engine_reply.strip():
            to_mark_read.append(f"t1_{comment_id}")
            _mark_followup_replied(DB_PATH, comment_id, post_id)
            continue

        formatted = _format_reply(engine_reply)

        if DRY_RUN:
            logger.info(
                "[DRY RUN] Would reply to follow-up t1_%s:\n%s", comment_id, formatted[:200]
            )
        else:
            try:
                result = await client.post_comment(f"t1_{comment_id}", formatted)
                comment_fullname = ""
                things = result.get("json", {}).get("data", {}).get("things", [])
                if things:
                    comment_fullname = things[0].get("data", {}).get("name", "")
                logger.info("Replied to follow-up %s (comment: %s)", comment_id, comment_fullname)
            except Exception as e:
                logger.error("Failed to post follow-up reply on %s: %s", comment_id, e)

        to_mark_read.append(f"t1_{comment_id}")
        _mark_followup_replied(DB_PATH, comment_id, post_id)

    # Mark processed inbox items as read
    if to_mark_read:
        try:
            await client.mark_inbox_read(to_mark_read)
        except Exception as e:
            logger.warning("Failed to mark inbox read: %s", e)


async def run() -> None:
    """Main entry point: initialize and run the poll loop."""
    # Validate credentials
    if not REDDIT_CLIENT_ID or not REDDIT_CLIENT_SECRET:
        logger.error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set")
        sys.exit(1)
    if not REDDIT_USERNAME or not REDDIT_PASSWORD:
        logger.error("REDDIT_USERNAME and REDDIT_PASSWORD must be set")
        sys.exit(1)

    logger.info("MIRA Reddit Bot starting")
    logger.info("Subreddits: %s", ", ".join(SUBREDDITS))
    logger.info("Poll interval: %ds", POLL_INTERVAL)
    if DRY_RUN:
        logger.info("DRY RUN mode — will not post comments")

    # Initialize persistence
    _ensure_reddit_tables(DB_PATH)
    seen_posts = _load_replied_ids(DB_PATH)
    logger.info("Loaded %d previously-replied post IDs", len(seen_posts))

    # Initialize Reddit client
    client = RedditClient(
        client_id=REDDIT_CLIENT_ID,
        client_secret=REDDIT_CLIENT_SECRET,
        username=REDDIT_USERNAME,
        password=REDDIT_PASSWORD,
        user_agent=REDDIT_USER_AGENT,
    )

    # Initialize Supervisor engine
    engine = Supervisor(
        db_path=DB_PATH,
        openwebui_url=os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
        api_key=os.environ.get("OPENWEBUI_API_KEY", ""),
        collection_id=os.environ.get("KNOWLEDGE_COLLECTION_ID", ""),
        vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
        tenant_id=TENANT_ID,
    )

    try:
        while True:
            try:
                await _process_new_posts(client, engine, seen_posts)
                await _process_followups(client, engine)
            except Exception as e:
                logger.error("Poll cycle error: %s", e)

            await asyncio.sleep(POLL_INTERVAL)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(run())
