"""Guard tests for ``printsense.preprocess`` (Phase 0.1/0.2 image prep) and the
``printsense.interpret`` confidence gate (Phase 0.5).

These lock the behavior that produced the SCU2 sheet-20 A-grade (shipped in
#2661) against regression -- the code was un-covered when it landed. Fully
hermetic: no Tesseract binary (OSD is faked via ``sys.modules``), no Anthropic,
no network. Pillow-dependent cases skip where Pillow is absent; the confidence
gate cases need only pydantic.
"""

import importlib.util
import io
import sys
import types

import pytest

pytest.importorskip("pydantic")

from printsense import interpret  # noqa: E402
from printsense import preprocess as pp  # noqa: E402
from printsense.models import Entity, PrintSynthGraph, TrustState  # noqa: E402

_HAS_PIL = importlib.util.find_spec("PIL") is not None
requires_pil = pytest.mark.skipif(not _HAS_PIL, reason="Pillow not installed")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _img(w: int, h: int, color=(255, 255, 255)):
    from PIL import Image

    return Image.new("RGB", (w, h), color)


def _png_bytes(w: int, h: int, color=(255, 255, 255)) -> bytes:
    buf = io.BytesIO()
    _img(w, h, color).save(buf, format="PNG")
    return buf.getvalue()


def _fake_tesseract(rotate: int, conf: float, *, raises: bool = False):
    """A stand-in ``pytesseract`` module with a controllable OSD result.

    Lets the auto-rotate path be exercised on any box -- the real package/binary
    need not be installed. ``raises=True`` simulates a missing binary / too-few
    characters (``image_to_osd`` throws), which the code must swallow.
    """
    mod = types.ModuleType("pytesseract")
    mod.Output = types.SimpleNamespace(DICT="dict")

    def image_to_osd(_img, output_type=None):
        if raises:
            raise RuntimeError("tesseract binary not found")
        return {"rotate": rotate, "orientation_conf": conf}

    mod.image_to_osd = image_to_osd
    return mod


# --------------------------------------------------------------------------- #
# resolution budget (Phase 0.1)
# --------------------------------------------------------------------------- #
@requires_pil
def test_large_image_downscaled_to_budget(monkeypatch):
    # isolate resize from rotate
    monkeypatch.setattr(pp, "_auto_upright", lambda img: img)
    from PIL import Image

    data = _png_bytes(4000, 3000)
    out, media = pp.prepare_print_image(data, "image/png")

    assert media == "image/jpeg"
    result = Image.open(io.BytesIO(out))
    assert result.format == "JPEG"
    # long edge clamped exactly to the budget; aspect ratio preserved
    assert max(result.size) == pp.MAX_PX
    assert result.size == (pp.MAX_PX, round(3000 * pp.MAX_PX / 4000))


@requires_pil
def test_small_image_not_upscaled(monkeypatch):
    monkeypatch.setattr(pp, "_auto_upright", lambda img: img)
    from PIL import Image

    out, media = pp.prepare_print_image(_png_bytes(800, 600), "image/png")

    assert media == "image/jpeg"
    assert Image.open(io.BytesIO(out)).size == (800, 600)  # never upscaled


# --------------------------------------------------------------------------- #
# auto-upright (Phase 0.2) -- the CW->CCW negate is the bug-prone contract
# --------------------------------------------------------------------------- #
@requires_pil
def test_auto_upright_negates_rotation(monkeypatch):
    monkeypatch.setitem(sys.modules, "pytesseract", _fake_tesseract(90, 5.0))
    # asymmetric marker so a +90 vs -90 rotation is observably different
    img = _img(4, 2, (0, 0, 0))
    img.putpixel((0, 0), (255, 255, 255))

    result = pp._auto_upright(img)

    expected = img.rotate(-90, expand=True)  # Tesseract CW angle -> PIL CCW negate
    assert result.tobytes() == expected.tobytes()
    # the marker makes direction observable -- proves the test is discriminating
    assert expected.tobytes() != img.rotate(90, expand=True).tobytes()


@requires_pil
def test_auto_upright_no_rotation_when_zero(monkeypatch):
    monkeypatch.setitem(sys.modules, "pytesseract", _fake_tesseract(0, 5.0))
    img = _img(4, 2)
    result = pp._auto_upright(img)
    assert result.size == img.size
    assert result.tobytes() == img.tobytes()


@requires_pil
def test_auto_upright_skips_low_confidence(monkeypatch):
    # rotate says 90 but confidence is below OSD_MIN_CONF -> leave the sheet alone
    low = pp.OSD_MIN_CONF - 0.5
    monkeypatch.setitem(sys.modules, "pytesseract", _fake_tesseract(90, low))
    img = _img(4, 2)
    result = pp._auto_upright(img)
    assert result.size == img.size  # not rotated


@requires_pil
def test_auto_upright_passthrough_when_pytesseract_missing(monkeypatch):
    monkeypatch.setitem(sys.modules, "pytesseract", None)  # -> ImportError
    img = _img(4, 2)
    result = pp._auto_upright(img)
    assert result is img


@requires_pil
def test_auto_upright_passthrough_when_osd_raises(monkeypatch):
    monkeypatch.setitem(sys.modules, "pytesseract", _fake_tesseract(90, 5.0, raises=True))
    img = _img(4, 2)
    result = pp._auto_upright(img)
    assert result is img  # defensive: a thrown OSD must not eat the turn


# --------------------------------------------------------------------------- #
# defensive passthrough (never eat the turn)
# --------------------------------------------------------------------------- #
def test_pdf_media_type_passthrough():
    data = b"%PDF-1.4 fake"
    out, media = pp.prepare_print_image(data, "application/pdf")
    assert (out, media) == (data, "application/pdf")  # raster ops don't touch PDFs


@requires_pil
def test_undecodable_bytes_passthrough():
    data = b"this is not an image"
    out, media = pp.prepare_print_image(data, "image/png")
    assert (out, media) == (data, "image/png")  # bad bytes -> original, unchanged


@requires_pil
def test_pillow_missing_passthrough(monkeypatch):
    data = _png_bytes(100, 100)  # build the fixture while PIL is still importable
    monkeypatch.setitem(sys.modules, "PIL", None)  # from PIL import Image -> ImportError
    out, media = pp.prepare_print_image(data, "image/png")
    assert (out, media) == (data, "image/png")


# --------------------------------------------------------------------------- #
# confidence gate (Phase 0.5) -- interpret._apply_confidence_gate
# --------------------------------------------------------------------------- #
def test_conf_gate_demotes_below_threshold():
    g = PrintSynthGraph(devices=[Entity(tag="-3/F1", confidence=0.4, evidence="F1 marking")])
    interpret._apply_confidence_gate(g)
    e = g.devices[0]
    assert e.tag == "UNREADABLE"
    assert e.trust == TrustState.unresolved
    assert "low-confidence guess: -3/F1" in e.evidence  # original guess preserved
    assert "F1 marking" in e.evidence  # and the original evidence is kept, not dropped


def test_conf_gate_keeps_high_confidence():
    g = PrintSynthGraph(devices=[Entity(tag="-3/F1", confidence=0.9)])
    interpret._apply_confidence_gate(g)
    assert g.devices[0].tag == "-3/F1"
    assert g.devices[0].trust == TrustState.proposed


def test_conf_gate_ignores_none_confidence():
    # a model that reported no confidence is left alone (gate only fires on a number)
    g = PrintSynthGraph(devices=[Entity(tag="-3/F1", confidence=None)])
    interpret._apply_confidence_gate(g)
    assert g.devices[0].tag == "-3/F1"
    assert g.devices[0].trust == TrustState.proposed


def test_conf_gate_skips_already_unreadable():
    g = PrintSynthGraph(devices=[Entity(tag="UNREADABLE", confidence=0.1, evidence="orig")])
    interpret._apply_confidence_gate(g)
    assert g.devices[0].tag == "UNREADABLE"
    assert g.devices[0].evidence == "orig"  # not re-wrapped a second time


def test_conf_gate_respects_custom_threshold():
    g = PrintSynthGraph(devices=[Entity(tag="-3/F1", confidence=0.6)])
    interpret._apply_confidence_gate(g, threshold=0.7)  # 0.6 < 0.7 -> demote
    assert g.devices[0].tag == "UNREADABLE"


def test_conf_gate_traverses_all_sections():
    # the gate walks all_entities(), not just devices -- a terminal must be gated too
    g = PrintSynthGraph(terminals=[Entity(tag="-X4:4", confidence=0.2)])
    interpret._apply_confidence_gate(g)
    assert g.terminals[0].tag == "UNREADABLE"
    assert g.terminals[0].trust == TrustState.unresolved


# --------------------------------------------------------------------------- #
# wiring: interpret_print runs preprocess AND the gate (hermetic, no real API)
# --------------------------------------------------------------------------- #
def test_interpret_print_runs_preprocess_and_conf_gate(monkeypatch):
    import json

    calls = []

    def _recording_prepare(data, mt):
        calls.append((data, mt))
        return data, mt  # identity -> no real PIL work

    monkeypatch.setattr(pp, "prepare_print_image", _recording_prepare)

    canned = json.dumps({"devices": [{"tag": "-3/F1", "confidence": 0.3, "evidence": "F1"}]})

    class _Stream:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get_final_message(self):
            return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=canned)])

    class _Client:
        messages = types.SimpleNamespace(stream=lambda **kw: _Stream())

    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")  # anthropic-shaped mock
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _Client())

    graph = interpret.interpret_print([(b"imgbytes", "image/jpeg")])

    assert calls == [(b"imgbytes", "image/jpeg")]  # preprocess ran on the page
    assert graph.devices[0].tag == "UNREADABLE"  # and the gate demoted the 0.3 read
