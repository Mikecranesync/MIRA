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
import re
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
    evidence = " ".join(finding.evidence)
    assert "4 distinct site(s)" in evidence, evidence
    for site in ("header-title", "breadcrumb", "machine-pill", "composer-using"):
        assert site in evidence, f"{site} missing from the evidence: {evidence}"


def test_repetition_detector_passes_when_rendered_once():
    finding = detect_identifier_repetition(load("repaired_identifier"))
    assert finding.verdict is Verdict.PASS, finding.summary


def test_repetition_is_matched_on_normalised_text():
    """Whitespace and case must not let a second SITE hide."""
    raw = json.loads((FIXTURES / "repaired_identifier.json").read_text())
    raw["nodes"] += [
        {"id": "header", "tag": "header", "text": "",
         "attrs": {"class": "fl-shell__header"}, "rendered": True, "hittable": True},
        # Rendered BARE here, with different case and spacing.
        {"id": "header-title", "tag": "h1", "parentId": "header",
         "text": "  sensor v0   OVERNIGHT 2026-08-28 ",
         "attrs": {"class": "fl-shell__title"}, "rendered": True, "hittable": True},
    ]
    assert detect_identifier_repetition(Snapshot.from_dict(raw)).verdict is Verdict.FAIL


def test_known_blind_spot_identifier_never_rendered_bare():
    """A limit worth naming rather than discovering.

    Containment matching needs SOME component to render the identifier on its
    own, because the candidates are whole node texts. If every component wrapped
    it — "Notebooks / X", "X · confirmed", "Using: X" — and none rendered a bare
    "X", the shared substring is nobody's full text and the repetition is
    missed.

    The observed defect does not have this shape (the header title renders it
    bare, which is why the detector fires). Closing it means common-substring
    extraction across nodes, which trades this false negative for false
    positives on incidental shared words. That trade has not been made, so the
    blind spot is asserted here: this test documents current behaviour and will
    fail the day someone closes it, which is the prompt to delete it.
    """
    raw = json.loads((FIXTURES / "repaired_identifier.json").read_text())
    for node in raw["nodes"]:
        if node["id"] == "machine-pill":
            node["text"] = "Sensor v0 overnight 2026-08-28 · confirmed"
    raw["nodes"] += [
        {"id": "composer", "tag": "form", "text": "",
         "attrs": {"class": "fl-composer"}, "rendered": True, "hittable": True},
        {"id": "composer-using", "tag": "p", "parentId": "composer",
         "text": "Using: Sensor v0 overnight 2026-08-28",
         "attrs": {"class": "fl-card__meta"}, "rendered": True, "hittable": True},
    ]
    finding = detect_identifier_repetition(Snapshot.from_dict(raw))
    assert finding.verdict is Verdict.PASS, (
        "this documents a MISS, not a success — two components wrap one identifier "
        "and neither renders it bare. If this now FAILs, the blind spot was closed "
        "and this test should be deleted."
    )


def test_one_component_repeating_down_a_list_is_not_a_defect():
    """The regression this detector nearly shipped.

    Each turn is an `li.fl-turn` carrying its own
    `.fl-turn__head > .fl-card__meta` context line, so a three-turn thread
    renders that line three times — and renders a BOUND machine's name three
    times too. An earlier version counted carrier NODES and so would have
    failed the REPAIRED product: fix D-5 by binding a machine, and the gate
    stays red. A gate that fails the repaired product gets muted, which is the
    same death as a gate that cannot fail, reached from the other side.

    Spatial repetition (four components, one moment) is the defect. Temporal
    repetition (one component, once per turn) is a list doing its job.
    """
    finding = detect_identifier_repetition(load("repaired_three_turns_bound_machine"))
    assert finding.verdict is Verdict.PASS, finding.summary + " | " + str(finding.evidence)


def test_the_temporal_fixture_really_does_repeat_the_string():
    """Positive control for the test above: if the fixture did not actually
    render the identifier three times, PASS would prove nothing."""
    snap = load("repaired_three_turns_bound_machine")
    carriers = [n for n in snap.rendered_nodes() if "CV-101 · confirmed" in n.text]
    assert len(carriers) == 3, f"fixture renders it {len(carriers)}x, expected 3"
    from ux_acceptance.derive import site_signature

    assert len({site_signature(snap, n) for n in carriers}) == 1, (
        "the three carriers must share one render site, or this fixture is "
        "testing spatial repetition rather than temporal"
    )


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
    real_anchors = {"data-part-type", "class", "data-source-id",
                    "data-basis-kind", "data-authorized"}
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


# --------------------------------------------------------------------------
# The guard that would have caught the second invented vocabulary.
#
# The fixture-vocabulary check above polices FIXTURE attributes. The anchors
# `derive_role` keys on are a different layer, and that is exactly where the
# second invented vocabulary survived: `data-turn-head` and `data-context-site`
# have zero occurrences in the product, they were the only routes to
# CONTEXT_LABEL, and so the repetition detector could never judge the product —
# it failed closed forever while looking like an extractor problem.
# --------------------------------------------------------------------------


def test_derive_anchors_exist_in_the_product():
    """Every class/attribute the derivation keys on must occur in the app."""
    import subprocess

    from ux_acceptance.derive import DERIVE_ANCHORS

    searched = [str(ROOT / "packages"), str(ROOT / "mira-mobile" / "src")]
    missing = []
    for anchor in DERIVE_ANCHORS:
        hits = subprocess.run(
            ["grep", "-rl", anchor, *searched],
            capture_output=True, text=True,
        ).stdout.strip()
        if not hits:
            missing.append(anchor)
    assert not missing, (
        f"derivation keys on {missing}, which the product never emits — "
        "a detector anchored there can never judge the product"
    )


def test_the_anchor_scan_can_actually_find_things():
    """Positive control. A grep that silently matches nothing would pass the
    test above by finding no anchors to check."""
    import subprocess

    hits = subprocess.run(
        ["grep", "-rl", "fl-turn__head", str(ROOT / "packages")],
        capture_output=True, text=True,
    ).stdout.strip()
    assert hits, "the anchor scan found nothing at all — it is blind, not clean"


# --------------------------------------------------------------------------
# rendered vs hittable — one word was covering two questions
# --------------------------------------------------------------------------


def test_a_node_behind_a_scrim_is_rendered_but_not_reachable():
    """`.fl-scrim` is `position: fixed; inset: 0` and `Overlay.tsx:62` sets
    `inert` only while a modal layer is CLOSED. So with the drawer open the main
    content paints, is not inert, and cannot be touched. Collapsing the two
    fields is how 42 phantom dead controls arrive in a snapshot."""
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    for node in raw["nodes"]:
        node["hittable"] = False
    snap = Snapshot.from_dict(raw)
    assert len(list(snap.rendered_nodes())) == len(raw["nodes"])
    assert list(snap.reachable_nodes()) == []


@pytest.mark.parametrize("field_name", ["rendered", "hittable"])
def test_visibility_has_no_default(field_name):
    """A node the extractor could not measure must not default to visible —
    a partial extraction would make detectors see MORE, not less."""
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    raw["nodes"][0].pop(field_name)
    with pytest.raises(SnapshotError, match=field_name):
        Snapshot.from_dict(raw)


# --------------------------------------------------------------------------
# style capture depth — absent capture is not absent value
# --------------------------------------------------------------------------


def test_a_detector_cannot_read_a_property_that_was_never_captured():
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    snap = Snapshot.from_dict(raw)
    snap.require_style("color")  # captured
    with pytest.raises(SnapshotError, match="border-left-color"):
        snap.require_style("border-left-color")


def test_style_properties_is_required():
    raw = json.loads((FIXTURES / "repaired_citation.json").read_text())
    raw.pop("styleProperties")
    with pytest.raises(SnapshotError, match="styleProperties"):
        Snapshot.from_dict(raw)


def test_parentage_is_not_a_product_attribute():
    """`parentId` is extractor-synthesized, so it lives on the Node and not in
    `attrs` — otherwise the vocabulary guard would need to whitelist it, which
    is a hole in the guard meant to catch invented attributes."""
    raw = json.loads((FIXTURES / "observed_citation_uuid.json").read_text())
    for node in raw["nodes"]:
        assert "data-parent" not in node.get("attrs", {})
    snap = Snapshot.from_dict(raw)
    assert any(n.parent_id for n in snap.nodes), "fixture lost its parentage"


# --------------------------------------------------------------------------
# Coverage: product -> anchor. The direction DERIVE_ANCHORS cannot prove.
#
# The anchor guard proves nothing we key on is invented. It says nothing about
# parts the product renders that we never mapped, and a missed site produces a
# false PASS — strictly worse than the permanent UNKNOWN an invented anchor
# caused, because it reads as a clean screen.
#
# Shape copied from tests/test_architecture.py Contract 5 (`_ONE_PIPELINE_ALLOWLIST`
# at 167, honesty test at 279, checker self-test at 286) rather than invented:
# default-deny scan, honest allowlist, self-test.
# --------------------------------------------------------------------------

INTERACTION_TYPES = ROOT / "packages" / "factorylm-interaction" / "src" / "types.ts"

#: Pinned so a regex that silently degrades to 3-of-23 cannot report "all covered".
EXPECTED_PART_COUNT = 23


def _union_members() -> set[str]:
    """Extract the `type` literals of the closed `InteractionPart` union."""
    src = INTERACTION_TYPES.read_text()
    start = src.index("export type InteractionPart")
    body = src[start : src.index("\n\n", start)]
    return set(re.findall(r'type:\s*"([a-z_]+)"', body))


def test_the_union_extraction_is_not_blind():
    """Three guards, because a derived expectation set is the classic vacuous pass."""
    members = _union_members()
    assert members, "extracted no part types — the scan is blind, not clean"
    assert {"source", "evidence_basis"} <= members, "known members missing from the extraction"
    assert len(members) == EXPECTED_PART_COUNT, (
        f"extracted {len(members)} part types, expected {EXPECTED_PART_COUNT}. Either the "
        "union changed (update the pin deliberately) or the regex degraded silently."
    )


def test_every_part_type_is_mapped_or_has_a_written_reason():
    """Default-deny over the closed vocabulary. A new part type fails the day it lands."""
    from ux_acceptance.derive import PART_OUT_OF_SCOPE, PART_ROLE

    members = _union_members()
    accounted = set(PART_ROLE) | set(PART_OUT_OF_SCOPE)
    unaccounted = members - accounted
    assert not unaccounted, (
        f"part type(s) {sorted(unaccounted)} are rendered by the product and neither "
        "mapped nor declared out of scope — a detector will silently not see them"
    )


def test_the_out_of_scope_list_is_honest():
    """No entry may name a part type the union no longer has."""
    from ux_acceptance.derive import PART_OUT_OF_SCOPE, PART_ROLE

    members = _union_members()
    stale = (set(PART_ROLE) | set(PART_OUT_OF_SCOPE)) - members
    assert not stale, f"declared part type(s) {sorted(stale)} no longer exist in the union"
    for part, reason in PART_OUT_OF_SCOPE.items():
        assert len(reason) > 15, f"{part} has no real reason recorded: {reason!r}"


def test_known_gaps_are_named_rather_than_silent():
    """Five part types render titles that can carry a raw id, and one renders a
    third context site. They are unmapped — recorded as GAPs so the limit is
    stated, not discovered."""
    from ux_acceptance.derive import PART_OUT_OF_SCOPE

    gaps = {p for p, r in PART_OUT_OF_SCOPE.items() if r.startswith("GAP:")}
    assert "artifact" in gaps, "the most likely second home of the E-1 UUID must stay named"
    assert "context_change" in gaps, "the third context site must stay named"


# --------------------------------------------------------------------------
# Residual coverage: text the product renders that nothing classifies.
#
# Union coverage only covers PARTS. ThreadHeader, Sidebar, the composer and the
# breadcrumb render text outside that union — and so does Conversation.tsx:52.
# A list of sites goes stale silently; a residual set grows the moment the
# product does.
# --------------------------------------------------------------------------

#: Node ids in the fixtures whose text derives no role. Pinned deliberately: new
#: unroled text means a screen region nobody has classified, and this names it.
KNOWN_UNROLED = {
    "cite-1-kind", "cite-1-title", "cite-1-loc",  # chip internals, read via the chip
    "header-title", "breadcrumb", "machine-pill", "composer-using", "scope-badge",
    "b1", "b2",  # evidence_basis pills derive EVIDENCE_BASIS via attrs, not text
    # Turn role labels ("You"/"MIRA"/"System") — ROLE_LABEL in Conversation.tsx.
    # Below MIN_IDENTIFIER_LEN and carrying no identifier claim.
    "turn1-role", "turn2-role", "turn3-role",
}


def test_residual_unroled_text_matches_the_pinned_baseline():
    from ux_acceptance.derive import derive_role

    unroled: set[str] = set()
    for path in FIXTURES.glob("*.json"):
        snap = Snapshot.from_dict(json.loads(path.read_text()))
        for node in snap.rendered_nodes():
            if node.text.strip() and derive_role(node, snap) is None:
                unroled.add(node.id)

    new = unroled - KNOWN_UNROLED
    assert not new, (
        f"text nodes {sorted(new)} render text that nothing classifies. Either give "
        "them a role or add them to KNOWN_UNROLED with intent."
    )


# --------------------------------------------------------------------------
# Hard imports. No conditional-import skip anywhere in this suite, by design:
# a governance suite that skips when a dependency is missing reports success
# for a run in which it judged nothing.
# --------------------------------------------------------------------------


def test_every_detector_is_importable_and_callable():
    """The floor. If this cannot run, the suite has no business reporting green."""
    from ux_acceptance.detectors import (
        detect_citation_identity,
        detect_groundedness_signal,
        detect_identifier_repetition,
    )

    for detector in (detect_citation_identity, detect_groundedness_signal,
                     detect_identifier_repetition):
        assert callable(detector), detector
        assert hasattr(detector, "test_id"), f"{detector} declares no acceptance test id"

    finding = detect_citation_identity(load("repaired_citation"))
    assert finding.verdict in (Verdict.PASS, Verdict.FAIL, Verdict.UNKNOWN)


def test_the_suite_contains_no_conditional_skips():
    """Conditional-import skips and unconditional skip marks are banned here.

    Grepping the source is cruder than inspecting collected items, but it
    catches the decorator before it ever runs — and the conftest guard catches
    anything that slips past at runtime. Two layers, because this is the exact
    mechanism behind #3660.
    """
    source = Path(__file__).read_text()
    # Built by concatenation so the literals do not appear in this file and trip
    # the very check they define. `native-fingerprint-wiring.test.ts` solves the
    # same self-reference problem by asserting on exact expressions and saying
    # why in a comment; this is the Python form of that.
    banned = ("import" + "orskip", "pytest." + "skip(", "@pytest.mark." + "skip")
    for token in banned:
        assert token not in source, (
            f"{token!r} appears in this suite. A skipped governance test reports "
            "success for a run in which it judged nothing."
        )
