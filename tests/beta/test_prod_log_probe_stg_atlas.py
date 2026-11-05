"""The stg-atlas-signin probe publishes to PUBLIC Actions logs (#5205).

These tests run the exact remote script from .github/workflows/prod-log-probe.yml
(the body of the ENDSSH heredoc) with a fake `docker` on PATH, followed by the
workflow's own redaction chain. Only container state, row counts and exception
class names may surface; never an email, password hash or message text. A
failed read must exit 3 with a fixed message, never print a partial success.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "prod-log-probe.yml"


def _redaction_chain() -> str:
    text = WORKFLOW.read_text()
    start = text.index("sed -E 's/(password|")
    end = text.index("{32,}/[redacted]/g'", start) + len("{32,}/[redacted]/g'")
    return text[start:end].replace(' "$RUNNER_TEMP/probe.raw"', "")


ATLAS_LOG = """\
2026-11-05 WARN signin failed for jane.doe@example.com
com.grash.exception.CustomException: Invalid credentials for jane.doe@example.com
\tat com.grash.service.UserService.signin(UserService.java:115)
"""


def _remote_script() -> str:
    text = WORKFLOW.read_text()
    start = text.index("<< 'ENDSSH'")
    start = text.index("\n", start) + 1
    end = text.index("\n          ENDSSH", start)
    lines = text[start:end].split("\n")
    return "\n".join(line[10:] if line.startswith(" " * 10) else line for line in lines) + "\n"


def _fake_docker(tmp_path: Path, exec_rc: int = 0) -> Path:
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "atlas.log"
    log.write_text(ATLAS_LOG)
    docker = bindir / "docker"
    docker.write_text(
        "#!/bin/bash\n"
        'case "$1" in\n'
        '  inspect) echo "running health=healthy started=2026-11-05T04:10:00Z" ;;\n'
        f'  exec) [ {exec_rc} -eq 0 ] || exit {exec_rc}; echo "1 1 0" ;;\n'
        f'  logs) cat "{log}" ;;\n'
        "  *) exit 9 ;;\n"
        "esac\n"
    )
    docker.chmod(0o755)
    return bindir


def _run(tmp_path: Path, probe: str, exec_rc: int = 0) -> subprocess.CompletedProcess:
    script = tmp_path / "remote.sh"
    script.write_text(_remote_script())
    env = {**os.environ, "PATH": f"{_fake_docker(tmp_path, exec_rc)}:{os.environ['PATH']}"}
    raw = subprocess.run(["bash", str(script), probe], capture_output=True, text=True, env=env)
    red = subprocess.run(
        ["bash", "-c", _redaction_chain()],
        input=raw.stdout + raw.stderr,
        capture_output=True,
        text=True,
        cwd=REPO,
        check=True,
    )
    return subprocess.CompletedProcess(raw.args, raw.returncode, red.stdout, "")


def test_stg_probe_reports_state_counts_and_class_names_only(tmp_path):
    out = _run(tmp_path, "stg-atlas-signin")
    assert out.returncode == 0, out.stdout
    assert "stg-atlas-api: running health=healthy" in out.stdout
    assert "stg-atlas-db: running health=healthy" in out.stdout
    assert "own_user total enabled disabled: 1 1 0" in out.stdout
    assert "com.grash.exception.CustomException" in out.stdout
    assert "at com.grash.service.UserService.signin(UserService.java:115)" in out.stdout
    assert "@" not in out.stdout
    assert "jane" not in out.stdout
    assert "Invalid credentials" not in out.stdout


def test_stg_probe_fails_closed_when_user_count_unreadable(tmp_path):
    out = _run(tmp_path, "stg-atlas-signin", exec_rc=1)
    assert out.returncode == 3
    assert "PROBE FAILED: could not count staging Atlas users" in out.stdout
    assert "own_user total" not in out.stdout


def test_prod_atlas_errors_probe_still_uses_shared_filter(tmp_path):
    out = _run(tmp_path, "atlas-api-errors")
    assert out.returncode == 0, out.stdout
    assert "com.grash.exception.CustomException" in out.stdout
    assert "@" not in out.stdout
