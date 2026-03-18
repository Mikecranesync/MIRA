#!/bin/bash
set -euo pipefail

# MIRA Deployment Script
# Deploys MIRA to a Mac Mini M4 for a new customer site.
# Run this ON the Mac Mini (not remotely over SSH for Docker builds).
#
# Usage: bash deploy.sh

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
MIRA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  MIRA Deployment${NC}"
    echo -e "${BOLD}  Maintenance Intelligence & Remote Assistant${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo -e "\n${GREEN}[STEP $1]${NC} $2"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_ok() {
    echo -e "${GREEN}[OK]${NC} $1"
}

# ─────────────────────────────────────────────────────
# Step 0: Pre-flight checks
# ─────────────────────────────────────────────────────
preflight() {
    print_step "0" "Pre-flight checks"

    # Check macOS
    if [[ "$(uname)" != "Darwin" ]]; then
        print_error "MIRA requires macOS (Metal GPU). Detected: $(uname)"
        exit 1
    fi

    # Check Ollama
    if ! command -v ollama &>/dev/null; then
        print_error "Ollama is not installed. Download from https://ollama.com"
        exit 1
    fi

    if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
        print_error "Ollama is not running. Start it first."
        exit 1
    fi
    print_ok "Ollama running at localhost:11434"

    # Check Docker
    if ! command -v docker &>/dev/null; then
        print_error "Docker is not installed. Install Docker Desktop for Mac."
        exit 1
    fi

    if ! docker info &>/dev/null; then
        print_error "Docker daemon is not running. Start Docker Desktop."
        exit 1
    fi
    print_ok "Docker running"

    # Check Doppler
    if ! command -v doppler &>/dev/null; then
        print_warn "Doppler CLI not installed. You'll need to set .env files manually."
        DOPPLER_AVAILABLE=false
    else
        DOPPLER_AVAILABLE=true
        print_ok "Doppler CLI available"
    fi

    # Check repos exist
    for repo in mira-core mira-bridge mira-bots mira-mcp; do
        if [[ ! -d "$MIRA_ROOT/$repo" ]]; then
            print_error "Missing repo: $MIRA_ROOT/$repo"
            print_error "Clone it: git clone git@github.com:Mikecranesync/$repo.git $MIRA_ROOT/$repo"
            exit 1
        fi
    done
    print_ok "All 4 repos present"
}

# ─────────────────────────────────────────────────────
# Step 1: Gather customer info
# ─────────────────────────────────────────────────────
gather_info() {
    print_step "1" "Customer information"

    read -rp "Customer name (e.g., Acme Manufacturing): " CUSTOMER_NAME
    read -rp "Site location (e.g., Orlando, FL): " SITE_LOCATION
    read -rp "Telegram bot token (press Enter to skip): " TELEGRAM_TOKEN
    read -rp "MARA opt-in — share anonymized fault data? [y/N]: " MARA_OPTIN

    CUSTOMER_SLUG=$(echo "$CUSTOMER_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
    MARA_OPTIN=${MARA_OPTIN:-n}

    echo ""
    echo -e "${BOLD}Customer:${NC}  $CUSTOMER_NAME"
    echo -e "${BOLD}Site:${NC}      $SITE_LOCATION"
    echo -e "${BOLD}Slug:${NC}      $CUSTOMER_SLUG"
    echo -e "${BOLD}Telegram:${NC}  ${TELEGRAM_TOKEN:-(skipped)}"
    echo -e "${BOLD}MARA:${NC}      $MARA_OPTIN"
    echo ""
    read -rp "Continue with these settings? [Y/n]: " CONFIRM
    if [[ "${CONFIRM:-y}" =~ ^[Nn] ]]; then
        echo "Aborted."
        exit 0
    fi
}

# ─────────────────────────────────────────────────────
# Step 2: Pull models
# ─────────────────────────────────────────────────────
pull_models() {
    print_step "2" "Pulling Ollama models"

    local models=("qwen2.5:7b-instruct-q4_K_M" "qwen2.5vl:7b" "nomic-embed-text" "glm-ocr")
    for model in "${models[@]}"; do
        if ollama list | grep -q "$(echo "$model" | cut -d: -f1)"; then
            print_ok "$model already pulled"
        else
            echo "  Pulling $model (this may take a while)..."
            ollama pull "$model"
        fi
    done

    # Build the MIRA custom model
    if ollama list | grep -q "mira:latest"; then
        print_ok "mira:latest already exists"
    else
        echo "  Building mira:latest from Modelfile..."
        ollama create mira -f "$MIRA_ROOT/mira-core/Modelfile"
    fi
    print_ok "All models ready"
}

# ─────────────────────────────────────────────────────
# Step 3: Create Docker networks
# ─────────────────────────────────────────────────────
create_networks() {
    print_step "3" "Creating Docker networks"

    for net in core-net bot-net; do
        if docker network inspect "$net" &>/dev/null; then
            print_ok "$net already exists"
        else
            docker network create "$net"
            print_ok "Created $net"
        fi
    done
}

# ─────────────────────────────────────────────────────
# Step 4: Create customer knowledge base folder
# ─────────────────────────────────────────────────────
create_customer_folder() {
    print_step "4" "Creating customer knowledge base folder"

    local kb_dir="$MIRA_ROOT/knowledge_base/customer/$CUSTOMER_SLUG"
    mkdir -p "$kb_dir"

    cat > "$kb_dir/README.md" << KBEOF
# $CUSTOMER_NAME — Knowledge Base

**Site:** $SITE_LOCATION
**Created:** $(date +%Y-%m-%d)

## How to add documents

Drop PDF equipment manuals into this folder, then upload them to Open WebUI:

1. Open http://localhost:3000 in your browser
2. Go to Workspace > Knowledge
3. Click the MIRA Industrial KB collection
4. Click "Upload" and select your PDFs

MIRA will use these manuals to ground its answers in your specific equipment.

## Recommended documents to add first

- Equipment operation manuals
- Maintenance schedules
- Wiring diagrams and schematics
- Fault code reference cards
- Safety data sheets
KBEOF

    print_ok "Created $kb_dir"
}

# ─────────────────────────────────────────────────────
# Step 5: Initialize database
# ─────────────────────────────────────────────────────
init_database() {
    print_step "5" "Initializing SQLite database"

    local db_dir="$MIRA_ROOT/mira-bridge/data"
    mkdir -p "$db_dir"

    if [[ -f "$db_dir/mira.db" ]]; then
        print_warn "mira.db already exists. Skipping initialization."
        print_warn "To rebuild: rm $db_dir/mira.db && sqlite3 $db_dir/mira.db < $db_dir/init_db.sql"
    else
        sqlite3 "$db_dir/mira.db" < "$db_dir/init_db.sql"
        print_ok "Database created with schema and seed data"
    fi
}

# ─────────────────────────────────────────────────────
# Step 6: Start services
# ─────────────────────────────────────────────────────
start_services() {
    print_step "6" "Starting MIRA services"

    echo "  Starting mira-core (Open WebUI + mcpo proxy)..."
    cd "$MIRA_ROOT/mira-core" && docker compose up -d

    echo "  Starting mira-bridge (Node-RED)..."
    cd "$MIRA_ROOT/mira-bridge" && docker compose up -d

    echo "  Starting mira-mcp (FastMCP server)..."
    cd "$MIRA_ROOT/mira-mcp" && docker compose up -d

    if [[ -n "${TELEGRAM_TOKEN:-}" ]]; then
        echo "  Starting mira-bots (Telegram bot)..."
        cd "$MIRA_ROOT/mira-bots" && docker compose up -d
    else
        print_warn "Skipping mira-bots (no Telegram token provided)"
    fi

    cd "$MIRA_ROOT"
}

# ─────────────────────────────────────────────────────
# Step 7: Wait for health checks
# ─────────────────────────────────────────────────────
wait_for_health() {
    print_step "7" "Waiting for services to become healthy"

    local max_wait=120
    local elapsed=0

    while [[ $elapsed -lt $max_wait ]]; do
        local all_healthy=true

        for container in mira-core mira-mcpo mira-bridge mira-mcp; do
            local status
            status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "missing")
            if [[ "$status" != "healthy" ]]; then
                all_healthy=false
            fi
        done

        if $all_healthy; then
            print_ok "All services healthy"
            return 0
        fi

        sleep 5
        elapsed=$((elapsed + 5))
        echo "  Waiting... ($elapsed/${max_wait}s)"
    done

    print_warn "Some services did not become healthy within ${max_wait}s"
    echo "  Run 'docker ps' to check status manually."
}

# ─────────────────────────────────────────────────────
# Step 8: Print status and next steps
# ─────────────────────────────────────────────────────
print_status() {
    print_step "8" "Deployment complete"

    echo ""
    echo -e "${BOLD}Service Status:${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" --filter "name=mira" 2>/dev/null || true
    echo ""

    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  MIRA is deployed for: $CUSTOMER_NAME${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo ""
    echo "  1. Open WebUI:  http://localhost:3000"
    echo "     - Create admin account on first visit"
    echo "     - Register MCP tools (see mira-core/docs/register-tools.md)"
    echo ""
    echo "  2. Node-RED:    http://localhost:1880"
    echo "     - Configure equipment flows for this site"
    echo ""
    if [[ -n "${TELEGRAM_TOKEN:-}" ]]; then
        echo "  3. Telegram:    Bot is running. Send a test message."
    else
        echo "  3. Telegram:    Set TELEGRAM_BOT_TOKEN in .env and restart mira-bots"
    fi
    echo ""
    echo "  4. Upload equipment manuals to the knowledge base:"
    echo "     Open WebUI > Workspace > Knowledge > MIRA Industrial KB"
    echo ""
    echo "  5. Give the lead technician the onboarding guide:"
    echo "     $MIRA_ROOT/deployment/onboarding_guide.md"
    echo ""
    echo -e "${BOLD}Troubleshooting:${NC}"
    echo "  $MIRA_ROOT/deployment/troubleshooting.md"
    echo ""
}

# ─────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────
main() {
    print_header
    preflight
    gather_info
    pull_models
    create_networks
    create_customer_folder
    init_database
    start_services
    wait_for_health
    print_status
}

main "$@"
