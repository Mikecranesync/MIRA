"""
Regression test suite for known hallucinations.

These tests assert that a future evidence_binding_guard function will correctly
flag specific hallucinated claims that appear in known-bad responses. The guard
does not exist yet; tests are marked skip until it is built.

The known_hallucinations.json fixture file contains the four permanent bad cases:
- Case 05: K1/K2 structural misunderstanding
- Case 05_a: Control transformer fabrication (eliminated by OCR in B)
- Case 20: XC00 fabrication (eliminated by OCR, but mutated to XC90 in B)
- Case 20_b: XC90 propagation error (from OCR proxy)

When evidence_binding_guard() is implemented, each test loads a case and verifies
that the guard flags the hallucinated claim.
"""

import json
import os

import pytest


def load_known_hallucinations():
    """Load the known_hallucinations.json fixture."""
    fixture_path = os.path.join(os.path.dirname(__file__), "known_hallucinations.json")
    with open(fixture_path, "r") as f:
        return json.load(f)


def evidence_binding_guard(response_text: str, legible_tokens: set[str]):
    """
    Placeholder for the evidence-binding guard.

    Args:
        response_text: Full translator response (markdown or plain text).
        legible_tokens: Set of legible identifiers extracted by OCR.

    Returns:
        list[str]: Flagged assertions (quotes from response_text) not grounded
                   in legible_tokens.

    Raises:
        NotImplementedError: Until the guard is built.
    """
    raise NotImplementedError(
        "evidence_binding_guard not yet implemented. "
        "Expected behavior: identify claimed identifiers (connectors, component "
        "names, part numbers) in response_text and flag those not in legible_tokens."
    )


@pytest.mark.skip(
    reason="evidence-binding guard not built yet — these are the known-bad cases "
    "it MUST flag when it lands"
)
def test_case_05_k1_k2_mislabel():
    """Case 05: K1/K2 structural misunderstanding should be flagged."""
    fixtures = load_known_hallucinations()
    case = next((c for c in fixtures["cases"] if c["case_id"] == "05"), None)
    assert case is not None, "Case 05 not found in fixtures"

    assert case["hallucinated_claim"], "fixture must record the known-bad claim"
    # Legible tokens from a real print scan (wire-number labels K1, K2 visible)
    legible_tokens = {"K1", "K2", "CR"}

    # Simulated response that makes the bad claim
    response_text = (
        "The control relay CR energizes two separate contactor coils: "
        "K1/K2 are separate contactor coils energized by CR."
    )

    # When guard is built, it should flag the claim
    # because K1/K2 are wire-numbers, not separate coils.
    # (Guard will need semantic understanding or a knowledge base for this.)
    flagged = evidence_binding_guard(response_text, legible_tokens)
    assert any("K1/K2 are separate contactor coils" in flag for flag in flagged), (
        f"Guard should flag the K1/K2 fabrication. Got: {flagged}"
    )


@pytest.mark.skip(
    reason="evidence-binding guard not built yet — these are the known-bad cases "
    "it MUST flag when it lands"
)
def test_case_05a_control_transformer_fabrication():
    """Case 05_a: Control transformer fabrication should be flagged."""
    fixtures = load_known_hallucinations()
    case = next((c for c in fixtures["cases"] if c["case_id"] == "05_a"), None)
    assert case is not None, "Case 05_a not found in fixtures"

    assert case["hallucinated_claim"], "fixture must record the known-bad claim"
    # OCR extracted "C.T." from the print
    legible_tokens = {"C.T.", "current", "transformers", "power"}

    # Simulated response that makes the bad claim
    response_text = "A control transformer supplies control power to the circuit."

    # When guard is built, it should flag "control transformer" because:
    # - OCR shows "C.T." (which stands for "current transformers" per the print)
    # - The claim fabricates "control transformer" without textual support
    flagged = evidence_binding_guard(response_text, legible_tokens)
    assert any("control transformer" in flag.lower() for flag in flagged), (
        f"Guard should flag the fabricated 'control transformer'. "
        f"OCR provided 'C.T.', which the print explains as 'current transformers'. "
        f"Got: {flagged}"
    )


@pytest.mark.skip(
    reason="evidence-binding guard not built yet — these are the known-bad cases "
    "it MUST flag when it lands"
)
def test_case_20_xc00_fabrication():
    """Case 20: Fabricated XC00 connector should be flagged."""
    fixtures = load_known_hallucinations()
    case = next((c for c in fixtures["cases"] if c["case_id"] == "20"), None)
    assert case is not None, "Case 20 not found in fixtures"

    assert case["hallucinated_claim"], "fixture must record the known-bad claim"
    # Legible connectors from the print
    legible_tokens = {"XC45", "XC46", "XC47", "XC60", "25A", "25B"}

    # Simulated response claiming a non-existent connector
    response_text = "Connector XC00 provides the main power distribution to the motor starter."

    # When guard is built, it should flag the claim
    # because "XC00" is not in legible_tokens.
    flagged = evidence_binding_guard(response_text, legible_tokens)
    assert any("XC00" in flag for flag in flagged), (
        f"Guard should flag 'XC00', which is not in legible tokens. "
        f"Only {legible_tokens} are visible. Got: {flagged}"
    )


@pytest.mark.skip(
    reason="evidence-binding guard not built yet — these are the known-bad cases "
    "it MUST flag when it lands"
)
def test_case_20b_xc90_propagation():
    """Case 20_b: OCR proxy hallucination XC90 should be flagged."""
    fixtures = load_known_hallucinations()
    case = next((c for c in fixtures["cases"] if c["case_id"] == "20_b"), None)
    assert case is not None, "Case 20_b not found in fixtures"

    assert case["hallucinated_claim"], "fixture must record the known-bad claim"
    # Legible connectors (the truth)
    legible_tokens = {"XC45", "XC46", "XC47", "XC60", "25A", "25B"}
    # Note: "XC90" is NOT in legible_tokens; it was returned by the OCR proxy
    # but does not actually exist on the print.

    # Simulated response that repeats the OCR proxy error
    response_text = (
        "The signal conditioning module receives input from connector XC90, "
        "which interfaces with the temperature sensor."
    )

    # When guard is built, it should flag "XC90" because it is not in the
    # real set of legible connectors. This would catch the error-propagation case.
    flagged = evidence_binding_guard(response_text, legible_tokens)
    assert any("XC90" in flag for flag in flagged), (
        f"Guard should flag 'XC90', which is not in the real legible tokens. "
        f"Legible: {legible_tokens}. Got: {flagged}"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
