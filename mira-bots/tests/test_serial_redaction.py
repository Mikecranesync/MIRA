"""Serial-number redaction: behaviour lock for #3305.

`_SERIAL_RE` is applied by `InferenceRouter.sanitize_context()`, which is
default-on for **every** cascade call (`complete(..., sanitize: bool = True)`),
and by the Open WebUI fallback in `rag_worker._call_llm()`. So a false positive
here is not a logging cosmetic — it silently rewrites what the model is asked.

The defect (#3305): the keyword alternation includes the bare prefix `SER`, and
the old pattern paired it with `[:\\s#]*` (zero separators allowed) plus
`[A-Z0-9\\-]{4,20}` (no digit required). "services" therefore parsed as
`SER` + "vices" and was replaced with `[SN]`. "service" is one of the most
common words in maintenance language, so ordinary technician turns reached the
provider mangled:

    "Check the service manual for the PowerFlex 525"
        -> "Check the [SN] manual for the PowerFlex 525"

It also ate hyphenated identifiers (`services-diagnosis` -> `[SN]`), which is
how it was found: `tools/gate7_review.py` reuses these canonical regexes for
egress redaction, so a Gate 7 reviewer received four registry entries all keyed
`[SN]:` and returned two confident, entirely false high-severity findings.

Both directions are locked below. The negative controls are the point: a change
that redacts more is not automatically safer, because over-redaction destroys
the technician's question. Equally, MUST_REDACT must keep passing — a "fix" that
stops redacting real serials has traded one defect for a worse one.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.inference.router import _SERIAL_RE, InferenceRouter  # noqa: E402

# --- Real serials. Every one of these MUST still be redacted. ----------------
MUST_REDACT = [
    ("serial number ABC12345 on the nameplate", "keyword + words + separator"),
    ("S/N ABC123 stamped on the frame", "S/N form"),
    ("SN: 12345678", "colon separator"),
    ("SN12345 is the drive", "no separator, digits present"),
    ("Serial No. 4477-A on the tag", "period after No"),
    ("serial number ABCDEFGH", "digit-LESS serial, separator present"),
    ("s/n 998877", "lowercase"),
    ("SERIAL#77321", "hash separator"),
    ("Serial Number: 8891-KX", "full keyword + colon"),
    ("sn 4001", "short bare form"),
    ("SERIAL-ABCD", "hyphen separator, digit-less — Gate 7 caught this regression"),
    ("SN-ABCD1234", "hyphen separator with digits"),
    ("SN. ABCD1234", "period separator, digits present"),
]

# --- Ordinary maintenance language. NONE of these may be touched. -----------
# Rows 1-5 are the reproduction table from #3305.
MUST_NOT_REDACT = [
    ("The pump is out of service and needs a service call", "#3305 row 1"),
    ("Check the service manual for the PowerFlex 525", "#3305 row 2"),
    ("We service this line every 6 months", "#3305 row 3"),
    ("The conveyor service door interlock is faulted", "#3305 row 4"),
    ("Motor bearing replacement per service bulletin", "#3305 row 5"),
    ("services-diagnosis: path services/diagnosis/", "hyphenated identifier"),
    ("multi-service stack", "compound word"),
    ("the 500 series drive", "series, not serial"),
    ("a serious fault on the line", "serious"),
    ("server rack 12345 in the MDF", "server + a number nearby"),
    ("serviceable parts are listed in section 4", "serviceable"),
    ("Take the line out of service. 12345 units were lost.", "sentence break before digits"),
    ("sermon notes 4455", "unrelated ser- word"),
    # A period after a ser- word is a SENTENCE BREAK, not a serial separator.
    # An earlier revision of this fix treated it as an ordinary separator and
    # swallowed the first word of the next sentence — it reached the staging
    # gate as a groundedness-1 hard fail on the PowerFlex case below.
    ("Check the serial. Replace the unit if damaged.", "sentence break, next word is not serial-shaped"),
    ("Record the serial. PowerFlex 525 fault F004 indicates a ground fault.", "the staging-gate regression"),
    ("See the service manual. F0004 is an overcurrent trip.", "sentence break after service"),
    ("the drive series. Check parameter P047 next.", "sentence break after series"),
    ("PowerFlex 525 F004 ground fault on the output", "no keyword at all"),
    ("The 525 series-drive shows F004", "series- compound"),
]


@pytest.mark.parametrize("text,why", MUST_REDACT, ids=[w for _, w in MUST_REDACT])
def test_real_serials_are_redacted(text: str, why: str) -> None:
    out = _SERIAL_RE.sub("[SN]", text)
    assert "[SN]" in out, f"serial NOT redacted ({why}): {text!r} -> {out!r}"


@pytest.mark.parametrize("text,why", MUST_NOT_REDACT, ids=[w for _, w in MUST_NOT_REDACT])
def test_ordinary_language_is_left_alone(text: str, why: str) -> None:
    out = _SERIAL_RE.sub("[SN]", text)
    assert out == text, f"over-redacted ({why}): {text!r} -> {out!r}"


# --- Known, pre-existing limitations. Pinned so they are decisions, not surprises.
KNOWN_OVER_REDACTION = [
    ("Serial number unknown at this time", "branch 1 needs no digit"),
    ("SERIAL service is scheduled for tomorrow.", "keyword + separator + ordinary word"),
]


@pytest.mark.parametrize(
    "text,why", KNOWN_OVER_REDACTION, ids=[w for _, w in KNOWN_OVER_REDACTION]
)
def test_known_pre_existing_over_redaction_is_unchanged(text: str, why: str) -> None:
    """A keyword followed by a separator redacts the next token even without a digit.

    This is NOT introduced by #3305 — the pre-fix pattern did the same. It is
    pinned rather than fixed because narrowing it means requiring a digit
    everywhere, which would stop redacting genuinely digit-less serials
    ("serial number ABCDEFGH"). For a PII control, leaking is the worse failure,
    so the trade-off is taken deliberately.

    If a future change makes these strings survive, that is a real decision to
    make consciously — update this test and say why, don't delete it.
    """
    assert _SERIAL_RE.sub("[SN]", text) != text, (
        f"over-redaction unexpectedly stopped ({why}) — if intentional, confirm "
        "digit-less serials like 'serial number ABCDEFGH' are still redacted"
    )


def test_short_tokens_are_not_redacted_pre_existing() -> None:
    """`{4,20}` means a 3-character serial is not redacted. Pre-existing, pinned."""
    assert _SERIAL_RE.sub("[SN]", "SN: ABC") == "SN: ABC"


def test_the_exact_3305_regression() -> None:
    """The single sentence from the issue, end to end."""
    text = "Check the service manual for the PowerFlex 525"
    assert _SERIAL_RE.sub("[SN]", text) == text


def test_redaction_survives_the_public_entry_point() -> None:
    """Guard the seam, not just the regex.

    A future refactor could leave `_SERIAL_RE` correct while `sanitize_context`
    stopped calling it, or called something else. This asserts the behaviour a
    caller actually gets.
    """
    msgs = [
        {"role": "user", "content": "Check the service manual, S/N ABC12345"},
    ]
    out = InferenceRouter.sanitize_context(msgs)
    content = out[0]["content"]
    assert "service manual" in content, f"over-redacted at the seam: {content!r}"
    assert "[SN]" in content, f"serial not redacted at the seam: {content!r}"
    assert "ABC12345" not in content, f"serial leaked: {content!r}"


def test_multipart_text_blocks_are_sanitized_the_same_way() -> None:
    """The vision/multipart path shares the regex and must not diverge."""
    msgs = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "the service door, S/N ABC12345"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            ],
        }
    ]
    out = InferenceRouter.sanitize_context(msgs)
    blocks = out[0]["content"]
    assert "service door" in blocks[0]["text"]
    assert "[SN]" in blocks[0]["text"]
    assert blocks[1]["type"] == "image_url", "non-text block was altered"


def test_negative_control_the_guard_can_actually_fail() -> None:
    """Prove this file is not a false green.

    The pre-#3305 pattern is reconstructed here and asserted to FAIL the
    negative controls. If this test ever passes trivially, the fixtures above
    have stopped discriminating and the suite is decorative.
    """
    import re

    old = re.compile(
        r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
        re.IGNORECASE,
    )
    over_redacted = [t for t, _ in MUST_NOT_REDACT if old.sub("[SN]", t) != t]
    assert over_redacted, (
        "the old pattern no longer over-redacts any fixture — the negative "
        "controls have stopped testing the thing they exist to test"
    )
    # And the current pattern must not.
    still_bad = [t for t, _ in MUST_NOT_REDACT if _SERIAL_RE.sub("[SN]", t) != t]
    assert not still_bad, f"current pattern still over-redacts: {still_bad}"
