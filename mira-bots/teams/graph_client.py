"""Thin wrapper around Microsoft Graph API for Teams file downloads and user profiles."""

from __future__ import annotations

import logging
import time

import httpx

logger = logging.getLogger("mira-teams")

_AUTHORITY = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class GraphClient:
    def __init__(self, app_id: str, app_secret: str, tenant_id: str = "common") -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.tenant_id = tenant_id
        self._token: str = ""
        self._token_expires: float = 0.0

    async def get_token(self) -> str:
        """Get/refresh app-only access token via client credentials grant."""
        if self._token and time.monotonic() < self._token_expires:
            return self._token

        url = _AUTHORITY.format(tenant=self.tenant_id)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "scope": "https://graph.microsoft.com/.default",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["access_token"]
        self._token_expires = time.monotonic() + int(data.get("expires_in", 3600)) - 60
        return self._token

    async def download_file(self, content_url: str) -> bytes:
        """Download a Teams/SharePoint file using app-only Graph token."""
        token = await self.get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                content_url,
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=True,
            )
            resp.raise_for_status()
            return resp.content

    async def get_user_profile(self, user_id: str) -> dict:
        """Get user profile from Graph API by AAD object ID or UPN."""
        token = await self.get_token()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_GRAPH_BASE}/users/{user_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json()
