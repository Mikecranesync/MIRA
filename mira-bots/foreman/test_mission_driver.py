"""Hermetic tests for mission_driver.py — the continuous overnight driver.

No network, no Slack, no real time. Async loop tests drive the heartbeat via
``asyncio.run`` with an injected no-op sleep, so they are deterministic.

Proves the three required behaviours:
  1. The loop emits the next action each tick (per-stage + full heartbeat).
  2. It re-wakes an idle worker (implementer stopped with no head SHA).
  3. It REFUSES to advance past a hard-stop / forbidden action (invalid head,
     fix-round cap, and GO-terminal — merge/deploy stay human gates).

And that the mission_loop guardrails are reused verbatim, not weakened.

AC reference: docs/missions/AUTONOMOUS-FOREMAN-V1.md
Issue: https://github.com/Mikecranesync/MIRA/issues/3566
"""

from __future__ import annotations

import asyncio

from mission_driver import (
    DriverConfig,
    DriverIntent,
    IntentKind,
    MissionDriver,
    decide_next_intent,
)
from mission_loop import (
    FORBIDDEN_ACTIONS,
    ForemanPolicy,
    MissionState,
)

BASE_SHA = "d16faa5ed000a22319cf45688aff3293a0c1db6f"
HEAD_SHA = "a" * 40
NEW_SHA = "b" * 40
PR_URL = "https://github.com/Mikecranesync/MIRA/pull/9999"


# ---------------------------------------------------------------------------
# State builders — construct each lifecycle stage through ForemanPolicy so the
# guardrails compose exactly as they would in production.
# ---------------------------------------------------------------------------


def _fresh_state() -> MissionState:
    return MissionState(
        mission_id="AUTONOMOUS-FOREMAN-V1",
        base_sha=BASE_SHA,
        branch="feat/foreman-continuous-driver",
    )


def _impl_running() -> MissionState:
    s = _fresh_state()
    ForemanPolicy(s).dispatch_implementer(session_id="impl-1")
    return s


def _impl_stopped_no_head() -> MissionState:
    s = _fresh_state()
    p = ForemanPolicy(s)
    p.dispatch_implementer(session_id="impl-1")
    p.stop_implementer()  # no head SHA recorded -> unfinished work
    return s


def _head_ready() -> MissionState:
    s = _fresh_state()
    p = ForemanPolicy(s)
    p.dispatch_implementer(session_id="impl-1")
    p.stop_implementer(head_sha=HEAD_SHA)  # atomic head record (caller contract)
    return s


def _review_running() -> MissionState:
    s = _head_ready()
    ForemanPolicy(s).dispatch_reviewer(git_ref=HEAD_SHA, session_id="rev-1")
    return s


def _review_verdict(verdict: str) -> MissionState:
    s = _review_running()
    ForemanPolicy(s).record_reviewer_verdict(verdict)
    return s


def _verify_running() -> MissionState:
    s = _review_verdict("PASS")
    ForemanPolicy(s).dispatch_verifier(git_ref=HEAD_SHA, session_id="ver-1")
    return s


def _verify_verdict(verdict: str) -> MissionState:
    s = _verify_running()
    ForemanPolicy(s).record_verifier_verdict(verdict)
    return s


def _both_pass() -> MissionState:
    s = _verify_verdict("PASS")
    s.pr_url = PR_URL  # GO also needs a recorded PR URL (AC H)
    return s


def _invalid_head() -> MissionState:
    """Implementer stopped, but a non-exact ref got recorded as head — corrupt."""
    s = _fresh_state()
    p = ForemanPolicy(s)
    p.dispatch_implementer(session_id="impl-1")
    p.stop_implementer(head_sha="origin/main")
    return s


# ---------------------------------------------------------------------------
# Decision: emits the next action for each lifecycle stage
# ---------------------------------------------------------------------------


class TestDecideNextAction:
    def test_no_mission_waits_does_not_invent_work(self):
        intent = decide_next_intent(_fresh_state())
        assert intent.kind == IntentKind.WAIT
        assert not intent.stop

    def test_implementer_running_waits(self):
        assert decide_next_intent(_impl_running()).kind == IntentKind.WAIT

    def test_head_ready_dispatches_reviewer_on_exact_sha(self):
        intent = decide_next_intent(_head_ready())
        assert intent.kind == IntentKind.DISPATCH_REVIEWER
        assert intent.git_ref == HEAD_SHA

    def test_reviewer_running_waits(self):
        assert decide_next_intent(_review_running()).kind == IntentKind.WAIT

    def test_reviewer_dispatched_no_verdict_waits(self):
        # Reviewer recorded but verdict not yet in -> keep waiting, don't advance.
        s = _review_running()
        assert decide_next_intent(s).kind == IntentKind.WAIT

    def test_review_pass_dispatches_verifier_on_same_sha(self):
        intent = decide_next_intent(_review_verdict("PASS"))
        assert intent.kind == IntentKind.DISPATCH_VERIFIER
        assert intent.git_ref == HEAD_SHA

    def test_verifier_running_waits(self):
        assert decide_next_intent(_verify_running()).kind == IntentKind.WAIT

    def test_both_pass_reports_go(self):
        intent = decide_next_intent(_both_pass())
        assert intent.kind == IntentKind.REPORT
        assert intent.stop
        assert intent.go_no_go is not None
        assert intent.go_no_go.verdict == "GO"

    def test_stale_reviewer_on_old_sha_triggers_re_review_of_new_head(self):
        # Reviewer bound to an old SHA while head has moved -> re-review new head.
        s = _review_verdict("PASS")
        s.head_sha = NEW_SHA  # a new head recorded; reviewer still bound to HEAD_SHA
        intent = decide_next_intent(s)
        assert intent.kind == IntentKind.DISPATCH_REVIEWER
        assert intent.git_ref == NEW_SHA


# ---------------------------------------------------------------------------
# Re-wake an idle worker
# ---------------------------------------------------------------------------


class TestRewakeIdleWorker:
    def test_stopped_with_no_head_redispatches_implementer(self):
        intent = decide_next_intent(_impl_stopped_no_head())
        assert intent.kind == IntentKind.DISPATCH_IMPLEMENTER

    def test_stopped_with_head_advances_instead_of_rewaking(self):
        # Caller-contract counterpart: a head recorded atomically means "done" —
        # the driver advances to review, it must NOT re-wake the implementer.
        intent = decide_next_intent(_head_ready())
        assert intent.kind == IntentKind.DISPATCH_REVIEWER

    def test_review_fail_redispatches_for_fix_round(self):
        intent = decide_next_intent(_review_verdict("FAIL"))
        assert intent.kind == IntentKind.DISPATCH_IMPLEMENTER

    def test_verify_fail_redispatches_for_fix_round(self):
        intent = decide_next_intent(_verify_verdict("FAIL"))
        assert intent.kind == IntentKind.DISPATCH_IMPLEMENTER


# ---------------------------------------------------------------------------
# Refuses to advance past a hard-stop / forbidden action
# ---------------------------------------------------------------------------


class TestRefusesHardStop:
    def test_invalid_head_sha_hard_stops_without_dispatching_review(self):
        intent = decide_next_intent(_invalid_head())
        assert intent.kind == IntentKind.REPORT
        assert intent.stop
        assert intent.go_no_go is not None
        assert intent.go_no_go.verdict == "NO-GO"

    def test_fix_round_cap_hard_stops_instead_of_redispatching(self):
        intent = decide_next_intent(_review_verdict("FAIL"), fix_rounds=3, max_fix_rounds=3)
        assert intent.kind == IntentKind.REPORT
        assert intent.stop
        assert intent.go_no_go is not None
        assert intent.go_no_go.verdict == "NO-GO"

    def test_go_terminal_still_lists_human_merge_and_deploy_gates(self):
        # The real "refuses a forbidden action" proof: at GO the only remaining
        # progress is merge/deploy, which are human gates — the loop reports and
        # stops, it never auto-advances.
        intent = decide_next_intent(_both_pass())
        assert intent.kind == IntentKind.REPORT and intent.stop
        gates = intent.go_no_go.human_gates
        assert any("merge" in g.lower() for g in gates)
        assert any("deploy" in g.lower() for g in gates)

    def test_no_intent_kind_is_a_forbidden_action(self):
        kinds = {k.value for k in IntentKind}
        assert kinds.isdisjoint(FORBIDDEN_ACTIONS)


# ---------------------------------------------------------------------------
# Guardrails reused verbatim — not weakened by this module
# ---------------------------------------------------------------------------


class TestGuardrailsIntact:
    def test_can_merge_still_false(self):
        assert not ForemanPolicy(_both_pass()).can_merge().allowed

    def test_can_deploy_still_false(self):
        assert not ForemanPolicy(_both_pass()).can_deploy().allowed

    def test_forbidden_actions_unchanged(self):
        for action in ("merge", "deploy", "gh_pr_merge", "deploy_vps", "vps_compose_restart"):
            assert action in FORBIDDEN_ACTIONS

    def test_decide_does_not_mutate_state(self):
        # decide_next_intent must be side-effect-free: evaluating GO/NO-GO on a
        # copy means the caller's live state is untouched.
        s = _both_pass()
        before = s.to_json()
        decide_next_intent(s)
        assert s.to_json() == before


# ---------------------------------------------------------------------------
# Async heartbeat — the loop decides, the caller executes
# ---------------------------------------------------------------------------


def _sequence_reader(states):
    """Return a read_state callable that yields each state once, then repeats
    the last (so a loop that stops early never runs off the end)."""
    box = {"i": 0, "states": states}

    def read():
        i = min(box["i"], len(box["states"]) - 1)
        box["i"] += 1
        return box["states"][i]

    return read


def _recorder():
    emitted: list[DriverIntent] = []

    def emit(intent):
        emitted.append(intent)

    return emitted, emit


async def _noop_sleep(_seconds):
    return None


class TestHeartbeatLoop:
    def test_emits_the_next_action_each_tick_then_stops_at_report(self):
        states = [
            _impl_running(),
            _head_ready(),
            _review_running(),
            _review_verdict("PASS"),
            _both_pass(),
        ]
        emitted, emit = _recorder()
        sleeps: list[float] = []

        async def sleep(secs):
            sleeps.append(secs)

        driver = MissionDriver(
            _sequence_reader(states),
            emit,
            config=DriverConfig(interval_seconds=1.0, max_ticks=20),
            sleep=sleep,
        )
        last = asyncio.run(driver.run())

        kinds = [i.kind for i in emitted]
        assert kinds == [
            IntentKind.WAIT,
            IntentKind.DISPATCH_REVIEWER,
            IntentKind.WAIT,
            IntentKind.DISPATCH_VERIFIER,
            IntentKind.REPORT,
        ]
        assert last.kind == IntentKind.REPORT and last.stop
        assert last.go_no_go.verdict == "GO"
        # A sleep between each non-terminal tick, none after the terminal one.
        assert len(sleeps) == 4

    def test_rewakes_idle_worker_until_the_fix_round_cap(self):
        # A perpetually idle implementer (stopped, no head) is re-woken up to the
        # cap, then the loop hard-stops instead of looping forever.
        reader = lambda: _impl_stopped_no_head()  # noqa: E731
        emitted, emit = _recorder()
        driver = MissionDriver(
            reader,
            emit,
            config=DriverConfig(max_fix_rounds=2, max_ticks=20),
            sleep=_noop_sleep,
        )
        last = asyncio.run(driver.run())

        kinds = [i.kind for i in emitted]
        assert kinds == [
            IntentKind.DISPATCH_IMPLEMENTER,
            IntentKind.DISPATCH_IMPLEMENTER,
            IntentKind.REPORT,
        ]
        assert last.stop and last.go_no_go.verdict == "NO-GO"
        assert driver.fix_rounds == 2

    def test_stops_at_go_and_emits_nothing_after(self):
        emitted, emit = _recorder()
        driver = MissionDriver(
            lambda: _both_pass(),
            emit,
            config=DriverConfig(max_ticks=5),
            sleep=_noop_sleep,
        )
        last = asyncio.run(driver.run())
        assert len(emitted) == 1  # stopped immediately; no further ticks
        assert last.kind == IntentKind.REPORT and last.go_no_go.verdict == "GO"

    def test_refuses_to_advance_on_invalid_head(self):
        emitted, emit = _recorder()
        driver = MissionDriver(
            lambda: _invalid_head(),
            emit,
            config=DriverConfig(max_ticks=5),
            sleep=_noop_sleep,
        )
        last = asyncio.run(driver.run())
        assert last.kind == IntentKind.REPORT and last.stop
        assert not any(i.kind == IntentKind.DISPATCH_REVIEWER for i in emitted)

    def test_sync_callables_are_supported(self):
        # read_state/emit/sleep may be plain sync callables (both _maybe_await paths).
        emitted: list[DriverIntent] = []
        driver = MissionDriver(
            _both_pass,  # sync, returns a state
            emitted.append,  # sync
            config=DriverConfig(max_ticks=3),
            sleep=lambda _s: None,  # sync
        )
        last = asyncio.run(driver.run())
        assert last.kind == IntentKind.REPORT
        assert len(emitted) == 1
