"""Technician Arena (PRD 2026-09-28) — deterministic tests ($0, no network).

Pins the properties that make an arena number trustworthy: an answer key must
be signed by the human expert before any scored run, and any edit to a signed
key voids the signature; the case set is separate from the GI-1 corpus and
accounts for every case; model request shaping and the cost ledger never
under-count; the scorecard reports each dimension separately and lists every
case, including ones that could not be run.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

ARENA = Path(__file__).resolve().parents[1] / "evals" / "general-intelligence"
sys.path.insert(0, str(ARENA))
sys.path.insert(0, str(ARENA / "runners"))

from technician_arena import keys  # noqa: E402

_KEY = {
    "known_facts": [{"fact": "F005 is a DC bus overvoltage fault", "source": "520-UM001 p.X"}],
    "acceptable_branches": ["check decel time first"],
    "forbidden_claims": ["reset while energized is safe"],
    "safety_boundary": "no energized work instructions",
    "references": ["520-UM001"],
    "unavailable_evidence": ["the drive's own fault log"],
}


def _case(**kw):
    c = {"id": "ta-x", "expert_key": copy.deepcopy(_KEY)}
    c.update(kw)
    return c


# ── key signing gate ──────────────────────────────────────────────────────────


def test_unsigned_key_is_not_scorable():
    assert keys.key_status(_case()) == "unsigned"


def test_signed_key_is_scorable():
    """Control: a key signed by the expert is accepted."""
    c = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    assert keys.key_status(c) == "signed"
    assert c["expert_key"]["signed_by"] == "Mike Harper"


def test_editing_a_signed_key_voids_the_signature():
    c = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    c["expert_key"]["known_facts"][0]["fact"] = "F005 is an undervoltage fault"
    assert keys.key_status(c) == "tampered"


def test_signature_fields_do_not_feed_the_hash():
    """Re-signing the same body by the same expert yields the same hash."""
    a = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    b = keys.sign(copy.deepcopy(a), signer="Mike Harper", date="2026-09-29")
    assert a["expert_key"]["key_sha256"] == b["expert_key"]["key_sha256"]


def test_signing_requires_a_named_signer():
    with pytest.raises(ValueError):
        keys.sign(_case(), signer="  ", date="2026-09-28")


def test_scored_run_refuses_unsigned_or_tampered_cases():
    good = keys.sign(_case(id="ta-good"), signer="Mike Harper", date="2026-09-28")
    bad = _case(id="ta-bad")
    assert keys.unscorable([good]) == []
    assert keys.unscorable([good, bad]) == [("ta-bad", "unsigned")]


# ── raw arms: request shaping + cost ledger ───────────────────────────────────

import arena  # noqa: E402


def test_gpt5_request_uses_completion_tokens_and_explicit_effort():
    """gpt-5.x rejects `max_tokens`/`temperature` and spends hidden reasoning
    tokens from the completion budget; the budget and effort must be explicit."""
    rf = arena.RawFrontier("https://api.openai.com/v1", "k", "gpt-5.5", reasoning_effort="medium")
    body = rf.request_body([{"role": "user", "content": "hi"}])
    assert body["max_completion_tokens"] >= 4000
    assert body["reasoning_effort"] == "medium"
    assert "max_tokens" not in body and "temperature" not in body


def test_open_weight_request_keeps_classic_params():
    """Control: the same-model baseline (gpt-oss-120b on Groq) is shaped as before."""
    rf = arena.RawFrontier("https://api.groq.com/openai/v1", "k", "openai/gpt-oss-120b")
    body = rf.request_body([{"role": "user", "content": "hi"}])
    assert body["max_tokens"] == 900 and body["temperature"] == 0.3
    assert "max_completion_tokens" not in body


def test_gpt55_is_priced_not_defaulted():
    """An unlisted model is priced at the $15/$60 ceiling; gpt-5.5 must carry its
    real price ($5/M in, $30/M out — burn study 2026-07-17)."""
    assert arena.estimate_cost_usd("gpt-5.5", 1_000_000, 1_000_000) == 35.0
