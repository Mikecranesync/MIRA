#!/usr/bin/env python3
"""
MIRA Lead Hunter — main CLI.

Usage:
  python3 hunt.py discover [--cities N] [--queries N] [--max-places N]
  python3 hunt.py enrich [--top N]
  python3 hunt.py score
  python3 hunt.py report [--top N] [--output PATH]
  python3 hunt.py full [--cities N] [--queries N]
  python3 hunt.py stats
"""
from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lead-hunter")


def _check_env():
    missing = [k for k in ("APIFY_API_KEY", "FIRECRAWL_API_KEY", "NEON_DATABASE_URL")
               if not os.environ.get(k)]
    if missing:
        logger.error("Missing env vars: %s — run via: doppler run --project factorylm --config prd -- python3 hunt.py ...", ", ".join(missing))
        sys.exit(1)


def cmd_discover(args):
    _check_env()
    from discover import discover
    logger.info("Discovering via OSM Overpass + curated seed list")
    total = discover()
    logger.info("Discovery complete — %d new/updated facilities", total)


def cmd_enrich(args):
    _check_env()
    from enrich import enrich
    result = enrich(top=args.top)
    logger.info("Enrichment complete: %s", result)


def cmd_score(args):
    _check_env()
    from score import score_all
    result = score_all()
    logger.info("Scoring complete: %s", result)


def cmd_report(args):
    _check_env()
    from db import get_conn, get_contacts_for_facility, get_top_prospects

    conn = get_conn()
    prospects = get_top_prospects(conn, limit=args.top)
    if not prospects:
        logger.warning("No prospects found — run discover + score first")
        conn.close()
        return

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if str(output).endswith(".csv"):
        _write_csv(output, prospects, conn)
    else:
        _write_md(output, prospects, conn)

    conn.close()
    logger.info("Report written: %s  (%d prospects)", output, len(prospects))


def _write_md(path: Path, prospects: list[dict], conn) -> None:
    from db import get_contacts_for_facility

    lines = [
        f"# MIRA Lead Hunter — Central Florida Prospect Report",
        f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        f"Total prospects in report: {len(prospects)}",
        "",
        "---",
        "",
        "## Top 20 Ranked by ICP Score",
        "",
        "| # | Company | City | Phone | Website | Score | Category | Distance |",
        "|---|---------|------|-------|---------|-------|----------|----------|",
    ]

    for i, p in enumerate(prospects[:20], 1):
        website = p.get("website") or ""
        if website and not website.startswith("http"):
            website = f"https://{website}"
        dist = p.get("distance_miles")
        dist_str = f"{dist:.0f} mi" if dist else "?"
        lines.append(
            f"| {i} | {p['name']} | {p.get('city') or '?'} | "
            f"{p.get('phone') or '—'} | "
            f"{'[site](' + website + ')' if website else '—'} | "
            f"**{p.get('icp_score') or 0}** | "
            f"{p.get('category') or '?'} | {dist_str} |"
        )

    lines += ["", "---", "", "## Facility Detail"]

    for i, p in enumerate(prospects[:20], 1):
        score = p.get("icp_score") or 0
        notes = p.get("notes") or ""
        reasons = [n for n in notes.split(",") if n.strip() and "query:" not in n and "pain_signals:" not in n]

        lines += [
            f"",
            f"### {i}. {p['name']}",
            f"- **City:** {p.get('city') or '?'} | **Score:** {score}/24",
            f"- **Phone:** {p.get('phone') or 'not found'}",
            f"- **Website:** {p.get('website') or 'not found'}",
            f"- **Category:** {p.get('category') or 'unknown'}",
            f"- **Reviews:** {p.get('review_count') or 0} | **Rating:** {p.get('rating') or '?'}",
            f"- **Distance:** {p.get('distance_miles') or '?'} miles from Lake Wales",
            f"- **ICP signals:** {', '.join(reasons) or 'none yet'}",
        ]

        contacts = get_contacts_for_facility(conn, str(p["id"]))
        if contacts:
            lines.append("- **Contacts found:**")
            for c in contacts[:3]:
                lines.append(
                    f"  - {c.get('name') or 'Unknown'} "
                    f"({c.get('title') or 'no title'}) — "
                    f"{c.get('email') or 'no email'} | "
                    f"confidence: {c.get('confidence')}"
                )

    lines += [
        "",
        "---",
        "",
        "## Call These First",
        "",
        "Based on ICP score + proximity to Lake Wales FL:",
        "",
    ]

    top5 = [p for p in prospects[:5] if (p.get("icp_score") or 0) >= 3]
    if not top5:
        top5 = prospects[:5]

    for i, p in enumerate(top5, 1):
        why = (p.get("notes") or "").replace("query:", "found via").split("|")[0].strip()
        lines.append(
            f"{i}. **{p['name']}** ({p.get('city') or '?'}) — "
            f"score {p.get('icp_score') or 0}/24 — "
            f"{p.get('phone') or 'no phone'} — {why}"
        )

    lines += ["", "---", "_Generated by MIRA Lead Hunter_"]
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_csv(path: Path, prospects: list[dict], conn) -> None:
    fieldnames = ["rank", "name", "city", "zip", "phone", "website",
                  "category", "icp_score", "distance_miles", "rating",
                  "review_count", "contact_count"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for i, p in enumerate(prospects, 1):
            writer.writerow({"rank": i, **p})


def cmd_stats(args):
    _check_env()
    from db import count_facilities, get_conn
    conn = get_conn()
    counts = count_facilities(conn)
    conn.close()
    total = sum(counts.values())
    print(f"\nLead Hunter Stats — {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'Total facilities:':<25} {total}")
    for status, count in sorted(counts.items()):
        print(f"  {status:<23} {count}")


def cmd_full(args):
    _check_env()
    logger.info("=== FULL PIPELINE RUN ===")

    logger.info("--- Layer 1: Discovery ---")
    from discover import discover
    discover()

    logger.info("--- Layer 3: Scoring (pre-enrich pass) ---")
    from score import score_all
    score_all()

    logger.info("--- Layer 2: Enrich top 50 ---")
    from enrich import enrich
    enrich(top=50)

    logger.info("--- Layer 3: Scoring (post-enrich pass) ---")
    score_all()

    logger.info("--- Report ---")
    ts = datetime.utcnow().strftime("%Y%m%d")
    repo_root = Path(__file__).parent.parent.parent
    out = repo_root / f"marketing/prospects/central-florida-{ts}.md"
    args.output = str(out)
    args.top = 50
    cmd_report(args)

    logger.info("=== PIPELINE COMPLETE ===")


def main():
    parser = argparse.ArgumentParser(description="MIRA Lead Hunter")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_disc = sub.add_parser("discover")
    p_disc.add_argument("--cities", type=int, default=len([]), help="Number of cities (default: all)")
    p_disc.add_argument("--queries", type=int, default=len([]), help="Number of query types (default: all)")
    p_disc.add_argument("--max-places", type=int, default=40)

    p_enrich = sub.add_parser("enrich")
    p_enrich.add_argument("--top", type=int, default=50)

    sub.add_parser("score")

    _repo_root = Path(__file__).parent.parent.parent
    p_rep = sub.add_parser("report")
    p_rep.add_argument("--top", type=int, default=50)
    p_rep.add_argument("--output", default=str(_repo_root / "marketing/prospects/central-florida-report.md"))

    sub.add_parser("stats")

    p_full = sub.add_parser("full")
    p_full.add_argument("--cities", type=int, default=24)
    p_full.add_argument("--queries", type=int, default=13)

    args = parser.parse_args()

    # Fix zero defaults for cities/queries (legacy Apify params, not used by OSM)
    if hasattr(args, "cities") and args.cities == 0:
        args.cities = 24
    if hasattr(args, "queries") and args.queries == 0:
        args.queries = 13

    dispatch = {
        "discover": cmd_discover,
        "enrich": cmd_enrich,
        "score": cmd_score,
        "report": cmd_report,
        "stats": cmd_stats,
        "full": cmd_full,
    }
    dispatch[args.cmd](args)


if __name__ == "__main__":
    main()
