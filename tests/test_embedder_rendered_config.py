"""Rendered-config regression tests for the OVH embedder fix (#4292).

These tests run `docker compose config` on the real compose files to verify that:
1. A conflicting host OLLAMA_BASE_URL cannot override the Hub's literal value
2. NODE_EMBED_RETRY_SWEEP unset renders to "1" and explicit "0" renders to "0"  
3. The rendered mira-ollama service has no published ports

These are OFFLINE rendered tests — they don't start any containers, just render
the compose config with throwaway env vars. They require `docker compose` to be
available and will skip cleanly if it's not (e.g., in CI without Docker).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from enum import Enum

import pytest

ROOT = Path(__file__).resolve().parents[1]
PROD_BASE = ROOT / "docker-compose.saas.yml"
PROD_OVERLAY = ROOT / "docker-compose.production.yml"
STG = ROOT / "docker-compose.staging-vps.yml"


class ComposeFailureType(Enum):
    """Type of compose resolution failure."""
    ABSENT = "absent"  # Binary not found
    NONZERO_EXIT = "nonzero_exit"  # Installed but returned nonzero
    TIMEOUT = "timeout"  # Installed but timed out


# Shared isolated config used by both probe and renders
_ISOLATED_DOCKER_CONFIG = None
_COMPOSE_BASE_CMD = None
_COMPOSE_SKIP_REASON = None
_COMPOSE_FAILURE_TYPE = None


def _get_isolated_config():
    """Get or create the shared isolated Docker config dir."""
    global _ISOLATED_DOCKER_CONFIG
    if _ISOLATED_DOCKER_CONFIG is None:
        _ISOLATED_DOCKER_CONFIG = tempfile.mkdtemp(prefix="docker-config-")
    return _ISOLATED_DOCKER_CONFIG


def _get_isolated_env() -> dict[str, str]:
    """Build the isolated environment used by both probe and renders."""
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "DOCKER_CONFIG": _get_isolated_config(),
    }


def _resolve_compose_executable() -> tuple[str, ...] | None:
    """Resolve docker compose executable (standalone or plugin) under isolated config.
    
    Returns tuple of base command args, or None with _COMPOSE_SKIP_REASON and
    _COMPOSE_FAILURE_TYPE set if unavailable.
    Safe to call at collection time - never raises.
    """
    global _COMPOSE_BASE_CMD, _COMPOSE_SKIP_REASON, _COMPOSE_FAILURE_TYPE
    
    if _COMPOSE_BASE_CMD is not None:
        return _COMPOSE_BASE_CMD
    
    if _COMPOSE_SKIP_REASON is not None:
        return None
    
    env = _get_isolated_env()
    failures = []  # Track installed-but-failed candidates: (cmd, failure_type, returncode, stdout, stderr)
    
    # Try standalone docker-compose first
    try:
        result = subprocess.run(
            ["docker-compose", "version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env=env,
        )
        if result.returncode == 0 and ("docker-compose version" in result.stdout.lower() or "version" in result.stdout):
            _COMPOSE_BASE_CMD = ("docker-compose",)
            return _COMPOSE_BASE_CMD
        else:
            # Installed but failed (nonzero exit)
            failures.append(("docker-compose", ComposeFailureType.NONZERO_EXIT, result.returncode, result.stdout, result.stderr))
    except FileNotFoundError:
        pass  # Not installed, try next candidate
    except subprocess.TimeoutExpired as e:
        failures.append(("docker-compose", ComposeFailureType.TIMEOUT, None, None, f"timed out after {e.timeout}s"))
    
    # Try docker compose plugin
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env=env,
        )
        if result.returncode == 0 and ("docker compose version" in result.stdout.lower() or "version" in result.stdout):
            _COMPOSE_BASE_CMD = ("docker", "compose")
            return _COMPOSE_BASE_CMD
        else:
            # Installed but failed (nonzero exit)
            failures.append(("docker compose", ComposeFailureType.NONZERO_EXIT, result.returncode, result.stdout, result.stderr))
    except FileNotFoundError:
        pass  # Not installed
    except subprocess.TimeoutExpired as e:
        failures.append(("docker compose", ComposeFailureType.TIMEOUT, None, None, f"timed out after {e.timeout}s"))
    
    # If any candidate was installed but failed, that's an error (fail loud)
    if failures:
        cmd, failure_type, returncode, stdout, stderr = failures[0]
        _COMPOSE_FAILURE_TYPE = failure_type
        
        if failure_type == ComposeFailureType.NONZERO_EXIT:
            _COMPOSE_SKIP_REASON = (
                f"{cmd} version returned exit {returncode}.\n"
                f"stdout: {stdout}\nstderr: {stderr}"
            )
        else:  # TIMEOUT
            _COMPOSE_SKIP_REASON = f"{cmd} version {stderr}"
        return None
    
    # All candidates genuinely absent - skip
    _COMPOSE_FAILURE_TYPE = ComposeFailureType.ABSENT
    _COMPOSE_SKIP_REASON = "no supported docker-compose or docker compose found under isolated DOCKER_CONFIG"
    return None


def _has_docker_compose() -> bool:
    """Check if docker compose is available and working.
    
    Returns True only if a supported compose exists and version check succeeds.
    Returns False if no compose binary found (skip case).
    Raises RuntimeError for installed-but-broken or timeout cases.
    """
    # Resolve once; this may set skip reason and failure type
    base_cmd = _resolve_compose_executable()
    
    if base_cmd is None:
        # Check failure type to distinguish installed-but-failed vs genuinely absent
        if _COMPOSE_FAILURE_TYPE in (ComposeFailureType.NONZERO_EXIT, ComposeFailureType.TIMEOUT):
            # Installed but failed - fail loud
            raise RuntimeError(_COMPOSE_SKIP_REASON)
        # Genuinely absent - skip case
        return False
    
    # base_cmd is valid, return True (resolver already verified it works)
    return True


def _render_config(compose_files: list[Path], env: dict[str, str], cwd: Path | None = None) -> dict:
    """Render compose config with throwaway env vars, fully isolated.
    
    Args:
        compose_files: List of compose file paths (base + overlays)
        env: Environment variables to set for rendering
        cwd: Working directory for render (default: ROOT)
        
    Returns:
        Parsed JSON of the rendered config
        
    Raises:
        subprocess.CalledProcessError: If docker compose config fails
        subprocess.TimeoutExpired: If render takes >60s
    """
    base_cmd = _resolve_compose_executable()
    if base_cmd is None:
        raise RuntimeError(f"Cannot render: {_COMPOSE_SKIP_REASON}")
    
    # CRITICAL: Build fresh argv copy - never mutate shared base_cmd
    cmd = list(base_cmd)
    for f in compose_files:
        cmd.extend(["-f", str(f)])
    # Explicit empty env-file prevents picking up .env from cwd or parents
    cmd.extend(["--env-file", "/dev/null"])
    cmd.extend(["config", "--format", "json"])
    
    # Use SAME isolated Docker config as the probe
    render_env = {
        **_get_isolated_env(),
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
        **env,
    }
    
    result = subprocess.run(
        cmd,
        env=render_env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
        cwd=str(cwd or ROOT),
    )
    return json.loads(result.stdout)


def _compose_available_or_skip():
    """Skip test only if Compose binary not found; fail on other errors."""
    try:
        available = _has_docker_compose()
        if not available and _COMPOSE_SKIP_REASON:
            pytest.skip(_COMPOSE_SKIP_REASON)
        return available
    except RuntimeError as e:
        # Compose exists but failed/timed out - don't skip, let it fail
        pytest.fail(f"docker compose exists but is broken: {e}")


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_prod_conflicting_ollama_base_url_cannot_override():
    """A host OLLAMA_BASE_URL env var cannot override the Hub's literal in production.
    
    The saas.yml base sets OLLAMA_BASE_URL=http://mira-ollama:11434 (literal, no ${}).
    Even if a conflicting OLLAMA_BASE_URL is set in the environment (e.g., Doppler's
    Bravo tailnet URL), the rendered config must keep the literal value.
    """
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {"OLLAMA_BASE_URL": "http://wrong-host:11434"},
    )
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env["OLLAMA_BASE_URL"] == "http://mira-ollama:11434", \
        "Production Hub's OLLAMA_BASE_URL must be the literal internal service, not the host env var"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_staging_conflicting_ollama_base_url_cannot_override():
    """A host OLLAMA_BASE_URL env var cannot override the Hub's literal in staging."""
    config = _render_config(
        [STG],
        {"OLLAMA_BASE_URL": "http://wrong-host:11434"},
    )
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env["OLLAMA_BASE_URL"] == "http://mira-ollama:11434", \
        "Staging Hub's OLLAMA_BASE_URL must be the literal internal service, not the host env var"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_prod_node_embed_retry_sweep_unset_renders_one():
    """NODE_EMBED_RETRY_SWEEP unset renders to "1" in production."""
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {},
    )
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "1", \
        "Production Hub must receive NODE_EMBED_RETRY_SWEEP=1 when unset (default ON)"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_prod_node_embed_retry_sweep_explicit_zero_renders_zero():
    """NODE_EMBED_RETRY_SWEEP=0 renders to "0" in production."""
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {"NODE_EMBED_RETRY_SWEEP": "0"},
    )
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "0", \
        "Production Hub must receive NODE_EMBED_RETRY_SWEEP=0 when explicitly disabled"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_staging_node_embed_retry_sweep_unset_renders_one():
    """NODE_EMBED_RETRY_SWEEP unset renders to "1" in staging."""
    config = _render_config([STG], {})
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "1", \
        "Staging Hub must receive NODE_EMBED_RETRY_SWEEP=1 when unset (default ON)"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_staging_node_embed_retry_sweep_explicit_zero_renders_zero():
    """NODE_EMBED_RETRY_SWEEP=0 renders to "0" in staging."""
    config = _render_config([STG], {"NODE_EMBED_RETRY_SWEEP": "0"})
    
    hub_env = config["services"]["mira-hub"]["environment"]
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "0", \
        "Staging Hub must receive NODE_EMBED_RETRY_SWEEP=0 when explicitly disabled"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_prod_mira_ollama_has_no_published_ports():
    """The rendered mira-ollama service must not publish any ports in production."""
    config = _render_config([PROD_BASE, PROD_OVERLAY], {})
    
    ollama_svc = config["services"]["mira-ollama"]
    ports = ollama_svc.get("ports")
    
    assert ports is None or ports == [], \
        "Production mira-ollama must not publish any ports (Ollama has no auth)"


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_staging_mira_ollama_has_no_published_ports():
    """The rendered mira-ollama service must not publish any ports in staging."""
    config = _render_config([STG], {})
    
    ollama_svc = config["services"]["mira-ollama"]
    ports = ollama_svc.get("ports")
    
    assert ports is None or ports == [], \
        "Staging mira-ollama must not publish any ports (Ollama has no auth)"


# ── Control tests for capability guard and isolation ───────────────────────


def test_compose_capability_guard_absent_skips():
    """When docker compose binary is absent, _has_docker_compose returns False."""
    try:
        available = _has_docker_compose()
        if available:
            pytest.skip("docker compose is installed (cannot test absent case)")
        else:
            # This is the expected path when absent
            assert _COMPOSE_FAILURE_TYPE == ComposeFailureType.ABSENT, \
                "Failure type must be ABSENT when compose genuinely not found"
    except RuntimeError:
        pytest.skip("docker compose exists but broken (not absent)")


def test_compose_capability_guard_nonzero_fails(monkeypatch):
    """Installed-but-failing Compose (nonzero version exit) must FAIL, not skip."""
    # Reset resolver state
    global _COMPOSE_BASE_CMD, _COMPOSE_SKIP_REASON, _COMPOSE_FAILURE_TYPE
    original_cmd = _COMPOSE_BASE_CMD
    original_reason = _COMPOSE_SKIP_REASON
    original_type = _COMPOSE_FAILURE_TYPE
    _COMPOSE_BASE_CMD = None
    _COMPOSE_SKIP_REASON = None
    _COMPOSE_FAILURE_TYPE = None
    
    try:
        # Mock subprocess.run to return nonzero on version check
        original_run = subprocess.run
        def mock_run(cmd, *args, **kwargs):
            if "version" in cmd:
                return subprocess.CompletedProcess(
                    args=cmd,
                    returncode=1,
                    stdout="",
                    stderr="compose plugin not found",
                )
            return original_run(cmd, *args, **kwargs)
        
        monkeypatch.setattr(subprocess, "run", mock_run)
        
        # This must raise RuntimeError, not return False
        with pytest.raises(RuntimeError, match="returned exit 1"):
            _has_docker_compose()
    
    finally:
        # Restore state
        _COMPOSE_BASE_CMD = original_cmd
        _COMPOSE_SKIP_REASON = original_reason
        _COMPOSE_FAILURE_TYPE = original_type


def test_compose_capability_guard_timeout_fails(monkeypatch):
    """Hung Compose (version timeout) must FAIL, not skip."""
    global _COMPOSE_BASE_CMD, _COMPOSE_SKIP_REASON, _COMPOSE_FAILURE_TYPE
    original_cmd = _COMPOSE_BASE_CMD
    original_reason = _COMPOSE_SKIP_REASON
    original_type = _COMPOSE_FAILURE_TYPE
    _COMPOSE_BASE_CMD = None
    _COMPOSE_SKIP_REASON = None
    _COMPOSE_FAILURE_TYPE = None
    
    try:
        # Mock subprocess.run to raise TimeoutExpired
        def mock_run(cmd, *args, **kwargs):
            if "version" in cmd:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=10)
            return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")
        
        monkeypatch.setattr(subprocess, "run", mock_run)
        
        # This must raise RuntimeError, not return False
        with pytest.raises(RuntimeError, match="timed out"):
            _has_docker_compose()
    
    finally:
        _COMPOSE_BASE_CMD = original_cmd
        _COMPOSE_SKIP_REASON = original_reason
        _COMPOSE_FAILURE_TYPE = original_type


def test_argv_immutability_regression(monkeypatch):
    """Consecutive render -> render -> probe must not mutate shared base argv.
    
    Regression test for shared-state mutation bug where _render_config extended
    the shared base command list, causing second render to fail with 'unknown
    shorthand flag: f'.
    """
    global _COMPOSE_BASE_CMD, _COMPOSE_SKIP_REASON, _COMPOSE_FAILURE_TYPE
    
    # Save and reset resolver state
    original_cmd = _COMPOSE_BASE_CMD
    original_reason = _COMPOSE_SKIP_REASON
    original_type = _COMPOSE_FAILURE_TYPE
    _COMPOSE_BASE_CMD = ("docker", "compose")  # Force a known base
    _COMPOSE_SKIP_REASON = None
    _COMPOSE_FAILURE_TYPE = None
    
    try:
        # Track all subprocess.run calls
        calls = []
        original_run = subprocess.run
        
        def mock_run(cmd, *args, **kwargs):
            calls.append(list(cmd))
            # Mock successful compose responses
            if cmd[-1] == "version":
                return subprocess.CompletedProcess(
                    args=cmd, returncode=0,
                    stdout="Docker Compose version v2.0.0", stderr=""
                )
            elif "config" in cmd:
                # Return minimal valid config
                mock_config = {
                    "services": {
                        "mira-hub": {
                            "environment": {
                                "OLLAMA_BASE_URL": "http://mira-ollama:11434",
                                "NODE_EMBED_RETRY_SWEEP": "1"
                            }
                        },
                        "mira-ollama": {}
                    }
                }
                return subprocess.CompletedProcess(
                    args=cmd, returncode=0,
                    stdout=json.dumps(mock_config), stderr=""
                )
            return original_run(cmd, *args, **kwargs)
        
        monkeypatch.setattr(subprocess, "run", mock_run)
        
        # First render
        _render_config([PROD_BASE], {})
        first_render_cmd = calls[-1]
        
        # Second render
        _render_config([STG], {})
        second_render_cmd = calls[-1]
        
        # Explicit probe: force subprocess call by directly invoking with isolated env
        probe_result = subprocess.run(
            list(_COMPOSE_BASE_CMD) + ["version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env=_get_isolated_env(),
        )
        probe_cmd = calls[-1]
        
        # Verify base argv unchanged
        base = list(_COMPOSE_BASE_CMD)
        assert base == ["docker", "compose"], \
            f"Base command was mutated: expected ['docker', 'compose'], got {base}"
        
        # Verify all commands start with exactly the base
        assert first_render_cmd[:len(base)] == base, \
            f"First render command {first_render_cmd} doesn't start with base {base}"
        assert second_render_cmd[:len(base)] == base, \
            f"Second render command {second_render_cmd} doesn't start with base {base}"
        assert probe_cmd[:len(base)] == base, \
            f"Probe command {probe_cmd} doesn't start with base {base}"
        
        # Verify first render didn't pollute second
        assert "-f" in first_render_cmd and "-f" in second_render_cmd, \
            "Both renders must have -f flags"
        
        # Verify probe is just version check
        assert probe_cmd == base + ["version"], \
            f"Probe must be clean version check, got {probe_cmd}"
    
    finally:
        _COMPOSE_BASE_CMD = original_cmd
        _COMPOSE_SKIP_REASON = original_reason
        _COMPOSE_FAILURE_TYPE = original_type


@pytest.mark.skipif(not _compose_available_or_skip(), reason="docker compose binary not found")
def test_env_file_isolation_sentinel():
    """A .env file with a marker value must NOT leak into rendered config.
    
    Creates a temp directory project with compose files and a sentinel .env,
    renders from there, and asserts the marker does NOT appear. Also verifies
    any pre-existing real .env in the checkout is unchanged.
    """
    sentinel_value = "pm-envfile-marker.invalid"
    real_env = ROOT / ".env"
    
    # Capture pre-existing .env state if any
    original_env_bytes = real_env.read_bytes() if real_env.exists() else None
    
    try:
        # Create temp directory project with compose files and sentinel .env
        with tempfile.TemporaryDirectory(prefix="compose-test-") as tmpdir:
            tmp_path = Path(tmpdir)
            
            # Copy compose files to temp dir
            tmp_prod_base = tmp_path / PROD_BASE.name
            tmp_prod_overlay = tmp_path / PROD_OVERLAY.name
            shutil.copy(PROD_BASE, tmp_prod_base)
            shutil.copy(PROD_OVERLAY, tmp_prod_overlay)
            
            # Write sentinel .env in temp dir
            sentinel_env = tmp_path / ".env"
            sentinel_env.write_text(f"ADMIN_EMAILS={sentinel_value}\n")
            
            # Render from temp dir
            config = _render_config(
                [tmp_prod_base, tmp_prod_overlay],
                {},
                cwd=tmp_path,
            )
            hub_env = config["services"]["mira-hub"]["environment"]
            
            # The sentinel must NOT appear in any rendered value
            for key, value in hub_env.items():
                assert sentinel_value not in str(value), \
                    f"Sentinel {sentinel_value} leaked into {key}={value}. " \
                    f"Isolation failed: .env was read despite --env-file /dev/null"
    
    finally:
        # Assert real checkout .env is unchanged
        current_env_bytes = real_env.read_bytes() if real_env.exists() else None
        assert current_env_bytes == original_env_bytes, \
            "Real checkout .env was modified by the test (CRITICAL hygiene failure)"
