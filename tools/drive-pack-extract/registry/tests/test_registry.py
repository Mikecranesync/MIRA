"""Phase-8 tests for the manual source registry — parsing, duplicate identity,
hash-change detection, and the classify() state machine. All CI-safe: no real
manual, no network, deterministic. The shipped ``sources.json`` is validated as
a real fixture."""

from __future__ import annotations

import json

import pytest
import registry

# --- registry parsing + validation -----------------------------------------


def test_shipped_registry_parses_and_is_valid():
    reg = registry.load_registry()  # the real sources.json
    assert reg["schema_version"] == 1
    assert isinstance(reg["manuals"], list) and reg["manuals"]
    ids = {m["manual_id"] for m in reg["manuals"]}
    assert "rockwell_powerflex_525_520-um001" in ids


def test_pf525_entry_is_automatable_with_generator_and_gold():
    reg = registry.load_registry()
    pf = registry.find_entry(reg, "rockwell_powerflex_525_520-um001")
    assert pf["automatable"] is True
    assert pf["generator"] and pf["gold_path"]
    assert pf["pack_trust_status"] in registry.TRUST_STATUSES


def test_gs10_entry_is_manual_review_only():
    reg = registry.load_registry()
    gs10 = registry.find_entry(reg, "automationdirect_gs10_gs10m-um")
    assert gs10["automatable"] is False  # no generator/gold wired yet


def test_missing_required_field_fails_closed(tmp_path):
    bad = {"schema_version": 1, "manuals": [{"manual_id": "x", "vendor": "v"}]}
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="missing required field"):
        registry.load_registry(p)


def test_automatable_without_generator_fails_closed(tmp_path):
    bad = {
        "schema_version": 1,
        "manuals": [
            {
                "manual_id": "x",
                "vendor": "v",
                "product_family": "f",
                "manual_title": "t",
                "pack_id": "p",
                "automatable": True,
                "source_classification": ["official"],
                "pack_trust_status": "beta",  # automatable but no generator/gold
            }
        ],
    }
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="requires both 'generator' and 'gold_path'"):
        registry.load_registry(p)


def test_bad_trust_status_rejected(tmp_path):
    bad = {
        "schema_version": 1,
        "manuals": [
            {
                "manual_id": "x",
                "vendor": "v",
                "product_family": "f",
                "manual_title": "t",
                "pack_id": "p",
                "automatable": False,
                "source_classification": ["official"],
                "pack_trust_status": "totally_trusted",
            }
        ],
    }
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="pack_trust_status"):
        registry.load_registry(p)


# --- duplicate identity -----------------------------------------------------


def test_detect_duplicate_identities():
    manuals = [{"manual_id": "a"}, {"manual_id": "b"}, {"manual_id": "a"}]
    assert registry.detect_duplicate_identities(manuals) == {"a"}


def test_shipped_registry_has_no_duplicates():
    reg = registry.load_registry()
    assert registry.detect_duplicate_identities(reg["manuals"]) == set()


def test_duplicate_ids_fail_load(tmp_path):
    dup = {
        "schema_version": 1,
        "manuals": [
            {
                "manual_id": "d",
                "vendor": "v",
                "product_family": "f",
                "manual_title": "t",
                "pack_id": "p",
                "automatable": False,
                "source_classification": ["official"],
                "pack_trust_status": "beta",
            },
            {
                "manual_id": "d",
                "vendor": "v",
                "product_family": "f",
                "manual_title": "t",
                "pack_id": "p",
                "automatable": False,
                "source_classification": ["official"],
                "pack_trust_status": "beta",
            },
        ],
    }
    p = tmp_path / "dup.json"
    p.write_text(json.dumps(dup), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate manual_id"):
        registry.load_registry(p)


# --- PDF hashing + change detection -----------------------------------------


def test_sha256_file_is_deterministic(tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"drive manual bytes")
    assert registry.sha256_file(f) == registry.sha256_file(f)


def test_sha256_file_changes_with_content(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"rev O")
    b.write_bytes(b"rev P")
    assert registry.sha256_file(a) != registry.sha256_file(b)


# --- classify() state machine ----------------------------------------------

_ENTRY = {"manual_id": "m1", "pdf_sha256": "a" * 64}


def test_classify_new_manual_when_no_entry():
    cls = registry.classify(None, "b" * 64)
    assert cls.state == registry.NEW_MANUAL
    assert cls.needs_candidate is True


def test_classify_unchanged_on_hash_match():
    cls = registry.classify(_ENTRY, "a" * 64)
    assert cls.state == registry.UNCHANGED
    assert cls.needs_candidate is False


def test_classify_changed_by_hash_on_mismatch():
    cls = registry.classify(_ENTRY, "c" * 64)
    assert cls.state == registry.CHANGED_BY_HASH
    assert cls.needs_candidate is True


def test_classify_needs_initial_candidate_when_no_registered_hash():
    entry = {"manual_id": "m2", "pdf_sha256": None}
    cls = registry.classify(entry, "d" * 64)
    assert cls.state == registry.NEEDS_INITIAL_CANDIDATE
    assert cls.needs_candidate is True
