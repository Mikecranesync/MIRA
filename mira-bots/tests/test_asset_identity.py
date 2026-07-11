"""Tests for the asset-identity packet (``shared/drive_packs/asset_identity.py``).

Pure, no-LLM, no-DB, no-network — plain function calls against
``build_asset_identity`` / ``AssetIdentityPacket``. See the module docstring
in ``asset_identity.py`` for the RAW-vs-INTERPRETED separation and the
no-fabrication rules this locks in.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs.asset_identity import (  # noqa: E402
    AssetIdentityPacket,
    build_asset_identity,
)


def test_gs11n_nameplate_derives_model_and_sku_prefix():
    packet = build_asset_identity(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-20P2"}
    )
    assert packet.model_number == "GS11N-20P2"
    assert packet.sku_prefix == "GS11N"
    assert packet.manufacturer == "AutomationDirect"


def test_raw_text_kept_separate_from_interpreted_fields():
    packet = build_asset_identity(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-20P2"},
        raw_text="AutomationDirect GS11N-20P2 SN12345 460V",
    )
    assert packet.raw_text == "AutomationDirect GS11N-20P2 SN12345 460V"
    # The raw transcript is not parsed into fields by this builder — only the
    # already-interpreted nameplate dict is.
    assert packet.serial_number is None


def test_raw_text_arg_wins_over_nameplate_dict_raw_text():
    packet = build_asset_identity(
        nameplate={"model": "GS11N-20P2", "raw_text": "from-nameplate-dict"},
        raw_text="from-explicit-arg",
    )
    assert packet.raw_text == "from-explicit-arg"


def test_raw_text_falls_back_to_nameplate_dict_when_arg_absent():
    packet = build_asset_identity(nameplate={"model": "GS11N-20P2", "raw_text": "only-source"})
    assert packet.raw_text == "only-source"


def test_parse_error_nameplate_yields_all_none_packet_no_raise():
    packet = build_asset_identity(nameplate={"parse_error": "unparseable response: ..."})
    assert packet.manufacturer is None
    assert packet.model_number is None
    assert packet.sku_prefix is None
    assert packet.serial_number is None
    assert packet.raw_text is None


def test_none_nameplate_does_not_raise():
    packet = build_asset_identity(nameplate=None)
    assert isinstance(packet, AssetIdentityPacket)
    assert packet.manufacturer is None
    assert packet.model_number is None


def test_model_with_no_clean_prefix_leaves_sku_prefix_none():
    packet = build_asset_identity(nameplate={"manufacturer": "AutomationDirect", "model": "PowerFlex 525"})
    assert packet.model_number == "PowerFlex 525"
    assert packet.sku_prefix is None


def test_purely_numeric_model_leaves_sku_prefix_none():
    packet = build_asset_identity(nameplate={"model": "525"})
    assert packet.model_number == "525"
    assert packet.sku_prefix is None


class _FakeResolution:
    def __init__(self, pack_id, confidence):
        self.pack_id = pack_id
        self.confidence = confidence


def test_resolution_sets_candidate_pack_id_and_confidence():
    packet = build_asset_identity(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-20P2"},
        resolution=_FakeResolution("durapulse_gs10", "medium"),
    )
    assert packet.candidate_pack_id == "durapulse_gs10"
    assert packet.confidence_by_field["candidate_pack_id"] == "medium"


def test_none_resolution_leaves_candidate_pack_id_none():
    packet = build_asset_identity(nameplate={"model": "GS11N-20P2"}, resolution=None)
    assert packet.candidate_pack_id is None
    assert packet.confidence_by_field == {}


def test_approval_status_defaults_unreviewed():
    packet = build_asset_identity(nameplate=None)
    assert packet.approval_status == "unreviewed"


def test_to_dict_round_trips():
    packet = build_asset_identity(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-20P2", "serial": "SN123"}
    )
    d = packet.to_dict()
    assert d["manufacturer"] == "AutomationDirect"
    assert d["model_number"] == "GS11N-20P2"
    assert d["sku_prefix"] == "GS11N"
    assert d["serial_number"] == "SN123"
    assert d["approval_status"] == "unreviewed"


def test_certifications_defaults_to_empty_list():
    packet = build_asset_identity(nameplate=None)
    assert packet.certifications == []


def test_serial_present_alone_does_not_set_any_other_pack_field():
    packet = build_asset_identity(nameplate={"serial": "SN99999"})
    assert packet.serial_number == "SN99999"
    assert packet.manufacturer is None
    assert packet.model_number is None
    assert packet.sku_prefix is None
    assert packet.input_voltage is None
    assert packet.current_or_fla is None
    assert packet.hp is None
    assert packet.frequency is None


def test_empty_string_fields_are_none_not_fabricated():
    packet = build_asset_identity(nameplate={"manufacturer": "", "model": None, "serial": "  "})
    # Empty/whitespace-only or falsy values must not survive as "evidence".
    assert packet.manufacturer is None
    assert packet.model_number is None


def test_direct_construction_defaults_match_builder_defaults():
    packet = AssetIdentityPacket()
    assert packet.approval_status == "unreviewed"
    assert packet.certifications == []
    assert packet.confidence_by_field == {}
    assert packet.raw_text is None
