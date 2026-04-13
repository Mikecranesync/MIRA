"""CSV-driven manual document crawler.

Reads manual_scrape_targets.csv, resolves each row's url_hint to a
downloadable PDF URL, then runs the standard BaseCrawler pipeline.

Two resolution strategies:
  direct  — url_hint already points to a .pdf file → fetch directly
  portal  — url_hint is a manufacturer portal HTML page → parse links,
             find a PDF whose URL or link text contains the model number

After crawling, updates the CSV status column:
  ingested        — successfully stored ≥ 1 chunk
  portal_no_pdf   — portal page crawled but no matching PDF link found
  fetch_failed    — HTTP error on url_hint
  no_chunks       — PDF fetched but produced 0 storable chunks
  (unchanged)     — rows with no url_hint or already processed
"""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from crawler.base_crawler import BaseCrawler

from config import CrawlerConfig

logger = logging.getLogger("mira-crawler.csv")

_DEFAULT_CSV = Path(__file__).resolve().parent.parent / "manual_scrape_targets.csv"


class CSVCrawler(BaseCrawler):
    """Crawls PDF manuals listed in manual_scrape_targets.csv."""

    def __init__(self, config: CrawlerConfig, csv_path: Path | None = None) -> None:
        super().__init__(config)
        self.csv_path = csv_path or _DEFAULT_CSV
        self._status_updates: dict[str, str] = {}  # row_id → new status

    # ------------------------------------------------------------------
    # BaseCrawler interface
    # ------------------------------------------------------------------

    def discover_urls(self) -> list[dict]:
        """Read CSV, resolve each row's url_hint to a downloadable PDF URL."""
        rows = self._read_csv()
        pending = [r for r in rows if r.get("status") == "to_find" and r.get("url_hint", "").strip()]
        logger.info("CSV: %d pending rows with url_hint (of %d total)", len(pending), len(rows))

        entries: list[dict] = []
        for row in pending:
            row_id = row["row_id"]
            url_hint = row["url_hint"].strip()
            model = row.get("model_number", "").strip()
            manufacturer = row.get("manufacturer", "").strip()

            pdf_url = self._resolve_pdf_url(url_hint, model, row_id)
            if not pdf_url:
                continue

            entries.append({
                "url": pdf_url,
                "source_type": "equipment_manual",
                "manufacturer": manufacturer,
                "equipment_id": model or row_id,
                "format": "pdf",
                "row_id": row_id,
            })

        logger.info("CSV: resolved %d PDF URLs to crawl", len(entries))
        return entries

    def crawl(self, dry_run: bool = False) -> dict:
        """Crawl all resolved URLs and update CSV status on completion."""
        stats = super().crawl(dry_run=dry_run)
        if not dry_run:
            self._flush_status_updates()
        return stats

    # ------------------------------------------------------------------
    # URL resolution
    # ------------------------------------------------------------------

    def _resolve_pdf_url(self, url_hint: str, model: str, row_id: str) -> str | None:
        """Return a direct PDF download URL for the given hint.

        Tries in order:
        1. url_hint already ends in .pdf → use directly
        2. HEAD request → redirected to a PDF content-type
        3. GET HTML page → find a <a href="*.pdf"> matching the model number
        """
        if urlparse(url_hint).path.lower().endswith(".pdf"):
            return url_hint

        # Probe for redirect to PDF
        try:
            resp = self._get_client().head(url_hint, follow_redirects=True)
            if "pdf" in resp.headers.get("content-type", ""):
                return str(resp.url)
        except Exception:
            pass

        # Fetch HTML portal and hunt for a matching PDF link
        try:
            resp = self._get_client().get(url_hint, follow_redirects=True)
            resp.raise_for_status()
            if "pdf" in resp.headers.get("content-type", ""):
                return str(resp.url)
            pdf_url = self._find_pdf_in_html(resp.content, str(resp.url), model)
            if pdf_url:
                return pdf_url
            logger.info("portal_no_pdf: %s — no matching PDF at %s", row_id, url_hint)
            self._status_updates[row_id] = "portal_no_pdf"
            return None
        except Exception as e:
            logger.warning("fetch_failed: %s — %s", row_id, e)
            self._status_updates[row_id] = "fetch_failed"
            return None

    def _find_pdf_in_html(self, html: bytes, base_url: str, model: str) -> str | None:
        """Parse HTML, return first PDF <a href> whose URL/text contains the model number.

        If model is empty or very short (<3 chars), returns the first PDF link found.
        """
        soup = BeautifulSoup(html, "html.parser")
        model_tokens = [t.lower() for t in re.split(r"[\s\-_/]+", model) if len(t) >= 3]

        for anchor in soup.find_all("a", href=True):
            href: str = anchor["href"].strip()
            if not href.lower().endswith(".pdf"):
                continue
            full_url = urljoin(base_url, href)
            if not model_tokens:
                return full_url
            text = (anchor.get_text(" ", strip=True) + " " + href).lower()
            if any(tok in text for tok in model_tokens):
                return full_url

        return None

    # ------------------------------------------------------------------
    # Override process() to track status per row
    # ------------------------------------------------------------------

    def process(self, url: str, data: bytes, entry: dict) -> int:
        stored = super().process(url, data, entry)
        row_id = entry.get("row_id", "")
        if row_id:
            self._status_updates[row_id] = "ingested" if stored > 0 else "no_chunks"
        return stored

    # ------------------------------------------------------------------
    # CSV I/O
    # ------------------------------------------------------------------

    def _read_csv(self) -> list[dict]:
        if not self.csv_path.exists():
            logger.error("CSV not found: %s", self.csv_path)
            return []
        with open(self.csv_path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def _flush_status_updates(self) -> None:
        """Write status updates back to the CSV atomically (write tmp, rename)."""
        if not self._status_updates:
            return
        rows = self._read_csv()
        if not rows:
            return
        for row in rows:
            new_status = self._status_updates.get(row["row_id"])
            if new_status:
                row["status"] = new_status

        fieldnames = list(rows[0].keys())
        tmp = self.csv_path.with_suffix(".tmp")
        try:
            with open(tmp, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            tmp.replace(self.csv_path)
            logger.info("CSV updated: %d status changes written", len(self._status_updates))
        except Exception as e:
            logger.error("Failed to update CSV: %s", e)
            tmp.unlink(missing_ok=True)
