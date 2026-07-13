"""LAYER 1 — free deterministic render tests over the frozen document corpus.

Replays every frozen structured interpretation (the golden graphs in
``printsense/benchmarks/_brief_eval/``) through the technician renderer and asserts
the presentation contract. NO model calls, NO network — runs on every PR.

Covered (per the harness spec): completeness, plain-English formatting, exact-map
preservation, uncertainty surfaced, safety wording, no invented voltage, no vague
destination, no cross-case hallucination.
"""

import pytest

pytest.importorskip("pydantic")

from printsense import render  # noqa: E402
from printsense.harness import asserts, corpus  # noqa: E402

CASES = corpus.cases_with_graph()
IDS = [c.name for c in CASES]

assert CASES, "no frozen corpus graphs found — check printsense/benchmarks/corpus_manifest.json"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_default_is_plain_english_not_a_tag_header(case):
    g = case.graph()
    text = render.format_graph_for_telegram(g)
    if g.brief and g.brief.sheet_title:
        assert not text.splitlines()[0].startswith("📐")  # plain title, not the raw package header
    assert text.strip()  # never empty


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_completeness_meets_min_signals(case):
    g = case.graph()
    if not (g.brief and g.brief.sheet_title):
        pytest.skip(f"{case.name}: no brief")
    assert len(g.brief.key_signals) >= case.min_signals, (
        f"{case.name}: {len(g.brief.key_signals)} signals < expected {case.min_signals}"
    )


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_exact_map_preserves_designations(case):
    g = case.graph()
    mp = render.format_map_for_telegram(g)
    for e in (g.devices + g.cables)[:10]:
        if e.tag and e.tag.upper() != "UNREADABLE":
            assert e.tag in mp, f"{case.name}: exact tag {e.tag} missing from the map"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_uncertainty_is_surfaced_never_hidden(case):
    g = case.graph()
    text = render.format_graph_for_telegram(g)
    if g.brief and g.brief.unresolved_items:
        assert "Couldn't confirm" in text  # visible in the DEFAULT, not only the map
    if case.degraded:  # a degraded/incomplete input must stay honest, not fabricate
        assert g.brief and g.brief.unresolved_items, f"{case.name}: degraded input has no unresolved items"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_safety_measurement_closing_present(case):
    g = case.graph()
    if not (g.brief and g.brief.sheet_title):
        pytest.skip(f"{case.name}: no brief")
    assert render._CLOSING in render.format_graph_for_telegram(g)


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_no_invented_voltage(case):
    g = case.graph()
    bad = asserts.unsupported_voltages(g)
    assert not bad, f"{case.name}: brief states voltage(s) {bad} not supported by the graph evidence"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_no_vague_external_destination(case):
    assert not asserts.says_external(case.graph()), f"{case.name}: brief uses vague 'external'"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_no_cross_case_hallucination(case):
    if not case.forbid_tokens:
        pytest.skip(f"{case.name}: no forbidden tokens")
    hits = asserts.forbidden_hits(case.graph(), case.forbid_tokens)
    assert not hits, f"{case.name}: leaked forbidden token(s) {hits}"


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_routing_expectation_recorded(case):
    assert case.routing in ("electrical_print", "nameplate")  # the routing the E2E layer will assert
