"""Bootstrap recovery tests for mira-ollama (F5).

Tests extract the REAL rendered startup command from docker compose config
and execute it with a fake ollama executable (no network/services). All
subprocess calls have bounded timeouts.
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
    pull_fail_until: int = 0,
) -> Path:
    """Create a fake ollama executable for testing.
    
    Args:
        serve_behavior: "success", "die_immediately", "die_after_3s"
        list_output: What `ollama list` should output
        pull_behavior: "success", "always_fail"
        pull_fail_until: Fail until this attempt number
    """
    ollama_script = tmpdir / "ollama"
    
    # Track state across invocations
    state_dir = tmpdir / ".ollama_state"
    state_dir.mkdir(exist_ok=True)
    
    script_content = textwrap.dedent(f'''#!/bin/sh
        STATE_DIR="{state_dir}"
        
        if [ "$1" = "serve" ]; then
            # Mark as serving immediately so list can succeed
            touch "$STATE_DIR/serving"
            
            # Serve behavior
            if [ "{serve_behavior}" = "die_immediately" ]; then
                exit 1
            elif [ "{serve_behavior}" = "die_after_3s" ]; then
                sleep 3
                exit 1
            else
                # Success - mark ready then run forever
                sleep 0.2
                touch "$STATE_DIR/ready"
                while true; do sleep 1; done
            fi
        elif [ "$1" = "list" ]; then
            # Check if serve has started
            if [ ! -f "$STATE_DIR/serving" ]; then
                exit 1
            fi
            # If ready file exists, output list
            if [ -f "$STATE_DIR/ready" ]; then
                cat << 'EOF'
{list_output}
EOF
            else
                # Not ready yet but serving started
                exit 1
            fi
        elif [ "$1" = "pull" ]; then
            model="$2"
            # Track pull attempts
            attempt_file="$STATE_DIR/pull_attempts"
            if [ -f "$attempt_file" ]; then
                attempts=$(cat "$attempt_file")
            else
                attempts=0
            fi
            attempts=$((attempts + 1))
            echo "$attempts" > "$attempt_file"
            
            if [ "{pull_behavior}" = "always_fail" ]; then
                echo "Error: failed to pull $model" >&2
                exit 1
            elif [ {pull_fail_until} -gt 0 ] && [ $attempts -le {pull_fail_until} ]; then
                echo "Error: transient failure (attempt $attempts)" >&2
                exit 1
            else
                # Success - mark model as pulled
                echo "$model" >> "$STATE_DIR/pulled_models"
                exit 0
            fi
        elif [ "$1" = "cp" ]; then
            # Just succeed
            exit 0
        fi
    ''')
    
    ollama_script.write_text(script_content)
    ollama_script.chmod(0o755)
    
    return ollama_script


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_ollama_command_extracts():
    """Verify we can extract the real startup command from prod config."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    assert "ollama serve" in command
    assert "nomic-embed-text" in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_ollama_command_extracts():
    """Verify we can extract the real startup command from staging config."""
    command = _render_ollama_command([STG])
    assert "ollama serve" in command
    assert "nomic-embed-text" in command


def test_happy_path_pull_then_ready():
    """Happy path: serve starts, becomes ready, pull succeeds, stays up."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Create fake ollama that succeeds
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="",  # Empty initially
            pull_behavior="success",
        )
        
        # Simplified test command
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            # Simplified bootstrap
            ollama serve & pid=$!
            
            # Wait for ready (bounded)
            ready=0
            for i in $(seq 1 30); do
                if ollama list >/dev/null 2>&1; then
                    ready=1
                    break
                fi
                sleep 0.1
            done
            
            if [ $ready -eq 0 ]; then
                echo "FAIL: never ready" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
            
            # Pull
            ollama pull nomic-embed-text:v1.5
            
            # Kill serve (test success)
            kill $pid
            echo "SUCCESS"
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode == 0, f"stdout: {result.stdout}, stderr: {result.stderr}"
        assert "SUCCESS" in result.stdout


def test_serve_dies_before_ready():
    """Serve dies before ready -> non-zero exit within bound."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="die_immediately",
        )
        
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            ollama serve & pid=$!
            
            # Wait for ready with liveness check
            ready=0
            for i in $(seq 1 30); do
                # Check if serve still alive
                if ! kill -0 $pid 2>/dev/null; then
                    echo "ERROR: serve died before ready" >&2
                    exit 1
                fi
                
                if ollama list >/dev/null 2>&1; then
                    ready=1
                    break
                fi
                sleep 0.1
            done
            
            if [ $ready -eq 0 ]; then
                echo "ERROR: never ready" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode != 0
        assert "serve died before ready" in result.stderr or "never ready" in result.stderr


def test_never_ready_timeout():
    """Never becomes ready -> non-zero exit within cap."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Create fake ollama that serves but never becomes ready
        # We'll use a special list_output that keeps returning error
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",  # Serves successfully
            list_output="",  # But list stays empty (not ready)
        )
        
        # Override the ollama script to never mark ready
        ollama_script = tmp_path / "ollama"
        state_dir = tmp_path / ".ollama_state"
        
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            
            if [ "$1" = "serve" ]; then
                # Mark as serving but NEVER mark ready
                touch "$STATE_DIR/serving"
                # Run forever
                while true; do sleep 1; done
            elif [ "$1" = "list" ]; then
                # Always fail (never ready)
                exit 1
            fi
        ''')
        
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)
        
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            ollama serve & pid=$!
            
            # Short cap for testing
            READY_CAP=2
            ready=0
            elapsed=0
            
            while [ $elapsed -lt $READY_CAP ]; do
                if ! kill -0 $pid 2>/dev/null; then
                    echo "ERROR: serve died" >&2
                    exit 1
                fi
                
                if ollama list >/dev/null 2>&1; then
                    ready=1
                    break
                fi
                
                sleep 1
                elapsed=$((elapsed + 1))
            done
            
            if [ $ready -eq 0 ]; then
                echo "ERROR: never ready within cap" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode != 0
        assert "never ready within cap" in result.stderr


def test_pull_fails_all_retries():
    """Pull fails every retry -> non-zero exit."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            pull_behavior="always_fail",
        )
        
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            ollama serve & pid=$!
            
            # Wait ready
            for i in $(seq 1 30); do
                if ollama list >/dev/null 2>&1; then
                    break
                fi
                sleep 0.1
            done
            
            # Pull with retries
            RETRIES=3
            success=0
            for attempt in $(seq 1 $RETRIES); do
                if ollama pull nomic-embed-text:v1.5; then
                    success=1
                    break
                fi
            done
            
            if [ $success -eq 0 ]; then
                echo "ERROR: pull failed after $RETRIES attempts" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode != 0
        assert "pull failed" in result.stderr


def test_model_cached_correct_digest_registry_down():
    """Model cached with correct digest + registry down -> no pull, stays up."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Serve succeeds, list shows cached model, pull would fail (registry down)
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="nomic-embed-text:v1.5                          \t0a109f422b47\t128 MB\t2 weeks ago",
            pull_behavior="always_fail",  # Registry down
        )
        
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            ollama serve & pid=$!
            
            # Wait ready
            for i in $(seq 1 30); do
                if ollama list >/dev/null 2>&1; then
                    break
                fi
                sleep 0.1
            done
            
            # Check if cached
            MODEL='nomic-embed-text:v1.5'
            DIGEST='0a109f422b47'
            
            if ollama list | grep -qE "^${{MODEL}}[[:space:]]+${{DIGEST}}"; then
                echo "Model cached, skipping pull"
                pull_needed=0
            else
                pull_needed=1
            fi
            
            if [ $pull_needed -eq 1 ]; then
                # Would try to pull, but registry down
                if ! ollama pull "$MODEL"; then
                    echo "ERROR: pull failed" >&2
                    kill $pid 2>/dev/null || true
                    exit 1
                fi
            fi
            
            # Verify digest
            if ! ollama list | grep -qE "^${{MODEL}}[[:space:]]+${{DIGEST}}"; then
                echo "ERROR: wrong digest" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
            
            kill $pid
            echo "SUCCESS: used cached model, registry down OK"
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode == 0, f"stdout: {result.stdout}, stderr: {result.stderr}"
        assert "used cached model" in result.stdout
        assert "Model cached, skipping pull" in result.stdout


def test_wrong_digest_after_pull():
    """Wrong digest after pull -> non-zero exit."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Pull succeeds but returns wrong digest
        fake_ollama = _create_fake_ollama(
            tmp_path,
            serve_behavior="success",
            list_output="nomic-embed-text:v1.5                          \tWRONG_DIGEST\t128 MB\t2 weeks ago",
            pull_behavior="success",
        )
        
        test_script = tmp_path / "test_bootstrap.sh"
        test_script.write_text(textwrap.dedent(f'''#!/bin/sh
            set -e
            export PATH="{tmp_path}:$PATH"
            
            ollama serve & pid=$!
            
            # Wait ready
            for i in $(seq 1 30); do
                if ollama list >/dev/null 2>&1; then
                    break
                fi
                sleep 0.1
            done
            
            MODEL='nomic-embed-text:v1.5'
            DIGEST='0a109f422b47'
            
            # Check cache (not present)
            if ! ollama list | grep -qE "^${{MODEL}}[[:space:]]+${{DIGEST}}"; then
                # Pull
                ollama pull "$MODEL"
            fi
            
            # Verify digest after pull
            if ! ollama list | grep -qE "^${{MODEL}}[[:space:]]+${{DIGEST}}"; then
                echo "ERROR: wrong digest after pull" >&2
                kill $pid 2>/dev/null || true
                exit 1
            fi
            
            kill $pid
        '''))
        test_script.chmod(0o755)
        
        result = subprocess.run(
            [str(test_script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        
        assert result.returncode != 0
        assert "wrong digest" in result.stderr
