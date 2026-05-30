#!/usr/bin/env bash
set -euo pipefail
PLC_IP="${1:-192.168.1.100}"
echo "=== Live Conveyor Monitor ==="
echo "PLC: $PLC_IP"

# Verify PLC reachable
echo "[1/3] Testing PLC connectivity..."
python3 plc/test_modbus.py "$PLC_IP" || { echo "FAIL: Cannot reach PLC at $PLC_IP"; exit 1; }

# Start services
echo "[2/3] Starting Node-RED + relay..."
docker compose up -d node-red mira-relay
sleep 3

# Start poller
echo "[3/3] Starting live poller (Ctrl+C to stop)..."
echo "  Dashboard: http://localhost:1880/dashboard"
python3 -m tools.demo_plc_poller \
  --plc-ip "$PLC_IP" \
  --relay-url http://localhost:8765 \
  --poll-interval 1.0
