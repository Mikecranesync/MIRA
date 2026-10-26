"""Tests for the automated answer keys (oem_truth.py, robustness.py).

    uv run --no-project --python 3.12 --with pytest python -m pytest -q v02/test_v02_truth.py

The PDF-backed tests need the 19 OEM manuals (MANUALS_DIR, default CHARLIE's path) and skip with that reason when
they are absent (as on CI). The guard tests use synthetic page text and always run.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import oem_truth as O  # noqa: E402
import robustness as RB  # noqa: E402

MANUALS = os.environ.get("MANUALS_DIR", "/Users/charlienode/MIRA/.planning/retrieval-phase0")
needs_pdfs = pytest.mark.skipif(not os.path.isdir(MANUALS), reason="OEM manuals not available here")
MAP = {
    line.split()[1]: line.split(maxsplit=2)[2].strip()
    for line in open(os.path.join(BENCH, "manual-pdfs.sha256"))
}


# ── guards, synthetic pages ──────────────────────────────────────────────────────────────────────────
def test_a_fault_row_whose_name_is_missing_from_its_page_is_dropped(monkeypatch):
    monkeypatch.setitem(
        O.SPECS,
        "toy",
        [((1, 1), r"^\s{0,12}(F\d{1,3})\s{1,6}([A-Z][A-Za-z ]{2,22}?)\s{2,}", "fault")],
    )
    good = ["  F33   Auto Rstrt Tries   blah"]
    assert [r["code"] for r in O.fault_rows("toy", good)] == ["F33"]
    monkeypatch.setattr(
        O, "norm", lambda s: s.lower().replace("auto rstrt tries", "") if "blah" in s else s.lower()
    )
    assert O.fault_rows("toy", good) == []  # name not on the page -> row refused


def test_an_index_entry_whose_words_are_not_on_the_mapped_page_is_dropped(monkeypatch):
    pages = [
        "Index\n   Widget calibration 2",
        "Rockwell Automation Publication X   1",
        "nothing relevant here\nRockwell Automation Publication X   2",
    ]
    monkeypatch.setattr(O, "printed_map", lambda p: {1: 2, 2: 3})
    assert O.index_rows(pages) == []
    pages[2] = "widget calibration procedure\nRockwell Automation Publication X   2"
    assert [r["strict"] for r in O.index_rows(pages)] == [[3]]


def test_robust_variants_keep_the_answer_and_never_repeat_the_base():
    row = {
        "id": "x",
        "manual": "pf40",
        "pdf": "p",
        "question": "What does fault F33 mean on a PowerFlex 40?",
        "accepted": [94],
        "set": "oem-fault",
    }
    v = RB.variants(row, "F33")
    assert v["code"] == "What does fault 33 mean on a PowerFlex 40?"
    assert v["alias"] == "What does fault F33 mean on a pf40?"
    assert all(q != row["question"] for q in v.values())
    assert RB.variants(row, "F33") == v  # deterministic


def test_code_rewrites():
    assert RB.code("ACS355 showing 0002", "0002") == "ACS355 showing code 2"
    assert RB.code("error 0xF000 here", "0xF000") == "error F000 here"
    assert RB.code("GS10 ocA trip", "ocA") == "GS10 OCA trip"
    assert RB.code("no code here", None) is None


# ── PDF-backed: the real keys ────────────────────────────────────────────────────────────────────────
@needs_pdfs
@pytest.mark.parametrize(
    "manual,code,pages",
    [
        ("pf40", "F33", [94]),
        ("pf4m", "F33", [74]),
        ("pf40", "F4", [93]),
        ("acs355", "0002", [359]),
        ("smcflex", "5", [104]),
        ("smcflex", "43", [105]),
    ],
)
def test_known_fault_rows(manual, code, pages):
    rows = {r["code"]: r for r in O.fault_rows(manual, O.pages_of(MAP[manual]))}
    assert rows[code]["strict"] == pages


@needs_pdfs
def test_known_index_entry_micro820_cip_serial():
    rows = {r["term"]: r for r in O.index_rows(O.pages_of(MAP["micro820-um"]))}
    assert rows["CIP Serial"]["strict"] == [
        55,
        58,
    ]  # printed 55/58 = physical 55/58 in this PDF (checked by hand)


@needs_pdfs
def test_every_committed_fault_label_is_a_table_row_on_its_page():
    prov = {
        p["id"]: p
        for p in json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-provenance.json")))
    }
    cache = {}
    for q in json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-questions.json"))):
        pages = cache.setdefault(q["manual"], O.pages_of(MAP[q["manual"]]))
        code = prov[q["id"]]["code"]
        for p in q["accepted"]:
            rx = re.compile(r"(?<![A-Za-z0-9])" + re.escape(code) + r"(?![A-Za-z0-9])")
            assert any(rx.search(line) for line in pages[p - 1].splitlines()), (q["id"], p)


@needs_pdfs
def test_every_committed_index_label_has_its_words_on_the_page():
    cache = {}
    prov = {
        p["id"]: p
        for p in json.load(open(os.path.join(BENCH, "oem-index", "oem-index-provenance.json")))
    }
    for q in json.load(open(os.path.join(BENCH, "oem-index", "oem-index-questions.json"))):
        pages = cache.setdefault(q["manual"], O.pages_of(MAP[q["manual"]]))
        words = [
            w
            for w in re.findall(r"[a-z0-9_]+", prov[q["id"]]["term"].lower())
            if w not in O.STOP and len(w) >= 3
        ]
        for p in q["accepted"]:
            assert all(w in pages[p - 1].lower() for w in words), (q["id"], p)


@needs_pdfs
def test_the_build_is_byte_for_byte_reproducible(tmp_path):
    subprocess.run(
        [
            sys.executable,
            os.path.join(HERE, "oem_truth.py"),
            "--pdf-dir",
            MANUALS,
            "--out",
            str(tmp_path),
        ],
        check=True,
        capture_output=True,
    )
    for s in ("oem-fault", "oem-index"):
        assert (tmp_path / s / f"{s}-questions.json").read_bytes() == open(
            os.path.join(BENCH, s, f"{s}-questions.json"), "rb"
        ).read()


def test_robust_set_matches_its_generator(tmp_path, monkeypatch):
    committed = open(os.path.join(BENCH, "robust", "robust-questions.json"), "rb").read()
    out = tmp_path / "bench"
    out.mkdir()
    os.symlink(os.path.join(BENCH, "oem-fault"), out / "oem-fault")
    os.symlink(os.path.join(BENCH, "t4-77-questions.json"), out / "t4-77-questions.json")
    monkeypatch.setattr(RB, "BENCH", str(out))
    RB.main()
    assert (out / "robust" / "robust-questions.json").read_bytes() == committed
