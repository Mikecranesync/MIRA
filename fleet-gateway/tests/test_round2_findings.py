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

        # Use a real ArtifactStore to test persistence (not just shallow-copy aliasing)
        import tempfile
        from pathlib import Path
        from fleet_gateway.store import ArtifactStore

        with tempfile.TemporaryDirectory() as tmp_path:
            artifacts = ArtifactStore(Path(tmp_path))
            # Write initial task state
            artifacts.write_task(
                {
                    "task_id": "T",
                    "session_id": "s2",
                    "role": "charlie",
                    "status": "running",
                    "claimed": True,
                    "attempts": [{"session_id": "s1", "role": "bravo", "status": "running"}],
                }
            )

            v = object.__new__(FleetGatewayService)
            v.artifacts = artifacts
            v.router = NodeRouter(
                {
                    "bravo": NodeTarget("bravo", bravo, object()),
                    "charlie": NodeTarget("charlie", charlie, object()),
                }
            )
            v._session_nodes = {}

            v._stop_worker({"session_id": "s1"}, "test")

            # Re-read the artifact to verify persistence
            persisted = v.artifacts.read_task("T")
            assert persisted is not None
            # Verify:
            # - top-level s2 remains running and claimed
            # - attempts[0] (s1) is marked stopped
            assert persisted["session_id"] == "s2"
            assert persisted["status"] == "running"
            assert persisted["claimed"] is True
            assert persisted["attempts"][0]["status"] == "stopped"


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
            with pytest.raises(ContractViolation, match="is not adoptable"):
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


# ── Round-5 regressions (Codex review of ca31c01f9) ──────────────────────────


def _two_node_service_with_nodeless_attempt(tmp_path):
    """Task T: live s2 on charlie; superseded attempt s1 with NO recorded node.
    Both nodes also hold an unrelated session named s1."""
    from fleet_gateway.store import ArtifactStore

    bravo, charlie = FakeCAO(), FakeCAO()
    bravo.sessions["s1"] = {"session_id": "s1", "status": "running", "owner": "bravo-worker"}
    charlie.sessions["s1"] = {"session_id": "s1", "status": "running", "owner": "unrelated"}
    charlie.sessions["s2"] = {"session_id": "s2", "status": "running", "owner": "current"}
    store = ArtifactStore(tmp_path)
    store.write_task(
        {
            "task_id": "T",
            "session_id": "s2",
            "role": "charlie",
            "fleet_owned": True,
            "status": "running",
            "claimed": True,
            "attempts": [{"session_id": "s1", "fleet_owned": True, "status": "running"}],
        }
    )
    svc = object.__new__(FleetGatewayService)
    svc.artifacts = store
    svc.router = NodeRouter(
        {
            "bravo": NodeTarget("bravo", bravo, object()),
            "charlie": NodeTarget("charlie", charlie, object()),
        }
    )
    svc._session_nodes = {}
    return svc, bravo, charlie, store


class TestB1NodelessAttemptFailsClosed:
    """A superseded attempt with no recorded node must never be routed by guess."""

    def test_stop_worker_refuses_and_touches_nothing(self, tmp_path):
        svc, bravo, charlie, store = _two_node_service_with_nodeless_attempt(tmp_path)
        with pytest.raises(ContractViolation, match="no recorded node"):
            svc._stop_worker({"session_id": "s1"}, "test")
        assert bravo.sessions["s1"]["status"] == "running"
        assert charlie.sessions["s1"]["status"] == "running"
        assert not [c for c in bravo.calls if c[0] == "stop_worker"]
        assert not [c for c in charlie.calls if c[0] == "stop_worker"]
        persisted = store.read_task("T")
        assert persisted["session_id"] == "s2" and persisted["status"] == "running"
        assert persisted["attempts"][0]["status"] == "running"

    def test_message_worker_refuses_the_same_way(self, tmp_path):
        svc, bravo, charlie, _ = _two_node_service_with_nodeless_attempt(tmp_path)
        with pytest.raises(ContractViolation, match="no recorded node"):
            svc._message_worker({"session_id": "s1", "text": "hello"}, "test")
        assert not bravo.messages and not charlie.messages

    def test_single_node_router_still_routes(self, tmp_path):
        """With exactly one node there is nothing to guess; a node-less attempt
        must still be stoppable so the Gateway keeps its cleanup path."""
        from fleet_gateway.store import ArtifactStore

        cao = FakeCAO()
        cao.sessions["s1"] = {"session_id": "s1", "status": "running"}
        cao.sessions["s2"] = {"session_id": "s2", "status": "running"}
        store = ArtifactStore(tmp_path)
        store.write_task(
            {
                "task_id": "T",
                "session_id": "s2",
                "role": "bravo",
                "fleet_owned": True,
                "status": "running",
                "claimed": True,
                "attempts": [{"session_id": "s1", "fleet_owned": True, "status": "running"}],
            }
        )
        svc = object.__new__(FleetGatewayService)
        svc.artifacts = store
        svc.router = NodeRouter.single(cao, object())
        svc._session_nodes = {}
        svc._stop_worker({"session_id": "s1"}, "test")
        assert cao.sessions["s1"]["status"] == "stopped"
        assert cao.sessions["s2"]["status"] == "running"


class TestBridgeOnlyMetadataNotAdoptable:
    """Round-5 major 1: bridge-id-only metadata was listed adoptable=True but
    adoption refuses anything without a local session id."""

    def test_bridge_only_metadata_is_listed_but_not_adoptable(self, tmp_path):
        (tmp_path / "4242.json").write_text(
            json.dumps({"bridgeSessionId": "bridge-1"}), encoding="utf-8"
        )
        probe = FilesystemClaudeProbe(
            node="bravo", sessions_dir=tmp_path, pid_alive=lambda _pid: True
        )
        (session,) = probe.list_sessions("bravo")
        assert session.local_session_id is None
        assert session.bridge_session_id == "bridge-1"
        assert session.adoptable is False
