"""The SERVER half of the SimLab trust boundary (public-demo deployment).

`test_public_demo_trust_boundary.py` proves the *client* cannot express a
request for SimLab's grading surface. That is necessary and not sufficient: once
SimLab is deployed behind a public demo, a client-side allowlist protects nobody
from a stranger with a terminal. These tests prove the *server* refuses.

The rule under test: with `SIMLAB_PUBLIC_ONLY=1`, only the eleven paths the
visitor flow actually needs are reachable. Everything else 404s — rubric,
evidence, eval scorecard, approval gate, validation writes, and the engineer
dashboard included.

Default-deny is the property that matters: a route added to SimLab later must
NOT inherit public reachability, which is why `_is_public_demo_path` matches
whole segments against a frozen pattern list rather than prefix-matching.
"""

from __future__ import annotations

import pytest

from simlab.api import PUBLIC_DEMO_PATHS, _is_public_demo_path

# Every path the demo legitimately needs. Mirrors the client's frozen allowlist
# in packages/factorylm-interaction/src/simlab.ts.
ALLOWED = [
    "/simlab/healthz",
    "/simlab/snapshot",
    "/simlab/alarms",
    "/simlab/history",
    "/simlab/lines/juice_line_01/assets",
    "/simlab/assets/casepacker01/tags",
    "/simlab/assets/casepacker01/docs",
    "/simlab/docs/casepacker01/manual.md",
    "/simlab/scenario/casepacker_jam_upstream_block/start",
    "/simlab/scenario/reset",
    "/simlab/scenario/tick",
]

# Every path that must NOT be reachable from a public origin. The first four are
# the ones that would falsify the demo's central claim.
FORBIDDEN = [
    "/simlab/scenario/casepacker_jam_upstream_block/rubric",
    "/simlab/evidence/casepacker_jam_upstream_block",
    "/simlab/eval/scorecard",
    "/simlab/eval/casepacker_jam_upstream_block",
    "/simlab/dashboard",
    "/simlab/agent/casepacker01/gate",
    "/simlab/validation/answer",
    "/simlab/validation/qa-1/verdict",
    "/simlab/scenario/casepacker_jam_upstream_block/replay",
    "/simlab/factories",
    "/simlab/lines",
    "/docs",
    "/openapi.json",
    "/",
]


@pytest.mark.parametrize("path", ALLOWED)
def test_demo_paths_are_allowed(path: str) -> None:
    assert _is_public_demo_path(path), path


@pytest.mark.parametrize("path", FORBIDDEN)
def test_grading_and_admin_paths_are_denied(path: str) -> None:
    assert not _is_public_demo_path(path), path


def test_rubric_and_evidence_are_denied_for_every_scenario() -> None:
    """Not just the demo's scenario — every one of them.

    A pattern that happened to deny only `casepacker_jam_upstream_block` would
    pass the parametrized test above and still leak the other five.
    """
    from simlab.scenarios import SCENARIOS

    ids = sorted(SCENARIOS)
    assert len(ids) >= 6, f"expected SimLab's six scenarios, saw {ids} — test would be vacuous"
    for scenario_id in ids:
        assert not _is_public_demo_path(f"/simlab/scenario/{scenario_id}/rubric")
        assert not _is_public_demo_path(f"/simlab/evidence/{scenario_id}")
        # ...while the control path for the same scenario stays reachable.
        assert _is_public_demo_path(f"/simlab/scenario/{scenario_id}/start")


def test_wildcard_matches_exactly_one_segment() -> None:
    """`*` must not swallow separators, or `rubric` sneaks in under a doc path."""
    assert _is_public_demo_path("/simlab/docs/a/b")
    assert not _is_public_demo_path("/simlab/docs/a/b/c")
    assert not _is_public_demo_path("/simlab/docs/a")
    # The specific smuggling shape: extra segments after an allowed prefix.
    assert not _is_public_demo_path("/simlab/scenario/x/start/rubric")


def test_prefix_matching_is_not_used() -> None:
    """A prefix match would make every grading path reachable under an allowed one."""
    assert not _is_public_demo_path("/simlab/healthz/../evidence/x")
    assert not _is_public_demo_path("/simlab/snapshotX")
    assert not _is_public_demo_path("/simlab/snapshot/extra")


def test_allowlist_is_the_only_source_of_truth() -> None:
    """Every ALLOWED path corresponds to a pattern, and there are no spare patterns.

    Keeps the frozen tuple and the demo's real surface from drifting apart: a
    pattern nobody uses is dead permission, and a used path with no pattern
    would already have failed above.
    """
    matched = set()
    for path in ALLOWED:
        segments = tuple(s for s in path.split("/") if s)
        for pattern in PUBLIC_DEMO_PATHS:
            if len(segments) == len(pattern) and all(
                p == "*" or p == s for p, s in zip(pattern, segments)
            ):
                matched.add(pattern)
    assert matched == set(PUBLIC_DEMO_PATHS), (
        "unused patterns (dead permission): " + str(set(PUBLIC_DEMO_PATHS) - matched)
    )
