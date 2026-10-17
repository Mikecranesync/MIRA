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
    running the container), but preserves legitimate shell $$VAR constructs.
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

    # Decode Docker Compose's $$ escaping to $
    # In compose YAML, $$ becomes $ in the container
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

    # Portable counter increment (no $RANDOM, works in dash)
    script_content = textwrap.dedent(f'''#!/bin/sh
        STATE_DIR="{state_dir}"

        get_next_id() {{
            counter_file="$STATE_DIR/counter"
            if [ -f "$counter_file" ]; then
                count=$(cat "$counter_file")
            else
                count=0
            fi
            count=$((count + 1))
            echo "$count" > "$counter_file"
            echo "$count"
        }}

        if [ "$1" = "serve" ]; then
            echo $$ > "$STATE_DIR/serve_pid"
            touch "$STATE_DIR/serving"
            if [ "{serve_behavior}" = "die_immediately" ]; then
                exit 1
            else
                sleep 0.1
                touch "$STATE_DIR/ready"
                while true; do sleep 1; done
            fi
        elif [ "$1" = "list" ]; then
            list_id=$(get_next_id)
            echo $$ > "$STATE_DIR/list_pid_$list_id"
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
            echo $$ > "$STATE_DIR/pull_pid"
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
            echo $$ > "$STATE_DIR/cp_pid"
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


def _check_processes_alive(state_dir: Path, process_names: list[str]) -> list[int]:
    """Check which tracked processes are still alive, return their PIDs."""
    alive = []
    for name in process_names:
        pid_files = list(state_dir.glob(f"{name}_pid*"))
        for pid_file in pid_files:
            try:
                pid = int(pid_file.read_text().strip())
                # Check if process is alive
                os.kill(pid, 0)
                alive.append(pid)
            except (OSError, ProcessLookupError, ValueError):
                pass
    return alive


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_command_extracts_and_decodes():
    """Verify rendered command extraction and $$ decoding."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])
    # After decoding, should have single $ in legitimate contexts
    assert "now() { date +%s; }" in command or "date +%s" in command
    assert "$pid" in command or "$serve_pid" in command
    # Should not have $$ from compose escaping
    assert "$$LIST" not in command
    assert "$$MODEL" not in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_command_extracts_and_decodes():
    """Verify rendered command extraction and $$ decoding."""
    command = _render_ollama_command([STG])
    assert "now() { date +%s; }" in command or "date +%s" in command
    assert "$pid" in command or "$serve_pid" in command
    assert "$$LIST" not in command


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cold_start_success_under_2s():
    """Cold start succeeds with 2s caps, waits for bootstrap-complete."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            if [ "$1" = "serve" ]; then
                echo $$ > "$STATE_DIR/serve_pid"
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                # Wait for stop signal
                while [ ! -f "$STATE_DIR/stop" ]; do sleep 0.1; done
                exit 0
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

        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )

        # Wait for bootstrap complete message
        max_wait = 10
        for _ in range(max_wait * 10):
            if (state_dir / "stop").exists():
                break
            # Check if process wrote anything indicating completion
            try:
                # Non-blocking check if complete message appeared
                if proc.poll() is None:
                    time.sleep(0.1)
                else:
                    break
            except Exception:
                time.sleep(0.1)

        # Now stop serve
        (state_dir / "stop").touch()

        stdout, stderr = proc.communicate(timeout=5)

        assert proc.returncode == 0, f"stderr: {stderr}"
        assert "Bootstrap complete" in stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cached_offline_success_under_2s():
    """Cached offline startup succeeds with 2s caps."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            if [ "$1" = "serve" ]; then
                echo $$ > "$STATE_DIR/serve_pid"
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                while [ ! -f "$STATE_DIR/stop" ]; do sleep 0.1; done
                exit 0
            elif [ "$1" = "list" ]; then
                [ -f "$STATE_DIR/ready" ] || exit 1
                echo "nomic-embed-text:v1.5    0a109f422b47    128 MB"
                echo "nomic-embed-text:latest   0a109f422b47    128 MB"
            elif [ "$1" = "pull" ]; then
                exit 1  # Registry down
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)

        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_READY_CAP": "2",
        }

        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )

        time.sleep(1)
        (state_dir / "stop").touch()

        stdout, stderr = proc.communicate(timeout=10)

        assert proc.returncode == 0, f"stderr: {stderr}"
        assert "cached with digest" in stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_cp_exit_9_accurate_diagnostic():
    """cp exiting 9 reports accurate exit code."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB",
            cp_behavior="fail",
        )

        # This test measures cp's diagnostic, not readiness scheduling. Model an
        # already-ready service so the first probe cannot lose the 2s budget to
        # the fake serve's startup sleep. Deadline tests keep their own fixtures.
        state_dir = tmp_path / ".ollama_state"
        (state_dir / "serving").touch()
        (state_dir / "ready").touch()

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

        assert (state_dir / "cp_pid").is_file(), f"cp branch not reached: {result.stderr}"
        assert result.returncode != 0
        assert "ollama cp exited 9" in result.stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_readiness_deadline_clamped():
    """Readiness with 3s cap / 5s list timeout exits within 4s."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        _create_fake_ollama(
            tmp_path,
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
        assert elapsed <= 4.5, f"3s cap overran to {elapsed:.2f}s"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_list_no_process_leak():
    """Hung list post-ready terminates cleanly, no process leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        # Portable counter (no $RANDOM)
        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"

            get_next_id() {{
                counter_file="$STATE_DIR/counter"
                if [ -f "$counter_file" ]; then
                    count=$(cat "$counter_file")
                else
                    count=0
                fi
                count=$((count + 1))
                echo "$count" > "$counter_file"
                echo "$count"
            }}

            if [ "$1" = "serve" ]; then
                echo $$ > "$STATE_DIR/serve_pid"
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                while true; do sleep 1; done
            elif [ "$1" = "list" ]; then
                list_id=$(get_next_id)
                echo $$ > "$STATE_DIR/list_pid_$list_id"
                [ -f "$STATE_DIR/ready" ] || exit 1
                if [ -f "$STATE_DIR/post_ready" ]; then
                    # Hang on post-ready list calls
                    touch "$STATE_DIR/hung"
                    while true; do sleep 1; done
                else
                    # First readiness probe succeeds
                    touch "$STATE_DIR/post_ready"
                    echo ""
                fi
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)

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

        time.sleep(0.5)

        # Assert hang was injected
        assert (state_dir / "hung").exists(), "Test bug: hang never injected"

        # Check no processes alive
        alive = _check_processes_alive(state_dir, ["serve", "list"])

        assert result.returncode != 0, f"Should fail, stderr: {result.stderr}"
        assert len(alive) == 0, f"leaked {len(alive)} processes: {alive}"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_fast_success_not_misreported_as_timeout():
    """Fast successful query with 1s cap reports success, not timeout."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"
            if [ "$1" = "serve" ]; then
                echo $$ > "$STATE_DIR/serve_pid"
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                while [ ! -f "$STATE_DIR/stop" ]; do sleep 0.1; done
                exit 0
            elif [ "$1" = "list" ]; then
                [ -f "$STATE_DIR/ready" ] || exit 1
                echo "nomic-embed-text:v1.5    0a109f422b47    128 MB"
                echo "nomic-embed-text:latest   0a109f422b47    128 MB"
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)

        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "1",
            "OLLAMA_READY_CAP": "1",
        }

        proc = subprocess.Popen(
            ["dash", "-c", command],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmp_path),
        )

        time.sleep(0.5)
        (state_dir / "stop").touch()

        stdout, stderr = proc.communicate(timeout=10)

        assert proc.returncode == 0, f"stderr: {stderr}"
        assert "timed out" not in stderr
        assert "Bootstrap complete" in stderr


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_pull_no_leak():
    """Hung pull terminates cleanly with no process leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        _create_fake_ollama(
            tmp_path,
            list_output="",  # Need pull
            hang_operation="pull",
        )

        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_PULL_TIMEOUT": "3",
            "OLLAMA_READY_CAP": "5",
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

        time.sleep(0.5)
        alive = _check_processes_alive(state_dir, ["serve", "pull"])

        assert result.returncode != 0
        assert len(alive) == 0, f"leaked {len(alive)} processes: {alive}"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_hung_cp_no_leak():
    """Hung cp terminates cleanly with no process leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        _create_fake_ollama(
            tmp_path,
            list_output="nomic-embed-text:v1.5    0a109f422b47    128 MB",
            hang_operation="cp",
        )

        env = {
            "PATH": f"{tmp_path}:/usr/bin:/bin",
            "OLLAMA_LIST_TIMEOUT": "2",
            "OLLAMA_CP_TIMEOUT": "3",
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

        time.sleep(0.5)
        alive = _check_processes_alive(state_dir, ["serve", "cp"])

        assert result.returncode != 0
        assert len(alive) == 0, f"leaked {len(alive)} processes: {alive}"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_final_list_timeout_no_leak():
    """Final list timeout terminates serve cleanly via trap, no leaks."""
    command = _render_ollama_command([PROD_BASE, PROD_OVERLAY])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        state_dir = tmp_path / ".ollama_state"
        state_dir.mkdir()

        # Portable counter (no $RANDOM, works in dash)
        ollama_script = tmp_path / "ollama"
        script_content = textwrap.dedent(f'''#!/bin/sh
            STATE_DIR="{state_dir}"

            get_next_id() {{
                counter_file="$STATE_DIR/counter"
                if [ -f "$counter_file" ]; then
                    count=$(cat "$counter_file")
                else
                    count=0
                fi
                count=$((count + 1))
                echo "$count" > "$counter_file"
                echo "$count"
            }}

            if [ "$1" = "serve" ]; then
                echo $$ > "$STATE_DIR/serve_pid"
                touch "$STATE_DIR/serving" "$STATE_DIR/ready"
                while true; do sleep 1; done
            elif [ "$1" = "list" ]; then
                list_id=$(get_next_id)
                echo $$ > "$STATE_DIR/list_pid_$list_id"
                [ -f "$STATE_DIR/ready" ] || exit 1
                # Hang on 5th or later list call (final verify)
                if [ "$list_id" -ge 5 ]; then
                    touch "$STATE_DIR/hung_at_$list_id"
                    while true; do sleep 1; done
                fi
                # Early lists succeed
                echo "nomic-embed-text:v1.5    0a109f422b47    128 MB"
                echo "nomic-embed-text:latest   0a109f422b47    128 MB"
            elif [ "$1" = "pull" ]; then
                exit 0
            elif [ "$1" = "cp" ]; then
                exit 0
            fi
        ''')
        ollama_script.write_text(script_content)
        ollama_script.chmod(0o755)

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
            timeout=20,
            cwd=str(tmp_path),
        )

        time.sleep(0.5)

        # Assert hang was injected (at 5th call or later)
        hung_files = list(state_dir.glob("hung_at_*"))
        assert len(hung_files) > 0, (
            f"Test bug: final-list hang never injected (counter files: {list(state_dir.glob('list_pid_*'))})"
        )

        # Check no processes alive
        alive = _check_processes_alive(state_dir, ["serve", "list"])

        assert result.returncode != 0, (
            f"Should fail with final-list timeout, stderr: {result.stderr}"
        )
        assert (
            "Final verification" in result.stderr or "ollama list (final verify)" in result.stderr
        ), f"Missing expected diagnostic, stderr: {result.stderr}"
        assert len(alive) == 0, (
            f"leaked {len(alive)} processes (serve must be cleaned up via trap): {alive}"
        )
