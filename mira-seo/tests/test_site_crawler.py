"""Tests for mira_seo.providers.site_crawler."""

from __future__ import annotations

import pytest
from aioresponses import aioresponses

from mira_seo.providers.site_crawler import PageAudit, crawl


@pytest.mark.asyncio
async def test_crawl_basic():
    """Test crawl() returns PageAudit objects."""
    base_url = "https://example.com"

    # Mock HTML responses
    html_index = """
    <html>
        <head>
            <title>Example Home</title>
            <meta name="description" content="Example homepage">
            <link rel="canonical" href="https://example.com/">
            <meta name="robots" content="index, follow">
        </head>
        <body>
            <h1>Welcome</h1>
            <p>This is a test page with some content.</p>
            <a href="/about">About</a>
            <a href="https://external.com">External</a>
        </body>
    </html>
    """

    html_about = """
    <html>
        <head>
            <title>About Us</title>
            <meta name="description" content="About page">
        </head>
        <body>
            <h1>About</h1>
            <p>Information about the site.</p>
            <a href="/">Home</a>
        </body>
    </html>
    """

    with aioresponses() as mocked:
        mocked.get(
            "https://example.com/",
            body=html_index,
            status=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
        )
        mocked.get(
            "https://example.com/about",
            body=html_about,
            status=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
        )

        result = await crawl(base_url, max_pages=10)

        # Should have at least 1 audit
        assert len(result) >= 1
        assert isinstance(result[0], PageAudit)
        assert result[0].status_code == 200


@pytest.mark.asyncio
async def test_missing_alt_images():
    """Test that missing_alt_images counts correctly."""
    base_url = "https://example.com"

    html_with_images = """
    <html>
        <head><title>Images</title></head>
        <body>
            <img src="test1.jpg" alt="Good alt">
            <img src="test2.jpg">
            <img src="test3.jpg" alt="">
            <img src="test4.jpg" alt="Another good">
        </body>
    </html>
    """

    with aioresponses() as mocked:
        mocked.get(
            base_url + "/",
            body=html_with_images,
            status=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
        )

        result = await crawl(base_url, max_pages=1)

        assert len(result) >= 1
        # Should have 2 images without alt (test2.jpg and test3.jpg with empty alt)
        assert result[0].missing_alt_images == 2


@pytest.mark.asyncio
async def test_internal_vs_external_links():
    """Test classification of internal vs external links."""
    base_url = "https://example.com"

    html = """
    <html>
        <head><title>Links</title></head>
        <body>
            <a href="/internal">Internal</a>
            <a href="https://example.com/another">Internal Absolute</a>
            <a href="https://external.com">External</a>
            <a href="http://other.org/path">External</a>
        </body>
    </html>
    """

    with aioresponses() as mocked:
        mocked.get(
            base_url + "/",
            body=html,
            status=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
        )

        result = await crawl(base_url, max_pages=1)

        assert len(result) >= 1
        audit = result[0]

        # Should have 2 internal links
        assert len(audit.internal_links) == 2
        # Should have 2 external links
        assert len(audit.external_links) == 2


@pytest.mark.asyncio
async def test_crawl_respects_max_pages():
    """Test crawl respects max_pages limit."""
    base_url = "https://example.com"

    html = """
    <html>
        <head><title>Page</title></head>
        <body>
            <a href="/page1">Page 1</a>
            <a href="/page2">Page 2</a>
            <a href="/page3">Page 3</a>
        </body>
    </html>
    """

    with aioresponses() as mocked:
        # Mock multiple pages
        headers = {"Content-Type": "text/html; charset=utf-8"}
        mocked.get(base_url + "/", body=html, status=200, headers=headers)
        mocked.get("https://example.com/page1", body=html, status=200, headers=headers)
        mocked.get("https://example.com/page2", body=html, status=200, headers=headers)
        mocked.get("https://example.com/page3", body=html, status=200, headers=headers)

        result = await crawl(base_url, max_pages=2)

        # Should not exceed max_pages
        assert len(result) <= 2


@pytest.mark.asyncio
async def test_page_audit_with_error():
    """Test that connection errors are captured in error field."""
    base_url = "https://unreachable.com"

    with aioresponses() as mocked:
        # Simulate a connection error
        mocked.get(base_url + "/", exception=ConnectionError("DNS failure"))

        result = await crawl(base_url, max_pages=1)

        assert len(result) >= 1
        assert result[0].error is not None
        assert "DNS" in result[0].error or "failure" in result[0].error.lower()


@pytest.mark.asyncio
async def test_page_audit_contains_metadata():
    """Test that PageAudit contains all required metadata fields."""
    base_url = "https://example.com"

    html = """
    <html>
        <head>
            <title>Test Page</title>
            <meta name="description" content="Test description">
            <link rel="canonical" href="https://example.com/test">
            <meta name="robots" content="noindex">
        </head>
        <body>
            <h1>Test Heading</h1>
            <h1>Another Heading</h1>
            <p>Some test content with multiple words.</p>
            <img src="test.jpg" alt="test">
        </body>
    </html>
    """

    with aioresponses() as mocked:
        mocked.get(
            base_url + "/",
            body=html,
            status=200,
            headers={"Content-Type": "text/html; charset=utf-8"},
        )

        result = await crawl(base_url, max_pages=1)

        assert len(result) >= 1
        audit = result[0]

        # Verify all required fields
        assert audit.url == base_url + "/"
        assert audit.status_code == 200
        assert audit.title == "Test Page"
        assert audit.meta_description == "Test description"
        assert len(audit.h1_tags) == 2
        assert "Test Heading" in audit.h1_tags
        assert audit.canonical == "https://example.com/test"
        assert audit.robots_meta == "noindex"
        assert audit.missing_alt_images == 0
        assert audit.response_time_ms > 0
        assert audit.word_count > 0
        assert audit.error is None
