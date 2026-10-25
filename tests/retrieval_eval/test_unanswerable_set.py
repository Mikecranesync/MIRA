"""The pre-registered unanswerable set is frozen (#4584, prod-refusal-eval-plan.md).

Editing a question after it is registered would let the set be tuned to a result. This test
pins the file's sha256, and checks the walk and expected-id files are exact derivations of it.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "tools" / "retrieval_eval" / "data"
FROZEN_SHA256 = "8a774cc68af3f9ff20922515e3514cfb97aa4612026e3cdf1024e02370c638db"


def test_the_registered_set_is_byte_identical():
    assert hashlib.sha256((DATA / "unanswerable_v1.json").read_bytes()).hexdigest() == FROZEN_SHA256


def test_derived_files_match_the_registered_set():
    src = json.loads((DATA / "unanswerable_v1.json").read_text())["questions"]
    walk = json.loads((DATA / "unanswerable_v1.walk.json").read_text())["questions"]
    expected = json.loads((DATA / "unanswerable_v1.expected.json").read_text())
    assert len(src) == 50 and set(Counter(q["manual"] for q in src).values()) == {5}
    assert [(q["id"], q["manual"], q["question"]) for q in walk] == [
        (q["id"], q["manual"], q["question"]) for q in src
    ]
    assert all(q["expectedPage"] is None and q["safetyRelevant"] is False for q in walk)
    assert expected == [q["id"] for q in src]
