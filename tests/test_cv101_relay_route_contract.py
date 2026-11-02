"""Deployment-governance contract for the CV-101 tag-ingest receiver (mira-relay).

The physical CV-101 route is: Ignition collector → HTTPS → POST
/api/v1/tags/ingest → mira-relay → approved_tags → tag_events +
live_signal_cache. The receiver must be releasable through the supported
exact-SHA path (deploy-staging.yml → receipts → deploy-vps.yml) and must never
be reachable unauthenticated or outside loopback. These checks fail loudly on
each way that has regressed or could:

  * staging could not stage it (service not in the workflow allowlist / compose),
    so no staging image receipt could ever exist for production promotion;
  * the relay runs OPEN when no key is configured — a deployed receiver must set
    RELAY_REQUIRE_HMAC=1 and the staging deploy must prove an unsigned 401;
  * production's base publish binds RELAY_BIND_ADDR, which Doppler prd still sets
    to the retired droplet's tailnet IP — the overlay must pin loopback;
  * nginx must expose exactly POST /api/v1/tags/ingest, nothing else of the relay.

pytest + pyyaml; the rendered-config checks skip cleanly without docker compose.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parent.parent
_STAGING_WORKFLOW = _ROOT / ".github" / "workflows" / "deploy-staging.yml"
_STAGING_COMPOSE = _ROOT / "docker-compose.staging-vps.yml"
_PROD_BASE = _ROOT / "docker-compose.saas.yml"
_PROD_OVERLAY = _ROOT / "docker-compose.production.yml"
_STAGING_NGINX = _ROOT / "deployment" / "nginx-staging-factorylm.conf"
_RETIRED_TAILNET_IP = "100.68.120.99"


class _TagTolerantLoader(yaml.SafeLoader):
    """SafeLoader that keeps compose merge tags (!override / !reset) as plain values."""


def _passthrough(loader, _suffix, node):
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return loader.construct_scalar(node)


_TagTolerantLoader.add_multi_constructor("!", _passthrough)


def _env_map(env) -> dict[str, str]:
    if isinstance(env, dict):
        return {k: "" if v is None else str(v) for k, v in env.items()}
    out = {}
    for item in env or []:
        key, _, value = str(item).partition("=")
        out[key] = value
    return out


def _deploy_script() -> str:
    wf = yaml.safe_load(_STAGING_WORKFLOW.read_text(encoding="utf-8"))
    for step in wf["jobs"]["deploy"]["steps"]:
        if step.get("name") == "Deploy exact authorized staging source":
            return step["run"]
    raise AssertionError("deploy step not found in deploy-staging.yml")


# ── staging workflow ─────────────────────────────────────────────────────────


def test_staging_workflow_accepts_and_rebuilds_the_relay():
    wf = yaml.safe_load(_STAGING_WORKFLOW.read_text(encoding="utf-8"))
    authorize = wf["jobs"]["authorize-target"]["steps"][0]["run"]
    allow = re.search(r"\n\s*([a-z0-9|-]+)\)\n\s*;;", authorize)
    assert allow, "staging service allowlist case arm not found"
    assert "mira-relay" in allow.group(1).split("|")
    default = re.search(r'TARGETS="\$\{SERVICES:-([^}]*)\}"', _deploy_script())
    assert default and "mira-relay" in default.group(1).split(), (
        "mira-relay must be a default staging target: `up -d` alone never rebuilds it"
    )


def test_staging_deploy_proves_the_relay_refuses_unsigned_ingest():
    script = _deploy_script()
    probe = script.index("stg-mira-relay (4765)")
    block = script[probe : probe + 1400]
    assert "http://127.0.0.1:4765/health" in block
    assert "http://127.0.0.1:4765/api/v1/tags/ingest" in block
    assert '[ "$RELAY_UNSIGNED" = "401" ]' in block
    assert "exit 1" in block
    # Health and auth probes run BEFORE the receipt is emitted.
    assert probe < script.index("FACTORYLM_DEPLOY_RECEIPT_JSON=")


# ── staging compose ──────────────────────────────────────────────────────────


def test_staging_relay_is_isolated_loopback_and_fail_closed():
    compose = yaml.safe_load(_STAGING_COMPOSE.read_text(encoding="utf-8"))
    relay = compose["services"]["mira-relay"]
    assert relay["container_name"] == "stg-mira-relay"
    assert relay["build"] == "./mira-relay"
    assert relay["ports"] == ["127.0.0.1:4765:8765"]
    assert relay["networks"] == ["staging-net"]
    assert "volumes" not in relay, "the staging relay needs no host or shared volume"
    env = _env_map(relay["environment"])
    assert env["RELAY_REQUIRE_HMAC"] == "1"
    assert env["RELAY_LEGACY_BEARER"] == "0"
    assert env["RELAY_API_KEY"] == ""
    assert env["MIRA_IGNITION_HMAC_KEY"] == "${MIRA_IGNITION_HMAC_KEY:-}"
    assert env["NEON_DATABASE_URL"] == "${NEON_DATABASE_URL:-}"
    assert "RELAY_BIND_ADDR" not in json.dumps(relay)
    # Distinct from every other published staging host port.
    others = [
        str(p)
        for name, svc in compose["services"].items()
        if name != "mira-relay"
        for p in svc.get("ports", [])
    ]
    assert not any(p.startswith("127.0.0.1:4765:") for p in others)


# ── production overlay ───────────────────────────────────────────────────────


def test_production_overlay_pins_relay_to_loopback_and_requires_hmac():
    text = _PROD_OVERLAY.read_text(encoding="utf-8")
    overlay = yaml.load(text, Loader=_TagTolerantLoader)  # noqa: S506 — SafeLoader subclass
    relay = overlay["services"]["mira-relay"]
    assert relay["ports"] == ["127.0.0.1:8765:8765"]
    assert relay["networks"] == ["mira-net"]
    env = _env_map(relay["environment"])
    assert env["RELAY_REQUIRE_HMAC"] == "1"
    assert env["RELAY_LEGACY_BEARER"] == "0"
    # The loopback pin must REPLACE the base publish, not append to it.
    block = text[text.index("  mira-relay:") :]
    assert re.search(r"\n    ports: !override\n      - \"127\.0\.0\.1:8765:8765\"", block)
    assert _RETIRED_TAILNET_IP not in "\n".join(
        line for line in block.splitlines() if not line.lstrip().startswith("#")
    )


# ── nginx ────────────────────────────────────────────────────────────────────


def _server_blocks(conf: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    for match in re.finditer(r"server\s*\{", conf):
        depth, i = 0, match.end() - 1
        while True:
            if conf[i] == "{":
                depth += 1
            elif conf[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = conf[match.start() : i + 1]
        name = re.search(r"server_name\s+([^;]+);", body).group(1).strip()
        blocks[name] = body
    return blocks


def test_staging_nginx_exposes_exactly_the_ingest_route():
    conf = _STAGING_NGINX.read_text(encoding="utf-8")
    code = "\n".join(line for line in conf.splitlines() if not line.lstrip().startswith("#"))
    assert code.count("127.0.0.1:4765") == 1, "exactly one route may reach the relay"
    blocks = _server_blocks(code)
    assert "127.0.0.1:4765" not in blocks["staging.factorylm.com"]
    app = blocks["app-staging.factorylm.com"]
    loc = re.search(r"location = /api/v1/tags/ingest \{(.*?)\n    \}", app, re.S)
    assert loc, "relay route must be an EXACT-match location"
    body = loc.group(1)
    assert "proxy_pass http://127.0.0.1:4765;" in body
    assert re.search(r"limit_except POST \{\s*deny all;\s*\}", body)
    assert "client_max_body_size 1m;" in body
    # nginx must not add or strip auth: no auth header manipulation in the route.
    assert "Authorization" not in body and "X-MIRA" not in body


# ── rendered config (skips without docker compose) ───────────────────────────


def _compose_cmd() -> list[str] | None:
    if shutil.which("docker") is None:
        return None
    env = {"PATH": os.environ.get("PATH", ""), "DOCKER_CONFIG": tempfile.mkdtemp()}
    try:
        ok = subprocess.run(
            ["docker", "compose", "version"], capture_output=True, timeout=10, env=env
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return ["docker", "compose"] if ok.returncode == 0 else None


_COMPOSE = _compose_cmd()
_needs_compose = pytest.mark.skipif(_COMPOSE is None, reason="docker compose not available")


def _render(files: list[Path], extra_env: dict[str, str]) -> dict:
    cmd = list(_COMPOSE or [])
    for f in files:
        cmd += ["-f", str(f)]
    cmd += ["--env-file", os.devnull, "config", "--format", "json"]
    env = {
        "PATH": os.environ.get("PATH", ""),
        "DOCKER_CONFIG": tempfile.mkdtemp(),
        "NEON_DATABASE_URL": "postgresql://dummy:dummy@localhost/dummy",
        "ATLAS_DB_PASSWORD": "dummy",
        "ATLAS_MINIO_PASSWORD": "dummy",
        "ATLAS_JWT_SECRET": "dummy",
        "NANGO_DB_PASSWORD": "dummy",
        "NANGO_ENCRYPTION_KEY": "dummy",
        "NANGO_SECRET_KEY": "dummy",
        "AUTH_SECRET": "dummy",
        "PLG_JWT_SECRET": "dummy",
        "MCP_REST_API_KEY": "dummy",
        **extra_env,
    }
    out = subprocess.run(
        cmd, env=env, capture_output=True, text=True, timeout=60, check=True, cwd=_ROOT
    )
    return json.loads(out.stdout)


@_needs_compose
def test_rendered_production_relay_is_loopback_even_with_the_retired_bind_addr():
    config = _render(
        [_PROD_BASE, _PROD_OVERLAY],
        {"RELAY_BIND_ADDR": _RETIRED_TAILNET_IP, "MIRA_IGNITION_HMAC_KEY": "x" * 64},
    )
    relay = config["services"]["mira-relay"]
    ports = relay["ports"]
    assert len(ports) == 1, ports
    assert ports[0]["host_ip"] == "127.0.0.1"
    assert str(ports[0]["published"]) == "8765" and int(ports[0]["target"]) == 8765
    assert list(relay["networks"]) == ["mira-net"]
    assert relay["environment"]["RELAY_REQUIRE_HMAC"] == "1"
    assert relay["environment"]["MIRA_IGNITION_HMAC_KEY"] == "x" * 64


@_needs_compose
def test_rendered_configs_do_not_require_the_key_to_render():
    """Fail-closed lives in the relay (RELAY_REQUIRE_HMAC), not a compose `:?`, so
    offline renders (ovh-preflight, rendered-config tests) keep working."""
    prod = _render([_PROD_BASE, _PROD_OVERLAY], {})
    assert prod["services"]["mira-relay"]["environment"]["RELAY_REQUIRE_HMAC"] == "1"
    stg = _render([_STAGING_COMPOSE], {})
    relay = stg["services"]["mira-relay"]
    assert relay["container_name"] == "stg-mira-relay"
    assert relay["ports"][0]["host_ip"] == "127.0.0.1"
    assert relay["environment"]["RELAY_REQUIRE_HMAC"] == "1"
