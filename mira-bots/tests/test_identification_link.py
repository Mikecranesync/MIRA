"""QR / DataMatrix identification link: decode, classify, and fast-path wiring (#5070).

Fixtures are generated in-process with zxing-cpp's own writer, so no private
photo or real serial number is checked in.
"""

import io
import types

import pytest
import zxingcpp
from PIL import Image

from shared.chat.types import NormalizedAttachment, NormalizedChatEvent
from shared.drive_packs import identification_link as il
from shared.drive_packs.asset_identity import build_asset_identity


def _png(text: str, fmt=zxingcpp.BarcodeFormat.QRCode) -> bytes:
    mv = memoryview(zxingcpp.create_barcode(text, fmt).to_image(scale=4))
    img = Image.frombytes("L", (mv.shape[1], mv.shape[0]), mv.tobytes())
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ---------------------------------------------------------------- decode


def test_decode_reads_a_qr_payload():
    codes = il.decode_codes(_png("https://www.automationdirect.com/gs10"))
    assert [c.text for c in codes] == ["https://www.automationdirect.com/gs10"]
    assert codes[0].format == "QRCode"


def test_decode_reads_a_datamatrix_payload():
    codes = il.decode_codes(_png("1PTEST-0001+SNONE", zxingcpp.BarcodeFormat.DataMatrix))
    assert [c.format for c in codes] == ["DataMatrix"]


@pytest.mark.parametrize("data", [b"", b"not an image", b"\x89PNG\r\n\x1a\n broken", None])
def test_decode_never_raises_on_bad_input(data):
    assert il.decode_codes(data) == []


def test_decode_returns_empty_when_decoder_missing(monkeypatch):
    png = _png("https://example.com/a")
    assert il.decode_codes(png) != []  # precondition: decodable with the decoder present
    monkeypatch.setattr(il, "zxingcpp", None)
    assert il.decode_codes(png) == []


def test_decode_returns_empty_for_a_plain_image():
    buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(buf, "PNG")
    assert il.decode_codes(buf.getvalue()) == []


# ---------------------------------------------------------------- classify


def test_oem_host_for_the_named_make_is_oem_url():
    got = il.classify_payload("https://www.automationdirect.com/gs10", make="AutomationDirect")
    assert (got.kind, got.host) == ("oem_url", "www.automationdirect.com")


def test_oem_host_for_a_different_make_is_not_trusted():
    # control for the test above: the host alone is not enough, it must match the nameplate make
    got = il.classify_payload("https://www.automationdirect.com/gs10", make="Siemens")
    assert got.kind == "other_url"


def test_oem_host_with_no_make_is_not_trusted():
    got = il.classify_payload("https://www.automationdirect.com/gs10", make=None)
    assert got.kind == "other_url"


def test_denied_host_is_denied_url():
    got = il.classify_payload("https://pdfcoffee.com/gs10-manual", make="AutomationDirect")
    assert got.kind == "denied_url"


@pytest.mark.parametrize(
    "url",
    [
        "https://user:pw@www.automationdirect.com/gs10",
        "https://www.automationdirect.com:8443/gs10",
        "https://10.0.0.5/gs10",
        "https://[::1]/gs10",
        "http://www.automationdirect.com/gs10",
        "https://www.automationdirect.com:80/gs10",
    ],
)
def test_unsafe_urls_are_never_oem(url):
    assert il.classify_payload(url, make="AutomationDirect").kind == "unsafe_url"


def test_factorylm_asset_tag():
    got = il.classify_payload("https://app.factorylm.com/m/CV-101", make=None)
    assert got.kind == "factorylm_tag"


def test_factorylm_host_without_tag_path_is_other_url():
    assert il.classify_payload("https://app.factorylm.com/pricing", make=None).kind == "other_url"


def test_mh10_part_number_is_extracted():
    got = il.classify_payload("1PTEST-0001-AB12+SXYZ+ZONE", make=None)
    assert (got.kind, got.part_number) == ("no_url", "TEST-0001-AB12")


def test_mh10_part_number_inside_iso15434_envelope():
    got = il.classify_payload("[)>\x1e06\x1d1PTEST-0002\x1dSXYZ\x1e\x04", make=None)
    assert got.part_number == "TEST-0002"


def test_plain_text_has_no_part_number():
    got = il.classify_payload("LOT 42 2026-11", make=None)
    assert (got.kind, got.part_number) == ("no_url", None)


@pytest.mark.parametrize("text", [None, "", 123, "https://", "http://[bad"])
def test_classify_never_raises(text):
    assert il.classify_payload(text, make="Siemens").kind in il.KINDS


# ---------------------------------------------------------------- identity packet


def test_identity_packet_carries_the_payload():
    pkt = build_asset_identity(nameplate={"model": "GS11N"}, barcode_or_qr_payload="1PX+S1")
    assert pkt.barcode_or_qr_payload == "1PX+S1"


def test_identity_payload_never_overrides_the_nameplate_model():
    pkt = build_asset_identity(nameplate={"model": "GS11N"}, barcode_or_qr_payload="1POTHER+S1")
    assert pkt.model_number == "GS11N"


def test_identity_packet_without_payload_stays_none():
    assert build_asset_identity(nameplate={"model": "GS11N"}).barcode_or_qr_payload is None


# ---------------------------------------------------------------- fast-path wiring


def _photo_event(data: bytes) -> NormalizedChatEvent:
    att = NormalizedAttachment(
        kind="image", mime_type="image/png", filename="p.png", url="", data=data
    )
    return NormalizedChatEvent(
        event_id="e",
        platform="slack",
        tenant_id="t",
        user_id="u",
        external_user_id="U1",
        external_channel_id="C1",
        external_thread_id="T1",
        text="",
        attachments=[att],
    )


@pytest.fixture
def fp_spy(monkeypatch):
    import shared.chat.fast_paths as fp

    seen = {}

    def spy(**kwargs):
        seen.update(kwargs)
        return build_asset_identity(**kwargs)

    async def fake_extract(_b64):
        return {"manufacturer": "AutomationDirect", "model": "GS11N"}

    monkeypatch.setattr(fp, "build_asset_identity", spy)
    monkeypatch.setattr(
        fp,
        "resolve_service_pack",
        lambda **_k: types.SimpleNamespace(pack_id=None, reason="no pack"),
    )
    engine = types.SimpleNamespace(nameplate=types.SimpleNamespace(extract=fake_extract))
    return fp, engine, seen


@pytest.mark.asyncio
async def test_flag_on_fills_payload_at_the_fast_path(fp_spy, monkeypatch):
    fp, engine, seen = fp_spy
    monkeypatch.setenv("MIRA_QR_IDENTIFICATION_LINK", "1")
    await fp._try_nameplate_drive_pack(_photo_event(_png("https://example.com/q")), engine)
    assert seen["barcode_or_qr_payload"] == "https://example.com/q"
    assert seen["nameplate"]["model"] == "GS11N"  # nameplate reading untouched


@pytest.mark.asyncio
async def test_flag_off_does_not_decode(fp_spy, monkeypatch):
    fp, engine, seen = fp_spy
    monkeypatch.delenv("MIRA_QR_IDENTIFICATION_LINK", raising=False)

    def boom(_data):
        raise AssertionError("decode must not run with the flag off")

    monkeypatch.setattr(fp, "decode_codes", boom)
    await fp._try_nameplate_drive_pack(_photo_event(_png("https://example.com/q")), engine)
    assert seen["nameplate"]["model"] == "GS11N"  # precondition: the identity was built
    assert seen.get("barcode_or_qr_payload") is None


@pytest.mark.asyncio
async def test_flag_on_with_no_code_leaves_payload_none(fp_spy, monkeypatch):
    fp, engine, seen = fp_spy
    monkeypatch.setenv("MIRA_QR_IDENTIFICATION_LINK", "1")
    buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(buf, "PNG")
    await fp._try_nameplate_drive_pack(_photo_event(buf.getvalue()), engine)
    assert seen["nameplate"]["model"] == "GS11N"
    assert seen.get("barcode_or_qr_payload") is None
