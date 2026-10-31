"""The OTA release workflow uploads to the live updates host (#4048).

updates.factorylm.com moved to the OVH host in the #3800 migration, but
ota-release.yml kept SSHing to the retired DigitalOcean droplet, whose port 22
now times out. Every publish, stage and promote would fail, or land somewhere no
phone reads. The workflow's host must be the OVH production host, and that host
must be pinned in the committed known_hosts file the workflow embeds.

Run: uv run --no-project --with pytest --with pyyaml pytest tests/test_ota_release_host.py -q
"""

from __future__ import annotations

import base64
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ota-release.yml"
KNOWN_HOSTS = ROOT / "deployment/known_hosts.factorylm-prod"
LIVE_HOST = "40.160.141.61"  # OVH production host (#3800, deployment/network.yml)
RETIRED_HOST = "165.245.138.91"  # DigitalOcean droplet left in the #3800 move


def _env() -> dict[str, str]:
    return yaml.safe_load(WORKFLOW.read_text())["env"]


def _pinned_hosts(text: str) -> set[str]:
    return {
        line.split()[0] for line in text.splitlines() if line.strip() and not line.startswith("#")
    }


def test_ota_host_is_the_live_updates_host():
    assert _env()["OTA_HOST"] == LIVE_HOST


def test_control_ota_host_is_not_the_retired_droplet():
    assert _env()["OTA_HOST"] != RETIRED_HOST


def test_ota_host_key_is_pinned_in_the_embedded_known_hosts():
    embedded = base64.b64decode(_env()["OTA_KNOWN_HOSTS_B64"]).decode()
    assert embedded == KNOWN_HOSTS.read_text()
    assert _env()["OTA_HOST"] in _pinned_hosts(embedded)
