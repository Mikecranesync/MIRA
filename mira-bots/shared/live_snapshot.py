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

The GS10/Micro820 decode tables are sourced from the drive pack
(``mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json``, co-located
package data loaded once below via ``shared.drive_packs.load_pack``) rather
than hardcoded here — see ADR-0025.
They still mirror ``mira-bots/ask_api/app.py`` and the machine card
(``MIRA_PLC/specs/CONVEYOR_MACHINE_CARD.md``); keep those in sync (Task 7
mirrors the pack into the Hub's ``gs10-display.ts``).
Trust rule (from ``ask_api/machine_context.py``): ``vfd_comm_ok`` is the master
trust gate — when it is false, every VFD-derived value is marked ``stale``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shared.drive_fault_intel import build_gs10_template_reader
from shared.drive_packs import build_cards, load_pack
from shared.drive_packs.schema import EnvelopeBand, RegisterEntry

# --- GS10 decode tables, loaded once from the drive pack (ADR-0025) ---
# Import-time load is deliberate: the pack ships in-repo, so a load failure
# here is a real error we want surfaced loudly at import, not masked by a
# fallback to stale literals.
_GS10_PACK = load_pack("durapulse_gs10")
_STATUS_BITS: dict[int, str] = _GS10_PACK.live_decode.status_bits
_CMD_WORD: dict[int, str] = _GS10_PACK.live_decode.cmd_word
_FAULT_CODES: dict[int, str] = _GS10_PACK.live_decode.fault_codes
_REGISTERS: dict[str, RegisterEntry] = _GS10_PACK.live_decode.registers

# This module's decode functions (`_scaled`/`_decode_one`) index `_REGISTERS`
# by these keys directly. The generic pack loader (`drive_packs/loader.py`)
# stays drive-agnostic and does not know these keys are required — so this
# module validates its own dependency on the loaded pack, right after load,
# and fails loudly and actionably at import time rather than with a bare
# `KeyError` deep inside a decode call if a future `pack.json` edit renames
# or removes one of them.
_REQUIRED_REGISTER_KEYS = ("vfd_frequency", "vfd_freq_sp", "vfd_current", "vfd_dc_bus")
_missing_register_keys = [k for k in _REQUIRED_REGISTER_KEYS if k not in _REGISTERS]
if _missing_register_keys:
    raise ValueError(
        f"pack '{_GS10_PACK.pack_id}': live_decode.registers is missing required "
        f"key(s) {_missing_register_keys!r} — shared.live_snapshot decodes these "
        "directly and cannot start without them"
    )

# --- GS10 fault-card enrichment (Drive Commander follow-up #2) ---
# First runtime caller of `build_cards` -- until now it was only exercised in
# tests. The reader is the INTERIM offline adapter (`shared.drive_fault_intel`,
# no DB/network); cards are derived once at import and looked up by fault
# NAME (`card.meaning`) when rendering the Live Machine Evidence section.
_GS10_READER = build_gs10_template_reader()
_GS10_CARDS_BY_MEANING = {
    c.meaning: c for c in build_cards(_GS10_PACK, template_reader=_GS10_READER)
}

# --- Envelope-driven analog assessment (ADR-0025 §4; Task 3) ---
# `_GS10_PACK.envelope` is the SAME typed `Envelope` a future writer would read
# to populate `tag_entities.expected_envelope` (per ADR-0025's "expected range
# lives with the pack, not hand-maintained per tag" intent). This module does
# not perform that DB write — it is read-only/pure (module docstring) — it only
# reads the pack's bands to make an honest, additive analog observation below.
# Maps a decoded datapoint key -> (envelope attribute name, display label) for
# the three analog signals ADR-0025 calls out. Anything not listed here (or
# whose pack band lacks both `min` and `max`) gets NO analog judgment — see
# `_analog_band_observation`.
_ANALOG_ENVELOPE_DATAPOINTS: dict[str, tuple[str, str]] = {
    "vfd_dc_bus": ("dc_bus", "DC bus"),
    "vfd_current": ("current", "Current"),
    "vfd_frequency": ("frequency", "Frequency"),
}
_ANALOG_OUT_OF_BAND_GUIDANCE: dict[tuple[str, str], str] = {
    ("dc_bus", "below"): "check input power / a possible undervoltage condition",
    ("dc_bus", "above"): "check for overvoltage or a regenerative-energy condition on the bus",
    ("current", "below"): "confirm the drive is actually loaded",
    ("current", "above"): "check for a mechanical overload or a binding load",
    ("frequency", "below"): "confirm the commanded speed / setpoint",
    ("frequency", "above"): "check the speed reference and drive parameter limits",
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


def _scaled(key: str, raw: Any) -> tuple[float, str | None] | None:
    """Scale a raw analog register to its engineering value via the pack's
    ``live_decode.registers[key].scaling``. ``n / (1 / scaling)`` rather than
    ``n * scaling`` — for this pack's scalings (0.01, 0.1) the two are not
    always bit-identical in float64 (e.g. 9999/100 != 9999*0.01), and the
    division form matches the historical literals (``n / 100``, ``n / 10``)
    exactly. None ⇒ raw wasn't a plain number.
    """
    n = _num(raw)
    if n is None:
        return None
    entry = _REGISTERS[key]
    return (n / (1 / entry.scaling), entry.unit)


def _decode_one(key: str, raw: Any) -> tuple[Any, str | None, str] | None:
    """Decode a single known tag → (value, unit, label). None ⇒ unknown tag."""
    if key == "vfd_frequency":
        scaled = _scaled(key, raw)
        if scaled is None:
            return None
        value, unit = scaled
        return (value, unit, f"VFD output: {value:.1f} {unit}")
    if key == "vfd_freq_sp":
        scaled = _scaled(key, raw)
        if scaled is None:
            return None
        value, unit = scaled
        return (value, unit, f"Freq setpoint: {value:.1f} {unit}")
    if key == "vfd_current":
        scaled = _scaled(key, raw)
        if scaled is None:
            return None
        value, unit = scaled
        return (value, unit, f"Current: {value:.1f} {unit}")
    if key == "vfd_dc_bus":
        scaled = _scaled(key, raw)
        if scaled is None:
            return None
        value, unit = scaled
        return (value, unit, f"DC bus: {value:.1f} {unit}")
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


def _analog_band_observation(datapoint: str, snap: LiveTagSnapshot | None) -> str | None:
    """Out-of-band-only observation for one decoded analog datapoint.

    Honest by construction (ADR-0025 §4 — confidently wrong is worse than no
    answer): returns ``None`` — i.e. stays silent — unless ALL of the following
    hold, and states the value plainly (with the band) only then:

    - ``datapoint`` is one of the three analog signals the pack's ``envelope``
      covers (``vfd_dc_bus``/``vfd_current``/``vfd_frequency``);
    - the snapshot is present, numeric, and ``GOOD`` quality (a ``STALE``
      value — e.g. after a comm loss — is exactly the case we must NOT judge);
    - the pack defines a FULL band for it (``min`` AND ``max`` both set — a
      pack that ships only ``rated``/``nominal`` with no min/max, like this
      pack's ``current`` band today, has no band to compare against, so it
      stays silent rather than guess one);
    - the value actually falls outside ``[min, max]``.

    In-band values and datapoints with no usable band produce no text at all
    (never an "in normal range" filler) — see ``_with_analog_notes``, which
    only appends when this returns something.
    """
    config = _ANALOG_ENVELOPE_DATAPOINTS.get(datapoint)
    if config is None or snap is None or snap.quality != GOOD:
        return None
    value = snap.value
    if not isinstance(value, (int, float)):
        return None
    attr, label = config
    band: EnvelopeBand = getattr(_GS10_PACK.envelope, attr)
    if band.min is None or band.max is None:
        return None
    if band.min <= value <= band.max:
        return None
    direction = "below" if value < band.min else "above"
    unit = band.unit or snap.unit or ""
    unit_sfx = f" {unit}" if unit else ""
    guidance = _ANALOG_OUT_OF_BAND_GUIDANCE.get(
        (attr, direction), "check wiring, load, and drive parameters"
    )
    return (
        f"{label} {value:.1f}{unit_sfx} is {direction} the normal "
        f"{band.min:.0f}–{band.max:.0f}{unit_sfx} band — {guidance}."
    )


def _with_analog_notes(text: str, by: dict[str, LiveTagSnapshot]) -> str:
    """Append any out-of-band analog observations to ``text`` as a SECONDARY,
    additive sentence — the base assessment (comm/fault/command logic) always
    leads and is never altered. Only ``assess_snapshots`` calls this: its
    inputs are already-decoded (engineering-unit) snapshots, so an envelope
    comparison is meaningful. ``assess_from_paths`` (Ignition wire form) never
    reaches this — its analog leaves are filtered out before normalization
    (see the boundary comment above ``assess_from_paths``), so this function
    is simply never invoked for ambiguous-scaling wire values.
    """
    notes = [
        note
        for dp in _ANALOG_ENVELOPE_DATAPOINTS
        if (note := _analog_band_observation(dp, by.get(dp))) is not None
    ]
    return f"{text} {' '.join(notes)}" if notes else text


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

    # 1. Comms lost — every VFD value is untrustworthy; say so first. (Every
    # other vfd_* snapshot is STALE whenever we reach this branch — see
    # `normalize()` — so `_with_analog_notes` is a no-op here by construction;
    # wrapped anyway for a single, uniform "analog notes never override the
    # lead" code path rather than a special case.)
    if comm is not None and comm.value == "LOST":
        return _with_analog_notes(
            "VFD comms are LOST — the live VFD values can't be trusted. Check the drive's comm "
            "cable, Modbus address, and control power before diagnosing further.",
            by,
        )
    # 2. An active fault dominates.
    if fault is not None and fault.value not in (None, "no active fault"):
        return _with_analog_notes(
            f"Active VFD fault: {fault.value}. Clear the cause and reset the drive; verify wiring "
            "and comms before restart.",
            by,
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
        return _with_analog_notes(
            f"Machine running{f' ({facts_str})' if facts_str else ''}. No active VFD fault.", by
        )
    if stopped:
        if healthy and facts_str:
            return _with_analog_notes(
                f"VFD looks healthy ({facts_str}) but the machine is stopped. Most likely a "
                "command/permissive/interlock, not the drive — check operator command, run "
                "permissive, E-stop/interlock, and PLC logic.",
                by,
            )
        return _with_analog_notes(
            f"Machine stopped{f' ({facts_str})' if facts_str else ''}. Confirm comms, fault code, "
            "and DC bus before isolating the cause.",
            by,
        )
    return _with_analog_notes(
        f"Live VFD readings{f' ({facts_str})' if facts_str else ''} — not enough to tell "
        "running from stopped; confirm the command word and drive status.",
        by,
    )


def render_fault_diagnostic(fault_name: str) -> str:
    """Enriched diagnostic block for an active fault NAME (card likely-causes/
    first-checks/citation), or "" when there's no enrichment. Pure/offline --
    reads module-level cards built once via the offline FaultCodesTemplateReader.
    """
    card = _GS10_CARDS_BY_MEANING.get(fault_name)
    if card is None or (not card.likely_causes and not card.first_checks):
        return ""
    lines = [f"### Fault diagnostic: {card.fault_or_symptom}"]
    if card.likely_causes:
        lines.append("Likely causes: " + "; ".join(card.likely_causes))
    if card.first_checks:
        lines.append("First checks: " + " ".join(card.first_checks))
    cites = "; ".join(f"{c.doc}{f' — {c.page}' if c.page else ''}" for c in card.citations if c.doc)
    if cites:
        lines.append(f"Source: {cites}")
    return "\n".join(lines)


def _render_active_fault_diagnostic(snapshots: list[LiveTagSnapshot]) -> str:
    """Enriched per-fault diagnostic block for an active, GOOD-quality fault in
    ``snapshots`` (via the shared card path), or "" when there is none. Shared by
    the engine (``render_machine_evidence``) and the Ignition wire path
    (``assess_from_paths``) so the fault-diagnostic gate + render live in ONE place.

    Quality gate: only a GOOD-quality fault renders. A STALE fault (comms lost —
    ``vfd_comm_ok`` is this module's master trust gate) is skipped; the assessment
    already leads with the comms-LOST caveat and a confident card would contradict it.
    """
    fault = _dp(snapshots).get("vfd_fault_code")
    if fault is None or fault.quality != GOOD or fault.value in (None, "no active fault"):
        return ""
    return render_fault_diagnostic(str(fault.value))


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
    # Only render the authoritative per-fault card for a GOOD-quality fault — see
    # `_render_active_fault_diagnostic`'s docstring for the STALE-suppression rule.
    diagnostic = _render_active_fault_diagnostic(snapshots)
    if diagnostic:
        parts += ["", diagnostic]
    return "\n".join(parts)


# ── Assessment from the Ignition wire form ({full_path: str_value}) ───────────
#
# ``ignition_chat.py`` receives ``{ "[default]Mira_Monitored/<asset>/<leaf>":
# {"value": str(qv.value), …} }`` (doPost.py) — full-path keys, string values,
# and ambiguous analog scaling (raw register vs engineering). Only the ENUM/BOOL
# canonical signals are scaling-immune, so ONLY those feed the assessment; the
# analog values (freq/current/dc_bus) are shown in the preamble but never
# re-scaled/re-interpreted here (a 10x/100x-wrong number is worse than none).
#
# HARD BOUNDARY (Task 3 / ADR-0025 §4): the envelope-driven analog check
# (`_analog_band_observation` / `_with_analog_notes`) compares a DECODED,
# engineering-unit value against the pack's ``min``/``max`` band — that
# comparison is only meaningful when the scaling is known-good, which is true
# for ``assess_snapshots`` (fed by already-scaled `LiveTagSnapshot`s) and NOT
# true here. `assess_from_paths` filters analog leaves out of `raw` below
# (they're not in ``_ASSESSABLE_INT_LEAVES``/``_ASSESSABLE_BOOL_LEAVES``), so
# they never reach `normalize()`/`assess_snapshots()` from this path — the
# envelope check is therefore structurally never applied to a wire-form value.
# Do NOT add analog leaves to the assessable sets above to "get" an envelope
# judgment here; that would silently reintroduce the ambiguous-scaling risk
# this boundary exists to prevent.
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

    When an active, GOOD-quality (comms-OK) GS10 fault is present, the same
    per-fault diagnostic card the engine path renders (``render_fault_diagnostic``,
    via the shared ``_render_active_fault_diagnostic`` helper) is appended after
    the one-line assessment — this is the Ignition "Ask MIRA" enrichment (Drive
    Commander DriveSense follow-up). A STALE fault (comms lost) never gets a card.
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
    snapshots = normalize(raw, "", source="ignition", ts="")
    assessment = assess_snapshots(snapshots)
    diagnostic = _render_active_fault_diagnostic(snapshots)
    if diagnostic:
        return f"{assessment}\n\n{diagnostic}" if assessment else diagnostic
    return assessment
