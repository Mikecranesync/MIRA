"""IDENTIFY_ASSET: the resolver reads the machine the technician actually means.

Piece 3 of the #4465 split. Each case below was reproduced on main 06730e78b /
eb6e2ed2b before the fix (the "today" column), so a green run here is the fix,
not the absence of a bug.
"""

from unittest.mock import patch

import pytest

from shared import uns_resolver
from shared.uns_resolver import resolve_uns_path


@pytest.fixture(autouse=True)
def _offline():
    # The resolver must be right from the alias table alone (uns-compliance §8).
    with patch.object(uns_resolver, "_enrich_from_db", lambda ctx, tenant: ctx):
        yield


@pytest.mark.parametrize(
    "message",
    [
        # today: model GS10
        "Actually sorry, it's a GS20 not a GS10. Same OC fault.",
        # today: model "GS20." (trailing period), family GS10
        "It's not a GS10, it's a GS20. Same OC fault.",
    ],
)
def test_a_negated_model_is_never_the_asked_model(message):
    ctx = resolve_uns_path(message)
    assert ctx.manufacturer == "AutomationDirect"
    assert ctx.model == "GS20"
    assert ctx.product_family == "GS20"
    assert ctx.fault_code == "OC"


@pytest.mark.parametrize(
    ("message", "model"),
    [
        ("Yaskawa A1000 oV", "A1000"),  # today: model None, fault "A1000"
        ("Yaskawa A1000 oV fault during decel", "A1000"),
        ("A1000 oV fault", "A1000"),  # today: fault "A1000"
        ("Yaskawa E1000 oC on start", "E1000"),  # E-pattern would take E1000 as a fault
    ],
)
def test_a_drive_family_name_is_never_read_as_an_alarm_code(message, model):
    ctx = resolve_uns_path(message)
    assert ctx.model == model
    assert (ctx.fault_code or "").upper() not in {"A1000", "E1000"}


def test_a_real_alarm_code_beside_a_family_name_keeps_both():
    # today: fault A0002 but model None — A1000 sat in the alarm pile and was
    # struck from the model candidates along with it.
    ctx = resolve_uns_path("A002 alarm on the Yaskawa A1000")
    assert (ctx.model, ctx.fault_code) == ("A1000", "A0002")


def test_a_trailing_full_stop_is_not_part_of_the_model():
    assert resolve_uns_path("The drive is a GS20.").model == "GS20"
    assert resolve_uns_path("We have a PowerFlex 753.").model == "753"


@pytest.mark.parametrize(
    ("message", "family"),
    [
        ("Yaskawa V1000 oC", "V1000"),  # today: family None
        ("Yaskawa J1000 oL1 trip", "J1000"),
    ],
)
def test_a_model_that_is_itself_a_family_sets_the_family(message, family):
    assert resolve_uns_path(message).product_family == family


def test_a_model_correction_does_not_keep_the_old_family():
    prior = resolve_uns_path("A1000 faulting OV during decel")
    assert prior.product_family == "A1000"
    # today: model V1000 with the A1000 family carried over from the prior turn
    ctx = resolve_uns_path("actually it's a Yaskawa V1000", prior_ctx=prior)
    assert ctx.model == "V1000"
    assert ctx.product_family == "V1000"


def test_a_correction_to_an_unlisted_model_drops_the_old_family():
    # GA800 is not a family name in the alias table, so only the merge rule can
    # stop the A1000 family riding onto it.
    prior = resolve_uns_path("A1000 faulting OV during decel")
    ctx = resolve_uns_path("actually it's a Yaskawa GA800", prior_ctx=prior)
    assert ctx.model == "GA800"
    assert ctx.product_family != "A1000"


# ── Controls: what must keep working ────────────────────────────────────────


@pytest.mark.parametrize(
    ("message", "model", "fault"),
    [
        ("PowerFlex 525 F004", "525", "F0004"),
        ("GS10 CE10 fault", "GS10", "CE10"),
        ("Allen-Bradley PowerFlex 753 F12", "753", "F0012"),
    ],
)
def test_ordinary_models_and_alarm_codes_are_unchanged(message, model, fault):
    ctx = resolve_uns_path(message)
    assert ctx.model == model
    assert ctx.fault_code == fault


def test_same_model_followup_keeps_the_prior_family():
    prior = resolve_uns_path("pf525 F004")
    ctx = resolve_uns_path("it trips again after a minute", prior_ctx=prior)
    assert ctx.model == prior.model
    assert ctx.product_family == prior.product_family
