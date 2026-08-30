from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
PROG1 = REPO_ROOT / "plc" / "Prog1_ConvSimple_v2.2.st"
PROG_INIT = REPO_ROOT / "plc" / "Prog_init_ConvSimple_v2.2.st"
BUILDER = REPO_ROOT / "plc" / "build_conv_simple_2_2.py"
PACKAGE = Path("C:/Users/hharp/Documents/CCW/MIRA_PLC/Conv_Simple_2.2")
MICRO = PACKAGE / "controller" / "Controller" / "Micro820" / "Micro820"


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def _line_with(text: str, needle: str) -> str:
    return next(line for line in text.splitlines() if needle in line)


def test_v22_preserves_confirmed_good_two_pou_shape() -> None:
    text = _text(BUILDER)

    assert 'SRC_NAME = "Conv_Simple_2.0"' in text
    assert 'DST_NAME = "Conv_Simple_2.2"' in text
    assert 'order != ["PROG1", "PROG_INIT"]' in text
    assert "Prog2.stf" in text


def test_prog1_uses_do4_for_amber_acceptance_lamp() -> None:
    text = _text(PROG1)
    do4_line = _line_with(text, "_IO_EM_DO_04")

    assert not PROG1.read_bytes().startswith(b"\xef\xbb\xbf")
    assert "PROGRAM Prog1" in text
    assert "amber_led_flash" in do4_line
    assert "pending_accept" in do4_line
    assert "dir_fwd_sw" not in do4_line


def test_prog_init_marks_bench_demo_scope_and_v22_series() -> None:
    text = _text(PROG_INIT)

    assert not PROG_INIT.read_bytes().startswith(b"\xef\xbb\xbf")
    assert "PROGRAM Prog_init" in text
    assert "Conv_Simple_2.2 Prog_VFD V2.2" in text
    assert "bench/demo logic" in text
    assert "not production-certified machinery control" in text
    assert "PROGRAM Prog2" not in text


def test_simlab_request_enters_pending_not_immediate_run() -> None:
    text = _text(PROG_INIT)
    pending_block = text[text.index("IF simlab_discharge_request") : text.index("IF discharge_pending_acceptance THEN")]

    assert "simlab_discharge_request" in text
    assert "discharge_pending_acceptance := TRUE;" in pending_block
    assert "discharge_accepted := TRUE;" not in pending_block
    assert "vfd_cmd_word := 18;" not in pending_block
    assert "vfd_cmd_word := 34;" not in pending_block


def test_green_start_rising_edge_and_permissives_are_required() -> None:
    text = _text(PROG_INIT)

    assert "green_start_pb := _IO_EM_DI_04;" in text
    assert "green_start_rising := FALSE;" in text
    assert "IF NOT prev_green_start_pb THEN" in text
    assert "green_start_rising := TRUE;" in text
    assert "discharge_pending_was_active AND green_start_rising AND bench_permissive_ok" in text
    assert "discharge_accepted := TRUE;" in text
    assert "remote_start_allowed :=" in text
    assert "IF bench_permissive_ok THEN" in text
    assert "IF simlab_discharge_request THEN" in text


def test_pending_state_flashes_amber_and_times_out() -> None:
    text = _text(PROG_INIT)

    assert "discharge_accept_timer(IN := discharge_pending_acceptance, PT := T#30s);" in text
    assert "amber_blink_timer(IN := discharge_pending_acceptance AND NOT amber_blink_timer.Q, PT := T#500ms);" in text
    assert "amber_led_flash := discharge_pending_acceptance AND amber_blink_phase;" in text
    assert "discharge_accept_timeout := TRUE;" in text
    assert "discharge_rejected_or_faulted := TRUE;" in text


def test_photoeye_clear_dwell_and_stop_on_blocked_are_present() -> None:
    text = _text(PROG_INIT)

    assert "photoeye_blocked := _IO_EM_DI_05;" in text
    assert "photoeye_clear_timer(IN := NOT photoeye_blocked, PT := T#30s);" in text
    assert "photoeye_clear_30s := photoeye_clear_timer.Q;" in text
    assert "IF discharge_running AND photoeye_blocked THEN" in text
    assert "discharge_complete := TRUE;" in text


def test_generated_ccw_package_if_present_keeps_2_0_series_shape() -> None:
    if not MICRO.exists():
        pytest.skip("local CCW Conv_Simple_2.2 package is not present")

    order = (MICRO / "DwlOrder.txt").read_text(encoding="utf-8", errors="ignore").strip().splitlines()
    prog1 = _text(MICRO / "Prog1.stf")
    prog_init = _text(MICRO / "Prog_init.stf")

    assert order == ["PROG1", "PROG_INIT"]
    assert not (MICRO / "Prog2.stf").exists()
    assert "amber_led_flash" in _line_with(prog1, "_IO_EM_DO_04")
    assert "Conv_Simple_2.2 Prog_VFD V2.2" in prog_init
