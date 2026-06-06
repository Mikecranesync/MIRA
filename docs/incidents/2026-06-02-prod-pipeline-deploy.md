# Incident: prod chat outage on the #1593 deploy (2026-06-02)

**Resolved:** 2026-06-03. **Prod healthy:** `app.factorylm.com` 200, `/api/health` 200,
`mira-pipeline-saas` Up/healthy.

## What happened

Merging the #1593 umbrella (Command Center + Ignition-Module secure edge) auto-deployed
to prod, and `mira-pipeline-saas` (the chat backend) crash-looped on
`ModuleNotFoundError`, failing the deploy. Chat was down until the fix landed.

## Two linked root causes

1. **Per-file `COPY` drift in `mira-pipeline/Dockerfile`.** The Dockerfile listed each
   module by name. The Ignition chat cutover added `ignition_chat.py` (which imports
   `ignition_audit.py`) but no `COPY` lines, so those files were never in the image →
   `ModuleNotFoundError: ignition_chat`, then `ignition_audit` (whack-a-mole across two
   deploys). **Fixed (#1667 → #1670):** `COPY mira-pipeline/*.py .` — ships all current
   and future source modules. Tests live in `mira-pipeline/tests/` (a subdir, not matched).

2. **The deploy hotfix-bypass was itself fragile.** `deploy-vps.yml`'s "Validate + audit
   staging-gate bypass" step calls `gh issue create`, but the Actions `GITHUB_TOKEN`
   lacks `issues:write` → `GraphQL: Resource not accessible by integration (createIssue)`
   → the step exited 1 and **aborted every hotfix deploy** before docker ran. **Fixed
   (#1673):** made `gh issue create` non-fatal (warn + log the reason, continue). Token
   permissions were **not** broadened.

## Why CI didn't catch it

`Smoke Test` checks routes, not the saas image build — and `mira-pipeline` was the only
saas image **not** built in `docker-build-check`. Worse, a missing-`COPY`-of-an-imported
module **does not fail `docker build`** (the image builds; it crashes at `import` on
startup).

## Prevention (this PR)

`docker-build-check` in `.github/workflows/ci.yml` now **builds `mira-pipeline`** (context
= repo root, matching `docker-compose.saas.yml`) **and runs an import smoke-test**
(`docker run --entrypoint python … -c "import main"`) — reproducing container startup so a
missing/uncopied module fails CI instead of crash-looping prod. Verified locally: passes
on fixed `main`, fails (`ModuleNotFoundError`) on the pre-incident Dockerfile.

## Restore sequence

#1593 merge (broke) → #1667 → #1670 (code) → #1673 (deploy tooling) → `deploy-vps`
dispatch (`skip_staging_gate=true` + `skip_reason`) → `mira-pipeline-saas Up (healthy)`.
