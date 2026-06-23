"""Tests for the Ask-MIRA answer card — the plain-language trust checkpoint."""
from __future__ import annotations

import sys
from pathlib import Path

_EG = Path(__file__).resolve().parents[1]
_ROOT = _EG.parent
for _p in (str(_EG), str(_ROOT / "causality"), str(_ROOT / "factory_context"),
           str(_ROOT / "discovery_corpus" / "scripts"), str(_ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import answer_card as card  # noqa: E402
import build as fc_build  # noqa: E402
import builder as gb  # noqa: E402
import components as comp_mod  # noqa: E402
import explainer as ex  # noqa: E402
import history as hist  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402
import procedures as proc  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE
HISTORY = hist.load_history()


def _card(conflicting=False):
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + FIXTURE.name)
    cmodel = comp_mod.build_causality(fmodel)
    graph = gb.build_evidence_graph(cmodel, know.load_knowledge(), HISTORY, proc.load_procedures())
    conv = next(a for a in cmodel.assets() if comp_mod.classify_asset(a) == "conveyor")
    obs = ex.observe(cmodel, "photoeye_blocked", conv.uns_path, conflicting=conflicting)
    exp = ex.explain_cause(graph, "line_blocked", obs.line_uns, obs, HISTORY)
    return card.render_card(exp, graph)


def test_card_has_all_nine_sections():
    c = _card()
    for section in card.REQUIRED_SECTIONS:
        assert section in c, "missing card section: %s" % section


def test_card_is_plain_language_not_a_uns_wall():
    c = _card()
    # friendly tag names appear; the raw slugged path does not dominate the FOR section
    assert "Photoeye blocked: TRUE" in c
    assert "Outfeed count:" in c
    assert "Most likely cause:  Photoeye blocked / fouled" in c
    assert "Confidence:         HIGH" in c


def test_card_states_what_needs_review():
    c = _card()
    assert "inferred component" in c
    assert "most likely hypothesis" in c


def test_card_shows_history_in_plain_language():
    c = _card()
    assert "Seen 3 time(s) before" in c
    assert "Cleaned sensor lens" in c


def test_card_surfaces_contradiction_when_present():
    c = _card(conflicting=True)
    # the AGAINST section is populated and the review note calls it out
    assert "Evidence AGAINST:" in c
    assert "None found" not in c.split("Evidence AGAINST:")[1].split("Manuals")[0]
    assert "lowered by contradicting evidence" in c


def test_card_is_deterministic():
    assert _card() == _card()
