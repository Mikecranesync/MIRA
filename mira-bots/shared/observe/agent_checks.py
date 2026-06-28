"""Agent contract check — does the answer honour its preformatted agent's contract?

A pure function over an ``AnswerTrace`` and the ``AgentManifest`` that was routed
for it. Like ``run_governance`` / ``run_incidents`` it returns ``Warning`` objects
and never mutates the reply.

Honesty boundary (why this is a *check*, not enforcement):

- **Tool allowlist** is enforced at *load time* by the registry (a write-capable
  manifest is rejected). MIRA has no per-call tool dispatch to police at runtime,
  so there is no "blocked tool was used" check to fake here.
- **Required outputs** are declared as structured fields, but the live engine
  produces free prose. We only flag a required output as *unmet* when its presence
  is genuinely detectable from the answer text (``citations``, ``confidence``,
  ``human_review_notice``). The rest are recorded as ``declared`` and left
  unverified rather than asserted present — we never claim to have checked
  something we can't see.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from shared.observe.checks import has_human_review_warning
from shared.observe.trace import (
    SEVERITY_INFO,
    SEVERITY_WARN,
    AnswerTrace,
    Warning,
    citations_present_in,
)

if TYPE_CHECKING:
    from shared.observe.agent_registry import AgentManifest

# Required-output keys we can actually verify against free-text + trace fields.
_VERIFIABLE_OUTPUTS = {"citations", "confidence", "human_review_notice"}


def run_agent_contract(trace: AnswerTrace, manifest: "AgentManifest") -> list[Warning]:
    """Check a finished answer against its routed agent's output contract.

    Returns warnings for the *verifiable* required outputs that are absent. Outputs
    that cannot be checked from free text are recorded in the warning detail as
    ``declared_unverified`` — surfaced, never asserted satisfied.
    """
    out: list[Warning] = []
    declared_unverified: list[str] = []

    for required in manifest.required_outputs:
        key = required.lower()
        if key not in _VERIFIABLE_OUTPUTS:
            declared_unverified.append(required)
            continue

        if key == "citations" and not citations_present_in(trace.answer):
            out.append(
                Warning(
                    code="agent_output_missing_citations",
                    message=f"{manifest.name} requires citations; answer carries none.",
                    severity=SEVERITY_WARN,
                    pillar="evaluation",
                    detail={"agent_id": manifest.id, "output": "citations"},
                )
            )
        elif key == "confidence" and not trace.confidence:
            out.append(
                Warning(
                    code="agent_output_missing_confidence",
                    message=f"{manifest.name} requires a confidence band; none recorded.",
                    severity=SEVERITY_INFO,
                    pillar="evaluation",
                    detail={"agent_id": manifest.id, "output": "confidence"},
                )
            )
        elif key == "human_review_notice" and not has_human_review_warning(trace.answer):
            # Only a real gap when the agent's risk warrants a human in the loop.
            if manifest.risk_level in ("medium", "safety_review"):
                out.append(
                    Warning(
                        code="agent_output_missing_human_review",
                        message=(
                            f"{manifest.name} (risk={manifest.risk_level}) requires a "
                            "human-review notice; answer carries none."
                        ),
                        severity=SEVERITY_WARN,
                        pillar="governance",
                        detail={"agent_id": manifest.id, "output": "human_review_notice"},
                    )
                )

    if declared_unverified:
        out.append(
            Warning(
                code="agent_output_declared_unverified",
                message=(
                    f"{manifest.name} declares output(s) {declared_unverified} that are not "
                    "verifiable from free text — recorded, not asserted satisfied."
                ),
                severity=SEVERITY_INFO,
                pillar="evaluation",
                detail={"agent_id": manifest.id, "outputs": declared_unverified},
            )
        )
    return out
