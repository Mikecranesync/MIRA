"""Populate ``manual_queue.json`` from a curated, version-controlled allowlist.

Phase 4 of Drive Commander (issue #2562): give the ``kb_growth`` cron safe,
provenance-stamped fuel **without** hand-editing the queue or scraping. Reads an
allowlist YAML (``mira-crawler/cron/allowlists/*.yaml``) whose entries each carry
provenance (vendor / family / model / url / trust_status / queue_reason) and
appends the eligible, deduped ones to the queue as ``status="pending"``.

Dedupe mirrors ``kb_growth_cron.hydrate_from_manual_cache``:
  - skip a url already present in ``manual_queue.json``,
  - skip a url already ingested (chunks in ``knowledge_entries``) — via the
    injected ``already_ingested`` callable,
  - skip a url repeated within the allowlist itself,
  - skip an entry missing a required field (``url`` / ``vendor`` / ``model``).

The policy core (``build_queue_entries``) is **pure and dependency-injected**, so
it unit-tests offline with no DB and no filesystem. ``main()`` wires it to
``kb_growth_cron``'s ``load_queue`` / ``save_queue`` / ``url_already_ingested`` /
``_ts`` and to ``NeonTagStore``-free psycopg2 dedup already living there.

Usage (ops / cron / bench):
    python mira-crawler/cron/queue_populate.py \\
        --allowlist mira-crawler/cron/allowlists/drive_manuals.yaml \\
        --reason "Phase 4 tiny allowlist"
    # dry-run: add --dry-run to print what WOULD be queued without writing
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Callable

# Required provenance fields on every allowlist entry.
REQUIRED_FIELDS = ("url", "vendor", "model")

# What the pipeline consumes vs. what we stamp for provenance/audit.
_DEFAULT_TYPE = "installation_manual"
_DEFAULT_TRUST = "curated"


def load_allowlist(path: str | Path) -> list[dict[str, Any]]:
    """Parse an allowlist YAML → list of manual dicts (the ``manuals:`` key).

    Never raises on an empty/whitespace file — returns ``[]``.
    """
    import yaml  # lazy: keeps the pure core importable without pyyaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    manuals = data.get("manuals") or []
    if not isinstance(manuals, list):
        raise ValueError(f"{path}: 'manuals' must be a list, got {type(manuals).__name__}")
    return manuals


def build_queue_entries(
    allowlist: list[dict[str, Any]],
    existing_urls: set[str] | frozenset[str],
    *,
    already_ingested: Callable[[str], bool],
    now: str,
    reason: str | None = None,
) -> tuple[list[dict[str, Any]], list[tuple[str | None, str]]]:
    """Pure policy core. Return ``(new_entries, skipped)``.

    ``new_entries`` are ready to append to the queue (``status="pending"`` +
    provenance). ``skipped`` is a list of ``(url, reason)`` for logging/audit.
    Deterministic: no clock, no I/O — ``now`` and ``already_ingested`` are
    injected so tests are hermetic.
    """
    new: list[dict[str, Any]] = []
    skipped: list[tuple[str | None, str]] = []
    seen: set[str] = set(existing_urls)

    for m in allowlist:
        url = (m.get("url") or "").strip()
        if not url or any(not (m.get(f) or "") for f in REQUIRED_FIELDS):
            skipped.append((m.get("url"), "missing_required_field"))
            continue
        if url in seen:
            skipped.append((url, "already_queued"))
            continue
        if already_ingested(url):
            skipped.append((url, "already_ingested"))
            continue

        seen.add(url)
        new.append(
            {
                # ── consumed by kb_growth_cron / full_ingest ──
                "url": url,
                "manufacturer": m["vendor"],
                "model": m["model"],
                "type": m.get("type") or _DEFAULT_TYPE,
                "status": "pending",
                # ── provenance (auditable; ignored by the consumer) ──
                "source": "allowlist",
                "family": m.get("family"),
                "trust_status": m.get("trust_status") or _DEFAULT_TRUST,
                "queue_reason": reason or m.get("queue_reason") or "allowlist",
                "discovered_at": now,
            }
        )

    return new, skipped


def populate(
    allowlist_path: str | Path,
    *,
    load_queue: Callable[[], list[dict[str, Any]]],
    save_queue: Callable[[list[dict[str, Any]]], None],
    already_ingested: Callable[[str], bool],
    now: str,
    reason: str | None = None,
    dry_run: bool = False,
) -> tuple[list[dict[str, Any]], list[tuple[str | None, str]]]:
    """Load allowlist + current queue, compute additions, (optionally) persist.

    Returns ``(new_entries, skipped)``. On ``dry_run`` the queue is not written.
    """
    allowlist = load_allowlist(allowlist_path)
    queue = load_queue()
    existing_urls = {e.get("url") for e in queue if e.get("url")}
    new, skipped = build_queue_entries(
        allowlist, existing_urls, already_ingested=already_ingested, now=now, reason=reason
    )
    if new and not dry_run:
        queue.extend(new)
        save_queue(queue)
    return new, skipped


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - CLI glue
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allowlist", required=True, help="Path to an allowlist YAML")
    parser.add_argument("--reason", default=None, help="Override queue_reason for this batch")
    parser.add_argument("--dry-run", action="store_true", help="Print additions without writing the queue")
    args = parser.parse_args(argv)

    # Wire the pure core to the live queue primitives (same ones the cron uses).
    from kb_growth_cron import _ts, load_queue, save_queue, url_already_ingested

    new, skipped = populate(
        args.allowlist,
        load_queue=load_queue,
        save_queue=save_queue,
        already_ingested=url_already_ingested,
        now=_ts(),
        reason=args.reason,
        dry_run=args.dry_run,
    )
    tag = "[dry-run] would queue" if args.dry_run else "queued"
    print(f"{tag} {len(new)} manual(s); skipped {len(skipped)}")
    for e in new:
        print(f"  + {e['manufacturer']} {e['model']}  ({e['trust_status']})  {e['url']}")
    for url, why in skipped:
        print(f"  - skip [{why}] {url}")
    return 0


if __name__ == "__main__":  # pragma: no cover - manual/ops entry
    sys.exit(main())
