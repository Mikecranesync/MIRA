"""
event_context.py -- render a MachineEvent into a factual prompt block (Layer-5 seam).
=================================================================
Pure, dual Python 2.7 / 3.12, no I/O. This is the seam between the difference
engine and the Supervisor: it turns a grouped MachineEvent (+ optional resolved
context) into a text block that is prepended to the Supervisor message EXACTLY
like mira-bots/ask_api/machine_context.py's MACHINE_CONTEXT constant.

It emits FACTS only -- signals, observations, resolved asset/component. It never
writes the explanation; that is the Supervisor's job (which then adds citations
via the existing rag_worker + citation_compliance chain). Keeping this pure means
the whole "SimLab -> event -> Supervisor input" arc is unit-testable offline.

Productionization note: mira-bots/ask_api/ will consume this (a `machine_event_id`
on AskRequest -> build this block -> Supervisor.process_full), mirroring the
vendored-rules pattern used by the Ignition WebDev endpoint.
"""


def _obs_detail(o):
    if hasattr(o, "detail"):
        return o.detail
    if isinstance(o, dict):
        return o.get("detail", "")
    return str(o)


def build_event_context(event, resolved=None):
    """event: a MachineEvent (from difference_detectors.group_observations).
    resolved: optional dict {asset, component, manuals: [...]} from the context
    resolver. Returns a factual, LLM-ready prompt block (str)."""
    resolved = resolved or {}
    lines = ["[MACHINE EVENT]"]

    if resolved.get("asset"):
        lines.append("Asset: %s" % resolved["asset"])

    start = getattr(event, "start_ts", None)
    if start is not None:
        lines.append("Window: %s to %s" % (start, getattr(event, "end_ts", start)))

    signals = list(getattr(event, "signals", []) or [])
    lines.append("Signals changed (%d): %s" % (len(signals), ", ".join(str(s) for s in signals)))

    if resolved.get("component"):
        lines.append("Likely component: %s" % resolved["component"])

    lines.append("Observations (what changed vs normal):")
    for o in getattr(event, "observations", []) or []:
        lines.append("  - %s" % _obs_detail(o))

    manuals = resolved.get("manuals")
    if manuals:
        lines.append("Reference docs: %s" % ", ".join(str(m) for m in manuals))

    return "\n".join(lines)
