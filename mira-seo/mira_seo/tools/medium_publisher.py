"""Medium publisher — posts excerpt to Medium API. Degrades gracefully if unconfigured."""

from __future__ import annotations

import logging
import os

import httpx

from mira_seo.models.content import MediumExcerpt

logger = logging.getLogger("mira-seo.medium-publisher")

_MEDIUM_API = "https://api.medium.com/v1"


async def publish(excerpt: MediumExcerpt) -> str | None:
    """Publish excerpt to Medium.

    Args:
        excerpt: MediumExcerpt model with title, content, canonical_url, tags

    Returns:
        Medium post URL on success, None if unconfigured or failed
    """
    token = os.getenv("MEDIUM_INTEGRATION_TOKEN", "")
    author_id = os.getenv("MEDIUM_AUTHOR_ID", "")

    if not token or not author_id:
        logger.info("Medium not configured — skipping Medium publish")
        return None

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                f"{_MEDIUM_API}/users/{author_id}/posts",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "title": excerpt.title,
                    "contentFormat": "markdown",
                    "content": excerpt.content,
                    "canonicalUrl": excerpt.canonical_url,
                    "tags": excerpt.tags[:5],
                    "publishStatus": "public",
                },
            )
            resp.raise_for_status()
            url: str = resp.json()["data"]["url"]
            logger.info("Medium post published: %s", url)
            return url
        except Exception:
            logger.exception("Medium publish failed")
            return None
