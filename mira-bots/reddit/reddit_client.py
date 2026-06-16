"""Reddit OAuth2 API client using httpx.

Handles token lifecycle, rate limiting, and all Reddit API interactions
for the MIRA Reddit bot adapter.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

logger = logging.getLogger("mira-reddit")

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
BASE_URL = "https://oauth.reddit.com"
TOKEN_REFRESH_MARGIN_S = 300  # refresh 5 min before expiry


class RedditClient:
    """Reddit API client with OAuth2 script-type auth and rate limiting."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        username: str,
        password: str,
        user_agent: str,
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._username = username
        self._password = password
        self._user_agent = user_agent

        self._token: str = ""
        self._token_expires_at: float = 0.0

        self._rate_remaining: float = 60
        self._rate_reset_at: float = 0.0

        self._http: httpx.AsyncClient | None = None

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=30,
                headers={"User-Agent": self._user_agent},
            )
        return self._http

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ------------------------------------------------------------------
    # OAuth2
    # ------------------------------------------------------------------

    async def _ensure_token(self) -> None:
        """Acquire or refresh the OAuth2 bearer token."""
        if self._token and time.monotonic() < self._token_expires_at:
            return

        http = await self._get_http()
        resp = await http.post(
            TOKEN_URL,
            auth=(self._client_id, self._client_secret),
            data={
                "grant_type": "password",
                "username": self._username,
                "password": self._password,
            },
            headers={"User-Agent": self._user_agent},
        )
        resp.raise_for_status()
        body = resp.json()

        if "access_token" not in body:
            raise RuntimeError(f"Reddit OAuth2 failed: {body}")

        self._token = body["access_token"]
        expires_in = int(body.get("expires_in", 3600))
        self._token_expires_at = time.monotonic() + expires_in - TOKEN_REFRESH_MARGIN_S
        logger.info("Reddit OAuth2 token acquired, expires in %ds", expires_in)

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------

    def _update_rate_limits(self, resp: httpx.Response) -> None:
        remaining = resp.headers.get("X-Ratelimit-Remaining")
        reset = resp.headers.get("X-Ratelimit-Reset")
        if remaining is not None:
            self._rate_remaining = float(remaining)
        if reset is not None:
            self._rate_reset_at = time.monotonic() + float(reset)

    async def _wait_for_rate_limit(self) -> None:
        if self._rate_remaining < 3 and self._rate_reset_at > time.monotonic():
            wait = self._rate_reset_at - time.monotonic() + 1
            logger.warning(
                "Rate limit near (%s remaining), sleeping %.1fs", self._rate_remaining, wait
            )
            await asyncio.sleep(wait)

    # ------------------------------------------------------------------
    # API methods
    # ------------------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Authenticated request to oauth.reddit.com with rate limit handling."""
        await self._ensure_token()
        await self._wait_for_rate_limit()

        http = await self._get_http()
        resp = await http.request(
            method,
            f"{BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {self._token}",
                "User-Agent": self._user_agent,
            },
            **kwargs,
        )
        self._update_rate_limits(resp)

        if resp.status_code == 429:
            retry_after = float(resp.headers.get("Retry-After", "60"))
            logger.warning("Reddit 429 — sleeping %.0fs", retry_after)
            await asyncio.sleep(retry_after)
            return await self._request(method, path, **kwargs)

        if resp.status_code == 401:
            logger.warning("Reddit 401 — forcing token refresh")
            self._token = ""
            self._token_expires_at = 0
            await self._ensure_token()
            return await self._request(method, path, **kwargs)

        resp.raise_for_status()
        return resp

    async def get_new_posts(self, subreddit: str, limit: int = 25) -> list[dict]:
        """Fetch newest posts from a subreddit."""
        resp = await self._request("GET", f"/r/{subreddit}/new", params={"limit": limit})
        data = resp.json()
        children = data.get("data", {}).get("children", [])
        return [c["data"] for c in children if c.get("kind") == "t3"]

    async def post_comment(self, parent_fullname: str, text: str) -> dict:
        """Post a comment reply to a post or comment.

        Args:
            parent_fullname: Reddit fullname (e.g. "t3_abc123" for post, "t1_xyz" for comment)
            text: Markdown-formatted reply text
        """
        resp = await self._request(
            "POST",
            "/api/comment",
            data={"thing_id": parent_fullname, "text": text},
        )
        body = resp.json()
        errors = body.get("json", {}).get("errors", [])
        if errors:
            logger.error("Reddit comment errors: %s", errors)
            raise RuntimeError(f"Reddit API errors: {errors}")
        return body

    async def get_inbox_replies(self, limit: int = 25) -> list[dict]:
        """Fetch comment replies from the bot's inbox."""
        resp = await self._request(
            "GET",
            "/message/inbox",
            params={"limit": limit, "mark": "false"},
        )
        data = resp.json()
        children = data.get("data", {}).get("children", [])
        return [
            c["data"]
            for c in children
            if c.get("kind") == "t1" and c["data"].get("type") == "comment_reply"
        ]

    async def mark_inbox_read(self, fullnames: list[str]) -> None:
        """Mark inbox items as read so they don't appear again."""
        if not fullnames:
            return
        await self._request(
            "POST",
            "/api/read_message",
            data={"id": ",".join(fullnames)},
        )

    async def get_post_info(self, post_id: str) -> dict | None:
        """Fetch a single post by ID (for getting the OP author)."""
        resp = await self._request("GET", "/api/info", params={"id": f"t3_{post_id}"})
        data = resp.json()
        children = data.get("data", {}).get("children", [])
        if children:
            return children[0].get("data")
        return None
