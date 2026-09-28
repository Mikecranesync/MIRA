"""tools/mobile-e2e/launch_matrix.py — the pure parts (#3799).

The device matrix itself needs a phone or emulator; these lock the two judgement
functions that decide PASS/FAIL so a regression there is caught without one.
"""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path

from PIL import Image

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "mobile-e2e" / "launch_matrix.py"
_spec = importlib.util.spec_from_file_location("launch_matrix", _MODULE_PATH)
assert _spec and _spec.loader
launch_matrix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(launch_matrix)


def _png(width: int, height: int, paint) -> bytes:
    im = Image.new("RGB", (width, height), (255, 255, 255))
    paint(im)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_uniform_flags_a_blank_content_area_even_with_a_placeholder_label():
    # The #3799 screen: white, one small grey label at the top (outside the box).
    def paint(im):
        for x in range(400, 680):
            for y in range(120, 150):
                im.putpixel((x, y), (120, 120, 120))

    png = _png(1080, 2400, paint)
    box = (54, 288, 1026, 2208)
    blank, colours = launch_matrix.uniform(png, box)
    assert blank is True
    assert colours == 1


def test_uniform_passes_a_painted_sign_in_card():
    def paint(im):
        for x in range(40, 1040):
            for y in range(330, 1000):
                im.putpixel((x, y), (242, 245, 249))
        for x in range(80, 1000):
            for y in range(860, 980):
                im.putpixel((x, y), (16, 19, 23))

    png = _png(1080, 2400, paint)
    blank, colours = launch_matrix.uniform(png, (54, 288, 1026, 2208))
    assert blank is False
    assert colours >= 2


_LOG = """\
09-13 14:00:01.000 W/MiraWebViewRecovery( 4001): UI not rendered after resume: probe returned "empty"; reloading page
09-14 10:00:02.100 D/MiraWebViewRecovery( 5123): resume probe ok (DOM); checking paint
09-14 10:00:02.140 D/MiraWebViewRecovery( 5123): resume probe ok (paint)
09-14 10:00:03.000 I/ActivityManager( 1476): Process com.factorylm.mira (pid 5123) has died: fg  TOP
09-14 10:00:03.500 E/AndroidRuntime( 5123): FATAL EXCEPTION: main
09-14 10:00:03.600 I/ActivityManager( 1476): Process com.other.app (pid 77) has died: cch
"""


def test_parse_step_log_attributes_guard_lines_by_pid_not_by_time_of_day():
    guard, crashes = launch_matrix.parse_step_log(_LOG, pid="5123")
    # Yesterday's 14:00 reload from another process instance is NOT this step's.
    assert guard == [
        "09-14 10:00:02.100 D/MiraWebViewRecovery( 5123): resume probe ok (DOM); checking paint",
        "09-14 10:00:02.140 D/MiraWebViewRecovery( 5123): resume probe ok (paint)",
    ]
    assert not any(launch_matrix.GUARD_BAD.search(ln) for ln in guard)
    # Crash/ANR lines are matched by package, and only ours.
    assert len(crashes) == 1
    assert "com.factorylm.mira" in crashes[0] and "has died" in crashes[0]


def test_parse_step_log_without_a_pid_keeps_every_guard_line():
    guard, _ = launch_matrix.parse_step_log(_LOG)
    assert len(guard) == 3
    assert any(launch_matrix.GUARD_BAD.search(ln) for ln in guard)


_UI = """\
<node index="0" text="" class="android.webkit.WebView" package="com.factorylm.mira" bounds="[0,0][1080,2424]">
<node index="0" text="FactoryLM…" class="android.widget.TextView" package="com.factorylm.mira" bounds="[400,120][680,150]"/>
<node index="1" text="Claude" class="android.widget.TextView" package="com.anthropic.claude" bounds="[0,0][10,10]"/>
</node>
"""


def test_count_ui_text_nodes_ignores_the_boot_placeholder_and_other_packages():
    assert launch_matrix.count_ui_text_nodes(_UI) == 0
    rendered = _UI.replace(
        'text="FactoryLM…"',
        'text="Sign in"',
    )
    assert launch_matrix.count_ui_text_nodes(rendered) == 1
