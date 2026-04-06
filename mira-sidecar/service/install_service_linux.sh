#!/usr/bin/env bash
# ============================================================
#  MIRA RAG Sidecar — Linux Service Installer (systemd)
#  Installs the sidecar as a systemd service named mira-rag
#
#  Prerequisites:
#    - Python 3.12+
#    - uv (pip install uv)
#    - Run as root or with sudo
#
#  Usage:
#    sudo ./install_service_linux.sh [properties_file_path]
#
#  Example:
#    sudo ./install_service_linux.sh /usr/local/bin/ignition/data/factorylm/factorylm.properties
# ============================================================

set -euo pipefail

SERVICE_NAME="mira-rag"
SIDECAR_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROPERTIES_FILE="${1:-}"
SERVICE_USER="${MIRA_USER:-mira}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo ""
echo "=========================================="
echo "  MIRA RAG Sidecar — Service Installer"
echo "=========================================="
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found. Install Python 3.12+."
    exit 1
fi

# Check uv
if ! command -v uv &>/dev/null; then
    echo "ERROR: uv not found. Install with: pip install uv"
    exit 1
fi

# Create service user if needed
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "[1/5] Creating service user: $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
else
    echo "[1/5] Service user $SERVICE_USER already exists."
fi

# Install dependencies
echo "[2/5] Installing dependencies with uv ..."
cd "$SIDECAR_DIR"
uv sync
echo "      OK"

# Set ownership
chown -R "$SERVICE_USER":"$SERVICE_USER" "$SIDECAR_DIR"

# Build environment line
ENV_LINE=""
if [ -n "$PROPERTIES_FILE" ] && [ -f "$PROPERTIES_FILE" ]; then
    ENV_LINE="Environment=PROPERTIES_FILE=$PROPERTIES_FILE"
    echo "      Properties file: $PROPERTIES_FILE"
fi

# Write systemd unit
echo "[3/5] Writing systemd unit: $UNIT_FILE"
cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=MIRA RAG Sidecar — FactoryLM
Documentation=https://github.com/Mikecranesync/MIRA
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$SIDECAR_DIR
ExecStart=$SIDECAR_DIR/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 5000
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME
$ENV_LINE

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$SIDECAR_DIR

[Install]
WantedBy=multi-user.target
UNIT

# Create logs/data dirs
mkdir -p "$SIDECAR_DIR/logs" "$SIDECAR_DIR/chroma_data" "$SIDECAR_DIR/docs"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$SIDECAR_DIR/logs" "$SIDECAR_DIR/chroma_data" "$SIDECAR_DIR/docs"

# Reload and enable
echo "[4/5] Enabling and starting service ..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

# Verify
echo "[5/5] Verifying ..."
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "      Service is RUNNING."
else
    echo "      WARNING: Service may not have started. Check:"
    echo "      journalctl -u $SERVICE_NAME -n 20"
fi

echo ""
echo "=========================================="
echo "  Installation Complete"
echo "=========================================="
echo ""
echo "  Service: $SERVICE_NAME"
echo "  URL:     http://localhost:5000/status"
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo ""
echo "  To check:  systemctl status $SERVICE_NAME"
echo "  To stop:   systemctl stop $SERVICE_NAME"
echo "  To remove: systemctl disable $SERVICE_NAME && rm $UNIT_FILE"
echo ""
