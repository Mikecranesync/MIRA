"""Tests for Medium publisher — graceful degradation + happy path."""

from __future__ import annotations

from unittest.mock import patch

import pytest
import respx
from httpx import Response

from mira_seo.models.content import MediumExcerpt
from mira_seo.tools import medium_publisher


def _excerpt() -> MediumExcerpt:
    return MediumExcerpt(
        title="Test", content="x", canonical_url="https://factorylm.com/blog/test", tags=["a", "b"]
    )


@pytest.mark.asyncio
async def test_publish_returns_none_when_unconfigured():
    with patch.dict("os.environ", {}, clear=True):
        assert await medium_publisher.publish(_excerpt()) is None


@pytest.mark.asyncio
async def test_publish_returns_url_on_success():
    with patch.dict(
        "os.environ",
        {"MEDIUM_INTEGRATION_TOKEN": "tok", "MEDIUM_AUTHOR_ID": "uid"},
        clear=True,
    ):
        with respx.mock:
            respx.post("https://api.medium.com/v1/users/uid/posts").mock(
                return_value=Response(
                    201, json={"data": {"url": "https://medium.com/@x/test-abc123"}}
                )
            )
            url = await medium_publisher.publish(_excerpt())
            assert url == "https://medium.com/@x/test-abc123"


@pytest.mark.asyncio
async def test_publish_returns_none_on_api_error():
    with patch.dict(
        "os.environ",
        {"MEDIUM_INTEGRATION_TOKEN": "tok", "MEDIUM_AUTHOR_ID": "uid"},
        clear=True,
    ):
        with respx.mock:
            respx.post("https://api.medium.com/v1/users/uid/posts").mock(
                return_value=Response(401, json={"errors": [{"message": "auth"}]})
            )
            assert await medium_publisher.publish(_excerpt()) is None
