"""Bootstrap recovery tests for mira-ollama (F5).

Tests extract the REAL rendered startup command from docker compose config
and execute it under POSIX dash with a fake ollama executable. All operations
have bounded timeouts with accurate diagnostics.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
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
    """Extract mira-ollama startup command from rendered config."""
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
    
    # Compose renders command as a list, join it
    if isinstance(ollama_service["command"], list):
        return " ".join(ollama_service["command"])
    return ollama_service["command"]


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
        serve_behavior: "success", "die_immediately", "die_after_3s"
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
            elif [ "{serve_behavior}" = "die_after_3s" ]; then
                sleep 3
                exit 1
            else
                sleep 0.2
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


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_command_extracts():
    """Verify we can extract the real startup command from prod config."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    assert "ollama serve" in command
    assert "nomic-embed-text" in command
    assert "bounded_call" in command
    assert "now()" in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_command_extracts():
    """Verify we can extract the real startup command from staging config."""
    command = _render_ollama_command([STG])
    assert "ollama serve" in command
    assert "nomic-embed-text" in command
    assert "bounded_call" in command
    assert "now()" in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_happy_path_cold_start():
    """Happy path cold start: pull succeeds, digest verifies, serve stays up."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Empty list initially (cold start)
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="",
            pull_behavior="success",
        )
        
        # Override to provide correct list output after pull
        state_dir = tmp_path / ".ollama_state"
        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            if [ "$1" = "serve" ]; then
                touch "$STATE_DIR/serving"
                sleep 0.2
                touch "$STATE_DIR/ready"
                while true; do sleep 1; done
            elif [ "$1" = "list" ]; then
                if [ -f "$STATE_DIR/ready" ]; then
                    if [ -f "$STATE_DIR/pulled" ]; then
                        echo "nomic-embed-text:v1.5    0a109f422b47    128 MB    1 day ago"
                        echo "nomic-embed-text:latest   0a109f422b47    128 MB    1 day ago"
                    fi
                    exit 0
                fi
                exit 1
            elif [ "$1" = "pull" ]; then
                touch "$STATE_DIR/pulled"
                exit 0
            elif [ "$1" = "cp" ]; then
                exit 0
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)
        
        # Short caps for test speed
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "5",
            "OLLAMA_READY_CAP": "10",
        }
        
        # Run under dash with timeout
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "Bootstrap complete" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cached_offline_startup():
    """Model cached with correct digest + no network -> skip pull, succeed."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # List shows cached model
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB    1 day ago\nnomic-embed-text:latest   0a109f422b47    128 MB    1 day ago",
            pull_behavior="always_fail",  # Registry down
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "10",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "cached with digest" in result.stderr
        assert "skipping pull" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_list_in_readiness_loop():
    """Hung ollama list in readiness loop -> bounded exit with accurate diagnostic."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            hang_operation="list",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "5",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "ollama serve never became ready" in result.stderr
        assert "elapsed:" in result.stderr
        assert "cap:" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_pull_bounded_with_retries():
    """Hung ollama pull is bounded per-attempt and retries advance."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="",  # Empty, need pull
            hang_operation="pull",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "3",
            "OLLAMA_READY_CAP": "10",
            "OLLAMA_PULL_RETRIES": "2",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        # Should see timeout diagnostic
        assert "ollama pull timed out" in result.stderr or "ollama pull exited 124" in result.stderr
        assert "Failed to pull" in result.stderr
        # Should see multiple attempts
        assert "attempt 1" in result.stderr
        assert "attempt 2" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_cp_bounded():
    """Hung ollama cp is bounded with accurate timeout diagnostic."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # v1.5 exists but :latest missing, cp will hang
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB    1 day ago",
            hang_operation="cp",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "3",
            "OLLAMA_READY_CAP": "10",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "ollama cp timed out" in result.stderr or "ollama cp exited 124" in result.stderr
        assert "cap:" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cp_fails_nonzero():
    """ollama cp exits non-zero -> accurate diagnostic with exit code."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # v1.5 exists, cp fails
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB    1 day ago",
            cp_behavior="fail",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "3",
            "OLLAMA_READY_CAP": "10",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "ollama cp exited 9" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_serve_dies_before_ready():
    """Serve dies before ready -> bounded exit with accurate elapsed time."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="die_immediately",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "10",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "ollama serve died before ready" in result.stderr
        assert "after" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_pull_fails_all_retries():
    """Pull fails every retry -> accurate diagnostic."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="",
            pull_behavior="always_fail",
        )
        
        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "3",
            "OLLAMA_READY_CAP": "10",
            "OLLAMA_PULL_RETRIES": "3",
        }
        
        result = subprocess.run(
            ["dash", "-c", command],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            cwd=str(tmp_path),
        )
        
        assert result.returncode != 0
        assert "Failed to pull" in result.stderr
        assert "3 attempts" in result.stderr
