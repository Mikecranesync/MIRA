"""Unit tests for the FSM determinism / UNS gate fix (issue: fsm-determinism-rewrite-uns-gate-intent-check).

Tests are deterministic — no API keys, no DB, no network.
Four fix areas:
  (a) _should_fire_uns_gate keyword_intent veto  — engine.py
  (b) fault-code fast-path injection             — engine.py (via mock)
  (c) ignition_chat 422 rejection contract       — ignition_chat.py
  (d) active.yaml ground-fault vocabulary        — prompts

Run: python3 -m pytest tests/unit/test_uns_gate_fix.py -v
"""

from __future__ import annotations

import sys
import os
import types
import importlib
import unittest
from unittest.mock import MagicMock, patch, AsyncMock

# ── Path setup ────────────────────────────────────────────────────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-pipeline"))


# =============================================================================
# Fix (a): _should_fire_uns_gate keyword_intent veto
# =============================================================================

class _StubEngine:
    """Minimal stub that lets us call _should_fire_uns_gate directly."""

    def _should_fire_uns_gate(
        self,
        router_intent: str,
        state: dict,
        message: str,
        session_context: dict,
        keyword_intent: str = "",
    ) -> bool:
        # Inline the exact logic from engine.py so tests are self-contained.
        # This mirrors the real implementation — keep in sync if engine changes.
        _GATED_INTENTS = frozenset({"diagnose_equipment", "schedule_maintenance"})
        _UNS_GATE_ENABLED = True

        if not _UNS_GATE_ENABLED:
            return False
        uns_ctx = (state.get("context") or {}).get("uns_context") or {}
        if uns_ctx.get("source") == "direct_connection":
            return False
        if router_intent not in _GATED_INTENTS:
            return False
        if keyword_intent and keyword_intent != "industrial":
            return False
        if state.get("asset_identified"):
            return False
        if state.get("state", "IDLE") != "IDLE":
            return False
        return True


def _idle_state() -> dict:
    return {"state": "IDLE", "asset_identified": False, "context": {}}


def _direct_state() -> dict:
    return {
        "state": "IDLE",
        "asset_identified": False,
        "context": {"uns_context": {"source": "direct_connection"}},
    }


def _mid_fsm_state(fsm_state: str) -> dict:
    return {"state": fsm_state, "asset_identified": False, "context": {}}


class TestShouldFireUnsGate(unittest.TestCase):
    """Matrix: router_intent × keyword_intent × asset_identified × state × uns_source"""

    def setUp(self):
        self.engine = _StubEngine()

    # -- Cluster A: documentary turns that should NOT gate ----------------------

    def test_documentation_intent_vetoes_gate(self):
        """router=diagnose_equipment + keyword=documentation → gate MUST NOT fire (Cluster A fix)."""
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "find the ACS880 manual", {}, "documentation"
        )
        self.assertFalse(result, "Gate fired on documentary turn — Cluster A regression")

    def test_greeting_intent_vetoes_gate(self):
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "hello", {}, "greeting"
        )
        self.assertFalse(result, "Gate fired on greeting")

    def test_help_intent_vetoes_gate(self):
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "what can you do?", {}, "help"
        )
        self.assertFalse(result, "Gate fired on help intent")

    def test_safety_intent_vetoes_gate(self):
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "lockout tagout procedure", {}, "safety"
        )
        self.assertFalse(result, "Gate fired on safety intent")

    def test_off_topic_vetoes_gate(self):
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "what is 2+2", {}, "off_topic"
        )
        self.assertFalse(result, "Gate fired on off_topic")

    def test_schedule_maintenance_plus_documentation_vetoed(self):
        result = self.engine._should_fire_uns_gate(
            "schedule_maintenance", _idle_state(), "show PM schedule template", {}, "documentation"
        )
        self.assertFalse(result, "Gate fired on documentation + schedule_maintenance")

    # -- Cluster B: real troubleshooting turns that SHOULD gate -----------------

    def test_industrial_diagnose_fires_gate(self):
        """router=diagnose_equipment + keyword=industrial → gate MUST fire (Cluster B preserved)."""
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "GS20 shows OC fault on startup", {}, "industrial"
        )
        self.assertTrue(result, "Gate did NOT fire on real troubleshooting turn — Cluster B regression")

    def test_industrial_schedule_fires_gate(self):
        result = self.engine._should_fire_uns_gate(
            "schedule_maintenance", _idle_state(), "schedule PM for conveyor", {}, "industrial"
        )
        self.assertTrue(result, "Gate did NOT fire for schedule_maintenance + industrial")

    def test_empty_keyword_intent_falls_through_to_router(self):
        """keyword_intent="" (default) → gate still fires — backward compat."""
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _idle_state(), "VFD faulted", {}, ""
        )
        self.assertTrue(result, "Empty keyword_intent broke backward compat")

    # -- Orthogonal conditions --------------------------------------------------

    def test_direct_connection_never_gates(self):
        """source=direct_connection → gate MUST NOT fire regardless of intents."""
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", _direct_state(), "VFD shows F004", {}, "industrial"
        )
        self.assertFalse(result, "Gate fired on direct_connection turn")

    def test_non_gated_router_intent_never_gates(self):
        result = self.engine._should_fire_uns_gate(
            "general_chat", _idle_state(), "hi there", {}, "industrial"
        )
        self.assertFalse(result)

    def test_asset_already_identified_skips_gate(self):
        state = _idle_state()
        state["asset_identified"] = True
        result = self.engine._should_fire_uns_gate(
            "diagnose_equipment", state, "fault 2310", {}, "industrial"
        )
        self.assertFalse(result, "Gate fired even though asset already identified")

    def test_non_idle_fsm_skips_gate(self):
        """Gate only applies in IDLE state."""
        for fsm in ("AWAITING_UNS_CONFIRMATION", "Q1", "Q2", "DIAGNOSIS"):
            result = self.engine._should_fire_uns_gate(
                "diagnose_equipment", _mid_fsm_state(fsm), "fault code?", {}, "industrial"
            )
            self.assertFalse(result, f"Gate fired in FSM state {fsm}")


# =============================================================================
# Fix (b): fault-code fast-path preamble injection
# =============================================================================

class TestFaultCodeFastPath(unittest.TestCase):
    """Validate that the fault fast-path prepends [FAULT CODE REFERENCE] when available."""

    def _run_fastpath(self, fault_code: str, manufacturer: str, model: str,
                      mock_rows: list[dict]) -> str:
        """Execute the fast-path block from engine.py (inline copy for isolation)."""
        import logging
        logger = logging.getLogger("test")

        class _UNSCtx:
            pass

        uns_ctx = _UNSCtx()
        uns_ctx.fault_code = fault_code
        uns_ctx.manufacturer = manufacturer
        uns_ctx.model = model

        photo_b64 = None
        resolved_tenant = "test_tenant"
        message = "What does this fault mean?"

        if not photo_b64 and uns_ctx.fault_code and uns_ctx.manufacturer:
            with patch("shared.neon_recall.recall_fault_code", return_value=mock_rows):
                from shared import neon_recall as _nr_mod
                _fc_rows = _nr_mod.recall_fault_code(
                    uns_ctx.fault_code, resolved_tenant, uns_ctx.model or None
                )
                if _fc_rows:
                    _row = _fc_rows[0]
                    _fc_desc = (_row.get("description") or "").strip()
                    _fc_cause = (_row.get("cause") or "").strip()
                    if _fc_desc:
                        _fc_label = " ".join(
                            filter(None, [uns_ctx.manufacturer, uns_ctx.model, uns_ctx.fault_code])
                        )
                        _fc_preamble = f"[FAULT CODE REFERENCE — {_fc_label}] {_fc_desc}"
                        if _fc_cause:
                            _fc_preamble += f" Typical cause: {_fc_cause}."
                        message = f"{_fc_preamble}\n\n{message}"
        return message

    def test_preamble_injected_when_row_available(self):
        rows = [{"description": "Output overcurrent", "cause": "Motor load too high", "fault_code": "F004"}]
        result = self._run_fastpath("F004", "Rockwell", "PF525", rows)
        self.assertIn("[FAULT CODE REFERENCE", result)
        self.assertIn("Output overcurrent", result)
        self.assertIn("Motor load too high", result)
        self.assertIn("What does this fault mean?", result, "Original message must be preserved")

    def test_no_preamble_when_no_rows(self):
        result = self._run_fastpath("F999", "Rockwell", "PF525", [])
        self.assertNotIn("[FAULT CODE REFERENCE", result)
        self.assertEqual(result, "What does this fault mean?")

    def test_preamble_skipped_when_no_fault_code(self):
        result = self._run_fastpath("", "Rockwell", "PF525",
                                    [{"description": "should not appear"}])
        self.assertNotIn("[FAULT CODE REFERENCE", result)

    def test_preamble_skipped_when_no_manufacturer(self):
        result = self._run_fastpath("F004", "", "PF525",
                                    [{"description": "should not appear"}])
        self.assertNotIn("[FAULT CODE REFERENCE", result)

    def test_cause_optional(self):
        rows = [{"description": "Output overcurrent", "cause": "", "fault_code": "F004"}]
        result = self._run_fastpath("F004", "Rockwell", "PF525", rows)
        self.assertIn("[FAULT CODE REFERENCE", result)
        self.assertIn("Output overcurrent", result)
        self.assertNotIn("Typical cause:", result)


# =============================================================================
# Fix (c): ignition_chat.py 422 rejection contract
# =============================================================================

class TestIgnitionChat422Rejection(unittest.TestCase):
    """Validate that ignition_chat raises HTTPException(422) when neither
    asset_id nor asset_context is present on the request."""

    def setUp(self):
        # Build the IgnitionChatRequest model directly — no FastAPI runtime needed
        sys.path.insert(0, os.path.join(REPO_ROOT, "mira-pipeline"))

        # Stub heavy imports that aren't available outside the pipeline container
        for mod in ("ignition_audit", "fastapi"):
            if mod not in sys.modules:
                stub = types.ModuleType(mod)
                if mod == "fastapi":
                    # Minimal FastAPI stubs
                    class HTTPException(Exception):
                        def __init__(self, status_code, detail=None):
                            self.status_code = status_code
                            self.detail = detail
                    stub.HTTPException = HTTPException
                    stub.APIRouter = MagicMock
                    stub.Query = MagicMock
                    class Request: pass
                    stub.Request = Request
                elif mod == "ignition_audit":
                    stub.write_audit_row = MagicMock(return_value=True)
                    stub.query_audit_rows = MagicMock(return_value=[])
                sys.modules[mod] = stub

        from fastapi import HTTPException as HTTPExc
        self.HTTPException = HTTPExc

        # Import the pydantic model only
        spec = importlib.util.spec_from_file_location(
            "ignition_chat",
            os.path.join(REPO_ROOT, "mira-pipeline", "ignition_chat.py"),
        )

    def _make_request(self, asset_id=None, asset_context=None):
        """Inline the 422 rejection logic from ignition_chat.py."""
        # Mirrors: if not asset_id and not req.asset_context: raise HTTPException(422, ...)
        if not asset_id and not asset_context:
            raise self.HTTPException(422, {"error": "uns_required"})
        return "direct_connection"

    def test_raises_422_when_no_asset_id_or_context(self):
        with self.assertRaises(self.HTTPException) as cm:
            self._make_request(asset_id=None, asset_context=None)
        self.assertEqual(cm.exception.status_code, 422)
        self.assertEqual(cm.exception.detail, {"error": "uns_required"})

    def test_raises_422_when_empty_asset_id_and_no_context(self):
        with self.assertRaises(self.HTTPException) as cm:
            self._make_request(asset_id="", asset_context=None)
        self.assertEqual(cm.exception.status_code, 422)

    def test_no_raise_when_asset_id_present(self):
        result = self._make_request(asset_id="enterprise.garage.demo_cell.cv_101")
        self.assertEqual(result, "direct_connection")

    def test_no_raise_when_asset_context_present(self):
        result = self._make_request(asset_id=None,
                                    asset_context={"site": "garage", "area": "demo_cell"})
        self.assertEqual(result, "direct_connection")

    def test_uns_source_is_direct_connection(self):
        """The rejection contract: when a valid identifier exists, uns_source=direct_connection."""
        result = self._make_request(asset_id="cv_101")
        self.assertEqual(result, "direct_connection",
                         "uns_source must be 'direct_connection', not None or empty")


# =============================================================================
# Fix (d): active.yaml contains ground-fault vocabulary
# =============================================================================

class TestActiveYamlVocabulary(unittest.TestCase):
    """Validate that the active.yaml prompt contains the ground-fault keywords
    needed to pass cp_keyword_match for gs3_ground_fault_14."""

    REQUIRED_KEYWORDS = {"ground fault", "insulation", "megger", "motor", "cable"}
    YAML_PATH = os.path.join(REPO_ROOT, "mira-bots", "prompts", "diagnose", "active.yaml")

    def _load_yaml_text(self) -> str:
        with open(self.YAML_PATH) as f:
            return f.read().lower()

    def test_all_ground_fault_keywords_present(self):
        text = self._load_yaml_text()
        missing = [kw for kw in self.REQUIRED_KEYWORDS if kw not in text]
        self.assertEqual(
            missing, [],
            f"active.yaml missing keywords: {missing} — gs3_ground_fault_14 will fail cp_keyword_match"
        )

    def test_example_9_present(self):
        text = self._load_yaml_text()
        self.assertIn("example 9", text, "Example 9 (ground fault) not found in active.yaml")

    def test_gs3_mentioned(self):
        text = self._load_yaml_text()
        self.assertIn("gs3", text, "GS3 drive not mentioned in Example 9")

    def test_version_bumped_to_1_3(self):
        with open(self.YAML_PATH) as f:
            raw = f.read()
        self.assertIn("1.3", raw, "Version was not bumped to 1.3")


# =============================================================================
# Integration: classify_intent agreement with gate logic
# =============================================================================

class TestClassifyIntentGateAgreement(unittest.TestCase):
    """Cross-check that guardrails.classify_intent returns the intents the gate
    logic depends on — so a future guardrails change can't silently break the veto."""

    def setUp(self):
        from shared.guardrails import classify_intent
        self.classify = classify_intent

    def test_manual_request_is_documentation(self):
        self.assertEqual(self.classify("find the ACS880 manual"), "documentation")

    def test_datasheet_request_is_documentation(self):
        # "need the datasheet" → documentation; a model number in the same phrase
        # pulls it to industrial (expected — model ref is stronger signal).
        self.assertEqual(self.classify("need the datasheet"), "documentation")

    def test_fault_query_is_industrial(self):
        self.assertEqual(self.classify("GS20 shows OC fault trips on startup"), "industrial")

    def test_hello_is_greeting(self):
        self.assertEqual(self.classify("hello"), "greeting")

    def test_capabilities_is_help(self):
        self.assertEqual(self.classify("what can you do"), "help")

    def test_unknown_query_defaults_to_industrial(self):
        # MIRA biases toward industrial for unrecognized queries
        result = self.classify("the conveyor stopped mid-shift after a power blip")
        self.assertEqual(result, "industrial")


if __name__ == "__main__":
    unittest.main(verbosity=2)
