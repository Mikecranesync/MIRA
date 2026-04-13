#!/usr/bin/env bash
# Start Paperclip with resolved configs.
# Run after setup.sh has completed at least once.
set -euo pipefail

PAPERCLIP_PORT="${PAPERCLIP_PORT:-3200}"
MIRA_REPO="${MIRA_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
GENERATED_DIR="$MIRA_REPO/paperclip/.generated"

echo "=== Paperclip Start ==="

# --- Validate prerequisites ---
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Run setup.sh first." >&2
    exit 1
fi

if ! command -v claude &>/dev/null; then
    echo "ERROR: Claude CLI not found. Run setup.sh first." >&2
    exit 1
fi

if [[ ! -d "$HOME/.paperclip/instances/default" ]]; then
    echo "ERROR: Paperclip not installed. Run setup.sh first." >&2
    exit 1
fi

# --- Resolve placeholders if .generated/ is missing ---
if [[ ! -d "$GENERATED_DIR/agents" ]]; then
    echo "Resolving __MIRA_HOME__ placeholders..."
    mkdir -p "$GENERATED_DIR/agents"
    for f in "$MIRA_REPO/paperclip/agents/"*.json; do
        sed "s|__MIRA_HOME__|$MIRA_REPO|g" "$f" > "$GENERATED_DIR/agents/$(basename "$f")"
    done
    sed "s|__MIRA_HOME__|$MIRA_REPO|g" "$MIRA_REPO/paperclip/mcp-config.json" > "$GENERATED_DIR/mcp-config.json"
    sed "s|__MIRA_HOME__|$MIRA_REPO|g" "$MIRA_REPO/paperclip/company-template.json" > "$GENERATED_DIR/company-template.json"
    echo "  Generated $(ls "$GENERATED_DIR/agents/" | wc -l | tr -d ' ') resolved agent configs"
fi

# --- Start ---
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "localhost")
echo "Starting Paperclip on port $PAPERCLIP_PORT..."
echo "  Dashboard: http://$TAILSCALE_IP:$PAPERCLIP_PORT"
echo "  Agent configs: $GENERATED_DIR/agents/"
echo ""

PORT="$PAPERCLIP_PORT" npx paperclipai start
