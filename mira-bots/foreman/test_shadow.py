"""Slice B — Foreman shadow state.

The load-bearing tests here are the two that make "shadow mode" falsifiable.
Everything else is ordinary coverage of durable dedup and thread→mission
identity.

Run: ``cd mira-bots/foreman && python -m pytest test_shadow.py -q``
"""

from __future__ import annotations

import sqlite3

import pytest
from shadow import (  # type: ignore[import-not-found]
    FLAG,
    ShadowDecision,
    ShadowRecorder,
    ShadowStore,
    mission_id_for_thread,
    network_enabled,
    policy_snapshot,
)


@pytest.fixture()
def store(tmp_path):
    s = ShadowStore(tmp_path / "shadow.db")
    yield s
    s.close()


# --------------------------------------------------------------- the flag


class TestFlagDefaultsOff:
    """Slice A documents the flag as read by Foreman from Slice B on. Before
    this module nothing in the repository read it at all."""

    def test_absent_is_off(self) -> None:
        assert network_enabled({}) is False

    def test_explicit_zero_is_off(self) -> None:
        assert network_enabled({FLAG: "0"}) is False

    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on", " on "])
    def test_truthy_values_enable(self, raw: str) -> None:
        assert network_enabled({FLAG: raw}) is True

    @pytest.mark.parametrize("raw", ["", "maybe", "2", "off", "false", "null"])
    def test_malformed_never_enables(self, raw: str) -> None:
        # Fail closed: a typo in an env var must not switch the network on.
        assert network_enabled({FLAG: raw}) is False


# --------------------------------------------------- shadow is structural


class TestShadowCannotAct:
    """The safety property, checked rather than asserted.

    A decision that was recorded and one that was acted on look identical in a
    log, so "shadow mode" is unfalsifiable unless something pins it down.
    """

    def test_public_surface_is_frozen_and_contains_no_actuator(self) -> None:
        # PUBLIC_API is the declaration itself, not part of the surface it
        # constrains — exclude it rather than letting it self-satisfy.
        public = {n for n in dir(ShadowRecorder) if not n.startswith("_")} - {"PUBLIC_API"}
        assert public == set(ShadowRecorder.PUBLIC_API), (
            "ShadowRecorder's public surface changed; a new method here is how "
            "shadow mode stops being shadow"
        )

    @pytest.mark.parametrize(
        "verb",
        ["post", "send", "say", "reply", "merge", "deploy", "invoke", "run", "execute", "apply"],
    )
    def test_no_method_named_like_an_action(self, verb: str) -> None:
        assert not [n for n in dir(ShadowRecorder) if verb in n.lower()]

    def test_holds_no_client_that_could_act(self, store) -> None:
        rec = ShadowRecorder(store, enabled=True)
        for name, value in vars(rec).items():
            assert not hasattr(value, "post"), f"{name} exposes a post()"
            assert not hasattr(value, "chat_postMessage"), f"{name} looks like a Slack client"

    def test_observe_returns_the_record_instead_of_routing_it(self, store) -> None:
        rec = ShadowRecorder(store, enabled=True)
        out = rec.observe(channel="C1", thread_ts="1.1", decision="d", rationale="r")
        assert isinstance(out, ShadowDecision)
        # The caller gets a value back; nothing was dispatched anywhere.
        assert rec.decisions_for(out.mission_id) == [out]

    def test_disabled_records_nothing_at_all(self, store) -> None:
        rec = ShadowRecorder(store, enabled=False)
        assert rec.observe(channel="C1", thread_ts="1.1", decision="d", rationale="r") is None
        assert rec.decisions_for(mission_id_for_thread("1.1", "C1")) == []


# ------------------------------------------------------- durable dedup


class TestDedupSurvivesRestart:
    """The pre-Slice-B dedup was an in-memory set cleared at 500 entries, so a
    restart reprocessed every event and a busy channel silently reopened the
    window for older ones."""

    def test_first_sighting_is_new_and_second_is_not(self, store) -> None:
        assert store.mark_seen("ts-1", "C1") is True
        assert store.mark_seen("ts-1", "C1") is False

    def test_survives_a_restart(self, tmp_path) -> None:
        path = tmp_path / "shadow.db"
        first = ShadowStore(path)
        assert first.mark_seen("ts-1", "C1") is True
        first.close()

        second = ShadowStore(path)  # the process died; Slack redelivers
        assert second.mark_seen("ts-1", "C1") is False, "a restart must not reprocess the event"
        assert second.has_seen("ts-1") is True
        second.close()

    def test_does_not_forget_after_many_events(self, store) -> None:
        for i in range(600):  # past the old 500-entry self-clear
            store.mark_seen(f"ts-{i}", "C1")
        assert store.has_seen("ts-0") is True, "the oldest event must still be deduped"

    def test_distinct_events_are_independent(self, store) -> None:
        assert store.mark_seen("ts-1", "C1") is True
        assert store.mark_seen("ts-2", "C1") is True

    def test_uses_wal(self, tmp_path) -> None:
        path = tmp_path / "shadow.db"
        s = ShadowStore(path)
        mode = sqlite3.connect(str(path)).execute("PRAGMA journal_mode").fetchone()[0]
        s.close()
        assert mode.lower() == "wal"  # .claude/rules/python-standards.md


# ------------------------------------------- one mission per Slack thread


class TestThreadMissionIdentity:
    def test_is_deterministic(self) -> None:
        a = mission_id_for_thread("1.1", "C1")
        b = mission_id_for_thread("1.1", "C1")
        assert a == b

    def test_distinguishes_threads_and_channels(self) -> None:
        assert mission_id_for_thread("1.1", "C1") != mission_id_for_thread("1.2", "C1")
        # thread_ts is only unique WITHIN a channel, so the channel must be in the key
        assert mission_id_for_thread("1.1", "C1") != mission_id_for_thread("1.1", "C2")

    @pytest.mark.parametrize("ts,ch", [("", "C1"), ("1.1", ""), ("", "")])
    def test_refuses_to_invent_an_identity(self, ts: str, ch: str) -> None:
        with pytest.raises(ValueError):
            mission_id_for_thread(ts, ch)

    def test_same_thread_rejoins_the_same_mission_after_restart(self, tmp_path) -> None:
        path = tmp_path / "shadow.db"
        first = ShadowStore(path)
        original = first.mission_for("C1", "1.1")
        first.close()

        second = ShadowStore(path)
        assert second.mission_for("C1", "1.1") == original, (
            "a restart must not mint a second mission"
        )
        second.close()

    def test_stored_identity_wins_over_a_changed_derivation(self, store, monkeypatch) -> None:
        # A thread created under today's rule keeps its identity even if the
        # derivation changes later — otherwise one conversation splits in two.
        original = store.mission_for("C1", "1.1")
        monkeypatch.setattr("shadow.mission_id_for_thread", lambda *_a, **_k: "totally-different")
        assert store.mission_for("C1", "1.1") == original


# ------------------------------------------------------------- recording


class TestDecisionRecord:
    def test_records_and_reads_back_in_order(self, store) -> None:
        rec = ShadowRecorder(store, enabled=True)
        rec.observe(channel="C1", thread_ts="1.1", decision="first", rationale="r1")
        rec.observe(channel="C1", thread_ts="1.1", decision="second", rationale="r2")
        got = [d.decision for d in rec.decisions_for(mission_id_for_thread("1.1", "C1"))]
        assert got == ["first", "second"]

    def test_decisions_are_scoped_to_their_mission(self, store) -> None:
        rec = ShadowRecorder(store, enabled=True)
        rec.observe(channel="C1", thread_ts="1.1", decision="a", rationale="")
        rec.observe(channel="C1", thread_ts="2.2", decision="b", rationale="")
        assert len(rec.decisions_for(mission_id_for_thread("1.1", "C1"))) == 1

    def test_survives_restart(self, tmp_path) -> None:
        path = tmp_path / "shadow.db"
        first = ShadowStore(path)
        ShadowRecorder(first, enabled=True).observe(
            channel="C1", thread_ts="1.1", decision="kept", rationale=""
        )
        first.close()
        second = ShadowStore(path)
        assert [d.decision for d in second.decisions_for(mission_id_for_thread("1.1", "C1"))] == [
            "kept"
        ]
        second.close()

    def test_policy_snapshot_reads_without_driving(self) -> None:
        class FakeState:
            mission_id = "M1"
            phase = "implement"

        class FakePolicy:
            state = FakeState()

        snap = policy_snapshot(FakePolicy())
        assert '"mission_id": "M1"' in snap and '"phase": "implement"' in snap

    def test_policy_snapshot_tolerates_an_unknown_shape(self) -> None:
        class Bare:
            pass

        assert policy_snapshot(Bare()) == '{"policy": "Bare"}'
