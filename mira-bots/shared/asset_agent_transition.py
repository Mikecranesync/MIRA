"""Asset-agent lifecycle state machine + HMI deployment-gate decision.

Canonical home for the `asset_agent_status` lifecycle defined in
`docs/specs/asset-agent-validation-spec.md` and the doctrine in
`.claude/rules/train-before-deploy.md`.

Two responsibilities, both pure (no DB, no I/O — unit-testable):

1. `validate_transition()` — enforce the legal `draft → … → deployed` graph and
   the rule that promotion to `approved` requires a human actor.
2. `gate_decision()` — given an asset's current state, decide whether a
   direct-connection surface (Ignition/HMI) may answer for it. This is what
   `mira-pipeline/ignition_chat.py` consults behind `ENFORCE_ASSET_AGENT_GATE`.

Lives in `shared/` so the pipeline container (which mounts `shared/` from
mira-bots at build time — see `mira-pipeline/main.py`) can import it.
"""

from __future__ import annotations

import logging
from typing import NamedTuple, Optional

logger = logging.getLogger("mira-asset-agent")

# The seven lifecycle states (mirror migration 046 CHECK constraint).
STATES: frozenset[str] = frozenset(
    {"draft", "training", "validating", "approved", "deployed", "rejected", "deprecated"}
)

# Forward + recovery transitions. `rejected` and `deprecated` are reachable from
# any live state (an admin can pull an agent, or the underlying asset is retired)
# and are added to every entry below.
_FORWARD: dict[str, set[str]] = {
    "draft": {"training"},
    "training": {"validating", "draft"},          # back to draft if docs pulled
    "validating": {"approved", "training"},        # fail back to training
    "approved": {"deployed", "validating"},        # re-validate, or go live
    "deployed": {"approved"},                      # undeploy → back to approved
    "rejected": {"draft"},                         # restart from scratch
    "deprecated": set(),                           # terminal (except reactivate below)
}

# Universal escapes available from every non-terminal state.
_ESCAPES: set[str] = {"rejected", "deprecated"}

LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    state: frozenset(
        targets | (_ESCAPES if state not in {"deprecated"} else set())
    )
    for state, targets in _FORWARD.items()
}
# Allow reactivating a deprecated asset back to draft (re-onboarding).
LEGAL_TRANSITIONS["deprecated"] = frozenset({"draft"})


class IllegalTransition(ValueError):
    """Raised when a requested state change is not in the legal graph."""


def validate_transition(
    current: str,
    target: str,
    *,
    actor: Optional[str] = None,
) -> None:
    """Raise IllegalTransition if `current → target` is not allowed.

    `actor` is REQUIRED (non-empty) to enter `approved` — promotion is always a
    human action (TOO Invariant 4). A code path that reaches `approved` without
    an actor is a bug.
    """
    if current not in STATES:
        raise IllegalTransition(f"unknown current state {current!r}")
    if target not in STATES:
        raise IllegalTransition(f"unknown target state {target!r}")
    if target == current:
        return  # no-op self-transition is allowed (idempotent re-save)
    if target not in LEGAL_TRANSITIONS[current]:
        raise IllegalTransition(f"illegal transition {current!r} → {target!r}")
    if target == "approved" and not (actor and actor.strip()):
        raise IllegalTransition("promotion to 'approved' requires a human actor")


class GateDecision(NamedTuple):
    allow: bool          # may the surface answer for this asset?
    deploy_now: bool     # should the caller flip approved → deployed as a side effect?
    reason: str          # short machine/audit reason


# A clean, technician-facing refusal — NOT a chat-gate question. The connection
# is certified (.claude/rules/direct-connection-uns-certified.md); it is the
# *agent* that isn't ready, so we say so plainly rather than asking "are you
# looking at X?".
GATE_REFUSAL_MESSAGE = (
    "This asset hasn't been validated for MIRA yet. An admin needs to upload its "
    "documentation, validate MIRA's answers, and approve it in the Command Center "
    "before it can answer here."
)


def gate_decision(
    state: Optional[str],
    *,
    enforce: bool,
    auto_deploy: bool,
) -> GateDecision:
    """Decide whether an HMI/direct-connection turn may be answered.

    - `enforce=False` → always allow (gate disabled; default everywhere until the
      lifecycle is populated). This keeps the existing endpoint behavior.
    - `state == 'deployed'` → allow.
    - `state == 'approved'` → allow; `deploy_now` mirrors `auto_deploy` so the
      caller can flip it to `deployed` on first live turn.
    - anything else (draft/training/validating/rejected/deprecated/None) → refuse.
    """
    if not enforce:
        return GateDecision(True, False, "gate_disabled")
    if state == "deployed":
        return GateDecision(True, False, "deployed")
    if state == "approved":
        return GateDecision(True, auto_deploy, "approved")
    return GateDecision(False, False, f"not_ready:{state or 'none'}")
