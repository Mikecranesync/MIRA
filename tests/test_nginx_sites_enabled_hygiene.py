"""Contract tests for the nginx sites-enabled hygiene guard (#3173).

`/etc/nginx/nginx.conf` includes `sites-enabled/` by a BARE wildcard, so every
file in that directory is live production configuration and a stray `.bak` is a
duplicate `server` block for a production hostname. nginx keeps whichever block
sorts first and only emits a `[warn]`.

These pin the properties that make the cleanup safe to run against prod, and —
more importantly — the two rules that must NOT be used, both of which were
proposed in the issue and both of which were falsified against the real
directory on 2026-08-10:

  * `include sites-enabled/*.conf` would disable EVERY vhost: not one live file
    has a `.conf` suffix.
  * "must be a symlink" flags `cmms.factorylm.com` and `factorylm-landing`,
    which are regular files AND live config.

Hermetic — reads the two workflow YAMLs, no network, no ssh.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[1]
_HYGIENE = _ROOT / ".github" / "workflows" / "nginx-sites-enabled-hygiene.yml"
_DEPLOY = _ROOT / ".github" / "workflows" / "deploy-vps.yml"

# Live vhosts read off the prod box 2026-08-10. Two are regular files, not
# symlinks — that is the whole reason the guard cannot key on symlink-ness.
_REAL_VHOSTS_NOT_SYMLINKS = ("cmms.factorylm.com", "factorylm-landing")
_REAL_VHOST_SYMLINKS = (
    "factorylm",
    "factorylm-paths",
    "mira",
    "plane",
    "preview",
    "remoteme",
    "updates.factorylm.com",
)
# The OVH prod host (40.160.141.61) since the #3800 migration. Read off the box
# 2026-09-27 (hygiene run 36325006196): four symlinks and no backups at all.
# staging-factorylm is installed by deploy-nginx-stg.yml and serves
# app-staging/staging.factorylm.com.
_OVH_REAL_VHOST_SYMLINKS = ("recovery-ovh", "staging-factorylm", "updates.factorylm.com")

_KNOWN_BAKS = (
    "factorylm-landing.bak.2026-05-13-csp",
    "factorylm-landing.bak.20260509-203650",
    "mira.bak.20260426-082325",
    "mira.bak.20260506-094431",
    "mira.bak.20260509-121505",
    "mira.bak.before-scan-restore-20260518-215310",
    "mira.bak.cra-20260504-024235",
    "mira.bak.inbox",
    "mira.bak.phase1",
    "mira.bak.scan-deploy-20260504-224027",
)


@pytest.fixture(scope="module")
def hygiene_text() -> str:
    return _HYGIENE.read_text()


@pytest.fixture(scope="module")
def deploy_text() -> str:
    return _DEPLOY.read_text()


def _allow_list(text: str) -> list:
    """The single `ALLOW="..."` line's entries, from whichever workflow."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("ALLOW="):
            return stripped.split("=", 1)[1].strip('"').split()
    raise AssertionError("no ALLOW= line found")


# --- both workflows parse -----------------------------------------------------


def test_both_workflows_are_valid_yaml(hygiene_text, deploy_text):
    for text in (hygiene_text, deploy_text):
        assert yaml.safe_load(text)


# --- the allowlist is the discriminator, and it is shared ---------------------


def test_allowlists_match_between_the_two_workflows(hygiene_text, deploy_text):
    """Drift here silently re-opens the hole in one place while closing it in the other."""
    assert _allow_list(hygiene_text) == _allow_list(deploy_text)


def test_every_real_vhost_is_allowlisted(hygiene_text):
    allow = _allow_list(hygiene_text)
    for name in _REAL_VHOSTS_NOT_SYMLINKS + _REAL_VHOST_SYMLINKS + _OVH_REAL_VHOST_SYMLINKS:
        assert name in allow, f"{name} is a LIVE vhost and would be flagged as an offender"


def test_no_known_backup_is_allowlisted(hygiene_text):
    allow = _allow_list(hygiene_text)
    for bak in _KNOWN_BAKS:
        assert bak not in allow, f"{bak} is a backup and must remain an offender"


def test_guard_does_not_key_on_conf_suffix(hygiene_text, deploy_text):
    """`include sites-enabled/*.conf` would load ZERO server blocks — no live
    vhost has that suffix. Pin that no allowlist entry relies on it."""
    for text in (hygiene_text, deploy_text):
        assert not any(entry.endswith(".conf") for entry in _allow_list(text))


def test_guard_does_not_key_on_symlink_ness(hygiene_text):
    """Two live vhosts are regular files; a symlink rule would move them out."""
    allow = _allow_list(hygiene_text)
    for name in _REAL_VHOSTS_NOT_SYMLINKS:
        assert name in allow


# --- fix mode is gated, reversible, and never destroys ------------------------


def test_fix_mode_requires_the_confirmation_token(hygiene_text):
    assert "MOVE-BAK-FILES" in hygiene_text
    assert "inputs.mode == 'fix'" in hygiene_text


def test_fix_mode_is_human_dispatched_and_production_gated(hygiene_text):
    wf = yaml.safe_load(hygiene_text)
    triggers = wf[True] if True in wf else wf["on"]
    assert "workflow_dispatch" in triggers
    assert wf["jobs"]["hygiene"]["environment"] == "production"


def test_fix_never_deletes_anything(hygiene_text):
    """Some of these backups are the only copy of a historical config."""
    for destructive in ("rm -rf", "rm -f", "shred", "truncate"):
        assert destructive not in hygiene_text, f"{destructive!r} must not appear"
    assert "sites-backup" in hygiene_text  # moved aside, outside any include path


def test_fix_rolls_back_on_failed_config_test_or_regressed_host(hygiene_text):
    assert "rollback()" in hygiene_text
    assert "nginx -t || rollback" in hygiene_text
    assert "regressed" in hygiene_text


def test_fix_captures_a_baseline_before_moving(hygiene_text):
    """Rollback is only meaningful against a probe taken before the change."""
    body = hygiene_text
    assert "BASELINE=$(probe)" in body
    baseline_at = body.index("BASELINE=$(probe)")
    first_mv = body.index('mv "$SE/$b"')
    assert baseline_at < first_mv, "baseline must be captured before any file moves"


def test_symlinks_are_moved_only_when_named_in_disable(hygiene_text):
    """Every symlink points into sites-available and is a real vhost. Only a
    human naming it in `disable` may retire one (mira-preview, #3641)."""
    assert 'if [ -L "$SE/$b" ]; then' in hygiene_text
    branch = hygiene_text[hygiene_text.index('if [ -L "$SE/$b" ]; then') :]
    branch = branch[: branch.index('mv "$SE/$b"')]
    assert 'case " $DISABLE " in' in branch
    assert "continue" in branch, "an unnamed symlink must be skipped"


def test_disable_names_are_validated_before_reaching_the_root_shell(hygiene_text):
    """`disable` is interpolated into `sudo env ... bash -s` on the prod box."""
    guard = '[[ "$DISABLE" =~ $NAME_RE ]]'
    assert "NAME_RE='^[A-Za-z0-9._ -]*$'" in hygiene_text
    assert hygiene_text.count(guard) >= 2, "validate in the guard AND right before ssh"
    ssh_at = hygiene_text.index("DISABLE='${DISABLE}'")
    assert hygiene_text.rindex(guard, 0, ssh_at) < ssh_at


# --- the probe set matches reality -------------------------------------------


def test_chat_hostname_is_not_probed(hygiene_text):
    """chat.factorylm.com has NO DNS record (verified 2026-08-10) — it cannot
    serve, so probing it would fail the run for an unrelated reason. #3173's
    step 3 listed it."""
    hosts_line = next(
        line for line in hygiene_text.splitlines() if line.strip().startswith("HOSTS=")
    )
    assert "chat.factorylm.com" not in hosts_line


def test_probe_covers_the_hostnames_the_backups_shadow(hygiene_text):
    hosts_line = next(
        line for line in hygiene_text.splitlines() if line.strip().startswith("HOSTS=")
    )
    for host in ("factorylm.com", "www.factorylm.com", "app.factorylm.com", "cmms.factorylm.com"):
        assert host in hosts_line


def test_probe_pins_to_loopback(hygiene_text):
    """--resolve makes the probe test THIS box's nginx, not DNS or an edge cache."""
    assert "--resolve" in hygiene_text
    assert "127.0.0.1" in hygiene_text


# --- the deploy guard fails on any offender -----------------------------------


def test_deploy_guard_fails_on_an_unknown_offender(deploy_text):
    assert 'if [ -n "$unknown" ]; then' in deploy_text
    guard = deploy_text[deploy_text.index('if [ -n "$unknown" ]') :]
    assert "exit 1" in guard[:600]


def test_deploy_guard_is_strict_with_no_backlog(deploy_text):
    """The 10 backups KNOWN_PENDING tolerated lived on the retired DigitalOcean
    droplet; the OVH host has none (#3641). A tolerated backlog would now only
    hide a reintroduced backup, so the guard has no warn-only branch."""
    start = deploy_text.index("nginx sites-enabled hygiene")
    step = deploy_text[start : deploy_text.index("- name: Notify failure", start)]
    assert 'KNOWN_PENDING="' not in step
    for bak in _KNOWN_BAKS:
        assert bak not in step


def test_deploy_guard_is_read_only(deploy_text):
    """It runs against prod on every deploy — it must not mutate anything."""
    start = deploy_text.index("nginx sites-enabled hygiene")
    step = deploy_text[start : deploy_text.index("- name: Notify failure", start)]
    for mutating in ("mv ", "rm ", "systemctl reload", "nginx -s", "ln -s"):
        assert mutating not in step, f"{mutating!r} makes the deploy guard non-read-only"


@pytest.mark.parametrize(
    ("value", "accepted"),
    [
        ("", True),  # check mode + the weekly schedule pass no disable list
        ("mira-preview", True),
        ("a.b c-d", True),
        ("x;reboot", False),
        ("y$(id)", False),
        ("ok\nbad;x", False),  # a per-line check would pass each line
    ],
)
def test_disable_validation_behaves(hygiene_text, value, accepted):
    """Execute the workflow's own validation, not a string match: the
    `printf | grep` form rejected the EMPTY list and broke check mode."""
    line = next(ln.strip() for ln in hygiene_text.splitlines() if ln.strip().startswith("NAME_RE="))
    script = f'{line}\n[[ "$DISABLE" =~ $NAME_RE ]]'
    rc = subprocess.run(["bash", "-c", script], env={"DISABLE": value}, check=False).returncode
    assert (rc == 0) is accepted
