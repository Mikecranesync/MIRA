"""LAYER 2 — metamorphic image tests.

FREE part (every PR): the transforms produce valid images and the no-invention
comparator flags a new wire/voltage — hermetic, no model calls.

PAID part (nightly, gated by PRINTSENSE_PAID=1 + PRINTSENSE_CORPUS_IMAGES): apply
each transform to the pinned corpus image, interpret it, and assert against the
frozen golden graph that nothing was invented and facts are materially equivalent
or less confident.
"""

import io
import os

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from PIL import Image  # noqa: E402

from printsense.harness import corpus  # noqa: E402
from printsense.harness import metamorphic as M  # noqa: E402
from printsense.models import PrintSynthGraph  # noqa: E402

PAID = os.getenv("PRINTSENSE_PAID") == "1"


def _img_bytes(w: int = 1200, h: int = 900) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="JPEG")
    return buf.getvalue()


# ── FREE: transforms produce valid images ─────────────────────────────────────


@pytest.mark.parametrize("name", list(M.TRANSFORMS))
def test_transform_produces_a_valid_image(name):
    out = M.TRANSFORMS[name](_img_bytes())
    im = Image.open(io.BytesIO(out))
    im.verify()
    assert min(Image.open(io.BytesIO(out)).size) > 0


try:  # Hypothesis: any rotation/downscale parameter yields a decodable image
    from hypothesis import given, settings
    from hypothesis import strategies as st

    @settings(max_examples=12, deadline=None)
    @given(deg=st.floats(min_value=-20, max_value=20), px=st.integers(min_value=400, max_value=1500))
    def test_rotate_downscale_any_param_valid(deg, px):
        b = _img_bytes()
        Image.open(io.BytesIO(M.rotate(deg)(b))).verify()
        Image.open(io.BytesIO(M.downscale(px)(b))).verify()
except ImportError:  # Hypothesis optional — the parametrized transforms still run
    pass


# ── FREE: the comparator catches invention ────────────────────────────────────


def test_comparator_flags_new_wire_and_voltage():
    orig = PrintSynthGraph.model_validate(
        {"cables": [{"tag": "-W5497"}], "power_domains": [{"tag": "24VDC bus", "detail": "24VDC"}]}
    )
    trans = PrintSynthGraph.model_validate(
        {
            "cables": [{"tag": "-W5497"}, {"tag": "-W9999"}],
            "brief": {"sheet_title": "x", "key_signals": [{"signal": "y", "tag": "-W9999"}], "safety_context": "480V present"},
        }
    )
    r = M.compare(orig, trans)
    assert "W9999" in r.new_wires  # canonical form (IEC prefix folded); invention still flagged
    assert "480" in r.new_voltages
    assert not r.no_invention()


def test_comparator_passes_on_degraded_subset():
    orig = PrintSynthGraph.model_validate(
        {"cables": [{"tag": "-W5497", "confidence": 0.9}, {"tag": "-W5469", "confidence": 0.9}]}
    )
    trans = PrintSynthGraph.model_validate({"cables": [{"tag": "-W5497", "confidence": 0.5}]})  # lost one, lower conf
    r = M.compare(orig, trans)
    assert r.no_invention() and r.equivalent_or_less_confident()


# ── rail-aware precision: notation variants of the SAME designation don't count as
#    invention, but genuinely-new designations still do (gate strictness unchanged) ──


def test_rail_notation_variants_are_equivalent():
    """The ONLY proven equivalence: the bare rail id `-X24`/`+X24`/`X24`/`X24V` are the
    same rail. A transform spelling it any of those ways against a golden bare rail must
    NOT be flagged. (A *suffixed* form like `X24V.41` is NOT bare — see the next test.)"""
    golden = PrintSynthGraph.model_validate({"power_domains": [{"tag": "-X24"}, {"tag": "-X0"}]})
    trans = PrintSynthGraph.model_validate(
        {"power_domains": [{"tag": "X24"}, {"tag": "+X24V"}, {"tag": "X0V"}]}  # notation variants
    )
    r = M.compare(golden, trans)
    assert r.new_facts == set(), f"rail notation wrongly flagged: {r.new_facts}"
    assert r.no_invention()


def test_golden_rail_voltage_makes_true_reading_not_invention():
    """With the 24VDC rail RECORDED in the golden, a transform reading 24VDC is a true
    fact, not an invented voltage."""
    golden = PrintSynthGraph.model_validate(
        {"power_domains": [{"tag": "24VDC", "type": "24V DC control supply", "evidence": "24VDC panel supply"}]}
    )
    trans = PrintSynthGraph.model_validate(
        {"brief": {"sheet_title": "x", "safety_context": "24VDC control supply present", "key_signals": []}}
    )
    r = M.compare(golden, trans)
    assert r.new_voltages == set(), f"true rail voltage wrongly flagged: {r.new_voltages}"
    assert r.no_invention()


def test_gate_still_flags_genuinely_new_designations():
    """The canonicalization is precision only — a genuinely new wire, terminal, or
    voltage is STILL flagged. (Guards against silently weakening the gate.)"""
    golden = PrintSynthGraph.model_validate(
        {"terminals": [{"tag": "-X24"}], "cables": [{"tag": "-W5497"}], "power_domains": [{"tag": "24VDC"}]}
    )
    trans = PrintSynthGraph.model_validate(
        {
            "terminals": [{"tag": "-X24"}, {"tag": "-X99"}],  # new terminal (not a notation variant)
            "cables": [{"tag": "-W5497"}, {"tag": "-W9999"}],  # new wire
            "brief": {"sheet_title": "x", "safety_context": "480VAC present", "key_signals": []},  # new voltage
        }
    )
    r = M.compare(golden, trans)
    assert "X99" in r.new_terminals
    assert "W9999" in r.new_wires
    assert "480" in r.new_voltages
    assert not r.no_invention()


# ── PRD §D regressions: the gate MUST catch these real fabrication classes ─────


@pytest.mark.parametrize(
    "golden_tag,fab_tag,section",
    [
        ("-W5497", "-WK902", "cables"),  # THE flagship historical misread (interpret.py/grader.py cite it)
        ("-W5469", "-WK901", "cables"),
        ("-W5497", "-WK5497", "cables"),  # one glued letter, same digits — the sneakiest near-miss
        ("-18/X2KL:1", "-18/X2KL:8", "terminals"),  # complex terminal — wrong thermal-switch channel
        ("-21/A13", "-21/A14", "devices"),  # device tag — wrong opto module (upstream vs downstream)
    ],
)
def test_gate_flags_fabricated_designation_swap(golden_tag, fab_tag, section):
    """A degraded read that fabricates a WRONG designation next to the real one (the exact
    class this harness exists to catch — incl. the named `-W5497 → -WK902`) is flagged."""
    golden = PrintSynthGraph.model_validate({section: [{"tag": golden_tag}]})
    trans = PrintSynthGraph.model_validate({section: [{"tag": golden_tag}, {"tag": fab_tag}]})
    r = M.compare(golden, trans)
    assert not r.no_invention(), f"{fab_tag} (vs {golden_tag}) NOT flagged — gate blind to this fabrication"
    assert M._canon_desig(fab_tag) in r.new_facts


def test_gate_flags_new_offpage_crossref():
    """A fabricated off-page cross-reference (signal reassigned to the wrong DA6 channel)."""
    golden = PrintSynthGraph.model_validate({"off_page_references": [{"tag": "DA6.1"}]})
    trans = PrintSynthGraph.model_validate({"off_page_references": [{"tag": "DA6.1"}, {"tag": "DA6.5"}]})
    r = M.compare(golden, trans)
    assert "DA6.5" in r.new_xrefs
    assert not r.no_invention()


def test_suffixed_rail_terminals_stay_distinct():
    """X24V.41 and X24V.42 are DIFFERENT terminals on the 24 V rail — the rail fold must NOT
    collapse them (the over-collapse the hardening fixed; it folds only the BARE rail id)."""
    golden = PrintSynthGraph.model_validate({"terminals": [{"tag": "X24V.41"}]})
    trans = PrintSynthGraph.model_validate({"terminals": [{"tag": "X24V.41"}, {"tag": "X24V.42"}]})
    r = M.compare(golden, trans)
    assert "X24V.42" in r.new_facts
    assert not r.no_invention()


# ── PAID: real metamorphic interpretation (nightly) ───────────────────────────

_PAID_CASES = [c for c in corpus.cases_with_graph() if not c.degraded]
_PARAMS = [(c, t) for c in _PAID_CASES for t in M.TRANSFORMS]


@pytest.mark.skipif(not PAID, reason="paid metamorphic matrix — set PRINTSENSE_PAID=1 (nightly)")
@pytest.mark.parametrize("case,tname", _PARAMS, ids=[f"{c.name}-{t}" for c, t in _PARAMS])
def test_metamorphic_no_invention(case, tname):
    img = case.image_bytes_verified()
    if img is None:
        pytest.skip("corpus image not available — set PRINTSENSE_CORPUS_IMAGES")
    from printsense import interpret

    transformed = interpret.interpret_print([(M.TRANSFORMS[tname](img), "image/jpeg")], preprocess=True)
    r = M.compare(case.graph(), transformed)
    assert r.no_invention(), f"{case.name}/{tname} INVENTED wires={r.new_wires} terms={r.new_terminals} volts={r.new_voltages}"
    assert r.equivalent_or_less_confident(), (
        f"{case.name}/{tname}: overlap {r.overlap_ratio}, conf {r.conf_transform} vs original {r.conf_original}"
    )
