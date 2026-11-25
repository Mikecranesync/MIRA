"""The PowerFlex 525 fault list page is generated from the verified drive pack; keep them in step."""

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/seo/build_fault_reference.py"


def _mod():
    spec = importlib.util.spec_from_file_location("build_fault_reference", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_page_is_up_to_date_with_the_pack():
    r = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_rows_come_from_the_pack_and_never_guess_a_type():
    rows = _mod().rows()
    assert len(rows) == 48
    f004 = next(r for r in rows if r["code"] == "F004")
    assert (f004["name"], f004["type"], f004["page"]) == ("UnderVoltage", "1", "161")
    # F038 comes from the grouped-row override; F000 has no type and must not get one.
    assert next(r for r in rows if r["code"] == "F038")["type"] == "2"
    assert next(r for r in rows if r["code"] == "F000")["type"] is None
