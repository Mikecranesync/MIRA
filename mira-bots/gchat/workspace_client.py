"""Google Workspace API client — service account auth + Chat API + Drive file downloads.

Uses PyJWT for RS256 JWT assertion (service account OAuth flow).
All HTTP via httpx (async-native, no blocking google-auth transport).
"""

from __future__ import annotations

import json
import logging
import time
from base64 import b64decode

import httpx
import jwt

logger = logging.getLogger("mira-gchat")

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SCOPES = " ".join(
    [
        "https://www.googleapis.com/auth/chat.bot",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
)
_CHAT_API = "https://chat.googleapis.com/v1"
_DRIVE_API = "https://www.googleapis.com/drive/v3"


class WorkspaceClient:
    """Google Workspace API client for service account auth and API access."""

    def __init__(self, service_account_info: str | dict) -> None:
        """Accept service account JSON as a dict, raw JSON string, or base64-encoded JSON."""
        if isinstance(service_account_info, dict):
            sa = service_account_info
        else:
            try:
                sa = json.loads(service_account_info)
            except (json.JSONDecodeError, UnicodeDecodeError):
                sa = json.loads(b64decode(service_account_info).decode())

        self._private_key: str = sa["private_key"]
        self._client_email: str = sa["client_email"]
        self._token_uri: str = sa.get("token_uri", _TOKEN_URI)
        self._token: str = ""
        self._token_expires: float = 0.0

    async def get_token(self) -> str:
        """Get/refresh app-only access token via service account JWT assertion."""
        if self._token and time.monotonic() < self._token_expires:
            return self._token

        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": self._client_email,
                "sub": self._client_email,
                "aud": self._token_uri,
                "iat": now,
                "exp": now + 3600,
                "scope": _SCOPES,
            },
            self._private_key,
            algorithm="RS256",
        )
        # PyJWT 2.x returns str; handle 1.x bytes just in case
        if isinstance(assertion, bytes):
            assertion = assertion.decode()

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                self._token_uri,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["access_token"]
        self._token_expires = time.monotonic() + int(data.get("expires_in", 3600)) - 60
        return self._token

    async def download_file(self, resource_name: str) -> bytes:
        """Download a Google Drive file by resource name or file ID."""
        file_id = _parse_file_id(resource_name)
        token = await self.get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{_DRIVE_API}/files/{file_id}",
                params={"alt": "media"},
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=True,
            )
            resp.raise_for_status()
            return resp.content

    async def send_message(self, space_name: str, message: dict) -> dict:
        """Send a message to a Google Chat space.

        space_name: full resource name, e.g. "spaces/SPACE_ID"
        message: Cards v2 dict from render_gchat()
        """
        token = await self.get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{_CHAT_API}/{space_name}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json=message,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_user_profile(self, user_name: str) -> dict:
        """Get user profile from Google Chat API. user_name: 'users/{user_id}'"""
        token = await self.get_token()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_CHAT_API}/{user_name}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json()


def _parse_file_id(resource_name: str) -> str:
    """Extract file ID from a Google resource name.

    Handles:
      "//drive.googleapis.com/drive/v3/files/FILE_ID"
      "files/FILE_ID"
      "FILE_ID" (bare)
    """
    return resource_name.rstrip("/").split("/")[-1]
