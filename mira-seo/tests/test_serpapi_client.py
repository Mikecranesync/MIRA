"""Tests for SerpAPI async client."""

from __future__ import annotations

import pytest
import respx
from httpx import Response

from mira_seo.providers.serpapi_client import SerpAPIClient


@pytest.fixture
def mock_api_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set a mock API key for testing."""
    key = "test_serpapi_key_12345"
    monkeypatch.setenv("SERPAPI_KEY", key)
    return key


@pytest.mark.asyncio
async def test_search_organic_success(mock_api_key: str) -> None:
    """Test successful organic search with mocked httpx response."""
    client = SerpAPIClient()

    mock_response = {
        "organic_results": [
            {
                "position": 1,
                "title": "Example Result",
                "url": "https://example.com",
                "snippet": "This is an example snippet.",
            },
            {
                "position": 2,
                "title": "Another Result",
                "url": "https://another.com",
                "snippet": "Another snippet here.",
            },
        ]
    }

    with respx.mock:
        respx.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google",
                "q": "python programming",
                "num": 10,
                "api_key": mock_api_key,
            },
        ).mock(return_value=Response(200, json=mock_response))

        results = await client.search_organic("python programming")

    assert len(results) == 2
    assert results[0]["position"] == 1
    assert results[0]["title"] == "Example Result"
    assert results[0]["url"] == "https://example.com"
    assert results[0]["snippet"] == "This is an example snippet."
    assert results[1]["position"] == 2


@pytest.mark.asyncio
async def test_domain_top_pages(mock_api_key: str) -> None:
    """Test domain_top_pages calls search_organic with site: prefix."""
    client = SerpAPIClient()

    mock_response = {
        "organic_results": [
            {
                "position": 1,
                "title": "About Us",
                "url": "https://example.com/about",
                "snippet": "Learn about our company.",
            },
        ]
    }

    with respx.mock:
        respx.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google",
                "q": "site:example.com",
                "num": 10,
                "api_key": mock_api_key,
            },
        ).mock(return_value=Response(200, json=mock_response))

        results = await client.domain_top_pages("example.com")

    assert len(results) == 1
    assert results[0]["url"] == "https://example.com/about"


@pytest.mark.asyncio
async def test_empty_api_key_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that empty SERPAPI_KEY returns empty list without raising."""
    monkeypatch.setenv("SERPAPI_KEY", "")

    client = SerpAPIClient()
    results = await client.search_organic("test query")

    assert results == []


@pytest.mark.asyncio
async def test_empty_api_key_domain_search(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that empty SERPAPI_KEY in domain_top_pages returns empty list."""
    monkeypatch.setenv("SERPAPI_KEY", "")

    client = SerpAPIClient()
    results = await client.domain_top_pages("example.com")

    assert results == []


@pytest.mark.asyncio
async def test_quota_warning_at_threshold(
    mock_api_key: str, caplog: pytest.LogCaptureFixture
) -> None:
    """Test that quota warning is logged at call 80 (warn_threshold)."""
    client = SerpAPIClient()

    mock_response = {"organic_results": []}

    with respx.mock:
        respx.get("https://serpapi.com/search.json").mock(
            return_value=Response(200, json=mock_response)
        )

        for i in range(80):
            await client.search_organic(f"query {i}")

    assert client._call_count == 80
    assert any("call count at 80" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_quota_status(mock_api_key: str) -> None:
    """Test quota_status returns correct dict."""
    client = SerpAPIClient()

    status = client.quota_status()
    assert status["calls_this_session"] == 0
    assert status["warn_threshold"] == 80
    assert status["free_limit"] == 100


@pytest.mark.asyncio
async def test_result_with_missing_fields(mock_api_key: str) -> None:
    """Test that missing fields default to empty string/0."""
    client = SerpAPIClient()

    mock_response = {
        "organic_results": [
            {
                "position": 1,
                "title": "Title Only",
            },
        ]
    }

    with respx.mock:
        respx.get("https://serpapi.com/search.json").mock(
            return_value=Response(200, json=mock_response)
        )

        results = await client.search_organic("test")

    assert len(results) == 1
    assert results[0]["position"] == 1
    assert results[0]["title"] == "Title Only"
    assert results[0]["url"] == ""
    assert results[0]["snippet"] == ""


@pytest.mark.asyncio
async def test_http_error_handling(mock_api_key: str, caplog: pytest.LogCaptureFixture) -> None:
    """Test that HTTP errors are logged and empty list returned."""
    client = SerpAPIClient()

    with respx.mock:
        respx.get("https://serpapi.com/search.json").mock(return_value=Response(500))

        results = await client.search_organic("test")

    assert results == []
    assert any("request failed" in record.message for record in caplog.records)
