"""The ontology fixture-coverage gate (ADR-0032 §8, issue #5528).

WHY THIS FILE EXISTS
--------------------
Until #5528 the validator reported fixture coverage as a SKIP: 11 of 42 shapes had a targeted
invalid fixture and the run was green. A skipped check that names a gap is still a check nobody
has to act on. These tests pin the three properties that turn it into a gate:

  1. An invalid fixture must fail for its DECLARED reason and nothing else. Before this change a
     fixture passed whenever its expected shape fired, even if three unrelated shapes fired with
     it — so "the graph was rejected for the intended reason" was asserted by nobody.
  2. Every shape needs BOTH halves of a pair: an invalid fixture that pins it and a valid fixture
     that the shape actually targets. A valid fixture that conforms only because the shape never
     looked at it protects nothing.
  3. Missing coverage FAILS. The only way to leave a shape uncovered is a written exclusion with
     a reason and a tracking reference, and an exclusion for a covered shape is itself a failure.

Every test here builds a throwaway fixture root and runs the real shapes against it, so a pass
means the gate behaves, not that some file exists.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("rdflib", reason="ontology toolchain: pip install -r ontology/requirements.txt")
pytest.importorskip(
    "pyshacl", reason="ontology toolchain: pip install -r ontology/requirements.txt"
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "validate_ontology", REPO_ROOT / "tools" / "validate_ontology.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["validate_ontology"] = mod
    spec.loader.exec_module(mod)
    return mod


V = _load_validator()

PREFIXES = """
@prefix mira: <https://ontology.factorylm.com/mira#> .
@prefix ex:   <https://example.org/fx#> .
"""

# A fault code with no scope: violates FaultCodeScopeShape and nothing else.
UNSCOPED = (
    PREFIXES
    + """
ex:manual a mira:SourceDocument .
ex:cite   a mira:Citation ; mira:cite_doc ex:manual ; mira:cite_locator "p.114" .
ex:f007   a mira:FaultCode ; mira:fault_mnemonic "F007" ; mira:supported_by ex:cite .
"""
)

# The same unscoped fault code, but its citation ALSO names no source document — so
# CitationCompletenessShape fires alongside FaultCodeScopeShape.
UNSCOPED_AND_BAD_CITATION = (
    PREFIXES
    + """
ex:cite   a mira:Citation ; mira:cite_locator "p.114" .
ex:f007   a mira:FaultCode ; mira:fault_mnemonic "F007" ; mira:supported_by ex:cite .
"""
)

SCOPED = (
    PREFIXES
    + """
ex:rockwell a mira:Manufacturer .
ex:pf40     a mira:DriveFamily ; mira:manufactured_by ex:rockwell .
ex:manual   a mira:SourceDocument .
ex:cite     a mira:Citation ; mira:cite_doc ex:manual ; mira:cite_locator "p.114" .
ex:f007     a mira:FaultCode ; mira:fault_mnemonic "F007" ; mira:scoped_to ex:pf40 ;
            mira:supported_by ex:cite .
"""
)

# Conforms, but contains no FaultCode at all — FaultCodeScopeShape never looks at it.
NO_FAULT_CODE = (
    PREFIXES
    + """
ex:rockwell a mira:Manufacturer .
"""
)


@pytest.fixture(scope="module")
def graphs():
    onto = V.load_graph(V.ontology_files() + V.mapping_files())
    shapes = V.load_graph(V.shape_files())
    return onto, shapes


def _root(tmp_path: Path, invalid: dict[str, str], valid: dict[str, str]) -> Path:
    for sub, files in (("invalid", invalid), ("valid", valid)):
        d = tmp_path / sub
        d.mkdir()
        for name, body in files.items():
            (d / name).write_text(body, encoding="utf-8")
    return tmp_path


def _result(report, prefix: str):
    hits = [r for r in report.results if r.name.startswith(prefix)]
    assert len(hits) == 1, f"expected one result named {prefix}*, got {[r.name for r in hits]}"
    return hits[0]


class TestInvalidFixtureFailsForItsDeclaredReasonOnly:
    def test_clean_single_violation_passes(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path, {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED}, {}
        )
        report = V.Report()
        V.check_invalid_fixtures(report, onto, shapes, root)
        assert _result(report, "fixtures:invalid:a.ttl").passed

    def test_an_undeclared_extra_shape_fails_the_fixture(self, tmp_path, graphs):
        """The property the plan doc claimed and the validator did not enforce."""
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {
                "a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n"
                + UNSCOPED_AND_BAD_CITATION
            },
            {},
        )
        report = V.Report()
        V.check_invalid_fixtures(report, onto, shapes, root)
        r = _result(report, "fixtures:invalid:a.ttl")
        assert not r.passed
        assert "CitationCompletenessShape" in r.detail
        assert "ALSO-FIRES" in r.detail  # the message tells the author how to declare it

    def test_a_declared_co_firing_shape_is_accepted(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {
                "a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n"
                "# ALSO-FIRES: mirash:CitationCompletenessShape the citation is deliberately bare\n"
                + UNSCOPED_AND_BAD_CITATION
            },
            {},
        )
        report = V.Report()
        V.check_invalid_fixtures(report, onto, shapes, root)
        assert _result(report, "fixtures:invalid:a.ttl").passed

    def test_a_declared_co_firing_shape_that_stays_silent_fails(self, tmp_path, graphs):
        """A stale ALSO-FIRES line is a wrong statement about the shapes; it must not linger."""
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {
                "a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n"
                "# ALSO-FIRES: mirash:CitationCompletenessShape\n" + UNSCOPED
            },
            {},
        )
        report = V.Report()
        V.check_invalid_fixtures(report, onto, shapes, root)
        r = _result(report, "fixtures:invalid:a.ttl")
        assert not r.passed
        assert "CitationCompletenessShape" in r.detail

    def test_also_fires_does_not_count_as_coverage(self, tmp_path, graphs):
        """Only EXPECT-VIOLATION pins a shape. A shape that merely tags along is not exercised."""
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {
                "a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n"
                "# ALSO-FIRES: mirash:CitationCompletenessShape\n" + UNSCOPED_AND_BAD_CITATION
            },
            {},
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert "FaultCodeScopeShape" in cov.pinned
        assert "CitationCompletenessShape" not in cov.pinned


class TestCoverageIsAGateNotANote:
    def test_uncovered_shapes_fail_and_are_not_skipped(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED},
            {"a.ttl": "# PROTECTS: mirash:FaultCodeScopeShape\n" + SCOPED},
        )
        report = V.Report()
        V.check_fixture_coverage(report, onto, shapes, root)
        r = _result(report, "shapes:fixture-coverage")
        assert not r.skipped, "coverage must be a counted check, never a SKIP"
        assert not r.passed
        assert "1/42" in r.detail
        assert "CommandNotFeedbackShape" in r.detail  # names what is missing
        assert not report.ok

    def test_an_invalid_fixture_without_a_valid_twin_is_not_coverage(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path, {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED}, {}
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert "FaultCodeScopeShape" in cov.pinned
        assert "FaultCodeScopeShape" not in cov.protected
        assert "FaultCodeScopeShape" not in cov.covered

    def test_a_valid_twin_the_shape_never_targets_is_not_protection(self, tmp_path, graphs):
        """A valid fixture conforms trivially when the shape has nothing to look at."""
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED},
            {"a.ttl": "# PROTECTS: mirash:FaultCodeScopeShape\n" + NO_FAULT_CODE},
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert "FaultCodeScopeShape" not in cov.protected
        assert any("a.ttl" in p and "FaultCodeScopeShape" in p for p in cov.problems)

    def test_a_valid_twin_that_does_not_conform_is_not_protection(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED},
            {"a.ttl": "# PROTECTS: mirash:FaultCodeScopeShape\n" + UNSCOPED},
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert "FaultCodeScopeShape" not in cov.protected

    def test_a_header_naming_an_unknown_shape_is_reported(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED},
            {"a.ttl": "# PROTECTS: mirash:FaultCodeScopShape\n" + SCOPED},  # typo on purpose
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert any("FaultCodeScopShape" in p for p in cov.problems)


class TestExclusionsAreExplicitAndCannotGoStale:
    def _write(self, root: Path, entries) -> None:
        (root / "coverage-exclusions.json").write_text(json.dumps(entries), encoding="utf-8")

    def test_an_exclusion_needs_a_reason_and_a_tracking_reference(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(tmp_path, {}, {})
        self._write(root, [{"shape": "CommandNotFeedbackShape", "reason": "", "tracking": ""}])
        cov = V.fixture_coverage(onto, shapes, root)
        assert "CommandNotFeedbackShape" not in cov.excluded
        assert any("CommandNotFeedbackShape" in p for p in cov.problems)

    def test_a_justified_exclusion_removes_the_shape_from_the_missing_list(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(tmp_path, {}, {})
        self._write(
            root,
            [
                {
                    "shape": "CommandNotFeedbackShape",
                    "reason": "illustrative reason long enough to be a real sentence",
                    "tracking": "#5528",
                }
            ],
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert "CommandNotFeedbackShape" in cov.excluded
        assert "CommandNotFeedbackShape" not in cov.missing

    def test_excluding_a_covered_shape_is_a_failure(self, tmp_path, graphs):
        """An exclusion that outlives the gap it described would hide the next regression."""
        onto, shapes = graphs
        root = _root(
            tmp_path,
            {"a.ttl": "# EXPECT-VIOLATION: mirash:FaultCodeScopeShape\n" + UNSCOPED},
            {"a.ttl": "# PROTECTS: mirash:FaultCodeScopeShape\n" + SCOPED},
        )
        self._write(
            root,
            [
                {
                    "shape": "FaultCodeScopeShape",
                    "reason": "illustrative reason long enough to be a real sentence",
                    "tracking": "#5528",
                }
            ],
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert any("FaultCodeScopeShape" in p and "stale" in p.lower() for p in cov.problems)

    def test_excluding_an_unknown_shape_is_a_failure(self, tmp_path, graphs):
        onto, shapes = graphs
        root = _root(tmp_path, {}, {})
        self._write(
            root,
            [
                {
                    "shape": "NoSuchShape",
                    "reason": "illustrative reason long enough to be a real sentence",
                    "tracking": "#5528",
                }
            ],
        )
        cov = V.fixture_coverage(onto, shapes, root)
        assert any("NoSuchShape" in p for p in cov.problems)


class TestTheRealTree:
    def test_every_declared_shape_is_covered_or_explicitly_excluded(self, graphs):
        onto, shapes = graphs
        cov = V.fixture_coverage(onto, shapes, V.FIXTURES_DIR)
        assert cov.problems == []
        assert cov.missing == [], f"shapes with no valid+invalid pair: {cov.missing}"
        assert len(cov.declared) == len(cov.covered) + len(cov.excluded)

    def test_missing_fixture_directories_fail(self, tmp_path, graphs):
        """An absent directory used to SKIP 'by design'. With a gate that is a silent pass."""
        onto, shapes = graphs
        report = V.Report()
        V.check_valid_fixtures(report, onto, shapes, tmp_path)
        V.check_invalid_fixtures(report, onto, shapes, tmp_path)
        assert all(not r.skipped for r in report.results)
        assert not report.ok

    def test_the_validator_exits_zero_with_nothing_skipped(self, capsys):
        assert V.main(["--format", "json"]) == 0
        out = json.loads(capsys.readouterr().out)
        assert out["skipped"] == 0
        assert out["failed"] == 0
