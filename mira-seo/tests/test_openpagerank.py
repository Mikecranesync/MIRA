"""Tests for Open PageRank API client."""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest
import respx

from mira_seo.providers.openpagerank import OpenPageRankClient


@pytest.mark.asyncio
async def test_get_domain_rank_success():
    """Test successful domain rank retrieval."""
    mock_response = {
        "status_code": 200,
        "response": [
            {
                "domain": "example.com",
                "page_rank_integer": 8,
                "rank": 1234,
                "status_code": 200,
            },
            {
                "domain": "test.com",
                "page_rank_integer": 5,
                "rank": 5678,
                "status_code": 200,
            },
        ],
    }

    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "test-api-key"}):
        client = OpenPageRankClient()

        with respx.mock:
            respx.get(
                "https://openpagerank.com/api/v1.0/getPageRank",
                params={"domains[]": ["example.com", "test.com"]},
            ).mock(return_value=__import__("httpx").Response(200, json=mock_response))

            result = await client.get_domain_rank(["example.com", "test.com"])

            assert len(result) == 2
            assert result[0]["domain"] == "example.com"
            assert result[0]["page_rank_integer"] == 8
            assert result[0]["rank"] == 1234
            assert result[1]["domain"] == "test.com"
            assert result[1]["page_rank_integer"] == 5
            assert result[1]["rank"] == 5678


@pytest.mark.asyncio
async def test_get_domain_rank_missing_api_key(caplog):
    """Test that empty list is returned when API key is missing."""
    with patch.dict("os.environ", {"OPENPAGERANK_KEY": ""}):
        client = OpenPageRankClient()

        with caplog.at_level(logging.WARNING):
            result = await client.get_domain_rank(["example.com"])

            assert result == []
            assert "OPENPAGERANK_KEY not set" in caplog.text


@pytest.mark.asyncio
async def test_get_domain_rank_api_key_not_set(caplog):
    """Test warning when API key is not in environment at initialization."""
    with patch.dict("os.environ", {}, clear=True):
        with caplog.at_level(logging.WARNING):
            client = OpenPageRankClient()

            assert "OPENPAGERANK_KEY not set" in caplog.text
            assert not client.api_key


@pytest.mark.asyncio
async def test_get_domain_rank_empty_domains():
    """Test that empty list is returned for empty domain list."""
    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "test-api-key"}):
        client = OpenPageRankClient()
        result = await client.get_domain_rank([])
        assert result == []


@pytest.mark.asyncio
async def test_get_domain_rank_api_error_response(caplog):
    """Test handling of API error response (non-200 status_code)."""
    mock_response = {"status_code": 400, "message": "Invalid request"}

    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "test-api-key"}):
        client = OpenPageRankClient()

        with respx.mock:
            respx.get("https://openpagerank.com/api/v1.0/getPageRank").mock(
                return_value=__import__("httpx").Response(200, json=mock_response)
            )

            with caplog.at_level(logging.WARNING):
                result = await client.get_domain_rank(["example.com"])

                assert result == []
                assert "status_code 400" in caplog.text


@pytest.mark.asyncio
async def test_get_domain_rank_http_error(caplog):
    """Test handling of HTTP errors."""
    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "test-api-key"}):
        client = OpenPageRankClient()

        with respx.mock:
            respx.get("https://openpagerank.com/api/v1.0/getPageRank").mock(
                side_effect=__import__("httpx").ConnectError("Connection failed")
            )

            with caplog.at_level(logging.ERROR):
                result = await client.get_domain_rank(["example.com"])

                assert result == []
                assert "HTTP error" in caplog.text


@pytest.mark.asyncio
async def test_get_domain_rank_correct_headers():
    """Test that correct API-OPR header is sent."""
    mock_response = {
        "status_code": 200,
        "response": [
            {
                "domain": "example.com",
                "page_rank_integer": 8,
                "rank": 1234,
                "status_code": 200,
            }
        ],
    }

    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "secret-key-123"}):
        client = OpenPageRankClient()

        with respx.mock:
            route = respx.get("https://openpagerank.com/api/v1.0/getPageRank").mock(
                return_value=__import__("httpx").Response(200, json=mock_response)
            )

            result = await client.get_domain_rank(["example.com"])

            # Verify the request was made with the correct header
            assert route.called
            request = route.calls[0].request
            assert request.headers["API-OPR"] == "secret-key-123"
            assert result[0]["domain"] == "example.com"


@pytest.mark.asyncio
async def test_get_domain_rank_single_domain():
    """Test querying a single domain."""
    mock_response = {
        "status_code": 200,
        "response": [
            {
                "domain": "example.com",
                "page_rank_integer": 9,
                "rank": 500,
                "status_code": 200,
            }
        ],
    }

    with patch.dict("os.environ", {"OPENPAGERANK_KEY": "test-api-key"}):
        client = OpenPageRankClient()

        with respx.mock:
            respx.get("https://openpagerank.com/api/v1.0/getPageRank").mock(
                return_value=__import__("httpx").Response(200, json=mock_response)
            )

            result = await client.get_domain_rank(["example.com"])

            assert len(result) == 1
            assert result[0]["page_rank_integer"] == 9
            assert result[0]["rank"] == 500
