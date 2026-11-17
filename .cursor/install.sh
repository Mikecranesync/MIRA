#!/usr/bin/env bash
# MIRA — Cloud Agent environment bootstrap (idempotent).
#
# Prepares the OFFLINE development experience for this monorepo:
#   * a Python 3.12 virtualenv (.venv) with the dev toolchain (ruff, pyright,
#     pytest) plus the coherent service-requirement set CI's `test-unit` job
#     installs — enough to run lint, format, type-check, the hermetic pytest
#     suites, and the SimLab headless simulator end-to-end;
#   * Bun + the JS/TS workspace deps for the FactoryLM UI packages and the
#     mira-hub vitest suite (the `mira-hub-unit` required CI gate).
#
# The full Docker stack (docker-compose.yml) is intentionally NOT started here:
# it needs Doppler-managed secrets + NeonDB + Ollama, which are external
# prerequisites unavailable in a fresh Cloud Agent VM. This bootstrap targets
# everything that runs without those secrets.
#
# Safe to re-run: every step checks before it acts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== MIRA Cloud Agent install (repo: $REPO_ROOT) ==="

# --- 1. System package: python venv support ---------------------------------
# The default image ships CPython 3.12 but not the ensurepip/venv module.
if ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  echo "--- installing python3.12-venv ---"
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends python3.12-venv
fi

# --- 2. Python virtualenv + dependencies ------------------------------------
if [ ! -x ".venv/bin/python" ]; then
  echo "--- creating .venv ---"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip wheel setuptools

echo "--- dev toolchain (ruff / pyright / pytest) ---"
python -m pip install "ruff==0.9.*" pyright pytest pytest-asyncio pytest-xdist pytest-cov pyyaml hypothesis

# Installed sequentially (NOT one combined resolve) exactly as CI's test-unit
# job does: the service requirement files pin conflicting httpx ranges
# (0.28 vs 0.27) and rely on last-writer-wins. fastapi + uvicorn come from the
# ingest set, which is what powers the SimLab API app.
echo "--- service requirements (sequential, last-writer-wins like CI) ---"
python -m pip install -r mira-core/mira-ingest/requirements.txt
python -m pip install -r mira-bots/telegram/requirements.txt
python -m pip install -r mira-bots/teams/requirements.txt
python -m pip install -r mira-bots/foreman/requirements.txt
python -m pip install PyJWT cryptography

# --- 3. Bun + JS/TS workspace deps ------------------------------------------
export BUN_INSTALL="$HOME/.bun"
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$BUN_INSTALL/bin/bun" ]; then
  echo "--- installing Bun ---"
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$BUN_INSTALL/bin:$PATH"

echo "--- bun install (root FactoryLM UI workspace) ---"
bun install --frozen-lockfile

echo "--- bun install (mira-hub) ---"
( cd mira-hub && bun install --frozen-lockfile )

echo "=== MIRA install complete ==="
