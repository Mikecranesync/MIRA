"""The historical one-shot production amux installer must stay inert."""

from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "vps-install-amux.yml"


def test_amux_installer_is_a_secret_free_retired_tombstone() -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    triggers = workflow.get("on", workflow.get(True))
    serialized = json.dumps(workflow)

    assert set(triggers) == {"workflow_dispatch"}
    assert workflow["permissions"] == {}
    assert set(workflow["jobs"]) == {"retired"}
    assert "environment" not in serialized
    assert "secrets." not in serialized
    assert "ssh" not in serialized.lower()
    assert "apt-get" not in serialized
    assert "pip install" not in serialized
    assert "--break-system-packages" not in serialized
    assert "retired" in serialized.lower()
    assert "exit 1" in serialized
