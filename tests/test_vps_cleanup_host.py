"""VPS Cleanup targets the live OVH host and cannot wipe what staging needs (#4048).

vps-cleanup.yml kept SSHing to the DigitalOcean droplet retired in the #3800
move. Pointing it at the OVH host is only safe because the prune is also
narrowed: staging is co-hosted there (#3930), so `--volumes` would delete the
named volumes of stopped or profile-gated services, and `-a` would delete the
tagged images a rollback may need.

Run: uv run --no-project --with pytest --with pyyaml pytest tests/test_vps_cleanup_host.py -q
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/vps-cleanup.yml"
KNOWN_HOSTS = ROOT / "deployment/known_hosts.factorylm-prod"
LIVE_HOST = "40.160.141.61"  # OVH production host (#3800, deployment/network.yml)
RETIRED_HOST = "165.245.138.91"  # DigitalOcean droplet left in the #3800 move


def _cleanup_script() -> str:
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["cleanup"]["steps"]
    (step,) = [s for s in steps if s.get("name") == "Run cleanup"]
    return step["run"]


def _pinned_hosts() -> set[str]:
    return {
        line.split()[0]
        for line in KNOWN_HOSTS.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    }


def _docker_prune_commands(script: str) -> list[str]:
    return [line.strip() for line in script.splitlines() if re.match(r"\s*docker \w+ prune", line)]


def test_cleanup_targets_the_live_host_as_ubuntu_with_sudo():
    script = _cleanup_script()
    assert f'ubuntu@{LIVE_HOST} "sudo bash -s"' in script


def test_cleanup_never_names_the_retired_droplet():
    assert RETIRED_HOST not in WORKFLOW.read_text()


def test_cleanup_host_key_is_pinned():
    assert LIVE_HOST in _pinned_hosts()


def test_prune_never_deletes_volumes_or_all_images():
    prunes = _docker_prune_commands(_cleanup_script())
    assert prunes, "the cleanup script no longer prunes anything; update this test"
    for cmd in prunes:
        flags = cmd.split()
        assert "--volumes" not in flags, cmd
        assert "-a" not in flags and "--all" not in flags, cmd
        assert not any(re.fullmatch(r"-[a-z]*a[a-z]*", f) for f in flags), cmd


def test_prune_check_rejects_the_old_command():
    # Control: the exact command this change removed must fail the check above.
    old = "docker system prune -a --volumes -f"
    flags = old.split()
    assert "--volumes" in flags and "-a" in flags
    assert _docker_prune_commands(f"  {old}\n") == [old]
