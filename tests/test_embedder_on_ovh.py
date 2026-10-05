"""The embedder runs on the OVH host, next to the Hub (2026-10-05 outage).

Prod and staging moved to the OVH host on 2026-09-19. That host is not on the
tailnet, but Doppler's OLLAMA_BASE_URL still named Bravo's tailnet address, so
every embed-on-write failed and every upload landed BM25-only (prod canary run
37328567165: 264/264 fresh chunks dark). These tests pin the repair:

- a pinned Ollama service in BOTH OVH compose files, on the internal network only
  (Ollama has no auth), with a healthcheck that passes only when the model digest
  matches the one the existing ~94k vectors were made with (Bravo: 0a109f422b47);
- the Hub's OLLAMA_BASE_URL set IN COMPOSE to that service, not inherited from the
  shared Doppler value (which other tailnet-side tools still need);
- deploy-vps can deploy the image-only service (allowlisted, and pulled before the
  image-identity check, which would otherwise fail closed on a never-pulled image).
"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROD = ROOT / "docker-compose.saas.yml"
STG = ROOT / "docker-compose.staging-vps.yml"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-vps.yml"

IMAGE = "ollama/ollama:0.22.0"  # Bravo runs 0.22.0
MODEL = "nomic-embed-text:v1.5"
DIGEST = "0a109f422b47"  # manifest digest of v1.5 == :latest == Bravo's model
URL = "http://mira-ollama:11434"


def _svc(path: Path, name: str) -> dict:
    services = yaml.safe_load(path.read_text())["services"]
    assert name in services, f"{name} missing from {path.name}"
    return services[name]


def _env(svc: dict) -> dict:
    env = svc.get("environment") or []
    if isinstance(env, dict):
        return {k: str(v) for k, v in env.items()}
    return dict(e.split("=", 1) for e in env if "=" in e)


def _healthcheck_text(svc: dict) -> str:
    test = (svc.get("healthcheck") or {}).get("test")
    return " ".join(test) if isinstance(test, list) else str(test or "")


def _check_ollama(path: Path, network: str) -> None:
    svc = _svc(path, "mira-ollama")
    assert svc["image"] == IMAGE, "pin the Ollama runtime Bravo uses"
    assert "ports" not in svc, "Ollama has no auth: never publish it, internal network only"
    assert svc.get("networks") == [network]
    assert svc.get("restart") == "unless-stopped"
    assert svc.get("mem_limit"), "bound its memory on a shared 12 GB host"
    hc = _healthcheck_text(svc)
    assert MODEL in hc and DIGEST in hc, "healthy only when the pinned model digest is present"
    entry = " ".join(svc.get("entrypoint") or []) + " " + " ".join(
        svc["command"] if isinstance(svc.get("command"), list) else [str(svc.get("command") or "")]
    )
    assert "ollama serve" in entry and f"ollama pull {MODEL}" in entry
    vols = svc.get("volumes") or []
    assert any(v.endswith(":/root/.ollama") for v in vols), "keep the model across restarts"


def test_prod_has_a_private_pinned_embedder():
    _check_ollama(PROD, "mira-net")


def test_staging_has_a_private_pinned_embedder():
    _check_ollama(STG, "staging-net")
    assert _svc(STG, "mira-ollama").get("container_name") == "stg-mira-ollama"


def test_prod_hub_embeds_through_the_colocated_service():
    assert _env(_svc(PROD, "mira-hub"))["OLLAMA_BASE_URL"] == URL


def test_staging_hub_embeds_through_the_colocated_service():
    assert _env(_svc(STG, "mira-hub"))["OLLAMA_BASE_URL"] == URL


def test_hub_does_not_wait_on_the_embedder():
    # The Hub degrades to BM25-only when the embedder is down; a health dependency
    # would instead keep the Hub from starting if a model pull ever failed.
    for path in (PROD, STG):
        deps = _svc(path, "mira-hub").get("depends_on") or {}
        assert "mira-ollama" not in deps


def test_model_volumes_are_declared():
    for path in (PROD, STG):
        compose = yaml.safe_load(path.read_text())
        vols = _svc(path, "mira-ollama")["volumes"]
        named = [v.split(":", 1)[0] for v in vols if not v.startswith(("/", "."))]
        assert named and all(n in (compose.get("volumes") or {}) for n in named)


def test_deploy_can_ship_the_image_only_service():
    text = DEPLOY.read_text()
    allowed = next(line for line in text.splitlines() if "ALLOWED_SERVICES=" in line)
    assert " mira-ollama " in f" {allowed.split('=', 1)[1].strip(chr(34))} "
    build = text.index("build --no-cache --pull $TARGETS")
    pull = text.index("pull --ignore-buildable $TARGETS")
    identity = text.index("=== Built image identities ===")
    assert build < pull < identity, "pull image-only targets before the identity check"
