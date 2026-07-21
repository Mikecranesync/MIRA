"""Subprocess worker for the cross-process single-flight tests (NOT a test module —
the leading underscore keeps pytest from collecting it).

Usage:
    python _recall_worker.py <recall_dir> <counter_file> <out_file> <page_hex> [<intervals_file>]

Calls the REAL ``print_recall.interpret_with_recall`` with a fake paid interpreter
that appends one byte to <counter_file> per paid call (a process-safe call ledger)
and blocks ~2s so concurrent peers overlap. Writes the rendered graph JSON to
<out_file>; on success exits 0. Zero real model calls.
"""

import os
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(_ROOT / "mira-bots"))

recall_dir, counter_file, out_file, page_hex = sys.argv[1:5]
intervals_file = sys.argv[5] if len(sys.argv) > 5 else None

os.environ["PRINT_RECALL_ENABLED"] = "1"
os.environ["PRINT_RECALL_DIR"] = recall_dir
os.environ["PRINT_RECALL_ENV"] = "staging"

from shared import print_recall  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402

_payload = bytes.fromhex(page_hex)


def _fake(pages, **kw):
    with open(counter_file, "ab") as f:  # one byte per paid call, process-safe append
        f.write(b"x")
        f.flush()
        os.fsync(f.fileno())
    t0 = time.time()
    time.sleep(2.0)  # block so a concurrent peer overlaps
    t1 = time.time()
    if intervals_file:
        with open(intervals_file, "a", encoding="utf-8") as f:
            f.write(f"{t0},{t1}\n")
            f.flush()
    return PrintSynthGraph(devices=[Entity(tag="-1/F1", type="fuse", evidence="e", confidence=0.9)])


_graph = print_recall.interpret_with_recall(
    pages=[(_payload, "image/jpeg")],
    question="q",
    package_context={"d": "x"},
    model="m",
    preprocess=True,
    interpret_fn=_fake,
)
Path(out_file).write_text(_graph.model_dump_json(), encoding="utf-8")
