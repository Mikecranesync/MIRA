"""Release-train validator tests — every rule gets a NEGATIVE control.

A validator nobody has watched fail is a validator nobody knows works. Each
test here breaks the manifest in one specific way and asserts the validator
catches THAT, by message, not merely that something went red.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import release_train as rt  # noqa: E402

MANIFEST_REL = "docs/architecture/convergence/RELEASE_TRAIN.yaml"


@pytest.fixture
def manifest() -> dict:
    return yaml.safe_load((ROOT / MANIFEST_REL).read_text())


def _write(tmp_path: Path, m: dict) -> Path:
    """Materialise a manifest into a fake root that mirrors the real one."""
    root = tmp_path / "repo"
    (root / "docs/architecture/convergence").mkdir(parents=True, exist_ok=True)
    (root / MANIFEST_REL).write_text(yaml.safe_dump(m, sort_keys=False))
    # mirror the bits the validator reads off disk
    migs = root / "mira-hub/db/migrations"
    migs.mkdir(parents=True, exist_ok=True)
    for name in ("001_a.sql", "094_decision_traces_lifecycle_invariant.sql"):
        (migs / name).write_text("-- test\n")
    gradle = root / "mira-mobile/android/app"
    gradle.mkdir(parents=True, exist_ok=True)
    # Copy the repository source, independently of the possibly mutated manifest.
    (gradle / "build.gradle").write_text((ROOT / "mira-mobile/android/app/build.gradle").read_text())
    runner = root / "tools/release-train"
    runner.mkdir(parents=True, exist_ok=True)
    (runner / "parity_acceptance.py").write_text("# test\n")
    proof = root / "docs/proofs/x.md"
    proof.parent.mkdir(parents=True, exist_ok=True)
    proof.write_text("SYNTHETIC TEST FIXTURE ONLY: not handset acceptance.\n")
    return root


def errors_for(tmp_path: Path, m: dict) -> list[str]:
    return rt.validate(_write(tmp_path, m)).errors


# --------------------------------------------------------------------------- #
# The real manifest must be valid, or every negative control below is vacuous.
# --------------------------------------------------------------------------- #

def test_the_committed_manifest_is_valid():
    f = rt.validate(ROOT)
    assert not f.errors, "the committed RELEASE_TRAIN.yaml must validate:\n" + "\n".join(f.errors)


def test_baseline_fixture_is_valid(tmp_path, manifest):
    """If the fixture were already broken, every test below would 'pass' for
    the wrong reason."""
    assert errors_for(tmp_path, manifest) == []


# --------------------------------------------------------------------------- #
# THE RULE THIS FILE EXISTS FOR
# --------------------------------------------------------------------------- #

def test_released_is_refused_while_a_blocker_is_open(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["release"]["state"] = "RELEASED"
    errs = errors_for(tmp_path, m)
    assert any("RELEASED" in e and "blocker" in e for e in errs), errs
    assert any("#3984" in e for e in errs), "the open blocker must be named: " + str(errs)


@pytest.mark.parametrize("breakage", [None, "backend", "version", "flows", "evidence"])
def test_released_is_allowed_only_once_blockers_are_cleared(tmp_path, manifest, breakage):
    """The positive half — otherwise the rule above could be 'RELEASED is
    always invalid', which would be useless."""
    m = copy.deepcopy(manifest)
    m["release"]["state"] = "RELEASED"
    m["blockers"] = []
    m["device_parity"]["receipts"] = [{
        "serial": "4A111FDEE0012B", "device": "Pixel 9a", "app_version_code": 11,
        "backend_sha": m["components"]["backend_hub"]["expected"]["sha"],
        "flows": [fl["id"] for fl in m["acceptance"]["flows"] if fl["device"]], "date": "2026-09-24",
        "evidence": "docs/proofs/x.md",
    }]
    receipt = m["device_parity"]["receipts"][0]
    if breakage == "backend":
        receipt["backend_sha"] = "a" * 40
    elif breakage == "version":
        receipt["app_version_code"] = 999
    elif breakage == "flows":
        receipt["flows"] = ["sign_in"]
    elif breakage == "evidence":
        receipt["evidence"] = "docs/proofs/does-not-exist.md"
    errors = errors_for(tmp_path, m)
    assert bool(errors) == bool(breakage), errors


def test_a_blocker_cannot_be_a_bare_id(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["blockers"] = [{"id": 9999}]
    errs = errors_for(tmp_path, m)
    assert any("missing required field" in e for e in errs), errs


# --------------------------------------------------------------------------- #
# Drift
# --------------------------------------------------------------------------- #

def test_android_source_drift_is_detected(tmp_path, manifest):
    """The live case: build.gradle said versionCode 10 while the tested APK
    was 11, and nothing noticed."""
    m = copy.deepcopy(manifest)
    m["components"]["android"]["expected"]["version_code"] = 10
    errs = errors_for(tmp_path, m)
    assert any("DRIFTED android" in e and "versionCode" in e for e in errs), errs


def test_android_version_name_drift_is_detected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["android"]["expected"]["version_name"] = "9.9.9"
    errs = errors_for(tmp_path, m)
    assert any("DRIFTED android" in e and "versionName" in e for e in errs), errs


def test_migration_level_behind_the_repo_is_detected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["migrations"]["expected"]["level"] = "001_a.sql"
    errs = errors_for(tmp_path, m)
    assert any("highest migration" in e for e in errs), errs


def test_migration_level_naming_a_missing_file_is_detected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["migrations"]["expected"]["level"] = "999_nope.sql"
    errs = errors_for(tmp_path, m)
    assert any("is not a file" in e for e in errs), errs


# --------------------------------------------------------------------------- #
# Device parity cannot be bought with an emulator
# --------------------------------------------------------------------------- #

def test_device_parity_without_a_receipt_is_refused(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["release"]["state"] = "DEVICE_PARITY"
    errs = errors_for(tmp_path, m)
    assert any("receipts is empty" in e for e in errs), errs


def test_an_emulator_receipt_is_refused(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["release"]["state"] = "DEVICE_PARITY"
    m["device_parity"]["receipts"] = [{
        "serial": "emulator-5554", "device": "sdk_gphone64_arm64", "app_version_code": 11,
        "backend_sha": "f" * 40, "flows": ["sign_in"], "date": "2026-09-24",
        "evidence": "x",
    }]
    errs = errors_for(tmp_path, m)
    assert any("EMULATOR" in e for e in errs), errs


# --------------------------------------------------------------------------- #
# Contract + component shape
# --------------------------------------------------------------------------- #

def test_a_surface_on_a_different_contract_is_detected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["android"]["contract"] = "mira-turn/v0"
    errs = errors_for(tmp_path, m)
    assert any("claims contract" in e for e in errs), errs


def test_an_aliased_surface_may_not_carry_its_own_sha(tmp_path, manifest):
    """web_hub IS backend_hub. Two fields that are always equal is how they
    stop being equal."""
    m = copy.deepcopy(manifest)
    m["components"]["web_hub"]["expected"] = {"sha": "a" * 40}
    errs = errors_for(tmp_path, m)
    assert any("one artifact, one sha" in e for e in errs), errs


def test_a_malformed_sha_is_rejected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["backend_hub"]["expected"]["sha"] = "f02595267"  # short
    errs = errors_for(tmp_path, m)
    assert any("40 lowercase hex" in e for e in errs), errs


def test_an_unprobed_component_must_say_why(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    del m["components"]["public_web"]["probe"]["why"]
    errs = errors_for(tmp_path, m)
    assert any("no 'why'" in e for e in errs), errs


def test_a_missing_acceptance_runner_is_detected(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["acceptance"]["runner"] = "tools/release-train/does-not-exist.py"
    errs = errors_for(tmp_path, m)
    assert any("does not exist" in e for e in errs), errs


def test_flows_must_declare_whether_they_need_a_device(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["acceptance"]["flows"] = [{"id": "sign_in"}]
    errs = errors_for(tmp_path, m)
    assert any("whether it needs a device" in e for e in errs), errs


def test_every_manifest_flow_has_a_runner():
    """The manifest cannot promise a flow the runner does not implement."""
    sys.path.insert(0, str(ROOT / "tools/release-train"))
    import parity_acceptance as pa  # noqa: PLC0415

    m = yaml.safe_load((ROOT / MANIFEST_REL).read_text())
    declared = {f["id"] for f in m["acceptance"]["flows"]}
    implemented = set(pa.FLOWS)
    assert declared == implemented, (
        f"manifest-only: {declared - implemented}; runner-only: {implemented - declared}"
    )


@pytest.mark.parametrize("receipts,required", [([], True), ([], False), ([{"serial": "claimed-pixel"}], True)])
def test_released_requires_substantiated_device_evidence(tmp_path, manifest, receipts, required):
    m = copy.deepcopy(manifest)
    m["release"]["state"] = "RELEASED"
    m["blockers"] = []
    m["device_parity"].update(receipts=receipts, requires_physical_device=required)
    assert errors_for(tmp_path, m), "RELEASED accepted without real device evidence"


def test_deployed_sha_drift_is_detected(tmp_path, manifest, monkeypatch):
    monkeypatch.setattr(rt, "_fetch", lambda url: {"gitSha": "a" * 40})
    f = rt.validate(_write(tmp_path, manifest), drift=True)
    assert any("DRIFTED backend_hub" in e for e in f.errors), f.errors
    monkeypatch.setattr(rt, "_fetch", lambda url: {"gitSha": manifest["components"]["backend_hub"]["expected"]["sha"]})
    assert rt.validate(_write(tmp_path, manifest), drift=True).errors == []


def test_alias_still_has_to_match_the_release_contract(tmp_path, manifest):
    m = copy.deepcopy(manifest)
    m["components"]["web_hub"]["contract"] = "mira-turn/v0"
    assert any("claims contract" in e for e in errors_for(tmp_path, m))


def test_machine_project_flow_cannot_pass_without_a_grounded_fixture():
    sys.path.insert(0, str(ROOT / "tools/release-train"))
    import parity_acceptance as pa
    class SessionProbe:
        def ask(self, nb, message, general=True):
            raise AssertionError("empty notebook must not stand in for grounded machine proof")
            return {"text": "test response " * 10}
    assert pa.flow_machine_project_chat(SessionProbe(), {"nb": "fixture"})[0] is None


def test_citation_flow_requires_nonempty_shipped_citations():
    import parity_acceptance as pa
    class Probe:
        def __init__(self, citations): self.citations = citations
        def ask(self, *a, **k): return {"frames": [{"kind": "sources", "citations": self.citations}]}
    assert pa.flow_citations_evidence(Probe([]), {"nb": "fixture"})[0] is None
    assert pa.flow_citations_evidence(Probe([{"docId": "fixture"}]), {"nb": "fixture"})[0] is True


@pytest.mark.parametrize("outcome,exit_code", [(True, 0), (False, 1), (None, 2)])
def test_parity_exit_code_preserves_unproven_flows(monkeypatch, outcome, exit_code):
    import parity_acceptance as pa
    monkeypatch.setattr(pa.sys, "argv", ["parity"])
    monkeypatch.setattr(pa, "curl", lambda *a, **k: '{"gitSha":"' + "a" * 40 + '"}')
    monkeypatch.setattr(pa, "Session", lambda *a: object())
    monkeypatch.setattr(pa, "FLOWS", {k: (lambda *a: (True, "control")) for k in pa.FLOWS})
    pa.FLOWS["machine_project_chat"] = lambda *a: (outcome, "controlled observation")
    assert pa.main() == exit_code
