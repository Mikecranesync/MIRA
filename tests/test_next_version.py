"""Tests for tools/release/next_version.py.

This code decides the tag name for a save point. A wrong bump is cosmetic; a
FAILURE to produce a usable version loses the restore point the mechanism exists
to provide. So the unknown/garbage paths are tested as carefully as the happy one.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_MOD = Path(__file__).resolve().parents[1] / "tools" / "release" / "next_version.py"
_spec = importlib.util.spec_from_file_location("next_version", _MOD)
assert _spec and _spec.loader
nv = importlib.util.module_from_spec(_spec)
sys.modules["next_version"] = nv
_spec.loader.exec_module(nv)


# --- bump level from a Conventional Commit subject ---------------------------


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        ("feat: add a thing", "minor"),
        ("feat(hooks): add a thing", "minor"),
        ("fix: repair", "patch"),
        ("fix(spine): repair", "patch"),
        ("security(web): rate limit", "patch"),
        ("docs: notes", "patch"),
        ("chore(deps): bump", "patch"),
        ("test(ci): coverage", "patch"),
        ("refactor: tidy", "patch"),
        # The `!` marker is the easy one to miss, and missing it understates a
        # breaking release.
        ("feat!: drop the old API", "major"),
        ("fix(scope)!: incompatible repair", "major"),
        ("BREAKING: remove endpoint", "major"),
        ("breaking(api): remove endpoint", "major"),
        ("feat: x\n\nBREAKING CHANGE: y", "major"),
        # Not a conventional subject at all -> still a save point, so patch.
        ("Merge pull request #123 from foo/bar", "patch"),
        ("wip", "patch"),
        ("", "patch"),
        # Unknown type -> patch, never skipped.
        ("banana: something", "patch"),
    ],
)
def test_bump_from_subject(subject: str, expected: str) -> None:
    assert nv.bump_from_subject(subject) == expected


# --- semver arithmetic ------------------------------------------------------


@pytest.mark.parametrize(
    ("current", "bump", "expected"),
    [
        ((3, 231, 0), "patch", (3, 231, 1)),
        ((3, 231, 5), "minor", (3, 232, 0)),
        ((3, 231, 5), "major", (4, 0, 0)),
        # minor/major must ZERO the lower components, not carry them.
        ((1, 2, 9), "minor", (1, 3, 0)),
        ((1, 2, 9), "major", (2, 0, 0)),
    ],
)
def test_apply_bump(current, bump, expected) -> None:
    assert nv.apply_bump(current, bump) == expected


def test_parse_semver_accepts_v_prefix() -> None:
    assert nv.parse_semver("v3.231.0") == (3, 231, 0)
    assert nv.parse_semver("3.231.0") == (3, 231, 0)


@pytest.mark.parametrize("bad", ["", "3.231", "x.y.z", "v3.231.0-rc1", "3.231.0.1"])
def test_parse_semver_rejects_garbage(bad: str) -> None:
    with pytest.raises(nv.VersionError):
        nv.parse_semver(bad)


# --- next_version end to end -------------------------------------------------


def test_next_version_bumps_the_latest_tag() -> None:
    assert nv.next_version("v3.231.0", "fix: a") == "3.231.1"
    assert nv.next_version("v3.231.0", "feat: a") == "3.232.0"
    assert nv.next_version("v3.231.0", "feat!: a") == "4.0.0"


def test_next_version_with_no_tags_starts_from_the_floor() -> None:
    """A fresh repo (or one whose v* tags were pruned) must still produce a usable
    tag rather than erroring — otherwise the merge gets no save point.

    It bumps PAST the floor rather than landing on it: `/VERSION` may name a
    number that was already tagged and released before the tag was pruned, and
    re-using it would make `gh release create` collide (or worse, silently no-op
    and lose the checkpoint). One wasted patch number is the cheap side.
    """
    assert nv.next_version(None, "fix: a", floor=(3, 231, 0)) == "3.231.1"
    assert nv.next_version(None, "fix: a", floor=None) == "0.0.1"
    # A minor bump from the floor still zeroes the patch.
    assert nv.next_version(None, "feat: a", floor=(3, 231, 4)) == "3.232.0"


def test_floor_prevents_going_backwards() -> None:
    """Transition case: /VERSION was hand-bumped ahead of the tags. The derived
    version must never be lower than the file, or `v<X>` could collide with an
    already-released number."""
    # tags at 3.229.1 but VERSION already says 3.231.0 -> must not emit 3.229.2
    out = nv.next_version("v3.229.1", "fix: a", floor=(3, 231, 0))
    assert nv.parse_semver(out) >= (3, 231, 0)


def test_floor_is_ignored_once_tags_lead() -> None:
    """Normal steady state: tags are ahead of (or equal to) the file, so the
    floor stops mattering and the tag drives."""
    assert nv.next_version("v3.231.0", "fix: a", floor=(3, 230, 0)) == "3.231.1"


def test_equal_floor_and_tag_still_advances() -> None:
    """The dangerous case: file == latest tag. It must still move forward, or the
    workflow would try to create a tag that already exists and silently no-op,
    losing the save point."""
    out = nv.next_version("v3.231.0", "fix: a", floor=(3, 231, 0))
    assert out == "3.231.1"
    assert nv.parse_semver(out) > (3, 231, 0)


def test_bad_latest_tag_is_loud() -> None:
    with pytest.raises(nv.VersionError):
        nv.next_version("not-a-tag", "fix: a")


def test_floor_temporarily_flattens_the_bump_signal() -> None:
    """KNOWN transition consequence, pinned so it is not a surprise later.

    While `/VERSION` is hand-bumped AHEAD of the tags, the floor dominates and
    distinct bump levels collapse to the same number — a `fix` and a `feat` both
    land on the floor. The semver *signal* is therefore muted during the
    changeover window; it is not wrong (the number never goes backwards, and never
    collides), just less informative.

    It self-resolves the moment tags catch up to the file, which happens on the
    first merge after this lands. Post-retirement behaviour is the steady-state
    test below.
    """
    flattened_fix = nv.next_version("v3.231.0", "fix: a", floor=(3, 232, 0))
    flattened_feat = nv.next_version("v3.231.0", "feat: a", floor=(3, 232, 0))
    assert flattened_fix == flattened_feat == "3.232.0"


def test_steady_state_after_version_file_retires() -> None:
    """With no floor (i.e. `/VERSION` deleted), the tag alone drives and the
    Conventional Commit type is fully honoured. This is the end state."""
    assert nv.next_version("v3.232.0", "fix(x): a", floor=None) == "3.232.1"
    assert nv.next_version("v3.232.0", "feat(x): a", floor=None) == "3.233.0"
    assert nv.next_version("v3.232.0", "feat!: a", floor=None) == "4.0.0"
    assert nv.next_version("v3.232.0", "chore: x", floor=None) == "3.232.1"
    assert nv.next_version("v3.232.0", "Merge pull request #1", floor=None) == "3.232.1"
