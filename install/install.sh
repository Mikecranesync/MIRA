#!/usr/bin/env bash
# MIRA — Config 1 Production Install Script
# Usage: bash install/install.sh
# Requires: Docker, Doppler CLI, git, macOS or Linux

set -euo pipefail

REPO_URL="https://github.com/Mikecranesync/MIRA.git"
INSTALL_DIR="${MIRA_INSTALL_DIR:-$HOME/Mira}"
DOPPLER_PROJECT="factorylm"
DOPPLER_CONFIG="prd"

echo "=== MIRA Install ==="
echo "Install dir: $INSTALL_DIR"

# --- Prerequisite checks ---
echo ""
echo "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
    echo "ERROR: Docker not found. Install from https://docs.docker.com/get-docker/"
    exit 1
fi
echo "  Docker: $(docker --version)"

if ! command -v doppler &>/dev/null; then
    echo "ERROR: Doppler CLI not found. Install from https://docs.doppler.com/docs/install-cli"
    exit 1
fi
echo "  Doppler: $(doppler --version 2>&1 | head -1)"

if ! command -v git &>/dev/null; then
    echo "ERROR: git not found."
    exit 1
fi
echo "  git: $(git --version)"

# Check Doppler auth
if ! doppler secrets get WEBUI_SECRET_KEY --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" &>/dev/null; then
    echo "ERROR: Cannot access Doppler secrets for $DOPPLER_PROJECT/$DOPPLER_CONFIG"
    echo "       Run: doppler login && doppler setup"
    exit 1
fi
echo "  Doppler auth: OK ($DOPPLER_PROJECT/$DOPPLER_CONFIG)"

# --- Clone or update ---
echo ""
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating existing repo at $INSTALL_DIR..."
    git -C "$INSTALL_DIR" pull
else
    echo "Cloning MIRA to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# --- .env setup ---
if [ ! -f ".env" ] && [ -f ".env.template" ]; then
    echo ""
    echo "Creating .env from template..."
    cp .env.template .env
    echo "  Edit $INSTALL_DIR/.env and set NODERED_PORT if needed, then re-run."
fi

# --- Create Docker networks ---
echo ""
echo "Creating Docker networks..."
docker network create core-net 2>/dev/null && echo "  core-net created" || echo "  core-net already exists"
docker network create bot-net 2>/dev/null && echo "  bot-net created" || echo "  bot-net already exists"

# --- Start services ---
echo ""
echo "Starting MIRA services via Doppler..."
doppler run --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" -- \
    docker compose up -d

# --- Wait for services ---
echo ""
echo "Waiting 30s for services to start..."
sleep 30

# --- Smoke test ---
echo ""
echo "Running smoke test..."
bash "$INSTALL_DIR/install/smoke_test.sh"
