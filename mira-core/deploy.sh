#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/3] Checking ollama is available..."
if ! command -v ollama &>/dev/null; then
    echo "ERROR: 'ollama' not found on PATH. Install Ollama and try again." >&2
    exit 1
fi

echo "==> [2/3] Pulling nomic-embed-text (required for RAG)..."
ollama pull nomic-embed-text

echo "==> [3/3] Restarting mira-core stack..."
cd "$SCRIPT_DIR"
docker compose down
docker compose up -d

echo "==> Done. All services started."
