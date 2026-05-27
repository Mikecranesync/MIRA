#!/usr/bin/env bash
# Double-click from Finder to start live conveyor monitoring.
# Tier 2: full pipeline — Docker (Node-RED + relay) + poller + dashboard.

set -u
cd "$(dirname "$0")/.."

PLC_IP="${DEMO_PLC_IP:-192.168.1.100}"
RELAY_URL="${MIRA_RELAY_URL:-http://localhost:8765}"
DASHBOARD_URL="http://localhost:1880/dashboard"

echo "================================================"
echo "  MIRA — Garage Conveyor Monitor"
echo "================================================"
echo ""
echo "  PLC:       $PLC_IP:502"
echo "  Relay:     $RELAY_URL"
echo "  Dashboard: $DASHBOARD_URL"
echo ""

echo "[1/3] Starting Docker services (Node-RED + relay)..."
if ! docker compose up -d node-red mira-relay >/dev/null 2>&1; then
    echo "  WARNING: 'docker compose up' failed — is Docker running?"
    echo "  Continuing without dashboard (poller still works if PLC is reachable)."
fi

echo "[2/3] Probing PLC at $PLC_IP:502..."
if python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(2)
try:
    s.connect(('$PLC_IP', 502)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
"; then
    PLC_FOUND=1
    echo "  OK — PLC is reachable."
else
    PLC_FOUND=0
    echo "  PLC not reachable — falling back to simulator on 127.0.0.1:5020."
fi

echo "[3/3] Opening dashboard and starting poller..."
( sleep 3 && open "$DASHBOARD_URL" ) &

if [ "$PLC_FOUND" = "1" ]; then
    exec python3 -m tools.demo_plc_poller \
        --plc-ip "$PLC_IP" \
        --relay-url "$RELAY_URL" \
        --poll-interval 1.0
else
    python3 -m tools.demo_plc_simulator --port 5020 &
    SIM_PID=$!
    trap "kill $SIM_PID 2>/dev/null" EXIT
    sleep 2
    exec python3 -m tools.demo_plc_poller \
        --plc-ip 127.0.0.1 \
        --plc-port 5020 \
        --relay-url "$RELAY_URL" \
        --poll-interval 1.0
fi
