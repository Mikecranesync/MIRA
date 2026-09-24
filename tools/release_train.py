#!/usr/bin/env python3
"""Release-train validator — one release, or it is not a release.

Backend, technician web, Android, schema and the shared behavioural contract
ship together or they drift. This validates
`docs/architecture/convergence/RELEASE_TRAIN.yaml` against the repository, and
with `--drift` against what is actually RUNNING.

    py tools/release_train.py              # repository invariants
    py tools/release_train.py --drift      # + live expected-vs-observed
    py tools/release_train.py --status     # human-readable status table

DESIGN NOTE — why this is a second file next to capability_closure.py and not
a second SYSTEM: it is wired into the SAME CI job ("Capability Closure
Registry"), so there is one place a registry failure surfaces. It is a separate
module only because a 700-line validator with two unrelated schemas is worse
than two focused ones.

THE RULE THAT MATTERS. `state: RELEASED` is INVALID while `blockers` is
non-empty. That is how a safety hold keeps holding when everyone who remembers
why has gone home. Everything else here is bookkeeping by comparison.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_REL = "docs/architecture/convergence/RELEASE_TRAIN.yaml"
MIGRATIONS_REL = "mira-hub/db/migrations"
GRADLE_REL = "mira-mobile/android/app/build.gradle"

STATES = ["DEV", "RC", "STAGING_PARITY", "DEVICE_PARITY", "RELEASED"]
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EMULATOR_RE = re.compile(r"^emulator-", re.I)


class Findings:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def load(root: Path) -> dict:
    return yaml.safe_load((root / MANIFEST_REL).read_text())


# --------------------------------------------------------------------------- #
# Repository invariants
# --------------------------------------------------------------------------- #

def check_schema(m: dict, f: Findings) -> None:
    if m.get("schema_version") != "release-train/v1":
        f.error(f"schema_version must be 'release-train/v1', got {m.get('schema_version')!r}")
    state = (m.get("release") or {}).get("state")
    if state not in STATES:
        f.error(f"release.state must be one of {STATES}, got {state!r}")


def check_blockers_gate_released(m: dict, f: Findings) -> None:
    """The rule this file exists for.

    A blocker is cleared by a human editing the manifest with proof. It is
    never cleared by a test passing somewhere else, and RELEASED cannot be
    claimed around it.
    """
    state = (m.get("release") or {}).get("state")
    blockers = m.get("blockers") or []
    if state == "RELEASED" and blockers:
        ids = ", ".join(f"#{b.get('id')}" for b in blockers)
        f.error(
            f"release.state is RELEASED but {len(blockers)} blocker(s) are open: {ids}. "
            "A release with an open blocker is not a release. Resolve and remove the "
            "entry with evidence, or lower the state."
        )
    for b in blockers:
        for field in ("id", "title", "severity", "evidence", "clears_when"):
            if not b.get(field):
                f.error(f"blocker {b.get('id', '?')} is missing required field '{field}'")


def check_components(m: dict, root: Path, f: Findings) -> None:
    comps = m.get("components") or {}
    contract = (m.get("contract") or {}).get("version")
    if not contract:
        f.error("contract.version is required")

    for name, c in comps.items():
        required = bool(c.get("required"))
        alias = c.get("same_artifact_as")

        if required and c.get("contract") and c["contract"] != contract:
            f.error(f"component '{name}' claims contract {c['contract']!r} but the release contract is {contract!r}")

        if alias:
            # An aliased surface must NOT carry its own sha — two fields that
            # are always equal is exactly how they stop being equal.
            if c.get("expected", {}).get("sha"):
                f.error(
                    f"component '{name}' declares same_artifact_as: {alias} but also "
                    "carries its own expected.sha. Remove it — one artifact, one sha."
                )
            if alias not in comps:
                f.error(f"component '{name}' aliases unknown component '{alias}'")
            continue

        exp = c.get("expected") or {}
        if required and not exp:
            f.error(f"required component '{name}' has no expected identity")

        # Not every component is a git artifact. The schema level is an
        # identity too, and demanding a sha for it would be cargo-culting the
        # shape of the other entries.
        non_sha = bool(exp.get("level"))

        sha = exp.get("sha") or exp.get("release_sha")
        if sha and not SHA_RE.match(str(sha)):
            f.error(f"component '{name}': sha must be 40 lowercase hex, got {sha!r}")

        # A required component must declare the contract it honours, so a
        # surface cannot silently ship against an older turn shape.
        if required and not non_sha and not c.get("contract") and not alias:
            f.error(f"required component '{name}' does not declare a contract version")

        # A probe of kind 'none' must say why. Silence here becomes a probe
        # everyone assumes exists.
        probe = c.get("probe") or {}
        if probe.get("kind") == "none" and not probe.get("why"):
            f.error(f"component '{name}' has probe.kind 'none' with no 'why'")


def check_migration_level(m: dict, root: Path, f: Findings) -> None:
    comps = m.get("components") or {}
    mig = (comps.get("migrations") or {}).get("expected", {}).get("level")
    if not mig:
        return
    d = root / MIGRATIONS_REL
    if not d.is_dir():
        f.error(f"{MIGRATIONS_REL} not found")
        return
    files = sorted(p.name for p in d.glob("*.sql"))
    if mig not in files:
        f.error(f"migrations.expected.level {mig!r} is not a file in {MIGRATIONS_REL}")
        return
    highest = files[-1]
    if mig != highest:
        f.error(
            f"migrations.expected.level is {mig!r} but the highest migration in the "
            f"repo is {highest!r} — the manifest is behind the schema."
        )


def check_device_parity(m: dict, f: Findings, root: Path) -> None:
    """DEVICE_PARITY cannot be bought with an emulator."""
    state = (m.get("release") or {}).get("state")
    dp = m.get("device_parity") or {}
    receipts = dp.get("receipts") or []

    idx = STATES.index(state) if state in STATES else -1
    needs_device = idx >= STATES.index("DEVICE_PARITY")

    if needs_device and not receipts:
        f.error(
            f"release.state is {state} but device_parity.receipts is empty. "
            "DEVICE_PARITY requires a receipt from a physical handset."
        )

    expected = m.get("components") or {}
    android = (expected.get("android") or {}).get("expected") or {}
    backend = (expected.get("backend_hub") or {}).get("expected") or {}
    required_flows = {fl["id"] for fl in (m.get("acceptance") or {}).get("flows", []) if fl.get("device")}
    for r in receipts:
        for field in ("device", "app_version_code", "backend_sha", "flows", "date", "evidence"):
            if not r.get(field):
                f.error(f"device_parity receipt missing {field}")
        if r.get("app_version_code") != android.get("version_code"):
            f.error("device_parity receipt app_version_code differs from expected Android")
        if r.get("backend_sha") != backend.get("sha"):
            f.error("device_parity receipt backend_sha differs from expected backend")
        if not isinstance(r.get("flows"), list) or not required_flows.issubset(r["flows"]):
            f.error("device_parity receipt does not cover all device flows")
        evidence = r.get("evidence")
        if not isinstance(evidence, str) or not (root / evidence).is_file():
            f.error("device_parity receipt evidence is not an existing file")
        serial = str(r.get("serial", ""))
        if not serial:
            f.error("a device_parity receipt has no serial")
        elif EMULATOR_RE.match(serial):
            f.error(
                f"device_parity receipt serial {serial!r} is an EMULATOR. Emulator "
                "evidence cannot satisfy DEVICE_PARITY — cellular, real camera and "
                "release-signed identity are the reasons the state exists."
            )


def check_acceptance(m: dict, root: Path, f: Findings) -> None:
    acc = m.get("acceptance") or {}
    if not acc.get("suite_version"):
        f.error("acceptance.suite_version is required")
    runner = acc.get("runner")
    if runner and not (root / runner).exists():
        f.error(f"acceptance.runner {runner!r} does not exist")
    flows = acc.get("flows") or []
    if not flows:
        f.error("acceptance.flows is empty — parity with no flows is not parity")
    for fl in flows:
        if not fl.get("id"):
            f.error("an acceptance flow has no id")
        if "device" not in fl:
            f.error(f"acceptance flow {fl.get('id')!r} does not say whether it needs a device")


def check_state_evidence(m: dict, f: Findings) -> None:
    """Each state must be earned by something recorded in the file."""
    state = (m.get("release") or {}).get("state")
    if state not in STATES:
        return
    idx = STATES.index(state)
    comps = m.get("components") or {}

    if idx >= STATES.index("RC"):
        for name, c in comps.items():
            if c.get("required") and not c.get("same_artifact_as"):
                exp = c.get("expected") or {}
                if exp.get("level"):
                    continue  # schema level is its own identity, not a sha
                if not (exp.get("sha") or exp.get("release_sha")):
                    f.error(f"state {state} requires an expected sha for required component '{name}'")


# --------------------------------------------------------------------------- #
# Live drift
# --------------------------------------------------------------------------- #

def _fetch(url: str, timeout: int = 20) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310
            return json.loads(r.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def check_drift(m: dict, root: Path, env: str, f: Findings) -> list[tuple[str, str, str, str]]:
    """Compare expected identity against what is RUNNING. Returns rows."""
    rows: list[tuple[str, str, str, str]] = []
    for name, c in (m.get("components") or {}).items():
        probe = c.get("probe") or {}
        exp = (c.get("expected") or {}).get("sha")
        if probe.get("kind") != "http" or not exp:
            continue
        url = probe.get(env)
        if not url:
            continue
        body = _fetch(url)
        if body is None:
            rows.append((name, env, exp, "UNREACHABLE"))
            f.error(f"{name}: could not read live identity from {url} — identity UNPROVEN, not assumed")
            continue
        observed = str(body.get(probe.get("sha_field", "gitSha"), ""))
        rows.append((name, env, exp, observed))
        if observed != exp:
            f.error(
                f"DRIFTED {name} [{env}]: expected {exp[:12]} but {url} is running "
                f"{observed[:12]}"
            )
    return rows


def check_android_source_drift(m: dict, root: Path, f: Findings) -> None:
    """The manifest's expected Android version vs what build.gradle declares."""
    comps = m.get("components") or {}
    a = comps.get("android") or {}
    exp = a.get("expected") or {}
    gradle = root / GRADLE_REL
    if not gradle.exists():
        return
    text = gradle.read_text()
    vc = re.search(r"^\s*versionCode\s+(\d+)", text, re.M)
    vn = re.search(r'^\s*versionName\s+"([^"]+)"', text, re.M)
    if vc and exp.get("version_code") is not None and int(vc.group(1)) != int(exp["version_code"]):
        f.error(
            f"DRIFTED android: manifest expects versionCode {exp['version_code']} but "
            f"{GRADLE_REL} declares {vc.group(1)}"
        )
    if vn and exp.get("version_name") and vn.group(1) != exp["version_name"]:
        f.error(
            f"DRIFTED android: manifest expects versionName {exp['version_name']!r} but "
            f"{GRADLE_REL} declares {vn.group(1)!r}"
        )


# --------------------------------------------------------------------------- #

def validate(root: Path, drift: bool = False, env: str = "staging") -> Findings:
    f = Findings()
    m = load(root)
    check_schema(m, f)
    check_blockers_gate_released(m, f)
    check_components(m, root, f)
    check_migration_level(m, root, f)
    check_device_parity(m, f, root)
    check_acceptance(m, root, f)
    check_state_evidence(m, f)
    check_android_source_drift(m, root, f)
    if drift:
        check_drift(m, root, env, f)
    return f


def status(root: Path, env: str) -> int:
    m = load(root)
    rel = m.get("release", {})
    print(f"RELEASE   {rel.get('id')}   state={rel.get('state')}")
    print(f"CONTRACT  {(m.get('contract') or {}).get('version')}")
    blockers = m.get("blockers") or []
    if blockers:
        print(f"\nBLOCKERS  ({len(blockers)}) — RELEASED is mechanically unreachable")
        for b in blockers:
            print(f"  #{b['id']}  [{b.get('severity')}]  {b.get('title')}")
    print(f"\n{'COMPONENT':<14} {'ENV':<11} {'EXPECTED':<14} {'RUNNING':<14} STATE")
    f = Findings()
    rows = check_drift(m, root, env, f)
    for name, e, exp, obs in rows:
        if obs == "UNREACHABLE":
            st = "UNPROVEN"
        elif obs == exp:
            st = "ok"
        else:
            st = "DRIFTED"
        print(f"{name:<14} {e:<11} {exp[:12]:<14} {obs[:12]:<14} {st}")
    for name, c in (m.get("components") or {}).items():
        if (c.get("probe") or {}).get("kind") in ("none", "device_receipt"):
            print(f"{name:<14} {'-':<11} {'(manifest)':<14} {'(not probed)':<14} {(c.get('probe') or {}).get('kind')}")
    return 1 if f.errors else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drift", action="store_true", help="also compare against live identity")
    ap.add_argument("--status", action="store_true", help="print the expected-vs-running table")
    ap.add_argument("--env", default="staging", choices=["staging", "production"])
    ap.add_argument("--root", default=str(ROOT))
    a = ap.parse_args()
    root = Path(a.root)

    if a.status:
        return status(root, a.env)

    f = validate(root, drift=a.drift, env=a.env)
    for w in f.warnings:
        print(f"⚠ {w}")
    for e in f.errors:
        print(f"✗ {e}")
    if f.errors:
        print(f"\nrelease-train: {len(f.errors)} error(s)")
        return 1
    print("release-train: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
