"""The cross-repo fixture boundary has a mechanism, not just a convention.

`contracts/machine_snapshot/` is vendored **verbatim in two repositories** —
MIRA (consumer, `overlay_from_factorylm_snapshot`) and FactoryLM (producer,
`machine_snapshot.build_machine_snapshot_envelope`). The PRD calls it "the
compatibility boundary between repositories; both projects must test against
the exact same payload."

Until now that was doctrine with nothing enforcing it: two copies, two CI
systems, and a one-sided edit would drift them silently — silent on *both*
sides, because each repo's tests would keep passing against its own copy.

`CHECKSUMS.sha256` is the mechanism. FactoryLM vendors the same file and runs
the same assertion, so editing a fixture in one repo turns that repo red until
the other is updated to match. Regenerate deliberately, in both repos, in the
same change:

    cd contracts/machine_snapshot && shasum -a 256 \\
      README.md snapshot_v1_valid.json snapshot_v1_invalid_malformed_tags.json \\
      snapshot_v1_invalid_missing_tenant.json \\
      snapshot_v1_invalid_missing_timestamp.json \\
      snapshot_v1_invalid_schema_version.json \\
      | awk '{printf "%s  %s\\n", $1, $2}' > CHECKSUMS.sha256
"""

from __future__ import annotations

import hashlib
import pathlib

import pytest

_FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "machine_snapshot"
_MANIFEST = _FIXTURES / "CHECKSUMS.sha256"


def _manifest_rows() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for line in _MANIFEST.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, _, name = line.partition("  ")
        rows.append((name, digest))
    return rows


def test_manifest_exists_and_is_not_empty():
    assert _MANIFEST.is_file(), f"missing {_MANIFEST}"
    assert _manifest_rows(), "CHECKSUMS.sha256 lists no files — the guard would pass vacuously"


@pytest.mark.parametrize("name,expected", _manifest_rows())
def test_fixture_matches_its_recorded_checksum(name: str, expected: str):
    path = _FIXTURES / name
    assert path.is_file(), f"{name} is in CHECKSUMS.sha256 but missing from the tree"
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == expected, (
        f"{name} changed without updating CHECKSUMS.sha256.\n"
        "This file is vendored verbatim in BOTH repos — update it in MIRA and "
        "FactoryLM together, regenerate the manifest in both, or the producer "
        "and consumer silently stop testing the same payload."
    )


def test_every_fixture_on_disk_is_covered_by_the_manifest():
    """A new fixture must be added to the manifest, or it is unguarded.

    Without this, someone adds `snapshot_v1_invalid_whatever.json`, the
    per-file checks all still pass, and the new file drifts freely — the guard
    would look green while covering less than it claims.
    """
    on_disk = {p.name for p in _FIXTURES.iterdir() if p.is_file() and p.name != _MANIFEST.name}
    listed = {name for name, _ in _manifest_rows()}
    assert on_disk == listed, (
        f"unguarded fixture files: {sorted(on_disk - listed)}; "
        f"listed but absent: {sorted(listed - on_disk)}"
    )
