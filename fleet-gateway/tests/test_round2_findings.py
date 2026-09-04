"""Round-2 regressions for superseded attempts and unaddressable adoption.

Findings B1, M1, M2, m1, m2 from adversarial review of PR #3578.
"""

from __future__ import annotations

from pathlib import Path
import json
import tempfile

import pytest

from fleet_gateway.cao import FakeCAO
from fleet_gateway.errors import ContractViolation
from fleet_gateway.legacy import FilesystemClaudeProbe, FakeLegacySessionProbe, LegacySession
from fleet_gateway.router import NodeRouter, NodeTarget
from fleet_gateway.service import FleetGatewayService


class TestB1SupersededAttemptNodeResolution:
    """B1: Stopping a superseded attempt must route to its OWN node, not the live session's node."""

    def test_stop_superseded_attempt_routes_to_attempt_node_not_live_node(self):
        """After restart clears _session_nodes, stop of superseded attempt s1 (bravo)
        must stop bravo's s1, never charlie's unrelated s1."""
        bravo = FakeCAO()
        charlie = FakeCAO()
        bravo.sessions["s1"] = {"session_id": "s1", "status": "running", "owner": "bravo-worker"}
        charlie.sessions["s1"] = {
            "session_id": "s1",
            "status": "running",
            "owner": "unrelated-charlie-worker",
        }
        charlie.sessions["s2"] = {
            "session_id": "s2",
            "status": "running",
            "owner": "current-worker",
        }

        class MockArtifacts:
            def __init__(self):
                self.data = {
                    "task_id": "T",
                    "session_id": "s2",
                    "role": "charlie",
                    "fleet_owned": True,
                    "status": "running",
                    "claimed": True,
                    "attempts": [
                        {
                            "session_id": "s1",
                            "role": "bravo",
                            "fleet_owned": True,
                            "status": "running",
                        }
                    ],
                }

            def is_fleet_owned(self, sid):
                return sid in {"s1", "s2"}

            def find_task_id_for_session(self, sid):
                return "T"

            def read_task(self, tid):
                return dict(self.data)

            def write_task(self, record):
                self.data = dict(record)

        v = object.__new__(FleetGatewayService)
        v.artifacts = MockArtifacts()
        v.router = NodeRouter(
            {
                "bravo": NodeTarget("bravo", bravo, object()),
                "charlie": NodeTarget("charlie", charlie, object()),
            }
        )
        v._session_nodes = {}

        # Stop the superseded attempt s1
        v._stop_worker({"session_id": "s1"}, "test")

        # Verify:
        # - bravo's s1 was stopped (owned by the attempt)
        # - charlie's s1 remains running (unrelated)
        # - charlie's s2 remains running (live session)
        # - artifact's top-level remains unchanged (s2, running, claimed)
        assert bravo.sessions["s1"]["status"] == "stopped", "bravo s1 should be stopped"
        assert charlie.sessions["s1"]["status"] == "running", "charlie s1 should remain running"
        assert charlie.sessions["s2"]["status"] == "running", "charlie s2 should remain running"
        assert v.artifacts.data["session_id"] == "s2", "artifact should still reference s2"
        assert v.artifacts.data["status"] == "running", "artifact status should remain running"
        assert v.artifacts.data["claimed"] is True, "artifact claimed should remain True"


class TestM1AttemptRecordUpdate:
    """M1: Stop of superseded attempt must update attempts[].status, not top-level status/claimed."""

    def test_stop_superseded_updates_attempt_entry_only(self):
        """When stopping a superseded attempt, update that attempt's entry in attempts[]
        and leave the top-level live record untouched."""
        bravo = FakeCAO()
        charlie = FakeCAO()
        bravo.sessions["s1"] = {"session_id": "s1", "status": "running"}
        charlie.sessions["s2"] = {"session_id": "s2", "status": "running"}

        class MockArtifacts:
            def __init__(self):
                self.data = {
                    "task_id": "T",
                    "session_id": "s2",
                    "role": "charlie",
                    "status": "running",
                    "claimed": True,
                    "attempts": [{"session_id": "s1", "role": "bravo", "status": "running"}],
                }

            def is_fleet_owned(self, sid):
                return sid in {"s1", "s2"}

            def find_task_id_for_session(self, sid):
                return "T"

            def read_task(self, tid):
                return dict(self.data)

            def write_task(self, record):
                self.data = dict(record)

        v = object.__new__(FleetGatewayService)
        v.artifacts = MockArtifacts()
        v.router = NodeRouter(
            {
                "bravo": NodeTarget("bravo", bravo, object()),
                "charlie": NodeTarget("charlie", charlie, object()),
            }
        )
        v._session_nodes = {}

        v._stop_worker({"session_id": "s1"}, "test")

        # Verify:
        # - top-level s2 remains running and claimed
        # - attempts[0] (s1) is marked stopped
        assert v.artifacts.data["session_id"] == "s2"
        assert v.artifacts.data["status"] == "running"
        assert v.artifacts.data["claimed"] is True
        assert v.artifacts.data["attempts"][0]["status"] == "stopped"


class TestM2UnaddressableAdoption:
    """M2: Adoption must fail closed when the matched session has no addressable session_id."""

    def test_adopt_rejects_session_with_no_session_id(self):
        """Adoption fails ContractViolation when metadata provides a name but no sessionId."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir)

            # Create 4242.json with name but NO sessionId
            (sessions_dir / "4242.json").write_text(json.dumps({"name": "operator-tmux"}))

            probe = FilesystemClaudeProbe(
                node="bravo", sessions_dir=sessions_dir, pid_alive=lambda p: True
            )

            cao = FakeCAO()
            v = object.__new__(FleetGatewayService)
            v.router = NodeRouter.single(cao, object())
            v.probe = probe
            v.artifacts = type(
                "A", (), {"is_fleet_owned": lambda s, sid: False, "write_task": lambda s, r: None}
            )()
            v._session_nodes = {}

            # Adoption should fail, not create a task with None
            with pytest.raises(ContractViolation, match="no addressable session"):
                v._adopt_legacy_session({"role": "bravo", "external_id": "operator-tmux"}, "test")

            # Verify no CAO session was registered
            assert len(cao.sessions) == 0


class TestM1AmbiguityMessageWithNone:
    """m1: Ambiguity message must handle None local_session_id gracefully."""

    def test_ambiguity_with_none_session_id_raises_contract_violation(self):
        """Multiple name-only matches with None session_ids must raise ContractViolation,
        not TypeError."""

        def make_session(pid):
            return LegacySession(
                node="bravo",
                provider="claude",
                local_session_id=None,
                cwd=None,
                pid=pid,
                tmux_name="same-name",
                bridge_session_id=None,
                classification="legacy",
                adoptable=True,
            )

        v = object.__new__(FleetGatewayService)
        v.router = NodeRouter.single(FakeCAO(), object())
        v.probe = FakeLegacySessionProbe({"bravo": [make_session(1), make_session(2)]})

        # Should raise ContractViolation with an ambiguity message,
        # not a TypeError from joining None
        with pytest.raises(ContractViolation, match="ambiguous|multiple"):
            v._resolve_legacy_match("bravo", "same-name")


class TestM2AdoptableFlag:
    """m2: Empty metadata must not be marked adoptable."""

    def test_empty_metadata_not_adoptable(self):
        """A session entry with no identity tokens should have adoptable=False."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir)

            # Create 4242.json with empty object
            (sessions_dir / "4242.json").write_text(json.dumps({}))

            probe = FilesystemClaudeProbe(
                node="bravo", sessions_dir=sessions_dir, pid_alive=lambda p: True
            )

            sessions = probe.list_sessions("bravo")
            assert len(sessions) == 1
            session = sessions[0]

            # Verify identity_tokens is empty
            assert len(session.identity_tokens()) == 0

            # Verify adoptable is False
            assert session.adoptable is False
