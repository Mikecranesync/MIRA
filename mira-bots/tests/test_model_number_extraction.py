"""Regression tests for _looks_like_model_number.

Bug 2 (2026-05-12): fault codes like 'f0004' were being captured as model
numbers because they contain both letters and digits.  The function must
skip tokens that look like single-letter fault codes (F/E/A + 2-5 digits)
while still accepting real model numbers (GS20, FC-302, FR-F800, etc.).
"""

import pytest
from shared.response_formatter import _looks_like_model_number


@pytest.mark.parametrize(
    "text,expected",
    [
        # Real model numbers — must be returned
        ("GS20 OC fault", "GS20"),
        ("PF525 showing F004", "PF525"),
        ("FC-302 alarm", "FC-302"),
        ("VLT-FC302", "VLT-FC302"),
        ("FR-F800 fault", "FR-F800"),
        ("X3", "X3"),
        ("ACS580 ground fault", "ACS580"),
        # Fault-code-shaped tokens — must NOT be returned as model numbers
        ("f0004", ""),
        ("F004", ""),
        ("F30001", ""),
        ("E001", ""),
        ("A123", ""),
        # The actual bug case: PowerFlex 525 + 5-digit fault code
        # No mixed-letter+digit token exists ("powerflex" letters only,
        # "525" digits only, "f0004" skipped as fault code), so empty.
        ("I have a powerflex 525 and it has it called f0004", ""),
        # Pure text / digits — no model number
        ("the safety relay tripped", ""),
        ("525", ""),
    ],
)
def test_model_number_extraction(text: str, expected: str) -> None:
    assert _looks_like_model_number(text) == expected
