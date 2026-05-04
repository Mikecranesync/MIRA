"""Standalone Serper probe — verifies the contact-enrichment layer works.

Mirrors the logic in hunt.py::search_contacts_via_serper but runs against a
handful of hardcoded test facilities so it can execute from any machine with
SERPER_API_KEY set (no NeonDB required).

Run:  SERPER_API_KEY=... python tools/lead-hunter/probe_serper.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Iterable

import httpx

SERPER_URL = "https://google.serper.dev/search"

# Copied from hunt.py — keep in sync
MAINT_TITLES = [
    "maintenance manager",
    "maintenance supervisor",
    "plant manager",
    "facilities manager",
    "facilities director",
    "operations manager",
    "reliability engineer",
    "maintenance engineer",
    "chief engineer",
    "engineering manager",
]

_TITLE_SNIPPET_RE = re.compile(
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,\-|\u2013\u2014]\s*("
    + "|".join(re.escape(t) for t in MAINT_TITLES)
    + r")",
    re.IGNORECASE,
)


def probe(company: str, domain: str, client: httpx.Client, key: str) -> list[dict]:
    queries: list[str] = [f'"maintenance manager" OR "plant manager" "{company}"']
    if domain:
        queries.append(f'"maintenance manager" OR "facilities manager" site:{domain}')
    queries.append(f'"{company}" "linkedin.com/in"')

    contacts: list[dict] = []
    seen: set[str] = set()
    headers = {"X-API-KEY": key, "Content-Type": "application/json"}

    for q in queries:
        try:
            r = client.post(SERPER_URL, headers=headers, json={"q": q, "num": 10})
            r.raise_for_status()
            organic = r.json().get("organic", [])
        except Exception as e:
            print(f"  [err] query failed: {q[:60]} — {e}")
            continue

        for hit in organic:
            snippet = hit.get("snippet", "") + " " + hit.get("title", "")
            for m in _TITLE_SNIPPET_RE.finditer(snippet):
                name = m.group(1).strip()
                title = m.group(2).strip().lower()
                key_ = f"{name}|{title}".lower()
                if key_ in seen:
                    continue
                seen.add(key_)
                contacts.append(
                    {
                        "name": name,
                        "title": title,
                        "source": hit.get("link", ""),
                        "query": q,
                    }
                )
    return contacts


def main() -> int:
    key = os.environ.get("SERPER_API_KEY", "")
    if not key:
        print("ERROR: SERPER_API_KEY not set", file=sys.stderr)
        return 1

    # Realistic SMB manufacturing targets — public companies Mike's lead-hunter
    # would plausibly hit. Pulled from common PA/OH industrial corridor.
    test_facilities: list[tuple[str, str]] = [
        ("Stroehmann Bakeries", "stroehmann.com"),
        ("Oberg Industries", "oberg.com"),
        ("Turner Dairy Farms", "turnerdairy.com"),
    ]

    print(f"Serper probe — {len(test_facilities)} facilities, 3 queries each")
    print(f"Key prefix: {key[:8]}... (budget: 9 queries, ~$0.01)")
    print("=" * 70)

    with httpx.Client(timeout=15) as client:
        for company, domain in test_facilities:
            print(f"\n>> {company} ({domain})")
            contacts = probe(company, domain, client, key)
            if not contacts:
                print("   no Name+Title matches in snippets")
                continue
            for c in contacts[:5]:
                print(f"   - {c['name']} — {c['title']}")
                print(f"     src: {c['source'][:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
