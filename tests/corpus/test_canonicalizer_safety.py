"""The two safety properties the previous canonicalizer violated.

Both are regression tests for measured harm, not hypotheticals — see
`docs/testing/2026-08-10-corpus-p0-incident.md`:

  1. A destructive run was guarded by `if "prod" in url`. Neon URLs contain
     neither `prod` nor `staging`, so the guard could never fire and 3,364 rows
     were deleted behind it.
  2. Dedup partitioned on content hash scoped by `model_number ILIKE '%525%'`,
     which collapsed identical boilerplate across DIFFERENT publications: 45 rows
     were deleted from the `520-qs001` Quick Start because their text also
     appears in the `520-um001` User Manual.

Deliberately pure-function tests. The identity rule and the environment guard are
exactly the parts that caused data loss, so they must be provable without a live
database — a test that needs staging is a test that gets skipped in CI.
"""

from __future__ import annotations

import os
import sys

import pytest

# Import via the tools/ directory rather than a `tools.corpus` package path:
# `tools/__init__.py` is known repo noise that must not be added
# (.claude/rules/session-discipline.md), so `tools` is not importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))

from corpus import dedup_identity as di  # noqa: E402
from corpus import identity as ident  # noqa: E402

# Realistic Neon URLs. Note that NEITHER contains the substring "prod" or
# "staging" — which is the entire reason the old guard was inert.
STAGING_URL = "postgresql://u:p@ep-quiet-boat-123456.us-east-2.aws.neon.tech/neondb"
PROD_URL = "postgresql://u:p@ep-still-hall-987654.us-east-2.aws.neon.tech/neondb"


class FakeConn:
    def __init__(self, dbname="neondb"):
        self._db = dbname

    def execute(self, *_a, **_k):
        class R:
            def __init__(self, v):
                self._v = v

            def scalar(self):
                return self._v

        return R(self._db)


@pytest.fixture(autouse=True)
def _arm(monkeypatch):
    monkeypatch.setenv(ident.MUTATION_ENV, "1")


# ---------------------------------------------------------------------------
# 1. production-shaped URLs are rejected
# ---------------------------------------------------------------------------


class TestEnvironmentIdentity:
    def test_production_url_is_rejected_when_staging_was_declared(self):
        """The headline case: connected to prod, expecting staging."""
        obs = ident.observe(FakeConn(), PROD_URL)
        with pytest.raises(ident.IdentityError, match="identity mismatch"):
            ident.assert_target(obs, "ep-quiet-boat-123456/neondb")

    def test_declared_staging_matching_the_connection_is_allowed(self):
        obs = ident.observe(FakeConn(), STAGING_URL)
        ident.assert_target(obs, "ep-quiet-boat-123456/neondb")  # no raise

    def test_missing_declaration_is_a_refusal_not_a_default_allow(self):
        obs = ident.observe(FakeConn(), STAGING_URL)
        with pytest.raises(ident.IdentityError, match="required"):
            ident.assert_target(obs, None)

    def test_neither_url_contains_prod_or_staging(self):
        """Pins WHY the old substring guard was inert, so nobody reinstates it."""
        for url in (STAGING_URL, PROD_URL):
            assert "prod" not in url.lower()
            assert "staging" not in url.lower()

    def test_right_host_but_wrong_database_is_rejected(self):
        obs = ident.observe(FakeConn(dbname="analytics"), STAGING_URL)
        with pytest.raises(ident.IdentityError, match="identity mismatch"):
            ident.assert_target(obs, "ep-quiet-boat-123456/neondb")

    def test_env_lock_must_be_armed_separately(self, monkeypatch):
        monkeypatch.delenv(ident.MUTATION_ENV, raising=False)
        obs = ident.observe(FakeConn(), STAGING_URL)
        with pytest.raises(ident.IdentityError, match=ident.MUTATION_ENV):
            ident.assert_target(obs, "ep-quiet-boat-123456/neondb")

    def test_malformed_identity_token_is_rejected(self):
        obs = ident.observe(FakeConn(), STAGING_URL)
        with pytest.raises(ident.IdentityError, match="host-prefix/dbname"):
            ident.assert_target(obs, "neondb")

    def test_identity_string_carries_no_credentials(self):
        obs = ident.observe(FakeConn(), STAGING_URL)
        assert "u:p" not in obs.redacted() and "@" not in obs.redacted()


# ---------------------------------------------------------------------------
# 2. identical text from different manuals / manufacturers is preserved
# ---------------------------------------------------------------------------

BOILERPLATE = "ATTENTION: Risk of injury or equipment damage exists."


def row(rid, url, mfr="Rockwell Automation", content=BOILERPLATE, page=1):
    return {
        "id": rid,
        "source_url": url,
        "manufacturer": mfr,
        "content": content,
        "source_page": page,
    }


class TestDedupIdentityPreservesDistinctDocuments:
    def test_same_text_in_user_manual_and_quick_start_is_NOT_deduped(self):
        """The exact harm: 45 rows lost from 520-qs001 to 520-um001."""
        rows = [
            row("um", "520-um001_-en-e.pdf"),
            row("qs", "gdrive://520-qs001_-en-e.pdf"),
        ]
        assert di.plan_retirements(rows) == [], (
            "identical boilerplate in two different publications was retired"
        )

    def test_same_text_from_different_manufacturers_is_NOT_deduped(self):
        rows = [
            row("ab", "520-um001_-en-e.pdf", mfr="Rockwell Automation"),
            row("ad", "gs10m.pdf", mfr="AutomationDirect"),
        ]
        assert di.plan_retirements(rows) == []

    def test_same_text_at_different_revisions_is_NOT_deduped(self):
        rows = [
            row("en", "520-um001_-en-e.pdf"),
            row("fr", "520-um001_-fr-p.pdf"),
        ]
        assert di.plan_retirements(rows) == []

    def test_ingest_variants_of_ONE_document_ARE_deduped(self):
        """The legitimate case — four paths to the same publication."""
        rows = [
            row("a", "gdrive://520-um001_-en-e.pdf"),
            row("b", "gdrive://520-um001_-en-e (1).pdf"),
            row("c", "520-um001_-en-e.pdf"),
            row("d", "https://literature.rockwellautomation.com/x/520-um001_-en-e.pdf"),
        ]
        retired = di.plan_retirements(rows)
        assert len(retired) == 3, "should keep exactly one of four ingest variants"

    def test_the_citable_ingest_is_the_survivor_when_preferred(self):
        keep = "https://literature.rockwellautomation.com/x/520-um001_-en-e.pdf"
        rows = [row("a", "gdrive://520-um001_-en-e.pdf"), row("k", keep)]
        retired = di.plan_retirements(rows, prefer_url=keep)
        assert [r["id"] for r in retired] == ["a"]

    def test_different_text_in_the_same_document_is_NOT_deduped(self):
        rows = [
            row("a", "520-um001_-en-e.pdf", content="Clear fault. Press Stop."),
            row("b", "520-um001_-en-e.pdf", content="Cycle drive power."),
        ]
        assert di.plan_retirements(rows) == []

    def test_unattributable_rows_are_never_deduped_on_text_alone(self):
        """No source_url means no document identity, so no duplicate claim."""
        rows = [row("x", None), row("y", None)]
        assert di.plan_retirements(rows) == []

    def test_selection_is_deterministic_across_runs(self):
        rows = [
            row("b", "gdrive://520-um001_-en-e.pdf", page=9),
            row("a", "520-um001_-en-e.pdf", page=3),
        ]
        first = [r["id"] for r in di.plan_retirements(rows)]
        assert first == [r["id"] for r in di.plan_retirements(list(reversed(rows)))]


class TestCanonicalDocument:
    @pytest.mark.parametrize(
        "url",
        [
            "gdrive://520-um001_-en-e.pdf",
            "gdrive://520-um001_-en-e (1).pdf",
            "520-um001_-en-e.pdf",
            "https://literature.rockwellautomation.com/idc/g/520-um001_-en-e.pdf",
        ],
    )
    def test_ingest_variants_collapse_to_one_publication(self, url):
        assert di.canonical_document(url) == "520-um001"

    def test_quick_start_is_a_different_publication(self):
        assert di.canonical_document("520-qs001_-en-e.pdf") != di.canonical_document(
            "520-um001_-en-e.pdf"
        )
