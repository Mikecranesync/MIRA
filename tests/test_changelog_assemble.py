"""Tests for tools/changelog/assemble.py — the changelog-fragment assembler.

The assembler decides the release version, so a fragment it silently skips is a
lost release note AND a wrong version bump. These tests pin that it fails loudly
instead, and that the bump is the highest impact across all pending fragments.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_ASSEMBLE = Path(__file__).resolve().parents[1] / "tools" / "changelog" / "assemble.py"
_spec = importlib.util.spec_from_file_location("changelog_assemble", _ASSEMBLE)
assert _spec and _spec.loader
asm = importlib.util.module_from_spec(_spec)
sys.modules["changelog_assemble"] = asm
_spec.loader.exec_module(asm)


def _frag(tmp_path: Path, name: str, body: str) -> Path:
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return p


# --- version arithmetic -----------------------------------------------------


@pytest.mark.parametrize(
    ("current", "bump", "expected"),
    [
        ("3.229.3", "patch", "3.229.4"),
        ("3.229.3", "minor", "3.230.0"),
        ("3.229.3", "major", "4.0.0"),
        ("3.229.3", "none", "3.229.3"),
        # minor/major must ZERO the lower components, not carry them.
        ("1.2.9", "minor", "1.3.0"),
        ("1.2.9", "major", "2.0.0"),
    ],
)
def test_bump_version(current: str, bump: str, expected: str) -> None:
    assert asm.bump_version(current, bump) == expected


def test_bump_version_rejects_non_semver() -> None:
    with pytest.raises(asm.FragmentError):
        asm.bump_version("v3.229.3", "patch")


def test_highest_bump_wins() -> None:
    """One feat among many fixes is a MINOR release, not a patch."""
    assert asm.highest_bump(["fix", "fix", "feat", "fix"]) == "minor"
    assert asm.highest_bump(["fix", "security"]) == "patch"
    assert asm.highest_bump(["feat", "breaking"]) == "major"
    assert asm.highest_bump(["docs", "chore"]) == "none"
    # A release-neutral type must not drag a real bump down.
    assert asm.highest_bump(["docs", "fix"]) == "patch"


# --- fragment parsing: fail loudly ------------------------------------------


def test_parse_valid_fragment(tmp_path: Path) -> None:
    p = _frag(tmp_path, "a.md", "---\ntype: fix\n---\n\nThe body.\n")
    assert asm.parse_fragment(p) == ("fix", "", "The body.")


def test_parse_tolerates_quotes_and_case(tmp_path: Path) -> None:
    p = _frag(tmp_path, "a.md", '---\nType: "Fix"\n---\nBody\n')
    # key is lowercased; the value is unquoted. Value case is NOT normalized, so
    # "Fix" must be rejected rather than silently accepted as fix.
    with pytest.raises(asm.FragmentError, match="unknown type"):
        asm.parse_fragment(p)


@pytest.mark.parametrize(
    ("content", "match"),
    [
        ("no front matter at all\n", "missing `---` front matter"),
        ("---\ntype: banana\n---\nBody\n", "unknown type"),
        ("---\nnope: fix\n---\nBody\n", "no `type:`"),
        ("---\ntype: fix\n---\n\n   \n", "body is empty"),
        ("---\njust-a-bare-line\n---\nBody\n", "not `key: value`"),
    ],
)
def test_malformed_fragments_raise(tmp_path: Path, content: str, match: str) -> None:
    p = _frag(tmp_path, "bad.md", content)
    with pytest.raises(asm.FragmentError, match=match):
        asm.parse_fragment(p)


# --- discovery --------------------------------------------------------------


def test_find_fragments_excludes_readme_and_sorts(tmp_path: Path) -> None:
    _frag(tmp_path, "README.md", "docs")
    _frag(tmp_path, "b.md", "x")
    _frag(tmp_path, "a.md", "x")
    _frag(tmp_path, "notes.txt", "ignored")
    assert [p.name for p in asm.find_fragments(tmp_path)] == ["a.md", "b.md"]


def test_find_fragments_missing_dir_is_empty(tmp_path: Path) -> None:
    assert asm.find_fragments(tmp_path / "nope") == []


# --- rendering --------------------------------------------------------------


def test_render_entry_lists_every_fragment() -> None:
    frags = [("x.md", "feat", "", "Added X."), ("y.md", "fix", "", "Fixed Y.")]
    out = asm.render_entry("3.230.0", frags, "2026-07-29")
    assert out.startswith("### v3.230.0 (2026-07-29) - feat: 2 change(s)")
    assert "Added X." in out and "Fixed Y." in out
    assert "(x.md)" in out and "(y.md)" in out


def test_render_entry_uses_title_for_the_headline() -> None:
    """The heading must read like the house style, not 'N change(s)'."""
    frags = [("x.md", "feat", "feat(hooks): thing", "Body X.")]
    out = asm.render_entry("3.230.0", frags, "2026-07-29")
    # The title is already a conventional-commit subject, so the type must NOT be
    # prefixed again — that rendered "feat: feat(hooks): thing" on main once.
    assert out.startswith("### v3.230.0 (2026-07-29) - feat(hooks): thing")
    assert "feat: feat(" not in out


def test_render_entry_prefixes_type_for_a_plain_title() -> None:
    """A title that is NOT a conventional subject still gets its type."""
    frags = [("x.md", "feat", "added a thing", "Body.")]
    out = asm.render_entry("3.230.0", frags, "2026-07-29")
    assert out.startswith("### v3.230.0 (2026-07-29) - feat: added a thing")


def test_render_entry_single_fragment_does_not_repeat_the_title() -> None:
    """With one fragment the heading IS the title; repeating it below is noise."""
    frags = [("x.md", "fix", "fix(a): b", "The body prose.")]
    out = asm.render_entry("3.229.4", frags, "2026-07-29")
    assert out.count("fix(a): b") == 1
    assert "The body prose." in out


def test_render_entry_counts_the_extras_in_the_headline() -> None:
    frags = [("x.md", "feat", "feat: headline", "B1"), ("y.md", "fix", "fix: other", "B2")]
    out = asm.render_entry("3.230.0", frags, "2026-07-29")
    assert "feat: headline (+1 more)" in out.splitlines()[0]


def test_optional_title_is_parsed(tmp_path: Path) -> None:
    """`title:` carries the release-notes headline; a colon inside it must survive
    the `key: value` split (conventional-commit subjects always contain one)."""
    p = _frag(tmp_path, "a.md", "---\ntype: fix\ntitle: fix(x): y\n---\nBody\n")
    assert asm.parse_fragment(p) == ("fix", "fix(x): y", "Body")


# --- the real repo's own fragments must always be valid ---------------------


def test_repo_fragments_all_parse() -> None:
    """Guards against a malformed fragment reaching main and breaking a release."""
    frag_dir = Path(__file__).resolve().parents[1] / "changelog.d"
    for p in asm.find_fragments(frag_dir):
        ftype, _title, body = asm.parse_fragment(p)  # raises on malformed
        assert ftype in asm.BUMP_BY_TYPE
        assert body
