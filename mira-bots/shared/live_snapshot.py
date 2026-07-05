"""Read-only live-tag snapshot normalization (pure, I/O-free).

Turns a raw tag dict — from the Ignition HMI POST (`mira-bots/ask_api/app.py`),
a `mira-relay` `equipment_status` row, or the bench MQTT bridge
(`plc/live-plc-bridge/bridge.py`) — into a list of typed, UNS-keyed
``LiveTagSnapshot`` records. The engine can attach these to the conversation
*after* the UNS confirmation gate and log them for traceability (see
``docs/plans/flowfuse-node-red-next-steps.md`` Phase 4).

Hard boundary: this module NEVER writes, NEVER opens a socket, NEVER touches a
fieldbus. It only reshapes data already received. No clock either — the caller
passes ``ts`` so normalization stays deterministic and unit-testable.

The GS10/Micro820 decode tables mirror ``mira-bots/ask_api/app.py`` and the
machine card (``MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md``); keep them in sync.
Trust rule (from ``ask_api/machine_context.py``): ``vfd_comm_ok`` is the master
trust gate — when it is false, every VFD-derived value is marked ``stale``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# --- GS10 decode tables (mirror ask_api/app.py) ---
_STATUS_BITS = {0: "STOPPED", 1: "DECEL", 2: "STANDBY", 3: "RUNNING"}
_CMD_WORD = {1: "STOP", 18: "FWD+RUN", 20: "REV+RUN"}
_FAULT_CODES = {
    0: "no active fault",
    4: "GFF ground fault",
    12: "Lvd undervoltage",
    21: "oL overload",
    49: "EF external fault",
    54: "CE1 comm illegal cmd",
    55: "CE2 comm illegal addr",
    56: "CE3 comm illegal data",
    57: "CE4 comm fail",
    58: "CE10 modbus timeout",
}

# Quality bands.
GOOD = "good"
STALE = "stale"
UNKNOWN = "unknown"


@dataclass(frozen=True)
class LiveTagSnapshot:
    """One decoded, UNS-keyed live datapoint at a point in time.

    ``value`` is the decoded/scaled value where the tag is known, else the raw
    value. ``label`` is the human-readable rendering used in a status block.
    ``quality`` is one of ``good`` / ``stale`` / ``unknown``.
    """

    uns_path: str
    datapoint: str
    value: Any
    unit: str | None
    quality: str
    label: str
    source: str
    ts: str


def _num(raw: Any) -> float | int | None:
    """Return raw as a number, or None if it isn't a plain numeric (bools excluded)."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return raw
    return None


def _decode_one(key: str, raw: Any) -> tuple[Any, str | None, str] | None:
    """Decode a single known tag → (value, unit, label). None ⇒ unknown tag."""
    if key == "vfd_frequency":
        n = _num(raw)
        return None if n is None else (n / 100, "Hz", f"VFD output: {n / 100:.1f} Hz")
    if key == "vfd_freq_sp":
        n = _num(raw)
        return None if n is None else (n / 100, "Hz", f"Freq setpoint: {n / 100:.1f} Hz")
    if key == "vfd_current":
        n = _num(raw)
        return None if n is None else (n / 100, "A", f"Current: {n / 100:.1f} A")
    if key == "vfd_dc_bus":
        n = _num(raw)
        return None if n is None else (n / 10, "V", f"DC bus: {n / 10:.1f} V")
    if key == "vfd_cmd_word":
        name = _CMD_WORD.get(raw, f"cmd {raw}")
        return (name, None, f"Command: {name}")
    if key == "vfd_status_word":
        n = _num(raw)
        if n is None:
            return None
        state = _STATUS_BITS.get(int(n) & 0b11, "?")
        return (state, None, f"Drive state: {state} (status word {raw})")
    if key == "vfd_fault_code":
        if raw == 0:
            return ("no active fault", None, "no active fault")
        if raw in _FAULT_CODES:
            return (_FAULT_CODES[raw], None, f"FAULT: {_FAULT_CODES[raw]} (code {raw})")
        return (f"code {raw}", None, f"FAULT code {raw} (unmapped)")
    if key == "vfd_comm_ok":
        return ("OK" if raw else "LOST", None, f"VFD comms {'OK' if raw else 'LOST'}")
    if key == "pe_latched":
        return (
            "latched" if raw else "clear",
            None,
            "PHOTO-EYE JAM LATCHED (soft-stop active)" if raw else "photo-eye clear",
        )
    if key in ("DI_02", "e_stop"):
        return (
            "ARMED/OK" if raw else "TRIPPED",
            None,
            f"E-stop {'ARMED/OK' if raw else 'TRIPPED'}",
        )
    if key in ("DI_05", "pe_beam"):
        return ("BLOCKED" if raw else "clear", None, f"PE-01 beam {'BLOCKED' if raw else 'clear'}")
    if key in ("DO_02", "mlc"):
        return (
            "CLOSED/energized" if raw else "OPEN",
            None,
            f"Main line contactor {'CLOSED/energized' if raw else 'OPEN'}",
        )
    return None


def normalize(
    raw_tags: dict[str, Any] | None,
    uns_base: str,
    *,
    source: str,
    ts: str,
) -> list[LiveTagSnapshot]:
    """Normalize a raw tag dict into UNS-keyed snapshots.

    ``uns_base`` is the CONFIRMED asset UNS path (from the confirmation gate);
    each snapshot's ``uns_path`` is ``f"{uns_base}.{datapoint}"``. Tags with a
    ``None`` value are skipped. Unknown tags pass through with ``unknown``
    quality. When ``vfd_comm_ok`` is present and false, every other ``vfd_*``
    value is marked ``stale``.
    """
    if not raw_tags:
        return []

    comm_ok = raw_tags.get("vfd_comm_ok")
    vfd_stale = comm_ok is not None and not comm_ok

    out: list[LiveTagSnapshot] = []
    for key, raw in raw_tags.items():
        if raw is None:
            continue

        decoded = _decode_one(key, raw)
        quality = GOOD
        if key != "vfd_comm_ok" and key.startswith("vfd_") and vfd_stale:
            quality = STALE

        if decoded is None:
            value, unit, label = raw, None, f"{key}: {raw}"
            if quality == GOOD:
                quality = UNKNOWN
        else:
            value, unit, label = decoded

        out.append(
            LiveTagSnapshot(
                uns_path=f"{uns_base}.{key}" if uns_base else key,
                datapoint=key,
                value=value,
                unit=unit,
                quality=quality,
                label=label,
                source=source,
                ts=ts,
            )
        )
    return out


def render_status_block(snapshots: list[LiveTagSnapshot]) -> str:
    """Render snapshots as a human-readable ``[LIVE CONVEYOR STATUS]`` block.

    Mirrors ``ask_api/app.py::_build_status_block`` output, with ``[STALE]``
    markers so the LLM never silently trusts stale VFD values. Returns ``""``
    when there is nothing to report.
    """
    if not snapshots:
        return ""
    lines = [s.label + (" [STALE]" if s.quality == STALE else "") for s in snapshots]
    return "[LIVE CONVEYOR STATUS]\n" + "\n".join(lines)


def _dp(snapshots: list[LiveTagSnapshot]) -> dict[str, LiveTagSnapshot]:
    return {s.datapoint: s for s in snapshots}


def assess_snapshots(snapshots: list[LiveTagSnapshot]) -> str | None:
    """Deterministic one-line machine assessment from decoded snapshots.

    The Python mirror of the Hub's ``deriveContextIntelligence`` summary
    (``mira-hub/src/lib/machine-context-intelligence.ts``): it COMPOSES the
    already-decoded VFD facts (comm_ok / fault_code / dc_bus / freq / cmd /
    status) into an honest assessment — the "VFD-healthy-but-stopped" case above
    all. It never invents a value; a missing signal is simply not asserted.
    Returns ``None`` when there's nothing to assess. Pure / deterministic.
    """
    if not snapshots:
        return None
    by = _dp(snapshots)
    comm = by.get("vfd_comm_ok")
    fault = by.get("vfd_fault_code")
    dc = by.get("vfd_dc_bus")
    freq = by.get("vfd_frequency")
    cmd = by.get("vfd_cmd_word")
    status = by.get("vfd_status_word")
    any_stale = any(s.quality == STALE for s in snapshots)

    # 1. Comms lost — every VFD value is untrustworthy; say so first.
    if comm is not None and comm.value == "LOST":
        return (
            "VFD comms are LOST — the live VFD values can't be trusted. Check the drive's comm "
            "cable, Modbus address, and control power before diagnosing further."
        )
    # 2. An active fault dominates.
    if fault is not None and fault.value not in (None, "no active fault"):
        return (
            f"Active VFD fault: {fault.value}. Clear the cause and reset the drive; verify wiring "
            "and comms before restart."
        )

    # 3. No fault, comms OK (or comm not reported) — assess running vs stopped.
    facts: list[str] = []
    if comm is not None and comm.value == "OK":
        facts.append("comms OK")
    if fault is not None and fault.value == "no active fault":
        facts.append("no fault")
    if dc is not None and isinstance(dc.value, (int, float)):
        facts.append(f"DC bus {dc.value:.0f} V")
    if freq is not None and isinstance(freq.value, (int, float)):
        facts.append(f"output {freq.value:.1f} Hz")
    facts_str = ", ".join(facts)

    def _num(s: LiveTagSnapshot | None) -> float | None:
        return s.value if s is not None and isinstance(s.value, (int, float)) else None

    freq_n = _num(freq)
    running = (
        (status is not None and status.value == "RUNNING")
        or (freq_n is not None and freq_n > 0.1)
        or (cmd is not None and "RUN" in str(cmd.value))
    )
    stopped = (
        (status is not None and status.value == "STOPPED")
        or (cmd is not None and cmd.value == "STOP")
        or (freq_n is not None and freq_n <= 0.1)
    )
    healthy = (
        (comm is None or comm.value == "OK")
        and (fault is None or fault.value == "no active fault")
        and not any_stale
    )

    if running:
        return f"Machine running{f' ({facts_str})' if facts_str else ''}. No active VFD fault."
    if stopped:
        if healthy and facts_str:
            return (
                f"VFD looks healthy ({facts_str}) but the machine is stopped. Most likely a "
                "command/permissive/interlock, not the drive — check operator command, run "
                "permissive, E-stop/interlock, and PLC logic."
            )
        return (
            f"Machine stopped{f' ({facts_str})' if facts_str else ''}. Confirm comms, fault code, "
            "and DC bus before isolating the cause."
        )
    return (
        f"Live VFD readings{f' ({facts_str})' if facts_str else ''} — not enough to tell "
        "running from stopped; confirm the command word and drive status."
    )


def render_machine_evidence(snapshots: list[LiveTagSnapshot]) -> str:
    """Render snapshots as a ``## Live Machine Evidence`` section for the engine.

    The Python mirror of the Hub's ``renderMachineEvidenceSection``: the decoded
    live values (with ``[STALE]`` markers) PLUS a deterministic assessment and
    the live/context/inference/next-checks separation instruction. Returns ``""``
    when there is nothing to report. Read-only text; the caller decides when to
    attach it (the engine attaches only after the UNS gate).
    """
    if not snapshots:
        return ""
    # Embed the canonical ``[LIVE CONVEYOR STATUS]`` block verbatim — the engine
    # keys the kiosk quality-gate bypass and the direct live-tag fast-path on that
    # marker's presence (engine.py ``_LIVE_STATUS_HEADER``); dropping it would
    # silently disable both. We only WRAP it with the section header + assessment.
    parts = [
        "## Live Machine Evidence (observed now)",
        (
            "Machine-observed live tags. In your answer, clearly separate: (1) this LIVE "
            "evidence, (2) asset/manual context, (3) your inference, and (4) the recommended "
            "next checks."
        ),
        "",
        render_status_block(snapshots),
    ]
    assessment = assess_snapshots(snapshots)
    if assessment:
        parts += ["", f"Assessment: {assessment}"]
    return "\n".join(parts)


# ── Assessment from the Ignition wire form ({full_path: str_value}) ───────────
#
# ``ignition_chat.py`` receives ``{ "[default]Mira_Monitored/<asset>/<leaf>":
# {"value": str(qv.value), …} }`` (doPost.py) — full-path keys, string values,
# and ambiguous analog scaling (raw register vs engineering). Only the ENUM/BOOL
# canonical signals are scaling-immune, so ONLY those feed the assessment; the
# analog values (freq/current/dc_bus) are shown in the preamble but never
# re-scaled/re-interpreted here (a 10x/100x-wrong number is worse than none).
_ASSESSABLE_INT_LEAVES = {"vfd_fault_code", "vfd_warn_code", "vfd_cmd_word", "vfd_status_word"}
_ASSESSABLE_BOOL_LEAVES = {
    "vfd_comm_ok",
    "pe_latched",
    "DI_02",
    "e_stop",
    "DI_05",
    "pe_beam",
    "DO_02",
    "mlc",
}
_TRUE_STRINGS = {"true", "t", "1", "1.0", "on", "yes"}
_FALSE_STRINGS = {"false", "f", "0", "0.0", "off", "no"}


def _leaf(path: str) -> str:
    return str(path).rsplit("/", 1)[-1]


def _coerce_int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


def _coerce_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in _TRUE_STRINGS:
        return True
    if s in _FALSE_STRINGS:
        return False
    return None


def assess_from_paths(path_values: dict[str, Any] | None) -> str | None:
    """Deterministic assessment from a ``{tag_path: value}`` map (Ignition wire
    form). Keys may be full Ignition browse paths; entries may be bare scalars or
    ``{"value": …}`` dicts. ONLY the enum/bool canonical leaves feed the
    assessment — analog leaves are deliberately excluded (their wire scaling is
    ambiguous). Returns ``None`` when nothing assessable is present — never a
    fabricated assessment. Pure / deterministic.
    """
    if not path_values:
        return None
    raw: dict[str, Any] = {}
    for path, val in path_values.items():
        if isinstance(val, dict):
            val = val.get("value")
        leaf = _leaf(path)
        if leaf in _ASSESSABLE_INT_LEAVES:
            n = _coerce_int(val)
            if n is not None:
                raw[leaf] = n
        elif leaf in _ASSESSABLE_BOOL_LEAVES:
            b = _coerce_bool(val)
            if b is not None:
                raw[leaf] = b
    if not raw:
        return None
    return assess_snapshots(normalize(raw, "", source="ignition", ts=""))
