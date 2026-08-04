"""tools/predeploy_log_capture.sh — behavior tests via a fake `ssh` shim.

The force-recreate deploy destroys the previous container's json-file logs
(2026-08-04: the E1 production F004 trace was unrecoverable). The capture
script must preserve a REDACTED bundle before the recreate, and its failure
modes must warn without failing (exit 0 always — availability over
observability, the documented policy).
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "tools" / "predeploy_log_capture.sh"

SAMPLE_LOG = """2026-08-04T12:27:36Z [INFO] HTTP Request: POST https://api.telegram.org/bot12345:AAAbbbCCC-ddd/getUpdates "HTTP/1.1 200 OK"
2026-08-04T12:27:36Z [INFO] Received from Mike: "My PowerFlex 525 keeps tripping
2026-08-04T12:27:36Z [INFO] DISPATCH_ADMIN_BYPASS platform=telegram ext=8445149012 tenant=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe
2026-08-04T12:27:37Z [INFO] ROUTER intent=diagnose_equipment confidence=0.95 chat_id=telegram:8445149012
"""


def _fake_ssh(tmp_path: Path, inspect_out: str | None, logs_out: str | None) -> Path:
    """A PATH-shimmed `fakessh` that answers docker inspect / docker logs."""
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    inspect_file = tmp_path / "inspect.txt"
    logs_file = tmp_path / "logs.txt"
    if inspect_out is not None:
        inspect_file.write_text(inspect_out, encoding="utf-8")
    if logs_out is not None:
        logs_file.write_text(logs_out, encoding="utf-8")
    shim = bindir / "fakessh"
    shim.write_text(
        "#!/usr/bin/env bash\n"
        f'INSPECT="{inspect_file.as_posix()}"\n'
        f'LOGS="{logs_file.as_posix()}"\n'
        'case "$*" in\n'
        '  *"docker inspect"*) [ -f "$INSPECT" ] && cat "$INSPECT" || exit 1 ;;\n'
        '  *"docker logs"*)    [ -f "$LOGS" ] && cat "$LOGS" || exit 1 ;;\n'
        "  *) exit 1 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    shim.chmod(0o755)
    return shim


def _run(tmp_path: Path, shim: Path) -> tuple[subprocess.CompletedProcess, Path]:
    out_dir = tmp_path / "bundle"
    import os
    import shutil

    bash = shutil.which("bash")
    env = dict(os.environ)
    env.update(
        {
            "SSH_CMD": f"{bash} {shim.as_posix()}",
            "OUT_DIR": out_dir.as_posix(),
            "CONTAINER": "mira-bot-telegram",
        }
    )
    proc = subprocess.run([bash, str(SCRIPT)], env=env, capture_output=True, text=True)
    return proc, out_dir


def test_existing_container_produces_redacted_bundle_with_checksum(tmp_path):
    shim = _fake_ssh(tmp_path, "abc123 sha256:img 2026-08-04T11:51:23Z json-file {}", SAMPLE_LOG)
    proc, out = _run(tmp_path, shim)
    assert proc.returncode == 0, proc.stderr
    red = out / "mira-bot-telegram-predeploy-redacted.log"
    meta = (out / "metadata.txt").read_text(encoding="utf-8")
    text = red.read_text(encoding="utf-8")

    # redaction — tokens, ids, message bodies, uuids
    assert "AAAbbbCCC" not in text and "bot<redacted>" in text
    assert "8445149012" not in text
    assert "My PowerFlex 525" not in text and "[USER]: [REDACTED]" in text
    assert "e88bd0e8" not in text and "[UUID]" in text
    # timestamps preserved
    assert "2026-08-04T12:27:36Z" in text

    # metadata: docker facts + counts + checksum matches the file
    assert "status=captured" in meta
    assert "json-file" in meta
    sha = hashlib.sha256(red.read_bytes()).hexdigest()
    assert f"redacted_sha256={sha}" in meta
    assert "redacted_lines=4" in meta


def test_missing_container_warns_and_exits_zero(tmp_path):
    shim = _fake_ssh(tmp_path, None, None)
    proc, out = _run(tmp_path, shim)
    assert proc.returncode == 0
    assert "::warning::" in proc.stdout
    assert "status=not_found" in (out / "metadata.txt").read_text(encoding="utf-8")


def test_empty_logs_still_produce_a_bundle(tmp_path):
    shim = _fake_ssh(tmp_path, "abc123 sha256:img 2026-08-04T11:51:23Z json-file {}", "")
    proc, out = _run(tmp_path, shim)
    assert proc.returncode == 0, proc.stderr
    meta = (out / "metadata.txt").read_text(encoding="utf-8")
    assert "status=captured" in meta
    assert "redacted_lines=0" in meta
    assert (out / "mira-bot-telegram-predeploy-redacted.log").exists()
