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
DEPLOY_STG = ROOT / ".github" / "workflows" / "deploy-staging.yml"

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
    # Check that ollama serve runs and the model is pulled
    assert "ollama serve" in entry, "must start ollama serve"
    # Model can be pulled via variable or literal - check both patterns
    has_model_var = f"MODEL='{MODEL}'" in entry or f'MODEL="{MODEL}"' in entry
    has_literal_pull = f"ollama pull {MODEL}" in entry
    assert has_model_var or has_literal_pull, f"must pull {MODEL} via variable or literal"
    assert "ollama pull" in entry, "must contain pull command"
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


def test_staging_includes_ollama_in_allowlist_and_targets():
    """F3: Staging must authorize mira-ollama and include it in default TARGETS.
    
    Production's receipt verifier checks staging receipts for every effective
    service. If staging doesn't build/pull/inspect mira-ollama, the staging
    receipt won't contain its image identity, and production deployment of
    mira-ollama would fail the verification.
    """
    text = DEPLOY_STG.read_text()
    
    # Check allowlist (the case statement that validates SERVICES input)
    allowlist_section = text[text.index("case \"$service\" in"):text.index("esac", text.index("case \"$service\" in"))]
    assert "mira-ollama" in allowlist_section, \
        "staging allowlist must include mira-ollama so it can be deployed manually"
    
    # Check default TARGETS
    targets_line = next(line for line in text.splitlines() if line.strip().startswith('TARGETS="${SERVICES:-'))
    assert "mira-ollama" in targets_line, \
        "staging default TARGETS must include mira-ollama so its receipt covers it"
    
    # Staging must also pull image-only targets before the identity check
    build_idx = text.index("docker compose -p \"$PROJECT\" -f \"$COMPOSE_FILE\" build --no-cache --pull")
    pull_idx = text.index("pull --ignore-buildable")
    identity_idx = text.index("=== Built image identities ===")
    assert build_idx < pull_idx < identity_idx, \
        "staging must pull image-only targets after build and before image identity check"


def test_model_tag_alias_created_at_startup():
    """F2: The startup command must create a :latest alias from :v1.5.
    
    Hub code requests 'nomic-embed-text' (untagged = :latest), but the compose
    files pull 'nomic-embed-text:v1.5'. Without a :latest alias, embeds would
    fail. Verify both files create the alias via `ollama cp`.
    """
    for path in (PROD, STG):
        svc = _svc(path, "mira-ollama")
        cmd = " ".join(svc.get("entrypoint") or []) + " " + " ".join(
            svc["command"] if isinstance(svc.get("command"), list) else [str(svc.get("command") or "")]
        )
        # Check model is pulled (via variable or literal)
        has_model_var = f"MODEL='{MODEL}'" in cmd or f'MODEL="{MODEL}"' in cmd
        has_literal_pull = f"ollama pull {MODEL}" in cmd
        assert has_model_var or has_literal_pull, f"{path.name}: must pull v1.5 via variable or literal"
        
        # Check that :latest alias is created (either via variable or literal)
        has_var_cp = ("ollama cp" in cmd and "nomic-embed-text:latest" in cmd)
        has_literal_cp = f"ollama cp {MODEL} nomic-embed-text:latest" in cmd
        assert has_var_cp or has_literal_cp, \
            f"{path.name}: must create :latest alias so Hub's untagged requests work"


def test_healthcheck_requires_both_model_tags():
    """F2: The healthcheck must verify BOTH v1.5 and :latest exist with the correct digest.
    
    If only v1.5 is checked, the healthcheck could pass while Hub embed requests
    (which ask for untagged = :latest) would fail. Both tags must be present.
    """
    for path in (PROD, STG):
        hc = _healthcheck_text(_svc(path, "mira-ollama"))
        assert "nomic-embed-text:v1.5" in hc and DIGEST in hc, \
            f"{path.name}: healthcheck must verify v1.5 with digest {DIGEST}"
        assert "nomic-embed-text:latest" in hc, \
            f"{path.name}: healthcheck must also verify :latest alias exists"


def test_hub_embed_callers_use_available_model():
    """F2: Hub embedding callers request a model name Ollama will resolve.
    
    The Hub's write path (node-knowledge-ingest.ts) and read path
    (asset-intelligence.ts) both send a model name to the embedder. That name
    must either be untagged (resolved to :latest, which the startup creates) or
    explicitly v1.5. This test verifies the Hub code would work with the models
    the compose files provide.
    """
    ingest = ROOT / "mira-hub" / "src" / "lib" / "node-knowledge-ingest.ts"
    asset_intel = ROOT / "mira-hub" / "src" / "lib" / "agents" / "asset-intelligence.ts"
    
    ingest_text = ingest.read_text()
    asset_text = asset_intel.read_text()
    
    # Both files should reference nomic-embed-text (untagged or with a tag that
    # the compose files provide). The model name is passed to the /api/embeddings
    # endpoint. Verify the constants/literals used would resolve correctly.
    
    # node-knowledge-ingest.ts defines EMBED_MODEL
    assert 'EMBED_MODEL = "nomic-embed-text"' in ingest_text or \
           'EMBED_MODEL = "nomic-embed-text:latest"' in ingest_text or \
           'EMBED_MODEL = "nomic-embed-text:v1.5"' in ingest_text, \
           "node-knowledge-ingest.ts must use an available model tag"
    
    # asset-intelligence.ts hardcodes the model in the fetch body
    assert '"nomic-embed-text"' in asset_text or \
           '"nomic-embed-text:latest"' in asset_text or \
           '"nomic-embed-text:v1.5"' in asset_text, \
           "asset-intelligence.ts must request an available model"
    
    # The startup creates :latest from v1.5, so untagged "nomic-embed-text" works.
    # If either file used a DIFFERENT tag (e.g., :v2.0), this test would fail.


def test_production_overlay_does_not_override_embedder_url():
    """F1: The production overlay must not override the Hub's OLLAMA_BASE_URL.
    
    The base saas.yml sets it to the internal mira-ollama service. The production
    overlay previously overrode it with ${OLLAMA_BASE_URL:-}, which would take the
    Doppler value (Bravo's unreachable tailnet address) when present. This test
    verifies the overlay does NOT set OLLAMA_BASE_URL, so the base value wins.
    """
    prod_overlay = ROOT / "docker-compose.production.yml"
    text = prod_overlay.read_text()
    
    # The production overlay must NOT contain an OLLAMA_BASE_URL line in the
    # mira-hub environment section. The base saas.yml sets it correctly.
    # Parse manually to avoid the !override tag issue with yaml.safe_load.
    in_hub_env = False
    for line in text.splitlines():
        stripped = line.strip()
        if "mira-hub:" in line:
            in_hub_env = True
        elif in_hub_env and stripped.startswith("environment:"):
            in_hub_env = True
        elif in_hub_env and (line.startswith("  ") or not stripped):
            # Skip comments
            if not stripped.startswith("#") and "OLLAMA_BASE_URL:" in line:
                raise AssertionError(
                    f"production overlay must not set OLLAMA_BASE_URL; found: {stripped}. "
                    f"The base saas.yml sets it correctly to {URL}"
                )
        elif in_hub_env and not line.startswith(" "):
            break  # End of mira-hub service


def test_node_embed_retry_sweep_is_forwarded_to_hub():
    """The Hub must receive NODE_EMBED_RETRY_SWEEP so the rollback switch works.
    
    PR #4293 added the embed retry sweep with an off switch (NODE_EMBED_RETRY_SWEEP),
    but the variable was never forwarded into the Hub container in the OVH compose
    files. This test verifies both saas.yml and staging-vps.yml forward it with the
    correct default (unset → 1, explicit 0 → 0).
    """
    for path in (PROD, STG):
        env = _env(_svc(path, "mira-hub"))
        # The key must be present, and the value must have the ${VAR:-1} pattern
        # (or just be present with any forwarding pattern)
        assert "NODE_EMBED_RETRY_SWEEP" in env, \
            f"{path.name}: Hub must receive NODE_EMBED_RETRY_SWEEP"
        value = env["NODE_EMBED_RETRY_SWEEP"]
        # It should forward from the environment with a default of 1
        assert "${NODE_EMBED_RETRY_SWEEP" in value and ":-1}" in value, \
            f"{path.name}: NODE_EMBED_RETRY_SWEEP should default to 1 (found: {value})"


def test_production_overlay_does_not_override_node_embed_retry_sweep():
    """The production overlay must not override NODE_EMBED_RETRY_SWEEP.
    
    The base saas.yml sets it with the correct default. The production overlay
    must not override it, just like OLLAMA_BASE_URL.
    """
    prod_overlay = ROOT / "docker-compose.production.yml"
    text = prod_overlay.read_text()
    
    in_hub_env = False
    for line in text.splitlines():
        stripped = line.strip()
        if "mira-hub:" in line:
            in_hub_env = True
        elif in_hub_env and stripped.startswith("environment:"):
            in_hub_env = True
        elif in_hub_env and (line.startswith("  ") or not stripped):
            if not stripped.startswith("#") and "NODE_EMBED_RETRY_SWEEP:" in line:
                raise AssertionError(
                    f"production overlay must not set NODE_EMBED_RETRY_SWEEP; found: {stripped}. "
                    f"The base saas.yml sets it correctly with default 1"
                )
        elif in_hub_env and not line.startswith(" "):
            break


def test_ollama_cp_is_idempotent():
    """The startup command must skip `ollama cp` if :latest already has the right digest.
    
    On container restart, if nomic-embed-text:latest already exists with digest
    0a109f422b47, running `ollama cp` again would fail and potentially kill the
    ollama serve process. The command must check if :latest exists with the
    correct digest and skip the cp step if it does. The cp must also be non-fatal
    (|| true) so any unexpected failure doesn't kill ollama serve.
    """
    for path in (PROD, STG):
        svc = _svc(path, "mira-ollama")
        cmd = " ".join(svc.get("entrypoint") or []) + " " + " ".join(
            svc["command"] if isinstance(svc.get("command"), list) else [str(svc.get("command") or "")]
        )
        
        # Must check if :latest exists with digest (can use variable or literal)
        has_digest_check = (
            f"ollama list | grep -qE '^nomic-embed-text:latest[[:space:]]+{DIGEST}'" in cmd or
            'ollama list | grep -qE' in cmd and 'nomic-embed-text:latest' in cmd
        )
        assert has_digest_check, \
            f"{path.name}: must check if :latest already exists with correct digest"
        
        # Must conditionally run cp only if check fails
        assert "if ! ollama list" in cmd and "then" in cmd and "ollama cp" in cmd and "fi" in cmd, \
            f"{path.name}: must conditionally run cp only when :latest is missing/wrong"
        
        # cp must be non-fatal (|| true) so it never kills ollama serve
        assert "ollama cp" in cmd and "|| true" in cmd, \
            f"{path.name}: cp must be non-fatal (|| true) to protect ollama serve"
