"""Integration test — InferenceRouter with real industrial equipment images.

Tests Claude API vision path against the 5 sample tag images.
Requires INFERENCE_BACKEND=claude and ANTHROPIC_API_KEY to be set.

Run:
    INFERENCE_BACKEND=claude ANTHROPIC_API_KEY=<key> pytest tests/test_inference_router.py -v -s
"""

import asyncio
import base64
import pathlib
import sys

import pytest

# Allow running from repo root without install
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from shared.inference.router import InferenceRouter

ASSETS = (
    pathlib.Path(__file__).parent.parent / "telegram_test_runner" / "test-assets" / "sample_tags"
)

# (filename, must_contain_any, must_not_contain)
TEST_CASES = [
    (
        "ab_micro820_tag.jpg",
        ["Allen", "Micro820", "Allen-Bradley", "AB", "micro", "820", "PLC", "controller"],
        ["unknown", "unclear"],
    ),
    (
        "gs10_vfd_tag.jpg",
        ["GS10", "AutomationDirect", "VFD", "drive", "variable frequency", "GS", "10"],
        ["unknown", "unclear"],
    ),
    (
        "generic_cabinet_tag.jpg",
        ["cabinet", "panel", "enclosure", "electrical", "control"],
        [],
    ),
    (
        "bad_glare_tag.jpg",
        # Glare image — expect an honest response, not a hallucination
        [
            "glare",
            "difficult",
            "unclear",
            "partially",
            "limited",
            "hard",
            "close",
            "closer",
            "Allen",
            "Micro",
            "GS",
            "VFD",
            "panel",
            "cabinet",
            "enclosure",
        ],
        [],
    ),
    (
        "cropped_tight_tag.jpg",
        # Tight crop — partial info is fine, but shouldn't be empty
        [
            "Allen",
            "Micro",
            "GS",
            "VFD",
            "panel",
            "cabinet",
            "controller",
            "drive",
            "closer",
            "partial",
            "limited",
            "unclear",
        ],
        [],
    ),
]


def _load_b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def _build_messages(photo_b64: str) -> list[dict]:
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                },
                {
                    "type": "text",
                    "text": (
                        "What is in this image? If it is a piece of equipment, "
                        "return: manufacturer, model, and one visible observation. "
                        "If it is an electrical drawing, schematic, or diagram, "
                        "say 'electrical drawing' and the type. "
                        "If the image shows a computer monitor or laptop screen, "
                        "analyze ONLY the technical content on screen. "
                        "If text is small or partially visible, describe what you "
                        "can read and note a closer shot may improve extraction. "
                        "Keep it under 30 words. Do NOT invent any text."
                    ),
                },
            ],
        }
    ]


@pytest.fixture(scope="module")
def router():
    r = InferenceRouter()
    if not r.enabled:
        pytest.skip(
            "InferenceRouter not enabled — set INFERENCE_BACKEND=claude and ANTHROPIC_API_KEY"
        )
    return r


@pytest.mark.parametrize("filename,must_contain_any,must_not_contain", TEST_CASES)
def test_vision_identification(router, filename, must_contain_any, must_not_contain):
    img_path = ASSETS / filename
    assert img_path.exists(), f"Test asset missing: {img_path}"

    photo_b64 = _load_b64(img_path)
    messages = _build_messages(photo_b64)

    content, usage = asyncio.run(router.complete(messages))

    assert content, f"[{filename}] Empty response from Claude"
    print(f"\n[{filename}]\n  Response: {content}\n  Usage: {usage}")

    InferenceRouter.log_usage(usage)

    content_lower = content.lower()

    if must_contain_any:
        matched = any(kw.lower() in content_lower for kw in must_contain_any)
        assert matched, (
            f"[{filename}] Expected one of {must_contain_any!r} in response.\n  Got: {content!r}"
        )

    for bad in must_not_contain:
        assert bad.lower() not in content_lower, (
            f"[{filename}] Found forbidden word {bad!r} in response.\n  Got: {content!r}"
        )


def test_sanitize_strips_ip(router):
    """Confirm sanitizer removes IPv4 addresses before sending to Claude."""
    messages = [{"role": "user", "content": "Device at 192.168.1.100 is faulted"}]
    clean = InferenceRouter.sanitize_context(messages)
    assert "192.168" not in clean[0]["content"]
    assert "[IP]" in clean[0]["content"]


def test_sanitize_strips_mac(router):
    messages = [{"role": "user", "content": "MAC address AA:BB:CC:DD:EE:FF on this device"}]
    clean = InferenceRouter.sanitize_context(messages)
    assert "AA:BB" not in clean[0]["content"]
    assert "[MAC]" in clean[0]["content"]


def test_sanitize_strips_serial(router):
    messages = [{"role": "user", "content": "S/N: 1234-ABC5678 is the unit ID"}]
    clean = InferenceRouter.sanitize_context(messages)
    assert "1234-ABC" not in clean[0]["content"]
    assert "[SN]" in clean[0]["content"]


def test_fallback_when_disabled():
    """Router returns ('', {}) immediately when disabled — no API call made."""
    r = InferenceRouter.__new__(InferenceRouter)
    r.backend = "local"
    r.api_key = ""
    r.model = "claude-3-5-sonnet-20241022"
    r.enabled = False

    content, usage = asyncio.run(r.complete([{"role": "user", "content": "test"}]))
    assert content == ""
    assert usage == {}
