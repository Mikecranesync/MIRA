"""Reddit task — poll subreddits for maintenance-relevant posts and comments.

Uses public JSON endpoints (no PRAW, no OAuth).
New posts are chunked, embedded, and stored directly into the KB.
"""

from __future__ import annotations

import logging
import os
import time

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.tasks._shared import get_redis, ingest_text_inline
except ImportError:
    from tasks._shared import get_redis, ingest_text_inline

logger = logging.getLogger("mira-crawler.tasks.reddit")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUBREDDITS: list[str] = [
    "PLC",
    "IndustrialMaintenance",
    "electricians",
]

_REDDIT_BASE = "https://www.reddit.com/r/{sub}/top.json?t=week&limit=50"
_REDIS_SEEN_KEY = "mira:reddit:seen_posts"
# Updated User-Agent per Reddit ToS — must include operator contact info (m4).
_USER_AGENT = "MIRA-KB/1.0 by u/factorylm (ops@factorylm.com)"
_REQUEST_DELAY_SEC = 2
_FETCH_TIMEOUT = 30
_TOP_COMMENTS = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_reddit_response(data: dict) -> list[dict]:
    """Extract post records from a Reddit listing JSON response.

    Each record has: post_id, subreddit, title, selftext, url.
    Posts with no selftext and no title are silently dropped.
    """
    posts: list[dict] = []
    try:
        children = data["data"]["children"]
    except (KeyError, TypeError):
        return posts

    for child in children:
        try:
            post = child["data"]
        except (KeyError, TypeError):
            continue

        post_id = post.get("id", "").strip()
        title = post.get("title", "").strip()
        selftext = post.get("selftext", "").strip()
        subreddit = post.get("subreddit", "").strip()
        permalink = post.get("permalink", "")

        if not post_id or not title:
            continue

        # Skip removed/deleted posts
        if selftext in ("[removed]", "[deleted]", ""):
            selftext = ""

        posts.append(
            {
                "post_id": post_id,
                "subreddit": subreddit,
                "title": title,
                "selftext": selftext,
                "permalink": f"https://www.reddit.com{permalink}",
            }
        )

    return posts


def _fetch_top_comments(subreddit: str, post_id: str, client: httpx.Client) -> list[str]:
    """Fetch top N comment bodies for a post. Returns empty list on failure."""
    url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json?limit={_TOP_COMMENTS}"
    try:
        resp = client.get(url, headers={"User-Agent": _USER_AGENT}, timeout=_FETCH_TIMEOUT)
        resp.raise_for_status()
        listing = resp.json()
        # listing[1] contains the comments listing
        comments_data = listing[1]["data"]["children"]
        bodies: list[str] = []
        for child in comments_data[:_TOP_COMMENTS]:
            body = child.get("data", {}).get("body", "").strip()
            if body and body not in ("[removed]", "[deleted]"):
                bodies.append(body)
        return bodies
    except Exception as exc:
        logger.warning("Failed to fetch comments for post %s: %s", post_id, exc)
        return []


def _build_post_text(post: dict, comments: list[str]) -> str:
    """Combine post title, selftext, and comments into a single ingestible string."""
    parts: list[str] = [f"Title: {post['title']}"]
    if post["selftext"]:
        parts.append(post["selftext"])
    if comments:
        parts.append("Top Comments:")
        for i, comment in enumerate(comments, 1):
            parts.append(f"{i}. {comment}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.reddit.scrape_forums")
def scrape_forums() -> dict:
    """Poll configured subreddits, dedup by post ID, and ingest new posts.

    Steps:
      1. Load seen post IDs from Redis set ``mira:reddit:seen_posts``.
      2. For each subreddit: fetch top weekly posts via public JSON endpoint.
      3. For each new post: fetch top 5 comments, build combined text,
         chunk + embed + store inline, then immediately persist the post ID
         to Redis (incremental dedup — M2 fix).
      4. Return summary counts.
    """
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest Reddit posts")
        return {"subreddits_checked": 0, "posts_ingested": 0, "error": "no_tenant_id"}

    # 1. Load seen post IDs
    try:
        r = get_redis()
        seen_ids: set[str] = r.smembers(_REDIS_SEEN_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting scrape_forums: %s", exc)
        return {"subreddits_checked": 0, "posts_ingested": 0, "error": str(exc)}

    subreddits_checked = 0
    posts_ingested = 0

    with httpx.Client(timeout=_FETCH_TIMEOUT) as client:
        for sub in SUBREDDITS:
            url = _REDDIT_BASE.format(sub=sub)
            logger.info("Fetching r/%s top posts", sub)

            # 2. Fetch listing
            try:
                resp = client.get(url, headers={"User-Agent": _USER_AGENT})
                resp.raise_for_status()
                data = resp.json()
            except Exception as exc:
                logger.warning("Failed to fetch r/%s: %s", sub, exc)
                time.sleep(_REQUEST_DELAY_SEC)
                continue

            subreddits_checked += 1
            posts = _parse_reddit_response(data)
            new_posts = [p for p in posts if p["post_id"] not in seen_ids]
            logger.info("r/%s: %d posts, %d new", sub, len(posts), len(new_posts))

            # 3. Ingest each new post — persist post ID to Redis immediately
            #    after successful ingest so a mid-run crash does not lose
            #    dedup state for already-processed posts (M2).
            for post in new_posts:
                time.sleep(_REQUEST_DELAY_SEC)

                comments = _fetch_top_comments(sub, post["post_id"], client)
                combined_text = _build_post_text(post, comments)
                source_url = post["permalink"]

                try:
                    n = ingest_text_inline(
                        text=combined_text,
                        source_url=source_url,
                        source_type="forum_post",
                        tenant_id=tenant_id,
                        ollama_url=ollama_url,
                        embed_model=embed_model,
                    )
                    if n > 0:
                        posts_ingested += 1
                    r.sadd(_REDIS_SEEN_KEY, post["post_id"])  # incremental persist
                    seen_ids.add(post["post_id"])              # within-run dedup
                    logger.debug(
                        "Post %s (%s): %d chunks ingested", post["post_id"], sub, n
                    )
                except Exception as exc:
                    logger.warning("Failed to ingest post %s: %s", post["post_id"], exc)

            time.sleep(_REQUEST_DELAY_SEC)

    logger.info(
        "scrape_forums complete: %d subreddits checked, %d posts ingested",
        subreddits_checked,
        posts_ingested,
    )
    return {"subreddits_checked": subreddits_checked, "posts_ingested": posts_ingested}
