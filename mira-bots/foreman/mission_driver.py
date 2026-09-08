"""Foreman continuous overnight driver — pure decision + async heartbeat.

Today the Foreman is REACTIVE: `mission_loop.py` policy only runs when a human
sends a Slack message. This module makes it PROACTIVE — a persistent heartbeat
that runs the same policy on a configurable interval so an already-dispatched
mission keeps progressing between Mike's messages.

Design (identical discipline to `mission_loop.py`):
  - **The loop decides; the caller executes.** Each tick the driver reads the
    current MissionState, asks the policy for the single next action, and hands
    a `DriverIntent` to the caller. The driver performs NO I/O, opens no Slack
    socket, makes no Gateway/HTTP/Doppler call, and edits no product files.
  - **Every guardrail is reused verbatim from `mission_loop.ForemanPolicy`** —
    exact-SHA review (`can_dispatch_reviewer`), one implementer at a time
    (`can_dispatch_implementer`), verifier-after-review (`can_dispatch_verifier`),
    and the terminal GO/NO-GO shape (`evaluate_go_no_go`). This module only
    *sequences* those guards; it re-implements none of them, weakens none of
    them, and can emit no `merge`/`deploy` intent (no such intent kind exists).
  - **Progress-only.** The driver advances and re-wakes an *already-initiated*
    mission. It never originates the first implementer dispatch — with no
    implementer it simply WAITs, honouring #3566 "do not invent work to keep
    workers busy." (If Mike wants the driver to also kick off the first
    dispatch, that is a one-line policy change, surfaced in the PR.)

Caller contract (what `emit` must uphold so the decisions stay correct):
  - `read_state()` returns the *current* durable MissionState on every call.
  - When an implementer finishes, the caller records its head SHA **atomically**
    via `ForemanPolicy.stop_implementer(head_sha=…)` before the next tick. The
    driver treats "implementer stopped with no head SHA" as unfinished work and
    re-wakes it; a caller that marks stopped first and sets head a tick later
    would cause a spurious re-wake.
  - `emit(intent)` executes the intent by routing DISPATCH_* through the matching
    `ForemanPolicy.dispatch_*`, so the guardrails (exact SHA, charlie/codex, one
    implementer) are enforced again at execution time, not just at decision time.

The `fix_rounds` re-dispatch cap is a deliberate safety stop (autonomous-run
doctrine: never loop forever on a failing gate). It is in-memory and resets on
process restart unless a restarting caller seeds it via `initial_fix_rounds`.

AC reference: docs/missions/AUTONOMOUS-FOREMAN-V1.md
Issue: https://github.com/Mikecranesync/MIRA/issues/3566
"""

from __future__ import annotations

import asyncio
import copy
import inspect
from collections.abc import Awaitable
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional, Union

from mission_loop import (
    SHA_RE,
    ForemanPolicy,
    GoNoGo,
    MissionState,
    WorkerState,
)

DEFAULT_INTERVAL_SECONDS: float = 300.0
DEFAULT_MAX_FIX_ROUNDS: int = 3


# ---------------------------------------------------------------------------
# Intent model — the only vocabulary the driver can emit
# ---------------------------------------------------------------------------


class IntentKind(str, Enum):
    """What the caller should do this tick.

    There is deliberately NO merge/deploy intent: those are human-only gates
    (mission_loop `can_merge`/`can_deploy` stay False), so the driver cannot
    even express them.
    """

    WAIT = "wait"  # a worker is running (or no mission) — heartbeat, nothing to do
    DISPATCH_IMPLEMENTER = "dispatch_implementer"  # also the "re-wake idle worker" action
    DISPATCH_REVIEWER = "dispatch_reviewer"
    DISPATCH_VERIFIER = "dispatch_verifier"
    REPORT = "report"  # terminal — carries a GoNoGo; always stop=True


@dataclass
class DriverIntent:
    """The single next action for a tick. `stop=True` ends the heartbeat."""

    kind: IntentKind
    reason: str
    git_ref: str = ""  # exact SHA for reviewer/verifier dispatch
    go_no_go: Optional[GoNoGo] = None  # populated on REPORT
    stop: bool = False  # loop exits after emitting this intent


# ---------------------------------------------------------------------------
# Pure decision — deterministic, no I/O, does not mutate the passed-in state
# ---------------------------------------------------------------------------


def _report(state: MissionState, reason: str) -> DriverIntent:
    """Terminal REPORT carrying the policy's GO/NO-GO, evaluated on a COPY.

    Evaluating on a deepcopy keeps `decide_next_intent` side-effect-free —
    `evaluate_go_no_go` writes `go_no_go`/`remaining_human_gates`, and the
    caller's live state must not change merely because the driver looked at it.
    """
    gng = ForemanPolicy(copy.deepcopy(state)).evaluate_go_no_go()
    return DriverIntent(IntentKind.REPORT, reason, go_no_go=gng, stop=True)


def _redispatch_or_stop(
    policy: ForemanPolicy,
    state: MissionState,
    fix_rounds: int,
    max_fix_rounds: int,
    reason: str,
) -> DriverIntent:
    """Re-wake the implementer, unless the fix-round cap or AC B forbids it."""
    if fix_rounds >= max_fix_rounds:
        return _report(
            state,
            f"Reached max fix rounds ({max_fix_rounds}) — stopping for human review "
            "instead of re-dispatching again.",
        )
    check = policy.can_dispatch_implementer()
    if not check.allowed:
        # An implementer is still running — never force a second one (AC B).
        return DriverIntent(IntentKind.WAIT, f"Cannot re-dispatch implementer: {check.reason}")
    return DriverIntent(IntentKind.DISPATCH_IMPLEMENTER, reason)


def decide_next_intent(
    state: MissionState,
    *,
    fix_rounds: int = 0,
    max_fix_rounds: int = DEFAULT_MAX_FIX_ROUNDS,
) -> DriverIntent:
    """Decide the single next intent for the current mission state.

    Deterministic and side-effect-free: it never mutates ``state`` and performs
    no I/O. Every worker-lifecycle guard is delegated to ForemanPolicy verbatim;
    this function only orders them into a lifecycle.
    """
    policy = ForemanPolicy(state)
    impl = state.implementer
    rev = state.reviewer
    ver = state.verifier
    head = state.head_sha or ""

    # Progress-only: with no implementer the driver waits (does not invent work).
    if impl is None:
        return DriverIntent(
            IntentKind.WAIT,
            "No mission dispatched yet — driver does not originate work "
            "(awaiting explicit dispatch).",
        )

    # Implementer still working: heartbeat only.
    if impl.state == WorkerState.RUNNING:
        return DriverIntent(IntentKind.WAIT, f"Implementer running (session={impl.session_id!r}).")

    # Implementer stopped with an EMPTY head SHA: unfinished work → re-wake.
    if not head:
        return _redispatch_or_stop(
            policy,
            state,
            fix_rounds,
            max_fix_rounds,
            "Implementer stopped without a head SHA — re-dispatch to complete implementation.",
        )

    # Implementer stopped with a NON-EMPTY but invalid head: refuse to advance.
    # Dispatching a review on a non-exact ref would violate AC C — hard stop.
    if not SHA_RE.match(head):
        return _report(
            state,
            f"Recorded head_sha {head!r} is not a 40-char exact SHA — refusing to "
            "dispatch review on a non-exact ref (AC C). Human must correct the state.",
        )

    # --- head is a valid exact SHA from here ---

    # Review stage: need a reviewer bound to the CURRENT head SHA.
    if rev is None or rev.git_ref != head:
        check = policy.can_dispatch_reviewer(head)
        if not check.allowed:  # defensive: head already validated above
            return _report(state, f"Cannot dispatch reviewer: {check.reason}")
        return DriverIntent(
            IntentKind.DISPATCH_REVIEWER,
            f"Head {head} ready — dispatch exact-SHA review on Charlie/Codex.",
            git_ref=head,
        )
    if rev.state == WorkerState.RUNNING:
        return DriverIntent(IntentKind.WAIT, "Reviewer running — awaiting verdict.")
    if state.reviewer_verdict == "FAIL":
        return _redispatch_or_stop(
            policy,
            state,
            fix_rounds,
            max_fix_rounds,
            "Review FAILED — re-dispatch implementer for a fix round.",
        )
    if state.reviewer_verdict != "PASS":
        return DriverIntent(IntentKind.WAIT, "Reviewer dispatched — awaiting verdict.")

    # Review PASSED. Verifier stage on the SAME head SHA.
    if ver is None or ver.git_ref != head:
        check = policy.can_dispatch_verifier(head)
        if not check.allowed:
            return _report(state, f"Cannot dispatch verifier: {check.reason}")
        return DriverIntent(
            IntentKind.DISPATCH_VERIFIER,
            f"Review passed — dispatch independent verifier on {head}.",
            git_ref=head,
        )
    if ver.state == WorkerState.RUNNING:
        return DriverIntent(IntentKind.WAIT, "Verifier running — awaiting verdict.")
    if state.verifier_verdict == "FAIL":
        return _redispatch_or_stop(
            policy,
            state,
            fix_rounds,
            max_fix_rounds,
            "Verification FAILED — re-dispatch implementer for a fix round.",
        )
    if state.verifier_verdict != "PASS":
        return DriverIntent(IntentKind.WAIT, "Verifier dispatched — awaiting verdict.")

    # Both PASS: terminal recommendation via the policy verbatim (on a copy).
    return _report(state, "Reviewer and verifier both PASS — terminal recommendation.")


# ---------------------------------------------------------------------------
# Async heartbeat — the loop; the caller executes what it emits
# ---------------------------------------------------------------------------

StateReader = Callable[[], Union[MissionState, Awaitable[MissionState]]]
IntentEmitter = Callable[[DriverIntent], Union[None, Awaitable[None]]]
Sleeper = Callable[[float], Awaitable[None]]


async def _maybe_await(value):
    """Allow `read_state`/`emit`/`sleep` to be either sync or async callables."""
    if inspect.isawaitable(value):
        return await value
    return value


@dataclass
class DriverConfig:
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS
    max_fix_rounds: int = DEFAULT_MAX_FIX_ROUNDS
    # None = run until a terminal (stop) intent. Tests set a bound; a caller may
    # set one to run a fixed number of heartbeats per invocation.
    max_ticks: Optional[int] = None


class MissionDriver:
    """Persistent heartbeat that runs ForemanPolicy on an interval.

    Slack/HTTP-free. Each tick: read state → decide → emit. The caller executes
    the emitted intent and updates the durable MissionState before the next tick.
    See the module docstring for the full caller contract.
    """

    def __init__(
        self,
        read_state: StateReader,
        emit: IntentEmitter,
        *,
        config: Optional[DriverConfig] = None,
        sleep: Sleeper = asyncio.sleep,
        initial_fix_rounds: int = 0,
    ) -> None:
        self._read_state = read_state
        self._emit = emit
        self._config = config or DriverConfig()
        self._sleep = sleep
        self._fix_rounds = initial_fix_rounds

    @property
    def fix_rounds(self) -> int:
        return self._fix_rounds

    async def tick(self) -> DriverIntent:
        """Run exactly one heartbeat: read → decide → emit. Returns the intent."""
        state = await _maybe_await(self._read_state())
        intent = decide_next_intent(
            state,
            fix_rounds=self._fix_rounds,
            max_fix_rounds=self._config.max_fix_rounds,
        )
        await _maybe_await(self._emit(intent))
        if intent.kind == IntentKind.DISPATCH_IMPLEMENTER:
            self._fix_rounds += 1
        return intent

    async def run(self) -> DriverIntent:
        """Heartbeat until a terminal (stop) intent, or `max_ticks` if set.

        Returns the last intent emitted (the terminal REPORT on a clean finish).
        """
        ticks = 0
        while True:
            intent = await self.tick()
            if intent.stop:
                return intent
            ticks += 1
            if self._config.max_ticks is not None and ticks >= self._config.max_ticks:
                return intent
            await _maybe_await(self._sleep(self._config.interval_seconds))
