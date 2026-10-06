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

import pytest

ROOT = Path(__file__).resolve().parents[1]
PROD_BASE = ROOT / "docker-compose.saas.yml"
PROD_OVERLAY = ROOT / "docker-compose.production.yml"
STG = ROOT / "docker-compose.staging-vps.yml"

# Shared isolated config used by both probe and renders
_ISOLATED_DOCKER_CONFIG = None
_COMPOSE_EXECUTABLE = None


def _get_isolated_config():
    """Get or create the shared isolated Docker config dir."""
    global _ISOLATED_DOCKER_CONFIG
    if _ISOLATED_DOCKER_CONFIG is None:
        _ISOLATED_DOCKER_CONFIG = tempfile.mkdtemp(prefix="docker-config-")
    return _ISOLATED_DOCKER_CONFIG


def _resolve_compose_executable():
    """Resolve the docker compose executable once, reuse everywhere."""
    global _COMPOSE_EXECUTABLE
    if _COMPOSE_EXECUTABLE is None:
        _COMPOSE_EXECUTABLE = ["docker", "compose"]
    return _COMPOSE_EXECUTABLE


def _has_docker_compose() -> bool:
    """Check if docker compose is available and working.
    
    Uses the SAME isolated config that renders will use.
    Returns True only if binary exists and version check succeeds.
    Raises an exception for installed-but-failing or timeout cases.
    """
    try:
        cmd = _resolve_compose_executable() + ["version"]
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "DOCKER_CONFIG": _get_isolated_config(),
        }
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"docker compose version returned exit {result.returncode}.\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )
        if not ("Docker Compose version" in result.stdout or "version" in result.stdout):
            raise RuntimeError(
                f"docker compose version succeeded but output unexpected.\n"
                f"stdout: {result.stdout}"
            )
        return True
    except FileNotFoundError:
        # Binary not found - this is the only case we skip for
        return False
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(
            f"docker compose version timed out after {e.timeout}s"
        ) from e


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
    cmd = _resolve_compose_executable()
    for f in compose_files:
        cmd.extend(["-f", str(f)])
    # Explicit empty env-file prevents picking up .env from cwd or parents
    cmd.extend(["--env-file", "/dev/null"])
    cmd.extend(["config", "--format", "json"])
    
    # Use SAME isolated Docker config as the probe
    render_env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "DOCKER_CONFIG": _get_isolated_config(),
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
        return _has_docker_compose()
    except RuntimeError:
        # Compose exists but failed/timed out - don't skip, let it fail
        pytest.fail("docker compose exists but is broken - see _has_docker_compose")


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
        _has_docker_compose()
        # If we reach here, compose is installed - skip this control test
        pytest.skip("docker compose is installed (cannot test absent case)")
    except RuntimeError:
        # Compose exists but is broken - not the absent case
        pytest.skip("docker compose exists but broken (not absent)")


def test_compose_capability_guard_nonzero_fails(monkeypatch):
    """Installed-but-failing Compose (nonzero version exit) must FAIL, not skip."""
    # Mock subprocess.run to return nonzero exit
    def mock_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=1,
            stdout="",
            stderr="compose plugin not found",
        )
    
    monkeypatch.setattr(subprocess, "run", mock_run)
    
    # This must raise RuntimeError, not return False
    with pytest.raises(RuntimeError, match="returned exit 1"):
        _has_docker_compose()


def test_compose_capability_guard_timeout_fails(monkeypatch):
    """Hung Compose (version timeout) must FAIL, not skip."""
    # Mock subprocess.run to raise TimeoutExpired
    def mock_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(
            cmd=args[0],
            timeout=10,
        )
    
    monkeypatch.setattr(subprocess, "run", mock_run)
    
    # This must raise RuntimeError, not return False
    with pytest.raises(RuntimeError, match="timed out"):
        _has_docker_compose()


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
