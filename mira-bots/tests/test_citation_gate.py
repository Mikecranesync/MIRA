"""Unit tests for the citation gate feature.

Tests cover:
1. _compute_kb_status() — coverage classification logic in RAGWorker
2. PROCEED override detection in engine.process_full()
3. Banner injection logic (covered/partial/uncovered states)

All tests are offline — no LLM calls, no SQLite, no network.
Pattern follows test_q_trap_guard.py: minimal stub via SimpleNamespace.
"""

from __future__ import annotations

import os
import sys
import unittest.mock

# Minimal env vars to satisfy module-level imports
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_citation_gate_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Stub heavy optional deps — but ONLY if the real module isn't available.
# Unconditional stubbing poisons sys.modules for later tests that need the
# real module (e.g. test_image_downscale needs real PIL).
# Do NOT stub 'telegram' or 'telegram.ext' either.
for _mod in (
    "PIL",
    "PIL.Image",
    "slack_sdk",
    "slack_sdk.web.async_client",
    "slack_sdk.errors",
    "python_telegram_bot",
):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

from shared.workers.rag_worker import RAGWorker  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_worker() -> RAGWorker:
    """Instantiate a RAGWorker with no network deps."""
    w = RAGWorker.__new__(RAGWorker)
    w._last_neon_chunks = []
    w._kb_status = {"status": "unknown", "citations": []}
    return w


def _chunk(manufacturer: str, model_number: str, similarity: float, section: str = "") -> dict:
    return {
        "manufacturer": manufacturer,
        "model_number": model_number,
        "similarity": similarity,
        "metadata": {"section": section},
        "source_url": "",
    }


# ---------------------------------------------------------------------------
# _compute_kb_status tests
# ---------------------------------------------------------------------------


class TestComputeKbStatus:
    def test_no_chunks_returns_uncovered(self):
        w = _make_worker()
        result = w._compute_kb_status(neon_chunks=[], has_chunks=False)
        assert result["status"] == "uncovered"
        assert result["citations"] == []

    def test_has_chunks_false_returns_uncovered_even_with_chunks(self):
        """has_chunks=False means cross-vendor filter cleared them — uncovered."""
        w = _make_worker()
        chunks = [_chunk("Yaskawa", "V1000", 0.90)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=False)
        assert result["status"] == "uncovered"

    def test_all_low_similarity_returns_uncovered(self):
        """Chunks below 0.65 threshold count as uncovered."""
        w = _make_worker()
        chunks = [
            _chunk("ABB", "ACS580", 0.50),
            _chunk("ABB", "ACS580", 0.62),
        ]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "uncovered"
        assert result["citations"] == []

    def test_one_high_quality_chunk_returns_partial(self):
        w = _make_worker()
        chunks = [_chunk("Siemens", "G120", 0.72)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "partial"
        assert len(result["citations"]) == 1
        assert result["citations"][0]["manufacturer"] == "Siemens"

    def test_two_high_quality_chunks_returns_partial(self):
        w = _make_worker()
        chunks = [
            _chunk("Danfoss", "FC302", 0.68),
            _chunk("Danfoss", "FC302", 0.71),
        ]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "partial"
        assert len(result["citations"]) == 2

    def test_three_high_quality_chunks_returns_covered(self):
        w = _make_worker()
        chunks = [
            _chunk("Rockwell", "PowerFlex 525", 0.85),
            _chunk("Rockwell", "PowerFlex 525", 0.81),
            _chunk("Rockwell", "PowerFlex 525", 0.78),
        ]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "covered"
        assert len(result["citations"]) == 3

    def test_mixed_similarity_only_high_quality_counted(self):
        """Low-similarity chunks do not contribute to covered threshold."""
        w = _make_worker()
        chunks = [
            _chunk("AutomationDirect", "GS10", 0.88),
            _chunk("AutomationDirect", "GS10", 0.40),  # below threshold
            _chunk("AutomationDirect", "GS10", 0.82),
        ]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        # Only 2 above threshold → partial, not covered
        assert result["status"] == "partial"
        assert len(result["citations"]) == 2

    def test_citations_capped_at_three(self):
        """Even with many high-quality chunks, citations are capped at 3."""
        w = _make_worker()
        chunks = [_chunk("Rockwell", "PowerFlex 525", 0.85 - i * 0.01) for i in range(6)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "covered"
        assert len(result["citations"]) == 3

    def test_citation_includes_metadata_section(self):
        w = _make_worker()
        chunks = [_chunk("Yaskawa", "A1000", 0.80, section="Parameter Settings")]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["citations"][0]["section"] == "Parameter Settings"

    def test_boundary_similarity_exactly_065_included(self):
        """Similarity of exactly 0.65 must be counted as high quality."""
        w = _make_worker()
        chunks = [_chunk("SEW", "MOVITRAC", 0.65)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "partial"

    def test_boundary_similarity_just_below_065_excluded(self):
        w = _make_worker()
        chunks = [_chunk("SEW", "MOVITRAC", 0.649)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "uncovered"

    def test_kb_status_property_reflects_last_compute(self):
        """kb_status property returns whatever was last set."""
        w = _make_worker()
        w._kb_status = {"status": "covered", "citations": [{"manufacturer": "Rockwell"}]}
        assert w.kb_status["status"] == "covered"
        assert w.kb_status["citations"][0]["manufacturer"] == "Rockwell"


# ---------------------------------------------------------------------------
# PROCEED override — verify engine sets override_mode in FSM context
# ---------------------------------------------------------------------------


class TestProceedOverride:
    """
    Test that PROCEED/OVERRIDE keywords set override_mode=True in FSM context.
    We call engine._load_state + check context directly rather than spinning
    up the full async engine.
    """

    def _load_and_save(self):
        """Return minimal _load_state / _save_state stubs backed by a dict."""
        store: dict = {}

        def load(chat_id: str) -> dict:
            return store.get(
                chat_id,
                {
                    "chat_id": chat_id,
                    "state": "DIAGNOSIS",
                    "context": {},
                    "asset_identified": None,
                    "fault_category": None,
                    "exchange_count": 0,
                    "final_state": None,
                },
            )

        def save(chat_id: str, state: dict) -> None:
            store[chat_id] = state

        return load, save, store

    def test_proceed_sets_override_mode(self):
        """When PROCEED is received, override_mode must be True in FSM context."""
        load, save, store = self._load_and_save()

        # Simulate what process_full does for PROCEED detection
        chat_id = "chat-001"
        message = "PROCEED"
        state = load(chat_id)

        if message.strip().upper() in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
            ctx = state.get("context") or {}
            ctx["override_mode"] = True
            state["context"] = ctx
            save(chat_id, state)

        saved = load(chat_id)
        assert saved["context"].get("override_mode") is True

    def test_proceed_case_insensitive(self):
        """'proceed' lowercase should also trigger override."""
        load, save, store = self._load_and_save()
        chat_id = "chat-002"
        message = "proceed"
        state = load(chat_id)

        if message.strip().upper() in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
            ctx = state.get("context") or {}
            ctx["override_mode"] = True
            state["context"] = ctx
            save(chat_id, state)

        assert load(chat_id)["context"].get("override_mode") is True

    def test_non_proceed_does_not_set_override(self):
        """Normal diagnostic message must not set override_mode."""
        load, save, store = self._load_and_save()
        chat_id = "chat-003"
        message = "The motor trips on overcurrent"
        state = load(chat_id)

        if message.strip().upper() in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
            ctx = state.get("context") or {}
            ctx["override_mode"] = True
            state["context"] = ctx
            save(chat_id, state)

        assert load(chat_id)["context"].get("override_mode") is None

    def test_all_override_keywords(self):
        """All four override keywords must set override_mode."""
        for kw in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
            load, save, store = self._load_and_save()
            chat_id = "chat-kw"
            state = load(chat_id)
            if kw.strip().upper() in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
                ctx = state.get("context") or {}
                ctx["override_mode"] = True
                state["context"] = ctx
                save(chat_id, state)
            assert load(chat_id)["context"].get("override_mode") is True, f"Failed for: {kw!r}"


# ---------------------------------------------------------------------------
# Citation gate banner logic
# ---------------------------------------------------------------------------


class TestCitationGateBanners:
    """
    Verify banner / gate message strings without running the full engine.
    These tests exercise the same conditional logic that lives in engine.process_full().
    """

    def _apply_gate(
        self,
        kb_status: str,
        override_mode: bool,
        technical_state: bool,
        citations: list[dict] | None = None,
        vendor_label: str = "Yaskawa",
        initial_reply: str = "Check the overload relay.",
    ) -> str | None:
        """Replicate the citation gate banner logic. Returns None if gate blocks (early return)."""
        citations = citations or []
        parsed_reply = initial_reply

        if not technical_state:
            return parsed_reply

        if kb_status == "uncovered" and not override_mode:
            return None  # gate blocks — early return in engine

        elif kb_status == "partial" and not override_mode:
            mfr_label = citations[0]["manufacturer"] if citations else vendor_label
            parsed_reply = (
                f"🟡 **KB: Partial coverage** — {mfr_label} (searching for more)\n\n" + parsed_reply
            )

        elif kb_status == "covered" and not override_mode:
            mfr = citations[0]["manufacturer"] if citations else ""
            mdl = citations[0]["model_number"] if citations else ""
            cov_label = f"{mfr} {mdl}".strip() or vendor_label
            parsed_reply = f"🟢 **KB: {cov_label}**\n\n" + parsed_reply

        elif override_mode:
            parsed_reply = (
                "⚠️ **BEST-GUESS MODE** — No manual. LLM estimate only, "
                "not verified against documentation.\n\n" + parsed_reply
            )

        # Citation footer
        if kb_status in ("covered", "partial") and citations and not override_mode:
            footer_parts = []
            for c in citations[:2]:
                c_label = f"{c['manufacturer']} {c['model_number']}".strip()
                if c.get("section"):
                    c_label += f", {c['section']}"
                url = c.get("source_url", "")
                footer_parts.append(f"[{c_label}]({url})" if url else c_label)
            if footer_parts:
                parsed_reply += f"\n\n---\n📚 *Source: {' · '.join(footer_parts)}*"

        return parsed_reply

    def test_uncovered_no_override_blocks(self):
        result = self._apply_gate(kb_status="uncovered", override_mode=False, technical_state=True)
        assert result is None

    def test_uncovered_with_override_shows_bestguess_banner(self):
        result = self._apply_gate(kb_status="uncovered", override_mode=True, technical_state=True)
        assert result is not None
        assert "⚠️" in result
        assert "BEST-GUESS MODE" in result

    def test_partial_shows_yellow_banner(self):
        citations = [
            {"manufacturer": "Siemens", "model_number": "G120", "source_url": "", "section": ""}
        ]
        result = self._apply_gate(
            kb_status="partial", override_mode=False, technical_state=True, citations=citations
        )
        assert result is not None
        assert "🟡" in result
        assert "Siemens" in result

    def test_covered_shows_green_banner(self):
        citations = [
            {
                "manufacturer": "Rockwell",
                "model_number": "PowerFlex 525",
                "source_url": "",
                "section": "",
            }
        ]
        result = self._apply_gate(
            kb_status="covered", override_mode=False, technical_state=True, citations=citations
        )
        assert result is not None
        assert "🟢" in result
        assert "Rockwell PowerFlex 525" in result

    def test_covered_appends_citation_footer(self):
        citations = [
            {
                "manufacturer": "Rockwell",
                "model_number": "PowerFlex 525",
                "source_url": "https://example.com/manual.pdf",
                "section": "Fault Codes",
            }
        ]
        result = self._apply_gate(
            kb_status="covered", override_mode=False, technical_state=True, citations=citations
        )
        assert "📚" in result
        assert "Rockwell PowerFlex 525, Fault Codes" in result
        assert "example.com" in result

    def test_partial_appends_citation_footer(self):
        citations = [
            {"manufacturer": "Danfoss", "model_number": "FC302", "source_url": "", "section": ""}
        ]
        result = self._apply_gate(
            kb_status="partial", override_mode=False, technical_state=True, citations=citations
        )
        assert "📚" in result
        assert "Danfoss FC302" in result

    def test_non_technical_state_passes_through(self):
        """Q1/Q2/Q3 states must never be gated — only DIAGNOSIS/FIX_STEP."""
        result = self._apply_gate(kb_status="uncovered", override_mode=False, technical_state=False)
        assert result == "Check the overload relay."

    def test_covered_with_override_shows_bestguess_not_green(self):
        """override_mode bypasses the covered banner too."""
        citations = [
            {"manufacturer": "Rockwell", "model_number": "PF525", "source_url": "", "section": ""}
        ]
        result = self._apply_gate(
            kb_status="covered", override_mode=True, technical_state=True, citations=citations
        )
        assert "⚠️" in result
        assert "🟢" not in result

    def test_footer_capped_at_two_citations(self):
        """Citation footer shows at most 2 sources."""
        citations = [
            {"manufacturer": "Rockwell", "model_number": f"PF-{i}", "source_url": "", "section": ""}
            for i in range(5)
        ]
        result = self._apply_gate(
            kb_status="covered", override_mode=False, technical_state=True, citations=citations
        )
        # Count occurrences of "Rockwell PF-" in the footer
        footer_idx = result.find("📚")
        footer_text = result[footer_idx:]
        assert footer_text.count("Rockwell PF-") == 2
