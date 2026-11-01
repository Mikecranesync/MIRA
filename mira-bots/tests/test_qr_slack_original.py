"""Slack decodes the original upload, not the 512 px vision copy (#5073).

The Slack runtime shrinks every photo for the vision model. A nameplate code
about 200 px wide on a phone photo is lost at that size, so the 2D-code decode
must read the original bytes while vision keeps the small copy.

Fixtures are generated in-process with zxing-cpp's own writer.
"""

import base64
import io
import sys
import types
from pathlib import Path

import pytest
import zxingcpp
from PIL import Image

_tests_dir = Path(__file__).resolve().parent
if str(_tests_dir) not in sys.path:
    sys.path.insert(0, str(_tests_dir))

from slack_test_imports import load_slack_bot  # noqa: E402

from shared.drive_packs import identification_link as il  # noqa: E402
from shared.drive_packs.asset_identity import build_asset_identity  # noqa: E402

QR_URL = "https://www.automationdirect.com/gs10-identification"


def _phone_photo_with_small_qr() -> bytes:
    """A 4032x3024 photo with a QR about 200 px wide in one corner."""
    mv = memoryview(
        zxingcpp.create_barcode(QR_URL, zxingcpp.BarcodeFormat.QRCode).to_image(scale=6)
    )
    qr = Image.frombytes("L", (mv.shape[1], mv.shape[0]), mv.tobytes())
    photo = Image.new("L", (4032, 3024), 200)
    photo.paste(qr, (300, 300))
    buf = io.BytesIO()
    photo.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def slack_qr(tmp_path, monkeypatch):
    bot = load_slack_bot()
    import shared.chat.fast_paths as fp

    monkeypatch.setenv("MAX_VISION_PX", "512")
    monkeypatch.setenv("MIRA_QR_IDENTIFICATION_LINK", "1")
    seen = {}

    def spy(**kwargs):
        seen.update(kwargs)
        return build_asset_identity(**kwargs)

    async def fake_extract(photo_b64):
        seen["vision_bytes"] = base64.b64decode(photo_b64)
        return {"manufacturer": "AutomationDirect", "model": "GS11N"}

    monkeypatch.setattr(fp, "build_asset_identity", spy)
    monkeypatch.setattr(
        fp,
        "resolve_service_pack",
        lambda **_k: types.SimpleNamespace(pack_id=None, reason="no pack"),
    )
    engine = types.SimpleNamespace(nameplate=types.SimpleNamespace(extract=fake_extract))
    photo = _phone_photo_with_small_qr()

    class FakeAdapter(bot.SlackChatAdapter):
        async def download_attachment(self, att):
            return photo

    class FakeDispatcher:
        async def dispatch(self, event):
            return None

    async def nameplate_only(event, _engine):
        return await fp._try_nameplate_drive_pack(event, engine)

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=engine,
        adapter=FakeAdapter(bot_token="xoxb-test-secret"),
        dispatcher=FakeDispatcher(),
        fast_paths=nameplate_only,
    )
    event = {
        "channel": "C1",
        "ts": "T1",
        "user": "U1",
        "files": [
            {
                "mimetype": "image/png",
                "url_private_download": "http://x/p.png",
                "name": "p.png",
            }
        ],
    }

    async def say(text=None, thread_ts=None, **kw):
        return None

    return bot, runtime, event, say, photo, seen


@pytest.mark.asyncio
async def test_slack_decodes_the_original_upload_not_the_vision_copy(slack_qr):
    bot, runtime, event, say, photo, seen = slack_qr
    # Preconditions: the code reads at full size and is lost in the vision copy.
    assert [c.text for c in il.decode_codes(photo)] == [QR_URL]
    assert il.decode_codes(bot._resize_for_vision(photo)) == []

    await runtime.handle_message(event, say, client=None)

    assert seen["nameplate"]["model"] == "GS11N"  # the identity was built
    assert seen["barcode_or_qr_payload"] == QR_URL


@pytest.mark.asyncio
async def test_vision_still_receives_the_small_copy(slack_qr):
    _bot, runtime, event, say, photo, seen = slack_qr

    await runtime.handle_message(event, say, client=None)

    vision = Image.open(io.BytesIO(seen["vision_bytes"]))
    assert max(vision.size) == 512
    assert len(seen["vision_bytes"]) < len(photo)
