"""LinkedIn publisher — posts to LinkedIn via Zernio → Buffer → clipboard fallback."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx

from mira_seo.models.content import LinkedInPost

logger = logging.getLogger("mira-seo.linkedin-publisher")

CLIPBOARD_FILE = Path("/tmp/mira_linkedin_post.txt")


async def _try_zernio(text: str) -> bool:
    api_key = os.getenv("ZERNIO_API_KEY", "")
    profile_id = os.getenv("ZERNIO_LINKEDIN_PROFILE_ID", "")
    if not api_key or not profile_id:
        return False
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                "https://app.zernio.com/api/v1/posts",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"profileId": profile_id, "text": text},
            )
            resp.raise_for_status()
            logger.info("LinkedIn posted via Zernio")
            return True
        except Exception:
            logger.warning("Zernio post failed", exc_info=True)
            return False


async def _try_buffer(text: str) -> bool:
    token = os.getenv("BUFFER_ACCESS_TOKEN", "")
    profile_id = os.getenv("BUFFER_LINKEDIN_PROFILE_ID", "")
    if not token or not profile_id:
        return False
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                "https://api.bufferapp.com/1/updates/create.json",
                data={"text": text, "profile_ids[]": profile_id, "access_token": token},
            )
            resp.raise_for_status()
            logger.info("LinkedIn queued via Buffer")
            return True
        except Exception:
            logger.warning("Buffer post failed", exc_info=True)
            return False


def _clipboard_fallback(text: str) -> bool:
    try:
        CLIPBOARD_FILE.write_text(text, encoding="utf-8")
        logger.info("LinkedIn post written to %s (manual copy required)", CLIPBOARD_FILE)
        return True
    except Exception:
        logger.exception("Clipboard fallback failed")
        return False


async def publish(post: LinkedInPost) -> bool:
    """Post to LinkedIn using Zernio → Buffer → clipboard fallback.

    Args:
        post: LinkedInPost model with text and hashtags

    Returns:
        True if published (or queued) by any backend
    """
    hashtag_block = " ".join(f"#{h.lstrip('#')}" for h in post.hashtags)
    full_text = f"{post.text}\n\n{hashtag_block}".strip() if hashtag_block else post.text

    if await _try_zernio(full_text):
        return True
    if await _try_buffer(full_text):
        return True
    return _clipboard_fallback(full_text)
