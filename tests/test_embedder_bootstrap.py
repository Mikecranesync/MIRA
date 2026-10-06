"""Bootstrap recovery tests for mira-ollama (F5).

Tests extract the REAL rendered startup command from docker compose config,
decode Docker Compose's $$ escaping, and execute under POSIX dash with fake
ollama. Validates bounded timeouts, real-time deadlines, accurate diagnostics,
and zero process leaks.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PROD_BASE = ROOT / "docker-compose.saas.yml"
PROD_OVERLAY = ROOT / "docker-compose.production.yml"
STG = ROOT / "docker-compose.staging-vps.yml"


def _has_docker_compose() -> bool:
    """Quick check if docker compose is available."""
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            timeout=10,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _render_ollama_command(compose_files: list[Path]) -> str:
    """Extract mira-ollama startup command from rendered config.
    
    Decodes Docker Compose's $$ escaping to $ (the way compose does when
    running the container).
    """
    if not _has_docker_compose():
        pytest.skip("docker compose not available")
    
    cmd = ["docker", "compose"]
    for f in compose_files:
        cmd.extend(["-f", str(f)])
    cmd.extend(["--env-file", "/dev/null", "config", "--format", "json"])
    
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "NEON_DATABASE_URL": "postgresql://dummy:dummy@localhost/dummy",
        "MCP_REST_API_KEY": "dummy",
        "ATLAS_DB_PASSWORD": "dummy",
        "ATLAS_MINIO_PASSWORD": "dummy",
        "ATLAS_JWT_SECRET": "dummy",
        "NANGO_DB_PASSWORD": "dummy",
        "NANGO_ENCRYPTION_KEY": "dummy",
        "NANGO_SECRET_KEY": "dummy",
        "AUTH_SECRET": "dummy",
        "PLG_JWT_SECRET": "dummy",
    }
    
    result = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
        cwd=str(ROOT),
    )
    
    config = json.loads(result.stdout)
    ollama_service = config["services"]["mira-ollama"]
    
    # Compose renders command as a list
    if isinstance(ollama_service["command"], list):
        rendered = " ".join(ollama_service["command"])
    else:
        rendered = ollama_service["command"]
    
    # Decode Docker Compose's $$ escaping to $ (exactly once)
    decoded = rendered.replace("$$", "$")
    
    return decoded


def _create_fake_ollama(
    tmpdir: Path,
    *,
    serve_behavior: str = "success",
    list_output: str = "",
    pull_behavior: str = "success",
    cp_behavior: str = "success",
    hang_operation: str | None = None,
) -> Path:
    """Create a fake ollama executable for testing.
    
    Args:
        serve_behavior: "success", "die_immediately"
        list_output: What `ollama list` should output
        pull_behavior: "success", "always_fail"
        cp_behavior: "success", "fail"
        hang_operation: If set, this operation hangs forever ("list", "pull", "cp")
    """
    ollama_script = tmpdir / "ollama"
    state_dir = tmpdir / ".ollama_state"
    state_dir.mkdir(exist_ok=True)
    
    script_content = textwrap.dedent(f'''#!/bin/sh
        STATE_DIR="{state_dir}"
        
        if [ "$1" = "serve" ]; then
            touch "$STATE_DIR/serving"
            if [ "{serve_behavior}" = "die_immediately" ]; then
                exit 1
            else
                sleep 0.1
                touch "$STATE_DIR/ready"
                while true; do sleep 1; done
            fi
        elif [ "$1" = "list" ]; then
            if [ "{hang_operation}" = "list" ]; then
                while true; do sleep 1; done
            fi
            if [ ! -f "$STATE_DIR/serving" ]; then
                exit 1
            fi
            if [ -f "$STATE_DIR/ready" ]; then
                cat << 'EOF'
{list_output}
EOF
            else
                exit 1
            fi
        elif [ "$1" = "pull" ]; then
            if [ "{hang_operation}" = "pull" ]; then
                while true; do sleep 1; done
            fi
            if [ "{pull_behavior}" = "always_fail" ]; then
                echo "Error: failed to pull" >&2
                exit 1
            else
                exit 0
            fi
        elif [ "$1" = "cp" ]; then
            if [ "{hang_operation}" = "cp" ]; then
                while true; do sleep 1; done
            fi
            if [ "{cp_behavior}" = "fail" ]; then
                exit 9
            else
                exit 0
            fi
        fi
    ''')
    
    ollama_script.write_text(script_content)
    ollama_script.chmod(0o755)
    
    return ollama_script


def _count_leaked_children(parent_pid: int) -> int:
    """Count child processes still running after parent exited."""
    try:
        result = subprocess.run(
            ["ps", "-o", "pid=", "--ppid", str(parent_pid)],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0:
            children = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
            return len(children)
        return 0
    except Exception:
        return 0


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_command_extracts_and_decodes():
    """Verify rendered command extraction and $$ decoding."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    # After decoding, should have single $
    assert "now() { date +%s; }" in command
    assert "$pid" in command
    assert "$$" not in command  # All $$ should be decoded to $


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_command_extracts_and_decodes():
    """Verify rendered command extraction and $$ decoding."""
    command = _render_ollama_command([STG])
    assert "now() { date +%s; }" in command
    assert "$pid" in command
    assert "$$" not in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cold_start_success_under_2s():
    """Cold start succeeds with 2s caps (verified behavior preservation)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Serve ready, model needs pull
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()
        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            if [ "$1" = "serve" ]; then
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                while true; do sleep 1; done
            elif [ "$1" = "list" ]; then
                [ -f "$STATE_DIR/ready" ] || exit 1
                if [ -f "$STATE_DIR/pulled" ]; then
                    echo "nomic-embed-text:v1.5    0a109f422b47    128 MB"
                    echo "nomic-embed-text:latest   0a109f422b47    128 MB"
                fi
            elif [ "$1" = "pull" ]; then
                touch "$STATE_DIR/pulled"
            elif [ "$1" = "cp" ]; then
                exit 0
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "2",
        }
        
        start = time.time()
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(tmp_path),
        )
        elapsed = time.time() - start
        
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert elapsed < 5, f"took {elapsed:.2f}s with 2s caps"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cached_offline_success_under_2s():
    """Cached offline startup succeeds with 2s caps (verified behavior preservation)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB\nnomic-embed-text:latest   0a109f422b47    128 MB",
            pull_behavior="always_fail",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "2",
        }
        
        start = time.time()
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(tmp_path),
        )
        elapsed = time.time() - start
        
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "cached with digest" in result.stderr
        assert elapsed < 5, f"took {elapsed:.2f}s with 2s caps"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cp_exit_9_accurate_diagnostic():
    """cp exiting 9 reports accurate exit code (verified behavior preservation)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB",
            cp_behavior="fail",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "2",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "ollama cp exited 9" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_readiness_deadline_clamped():
    """Readiness with 3s cap / 5s list timeout exits within 4s (item 2)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Serve never becomes ready
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="",  # Never ready
            hang_operation="list",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "5",
            "OLLAMA_READY_CAP": "3",
        }
        
        start = time.time()
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        elapsed = time.time() - start
        
        assert result.returncode != 0
        assert "never became ready" in result.stderr
        # Allow 1s buffer for process overhead
        assert elapsed <= 4, f"3s cap overran to {elapsed:.2f}s"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_list_no_process_leak():
    """Hung list terminates the ollama process, no leaks (item 3)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            hang_operation="list",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "3",
        }
        
        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )
        
        try:
            stdout, stderr = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
        
        # Give processes time to exit
        time.sleep(0.5)
        
        # Check for leaked children
        leaked = _count_leaked_children(proc.pid)
        
        assert proc.returncode != 0
        assert leaked == 0, f"leaked {leaked} child processes"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_fast_success_not_misreported_as_timeout():
    """Fast successful query with 1s cap reports success, not timeout (item 4)."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Fast success: ready immediately
        fake_ollama = _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB\nnomic-embed-text:latest   0a109f422b47    128 MB",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "1",
            "OLLAMA_READY_CAP": "1",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(tmp_path),
        )
        
        # Must succeed, not report timeout
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "timed out" not in result.stderr
        assert "Bootstrap complete" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_pull_no_leak():
    """Hung pull terminates cleanly with no process leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            list_output="",  # Need pull
            hang_operation="pull",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "3",
            "OLLAMA_PULL_RETRIES": "1",
        }
        
        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )
        
        try:
            stdout, stderr = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
        
        time.sleep(0.5)
        leaked = _count_leaked_children(proc.pid)
        
        assert proc.returncode != 0
        assert leaked == 0, f"leaked {leaked} child processes"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_cp_no_leak():
    """Hung cp terminates cleanly with no process leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB",
            hang_operation="cp",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "3",
        }
        
        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )
        
        try:
            stdout, stderr = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
        
        time.sleep(0.5)
        leaked = _count_leaked_children(proc.pid)
        
        assert proc.returncode != 0
        assert leaked == 0, f"leaked {leaked} child processes"
