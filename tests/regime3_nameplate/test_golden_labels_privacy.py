"""Privacy guard for the committed regime3 golden labels (Bundle 3, 2026-07-16).

The committed ``real_photos.json`` must never carry customer-project
identifiers; those cases live in the gitignored ``real_photos.local.json``
overlay. Terms are checked as salted hashes so this test file itself names
nothing. Vendor names that are the OCR subject of neutral product photos
(hoist/rigging nameplates) are NOT in the marker list by design.
"""

from __future__ import annotations

import hashlib
import json

from tests.conftest import TESTS_ROOT

_SALT = "regime3-privacy-2026"
# sha256(salt + term.lower())[:16] for each forbidden customer-project term
_FORBIDDEN_HASHES = {
    "20aecee77d3e7a57",
    "eea6bc9c64c53c6c",
    "21403d740d8f5ee7",
    "ae0dcedcad9ce513",
    "a4705c277cf84f65",
    "dcd6cd42e4277d83",
    "48a514332c66488c",
}
_MAX_NGRAM = 3

_LABELS = (TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1"
           / "real_photos.json")


def _hash(term: str) -> str:
    return hashlib.sha256((_SALT + term.lower()).encode()).hexdigest()[:16]


def _ngrams(text: str):
    words = text.replace("/", " ").replace("_", " ").split()
    for n in range(1, _MAX_NGRAM + 1):
        for i in range(len(words) - n + 1):
            yield " ".join(words[i:i + n])


def test_committed_labels_carry_no_customer_markers():
    text = _LABELS.read_text(encoding="utf-8")
    hits = sorted({g for g in _ngrams(text) if _hash(g) in _FORBIDDEN_HASHES})
    assert not hits, (
        f"customer-project marker(s) present in committed golden labels: "
        f"{len(hits)} hit(s) — move the affected case(s) to "
        f"real_photos.local.json (gitignored)")


def test_overlay_merge_mechanism(tmp_path, monkeypatch):
    """The fixture merges a local overlay when present (synthetic, tmp-dir)."""
    import tests.regime3_nameplate.conftest as c

    base = tmp_path / "regime3_nameplate" / "golden_labels" / "v1"
    base.mkdir(parents=True)
    (base / "real_photos.json").write_text(json.dumps(
        {"cases": [{"id": "committed_1", "image": "x.jpg",
                    "ground_truth": {"make": "GenericCo"}}]}), encoding="utf-8")
    (base / "real_photos.local.json").write_text(json.dumps(
        {"cases": [{"id": "local_1", "image": "y.jpg",
                    "ground_truth": {"make": "LocalOnlyCo"}}]}), encoding="utf-8")
    monkeypatch.setattr(c, "TESTS_ROOT", tmp_path)

    fixture_fn = c.real_photo_labels.__wrapped__
    cases = fixture_fn()
    ids = [x["id"] for x in cases]
    assert ids == ["committed_1", "local_1"]

    (base / "real_photos.local.json").unlink()
    assert [x["id"] for x in fixture_fn()] == ["committed_1"]
