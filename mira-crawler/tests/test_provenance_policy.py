"""Gate 6 — one canonical provenance policy; no origin ships unclassified.

The drift this closes: the curation gate authorized shared-corpus writes from
`sources.yaml` (18 hosts) while the feeders kept their own manifests. Structural
discovery finds **17 URL manifests** across `tasks/*.py` and **38 distinct feeder
origins, 31 absent from the gate** — every one a source the crawler is configured
to fetch and the gate is configured to refuse.

The load-bearing test here is `test_every_configured_origin_is_classified`. It
re-derives the origin set from the real module constants rather than trusting a
list, so a new feeder, a new URL in an existing manifest, or a renamed constant
all fail closed.

A discovery-driven test is only as good as its discovery, so the population is
asserted too: a walker that silently stops finding manifests would turn the
whole file into a vacuous pass, which is worse than no test because it reads as
coverage. Writing the walker naively already missed two of five real manifests
(`RSS_FEEDS` is an `ast.AnnAssign`; `foundational.py` has two).
"""

from __future__ import annotations

import pytest
import yaml
from ingest import origins as origins_mod
from ingest import provenance

VALID_CLASSIFICATIONS = {"curated", "private", "blocked", "infrastructure"}


@pytest.fixture(scope="module")
def policy() -> dict:
    return provenance.load_policy()


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------


def test_every_configured_origin_is_classified(policy):
    """No configured feeder origin may lack a canonical classification."""
    configured = origins_mod.discover_feeder_origins()
    entries = policy["origins"]
    missing = {host: sorted(srcs) for host, srcs in configured.items() if host not in entries}
    assert not missing, (
        "these configured origins have no entry in provenance_policy.yaml — "
        "classify each as curated / private / blocked / infrastructure WITH A "
        "REASON (widening the gate to admit them is not a fix): "
        + "; ".join(f"{h} <- {', '.join(s)}" for h, s in sorted(missing.items()))
    )


def test_discovery_still_sees_the_known_manifests():
    """Honesty check: a walker that finds nothing would pass everything."""
    found = origins_mod.discover_manifests()
    for expected in (
        "rss.RSS_FEEDS",  # AnnAssign — missed by a naive ast.Assign-only walk
        "sitemaps.SITEMAP_URLS",
        "discover.MANUFACTURER_TARGETS",
        "foundational.DIRECT_TARGETS",
        "foundational.APIFY_TARGETS",  # second manifest in one file
    ):
        assert expected in found, f"discovery no longer sees {expected}"
    assert len(origins_mod.discover_feeder_origins()) >= 30, (
        "origin discovery collapsed — the consistency test above would pass vacuously"
    )


def test_every_entry_is_well_formed(policy):
    """Each entry states a valid classification, a reason, and who decided."""
    bad = []
    for host, e in policy["origins"].items():
        if not isinstance(e, dict):
            bad.append(f"{host}: not a mapping")
            continue
        if e.get("classification") not in VALID_CLASSIFICATIONS:
            bad.append(f"{host}: classification {e.get('classification')!r}")
        if not str(e.get("reason", "")).strip():
            bad.append(f"{host}: empty reason")
        if not str(e.get("confirmed_by", "")).strip():
            bad.append(f"{host}: no confirmed_by — a decision must name its owner")
    assert not bad, "malformed policy entries: " + "; ".join(bad)


def test_no_entry_is_left_unreviewed(policy):
    """The generator's placeholder must never survive into a merge."""
    unreviewed = [
        h for h, e in policy["origins"].items() if "UNREVIEWED" in str(e.get("reason", ""))
    ]
    assert not unreviewed, f"origins still carrying the UNREVIEWED placeholder: {unreviewed}"


# ---------------------------------------------------------------------------
# Fail-closed behaviour — an unclassified origin must be refused in PRODUCTION,
# not merely flagged in CI
# ---------------------------------------------------------------------------


def test_unclassified_origin_is_refused(policy):
    ok, reason = provenance.shared_corpus_allowed("https://never-seen.invalid/m.pdf", policy=policy)
    assert ok is False
    assert "unclassified" in reason


def test_blocked_and_private_origins_cannot_reach_the_shared_corpus(policy):
    for url, expected in [
        ("https://www.manualslib.com/x", "blocked"),
        ("https://www.reddit.com/r/x", "private"),
        ("https://api.groq.com/v1/x", "infrastructure"),
    ]:
        cls, _ = provenance.classify_origin(url, policy=policy)
        assert cls == expected, f"{url} classified {cls}, expected {expected}"
        assert provenance.shared_corpus_allowed(url, policy=policy)[0] is False


def test_curated_origin_is_allowed(policy):
    ok, _ = provenance.shared_corpus_allowed("https://library.e.abb.com/m.pdf", policy=policy)
    assert ok is True


def test_local_source_is_never_shared_regardless_of_policy(policy):
    """The local-file floor outranks the origin policy — belt and braces."""
    for url in ("file:///x/a.pdf", "file:/x/a.pdf", "/x/a.pdf"):
        assert provenance.shared_corpus_allowed(url, policy=policy)[0] is False


def test_a_malformed_policy_fails_loud_not_open(tmp_path):
    """A missing/empty policy must raise, never degrade to allow-everything."""
    empty = tmp_path / "p.yaml"
    empty.write_text("version: 1\norigins: {}\n")
    with pytest.raises(RuntimeError):
        provenance.load_policy(empty)


def test_policy_is_the_only_host_list(policy):
    """No second manifest may re-introduce the drift this unit closed.

    `sources.yaml` survives as the human curation INPUT, but every host in it
    must also appear in the canonical policy — otherwise the two can disagree
    again, which is the whole defect.
    """
    from urllib.parse import urlparse

    import pathlib

    sources = pathlib.Path(origins_mod.TASKS_DIR).parent / "sources.yaml"
    urls: list[str] = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k == "url" and isinstance(v, str):
                    urls.append(v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    walk(yaml.safe_load(sources.read_text(encoding="utf-8")))
    gate_hosts = {(urlparse(u).hostname or "").lower() for u in urls if urlparse(u).hostname}
    missing = sorted(gate_hosts - set(policy["origins"]))
    assert not missing, (
        "sources.yaml hosts absent from the canonical policy — the two lists can "
        f"drift again: {missing}"
    )
