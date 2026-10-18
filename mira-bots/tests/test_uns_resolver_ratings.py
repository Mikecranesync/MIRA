"""A nameplate rating is never a model number.

Observed (Codex answer-quality audit, 2026-10-16; reproduced on main 03cc6bf93):
"GS10 VFD overcurrent fault on startup, motor 5HP 460V" resolved model=5HP, and
the spaced form "motor 5 HP 460 V" resolved model=460 (the supply voltage). A
follow-up "motor is 25HP" after an A1000 turn replaced model A1000 with 25HP.
Downstream, retrieval filters manuals by the resolved model, so a rating read as
a model throws away the correct manual.

Ratings stay facts in the message; they just can't become the equipment model.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgres://test:test@localhost/test")

from shared import uns_resolver  # noqa: E402
from shared.uns_resolver import resolve_uns_path  # noqa: E402


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    # Pin the resolver to its offline floor: no DB enrichment can change the model.
    monkeypatch.setattr(uns_resolver, "_enrich_from_db", lambda ctx, tenant_id: ctx)


@pytest.mark.parametrize(
    ("message", "expected_model"),
    [
        # Bug cases: a rating was taken as the model.
        ("GS10 VFD overcurrent fault on startup, motor 5HP 460V", "GS10"),
        ("GS10 VFD overcurrent fault on startup, motor 5 HP 460 V", "GS10"),
        ("GS10 trips on decel, 2 hp motor, 230 VAC supply", "GS10"),
        ("A1000 OV fault, 25HP fan, 60Hz", "A1000"),
        ("GS10 VFD overcurrent fault, motor 12 A 460 V", "GS10"),
        ("GS10 heater circuit 500 W", "GS10"),
        # Controls: real models next to ratings must survive.
        ("PowerFlex 525 a few years old keeps tripping", "525"),
        ("PowerFlex 525 F004 undervoltage", "525"),
        ("PowerFlex 525 tripping on startup, motor 10HP 480V", "525"),
        ("Yaskawa GA500 ground fault, 25 HP fan", "GA500"),
        ("ABB ACS580 fault 2310, 7.5kW pump", "ACS580"),
    ],
)
def test_rating_is_not_resolved_as_model(message, expected_model):
    assert resolve_uns_path(message).model == expected_model


def test_real_model_shaped_like_a_rating_is_kept():
    # Fluke 87V: the one rating-shaped model_number in the staging corpus.
    assert resolve_uns_path("my Fluke 87V shows OL on the motor leads").model == "87V"


def test_rating_follow_up_keeps_the_established_model():
    first = resolve_uns_path("A1000 faulting OV during decel, high-inertia fan application")
    assert first.model == "A1000"  # precondition
    follow = resolve_uns_path("Decel ramp is 10 seconds, motor is 25HP", prior_ctx=first)
    assert follow.model == "A1000"
    assert follow.manufacturer == "Yaskawa"


def test_explicit_model_change_still_replaces_the_prior_model():
    first = resolve_uns_path("A1000 faulting OV during decel")
    assert first.model == "A1000"  # precondition
    follow = resolve_uns_path("actually it's a Yaskawa V1000", prior_ctx=first)
    assert follow.model == "V1000"
