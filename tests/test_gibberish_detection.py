"""Tests for vision output gibberish detection (#178)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-bots", "shared"))

from inference.router import _is_gibberish  # noqa: E402


def test_normal_english_not_gibberish():
    assert not _is_gibberish("The motor is showing OC fault code F-201")


def test_cyrillic_garbage_is_gibberish():
    assert _is_gibberish("тироваться елем поводу расходов тироваться елем поводу расходов")


def test_mixed_script_garbage_is_gibberish():
    # Real gibberish from Groq llama-4-scout vision on a VFD nameplate photo
    text = (
        "тироваться祝 letting retraAMAN premiseutsch siedáníwndwnd თავ "
        "comercioutsch Пет retraání елем letting comercio comercio Nguyáníượ "
        "тироваться елем comercio расходов поводу siedượ lettingwnd lidar"
    )
    assert _is_gibberish(text)


def test_hallucination_loop_is_gibberish():
    assert _is_gibberish(" ".join(["responsibilities"] * 20))


def test_short_text_not_gibberish():
    assert not _is_gibberish("OK")


def test_industrial_text_not_gibberish():
    assert not _is_gibberish("Model GS1-45P0, S/N: AD-2024-78956, 460V 3-Phase 60Hz 12A FLA")


def test_empty_not_gibberish():
    assert not _is_gibberish("")


def test_legitimate_fault_description():
    assert not _is_gibberish(
        "I can see a GS10 VFD nameplate. The drive is rated for 460V, 3-phase, "
        "5HP with a full load current of 12A. The fault display shows OC1."
    )
