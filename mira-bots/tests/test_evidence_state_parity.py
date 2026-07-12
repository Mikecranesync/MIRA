"""Drift guard: EvidenceState (Python) must byte-match migration 063's SQL
CHECK constraints, on both the ``observation`` and ``answer_claim`` tables.

ADR-0027 D2: the evidence-state vocabulary ships ONCE and is mirrored in
Python + SQL. If someone edits the enum without touching the migration (or
vice versa), a write against the "wrong" side would look fine in Python and
then explode against the live CHECK constraint (or silently diverge if the
CHECK were ever loosened). This test parses the actual SQL text of migration
063 and compares it to ``EvidenceState`` byte-for-byte, so drift is caught in
CI, not in a failed INSERT against Neon.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.visual.evidence_state import ALL_STATES, EvidenceState  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION_PATH = _REPO_ROOT / "mira-hub" / "db" / "migrations" / "063_visual_sessions.sql"

# Matches `CHECK (evidence_state IN ('A','B',...))` regardless of the
# whitespace/newline wrapping the migration uses for readability.
_CHECK_RE = re.compile(
    r"CHECK\s*\(\s*evidence_state\s+IN\s*\(([^)]*)\)\s*\)", re.IGNORECASE | re.DOTALL
)
_VALUE_RE = re.compile(r"'([^']*)'")


def _parse_evidence_state_checks() -> list[list[str]]:
    sql = _MIGRATION_PATH.read_text(encoding="utf-8")
    return [_VALUE_RE.findall(m.group(1)) for m in _CHECK_RE.finditer(sql)]


def test_migration_file_exists():
    assert _MIGRATION_PATH.is_file(), f"expected migration at {_MIGRATION_PATH}"


def test_migration_defines_at_least_two_evidence_state_checks():
    # observation.evidence_state + answer_claim.evidence_state
    checks = _parse_evidence_state_checks()
    assert len(checks) >= 2, (
        f"expected >=2 evidence_state CHECK constraints (observation + answer_claim), "
        f"found {len(checks)} -- did migration 063 change shape?"
    )


def test_every_check_matches_evidence_state_enum_exactly():
    checks = _parse_evidence_state_checks()
    assert checks, "no evidence_state CHECK constraints found in migration 063"
    expected = list(ALL_STATES)
    for values in checks:
        assert values == expected, (
            f"migration CHECK values {values} != EvidenceState values {expected} "
            "-- the SQL CHECK and the Python enum have drifted apart"
        )


def test_all_checks_are_identical_to_each_other():
    # observation and answer_claim must enumerate the SAME states in the SAME
    # order -- a "view over existing vocabularies", not two separate lists
    # that happen to overlap.
    checks = _parse_evidence_state_checks()
    first = checks[0]
    for values in checks[1:]:
        assert values == first, "observation and answer_claim evidence_state CHECKs disagree"


def test_evidence_state_values_are_unique():
    assert len(ALL_STATES) == len(set(ALL_STATES))


def test_evidence_state_enum_members_match_all_states_tuple():
    assert set(EvidenceState) == {EvidenceState(v) for v in ALL_STATES}
    assert [s.value for s in EvidenceState] == list(ALL_STATES)
