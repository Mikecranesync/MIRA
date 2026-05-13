"""Metrics reporter — writes docs/seo/YYYY-MM-DD.md and commits it to the repo."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from mira_seo.models.content import DraftPayload

logger = logging.getLogger("mira-seo.metrics-reporter")

_REPO_ROOT = Path(__file__).resolve().parents[4]  # mira-seo/../.. = Mira root
_SEO_DIR = _REPO_ROOT / "docs" / "seo"


def _format_report(date: str, payload: DraftPayload, status: str = "pending_review") -> str:
    blog = payload.blog_post
    brief = payload.brief
    snap = payload.metrics_snapshot

    sources_md = "\n".join(
        f"{i + 1}. [{s.title}]({s.url}) — {s.source}"
        for i, s in enumerate(payload.feed_sources[:5])
    )

    return f"""# SEO Daily Report — {date}

## Content Generated
- **Blog**: [{blog.title}](/blog/{blog.slug}) (status: {status})
- **Keyword**: "{brief.keyword}" ({brief.angle})
- **Sources**: {len(payload.feed_sources)} stories ({', '.join(s.source for s in payload.feed_sources[:3])})

## Approval Status
- Telegram notification sent at {snap.fetched_at.strftime('%H:%M UTC') if snap.fetched_at else 'N/A'} — awaiting approval

## SEO Metrics
| Metric | Value |
|--------|-------|
| Domain authority | {snap.domain_authority:.1f} |
| GSC clicks (7d) | {snap.gsc_clicks_7d} |
| GSC impressions (7d) | {snap.gsc_impressions_7d} |
| Top GSC query | "{snap.gsc_top_query}" (pos {snap.gsc_top_position:.1f}) |

## Feed Sources Today
{sources_md}
"""


def write_and_commit(date: str, payload: DraftPayload, status: str = "pending_review") -> None:
    """Write SEO daily report and commit it to the repo.

    Args:
        date: ISO date string (YYYY-MM-DD)
        payload: DraftPayload with all content + metrics
        status: current draft status
    """
    try:
        _SEO_DIR.mkdir(parents=True, exist_ok=True)
        report_path = _SEO_DIR / f"{date}.md"
        report_path.write_text(_format_report(date, payload, status), encoding="utf-8")
        logger.info("Wrote SEO report to %s", report_path)

        subprocess.run(
            ["git", "add", str(report_path)],
            cwd=_REPO_ROOT,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", f"docs(seo): daily report {date}"],
            cwd=_REPO_ROOT,
            check=True,
            capture_output=True,
        )
        logger.info("Committed SEO report for %s", date)
    except subprocess.CalledProcessError as exc:
        logger.warning("git commit failed (possibly nothing to commit): %s", exc.stderr)
    except Exception:
        logger.exception("Failed to write/commit SEO report for %s", date)
