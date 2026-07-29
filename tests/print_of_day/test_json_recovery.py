"""Bounded JSON-recovery tests — the dense-sheet robustness core.

Reproduces the six malformed-output classes the 2026-07-22 benchmark surfaced
on a dense sheet, HERMETICALLY (no network, no paid call): output truncation at
the token ceiling, incomplete JSON, missing delimiters, fenced JSON, prefixed/
suffixed reasoning, and irrecoverably malformed output. Also proves the two
safety invariants: recovery never synthesizes a missing value, and it fails
closed (recovered=None) whenever it is uncertain or schema validation rejects
the result.

Sanitized fixtures live in ``tests/print_of_day/fixtures/dense_sheet/``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense import json_recovery as jr  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "dense_sheet"


def _fix(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ── the six required malformed-output classes ───────────────────────────────


def test_clean_output_needs_no_repair() -> None:
    raw = json.dumps({"package": {"drawing_no": "31971"}, "devices": []})
    r = jr.recover_json_object(raw)
    assert r.valid and r.recovered == {"package": {"drawing_no": "31971"}, "devices": []}
    assert r.repair_attempted is False
    assert r.method == jr.METHOD_NONE


def test_fenced_json_is_unwrapped() -> None:
    r = jr.recover_json_object(_fix("fenced.txt"))
    assert r.valid and r.recovered is not None
    assert r.recovered["package"]["drawing_no"] == "31971"
    assert jr.METHOD_EXTRACT in r.methods


def test_prefixed_and_suffixed_reasoning_is_stripped() -> None:
    r = jr.recover_json_object(_fix("prefixed_reasoning.txt"))
    assert r.valid and r.recovered is not None
    assert r.recovered["devices"][0]["tag"] == "-5/A101"
    assert r.repair_attempted is True


def test_missing_delimiter_is_inserted() -> None:
    # the exact A104 failure class: two complete members with no comma between
    r = jr.recover_json_object(_fix("missing_delimiter.txt"))
    assert r.valid and r.recovered is not None
    assert jr.METHOD_DELIMITER in r.methods
    assert r.recovered["package"]["drawing_no"] == "31971"
    assert r.recovered["package"]["sheet"] == 6


def test_trailing_comma_is_dropped() -> None:
    raw = '{"package": {"drawing_no": "31971",}, "devices": [],}'
    r = jr.recover_json_object(raw)
    assert r.valid and r.recovered == {"package": {"drawing_no": "31971"}, "devices": []}
    assert jr.METHOD_TRAILING_COMMA in r.methods


def test_truncated_output_is_closed_by_dropping_incomplete_tail() -> None:
    # truncation at the token ceiling: object cut off mid-device
    r = jr.recover_json_object(_fix("truncated.txt"))
    assert r.valid and r.recovered is not None
    assert r.truncated is True
    assert jr.METHOD_CLOSE_TRUNCATED in r.methods
    # the COMPLETE leading members survive; the incomplete trailing device is dropped
    assert r.recovered["package"]["drawing_no"] == "31971"
    assert isinstance(r.recovered["devices"], list)
    # no fabricated tag on the dropped device
    for d in r.recovered["devices"]:
        assert d.get("tag") != ""


def test_irrecoverable_output_fails_closed() -> None:
    r = jr.recover_json_object(_fix("irrecoverable.txt"))
    assert r.recovered is None
    assert r.valid is False
    assert r.method == jr.METHOD_FAILED


# ── fail-closed / no-synthesis invariants ───────────────────────────────────


def test_empty_output_fails_closed() -> None:
    assert jr.recover_json_object("").recovered is None
    assert jr.recover_json_object("   \n ").recovered is None


def test_two_top_level_objects_are_ambiguous_and_fail_closed() -> None:
    raw = '{"package": {"drawing_no": "31971"}} {"package": {"drawing_no": "99999"}}'
    r = jr.recover_json_object(raw)
    assert r.recovered is None
    assert "ambiguous" in r.detail


def test_non_object_top_level_fails_closed() -> None:
    r = jr.recover_json_object("[1, 2, 3]")
    assert r.recovered is None


def test_schema_validation_rejection_fails_closed() -> None:
    # structurally valid JSON, but the schema says no → not accepted
    raw = json.dumps({"package": {"drawing_no": "31971"}, "devices": "not-a-list"})

    def _validate(obj: dict) -> None:
        if not isinstance(obj.get("devices"), list):
            raise ValueError("devices must be a list")

    r = jr.recover_json_object(raw, validate=_validate)
    assert r.recovered is None
    assert r.valid is False
    assert "schema validation failed" in r.detail


def test_recovery_never_synthesizes_values() -> None:
    # every string/number in the recovered object must appear in the raw input:
    # recovery may DROP data (truncation) or add STRUCTURE (delimiters/closers),
    # never invent a technical value.
    raw = _fix("truncated.txt")
    r = jr.recover_json_object(raw)
    assert r.recovered is not None

    def _leaves(o: object):
        if isinstance(o, dict):
            for k, v in o.items():
                yield str(k)
                yield from _leaves(v)
        elif isinstance(o, list):
            for v in o:
                yield from _leaves(v)
        elif isinstance(o, bool) or o is None:
            return
        else:
            yield o

    for leaf in _leaves(r.recovered):
        if isinstance(leaf, str):
            assert leaf in raw, f"synthesized string value not in raw input: {leaf!r}"
        elif isinstance(leaf, (int, float)):
            assert str(leaf) in raw or json.dumps(leaf) in raw, f"synthesized number: {leaf}"


def test_repair_is_bounded_no_runaway() -> None:
    # a pathological input must terminate (bound = MAX_PARSER_FIXES), not hang
    raw = "{" + '"a":1' * 5000  # no closers, many members, no commas
    r = jr.recover_json_object(raw)
    # either recovered by close_truncated or failed — but it MUST return
    assert isinstance(r, jr.RecoveryResult)
