"""Unit tests for the Phase 4 allowlist → queue populator.

Module under test: mira-crawler/cron/queue_populate.py (issue #2562 Phase 4).
Covers: eligibility, dedupe (in-queue / already-ingested / intra-allowlist),
provenance stamping, malformed-entry handling, dry-run, and allowlist parsing.
All hermetic — the pure core is dependency-injected (no DB, no clock, no network).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the (non-package) cron module importable, same as test_kb_growth_cron.
_CRON_DIR = Path(__file__).resolve().parent.parent / "cron"
sys.path.insert(0, str(_CRON_DIR))

import queue_populate as qp  # noqa: E402

_NOW = "2026-07-08T12:00:00+00:00"
_NEVER_INGESTED = lambda url: False  # noqa: E731


def _manual(**over):
    base = {
        "url": "https://cdn.example.com/gs20m.pdf",
        "vendor": "AutomationDirect",
        "model": "GS20",
        "family": "GS20",
        "type": "installation_manual",
        "trust_status": "curated",
        "queue_reason": "test",
    }
    base.update(over)
    return base


# ── eligibility + provenance ────────────────────────────────────────────────

def test_valid_entry_is_queued_with_full_provenance():
    new, skipped = qp.build_queue_entries(
        [_manual()], set(), already_ingested=_NEVER_INGESTED, now=_NOW
    )
    assert not skipped
    (e,) = new
    # consumer fields
    assert e["url"] == "https://cdn.example.com/gs20m.pdf"
    assert e["manufacturer"] == "AutomationDirect"  # vendor -> manufacturer
    assert e["model"] == "GS20"
    assert e["type"] == "installation_manual"
    assert e["status"] == "pending"
    # provenance fields
    assert e["source"] == "allowlist"
    assert e["family"] == "GS20"
    assert e["trust_status"] == "curated"
    assert e["queue_reason"] == "test"
    assert e["discovered_at"] == _NOW


def test_reason_override_wins_over_entry_reason():
    new, _ = qp.build_queue_entries(
        [_manual(queue_reason="entry-level")], set(),
        already_ingested=_NEVER_INGESTED, now=_NOW, reason="batch-level",
    )
    assert new[0]["queue_reason"] == "batch-level"


def test_defaults_applied_when_optional_fields_absent():
    m = {"url": "https://x/y.pdf", "vendor": "V", "model": "M"}
    new, _ = qp.build_queue_entries([m], set(), already_ingested=_NEVER_INGESTED, now=_NOW)
    assert new[0]["type"] == "installation_manual"
    assert new[0]["trust_status"] == "curated"
    assert new[0]["queue_reason"] == "allowlist"
    assert new[0]["family"] is None


# ── dedupe ──────────────────────────────────────────────────────────────────

def test_skips_url_already_in_queue():
    url = "https://cdn.example.com/gs20m.pdf"
    new, skipped = qp.build_queue_entries(
        [_manual(url=url)], {url}, already_ingested=_NEVER_INGESTED, now=_NOW
    )
    assert not new
    assert skipped == [(url, "already_queued")]


def test_skips_url_already_ingested():
    url = "https://cdn.example.com/gs20m.pdf"
    new, skipped = qp.build_queue_entries(
        [_manual(url=url)], set(), already_ingested=lambda u: u == url, now=_NOW
    )
    assert not new
    assert skipped == [(url, "already_ingested")]


def test_dedupes_within_allowlist():
    m = _manual(url="https://dup/x.pdf")
    new, skipped = qp.build_queue_entries(
        [m, dict(m)], set(), already_ingested=_NEVER_INGESTED, now=_NOW
    )
    assert len(new) == 1
    assert skipped == [("https://dup/x.pdf", "already_queued")]


# ── malformed entries ───────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    {"vendor": "V", "model": "M"},                       # no url
    {"url": "", "vendor": "V", "model": "M"},            # blank url
    {"url": "https://x/y.pdf", "model": "M"},            # no vendor
    {"url": "https://x/y.pdf", "vendor": "V"},           # no model
    {"url": "https://x/y.pdf", "vendor": "", "model": "M"},  # blank vendor
])
def test_skips_missing_required_fields(bad):
    new, skipped = qp.build_queue_entries(
        [bad], set(), already_ingested=_NEVER_INGESTED, now=_NOW
    )
    assert not new
    assert skipped[0][1] == "missing_required_field"


def test_empty_allowlist_is_noop():
    new, skipped = qp.build_queue_entries([], set(), already_ingested=_NEVER_INGESTED, now=_NOW)
    assert new == [] and skipped == []


# ── populate() persistence + dry-run ────────────────────────────────────────

def test_populate_writes_queue_when_new(tmp_path):
    al = tmp_path / "al.yaml"
    al.write_text(
        "manuals:\n"
        "  - url: https://x/one.pdf\n    vendor: V\n    model: M1\n"
        "  - url: https://x/two.pdf\n    vendor: V\n    model: M2\n",
        encoding="utf-8",
    )
    saved = {}
    new, skipped = qp.populate(
        al,
        load_queue=lambda: [{"url": "https://x/one.pdf"}],  # one already queued
        save_queue=lambda q: saved.update(q=q),
        already_ingested=_NEVER_INGESTED,
        now=_NOW,
    )
    assert len(new) == 1 and new[0]["model"] == "M2"
    assert any(w == "already_queued" for _, w in skipped)
    # persisted = original + the one new
    assert len(saved["q"]) == 2


def test_populate_dry_run_does_not_write(tmp_path):
    al = tmp_path / "al.yaml"
    al.write_text("manuals:\n  - url: https://x/one.pdf\n    vendor: V\n    model: M1\n", encoding="utf-8")
    saved = {}
    new, _ = qp.populate(
        al, load_queue=lambda: [], save_queue=lambda q: saved.update(q=q),
        already_ingested=_NEVER_INGESTED, now=_NOW, dry_run=True,
    )
    assert len(new) == 1
    assert "q" not in saved  # never persisted


# ── allowlist parsing ───────────────────────────────────────────────────────

def test_load_allowlist_parses_manuals(tmp_path):
    al = tmp_path / "al.yaml"
    al.write_text("manuals:\n  - url: https://x/y.pdf\n    vendor: V\n    model: M\n", encoding="utf-8")
    got = qp.load_allowlist(al)
    assert got == [{"url": "https://x/y.pdf", "vendor": "V", "model": "M"}]


def test_load_allowlist_empty_file_is_empty(tmp_path):
    al = tmp_path / "al.yaml"
    al.write_text("   \n", encoding="utf-8")
    assert qp.load_allowlist(al) == []


def test_load_allowlist_rejects_non_list_manuals(tmp_path):
    al = tmp_path / "al.yaml"
    al.write_text("manuals: not-a-list\n", encoding="utf-8")
    with pytest.raises(ValueError):
        qp.load_allowlist(al)


def test_repo_allowlist_is_valid_and_deduped():
    """The shipped drive_manuals.yaml parses, has required fields, unique urls."""
    path = _CRON_DIR / "allowlists" / "drive_manuals.yaml"
    manuals = qp.load_allowlist(path)
    assert manuals, "allowlist should not be empty"
    urls = [m["url"] for m in manuals]
    assert len(urls) == len(set(urls)), "allowlist has duplicate urls"
    for m in manuals:
        for f in qp.REQUIRED_FIELDS:
            assert m.get(f), f"allowlist entry missing {f}: {m}"
