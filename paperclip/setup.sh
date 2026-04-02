#!/usr/bin/env bash
# Paperclip onboarding script for Mac Mini (Charlie or Bravo)
# Idempotent — safe to run multiple times
set -euo pipefail

# --- Configuration ---
PAPERCLIP_PORT="${PAPERCLIP_PORT:-3200}"
MIRA_REPO="${MIRA_REPO:-$HOME/MIRA}"
GITHUB_REPO="git@github.com:Mikecranesync/MIRA.git"
NODE_MAJOR=20

echo "=== Paperclip Setup for MIRA ==="
echo "Host:     $(hostname)"
echo "User:     $(whoami)"
echo "Port:     $PAPERCLIP_PORT"
echo "MIRA dir: $MIRA_REPO"
echo ""

# --- Step 1: Verify macOS + arm64 ---
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: This script is for macOS only." >&2
    exit 1
fi
echo "[1/8] macOS $(sw_vers -productVersion) ($(uname -m)) OK"

# --- Step 2: Check/install Node.js 20+ ---
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
    if (( NODE_VERSION >= NODE_MAJOR )); then
        echo "[2/8] Node.js $(node --version) OK"
    else
        echo "ERROR: Node.js $(node --version) is too old. Need v${NODE_MAJOR}+." >&2
        echo "  Install via: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install $NODE_MAJOR"
        exit 1
    fi
else
    echo "ERROR: Node.js not found." >&2
    echo "  Install via: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install $NODE_MAJOR"
    exit 1
fi

# --- Step 3: Check/install pnpm ---
if command -v pnpm &>/dev/null; then
    echo "[3/8] pnpm $(pnpm --version) OK"
else
    echo "[3/8] Installing pnpm via corepack..."
    corepack enable
    corepack prepare pnpm@latest --activate
    echo "  pnpm $(pnpm --version) installed"
fi

# --- Step 4: Check Claude CLI ---
if command -v claude &>/dev/null; then
    echo "[4/8] Claude CLI found at $(which claude)"
else
    echo "[4/8] Installing Claude CLI..."
    npm install -g @anthropic-ai/claude-code
    echo "  Claude CLI installed at $(which claude)"
fi

# --- Step 5: Check ANTHROPIC_API_KEY ---
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "[5/8] ANTHROPIC_API_KEY is set (${#ANTHROPIC_API_KEY} chars)"
else
    echo "WARNING: ANTHROPIC_API_KEY not set. Claude agents will need it at runtime."
    echo "  Set via: export ANTHROPIC_API_KEY=\$(doppler secrets get ANTHROPIC_API_KEY --plain -p factorylm -c prd)"
fi

# --- Step 6: Clone MIRA repo if needed ---
if [[ -d "$MIRA_REPO/.git" ]]; then
    echo "[6/8] MIRA repo exists at $MIRA_REPO"
    cd "$MIRA_REPO"
    echo "  Branch: $(git branch --show-current)"
    echo "  HEAD:   $(git log --oneline -1)"
else
    echo "[6/8] Cloning MIRA repo to $MIRA_REPO..."
    git clone "$GITHUB_REPO" "$MIRA_REPO"
    echo "  Cloned successfully"
fi

# --- Step 7: Install Paperclip ---
PAPERCLIP_HOME="$HOME/.paperclip"
if [[ -d "$PAPERCLIP_HOME/instances/default" ]]; then
    echo "[7/8] Paperclip already installed at $PAPERCLIP_HOME"
else
    echo "[7/8] Installing Paperclip..."
    PORT="$PAPERCLIP_PORT" npx paperclipai onboard --yes
    echo "  Paperclip installed"
fi

# Configure for authenticated mode + network access
PAPERCLIP_ENV="$PAPERCLIP_HOME/instances/default/.env"
if ! grep -q "BETTER_AUTH_SECRET" "$PAPERCLIP_ENV" 2>/dev/null; then
    echo "  Generating BETTER_AUTH_SECRET..."
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> "$PAPERCLIP_ENV"
fi

PAPERCLIP_CONFIG="$PAPERCLIP_HOME/instances/default/config.json"
if [[ -f "$PAPERCLIP_CONFIG" ]]; then
    # Update to authenticated mode with network binding
    python3 -c "
import json, sys
with open('$PAPERCLIP_CONFIG') as f:
    cfg = json.load(f)
cfg['host'] = '0.0.0.0'
cfg['port'] = $PAPERCLIP_PORT
cfg['deploymentMode'] = 'authenticated'
cfg['deploymentExposure'] = 'private'
with open('$PAPERCLIP_CONFIG', 'w') as f:
    json.dump(cfg, f, indent=2)
print('  Config updated: authenticated mode, host=0.0.0.0, port=$PAPERCLIP_PORT')
"
fi

# --- Step 8: Summary ---
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
echo ""
echo "[8/8] Setup complete!"
echo ""
echo "  Start Paperclip:"
echo "    PORT=$PAPERCLIP_PORT npx paperclipai start"
echo ""
echo "  Access from any Tailscale device:"
echo "    http://$TAILSCALE_IP:$PAPERCLIP_PORT"
echo ""
echo "  Next steps:"
echo "    1. Start Paperclip with the command above"
echo "    2. Create a company in the UI: 'MIRA Development'"
echo "    3. Register agents using the JSON definitions in paperclip/agents/"
echo "    4. Assign tasks and watch agents work"
echo ""
