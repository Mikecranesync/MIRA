"""The direct-install download publishes to the live OVH host (#4782, #4048).

Before this fix the publish-download job validated the pinned host file by line
count (it has four lines since #3800, so the step exited 1 with no message) and
targeted root@ on the retired DigitalOcean droplet. These assertions pin the
publish job to the same host and login deploy-vps.yml uses.
"""

from __future__ import annotations

from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[1] / ".github" / "workflows" / "mobile-release-distribute.yml"
)
OVH_HOST = "40.160.141.61"
RETIRED_HOST = "165.245.138.91"


def _publish_job() -> str:
    text = WORKFLOW.read_text(encoding="utf-8")
    start = text.index("\n  publish-download:")
    return text[start:]


def test_publish_job_targets_the_ovh_host_as_ubuntu() -> None:
    job = _publish_job()
    assert f"TARGET=ubuntu@{OVH_HOST}" in job
    assert RETIRED_HOST not in job


def test_host_pin_is_validated_by_host_not_line_count() -> None:
    job = _publish_job()
    assert f"ssh-keygen -F {OVH_HOST}" in job
    assert 'wc -l < "$KNOWN_HOSTS"' not in job


def test_root_owned_tree_is_written_through_sudo() -> None:
    job = _publish_job()
    assert "sudo -n sh -s --" in job


def test_the_pinned_host_file_carries_the_ovh_key() -> None:
    pins = (WORKFLOW.parents[2] / "deployment" / "known_hosts.factorylm-prod").read_text(
        encoding="utf-8"
    )
    assert any(line.startswith(f"{OVH_HOST} ssh-ed25519 ") for line in pins.splitlines())
