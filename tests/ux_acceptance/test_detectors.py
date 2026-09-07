"""Detector suite for the ChatGPT-Class UX Acceptance gate.

Every detector here is paired with the fixture that reproduces the defect it
detects. That pairing is the point, not a convenience: a fixture-driven check
can only catch defects its corpus contains, and the corpus is written by the
same people who would fix the defect. So each detector has BOTH an `observed_*`
fixture built from literal bytes captured off a real device, and a `repaired_*`
twin it must pass — the positive control that proves the detector can fail at
all.

Fixture provenance is recorded in each JSON's `_provenance` field and traces to
docs/audits/2026-09-07-mobile-recon-companion.md and the mobile teardown.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ux_acceptance.detectors import (  # noqa: E402
    Verdict,
    detect_citation_identity,
    detect_groundedness_signal,
    detect_identifier_repetition,
    run_all,
)
from ux_acceptance.snapshot import Snapshot, SnapshotError  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> Snapshot:
    return Snapshot.from_dict(json.loads((FIXTURES / f"{name}.json").read_text()))


# --------------------------------------------------------------------------
# The corpus itself. If these go missing the whole suite is vacuous, so assert
# it is non-empty rather than trusting a glob.
# --------------------------------------------------------------------------


def test_the_fixture_corpus_is_not_empty():
    found = sorted(p.stem for p in FIXTURES.glob("*.json"))
    assert found, "no fixtures — every test below would pass by having nothing to judge"
    for required in (
        "observed_citation_uuid",
        "observed_identifier_repetition",
        "observed_no_groundedness",
    ):
        assert required in found, f"the observed-defect fixture {required} is missing"


def test_every_observed_fixture_records_its_provenance():
    """A fixture with no provenance is a guess wearing a capture's clothes."""
    for path in FIXTURES.glob("observed_*.json"):
        raw = json.loads(path.read_text())
        assert raw.get("_provenance"), f"{path.name} does not say where it came from"


# --------------------------------------------------------------------------
# E-1 — citation names a document, not an identifier
# --------------------------------------------------------------------------


def test_citation_detector_fires_on_the_observed_uuid():
    """The positive control. This is the literal label seen on the Pixel 9a."""
    finding = detect_citation_identity(load("observed_citation_uuid"))
    assert finding.verdict is Verdict.FAIL
    assert finding.blocking
    assert any("12ac8c22" in e for e in finding.evidence), finding.evidence


def test_citation_detector_passes_the_repaired_screen():
    finding = detect_citation_identity(load("repaired_citation"))
    assert finding.verdict is Verdict.PASS, finding.summary


def test_citation_detector_reports_unknown_when_it_cannot_see_citations():
    """A moved selector must not read as a clean screen."""
    with pytest.raises(SnapshotError, match="citation-label"):
        detect_citation_identity(load("blind_no_citation_nodes"))


def test_run_all_converts_a_blind_detector_to_unknown_not_pass():
    findings = run_all(load("blind_no_citation_nodes"), [detect_citation_identity])
    assert [f.verdict for f in findings] == [Verdict.UNKNOWN]
    assert findings[0].blocking, "UNKNOWN must block; only PASS is green"


@pytest.mark.parametrize(
    "label",
    [
        "nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt",
        "12AC8C22-018A-4104-A247-D81C37BDB292",
        "urn:flm:doc:99",
        "a3f9c1d02b47e85a6f10bc93",  # 24-char bare hex, no dashes
        "",
    ],
)
def test_identifier_shaped_labels_all_fail(label):
    raw = json.loads((FIXTURES / "observed_citation_uuid.json").read_text())
    raw["nodes"][1]["text"] = label
    finding = detect_citation_identity(Snapshot.from_dict(raw))
    assert finding.verdict is Verdict.FAIL, f"{label!r} should not read as a document name"


@pytest.mark.parametrize(
    "label",
    ["SKF 6205 bearing manual", "GS10 VFD user guide", "Conveyor CV-101 nameplate"],
)
def test_document_names_pass(label):
    """The negative control: the detector must not simply fail everything."""
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    raw["nodes"][1]["text"] = label
    assert detect_citation_identity(Snapshot.from_dict(raw)).verdict is Verdict.PASS


# --------------------------------------------------------------------------
# S3-03 — one fact, rendered once
# --------------------------------------------------------------------------


def test_repetition_detector_fires_on_the_observed_four_renderings():
    finding = detect_identifier_repetition(load("observed_identifier_repetition"))
    assert finding.verdict is Verdict.FAIL
    assert "4x" in " ".join(finding.evidence), finding.evidence


def test_repetition_detector_passes_when_rendered_once():
    finding = detect_identifier_repetition(load("repaired_identifier"))
    assert finding.verdict is Verdict.PASS, finding.summary


def test_repetition_is_matched_on_normalised_text():
    """Whitespace and case must not let a repeat hide."""
    raw = json.loads((FIXTURES / "repaired_identifier.json").read_text())
    raw["nodes"][1]["text"] = "  sensor v0   OVERNIGHT 2026-08-28 "
    assert detect_identifier_repetition(Snapshot.from_dict(raw)).verdict is Verdict.FAIL


def test_all_empty_context_labels_is_unknown_not_pass():
    raw = json.loads((FIXTURES / "repaired_identifier.json").read_text())
    for node in raw["nodes"]:
        node["text"] = ""
    assert detect_identifier_repetition(Snapshot.from_dict(raw)).verdict is Verdict.UNKNOWN


# --------------------------------------------------------------------------
# E-2 — grounded and ungrounded must be distinguishable
# --------------------------------------------------------------------------


def test_groundedness_detector_fires_when_no_basis_is_declared():
    finding = detect_groundedness_signal(load("observed_no_groundedness"))
    assert finding.verdict is Verdict.FAIL
    assert len(finding.evidence) == 2, finding.evidence


def test_groundedness_detector_fires_when_declared_but_rendered_identically():
    """The half-fix: markup says two things, the screen shows one."""
    finding = detect_groundedness_signal(load("declared_but_identical_groundedness"))
    assert finding.verdict is Verdict.FAIL
    assert "identical visual treatment" in finding.summary


def test_groundedness_detector_passes_when_declared_and_distinct():
    finding = detect_groundedness_signal(load("repaired_groundedness"))
    assert finding.verdict is Verdict.PASS, finding.summary


def test_an_invalid_basis_value_fails():
    """The real attribute is data-basis-kind (parts.tsx:144), not an invented one."""
    raw = json.loads((FIXTURES / "repaired_groundedness.json").read_text())
    bases = [n for n in raw["nodes"] if n["attrs"].get("data-part-type") == "evidence_basis"]
    assert bases, "fixture no longer contains an evidence_basis part"
    bases[0]["attrs"]["data-basis-kind"] = "probably"
    assert detect_groundedness_signal(Snapshot.from_dict(raw)).verdict is Verdict.FAIL


def test_fixtures_use_markup_the_product_actually_emits():
    """Guard against the failure this package already made once.

    An earlier draft keyed every detector on invented `data-fl-*` markers. The
    app emits none of them, so the suite would have been green forever against
    a vocabulary only the tests spoke. Anchors are verified against
    packages/factorylm-ui/src/parts.tsx and Conversation.tsx.
    """
    real_anchors = {"data-part-type", "data-context-site", "class", "data-parent",
                    "data-source-id", "data-basis-kind", "data-authorized"}
    for path in FIXTURES.glob("*.json"):
        for node in json.loads(path.read_text())["nodes"]:
            for key in node.get("attrs", {}):
                assert key in real_anchors, (
                    f"{path.name}: {key!r} is not markup the product emits — "
                    "a fixture in an invented vocabulary tests nothing"
                )


# --------------------------------------------------------------------------
# Snapshot contract — provenance is not decoration
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mutate,expect",
    [
        (lambda r: r.update(buildSha="not-a-sha"), "buildSha"),
        (lambda r: r.pop("buildSha"), "buildSha"),
        (lambda r: r.update(schemaVersion=99), "schemaVersion"),
        (lambda r: r.update(surface="desktop"), "surface"),
        (lambda r: r.update(nodes=[]), "no nodes"),
    ],
)
def test_snapshot_refuses_an_unusable_snapshot(mutate, expect):
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    mutate(raw)
    with pytest.raises(SnapshotError, match=expect):
        Snapshot.from_dict(raw)


def test_a_snapshot_without_a_build_sha_cannot_produce_a_verdict():
    """938 captures in docs/promo-screenshots/ are bound to no commit. Not again."""
    raw = json.loads((FIXTURES / "observed_citation_uuid.json").read_text())
    raw["buildSha"] = "0" * 39  # one char short
    with pytest.raises(SnapshotError):
        Snapshot.from_dict(raw)
