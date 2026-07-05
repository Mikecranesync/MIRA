"""GS10 fault intelligence — INTERIM offline source for card enrichment.

This module is the INTERIM offline source of GS10 fault intelligence: a
curated, ``manual_cited`` mirror of the ``GS_SUPPLEMENT``/``GS10_NUMERIC``
prose in ``mira-core/scripts/seed_fault_codes.py`` (DURApulse GS10 User
Manual, P06.17 fault records — same source cited there). It stands in until a
DB-backed ``TemplateReader`` reads the real ``fault_codes`` table
(``docs/migrations/002_fault_codes.sql``); it exists so
``shared.drive_packs.cards.build_cards`` enrichment is product-visible in the
engine's Live Machine Evidence section (``shared/live_snapshot.py``) without
a DB dependency.

Pure/offline (``.claude/rules/fieldbus-readonly.md``): no DB/network/fieldbus
import, data is a plain in-repo constant.
"""

from __future__ import annotations

from shared.drive_packs.template_reader import FaultCodeIntel, FaultCodesTemplateReader

_GS10_PACK_ID = "durapulse_gs10"
_GS10_DOC = "DURApulse GS10 User Manual"
_GS10_PAGE = "P06.17 (fault records)"

# One entry per non-zero fault code in
# shared/drive_packs/packs/durapulse_gs10/pack.json's live_decode.fault_codes
# (verbatim GS10 manual content — do not paraphrase or add codes; see
# test_gs10_fault_intel_matches_pack_fault_codes_exactly, the drift guard).
GS10_FAULT_INTEL: dict[int, FaultCodeIntel] = {
    4: FaultCodeIntel(
        cause="Ground fault detected at the drive output.",
        action=(
            "1. Megger the motor. 2. Check output cable insulation. "
            "3. Check for moisture at the motor/junction box."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="GFF — ground fault",
    ),
    12: FaultCodeIntel(
        cause="DC bus voltage dropped below the trip level (low-voltage during deceleration).",
        action=(
            "1. Check input power and for voltage sags. 2. Verify supply capacity. "
            "3. Extend decel time or add a braking resistor if it trips on decel."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="Lvd — low-voltage during deceleration",
    ),
    21: FaultCodeIntel(
        cause=(
            "Drive overload protection activated (output current above the "
            "drive's overload curve)."
        ),
        action=(
            "1. Reduce the load. 2. Extend accel time. 3. Check for mechanical binding. "
            "4. Confirm the drive is sized for the motor."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="oL — overload",
    ),
    49: FaultCodeIntel(
        cause="External fault signal received on a drive input terminal.",
        action=(
            "1. Check the external fault source/device. 2. Check the wiring to the EF input "
            "terminal. 3. Clear the upstream condition, then reset."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="EF — external fault",
    ),
    54: FaultCodeIntel(
        cause="Modbus master sent a function code the GS10 does not support (illegal command).",
        action=(
            "1. Check the master's Modbus function codes (GS10 supports 03/06/10). "
            "2. Verify the master's register map."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="CE1 — illegal command",
    ),
    55: FaultCodeIntel(
        cause="Modbus master addressed a register the GS10 does not have (illegal data address).",
        action=(
            "1. Verify parameter/register addresses in the master. "
            "2. Check the address offset (GS10 Addr = wire + 1)."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="CE2 — illegal data address",
    ),
    56: FaultCodeIntel(
        cause=(
            "Modbus master wrote a value outside the parameter's allowed range "
            "(illegal data value)."
        ),
        action=(
            "1. Check the value and range being written. 2. Verify parameter units and scaling."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="CE3 — illegal data value",
    ),
    57: FaultCodeIntel(
        cause="Modbus master attempted to write a read-only register (CE4).",
        action=(
            "1. Remove the write to that address. "
            "2. Confirm which registers are writable in the master map."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="CE4 — data written to read-only address",
    ),
    58: FaultCodeIntel(
        cause="No valid Modbus message received within the comm time-out (P09.03).",
        action=(
            "1. Check the RS-485 cable, termination, and grounding. "
            "2. Verify baud/parity/slave address match the master. "
            "3. Confirm the master is polling; review the comm-timeout parameter."
        ),
        doc=_GS10_DOC,
        page=_GS10_PAGE,
        excerpt="CE10 — Modbus transmission time-out",
    ),
}


def build_gs10_template_reader() -> FaultCodesTemplateReader:
    """Return a ``FaultCodesTemplateReader`` over the offline GS10 intel."""
    return FaultCodesTemplateReader({_GS10_PACK_ID: GS10_FAULT_INTEL})
