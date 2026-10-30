"""Deterministic gap / clearance check for a technician measurement sheet.

First step of the Smart Sheets pilot (spec: docs/specs/technician-smart-sheets-pilot.md
on PR #4862; founder directive #4982 experiment D). Rules it enforces:

- limits, units and boundary rules come from an approved source and travel with
  the result; a missing or conflicting limit gives ``unassessed``, never a pass;
- unit conversions are explicit (only when asked for, only for known pairs);
- a value transcribed from a photo is ``unassessed`` until a person confirms it;
- a missing reading is ``incomplete``; nothing silently passes;
- an in-range reading never authorizes return to service (the notice is part of
  every result).

Usage:
    python tools/smart-sheets/gap_check.py sheet.csv --out DIR   # writes results.json + results.csv

CSV columns: point_id, before_value, before_unit, before_source, before_confirmed,
after_value, after_unit, after_source, after_confirmed, limit_min, limit_max,
limit_unit, boundary, limit_source. Empty cells mean "not recorded".
"""

from __future__ import annotations

import csv
import json
import sys
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

NOTICE = (
    "An in-range reading never authorizes return to service; the site's release process decides."
)
# 1 in = 25.4 mm is an EXACT definition. Decimal("25.4") multiplied by any
# finite-decimal input stays exact (no binary-float rounding noise like the
# 1.7526000000000002 float artifact at the 0.069in/1.7526mm boundary — F8).
MM_PER_IN = Decimal("25.4")
UNIT_FACTORS = {("in", "mm"): MM_PER_IN, ("mm", "in"): Decimal(1) / MM_PER_IN}
BOUNDARIES = ("inclusive", "exclusive")
PHOTO_SOURCES = ("photo", "photo_unconfirmed", "photo_confirmed")


@dataclass
class Reading:
    value: float | None
    unit: str | None
    source: str = "manual"  # manual | photo
    # F10: a photo transcription must be explicitly confirmed by a person
    # before it can be assessed; default to unconfirmed, never trust-by-default.
    # Manual readings are unaffected — check_reading only consults `confirmed`
    # when `source` is one of PHOTO_SOURCES.
    confirmed: bool = False


@dataclass
class Limit:
    min_value: float | None
    max_value: float | None
    unit: str | None
    boundary: str | None
    source: str | None


@dataclass
class Result:
    status: str  # pass | fail | unassessed | incomplete
    reasons: list[str]
    compared_value: float | None = None
    compared_unit: str | None = None
    limit_source: str | None = None
    notice: str = NOTICE


def _num(v) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except InvalidOperation:
        raise ValueError(f"not a valid decimal number: {v!r}") from None


def _as_decimal(v) -> Decimal | None:
    """Normalize a value (float, int, str, Decimal, None) to Decimal.

    `Decimal(str(v))` rather than `Decimal(v)` so a Python float literal like
    ``0.069`` (passed directly to ``Reading``/``Limit`` by callers that don't
    go through ``_num``/CSV parsing) is read from its clean shortest-round-trip
    string ("0.069"), not its raw binary representation.
    """
    if v is None:
        return None
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def check_reading(reading: Reading, limit: Limit, convert: bool = False) -> Result:
    # F8: every comparison below happens in Decimal, parsed from the clean
    # (shortest round-trip) string form of whatever was passed in, so a
    # binary-float artifact can never flip a boundary result. The Result
    # object still reports plain floats (display/JSON-friendly); the pass/
    # fail DECISION is made in Decimal before that conversion happens.
    reasons: list[str] = []
    raw_value = _as_decimal(reading.value)
    if raw_value is None:
        return Result("incomplete", ["no reading recorded"], limit_source=limit.source)
    if reading.source in PHOTO_SOURCES and not reading.confirmed:
        return Result(
            "unassessed",
            ["photo transcription not confirmed by the technician"],
            float(raw_value),
            reading.unit,
            limit.source,
        )
    limit_min = _as_decimal(limit.min_value)
    limit_max = _as_decimal(limit.max_value)
    if limit_min is None or limit_max is None or not limit.unit or not limit.source:
        return Result(
            "unassessed",
            ["limit missing (min, max, unit and source are all required)"],
            float(raw_value),
            reading.unit,
            limit.source,
        )
    if limit.boundary not in BOUNDARIES:
        return Result(
            "unassessed",
            [f"boundary rule {limit.boundary!r} is not inclusive/exclusive"],
            float(raw_value),
            reading.unit,
            limit.source,
        )
    if limit_min > limit_max:
        return Result(
            "unassessed",
            ["conflicting limit: min is greater than max"],
            float(raw_value),
            reading.unit,
            limit.source,
        )
    value, unit = raw_value, reading.unit
    if unit != limit.unit:
        pair = (unit or "", limit.unit)
        if convert and pair in UNIT_FACTORS:
            value = value * UNIT_FACTORS[pair]
            unit = limit.unit
            reasons.append(
                f"converted {reading.value} {reading.unit} to {value:.4g} {unit} "
                "(explicit, exact decimal)"
            )
        else:
            return Result(
                "unassessed",
                [
                    f"unit {unit!r} does not match limit unit {limit.unit!r}; no conversion requested"
                ],
                float(raw_value),
                reading.unit,
                limit.source,
            )
    if limit.boundary == "inclusive":
        ok = limit_min <= value <= limit_max
    else:
        ok = limit_min < value < limit_max
    reasons.append(
        f"{value:.4g} {unit} vs {limit_min}–{limit_max} {limit.unit} ({limit.boundary}); source {limit.source}"
    )
    return Result("pass" if ok else "fail", reasons, float(value), unit, limit.source)


def _reading(row: dict, prefix: str) -> Reading:
    src = row.get(f"{prefix}_source") or "manual"
    confirmed = str(row.get(f"{prefix}_confirmed", "")).strip().lower() in ("1", "true", "yes", "y")
    return Reading(
        _num(row.get(f"{prefix}_value")),
        row.get(f"{prefix}_unit") or None,
        src,
        confirmed if src in PHOTO_SOURCES else True,
    )


def run_sheet(rows: list[dict], convert: bool = False) -> dict:
    results = []
    for row in rows:
        limit = Limit(
            _num(row.get("limit_min")),
            _num(row.get("limit_max")),
            row.get("limit_unit") or None,
            row.get("boundary") or None,
            row.get("limit_source") or None,
        )
        before = check_reading(_reading(row, "before"), limit, convert)
        after = check_reading(_reading(row, "after"), limit, convert)
        results.append(
            {
                "point_id": row.get("point_id"),
                "before": asdict(before),
                "after": asdict(after),
                "exception": after.status != "pass",
            }
        )
    summary = {
        s: sum(1 for r in results if r["after"]["status"] == s)
        for s in ("pass", "fail", "unassessed", "incomplete")
    }
    return {
        "rows": results,
        "summary": summary,
        "complete": all(
            r["after"]["status"] != "incomplete" and r["before"]["status"] != "incomplete"
            for r in results
        ),
        "exceptions": [r["point_id"] for r in results if r["exception"]],
        "notice": NOTICE,
    }


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def write_outputs(result: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(result, indent=1))
    with (out / "results.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "point_id",
                "before_status",
                "before_value",
                "after_status",
                "after_value",
                # F9: before/after can land in different units (e.g. before
                # converted in->mm, after stayed in because it was unassessed
                # and never converted) — one shared "unit" column was
                # ambiguous and silently wrong. Report each side's own unit.
                "before_unit",
                "after_unit",
                "limit_source",
                "exception",
                "reasons",
            ]
        )
        for r in result["rows"]:
            w.writerow(
                [
                    r["point_id"],
                    r["before"]["status"],
                    r["before"]["compared_value"],
                    r["after"]["status"],
                    r["after"]["compared_value"],
                    r["before"]["compared_unit"],
                    r["after"]["compared_unit"],
                    r["after"]["limit_source"],
                    r["exception"],
                    " | ".join(r["after"]["reasons"]),
                ]
            )
        w.writerow([])
        w.writerow(["NOTICE", NOTICE])


def main(argv: list[str]) -> int:
    if not argv or "--out" not in argv:
        print(__doc__)
        return 2
    result = run_sheet(read_csv(Path(argv[0])), convert="--convert" in argv)
    write_outputs(result, Path(argv[argv.index("--out") + 1]))
    print(
        json.dumps(
            {
                "summary": result["summary"],
                "complete": result["complete"],
                "exceptions": result["exceptions"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
