"""Guard: the staging deploy must actually rebuild the services it targets.

Regression context (2026-07-08): the staging Telegram nameplate -> Drive
Commander smoke returned stale pre-#2554 behaviour ("Photo queued for knowledge
base") because ``.github/workflows/deploy-staging.yml`` built only its default
``TARGETS`` (``mira-pipeline mira-mcp mira-hub mira-web``) — ``mira-bot-telegram``
was omitted, so ``stg-mira-bot-telegram`` ran a 6-week-old image forever (a
``docker compose up -d`` alone never rebuilds). See the root-cause report.

These two checks fail loudly on the two ways that bug can recur:
  1. ``mira-bot-telegram`` silently dropped from the default rebuild set.
  2. A default target that is NOT a real service in the staging compose (e.g.
     ``mira-bot-slack``, which staging deliberately does not run) — that would
     break ``docker compose build`` at deploy time, not here, so catch it here.

pytest + pyyaml only (matches the Architecture Check CI job's deps).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parent.parent
_WORKFLOW = _ROOT / ".github" / "workflows" / "deploy-staging.yml"
_STAGING_COMPOSE = _ROOT / "docker-compose.staging-vps.yml"

# The default service list lives in a shell line inside the deploy step:
#   TARGETS="${SERVICES:-mira-pipeline mira-mcp mira-hub mira-web mira-bot-telegram}"
_DEFAULT_TARGETS_RE = re.compile(r'TARGETS="\$\{SERVICES:-([^}]*)\}"')


def _default_targets() -> list[str]:
    text = _WORKFLOW.read_text(encoding="utf-8")
    match = _DEFAULT_TARGETS_RE.search(text)
    assert match, (
        "could not find the `TARGETS=\"${SERVICES:-...}\"` default line in "
        f"{_WORKFLOW.relative_to(_ROOT).as_posix()} — did the deploy step change shape?"
    )
    return match.group(1).split()


def _staging_compose_services() -> set[str]:
    data = yaml.safe_load(_STAGING_COMPOSE.read_text(encoding="utf-8"))
    return set((data.get("services") or {}).keys())


def test_staging_deploy_default_rebuilds_telegram_bot():
    """The Telegram bot must be in the default rebuild set, or the staging
    Telegram smoke silently tests a stale image."""
    targets = _default_targets()
    assert "mira-bot-telegram" in targets, (
        "mira-bot-telegram missing from deploy-staging.yml default TARGETS "
        f"({targets}) — the staging Telegram bot would never rebuild (2026-07-08 drift)."
    )


def test_every_default_target_exists_in_staging_compose():
    """Every default rebuild target must be a real service in the staging
    compose — a phantom target (e.g. mira-bot-slack, which staging does not
    run) would fail `docker compose build` at deploy time."""
    targets = _default_targets()
    services = _staging_compose_services()
    missing = [t for t in targets if t not in services]
    assert not missing, (
        f"deploy-staging.yml default TARGETS names services absent from "
        f"docker-compose.staging-vps.yml: {missing}. Available: {sorted(services)}"
    )
