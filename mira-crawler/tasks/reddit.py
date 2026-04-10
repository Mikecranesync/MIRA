"""Reddit task — poll subreddits for maintenance-relevant posts and comments.

Uses public JSON endpoints (no PRAW, no OAuth).
New posts are chunked, embedded, and stored directly into the KB.
"""

from __future__ import annotations

import logging
import os
import time
from urllib.parse import urlparse

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

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
_USER_AGENT = "MIRA-KB/1.0 (research bot)"
_REQUEST_DELAY_SEC = 2
_FETCH_TIMEOUT = 30
_TOP_COMMENTS = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_redis():
    """Return a Redis connection using CELERY_BROKER_URL, always db 0."""
    import redis

    broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    parsed = urlparse(broker_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


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


def _ingest_text_inline(
    text: str,
    source_url: str,
    source_type: str,
    tenant_id: str,
    ollama_url: str,
    embed_model: str,
) -> int:
    """Chunk, embed, and store a text string directly. Returns number inserted."""
    try:
        from ingest.chunker import chunk_blocks
        from ingest.embedder import embed_text
        from ingest.store import chunk_exists, insert_chunk
    except ImportError:
        from mira_crawler.ingest.chunker import chunk_blocks
        from mira_crawler.ingest.embedder import embed_text
        from mira_crawler.ingest.store import chunk_exists, insert_chunk

    blocks = [{"text": text, "page_num": None, "section": ""}]
    chunks = chunk_blocks(
        blocks,
        source_url=source_url,
        source_type=source_type,
        max_chars=2000,
        min_chars=80,
        overlap=200,
    )

    inserted = 0
    for chunk in chunks:
        chunk_idx = chunk.get("chunk_index", 0)
        if chunk_exists(tenant_id, source_url, chunk_idx):
            continue
        embedding = embed_text(chunk["text"], ollama_url=ollama_url, model=embed_model)
        if embedding is None:
            continue
        entry_id = insert_chunk(
            tenant_id=tenant_id,
            content=chunk["text"],
            embedding=embedding,
            source_url=source_url,
            source_type=source_type,
            chunk_index=chunk_idx,
            chunk_type=chunk.get("chunk_type", "text"),
        )
        if entry_id:
            inserted += 1

    return inserted


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
         chunk + embed + store inline.
      4. Persist new post IDs back to Redis.
      5. Return summary counts.
    """
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest Reddit posts")
        return {"subreddits_checked": 0, "posts_ingested": 0, "error": "no_tenant_id"}

    # 1. Load seen post IDs
    try:
        r = _get_redis()
        seen_ids: set[str] = r.smembers(_REDIS_SEEN_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting scrape_forums: %s", exc)
        return {"subreddits_checked": 0, "posts_ingested": 0, "error": str(exc)}

    subreddits_checked = 0
    posts_ingested = 0
    new_post_ids: list[str] = []

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

            # 3. Ingest each new post
            for post in new_posts:
                time.sleep(_REQUEST_DELAY_SEC)

                comments = _fetch_top_comments(sub, post["post_id"], client)
                combined_text = _build_post_text(post, comments)
                source_url = post["permalink"]

                try:
                    n = _ingest_text_inline(
                        text=combined_text,
                        source_url=source_url,
                        source_type="forum_post",
                        tenant_id=tenant_id,
                        ollama_url=ollama_url,
                        embed_model=embed_model,
                    )
                    if n > 0:
                        posts_ingested += 1
                        new_post_ids.append(post["post_id"])
                        seen_ids.add(post["post_id"])
                    logger.debug(
                        "Post %s (%s): %d chunks ingested", post["post_id"], sub, n
                    )
                except Exception as exc:
                    logger.warning("Failed to ingest post %s: %s", post["post_id"], exc)

            time.sleep(_REQUEST_DELAY_SEC)

    # 4. Persist new post IDs to Redis
    if new_post_ids:
        try:
            r.sadd(_REDIS_SEEN_KEY, *new_post_ids)
            logger.info("Stored %d new post IDs in Redis", len(new_post_ids))
        except Exception as exc:
            logger.error("Failed to persist post IDs to Redis: %s", exc)

    logger.info(
        "scrape_forums complete: %d subreddits checked, %d posts ingested",
        subreddits_checked,
        posts_ingested,
    )
    return {"subreddits_checked": subreddits_checked, "posts_ingested": posts_ingested}
