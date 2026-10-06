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
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
PROD_BASE = ROOT / "docker-compose.saas.yml"
PROD_OVERLAY = ROOT / "docker-compose.production.yml"
STG = ROOT / "docker-compose.staging-vps.yml"


def _has_docker_compose() -> bool:
    """Check if docker compose is available."""
    return shutil.which("docker") is not None


def _render_config(compose_files: list[Path], env: dict[str, str]) -> dict:
    """Render compose config with throwaway env vars.
    
    Args:
        compose_files: List of compose file paths (base + overlays)
        env: Environment variables to set for rendering
        
    Returns:
        Parsed YAML of the rendered config
        
    Raises:
        subprocess.CalledProcessError: If docker compose config fails
    """
    cmd = ["docker", "compose"]
    for f in compose_files:
        cmd.extend(["-f", str(f)])
    cmd.append("config")
    
    # Merge env with minimal required vars (avoid Doppler/real secrets)
    render_env = {
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
        check=True,
    )
    return yaml.safe_load(result.stdout)


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_conflicting_ollama_base_url_cannot_override():
    """A host OLLAMA_BASE_URL env var cannot override the Hub's literal in production.
    
    The saas.yml base sets OLLAMA_BASE_URL=http://mira-ollama:11434 (literal, no ${}).
    Even if a conflicting OLLAMA_BASE_URL is set in the environment (e.g., Doppler's
    Bravo tailnet URL), the rendered config must keep the literal value.
    """
    # Render with a conflicting OLLAMA_BASE_URL
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {"OLLAMA_BASE_URL": "http://wrong-host:11434"},
    )
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env["OLLAMA_BASE_URL"] == "http://mira-ollama:11434", \
        "Production Hub's OLLAMA_BASE_URL must be the literal internal service, not the host env var"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_conflicting_ollama_base_url_cannot_override():
    """A host OLLAMA_BASE_URL env var cannot override the Hub's literal in staging."""
    config = _render_config(
        [STG],
        {"OLLAMA_BASE_URL": "http://wrong-host:11434"},
    )
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env["OLLAMA_BASE_URL"] == "http://mira-ollama:11434", \
        "Staging Hub's OLLAMA_BASE_URL must be the literal internal service, not the host env var"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_node_embed_retry_sweep_unset_renders_one():
    """NODE_EMBED_RETRY_SWEEP unset renders to "1" in production.
    
    The sweep should be ON by default (unset → 1). This verifies the Hub receives "1"
    when NODE_EMBED_RETRY_SWEEP is not set in the environment.
    """
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {},  # NODE_EMBED_RETRY_SWEEP unset
    )
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "1", \
        "Production Hub must receive NODE_EMBED_RETRY_SWEEP=1 when unset (default ON)"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_node_embed_retry_sweep_explicit_zero_renders_zero():
    """NODE_EMBED_RETRY_SWEEP=0 renders to "0" in production.
    
    Setting NODE_EMBED_RETRY_SWEEP=0 should disable the sweep. This verifies the Hub
    receives "0" when the var is explicitly set to 0.
    """
    config = _render_config(
        [PROD_BASE, PROD_OVERLAY],
        {"NODE_EMBED_RETRY_SWEEP": "0"},
    )
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "0", \
        "Production Hub must receive NODE_EMBED_RETRY_SWEEP=0 when explicitly disabled"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_node_embed_retry_sweep_unset_renders_one():
    """NODE_EMBED_RETRY_SWEEP unset renders to "1" in staging."""
    config = _render_config([STG], {})
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "1", \
        "Staging Hub must receive NODE_EMBED_RETRY_SWEEP=1 when unset (default ON)"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_node_embed_retry_sweep_explicit_zero_renders_zero():
    """NODE_EMBED_RETRY_SWEEP=0 renders to "0" in staging."""
    config = _render_config([STG], {"NODE_EMBED_RETRY_SWEEP": "0"})
    
    hub_env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in config["services"]["mira-hub"]["environment"]
        if "=" in item
    }
    
    assert hub_env.get("NODE_EMBED_RETRY_SWEEP") == "0", \
        "Staging Hub must receive NODE_EMBED_RETRY_SWEEP=0 when explicitly disabled"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_prod_mira_ollama_has_no_published_ports():
    """The rendered mira-ollama service must not publish any ports in production.
    
    Ollama has no auth, so it must be reachable only on the internal network. The
    rendered config must not have a 'ports' key or it must be empty.
    """
    config = _render_config([PROD_BASE, PROD_OVERLAY], {})
    
    ollama_svc = config["services"]["mira-ollama"]
    ports = ollama_svc.get("ports")
    
    assert ports is None or ports == [], \
        "Production mira-ollama must not publish any ports (Ollama has no auth)"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker compose not available")
def test_staging_mira_ollama_has_no_published_ports():
    """The rendered mira-ollama service must not publish any ports in staging."""
    config = _render_config([STG], {})
    
    ollama_svc = config["services"]["mira-ollama"]
    ports = ollama_svc.get("ports")
    
    assert ports is None or ports == [], \
        "Staging mira-ollama must not publish any ports (Ollama has no auth)"
