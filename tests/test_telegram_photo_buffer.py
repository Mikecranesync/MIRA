"""Tests for the Telegram photo-burst buffer caption logic.

Telegram media-groups put the user's caption only on the FIRST photo. Photos
2-N arrive with no caption, and the bot fills in a default placeholder. We
must NOT let those placeholders overwrite the real first caption when later
photos in the same burst land in the buffer.
"""

from __future__ import annotations

import pytest
from shared.photo_handler import (
    DEFAULT_PHOTO_CAPTION,
    preserve_first_meaningful_caption,
)


def test_real_caption_survives_default_placeholders_through_burst():
    """4-photo burst: photo 1 had a real caption, photos 2-4 default."""
    cap = "VFD pump-3 alarm code 47"
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    assert cap == "VFD pump-3 alarm code 47"


def test_default_persists_when_no_real_caption_ever_arrives():
    """Burst with no captions on any photo — placeholder stays."""
    cap = DEFAULT_PHOTO_CAPTION
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    assert cap == DEFAULT_PHOTO_CAPTION


def test_default_replaced_by_first_real_caption_to_arrive():
    """Edge case: photo 1 had no caption (default), photo 2 had a real one."""
    cap = DEFAULT_PHOTO_CAPTION
    cap = preserve_first_meaningful_caption(cap, "Carrier 19DV nameplate")
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    assert cap == "Carrier 19DV nameplate"


def test_real_caption_never_overwritten_by_another_real_caption():
    """If two photos in a burst somehow both have captions, the first wins.

    Telegram doesn't actually deliver this case, but the rule is "first
    meaningful caption wins" — keep the contract simple and predictable.
    """
    cap = "first real caption"
    cap = preserve_first_meaningful_caption(cap, "second real caption")
    assert cap == "first real caption"


@pytest.mark.parametrize(
    "incoming",
    ["", "  ", "VFD", "Carrier AquaEdge 19DV nameplate, fault code E04"],
)
def test_real_caption_preserved_against_any_incoming(incoming: str):
    """A real caption survives any subsequent caption (default or otherwise)."""
    cap = "first real caption"
    cap = preserve_first_meaningful_caption(cap, DEFAULT_PHOTO_CAPTION)
    assert cap == "first real caption"
    cap = preserve_first_meaningful_caption(cap, incoming)
    assert cap == "first real caption"
