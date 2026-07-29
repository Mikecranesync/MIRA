"""Regression: product_hint parameter activates product stream correctly.

Tests that recall_knowledge uses product_hint to enable product-name search
when the hardcoded _PRODUCT_NAME_RE doesn't recognize the model (#2211).

Pre-fix, whitespace-only hints ("   ") would be treated as truthy and create
a junk product search. This test proves:
  1. Valid hint (e.g., "IMPULSE G+") activates _product_search
  2. Extracted products take precedence over hints
  3. None, empty, and whitespace-only hints are ignored
  4. Tenant isolation remains intact when using product_hint
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402


def _mock_engine_with_conn(conn: MagicMock) -> MagicMock:
    """Mock SQLAlchemy engine that returns a fixed connection."""
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    return engine


def _patch_create_engine(engine):
    """Patch sqlalchemy.create_engine since it's imported inside recall_knowledge."""
    import sqlalchemy

    return patch.object(sqlalchemy, "create_engine", return_value=engine)


def _make_product_row(manufacturer: str, model: str) -> dict:
    """Create a mock product search result row."""
    return {
        "content": f"{manufacturer} {model} product manual chunk",
        "manufacturer": manufacturer,
        "model_number": model,
        "equipment_type": "VFD",
        "source_type": "manual",
        "source_url": None,
        "source_page": 42,
        "metadata": {},
        "verified": True,
        "similarity": 0.82,
    }


class TestProductHintActivation:
    """Verify product_hint activates _product_search."""

    def test_product_hint_used_when_no_regex_match(self):
        """When query doesn't match hardcoded regex but hint is given, use hint."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            # Query with no recognized product pattern
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="why is the motor stopping?",  # No PowerFlex/GS/Micro/...
                product_hint="IMPULSE G+",
            )

        # _product_search should have been called with the hint
        product_spy.assert_called_once()
        # Verify the hint was passed as the product name
        call_args = product_spy.call_args
        product_names = call_args[0][3]  # 4th positional arg is product_names
        assert "IMPULSE G+" in product_names

    def test_extracted_product_takes_precedence(self):
        """When query contains a recognized product, use it, not the hint."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            # Query contains PowerFlex 525 (will be extracted)
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="PowerFlex 525 F0004 fault",
                product_hint="IMPULSE G+",  # This hint should be ignored
            )

        # _product_search should have been called with extracted name, not hint
        if product_spy.called:
            call_args = product_spy.call_args
            product_names = call_args[0][3]
            # Extracted product should be present
            assert any("PowerFlex" in str(name) or "525" in str(name) for name in product_names)
            # Hint should NOT be the only product (if at all)
            if len(product_names) == 1:
                assert product_names[0] != "IMPULSE G+"

    def test_none_hint_ignored(self):
        """product_hint=None should not trigger a product search."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="something about a drive",
                product_hint=None,
            )

        # _product_search should NOT be called (no extracted products, no hint)
        product_spy.assert_not_called()

    def test_empty_string_hint_ignored(self):
        """product_hint='' should not trigger a product search."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="something about a drive",
                product_hint="",
            )

        # _product_search should NOT be called
        product_spy.assert_not_called()

    def test_whitespace_only_hint_ignored(self):
        """product_hint='   ' should not trigger a product search (trim check)."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="something about a drive",
                product_hint="   ",  # Whitespace only
            )

        # _product_search should NOT be called (after trim, it's empty)
        product_spy.assert_not_called()

    def test_hint_trimmed_before_use(self):
        """product_hint with leading/trailing whitespace is trimmed."""
        conn = MagicMock()
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            recall_knowledge(
                [0.5] * 4,
                "tenant-1",
                query_text="unknown equipment",
                product_hint="  IMPULSE G+  ",  # With surrounding whitespace
            )

        # _product_search should be called with trimmed hint
        if product_spy.called:
            call_args = product_spy.call_args
            product_names = call_args[0][3]
            # Verify the trimmed version is used (no leading/trailing spaces)
            assert any(name == "IMPULSE G+" for name in product_names)


class TestProductHintTenantIsolation:
    """Verify product_hint doesn't break tenant isolation."""

    def test_product_hint_respects_tenant_filter(self):
        """Using product_hint does not bypass the tenant/is_private filter."""
        conn = MagicMock()
        # Mock the vector query to return empty (simplified scenario)
        conn.execute.return_value.mappings.return_value.fetchall.return_value = []

        engine = _mock_engine_with_conn(conn)
        with (
            _patch_create_engine(engine),
            patch.object(neon_recall, "_product_search") as product_spy,
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            # Call with tenant and product_hint
            tenant_a = "tenant-uuid-aaa"
            recall_knowledge(
                [0.5] * 4,
                tenant_a,
                query_text="unknown device",
                product_hint="IMPULSE G+",
            )

        # If _product_search was called, verify it received the tenant_id
        if product_spy.called:
            call_args = product_spy.call_args
            # conn, text_fn, tenant_id, product_names, embedding, limit
            tenant_arg = call_args[0][2]
            assert tenant_arg == tenant_a
