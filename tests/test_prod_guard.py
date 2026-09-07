"""Executable coverage for tools/hooks/prod-guard.sh — the production-mutation floor.

Written 2026-09-07 after the guard was made to fail on the regression it names and a real
bypass fell out: `PROD_HOST` required a space or end-of-string after an ssh alias, but
scp/rsync address a host as `host:path`, so the character after the alias is a colon.
`scp ./x.py prod:/opt/mira/x.py` and `rsync -a ./dist/ prod:/opt/mira/` were ALLOWED while
the identical commands written against the IP or `root@` were denied — i.e. the first class
HARD_DENY names ("scp/rsync TO prod") was bypassable by the most natural way to type it,
using an alias that is configured in ~/.ssh/config.

TWO DISCIPLINES THIS FILE ENCODES, both learned the hard way while auditing this guard:

1. Read the DECISION, not the exit code. These hooks always exit 0 and emit
   `permissionDecision` as JSON on stdout. An audit harness that read exit codes reported
   every regression as "allow" — a guard that looked dead and was not.
2. Every all-allow result needs a positive control proving the probe reaches the decision
   path. A second harness matched `"permissionDecision":"deny"` literally and so could not
   see `json.dumps` output, which separates the colon with a space. Same wrong answer, a
   different mechanism. `test_the_probe_reaches_the_decision_path` is that control: if it
   fails, every other assertion in this file is meaningless.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / "tools" / "hooks" / "prod-guard.sh"


def decision(command: str) -> str:
    """'deny' or 'allow' — parsed from the hook's stdout JSON, never from its exit code."""
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    out = subprocess.run(
        ["bash", str(HOOK)], input=payload, capture_output=True, text=True
    ).stdout.strip()
    if not out:
        return "allow"  # the hook prints nothing when it permits
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"]


def test_the_probe_reaches_the_decision_path() -> None:
    """Control. A known-deny must deny and a known-allow must allow, so an all-allow result
    below can never be mistaken for a working guard reached by a broken probe."""
    assert decision('ssh prod "docker compose restart mira-web-saas"') == "deny"
    assert decision('ssh prod "docker ps"') == "allow"


@pytest.mark.parametrize(
    "command",
    [
        # the regression: ssh-alias form, colon immediately after the host
        "scp ./x.py prod:/opt/mira/x.py",
        "scp ./x.py prod-public:/opt/mira/x.py",
        "rsync -a ./dist/ prod:/opt/mira/dist/",
        "rsync -avz ./build/ prod-public:/opt/mira/build/",
        # the forms that were already covered — kept so a fix cannot trade one for the other
        "scp ./x.py root@165.245.138.91:/opt/mira/x.py",
        "rsync -a ./dist/ root@165.245.138.91:/opt/mira/",
        "scp ./x.py factorylm-prod:/opt/mira/x.py",
    ],
)
def test_writing_to_prod_is_denied_however_the_host_is_addressed(command: str) -> None:
    assert decision(command) == "deny", f"prod write escaped the guard: {command}"


@pytest.mark.parametrize(
    "command",
    [
        'ssh prod "docker compose restart mira-web-saas"',
        'ssh prod "nginx -s reload"',
        'ssh prod "systemctl restart mira-pipeline"',
        "docker compose -f docker-compose.saas.yml up -d",
        "kubectl rollout restart deployment/mira",
    ],
)
def test_prod_service_mutations_are_denied(command: str) -> None:
    assert decision(command) == "deny", f"prod mutation escaped the guard: {command}"


@pytest.mark.parametrize(
    "command",
    [
        'ssh prod "docker ps"',  # read-only inspection of prod is allowed
        'ssh prod "cat /opt/mira/docker-compose.saas.yml"',
        "scp ./x.py bravo:/Users/bravonode/x.py",  # a NON-prod host over the same tool
        "rsync -a ./dist/ bravo-lan:/tmp/",
        "ls -la /Users/charlienode/MIRA",
        "echo prod:",  # the word alone is not an invocation
        "git commit -m 'prod: fix'",  # nor is it in a message
    ],
)
def test_legitimate_commands_are_not_over_blocked(command: str) -> None:
    assert decision(command) == "allow", f"guard over-blocks: {command}"


def test_the_host_pattern_accepts_a_colon_after_an_alias() -> None:
    """The one-character fix, asserted structurally so a future edit that drops it is caught
    by name rather than only by the behavioural cases above."""
    source = HOOK.read_text()
    assert "PROD_HOST=" in source
    line = next(ln for ln in source.splitlines() if ln.startswith("PROD_HOST="))
    assert "[[:space:]]|:|$" in line, (
        "PROD_HOST no longer accepts ':' after an ssh alias — scp/rsync to prod is bypassable again"
    )


# --------------------------------------------------------------------------------------
# The Stop-hook chain. Not prod-guard, but the same failure class: a guard that can be
# silently nullified by something adjacent to it.
# --------------------------------------------------------------------------------------

SETTINGS = Path(__file__).resolve().parents[1] / ".claude" / "settings.json"


def test_nothing_after_stop_gate_in_the_chain_writes_to_stdout() -> None:
    """`.claude/settings.json` chains two Stop hooks on one command line:

        bash tools/hooks/stop-gate.sh; bash .claude/hooks/stop.sh

    They share one stdout. stop-gate signals a block by printing
    `{"decision":"block"}`; if anything chained AFTER it also printed, the harness would
    read the wrong object and the gate would stop working with no test noticing.

    Asserted as the property itself — every command after the first must print NOTHING —
    rather than by running the whole chain. The chain's own output only proves this in the
    *blocking* state; in the ordinary clean state stop-gate emits a lone approve and there
    is nothing to bury, so a chain-level assertion passes whether or not the property holds.
    (Verified 2026-09-07: an earlier version of this test did exactly that and stayed green
    under a mutation that made the second hook print a decision.)
    """
    settings = json.loads(SETTINGS.read_text())
    repo = SETTINGS.parents[1]
    checked = 0
    for group in settings.get("hooks", {}).get("Stop", []):
        for hook in group.get("hooks", []):
            command = hook.get("command", "")
            if "stop-gate.sh" not in command:
                continue
            parts = [seg.strip() for seg in command.split(";") if seg.strip()]
            assert parts and "stop-gate.sh" in parts[0], (
                f"stop-gate must run FIRST in its chain, else its decision is not the first "
                f"object on stdout: {command!r}"
            )
            for later in parts[1:]:
                out = subprocess.run(
                    ["bash", "-c", later], input="", capture_output=True, text=True, cwd=str(repo)
                ).stdout
                assert out.strip() == "", (
                    f"{later!r} runs after stop-gate.sh on a shared stdout and printed "
                    f"{out.strip()[:120]!r} — this buries stop-gate's decision and silently "
                    f"disables the gate"
                )
                checked += 1
    assert checked, "no command is chained after stop-gate.sh — update this test if that changed"
